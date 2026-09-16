import { apiPath } from '../config.js';

// ===== 分类与标签 =====
export const categoryMethods = {
  getDefaultCategoryId() {
    return this._categories[0]?.id || 'work';
  },

  getCategoryById(id) {
    return this._categories.find(category => category.id === id) || null;
  },

  getCategoryDepth(category, seen = new Set()) {
    if (!category?.parentId || seen.has(category.id)) return 0;
    seen.add(category.id);
    const parent = this.getCategoryById(category.parentId);
    return parent ? 1 + this.getCategoryDepth(parent, seen) : 0;
  },

  getCategoryLabel(id) {
    return this.getCategoryById(id)?.label || id || '未分类';
  },

  getCategoryFilter(id) {
    return `category:${id}`;
  },

  getCategorySubtreeIds(categoryId) {
    const ids = new Set([categoryId]);
    const stack = [categoryId];
    while (stack.length) {
      const current = stack.pop();
      for (const child of this._categories) {
        if (child.parentId === current && !ids.has(child.id)) {
          ids.add(child.id);
          stack.push(child.id);
        }
      }
    }
    return ids;
  },

  countCategoryNotes(categoryId, notes) {
    const ids = this.getCategorySubtreeIds(categoryId);
    return notes.filter(note => ids.has(note.category)).length;
  },

  getCategoryNotebookLabel(category) {
    if (!category?.notebookId?.length) return [];
    return category.notebookId
      .map(nb => this._menus.find(m => m.id === nb)?.label || nb)
      .filter(Boolean);
  },

  // Direct children of a category from the full list
  getChildrenOf(categoryId) {
    return this._categories.filter(c => c.parentId === categoryId);
  },

  isCategoryFilter(filter) {
    return String(filter || '').startsWith('category:');
  },

  getCategoryIdFromFilter(filter) {
    return String(filter || '').slice('category:'.length);
  },

  ensureCategoryOptions(selectedId, targetNotebookId = this.draftNotebookId ?? this.getCurrentNotebookId()) {
    const select = document.getElementById('noteCategory');
    if (!select) return;
    const value = selectedId || select.value || this.getDefaultCategoryId();
    // The note editor may target a different notebook than the current page.
    // Keep categories bound to that target plus global fallback categories.
    let roots = this._categories.filter(category => !category.parentId);
    if (targetNotebookId) {
      roots = roots.filter(category => (
        !Array.isArray(category.notebookId) ||
        category.notebookId.length === 0 ||
        category.notebookId.includes(targetNotebookId)
      ));
    }
    select.innerHTML = roots.map(category => (
      `<option value="${this.escapeHTML(category.id)}">${this.escapeHTML(category.label)}</option>`
    )).join('');
    const selected = this.getCategoryById(value);
    const rootId = selected?.parentId || (roots.some(category => category.id === selected?.id) ? selected.id : roots[0]?.id || '');
    select.value = rootId;
    this.syncSubcategoryOptions(selected?.parentId === rootId ? selected.id : '', targetNotebookId);
  },

  syncSubcategoryOptions(selectedId, targetNotebookId = this.draftNotebookId ?? this.getCurrentNotebookId()) {
    const parentSelect = document.getElementById('noteCategory');
    const childSelect = document.getElementById('noteSubcategory');
    if (!parentSelect || !childSelect) return;
    const selected = this.getCategoryById(selectedId);
    const parentId = parentSelect.value;
    const children = this._categories.filter(category => (
      category.parentId === parentId &&
      (!targetNotebookId || !Array.isArray(category.notebookId) || category.notebookId.length === 0 || category.notebookId.includes(targetNotebookId))
    ));
    childSelect.innerHTML = `<option value="">${children.length ? '不使用子分类' : '无子分类'}</option>${children.map(category => `<option value="${this.escapeHTML(category.id)}">${this.escapeHTML(category.label)}</option>`).join('')}`;
    childSelect.disabled = children.length === 0;
    childSelect.value = children.some(category => category.id === selected?.id) ? selected.id : '';
  },

  getSelectedCategoryId() {
    return document.getElementById('noteSubcategory')?.value || document.getElementById('noteCategory')?.value || this.getDefaultCategoryId();
  },

  setCategorySelection(id, targetNotebookId) {
    this.ensureCategoryOptions(id, targetNotebookId);
  },

  ensureNotebookOptions(selectedId) {
    const select = document.getElementById('noteNotebook');
    if (!select) return;
    select.innerHTML = this._menus.filter(menu => menu.type !== 'page').map(menu => `<option value="${this.escapeHTML(menu.id)}">${this.escapeHTML(menu.label)}</option>`).join('');
    select.value = this._menus.some(menu => menu.id === selectedId) ? selectedId : (this.getCurrentNotebookId?.() || this._menus[0]?.id || '');
  },

  renderCategories() {
    const container = document.getElementById('categoryList');
    const addBtn = document.getElementById('addCategoryBtn');
    if (!container) return;
    const isEditor = this.role === 'editor';
    if (addBtn) addBtn.style.display = isEditor ? 'flex' : 'none';
    const scopedNotes = this.getScopedNotes();
    const isDocsView = this.currentNav === 'docs';
    const notebookId = this.getCurrentNotebookId();

    if (!this._categories.length) {
      container.innerHTML = '<div style="padding:var(--s2) var(--s6);font-size:.8125rem;color:var(--c400)">暂无分类</div>';
      this.ensureCategoryOptions();
      return;
    }

    if (isDocsView) {
      this._renderCategoriesDocsView(container, isEditor, scopedNotes);
    } else {
      this._renderCategoriesNotebookView(container, isEditor, scopedNotes, notebookId);
    }
    this.ensureCategoryOptions();
  },

  _renderCategoriesDocsView(container, isEditor, scopedNotes) {
    // Docs view: categories grouped by (label, notebookId).
    //   - Global categories (notebookId === null): same label merges into one entry.
    //   - Notebook-bound categories (notebookId !== null): same label merges into
    //     one entry too, showing the notebook badge so the user knows which
    //     notebook(s) contain notes for this category.
    // Filtering on any merged group shows notes from all participating categories.
    const scopedCategoryIds = new Set(scopedNotes.map(n => n.category));

    // Group by label: all categories with the same label merge into one entry.
    const groupMap = new Map(); // key: label -> merged group (all same-label categories)
    this._categories.forEach(cat => {
      const subtreeIds = this.getCategorySubtreeIds(cat.id);
      const matches = [...subtreeIds].filter(id => scopedCategoryIds.has(id));
      if (matches.length === 0) return;
      const group = groupMap.get(cat.label) || {
        label: cat.label,
        ids: new Set(),
        count: 0,
        children: new Set(),
      };
      group.count += this.countCategoryNotes(cat.id, scopedNotes);
      subtreeIds.forEach(id => group.ids.add(id));
      // Add direct children that have usage.
      this.getChildrenOf(cat.id).forEach(child => {
        const cIds = this.getCategorySubtreeIds(child.id);
        if ([...cIds].some(id => scopedCategoryIds.has(id))) {
          group.children.add(child.id);
        }
      });
      groupMap.set(cat.label, group);
    });

    // Build display list sorted by label.
    const entries = [...groupMap.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));

    const renderEntry = (group) => {
      // Use the first id in the group as the representative filter key.
      const repId = [...group.ids][0];
      const filter = this.getCategoryFilter(repId);
      // Active if any participating category or its children is active.
      const active = this.currentFilter === filter ||
        [...group.ids].some(id => this.currentFilter === this.getCategoryFilter(id)) ||
        [...group.children].some(id => this.currentFilter === this.getCategoryFilter(id));
      const notebookLabel = group.ids.size > 0
        ? (() => {
            const catsInGroup = [...group.ids].map(id => this._categories.find(c => c.id === id)).filter(Boolean);
            const boundCats = catsInGroup.filter(c => Array.isArray(c.notebookId) && c.notebookId.length > 0);
            return boundCats.length
              ? `<span class="sidebar__category-notebook">${boundCats.flatMap(c => c.notebookId).map(nb => this.escapeHTML(this._menus.find(m => m.id === nb)?.label || nb)).join(', ')}</span>`
              : '';
          })()
        : '';
      const childrenHtml = group.children.size > 0
        ? `<div class="sidebar__category-children">${[...group.children].map(c => this._renderChildLink(c, scopedNotes)).join('')}</div>`
        : '';
      const actions = isEditor ? `<span class="sidebar__item-actions">
        <button class="sidebar__icon-btn" type="button" title="重命名分类" data-action="rename-category" data-id="${this.escapeHTML(repId)}">✎</button>
        <button class="sidebar__icon-btn" type="button" title="添加子分类" data-action="add-subcategory" data-id="${this.escapeHTML(repId)}">＋</button>
        <button class="sidebar__icon-btn sidebar__icon-btn--danger" type="button" title="删除分类" data-action="delete-category" data-id="${this.escapeHTML(repId)}">×</button>
      </span>` : '';
      return `<div class="sidebar__category-group ${group.children.size > 0 && active ? 'sidebar__category-group--active' : ''}">
        <a class="sidebar__item sidebar__category ${active ? 'sidebar__item--active' : ''}" data-filter="${this.escapeHTML(filter)}" data-action="set-filter">
          <svg class="sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h5l2 3h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 4"/></svg>
          <span class="sidebar__item-text">${this.escapeHTML(group.label)}</span>
          ${notebookLabel}
          ${group.children.size > 0 ? '<span class="sidebar__category-chevron" aria-hidden="true">›</span>' : ''}
          <span class="sidebar__count">${group.count}</span>
          ${actions}
        </a>${childrenHtml}</div>`;
    };

    container.innerHTML = entries.map(renderEntry).join('');
  },

  _renderCategoriesNotebookView(container, isEditor, scopedNotes, notebookId) {
    // Notebook view: only show categories assigned to this notebook.
    // Root categories (parentId === null) are scoped by their notebook binding
    // and by the notes actually present in the current notebook.
    const scopedCategoryIds = new Set(scopedNotes.map(n => n.category));

    // A notebook sidebar is a navigation aid: omit categories with no article
    // in this notebook, even when a category is explicitly bound to it.
    const roots = this._categories.filter(c => !c.parentId);
    const visibleRoots = roots.filter(cat => {
      const subtreeIds = this.getCategorySubtreeIds(cat.id);
      const isUsedByNotebook = [...subtreeIds].some(id => scopedCategoryIds.has(id));
      return isUsedByNotebook;
    }).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));

    const renderCategory = (cat, depth = 0) => {
      const filter = this.getCategoryFilter(cat.id);
      const active = this.currentFilter === filter;
      const count = this.countCategoryNotes(cat.id, scopedNotes);
      const children = this.getChildrenOf(cat.id).filter(child => {
        const cIds = this.getCategorySubtreeIds(child.id);
        return [...cIds].some(id => scopedCategoryIds.has(id));
      });
      const hasChildren = children.length > 0;
      const childActive = children.some(c => this.currentFilter === this.getCategoryFilter(c.id));
      const indent = depth > 0 ? `padding-left:${12 + depth * 16}px` : '';
      const actions = isEditor ? `<span class="sidebar__item-actions">
        <button class="sidebar__icon-btn" type="button" title="重命名分类" data-action="rename-category" data-id="${this.escapeHTML(cat.id)}">✎</button>
        ${depth === 0 ? `<button class="sidebar__icon-btn" type="button" title="添加子分类" data-action="add-subcategory" data-id="${this.escapeHTML(cat.id)}">＋</button>` : ''}
        <button class="sidebar__icon-btn sidebar__icon-btn--danger" type="button" title="删除分类" data-action="delete-category" data-id="${this.escapeHTML(cat.id)}">×</button>
      </span>` : '';
      const childrenHtml = hasChildren
        ? `<div class="sidebar__category-children ${active || childActive ? 'sidebar__category-children--open' : ''}">${children.map(c => renderCategory(c, depth + 1)).join('')}</div>`
        : '';
      return `<div class="sidebar__category-group ${hasChildren && (active || childActive) ? 'sidebar__category-group--active' : ''}">
        <a class="sidebar__item sidebar__category ${active ? 'sidebar__item--active' : ''}" data-filter="${this.escapeHTML(filter)}" data-action="set-filter" ${indent ? `style="${indent}"` : ''}>
          <svg class="sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h5l2 3h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 4"/></svg>
          <span class="sidebar__item-text">${this.escapeHTML(cat.label)}</span>
          ${hasChildren ? '<span class="sidebar__category-chevron" aria-hidden="true">›</span>' : ''}
          <span class="sidebar__count">${count}</span>
          ${actions}
        </a>${childrenHtml}</div>`;
    };

    if (visibleRoots.length === 0) {
      container.innerHTML = '<div style="padding:var(--s2) var(--s6);font-size:.8125rem;color:var(--c400)">此笔记本暂无分类</div>';
    } else {
      container.innerHTML = visibleRoots.map(cat => renderCategory(cat)).join('');
    }
  },

  _renderChildLink(childId, scopedNotes) {
    const cat = this.getCategoryById(childId);
    if (!cat) return '';
    const filter = this.getCategoryFilter(cat.id);
    const active = this.currentFilter === filter;
    const count = this.countCategoryNotes(cat.id, scopedNotes);
    return `<a class="sidebar__item sidebar__category sidebar__category--child ${active ? 'sidebar__item--active' : ''}" data-filter="${this.escapeHTML(filter)}" data-action="set-filter">
      <span class="sidebar__item-text">${this.escapeHTML(cat.label)}</span>
      <span class="sidebar__count">${count}</span>
    </a>`;
  },

  renderMobileFilters() {
    const list = document.getElementById('mobileFilterList');
    if (!list) return;
    const scopedNotes = this.getScopedNotes();
    const isDocsView = this.currentNav === 'docs';
    const notebookId = this.getCurrentNotebookId();

    // Build visible category items.
    const categoryItems = [];
    if (isDocsView) {
      // Group by label: all categories with the same label merge into one entry.
      // Show notebook badge(s) if any participating category is bound.
      const groupMap = new Map();
      this._categories.forEach(cat => {
        const ids = this.getCategorySubtreeIds(cat.id);
        const matches = [...ids].filter(id => scopedNotes.some(n => n.category === id));
        if (matches.length === 0) return;
        const existing = groupMap.get(cat.label) || { label: cat.label, count: 0, ids: new Set(), notebookIds: new Set() };
        existing.count += this.countCategoryNotes(cat.id, scopedNotes);
        matches.forEach(m => existing.ids.add(m));
        if (Array.isArray(cat.notebookId)) cat.notebookId.forEach(nb => existing.notebookIds.add(nb));
        groupMap.set(cat.label, existing);
      });
      [...groupMap.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')).forEach(group => {
        const sampleId = [...group.ids][0];
        const notebookTag = group.notebookIds.size > 0
          ? ` — ${[...group.notebookIds].map(nb => this._menus.find(m => m.id === nb)?.label || nb).join(', ')}`
          : '';
        categoryItems.push({
          filter: this.getCategoryFilter(sampleId),
          label: `${group.label}${notebookTag}`.trimEnd(),
          count: group.count,
        });
      });
    } else {
      // Notebook view: only show categories belonging to current notebook.
      this._categories
        .filter(cat => {
          const isGlobal = !Array.isArray(cat.notebookId) || cat.notebookId.length === 0;
          if (notebookId && !isGlobal && !cat.notebookId.includes(notebookId)) return false;
          const ids = this.getCategorySubtreeIds(cat.id);
          return [...ids].some(id => scopedNotes.some(n => n.category === id));
        })
        .forEach(cat => {
          categoryItems.push({
            filter: this.getCategoryFilter(cat.id),
            label: `${'— '.repeat(this.getCategoryDepth(cat))}${cat.label}${cat.notebookId ? ` (${this.getCategoryNotebookLabel(cat)})` : ''}`.trimEnd(),
            count: this.countCategoryNotes(cat.id, scopedNotes),
          });
        });
    }

    const noTagCount = scopedNotes.filter(n => !Array.isArray(n.tags) || n.tags.length === 0).length;
    const items = [
      { filter: 'all', label: '所有笔记', count: scopedNotes.length },
      ...categoryItems,
      ...(noTagCount > 0 ? [{ filter: 'notag', label: '未标签', count: noTagCount }] : []),
      { filter: 'star', label: '收藏夹', count: scopedNotes.filter(n => n.starred).length },
    ];
    list.innerHTML = items.map(item => `
      <button class="mobile-sheet__item ${this.currentFilter === item.filter ? 'mobile-sheet__item--active' : ''}" data-filter="${this.escapeHTML(item.filter)}" type="button" data-action="set-filter">
        <span>${this.escapeHTML(item.label)}</span>
        <span class="mobile-sheet__item-count">${item.count}</span>
      </button>
    `).join('');
    this.renderMobileTags();
  },

  renderMobileTags() {
    const container = document.getElementById('mobileTagsList');
    if (!container) return;
    const allTags = new Set();
    this._notes.forEach(n => (n.tags || []).forEach(t => allTags.add(t)));
    if (allTags.size === 0) {
      container.innerHTML = '<span style="font-size:.875rem;color:var(--c400)">暂无标签</span>';
      return;
    }
    container.innerHTML = Array.from(allTags).sort().map(tag => {
      const filter = 'tag:' + tag;
      const active = this.currentFilter === filter;
      const count = this._notes.filter(n => (n.tags || []).includes(tag)).length;
      return `<button class="mobile-sheet__tag ${active ? 'mobile-sheet__tag--active' : ''}" data-filter="${this.escapeHTML(filter)}" type="button" data-action="set-filter">#${this.escapeHTML(tag)} <span>${count}</span></button>`;
    }).join('');
  },

  renderTags() {
    const notes = this._notes;
    const allTags = new Set();
    notes.forEach(n => (n.tags || []).forEach(t => allTags.add(t)));
    const container = document.getElementById('tagsList');
    if (!container) return;
    if (allTags.size === 0) {
      container.innerHTML = '<div style="padding:var(--s2) var(--s6);font-size:.8125rem;color:var(--c400)">暂无标签</div>';
      this.renderMobileTags();
      return;
    }
    container.innerHTML = Array.from(allTags).sort().map(tag => `
      <a class="sidebar__item" data-filter="${this.escapeHTML('tag:' + tag)}" data-action="set-filter">
        <svg class="sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
        ${this.escapeHTML(tag)}
        <span class="sidebar__count">${notes.filter(n => (n.tags || []).includes(tag)).length}</span>
      </a>
    `).join('');
    this.renderMobileTags();
  },

  // ===== 分类 CRUD =====

  async addCategory() {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    this.closeMobileSheets();
    const label = prompt('请输入新分类名称：', '新分类');
    if (!label || !label.trim()) return;
    const notebookId = this.draftNotebookId ?? this.getCurrentNotebookId();
    const body = { label: label.trim() };
    if (notebookId) body.notebookId = [notebookId];
    try {
      const category = await this.api('POST', apiPath('/categories'), body);
      await this.reloadCategories();
      this.setCategorySelection(category.id, notebookId);
      this.renderCategories();
      this.renderMobileFilters();
      this.toast('分类已添加');
    } catch (e) { this.toast(e.message); }
  },

  async addSubcategory(parentId, { selectInEditor = false } = {}) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    const parent = this.getCategoryById(parentId);
    if (!parent) return;
    this.closeMobileSheets();
    const label = prompt(`在「${parent.label}」下添加子分类：`, '新子分类');
    if (!label || !label.trim()) return;
    try {
      const category = await this.api('POST', apiPath('/categories'), {
        label: label.trim(),
        parentId: parent.id,
      });
      await this.reloadCategories();
      if (selectInEditor) {
        this.setCategorySelection(category.id, this.draftNotebookId);
        this.scheduleAutosave();
      }
      this.renderCategories();
      this.renderMobileFilters();
      this.toast('子分类已添加');
      return category;
    } catch (e) { this.toast(e.message); }
  },

  async addEditorSubcategory() {
    const parentId = document.getElementById('noteCategory')?.value;
    if (!parentId) { this.toast('请先选择分类'); return; }
    return this.addSubcategory(parentId, { selectInEditor: true });
  },

  async renameCategory(id) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    const cat = this.getCategoryById(id);
    if (!cat) return;
    this.closeMobileSheets();
    const label = prompt('请输入新的分类名称：', cat.label);
    if (!label || !label.trim() || label.trim() === cat.label) return;
    try {
      await this.api('PUT', apiPath('/categories/' + id), { label: label.trim() });
      await this.reloadCategories();
      this.renderCategories();
      this.renderMobileFilters();
      this.toast('分类已重命名');
    } catch (e) { this.toast(e.message); }
  },

  async deleteCategory(id) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    const cat = this.getCategoryById(id);
    if (!cat) return;
    this.closeMobileSheets();
    if (!confirm(`确定要删除分类「${cat.label}」吗？该分类下的笔记将移至「未分类」。`)) return;
    try {
      await this.api('DELETE', apiPath('/categories/' + id));
      await Promise.all([this.reloadCategories(), this.reloadNotes()]);
      this.renderCategories();
      this.renderMobileFilters();
      this.updateCounts();
      this.toast('分类已删除');
    } catch (e) { this.toast(e.message); }
  },
};
