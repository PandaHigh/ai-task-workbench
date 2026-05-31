import { test, expect } from "@playwright/test";

test.describe("错误处理与健壮性", () => {
  test("首页显示引擎连接状态指示器", async ({ page }) => {
    await page.goto("/#/");
    // Sidebar shows either "AI 未连接" or "AI 已就绪"
    const connectionStatus = page.getByText(/AI (未连接|已就绪)/).first();
    await expect(connectionStatus).toBeVisible();
    // Main content heading renders
    await expect(page.getByRole("heading", { name: "我的任务" })).toBeVisible();
    // Subtitle reflects connection state (either "AI 已就绪 · 共 N 个任务" or "AI 未连接")
    const subtitleStatus = page.getByText(/AI (未连接|已就绪)/).last();
    await expect(subtitleStatus).toBeVisible();
  });

  test("引擎未连接时设置页面正常加载", async ({ page }) => {
    await page.goto("/#/settings");
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
    // Settings page content still renders without engine
    await expect(page.getByRole("heading", { name: "质量要求" })).toBeVisible();
    await expect(page.getByText(/最长用时/)).toBeVisible();
  });

  test("引擎未连接时向导页面正常加载", async ({ page }) => {
    await page.goto("/#/wizard");
    // Wizard renders its step tabs without engine dependency
    await expect(page.getByRole("tab", { name: /准备工作/ })).toBeVisible();
    await expect(page.getByRole("tablist")).toBeVisible();
  });

  test("页面刷新后保持当前路由", async ({ page }) => {
    await page.goto("/#/settings");
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
    // Reload and verify route is preserved (HashRouter keeps route in URL)
    await page.reload();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
    await expect(page).toHaveURL(/\/settings/);
  });

  test("无效 runId 的 evolution 页面不崩溃", async ({ page }) => {
    await page.goto("/#/evolution/nonexistent-run-id-12345");
    // The page should render without crashing. When connected, the component
    // redirects to "/" for an unknown runId. When disconnected, it shows
    // skeletons. Either way the page must not throw an error.
    const pageBody = page.locator("body");
    await expect(pageBody).toBeVisible();

    // Verify the app rendered something meaningful - either we stayed on the
    // evolution page (disconnected: skeletons / header) or got redirected to
    // the home page (connected: run not found → navigate("/")).
    const heading = page.getByRole("heading", { name: /我的任务|任务详情/ });
    await expect(heading).toBeVisible({ timeout: 8000 });
  });

  test("无效路由显示 404 页面", async ({ page }) => {
    await page.goto("/#/this-route-does-not-exist-at-all");
    await expect(page.getByText("页面不存在")).toBeVisible();
    await expect(page.getByRole("button", { name: "返回首页" })).toBeVisible();
  });
});
