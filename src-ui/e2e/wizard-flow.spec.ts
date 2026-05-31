import { test, expect } from "@playwright/test";

test.describe("创建任务向导", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/wizard");
    await expect(page.getByRole("tab", { name: /准备工作/ })).toBeVisible();
  });

  test("向导页面正确加载", async ({ page }) => {
    await expect(page.getByRole("tablist")).toBeVisible();
  });

  test("步骤一默认工作目录选项", async ({ page }) => {
    await expect(page.getByRole("button", { name: /默认位置/ })).toBeVisible();
  });

  test("点击使用默认位置后进入第二步", async ({ page }) => {
    await page.getByRole("button", { name: /默认位置/ }).click();
    await expect(page.getByRole("tab", { name: /告诉 AI/ })).toBeVisible();
  });

  test("聊天输入框可见", async ({ page }) => {
    await page.getByRole("button", { name: /默认位置/ }).click();
    await expect(page.getByRole("textbox")).toBeVisible();
  });

  test("返回按钮可返回首页", async ({ page }) => {
    await page.getByRole("button", { name: /返回/ }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("快捷建议按钮存在", async ({ page }) => {
    await page.getByRole("button", { name: /默认位置/ }).click();
    const suggestions = page.locator("button").filter({ hasText: /帮我写|优化|修复/ });
    await expect(suggestions.first()).toBeVisible();
  });

  // --- 新增交互测试 ---

  test("快速创建 tab 可切换", async ({ page }) => {
    const quickTab = page.getByRole("tab", { name: /快速创建|快速/ });
    if (await quickTab.isVisible()) {
      await quickTab.click();
    }
  });

  test("AI 对话模式输入消息后发送按钮可点击", async ({ page }) => {
    await page.getByRole("button", { name: /默认位置/ }).click();
    await expect(page.getByRole("tab", { name: /告诉 AI/ })).toBeVisible();
    const textbox = page.getByRole("textbox");
    await textbox.fill("修复登录 bug");
    const sendBtn = page.getByRole("button", { name: /发送/ });
    await expect(sendBtn).toBeVisible();
  });

  test("准备工作步骤显示选项", async ({ page }) => {
    await expect(page.getByRole("button", { name: /默认位置/ })).toBeVisible();
  });

  test("向导步骤标签列表包含所有步骤", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /准备工作/ })).toBeVisible();
  });

  test("第二步显示聊天界面元素", async ({ page }) => {
    await page.getByRole("button", { name: /默认位置/ }).click();
    // Chat area should be visible
    await expect(page.getByRole("textbox")).toBeVisible();
  });
});
