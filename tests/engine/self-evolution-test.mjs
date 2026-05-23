import { WebSocket } from "ws";
import { execSync } from "child_process";

const ENGINE_URL = "ws://localhost:9731";
const PROJECT_DIR = "/tmp/ai-workbench-self-evolve";
let ws, requestId = 0;
const pending = new Map();

function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(ENGINE_URL);
    ws.on("open", () => resolve());
    ws.on("error", reject);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
      if (msg.method && !msg.id) {
        const p = msg.params || {};
        if (msg.method === "log.entry") {
          const src = p.source || "?";
          const lvl = p.level || "info";
          const msgText = (p.message || "").substring(0, 120);
          console.log(`  [${src}] ${lvl}: ${msgText}`);
        } else if (msg.method === "task.scored") {
          const s = p.score || {};
          console.log(`  ★ Score: ${(s.overall * 100).toFixed(0)}% ${s.passed ? "PASS ✓" : "FAIL ✗"}`);
        } else if (msg.method === "git.commit") {
          console.log(`  ⊕ Commit: ${(p.hash || "").substring(0, 7)} #AI commit#`);
        } else if (msg.method === "run.status") {
          console.log(`  ⟳ Run: ${p.status}`);
        }
      }
    });
  });
}

function call(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("Timeout")); } }, 600000);
  });
}

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   AI Task Workbench — 自我进化终极验收测试                  ║");
  console.log("║   目标: 工具台复制自身项目并让 AI 自主改进代码              ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log("Connecting...");
  await connect();
  console.log("Connected to engine\n");

  console.log("═════════════════════════════════════════════");
  console.log("  Phase 1: Creating Self-Evolution Run");
  console.log("═════════════════════════════════════════════\n");

  const run = await call("run.create", {
    workingDir: PROJECT_DIR,
    goals: [
      "Add a health-check HTTP endpoint to the engine (src-engine/src/index.ts) that returns {status: 'ok', uptime: <seconds>} when receiving a GET /health request",
      "Add input validation to Store constructor: if customDataDir is provided and not a valid directory path, throw a descriptive error",
      "Create a shared utility file (shared/src/utils.ts) with a formatDuration(ms: number): string function and export it from shared/src/index.ts"
    ],
    terminationConditions: [
      "Engine has a /health endpoint accessible via HTTP GET that returns JSON with status and uptime",
      "Store constructor validates customDataDir parameter",
      "shared/src/utils.ts exists with formatDuration function and is exported from shared/src/index.ts",
      "All existing tests still pass (npx vitest run in src-engine)"
    ],
    tasks: [
      {
        content: "Add a health-check HTTP endpoint to the engine. In src-engine/src/index.ts, create a basic HTTP server (using Node's http module) on port 9732 that responds to GET /health with JSON {status:'ok',uptime:<seconds>}. Start it alongside the WebSocket server. Do NOT modify the existing WebSocket server code.",
        type: "user_defined",
        priority: 1,
        timeoutMinutes: 8,
        agentMode: "single"
      },
      {
        content: "Add input validation to Store constructor in src-engine/src/db/store.ts. If a customDataDir is provided: check it's a non-empty string. If validation fails, throw new Error('Invalid data directory path: ...'). Keep all existing behavior unchanged. Do NOT break existing tests.",
        type: "user_defined",
        priority: 2,
        timeoutMinutes: 5,
        agentMode: "single"
      },
      {
        content: "Create shared/src/utils.ts with a formatDuration function: takes ms (number), returns a human-readable string like '2h 30m', '15m 42s', or '8s'. Then add 'export * from ./utils.js' to shared/src/index.ts. Do NOT modify any other files.",
        type: "user_defined",
        priority: 3,
        timeoutMinutes: 5,
        agentMode: "single"
      }
    ]
  });

  console.log(`Run ID: ${run.id}`);
  console.log(`Project: ${PROJECT_DIR}`);
  console.log(`Goals: 3`);
  console.log(`Initial tasks: 3\n`);

  // Show initial state
  console.log("═════════════════════════════════════════════");
  console.log("  Initial Git State");
  console.log("═════════════════════════════════════════════");
  try {
    const gitLog = execSync(`cd ${PROJECT_DIR} && git log --oneline`, { encoding: "utf-8" });
    console.log(gitLog.trim());
  } catch {}
  console.log();

  console.log("═════════════════════════════════════════════");
  console.log("  Phase 2: Starting Self-Evolution Loop");
  console.log("═════════════════════════════════════════════\n");

  const startTime = Date.now();
  await call("task.start", { runId: run.id });
  console.log("Evolution loop started!\n");

  // Poll until done
  let attempts = 0;
  while (attempts < 180) { // 15 minutes max
    await new Promise(r => setTimeout(r, 5000));
    attempts++;

    try {
      const report = await call("run.report", { runId: run.id });
      const r = report.run;
      const status = r?.status;
      const completed = r?.totalTasksCompleted || 0;
      const cost = r?.totalCostUsd || 0;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

      // Compact progress line
      if (attempts % 3 === 0) {
        console.log(`  [${elapsed}s] Status: ${status} | Done: ${completed} | Cost: $${cost.toFixed(4)}`);
      }

      if (status === "completed" || status === "failed") {
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);

        console.log("\n╔════════════════════════════════════════════════════════════╗");
        console.log("║   SELF-EVOLUTION FINAL RESULTS                            ║");
        console.log("╚════════════════════════════════════════════════════════════╝\n");

        console.log(`Status: ${status}`);
        console.log(`Total time: ${totalTime}s`);
        console.log(`Tasks completed: ${completed}`);
        console.log(`Total cost: $${cost.toFixed(4)}`);

        if (r?.finalReport) {
          console.log(`\n── AI Generated Report ──\n${r.finalReport}\n`);
        }

        // Commits
        const commits = await call("run.commits", { runId: run.id });
        console.log(`── Git Commits (${commits.length}) ──`);
        for (const c of commits) {
          console.log(`  ${(c.hash || "").substring(0, 7)} ${c.isAiCommit ? "[AI]" : "     "} ${c.message}`);
        }

        // Lessons
        const lessons = await call("run.lessons", { runId: run.id });
        if (lessons.length > 0) {
          console.log(`\n── Lessons Learned (${lessons.length}) ──`);
          for (const l of lessons) {
            console.log(`  [${l.category}] ${l.lesson}`);
          }
        }

        // File verification
        console.log("\n═════════════════════════════════════════════");
        console.log("  Phase 3: Verification");
        console.log("═════════════════════════════════════════════\n");

        // Goal 1: Health endpoint
        console.log("Goal 1: Health-check endpoint");
        try {
          const healthCode = execSync(`cat ${PROJECT_DIR}/src-engine/src/index.ts`, { encoding: "utf-8" });
          if (healthCode.includes("health") && (healthCode.includes("createServer") || healthCode.includes("9732"))) {
            console.log("  ✓ Health endpoint code found in index.ts");
          } else {
            console.log("  ✗ Health endpoint NOT found");
          }
        } catch (e) { console.log(`  ✗ Error: ${e.message}`); }

        // Goal 2: Store validation
        console.log("\nGoal 2: Store constructor validation");
        try {
          const storeCode = execSync(`cat ${PROJECT_DIR}/src-engine/src/db/store.ts`, { encoding: "utf-8" });
          if (storeCode.includes("customDataDir") && storeCode.includes("throw")) {
            console.log("  ✓ Store validation found");
          } else {
            console.log("  ✗ Store validation NOT found");
          }
        } catch (e) { console.log(`  ✗ Error: ${e.message}`); }

        // Goal 3: Shared utils
        console.log("\nGoal 3: Shared utils.ts with formatDuration");
        try {
          const utilsExists = execSync(`test -f ${PROJECT_DIR}/shared/src/utils.ts && echo "yes"`, { encoding: "utf-8" }).trim();
          if (utilsExists === "yes") {
            const utilsCode = execSync(`cat ${PROJECT_DIR}/shared/src/utils.ts`, { encoding: "utf-8" });
            if (utilsCode.includes("formatDuration")) {
              console.log("  ✓ shared/src/utils.ts exists with formatDuration");
            } else {
              console.log("  ✗ utils.ts exists but missing formatDuration");
            }
          } else {
            console.log("  ✗ shared/src/utils.ts NOT found");
          }
        } catch { console.log("  ✗ shared/src/utils.ts NOT found"); }

        // Git diff summary
        console.log("\n── Changes Summary ──");
        try {
          const diffStat = execSync(`cd ${PROJECT_DIR} && git diff --stat HEAD~${commits.length}..HEAD 2>/dev/null || git diff --stat --cached`, { encoding: "utf-8" });
          console.log(diffStat.trim());
        } catch {}

        console.log("\n── Final Git Log ──");
        try {
          const finalLog = execSync(`cd ${PROJECT_DIR} && git log --oneline`, { encoding: "utf-8" });
          console.log(finalLog.trim());
        } catch {}

        console.log("\n╔════════════════════════════════════════════════════════════╗");
        if (status === "completed" && completed >= 2) {
          console.log("║   ★ 自我进化验收: 通过 ★                                   ║");
          console.log("║   工具台成功复制并自主改进了自身项目代码                    ║");
        } else {
          console.log("║   自我进化验收: 部分通过 (需人工复核)                      ║");
        }
        console.log("╚════════════════════════════════════════════════════════════╝\n");

        break;
      }
    } catch (err) {
      console.log(`  Poll error: ${err.message}`);
    }
  }

  ws.close();
  process.exit(0);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
