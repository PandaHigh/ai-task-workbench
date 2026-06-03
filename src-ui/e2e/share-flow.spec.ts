import { test, expect } from "@playwright/test";

const ENGINE_WS = "ws://localhost:9731";

test.describe("分享和导入流程", () => {
  let runId: string;
  let shareToken: string;

  test.beforeAll(async () => {
    const ws = new WebSocket(ENGINE_WS);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("WS connect failed"));
      setTimeout(() => reject(new Error("WS connect timeout")), 5000);
    });

    const rpc = (id: number, method: string, params: Record<string, unknown>) =>
      new Promise<any>((resolve, reject) => {
        const handler = (event: any) => {
          const msg = JSON.parse(event.data as string);
          if (msg.id === id) {
            ws.removeEventListener("message", handler);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          }
        };
        ws.addEventListener("message", handler);
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });

    // Create run
    const run = await rpc(1, "run.create", {
      goals: ["E2E分享测试目标"],
      terminationConditions: ["所有任务完成"],
      workingDir: process.cwd(),
    });
    runId = run.id;

    // Add a task
    await rpc(2, "task.create", {
      runId,
      content: "E2E分享测试任务",
      type: "user_defined",
      priority: 3,
    });

    // Create share token
    const share = await rpc(3, "share.create", { runId });
    shareToken = share.token;

    ws.close();
  });

  test("分享页面正确加载并显示 EvolutionDashboard 布局", async ({ page }) => {
    await page.goto(`/#/share/${shareToken}`);
    await page.waitForTimeout(3000);

    // Should show the run goal
    await expect(page.getByText("E2E分享测试目标")).toBeVisible({ timeout: 10000 });

    // Should show the task queue header "待办"
    await expect(page.getByRole("heading", { name: /待办/ })).toBeVisible();

    // Should show the test task
    await expect(page.getByText("E2E分享测试任务")).toBeVisible();

    // Should show tab "记录"
    await expect(page.getByRole("tab", { name: /记录/ })).toBeVisible();

    // RobotMascot SVG visible
    const svgs = page.locator("svg");
    expect(await svgs.count()).toBeGreaterThan(0);

    // No owner-only controls: no 开始/停止/下载/分享 buttons
    for (const label of ["开始", "停止", "下载", "分享"]) {
      const btn = page.getByRole("button", { name: new RegExp(label) });
      await expect(btn).not.toBeVisible();
    }

    // No edit/remove buttons in task items
    for (const label of ["编辑", "移除"]) {
      const btn = page.getByRole("button", { name: label });
      await expect(btn).not.toBeVisible();
    }
  });

  test("分享页面详细/简单模式切换和 Tab 切换", async ({ page }) => {
    await page.goto(`/#/share/${shareToken}`);
    await page.waitForTimeout(3000);

    await expect(page.getByText("E2E分享测试目标")).toBeVisible({ timeout: 10000 });

    // Switch to detailed mode
    const detailedBtn = page.getByRole("button", { name: "详细" });
    if (await detailedBtn.isVisible()) {
      await detailedBtn.click();
      await page.waitForTimeout(500);

      // Should now show 保存 and 经验 tabs
      await expect(page.getByRole("tab", { name: /保存/ })).toBeVisible();
      await expect(page.getByRole("tab", { name: /经验/ })).toBeVisible();

      // Click 经验 tab
      await page.getByRole("tab", { name: /经验/ }).click();
      await page.waitForTimeout(300);

      // Switch back to simple mode
      await page.getByRole("button", { name: "简单" }).click();
    }
  });

  test("分享页面 WebSocket 连接指示器", async ({ page }) => {
    await page.goto(`/#/share/${shareToken}`);
    await page.waitForTimeout(3000);

    // Should show connection indicator in header
    const indicator = page.getByText("实时").or(page.getByText("轮询中"));
    await expect(indicator.first()).toBeVisible({ timeout: 10000 });
  });

  test("无效的分享 token 显示错误页面", async ({ page }) => {
    await page.goto("/#/share/invalid-token-12345");
    await page.waitForTimeout(3000);

    // Should show error state (加载失败 or 已过期)
    const errorText = page.getByText("加载失败").or(page.getByText("已过期"));
    await expect(errorText).toBeVisible({ timeout: 10000 });
  });

  test("分享页面统计面板只读显示", async ({ page }) => {
    await page.goto(`/#/share/${shareToken}`);
    await page.waitForTimeout(3000);

    await expect(page.getByText("E2E分享测试目标")).toBeVisible({ timeout: 10000 });

    // Stats section
    await expect(page.getByText("概况")).toBeVisible();
    await expect(page.getByRole("heading", { name: "目标" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "完成标准" })).toBeVisible();

    // Goals show content read-only (no edit button for goals)
    await expect(page.getByText("E2E分享测试目标")).toBeVisible();
    await expect(page.getByText("所有任务完成")).toBeVisible();
  });

  test("导入分享链接", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);

    // Click import button
    const importBtn = page.getByRole("button", { name: "导入" });
    await expect(importBtn).toBeVisible();
    await importBtn.click();
    await page.waitForTimeout(500);

    // Should show import modal
    await expect(page.getByText("导入任务")).toBeVisible();
    await expect(page.getByText("粘贴别人分享给你的链接")).toBeVisible();

    // Fill share URL (API format)
    const input = page.getByPlaceholder("粘贴分享链接...");
    await expect(input).toBeVisible();
    await input.fill(`http://localhost:9731/api/share/${shareToken}`);

    // Click import
    const submitBtn = page.locator('[role="dialog"] button').getByText("导入");
    await submitBtn.click();
    await page.waitForTimeout(3000);

    // Modal should close
    await expect(page.getByText("粘贴别人分享给你的链接")).not.toBeVisible({ timeout: 5000 });
  });

  test("移动端分享页面显示抽屉切换", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();

    await page.goto(`/#/share/${shareToken}`);
    await page.waitForTimeout(3000);

    await expect(page.getByText("E2E分享测试目标")).toBeVisible({ timeout: 10000 });

    // Mobile drawer toggle buttons visible
    const queueToggle = page.getByRole("button", { name: /待办/ });
    const panelToggle = page.getByRole("button", { name: /操作/ });

    if (await queueToggle.first().isVisible()) {
      await queueToggle.first().click();
      await page.waitForTimeout(500);
      await expect(page.getByText("E2E分享测试任务")).toBeVisible({ timeout: 3000 });
    }

    if (await panelToggle.first().isVisible()) {
      await panelToggle.first().click();
      await page.waitForTimeout(500);
      await expect(page.getByText("概况")).toBeVisible({ timeout: 3000 });
    }

    await ctx.close();
  });
});
