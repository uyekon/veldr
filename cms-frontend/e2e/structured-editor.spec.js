import { test, expect } from '@playwright/test';

test('indent and toggle blocks survive editing, preview and save', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let note = {
    id: 1, title: '结构化正文', category: 'work', notebookId: 'nb1', tags: [], version: 1,
    content: '普通段落\n\n:::indent 2\n缩进的 **重点**。\n:::endindent\n\n:::toggle\n**准备事项**\n:::content\n- 第一项\n- 第二项\n:::endtoggle',
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path === '/api/auth/me') body = { role: 'admin', username: 'test' };
    else if (path.endsWith('/menus')) body = [{ id: 'docs', label: 'Docs', type: 'docs' }, { id: 'nb1', label: '本子', type: 'notebook' }];
    else if (path.endsWith('/categories')) body = [{ id: 'work', label: '工作', notebookId: ['nb1'] }];
    else if (path.endsWith('/notes')) body = [note];
    else if (path.endsWith('/notes/1') && route.request().method() === 'PUT') {
      note = { ...note, ...route.request().postDataJSON(), version: note.version + 1 };
      body = note;
    } else if (path.endsWith('/notes/1')) body = note;
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.App?.role === 'editor' && window.App?._notes.length === 1);
  await page.evaluate(() => window.App.openNoteModal(1));
  const editor = page.locator('#noteContentHost .tiptap');
  await expect(editor.locator('p[data-indent="2"]')).toContainText('缩进的 重点');
  await expect(editor.locator('.md-toggle__summary')).toContainText('准备事项');
  await expect(editor.locator('.md-toggle__content li')).toHaveCount(2);
  await expect(page.locator('.modal__toolbar > button').first()).toHaveAttribute('data-format', 'outdent');
  await expect(page.locator('.modal__toolbar > button').nth(1)).toHaveAttribute('data-format', 'indent');
  await page.locator('[data-editor-mode="preview"]').click();
  const details = page.locator('#markdownPreview details.md-toggle');
  await expect(details).toHaveCount(1);
  await expect(details).not.toHaveAttribute('open');
  await expect(page.locator('#markdownPreview .md-indent--2')).toContainText('缩进的 重点');
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open');
  await expect(details.locator('li')).toHaveCount(2);
  await page.locator('[data-editor-mode="write"]').click();
  await editor.locator('p[data-indent="2"]').click();
  await page.locator('[data-format="outdent"]').click();
  await expect(editor.locator('p[data-indent="1"]')).toContainText('缩进的 重点');
  await page.locator('[data-format="indent"]').click();
  await expect(editor.locator('p[data-indent="2"]')).toContainText('缩进的 重点');
  await page.locator('[data-editor-mode="source"]').click();
  await expect(page.locator('#noteContent')).toHaveValue(/:::indent 2/);
  await expect(page.locator('#noteContent')).toHaveValue(/:::toggle/);
  await page.locator('[data-editor-mode="write"]').click();
  await expect(editor.locator('.md-toggle__content li')).toHaveCount(2);
  await page.evaluate(() => window.App.saveNote({ keepOpen: true }));
  await expect.poll(() => note.version).toBe(2);
  expect(note.content).toContain(':::indent 2');
  expect(note.content).toContain(':::toggle');
  expect(note.content).toContain(':::endtoggle');
  expect(note.content).toContain('第一项');
  await page.evaluate(() => window.App.closeModal({ force: true }));
  await page.evaluate(() => window.App.showDetail(1));
  await expect(page.locator('#detailView details.md-toggle')).toHaveCount(1);
  await page.evaluate(() => window.App.openNoteModal(1));
  await expect(page.locator('#noteContentHost p[data-indent="2"]')).toContainText('缩进的 重点');
  await expect(page.locator('#noteContentHost .md-toggle__content li')).toHaveCount(2);
  const safeHTML = await page.evaluate(() => window.CMSMarkdown.render(':::toggle\n<img src=x onerror=alert(1)>\n:::content\n正文\n:::endtoggle'));
  expect(safeHTML).not.toContain('onerror');
  expect(errors).toEqual([]);
});

test('list items indent and a paragraph toggles without losing text', async ({ page }) => {
  const note = { id: 2, title: '列表', category: 'work', notebookId: 'nb1', tags: [], version: 1,
    content: '- 第一项\n- 第二项\n\n- [ ] 任务一\n- [ ] 任务二\n\n可折叠的标题' };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/auth/me' ? { role: 'admin', username: 'test' }
      : path.endsWith('/menus') ? [{ id: 'docs', label: 'Docs', type: 'docs' }, { id: 'nb1', label: '本子', type: 'notebook' }]
        : path.endsWith('/categories') ? [{ id: 'work', label: '工作', notebookId: ['nb1'] }]
          : path.endsWith('/notes') ? [note] : {};
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.App?.role === 'editor' && window.App?._notes.length === 1);
  await page.evaluate(() => window.App.openNoteModal(2));
  const editor = page.locator('#noteContentHost .tiptap');
  await editor.locator('ul:not([data-type]) > li').nth(1).click();
  await page.locator('[data-format="indent"]').click();
  await expect(editor.locator('ul:not([data-type]) ul li')).toContainText('第二项');
  await editor.locator('ul:not([data-type]) ul li').click();
  await page.locator('[data-format="outdent"]').click();
  await expect(editor.locator('ul:not([data-type]) ul li')).toHaveCount(0);
  await expect(editor.locator('ul:not([data-type]) > li')).toHaveCount(2);
  await editor.locator('ul[data-type="taskList"] > li').last().click();
  await page.locator('[data-format="indent"]').click();
  await expect(editor.locator('ul[data-type="taskList"] ul[data-type="taskList"] li')).toContainText('任务二');
  await editor.locator('p').filter({ hasText: '可折叠的标题' }).last().click();
  await page.locator('[data-format="toggle"]').click();
  await expect(editor.locator('.md-toggle__summary')).toContainText('可折叠的标题');
  await editor.locator('.md-toggle__summary').click();
  await page.locator('[data-format="toggle"]').click();
  await expect(editor.locator('.md-toggle')).toHaveCount(0);
  await expect(editor.locator('p').filter({ hasText: '可折叠的标题' })).toHaveCount(1);
});

test('indent applies to every selected paragraph and previews both', async ({ page }) => {
  const note = { id: 3, title: '多段', category: 'work', notebookId: 'nb1', tags: [], version: 1,
    content: '第一段\n\n第二段' };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/auth/me' ? { role: 'admin', username: 'test' }
      : path.endsWith('/menus') ? [{ id: 'docs', label: 'Docs', type: 'docs' }, { id: 'nb1', label: '本子', type: 'notebook' }]
        : path.endsWith('/categories') ? [{ id: 'work', label: '工作', notebookId: ['nb1'] }]
          : path.endsWith('/notes') ? [note] : {};
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.App?.role === 'editor' && window.App?._notes.length === 1);
  await page.evaluate(() => window.App.openNoteModal(3));
  await page.evaluate(() => {
    const editor = window.App.richEditor;
    const paragraphs = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'paragraph') paragraphs.push({ node, position });
    });
    editor.commands.setTextSelection({ from: paragraphs[0].position + 1, to: paragraphs[1].position + paragraphs[1].node.nodeSize - 1 });
  });
  await page.locator('[data-format="indent"]').click();
  await expect(page.locator('#noteContentHost p[data-indent="1"]')).toHaveCount(2);
  await page.locator('[data-editor-mode="preview"]').click();
  await expect(page.locator('#markdownPreview .md-indent--1')).toHaveCount(2);
});
