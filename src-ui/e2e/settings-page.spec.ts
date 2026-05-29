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
});
