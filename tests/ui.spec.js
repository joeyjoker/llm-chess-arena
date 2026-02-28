import { test, expect } from '@playwright/test';

test('首页可打开并显示关键模块', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('LLM Chess Arena')).toBeVisible();
  await expect(page.getByText('对局配置')).toBeVisible();
  await expect(page.locator('#board-grid')).toBeVisible();
  await expect(page.locator('#board-grid .square')).toHaveCount(64);
  await expect(page.getByText('着法记录')).toBeVisible();
});