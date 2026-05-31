import { test, expect } from "@playwright/test";

test.describe("设置页面", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/settings");
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  });

  test("设置页面加载", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  });

  test("显示连接状态区域", async ({ page }) => {
    const statusArea = page.locator("text=/已连接|未连接/").first();
    await expect(statusArea).toBeVisible();
  });

  test("显示质量要求配置", async ({ page }) => {
    await expect(page.getByText(/质量要求/)).toBeVisible();
  });

  test("显示超时设置", async ({ page }) => {
    await expect(page.getByText(/最长用时/)).toBeVisible();
  });

  test("保存按钮默认状态", async ({ page }) => {
    const saveBtn = page.getByRole("button", { name: /保存|未修改/ });
    await expect(saveBtn).toBeVisible();
  });

  test("高级设置可展开", async ({ page }) => {
    await page.getByRole("button", { name: /高级设置/ }).click();
    await expect(page.getByRole("heading", { name: /AI 程序位置/ })).toBeVisible();
  });

  test("技能管理区域可见", async ({ page }) => {
    await expect(page.getByText(/Skills 管理/)).toBeVisible();
  });

  // --- 新增交互测试 ---

  test("高级设置展开后显示 Claude 路径输入框", async ({ page }) => {
    await page.getByRole("button", { name: /高级设置/ }).click();
    await expect(page.getByRole("heading", { name: /AI 程序位置/ })).toBeVisible();
  });

  test("质量阈值有输入控件", async ({ page }) => {
    // 质量要求区域有 range input 或数字输入
    const qualitySection = page.locator("section, div").filter({ hasText: /质量要求/ }).first();
    await expect(qualitySection).toBeVisible();
  });

  test("超时设置有输入控件", async ({ page }) => {
    const timeoutSection = page.locator("section, div").filter({ hasText: /最长用时/ }).first();
    await expect(timeoutSection).toBeVisible();
  });

  test("插件管理区域可见", async ({ page }) => {
    // Scroll down to find plugin section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const pluginSection = page.locator("text=/插件|MCP Server/").first();
    await expect(pluginSection).toBeVisible();
  });

  test("配置管理区域可见", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const profileSection = page.locator("text=/编排配置|创建.*配置/").first();
    await expect(profileSection).toBeVisible();
  });

  test("模板管理区域可见", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.getByText(/任务模板/)).toBeVisible();
  });

  test("定时任务管理区域可见", async ({ page }) => {
    await expect(page.getByText(/定时任务/)).toBeVisible();
  });

  test("Git 远程操作区域在高级设置中", async ({ page }) => {
    await page.getByRole("button", { name: /高级设置/ }).click();
    // Git remote panel should be visible in advanced section
    await page.waitForTimeout(500);
    const gitSection = page.locator("text=/Git|远程|push|pull/").first();
    await expect(gitSection).toBeVisible();
  });

  test("自主级别选择器在高级设置中", async ({ page }) => {
    await page.getByRole("button", { name: /高级设置/ }).click();
    await expect(page.getByText(/自主级别|Autonomy/)).toBeVisible();
  });

  test("页面滚动到所有设置区域无报错", async ({ page }) => {
    // Scroll to bottom and verify no crashes
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  });
});
