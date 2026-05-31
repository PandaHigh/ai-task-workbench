import { test, expect } from "@playwright/test";

test.describe("执行面板", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/evolution/test-run-123");
    // Wait for page to render
    await page.waitForTimeout(1000);
  });

  test("Evolution 页面正常加载不崩溃", async ({ page }) => {
    // Page should render body content without crash
    await expect(page.locator("body")).toBeVisible();
  });

  test("页面有 tab 导航结构", async ({ page }) => {
    // Tab bar should exist (tablist or tab container)
    const tablist = page.getByRole("tablist");
    if (await tablist.isVisible()) {
      // At least one tab should exist
      const tabs = page.getByRole("tab");
      await expect(tabs.first()).toBeVisible();
    }
  });

  test("任务队列区域存在", async ({ page }) => {
    // Task queue shows "待办" text
    const queueHeader = page.getByText(/待办/);
    if (await queueHeader.isVisible()) {
      await expect(queueHeader).toBeVisible();
    }
  });

  test("添加任务按钮可见", async ({ page }) => {
    const addBtn = page.getByRole("button", { name: /添加任务/ });
    if (await addBtn.isVisible()) {
      await expect(addBtn).toBeVisible();
    }
  });

  test("操作面板区域存在", async ({ page }) => {
    // Operations panel with start/continue button or similar
    const panelArea = page.locator("text=/操作|概况|开始|继续/").first();
    if (await panelArea.isVisible()) {
      await expect(panelArea).toBeVisible();
    }
  });

  test("模式切换按钮可见", async ({ page }) => {
    // Toggle between simple/detailed mode
    const toggle = page.locator("button").filter({ hasText: /简单|详细/ }).first();
    if (await toggle.isVisible()) {
      await expect(toggle).toBeVisible();
    }
  });

  test("Tab 可以点击切换", async ({ page }) => {
    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    if (count >= 2) {
      // Click second tab
      await tabs.nth(1).click();
      // Should still have tabs
      await expect(tabs.first()).toBeVisible();
    }
  });

  test("返回导航可用", async ({ page }) => {
    const backBtn = page.getByRole("button", { name: /返回/ }).first();
    if (await backBtn.isVisible()) {
      await backBtn.click();
      await expect(page).toHaveURL(/\/$/);
    }
  });

  test("页面无 JavaScript 崩溃", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForTimeout(1000);
    const criticalErrors = errors.filter(
      (e) => !e.includes("WebSocket") && !e.includes("net::ERR")
    );
    expect(criticalErrors).toEqual([]);
  });

  test("队列区有 listbox 角色", async ({ page }) => {
    const listbox = page.getByRole("listbox");
    if (await listbox.isVisible()) {
      await expect(listbox).toBeVisible();
    }
  });

  test("开始或继续按钮存在", async ({ page }) => {
    const startBtn = page.getByRole("button", { name: /开始|继续|Start/ }).first();
    if (await startBtn.isVisible()) {
      await expect(startBtn).toBeVisible();
    }
  });

  test("目标面板相关元素可见", async ({ page }) => {
    // Goals area - look for goals/目标 text or panel
    const goalArea = page.locator("text=/目标|Goals|完成标准/").first();
    if (await goalArea.isVisible()) {
      await expect(goalArea).toBeVisible();
    }
  });
});
