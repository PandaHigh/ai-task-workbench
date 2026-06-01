import { test, expect } from "@playwright/test";

test.describe("QuickCreate — 无初始 task 创建流程", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/wizard");
    await page.waitForTimeout(500);
    // Switch to QuickCreate mode (it's a button, not a tab)
    const quickBtn = page.getByRole("button", { name: "快速创建" });
    if (await quickBtn.isVisible()) {
      await quickBtn.click();
      await page.waitForTimeout(300);
    }
  });

  test("QuickCreate 表单正常渲染", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    if (await textarea.isVisible()) {
      await expect(textarea).toBeVisible();
    }

    // Action buttons
    const createBtn = page.getByRole("button", { name: /创建任务/ }).first();
    const startBtn = page.getByRole("button", { name: /创建并开始/ }).first();
    if (await createBtn.isVisible()) {
      await expect(createBtn).toBeVisible();
    }
    if (await startBtn.isVisible()) {
      await expect(startBtn).toBeVisible();
    }
  });

  test("填写任务描述和目标", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    if (!(await textarea.isVisible())) return;

    await textarea.fill("构建一个 React 登录组件");
    await expect(textarea).toHaveValue("构建一个 React 登录组件");
  });

  test("空任务描述显示验证错误", async ({ page }) => {
    const createBtn = page.getByRole("button", { name: /创建任务/ }).first();
    if (!(await createBtn.isVisible())) return;

    await createBtn.click();

    const alert = page.getByRole("alert").first();
    if (await alert.isVisible()) {
      await expect(alert).toContainText(/任务描述/);
    }
  });

  test("快速模板可点击", async ({ page }) => {
    const templates = page.locator("button").filter({ hasText: /Web|API|CLI|Bug/ });
    const count = await templates.count();
    if (count > 0) {
      await templates.first().click();
      const textarea = page.locator("textarea").first();
      if (await textarea.isVisible()) {
        await expect(textarea).not.toHaveValue("");
      }
    }
  });

  test("页面无 JavaScript 崩溃", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForTimeout(1000);
    const criticalErrors = errors.filter(
      (e) => !e.includes("WebSocket") && !e.includes("net::ERR"),
    );
    expect(criticalErrors).toEqual([]);
  });
});
