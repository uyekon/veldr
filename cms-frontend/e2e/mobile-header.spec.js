import { test, expect } from '@playwright/test';

const notes = Array.from({ length: 40 }, (_, index) => ({
  id: index + 1,
  title: `移动端笔记 ${index + 1}`,
  category: 'work',
  notebookId: 'nb1',
  tags: [],
  content: `正文 ${index + 1}`,
  version: 1,
  date: '2026-10-19',
  updatedAt: `2026-10-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
  readTime: '1 min',
}));

async function stubApi(page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/auth/me' ? { role: 'admin', username: 'test' }
      : path.endsWith('/menus') ? [{ id: 'docs', label: 'Docs', type: 'docs' }, { id: 'nb1', label: '本子', type: 'notebook' }]
        : path.endsWith('/categories') ? [{ id: 'work', label: '工作', notebookId: ['nb1'] }]
          : path.endsWith('/notes') ? notes : {};
    await route.fulfill({ json: body });
  });
}

async function scrollMain(page, top) {
  await page.locator('#mainContent').evaluate((main, scrollTop) => {
    main.scrollTop = scrollTop;
    main.dispatchEvent(new Event('scroll'));
  }, top);
}

test('mobile header follows scroll direction and stays pinned for active controls', async ({ page }, testInfo) => {
  await stubApi(page);
  await page.goto('/#/');
  await page.waitForFunction(() => window.App?.role === 'editor' && window.App?._notes.length === 40);

  const header = page.locator('.topnav');
  const body = page.locator('body');
  if (testInfo.project.name !== 'mobile') {
    await scrollMain(page, 240);
    await expect(body).not.toHaveClass(/mobile-header--hidden/);
    await expect(header).toBeVisible();
    return;
  }

  await scrollMain(page, 240);
  await expect(body).toHaveClass(/mobile-header--hidden/);
  await expect.poll(() => page.locator('.layout').evaluate((layout) => layout.getBoundingClientRect().top)).toBe(0);

  await scrollMain(page, 200);
  await expect(body).not.toHaveClass(/mobile-header--hidden/);
  await page.waitForTimeout(260);
  await expect(body).toHaveClass(/mobile-header--hidden/);

  await scrollMain(page, 0);
  await expect(body).not.toHaveClass(/mobile-header--hidden/);

  await scrollMain(page, 240);
  await expect(body).toHaveClass(/mobile-header--hidden/);
  await page.locator('#searchInput').focus();
  await expect(body).not.toHaveClass(/mobile-header--hidden/);

  await page.locator('#searchInput').blur();
  await scrollMain(page, 240);
  await page.evaluate(() => window.App.openMobileDrawer());
  await expect(page.locator('#mobileDrawer')).toHaveClass(/mobile-drawer--active/);
  await expect(body).not.toHaveClass(/mobile-header--hidden/);

  await page.evaluate(() => window.App.openPasswordModal());
  await expect(page.locator('#passwordModal')).toHaveClass(/modal-overlay--active/);
  await expect(body).not.toHaveClass(/mobile-header--hidden/);
});
