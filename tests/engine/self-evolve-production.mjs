import { WebSocket } from "ws";

const ENGINE_URL = "ws://localhost:9731";
const PROJECT_DIR = "/Users/zhanxinlong/code/ai-task-workbench";
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
          const m = (p.message || "").substring(0, 140);
          const lvl = p.level === "error" ? "ERR" : p.level === "warn" ? "WRN" : "INF";
          console.log(`  [${src} ${lvl}] ${m}`);
        } else if (msg.method === "task.scored") {
          const s = p.score || {};
          console.log(`  ★ Score: ${(s.overall * 100).toFixed(0)}% ${s.passed ? "PASS" : "FAIL"}`);
        } else if (msg.method === "git.commit") {
          console.log(`  ⊕ Git: ${(p.hash || "").substring(0, 7)} #AI commit#`);
        } else if (msg.method === "run.status") {
          console.log(`  ⟳ ${p.status}`);
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
  console.log("║  AI Task Workbench — 自我进化: UI美化 + 健壮性提升          ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  await connect();
  console.log("Connected\n");

  const run = await call("run.create", {
    workingDir: PROJECT_DIR,
    goals: [
      "Improve the dark theme CSS in src-ui/src/styles/global.css: add smooth scrollbar styling, selection color, focus-visible outlines, subtle gradient backgrounds for cards, and polished transition animations for hover states",
      "Upgrade the TaskCard component (src-ui/src/components/dashboard/TaskCard.tsx) with better visual design: add a subtle left border color based on status, show goal tags as pills, add a progress bar indicator, improve spacing and typography",
      "Improve the EvolutionDashboard (src-ui/src/components/evolution/EvolutionDashboard.tsx): add a pulsing animation for the active task in the queue, color-code log levels with distinct backgrounds, add tab icons, show a cost sparkline or progress bar in the stats panel",
      "Add a toast/notification system: create src-ui/src/components/Toast.tsx that shows transient success/error notifications (bottom-right, auto-dismiss 3s). Wire it into useNotifications to show toast on task.scored and git.commit events"
    ],
    terminationConditions: [
      "global.css has smooth scrollbar, selection color, focus-visible styles, and gradient backgrounds",
      "TaskCard has status-colored left border, goal pills, and progress indicator",
      "EvolutionDashboard has pulsing active task, colored log backgrounds, and tab icons",
      "Toast.tsx exists and shows notifications for scoring and commit events"
    ],
    tasks: [
      {
        content: "Improve global.css (src-ui/src/styles/global.css): Add these CSS enhancements ONLY (do not remove existing styles):\n1. Custom scrollbar: thin 6px track, rounded thumb with var(--blue)\n2. ::selection styling with blue background\n3. :focus-visible outline: 2px solid var(--blue) offset 2px\n4. Card hover effect: transform translateY(-1px) with box-shadow\n5. .glass-card class: semi-transparent background with backdrop-blur\n6. Smooth transitions on all interactive elements (0.2s ease)\n7. @keyframes slideIn for toast animations\n8. @keyframes pulse-glow for active task indicators",
        type: "user_defined",
        priority: 1,
        timeoutMinutes: 8,
        agentMode: "single"
      },
      {
        content: "Redesign TaskCard (src-ui/src/components/dashboard/TaskCard.tsx). Keep all existing props and click behavior. Add these visual improvements:\n1. Left border (3px solid) colored by status (idle: gray, running: blue, completed: green, failed: red)\n2. Goals shown as small pills/tags instead of plain text (max 2 shown + '+N more')\n3. A thin progress bar at the bottom showing completedTasks/goals ratio\n4. Better spacing: larger title, more padding, subtle border-radius\n5. Hover: slight lift animation (translateY -2px) and enhanced shadow\n6. Show working directory with a folder icon prefix\n7. Cost display with a dollar sign icon\nDo NOT break the existing navigation or delete button.",
        type: "user_defined",
        priority: 2,
        timeoutMinutes: 8,
        agentMode: "single"
      },
      {
        content: "Enhance EvolutionDashboard (src-ui/src/components/evolution/EvolutionDashboard.tsx). Keep all existing functionality. Add:\n1. Active task in queue: add a CSS pulsing border animation (use the pulse-glow keyframe from global.css)\n2. Log entries: add a subtle left border colored by level (error=red bg tint, warn=yellow bg tint, info=transparent)\n3. Tab buttons: add emoji icons before text (logs=📋, commits=🔀, lessons=💡)\n4. Stats panel: add a visual cost bar (width proportional to $50 budget)\n5. Add a 'Download Report' button next to the final report that copies text to clipboard\nDo NOT break existing queue reordering or tab switching.",
        type: "user_defined",
        priority: 3,
        timeoutMinutes: 8,
        agentMode: "single"
      },
      {
        content: "Create a Toast notification system:\n1. Create new file src-ui/src/components/Toast.tsx:\n   - A fixed bottom-right container that stacks toast notifications\n   - Each toast: icon + message + auto-dismiss after 3s with slide-out animation\n   - Types: success (green), error (red), info (blue)\n   - Use the slideIn keyframe from global.css\n2. Create src-ui/src/hooks/useToast.ts:\n   - Zustand store with addToast(message, type) and toasts array\n   - Auto-remove after 3s using setTimeout\n3. In src-ui/src/hooks/useNotifications.ts:\n   - On 'task.scored': show toast 'Task scored XX% - PASS' or 'Task scored XX% - FAIL'\n   - On 'git.commit': show toast 'Committed: <hash>'\n4. Add <Toast /> component to App.tsx (inside AppShell)\nDo NOT modify any engine code. Only create/modify frontend files.",
        type: "user_defined",
        priority: 4,
        timeoutMinutes: 10,
        agentMode: "single"
      }
    ]
  });

  console.log(`Run: ${run.id}`);
  console.log(`Goals: 4 | Tasks: 4\n`);

  console.log("═══════════ Evolution Starting ═══════════\n");
  const start = Date.now();
  await call("task.start", { runId: run.id });

  let attempts = 0;
  while (attempts < 240) {
    await new Promise(r => setTimeout(r, 5000));
    attempts++;
    try {
      const report = await call("run.report", { runId: run.id });
      const r = report.run;
      if (attempts % 6 === 0) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        console.log(`  [${elapsed}s] ${r?.status} | Done: ${r?.totalTasksCompleted} | $${(r?.totalCostUsd || 0).toFixed(4)}`);
      }
      if (r?.status === "completed" || r?.status === "failed") {
        const total = ((Date.now() - start) / 1000).toFixed(0);
        console.log(`\n═══════════ Evolution Complete ═══════════`);
        console.log(`Status: ${r.status} | Time: ${total}s | Done: ${r.totalTasksCompleted} | Cost: $${r.totalCostUsd.toFixed(4)}`);
        if (r.finalReport) console.log(`\n${r.finalReport}`);
        const commits = await call("run.commits", { runId: run.id });
        console.log(`\nCommits (${commits.length}):`);
        for (const c of commits) console.log(`  ${(c.hash||"").substring(0,7)} ${c.isAiCommit?"[AI]":""} ${c.message}`);
        const lessons = await call("run.lessons", { runId: run.id });
        if (lessons.length) { console.log(`\nLessons (${lessons.length}):`); for (const l of lessons) console.log(`  [${l.category}] ${l.lesson}`); }
        break;
      }
    } catch (e) { console.log(`  poll err: ${e.message}`); }
  }

  ws.close();
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
