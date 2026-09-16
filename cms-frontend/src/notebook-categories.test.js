import { afterEach, describe, expect, it } from 'vitest';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalConfirm = globalThis.confirm;
const originalPrompt = globalThis.prompt;

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.confirm = originalConfirm;
  globalThis.prompt = originalPrompt;
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
        { id: 'empty', label: 'Empty', parentId: null, notebookId: [notebookId] },
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
    expect(categoryList.innerHTML).not.toContain('Empty');
  });

  it('keeps global categories visible in the mobile notebook filters', async () => {
    globalThis.window = { CMS_CONFIG: {} };
    const { categoryMethods } = await import('./app/categories.js');
    const mobileFilterList = { innerHTML: '' };
    const mobileTagsList = { innerHTML: '' };
    globalThis.document = {
      getElementById: (id) => ({ mobileFilterList, mobileTagsList }[id] || null),
    };
    const app = {
      ...categoryMethods,
      currentNav: 'methods', currentFilter: 'all',
      _menus: [{ id: 'methods', label: 'Methods', type: 'notebook' }],
      _categories: [{ id: 'makm', label: 'MakM', parentId: null, notebookId: [] }],
      _notes: [{ id: 1, notebookId: 'methods', category: 'makm', tags: [] }],
      getCurrentNotebookId: () => 'methods',
      getScopedNotes() { return this._notes.filter(note => note.notebookId === 'methods'); },
      escapeHTML: (value) => String(value),
    };

    app.renderMobileFilters();

    expect(mobileFilterList.innerHTML).toContain('MakM');
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

  it('deletes a category through the CMS API when the sidebar action is used', async () => {
    globalThis.window = { CMS_CONFIG: {} };
    globalThis.confirm = () => true;
    const { categoryMethods } = await import('./app/categories.js');
    const calls = [];
    const app = {
      ...categoryMethods,
      role: 'editor',
      _categories: [{ id: 'makm', label: 'MakM', parentId: null, notebookId: [] }],
      closeMobileSheets() {},
      api: async (...args) => { calls.push(args); },
      reloadCategories: async () => {},
      reloadNotes: async () => {},
      renderCategories() {}, renderMobileFilters() {}, updateCounts() {}, toast() {},
    };

    await app.deleteCategory('makm');

    expect(calls).toEqual([['DELETE', '/api/cms/categories/makm']]);
  });

  it('creates a category for the notebook selected in the editor', async () => {
    globalThis.window = { CMS_CONFIG: {} };
    globalThis.prompt = () => 'New category';
    const { categoryMethods } = await import('./app/categories.js');
    const calls = [];
    const selected = [];
    const app = {
      ...categoryMethods,
      role: 'editor', draftNotebookId: 'methods', currentNav: 'docs',
      closeMobileSheets() {},
      getCurrentNotebookId: () => null,
      api: async (...args) => { calls.push(args); return { id: 'new-category' }; },
      reloadCategories: async () => {},
      setCategorySelection: (...args) => selected.push(args),
      renderCategories() {}, renderMobileFilters() {}, toast() {},
    };

    await app.addCategory();

    expect(calls).toEqual([['POST', '/api/cms/categories', { label: 'New category', notebookId: ['methods'] }]]);
    expect(selected).toEqual([['new-category', 'methods']]);
  });

  it('refreshes subcategory choices when the editor category changes', async () => {
    globalThis.window = { CMS_CONFIG: {} };
    const { categoryMethods } = await import('./app/categories.js');
    const parentSelect = { value: 'project' };
    const childSelect = { value: 'old-child', disabled: true, innerHTML: '' };
    globalThis.document = {
      getElementById: (id) => ({ noteCategory: parentSelect, noteSubcategory: childSelect }[id] || null),
    };
    const app = {
      ...categoryMethods,
      _categories: [
        { id: 'project', label: 'Project', notebookId: ['methods'] },
        { id: 'project-tasks', label: 'Tasks', parentId: 'project', notebookId: ['methods'] },
        { id: 'archive', label: 'Archive', notebookId: ['methods'] },
        { id: 'archive-2026', label: '2026', parentId: 'archive', notebookId: ['methods'] },
      ],
      getCurrentNotebookId: () => 'methods',
      escapeHTML: (value) => String(value),
    };

    app.syncSubcategoryOptions('', 'methods');
    expect(childSelect.disabled).toBe(false);
    expect(childSelect.value).toBe('');
    expect(childSelect.innerHTML).toContain('Tasks');
    expect(childSelect.innerHTML).not.toContain('2026');

    parentSelect.value = 'archive';
    app.syncSubcategoryOptions('', 'methods');
    expect(childSelect.innerHTML).toContain('2026');
    expect(childSelect.innerHTML).not.toContain('Tasks');
  });

  it('creates and selects a subcategory from the editor without widening its scope', async () => {
    globalThis.window = { CMS_CONFIG: {} };
    globalThis.prompt = () => 'Follow-up';
    const { categoryMethods } = await import('./app/categories.js');
    const calls = [];
    const selected = [];
    let autosaves = 0;
    globalThis.document = {
      getElementById: (id) => (id === 'noteCategory' ? { value: 'project' } : null),
    };
    const app = {
      ...categoryMethods,
      role: 'editor', draftNotebookId: 'methods',
      _categories: [{ id: 'project', label: 'Project', notebookId: ['methods'] }],
      closeMobileSheets() {},
      api: async (...args) => { calls.push(args); return { id: 'follow-up', parentId: 'project' }; },
      reloadCategories: async () => {},
      setCategorySelection: (...args) => selected.push(args),
      scheduleAutosave: () => { autosaves += 1; },
      renderCategories() {}, renderMobileFilters() {}, toast() {},
    };

    await app.addEditorSubcategory();

    expect(calls).toEqual([['POST', '/api/cms/categories', { label: 'Follow-up', parentId: 'project' }]]);
    expect(selected).toEqual([['follow-up', 'methods']]);
    expect(autosaves).toBe(1);
  });

  it('filters notes by the selected Docs category', async () => {
    const { notesViewMethods } = await import('./app/notes-view.js');
    const app = {
      ...notesViewMethods,
      currentFilter: 'category:makm', searchQuery: '',
      _categories: [
        { id: 'makm', label: 'MakM', parentId: null, notebookId: ['methods'] },
        { id: 'makm-copy', label: 'MakM', parentId: null, notebookId: ['methods'] },
      ],
      _notes: [
        { id: 1, category: 'makm', notebookId: 'methods', tags: [] },
        { id: 2, category: 'life', notebookId: 'methods', tags: [] },
        { id: 3, category: 'makm-copy', notebookId: 'methods', tags: [] },
      ],
      getScopedNotes() { return this._notes; },
      isCategoryFilter: (filter) => filter.startsWith('category:'),
      getCategoryIdFromFilter: (filter) => filter.slice('category:'.length),
      getCategorySubtreeIds: (id) => new Set([id]),
    };

    expect(app.getFilteredNotes().map(note => note.id)).toEqual([1, 3]);
  });
});
