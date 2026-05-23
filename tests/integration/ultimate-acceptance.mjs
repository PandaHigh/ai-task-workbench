#!/usr/bin/env node
/**
 * Ultimate Acceptance Test — Self-Evolution
 *
 * Copies the project itself, starts the engine, creates a run with
 * improvement goals, and verifies the self-evolution loop completes
 * with at least one successful git commit.
 *
 * Usage: node tests/integration/ultimate-acceptance.mjs
 */

import { execSync } from "child_process";
import { mkdirSync, cpSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TARGET = join(tmpdir(), "ai-workbench-self-evolve-acceptance");
const ENGINE_URL = "ws://localhost:9731";

// Step 0: Prepare — copy project
console.log("[acceptance] Preparing target directory...");
if (existsSync(TARGET)) rmSync(TARGET, { recursive: true });
mkdirSync(TARGET, { recursive: true });

// Copy source files only (no node_modules, no target)
execSync(
  `rsync -a --exclude='node_modules' --exclude='target' --exclude='.git' --exclude='dist' ` +
  `"${import.meta.dirname}/../../" "${TARGET}/"`,
  { stdio: "inherit" }
);

// Init git repo
execSync(`git init && git add -A && git commit -m "initial"`, { cwd: TARGET, stdio: "pipe" });

console.log(`[acceptance] Target: ${TARGET}`);

// Step 1: Start engine in background
console.log("[acceptance] Starting engine...");
const engineProc = execSync(
  `cd "${join(TARGET, "src-engine")}" && npx tsx src/index.ts &`,
  { stdio: "pipe", detached: true, timeout: 120000 }
).toString();

// Wait for engine to start
await new Promise((r) => setTimeout(r, 3000));

// Step 2: Create run via WebSocket
console.log("[acceptance] Creating self-evolution run...");

const WebSocket = (await import("ws")).default;

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(ENGINE_URL);
    ws.on("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id) {
        resolve(msg.result || msg.error);
        ws.close();
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("timeout")), 10000);
  });
}

// Create run with improvement goals
const run = await rpcCall("run.create", {
  workingDir: TARGET,
  goals: [
    "Add a health check endpoint that returns { status: 'ok' } to the engine",
    "Add input validation to the store's saveTask method — reject tasks without content",
  ],
  terminationConditions: [
    "Health check endpoint exists and returns correct JSON",
    "Store rejects tasks with empty content",
    "All changes are committed with #AI commit#",
  ],
  tasks: [
    { content: "Add health check RPC method that returns { status: 'ok' }", type: "user_defined", priority: 1 },
    { content: "Add validation to store.saveTask — reject empty content", type: "user_defined", priority: 2 },
  ],
});

console.log(`[acceptance] Run created: ${run.id}`);

// Step 3: Start execution
await rpcCall("task.start", { runId: run.id });
console.log("[acceptance] Evolution loop started. Monitoring...");

// Step 4: Monitor until completion or timeout (10 min)
const startTime = Date.now();
const MAX_WAIT = 10 * 60 * 1000;

let completed = false;
while (Date.now() - startTime < MAX_WAIT) {
  await new Promise((r) => setTimeout(r, 10000));

  const tasks = await rpcCall("run.tasks", { runId: run.id });
  const completedCount = (tasks || []).filter((t) => t.status === "completed" || t.status === "reverted").length;
  const total = (tasks || []).length;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);

  console.log(`[acceptance] ${elapsed}s | Tasks: ${completedCount}/${total} done`);

  const currentRun = await rpcCall("run.list", {});
  const thisRun = (currentRun || []).find((r) => r.id === run.id);
  if (thisRun && (thisRun.status === "completed" || thisRun.status === "failed")) {
    completed = true;
    console.log(`[acceptance] Run finished: ${thisRun.status}`);
    break;
  }
}

// Step 5: Verify results
console.log("\n[acceptance] === VERIFICATION ===");

const commits = await rpcCall("run.commits", { runId: run.id });
const lessons = await rpcCall("run.lessons", { runId: run.id });
const tasks = await rpcCall("run.tasks", { runId: run.id });

const aiCommits = (commits || []).filter((c) => c.isAiCommit);
const passed = (tasks || []).filter((t) => t.status === "completed");
const failed = (tasks || []).filter((t) => t.status === "reverted" || t.status === "failed");

console.log(`AI Commits: ${aiCommits.length}`);
console.log(`Passed tasks: ${passed.length}`);
console.log(`Failed/reverted: ${failed.length}`);
console.log(`Lessons learned: ${(lessons || []).length}`);

// Verify git log has #AI commit# entries
try {
  const gitLog = execSync("git log --oneline", { cwd: TARGET, encoding: "utf-8" });
  const aiCommitLines = gitLog.split("\n").filter((l) => l.includes("#AI commit#"));
  console.log(`\nGit #AI commit# entries: ${aiCommitLines.length}`);
  aiCommitLines.forEach((l) => console.log(`  ${l}`));
} catch {}

// Final verdict
const ACCEPTABLE = aiCommits.length >= 1;
console.log(`\n[acceptance] ${ACCEPTABLE ? "PASS ✓" : "FAIL ✗"}`);

// Cleanup
try {
  await rpcCall("run.stop", { runId: run.id });
} catch {}
process.exit(ACCEPTABLE ? 0 : 1);
