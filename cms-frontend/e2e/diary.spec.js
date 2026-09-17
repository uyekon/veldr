import { test, expect } from '@playwright/test';

test('save, convert modal, notebook scope and archived visibility', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let board = { id: 'n', content: '日记正文', version: 1, updatedAt: null };
  const notes = [{ id: 1, title: '已归档记录', content: 'old', tags: ['archived'], category: 'a', notebookId: 'nb1' }];
  const categories = [{ id: 'a', label: '工作', notebookId: ['nb1'] }, { id: 'b', label: '生活', notebookId: ['nb2'] }];
  const menus = [{ id: 'docs', label: 'Docs', type: 'docs' }, { id: 'nb1', label: '工作本', type: 'notebook' }, { id: 'nb2', label: '生活本', type: 'notebook' }];
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const endpoint = url.pathname;
    let body = {};
    if (endpoint === '/api/auth/me') body = { role: 'admin', username: 'test' };
    else if (endpoint.endsWith('/categories')) body = categories;
    else if (endpoint.endsWith('/menus')) body = menus;
    else if (endpoint.endsWith('/notes')) body = notes;
    else if (endpoint.endsWith('/whiteboards')) body = [{ id: 'n', name: '日记' }];
    else if (endpoint.endsWith('/whiteboards/n')) {
      if (request.method() === 'PUT') board = { ...board, content: request.postDataJSON().content, version: board.version + 1 };
      body = board;
    } else if (endpoint.endsWith('/whiteboards/n/archive')) {
      const payload = request.postDataJSON();
      expect(payload.version).toBe(board.version); expect(payload.requestId).toBeTruthy();
      notes.push({ id: 2, ...payload, content: board.content });
      board = { ...board, content: '', version: board.version + 1 };
      body = { note: notes[1], whiteboard: board };
    }
    await route.fulfill({ json: body });
  });
  await page.goto('/#/whiteboard/n');
  await expect(page.locator('#whiteboardContent')).toHaveValue('日记正文');
  await expect(page.locator('#diaryArticleTitle')).not.toBeVisible();
  await page.locator('#whiteboardContent').fill('新内容');
  await page.locator('#whiteboardSaveBtn').click();
  await expect(page.locator('#whiteboardStatus')).not.toContainText('正在保存');
  await page.locator('#diaryConvertBtn').click();
  await page.locator('#diaryArticleNotebook').selectOption('nb2');
  await expect(page.locator('#diaryArticleCategory option')).toHaveText(['生活']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#diaryArchiveModal')).not.toBeVisible();
  await expect(page.locator('#whiteboardContent')).toHaveValue('新内容');
  await page.locator('#diaryConvertBtn').click();
  await page.locator('#diaryArticleTitle').fill('测试文章');
  await page.screenshot({ path: testInfo.outputPath('conversion.png'), fullPage: true });
  await page.locator('#diarySubmitBtn').click();
  await expect(page.locator('#diaryArchiveModal')).not.toBeVisible();
  await expect(page.locator('#whiteboardContent')).toHaveValue('');
  await page.evaluate(() => window.App.navTo('docs'));
  await expect(page.locator('.note-card__title')).toHaveText(['测试文章']);
  await page.evaluate(() => window.App.setFilter('tag:archived'));
  await expect(page.locator('.note-card__title')).toHaveText(['已归档记录']);
  expect(errors).toEqual([]);
});
