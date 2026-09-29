import { test, expect } from '@playwright/test';

test('return, refresh and editing keep the relevant note card in view', async ({ page }) => {
  const notes = Array.from({ length: 36 }, (_, index) => {
    const id = index + 1;
    const updatedAt = new Date(Date.UTC(2026, 7, id)).toISOString();
    return { id, title: `笔记 ${id}`, category: 'work', notebookId: 'nb1', tags: [],
      version: 1, content: `正文 ${id}`, date: updatedAt.slice(0, 10), updatedAt, readTime: '1 min' };
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path === '/api/auth/me') body = { role: 'admin', username: 'test' };
    else if (path.endsWith('/menus')) body = [{ id: 'docs', label: 'Docs', type: 'docs' }, { id: 'nb1', label: '本子', type: 'notebook' }];
    else if (path.endsWith('/categories')) body = [{ id: 'work', label: '工作', notebookId: ['nb1'] }];
    else if (path.endsWith('/notes')) body = notes;
    else if (path.endsWith('/notes/8') && route.request().method() === 'PUT') {
      Object.assign(notes[7], route.request().postDataJSON(), { version: notes[7].version + 1,
        updatedAt: '2027-01-01T00:00:00.000Z' });
      body = notes[7];
    } else if (path.endsWith('/notes/8')) body = notes[7];
    await route.fulfill({ json: body });
  });
  const target = page.locator('.note-card[data-id="8"]');
  const inViewport = async () => page.evaluate(() => {
    const main = document.getElementById('mainContent').getBoundingClientRect();
    const card = document.querySelector('.note-card[data-id="8"]').getBoundingClientRect();
    return card.bottom > main.top && card.top < main.bottom;
  });
  await page.goto('/#/');
  await expect(target).toBeVisible();
  await target.evaluate((card) => card.scrollIntoView({ block: 'start' }));
  await expect.poll(() => page.locator('#mainContent').evaluate((main) => main.scrollTop)).toBeGreaterThan(0);
  await target.click();
  await expect(page.locator('#detailView')).toHaveClass(/detail-view--active/);
  await page.locator('#detailView [data-action="show-browse"]').click();
  await expect.poll(inViewport).toBe(true);
  await page.reload();
  await expect(target).toBeVisible();
  await expect.poll(inViewport).toBe(true);
  await target.click();
  await page.goBack();
  await expect.poll(inViewport).toBe(true);
  await target.click();
  await page.locator('#detailView [data-action="open-note-modal"]').first().click();
  await expect(page.locator('#noteContentHost .tiptap')).toContainText('正文 8');
  await page.locator('#noteTitle').fill('笔记 8 已更新');
  await page.evaluate(() => window.App.saveNote());
  await expect(page.locator('.note-card').first()).toHaveAttribute('data-id', '8');
  await expect.poll(inViewport).toBe(true);
});

test('Docs and notebook remember separate browse positions', async ({ page }) => {
  const notes = Array.from({ length: 32 }, (_, index) => ({
    id: index + 1, title: `条目 ${index + 1}`, category: 'work', notebookId: 'nb1',
    tags: [], content: `内容 ${index + 1}`, version: 1, date: '2026-09-01', readTime: '1 min',
  }));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/auth/me' ? { role: 'admin', username: 'test' }
      : path.endsWith('/menus') ? [{ id: 'docs', label: 'Docs', type: 'docs' }, { id: 'nb1', label: '本子', type: 'notebook' }]
        : path.endsWith('/categories') ? [{ id: 'work', label: '工作', notebookId: ['nb1'] }]
          : path.endsWith('/notes') ? notes : {};
    await route.fulfill({ json: body });
  });
  const visible = (id) => page.evaluate((noteId) => {
    const main = document.getElementById('mainContent').getBoundingClientRect();
    const card = document.querySelector(`.note-card[data-id="${noteId}"]`).getBoundingClientRect();
    return card.bottom > main.top && card.top < main.bottom;
  }, id);
  await page.goto('/#/');
  await page.locator('.note-card[data-id="8"]').evaluate((card) => card.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.App.navTo('nb1'));
  await page.locator('.note-card[data-id="17"]').evaluate((card) => card.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.App.navTo('docs'));
  await expect.poll(() => visible(8)).toBe(true);
  await page.evaluate(() => window.App.navTo('nb1'));
  await expect.poll(() => visible(17)).toBe(true);
});
