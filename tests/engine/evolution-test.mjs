import { WebSocket } from "ws";

const ENGINE_URL = "ws://localhost:9731";
let ws;
let requestId = 0;
const pending = new Map();

function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(ENGINE_URL);
    ws.on("open", () => resolve());
    ws.on("error", (err) => reject(err));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
      if (msg.method && !msg.id) {
        console.log(`[NOTIFY] ${msg.method}: ${JSON.stringify(msg.params).substring(0, 200)}`);
      }
    });
  });
}

function call(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("Timeout")); } }, 300000);
  });
}

async function main() {
  console.log("Connecting to engine...");
  await connect();
  console.log("Connected!");

  console.log("\n=== Creating test run ===");
  const run = await call("run.create", {
    workingDir: "/tmp/ai-workbench-test",
    goals: [
      "Add a calculator module (calc.js) with add, subtract, multiply, divide functions",
      "Add a simple test file (calc.test.js) that verifies all four operations"
    ],
    terminationConditions: [
      "calc.js exists with add/subtract/multiply/divide functions",
      "calc.test.js exists and all tests pass"
    ],
    tasks: [
      {
        content: "Create calc.js with add, subtract, multiply, divide functions. Each function takes two numbers and returns the result. Include error handling for divide by zero.",
        type: "user_defined",
        priority: 1,
        timeoutMinutes: 5,
        agentMode: "single"
      },
      {
        content: "Create calc.test.js that tests all four calculator operations: add(2,3)=5, subtract(5,2)=3, multiply(3,4)=12, divide(10,2)=5. Run with: node calc.test.js. All tests must pass.",
        type: "user_defined",
        priority: 2,
        timeoutMinutes: 5,
        agentMode: "single"
      }
    ]
  });

  console.log(`Run created: ${run.id}`);
  console.log(`Working dir: ${run.workingDir}`);

  console.log("\n=== Starting self-evolution loop ===");
  await call("task.start", { runId: run.id });
  console.log("Execution started!\n");

  let attempts = 0;
  while (attempts < 120) {
    await new Promise(r => setTimeout(r, 5000));
    attempts++;

    try {
      const report = await call("run.report", { runId: run.id });
      const runStatus = report.run?.status;
      const completed = report.run?.totalTasksCompleted || 0;
      const cost = report.run?.totalCostUsd || 0;

      console.log(`[${new Date().toLocaleTimeString()}] Status: ${runStatus} | Done: ${completed} | Cost: $${cost.toFixed(4)}`);

      if (runStatus === "completed" || runStatus === "failed") {
        console.log("\n========================================");
        console.log("  FINAL RESULTS");
        console.log("========================================");
        console.log(`Status: ${runStatus}`);
        console.log(`Tasks completed: ${completed}`);
        console.log(`Total cost: $${cost.toFixed(4)}`);

        if (report.run?.finalReport) {
          console.log(`\nFinal Report:\n${report.run.finalReport}`);
        }

        const commits = await call("run.commits", { runId: run.id });
        console.log(`\nGit Commits (${commits.length}):`);
        for (const c of commits) {
          console.log(`  ${c.hash?.substring(0, 7)} ${c.isAiCommit ? "[AI]" : "       "} ${c.message}`);
        }

        const lessons = await call("run.lessons", { runId: run.id });
        if (lessons.length > 0) {
          console.log(`\nLessons (${lessons.length}):`);
          for (const l of lessons) {
            console.log(`  [${l.category}] ${l.lesson}`);
          }
        }

        // Verify files
        const { execSync } = await import("child_process");
        console.log("\n=== File Verification ===");
        try {
          const files = execSync("ls -la /tmp/ai-workbench-test/*.js", { encoding: "utf-8" });
          console.log(files);
        } catch { console.log("No .js files found"); }

        try {
          const testOut = execSync("cd /tmp/ai-workbench-test && node calc.test.js 2>&1", { encoding: "utf-8" });
          console.log(`Test output:\n${testOut}`);
        } catch (e) {
          console.log(`Test failed: ${e.message}`);
        }

        try {
          const gitLog = execSync("cd /tmp/ai-workbench-test && git log --oneline", { encoding: "utf-8" });
          console.log(`Git log:\n${gitLog}`);
        } catch {}

        break;
      }
    } catch (err) {
      console.log(`Poll error: ${err.message}`);
    }
  }

  ws.close();
  process.exit(0);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
