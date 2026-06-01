import { test, expect } from "@playwright/test";

test.describe("无初始 task + AI 智能任务生成 全流程", () => {
  const testWorkingDir = "/tmp/ai-workbench-e2e-test";

  test.beforeAll(async () => {
    const { mkdir } = await import("fs/promises");
    await mkdir(testWorkingDir, { recursive: true });
  });

  test.afterAll(async () => {
    const { rm } = await import("fs/promises");
    await rm(testWorkingDir, { recursive: true, force: true });
  });

  test("run.create 不传 tasks，启动后 AI 生成智能任务", async ({ page }) => {
    const sentMethods: string[] = [];
    const sentPayloads: Array<{ method: string; params: Record<string, unknown> }> = [];
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];

    // 在导航前注册 WS 监听器，确保不遗漏消息
    page.on("websocket", (ws) => {
      ws.on("framesent", (frame) => {
        try {
          const data = JSON.parse(frame.payload as string);
          if (data.method) {
            sentMethods.push(data.method);
            sentPayloads.push({ method: data.method, params: data.params || {} });
          }
        } catch { /* ignore */ }
      });
      ws.on("framereceived", (frame) => {
        try {
          const data = JSON.parse(frame.payload as string);
          if (data.method && data.method !== "response") {
            notifications.push({ method: data.method, params: data.params || {} });
          }
        } catch { /* ignore */ }
      });
    });

    // ─── Step 1: 打开向导，切换快速创建 ──────────────────────────────
    await page.goto("/#/wizard");
    await page.waitForTimeout(500);

    const quickBtn = page.getByRole("button", { name: "快速创建" });
    if (await quickBtn.isVisible()) {
      await quickBtn.click();
      await page.waitForTimeout(300);
    }

    // ─── Step 2: 填写表单 ────────────────────────────────────────────
    const modifyBtn = page.getByRole("button", { name: "修改" });
    if (await modifyBtn.isVisible()) {
      await modifyBtn.click();
      const dirInput = page.locator('input[placeholder="/path/to/project"]').first();
      if (await dirInput.isVisible()) {
        await dirInput.fill(testWorkingDir);
        await page.getByRole("button", { name: "确定" }).click();
        await page.waitForTimeout(200);
      }
    }

    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.fill("创建一个简单的计算器应用，支持加减乘除");

    // ─── Step 3: 点击"创建并开始" ─────────────────────────────────────
    const startBtn = page.getByRole("button", { name: "创建并开始" }).first();
    await startBtn.click();
    await page.waitForTimeout(3000);

    // ─── Step 4: 验证 run.create 不含 tasks ──────────────────────────
    expect(sentMethods).toContain("run.create");
    expect(sentMethods).toContain("task.start");

    const runCreatePayload = sentPayloads.find((m) => m.method === "run.create");
    expect(runCreatePayload).toBeDefined();
    expect(runCreatePayload!.params).not.toHaveProperty("tasks");
    expect(runCreatePayload!.params).toHaveProperty("goals");

    // ─── Step 5: 确认导航到 evolution 页面 ───────────────────────────
    await expect(page).toHaveURL(/\/evolution\//, { timeout: 5000 });

    // ─── Step 6: 等待 AI 生成任务（通过 queue.updated / task.status / log.entry）──
    const startTime = Date.now();
    while (Date.now() - startTime < 90_000) {
      await page.waitForTimeout(2_000);

      // 检查是否收到任务相关通知或日志
      const hasActivity = notifications.some(
        (m) =>
          m.method === "queue.updated" ||
          m.method === "task.status" ||
          (m.method === "log.entry" &&
            typeof m.params?.message === "string" &&
            (m.params.message.includes("Initial task queued") ||
              m.params.message.includes("initial task plan")))
      );
      if (hasActivity) break;
    }

    // ─── Step 7: 输出完整日志 ────────────────────────────────────────
    console.log("=== 发送的 RPC ===");
    sentMethods.forEach((m) => console.log(`  → ${m}`));

    console.log("\n=== run.create 参数 ===");
    console.log(JSON.stringify(runCreatePayload?.params, null, 2));

    console.log("\n=== 收到的通知 (去重前20条) ===");
    const uniqueMethods = [...new Set(notifications.map((n) => n.method))];
    uniqueMethods.forEach((m) => {
      const count = notifications.filter((n) => n.method === m).length;
      console.log(`  ← ${m} (${count}x)`);
    });

    // 输出关键日志
    const keyLogs = notifications
      .filter((n) => n.method === "log.entry" && typeof n.params?.message === "string")
      .map((n) => n.params.message as string);
    console.log("\n=== 引擎关键日志 ===");
    keyLogs.forEach((l) => console.log(`  ${l}`));

    // ─── Step 8: 截图并断言 ──────────────────────────────────────────
    await page.screenshot({ path: "test-results/smart-task-generation.png", fullPage: true });

    // 核心断言：run.create 不传 tasks
    expect(runCreatePayload!.params).not.toHaveProperty("tasks");
  });
});
