import { test, expect } from "@playwright/test";

test.describe("UI 响应性", () => {
  test("页面加载性能", async ({ page }) => {
    const start = Date.now();
    await page.goto("/#/");
    await expect(page.getByText("我的任务")).toBeVisible();
    const loadTime = Date.now() - start;
    expect(loadTime).toBeLessThan(5000);
  });

  test("控制台无严重错误", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/#/");
    await page.waitForTimeout(2000);
    const criticalErrors = errors.filter(
      (e) => !e.includes("WebSocket") && !e.includes("net::ERR")
    );
    expect(criticalErrors).toEqual([]);
  });

  test("移动端视图显示汉堡菜单", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/#/");
    const menuBtn = page.locator('button:has(svg)').first();
    await expect(menuBtn).toBeVisible();
  });

  test("桌面端视图显示侧边栏", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/#/");
    await expect(page.getByText("首页")).toBeVisible();
    await expect(page.getByText("创建任务")).toBeVisible();
    await expect(page.getByText("设置")).toBeVisible();
  });

  test("导入模态框可打开关闭", async ({ page }) => {
    await page.goto("/#/");
    const importBtn = page.getByText("导入");
    await importBtn.click();
    await expect(page.getByText(/粘贴.*链接/)).toBeVisible();
    const cancelBtn = page.getByText("取消");
    await cancelBtn.click();
    await expect(page.getByText(/粘贴.*链接/)).not.toBeVisible();
  });
});
