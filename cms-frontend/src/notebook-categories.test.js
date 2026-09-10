import { afterEach, describe, expect, it } from 'vitest';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});

describe('notebook category sidebar', () => {
  it('shows categories used by a notebook even if legacy bindings are stale', async () => {
    globalThis.window = { CMS_CONFIG: {} };
    const { categoryMethods } = await import('./app/categories.js');
    const notebookId = 'methods';
    const categoryList = { innerHTML: '' };
    globalThis.document = {
      getElementById: (id) => ({ categoryList, addCategoryBtn: { style: {} } }[id] || null),
    };
    const app = {
      ...categoryMethods,
      role: 'viewer', currentNav: notebookId, currentFilter: 'all',
      _menus: [{ id: notebookId, label: 'Methods', type: 'notebook' }],
      _categories: [
        { id: 'makm', label: 'MakM', parentId: null, notebookId: [] },
        { id: 'life', label: 'life', parentId: null, notebookId: ['todo'] },
      ],
      _notes: [{ id: 1, notebookId, category: 'makm' }, { id: 2, notebookId, category: 'life' }],
      escapeHTML: (value) => String(value),
      getCurrentNotebookId: () => notebookId,
      getScopedNotes() { return this._notes.filter(note => note.notebookId === notebookId); },
      ensureCategoryOptions() {},
    };

    app.renderCategories();

    expect(categoryList.innerHTML).toContain('MakM');
    expect(categoryList.innerHTML).toContain('life');
  });

  it('renders Docs categories without treating a Set as an array', async () => {
    globalThis.window = { CMS_CONFIG: {} };
    const { categoryMethods } = await import('./app/categories.js');
    const categoryList = { innerHTML: '' };
    globalThis.document = {
      getElementById: (id) => ({ categoryList, addCategoryBtn: { style: {} } }[id] || null),
    };
    const app = {
      ...categoryMethods,
      role: 'viewer', currentNav: 'docs', currentFilter: 'all',
      _menus: [{ id: 'docs', label: 'Docs', type: 'docs' }],
      _categories: [{ id: 'makm', label: 'MakM', parentId: null, notebookId: [] }],
      _notes: [{ id: 1, notebookId: 'methods', category: 'makm' }],
      escapeHTML: (value) => String(value),
      getCurrentNotebookId: () => null,
      getScopedNotes() { return this._notes; },
      ensureCategoryOptions() {},
    };

    expect(() => app.renderCategories()).not.toThrow();
    expect(categoryList.innerHTML).toContain('MakM');
  });
});
