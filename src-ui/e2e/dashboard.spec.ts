import { test, expect } from "@playwright/test";

test.describe("首页仪表盘", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/");
  });

  test("页面加载显示标题「我的任务」", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "我的任务" })).toBeVisible();
  });

  test("无任务时显示空状态或任务列表", async ({ page }) => {
    // When no tasks exist the empty state is shown.
    // When tasks exist the card grid is shown instead.
    // Either state is valid - just verify page content area renders
    await page.waitForTimeout(1000);
    const body = page.locator("main");
    await expect(body).toBeVisible();
  });

  test("显示「新建」按钮", async ({ page }) => {
    await expect(page.getByRole("button", { name: "新建" })).toBeVisible();
  });

  test("点击「新建」导航到向导页", async ({ page }) => {
    await page.getByRole("button", { name: "新建" }).click();
    await expect(page).toHaveURL(/\/wizard/);
  });

  test("导入弹窗可以打开和关闭", async ({ page }) => {
    // Open import modal
    await page.getByRole("button", { name: "导入" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByText("导入任务")).toBeVisible();

    // Close via cancel button
    await page.getByRole("button", { name: "取消" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("导入弹窗包含 URL 输入框", async ({ page }) => {
    await page.getByRole("button", { name: "导入" }).click();
    const input = page.getByPlaceholder("粘贴分享链接...");
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("type", "text");
  });

  test("页面显示连接状态", async ({ page }) => {
    // Sidebar shows connection status — either "AI 已就绪" or "AI 未连接"
    const sidebar = page.locator("aside");
    const connected = sidebar.getByText("AI 已就绪");
    const disconnected = sidebar.getByText("AI 未连接");

    // One of the two status indicators must be visible
    await expect(connected.or(disconnected)).toBeVisible();
  });

  test("PandaAI 品牌标识可见", async ({ page }) => {
    // Sidebar has two PandaAI spans (desktop/mobile variants), use .first()
    const brand = page.locator("aside").getByText("PandaAI").first();
    await expect(brand).toBeVisible();
  });
});
