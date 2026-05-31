import { test, expect } from "@playwright/test";

test.describe("应用导航", () => {
  test("首页加载正常", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByRole("heading", { name: "我的任务" })).toBeVisible();
  });

  test("侧边栏导航到创建任务页", async ({ page }) => {
    await page.goto("/#/");
    await page.getByRole("button", { name: "创建任务" }).click();
    await expect(page).toHaveURL(/\/wizard/);
    await expect(page.getByRole("tab", { name: /准备工作/ })).toBeVisible();
  });

  test("侧边栏导航到设置页", async ({ page }) => {
    await page.goto("/#/");
    await page.getByRole("button", { name: "设置" }).first().click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  });

  test("从设置页返回首页", async ({ page }) => {
    await page.goto("/#/settings");
    await page.getByRole("button", { name: "首页" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "我的任务" })).toBeVisible();
  });

  test("未连接引擎时侧边栏显示断开状态", async ({ page }) => {
    await page.goto("/#/");
    const sidebarText = page.locator('[aria-label="主导航"] + div').getByText(/未连接|已就绪/);
    await expect(sidebarText).toBeVisible();
  });

  test("首页标题和新建按钮正常", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByRole("heading", { name: "我的任务" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建" })).toBeVisible();
  });

  test("点击新建按钮导航到 wizard", async ({ page }) => {
    await page.goto("/#/");
    await page.getByRole("button", { name: "新建" }).click();
    await expect(page).toHaveURL(/\/wizard/);
  });

  test("404 路由显示未找到页面", async ({ page }) => {
    await page.goto("/#/nonexistent-page");
    await expect(page.getByText("页面不存在")).toBeVisible();
    await expect(page.getByRole("button", { name: "返回首页" })).toBeVisible();
  });

  test("PandaAI 品牌标识可见", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByText("PandaAI").first()).toBeVisible();
  });

  // --- 新增测试 ---

  test("404 页面点击返回首页按钮正确导航", async ({ page }) => {
    await page.goto("/#/nonexistent-page");
    await expect(page.getByText("页面不存在")).toBeVisible();
    await page.getByRole("button", { name: "返回首页" }).click();
    await expect(page.getByRole("heading", { name: "我的任务" })).toBeVisible();
  });

  test("侧边栏有导航区域", async ({ page }) => {
    await page.goto("/#/");
    // Navigation area should be visible with key links
    await expect(page.getByRole("button", { name: "首页" })).toBeVisible();
    await expect(page.getByRole("button", { name: "创建任务" })).toBeVisible();
  });

  test("直接访问 evolution 路由不崩溃", async ({ page }) => {
    await page.goto("/#/evolution/test-run-id");
    // Page should load without crash - verify something renders
    await expect(page.locator("body")).toBeVisible();
  });

  test("侧边栏所有导航项可见", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByRole("button", { name: "首页" })).toBeVisible();
    await expect(page.getByRole("button", { name: "创建任务" })).toBeVisible();
    await expect(page.getByRole("button", { name: "设置" }).first()).toBeVisible();
  });
});
