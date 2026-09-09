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
    if (!category?.notebookId) return '';
    return this._menus.find(m => m.id === category.notebookId)?.label || null;
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

  ensureCategoryOptions(selectedId) {
    const select = document.getElementById('noteCategory');
    if (!select) return;
    const value = selectedId || select.value || this.getDefaultCategoryId();
    const roots = this._categories.filter(category => !category.parentId);
    select.innerHTML = roots.map(category => (
      `<option value="${this.escapeHTML(category.id)}">${this.escapeHTML(category.label)}</option>`
    )).join('');
    const selected = this.getCategoryById(value);
    select.value = selected?.parentId || (selected && !selected.parentId ? selected.id : this.getDefaultCategoryId());
    this.syncSubcategoryOptions(value);
  },

  syncSubcategoryOptions(selectedId) {
    const parentSelect = document.getElementById('noteCategory');
    const childSelect = document.getElementById('noteSubcategory');
    if (!parentSelect || !childSelect) return;
    const selected = this.getCategoryById(selectedId || parentSelect.value);
    const parentId = selected?.parentId || parentSelect.value;
    const children = this._categories.filter(category => category.parentId === parentId);
    childSelect.innerHTML = `<option value="">${children.length ? '不使用子分类' : '无子分类'}</option>${children.map(category => `<option value="${this.escapeHTML(category.id)}">${this.escapeHTML(category.label)}</option>`).join('')}`;
    childSelect.disabled = children.length === 0;
    if (selected?.parentId === parentId) childSelect.value = selected.id;
  },

  getSelectedCategoryId() {
    return document.getElementById('noteSubcategory')?.value || document.getElementById('noteCategory')?.value || this.getDefaultCategoryId();
  },

  setCategorySelection(id) {
    this.ensureCategoryOptions(id);
    this.syncSubcategoryOptions(id);
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
    // Group by label: same label across notebooks merges into one sidebar entry.
    const labelMap = new Map();
    const scopedCategoryIds = new Set(scopedNotes.map(n => n.category));
    this._categories.forEach(cat => {
      const subtreeIds = this.getCategorySubtreeIds(cat.id);
      const hasNotes = [...subtreeIds].some(id => scopedCategoryIds.has(id));
      if (!hasNotes) return;
      const existing = labelMap.get(cat.label) || {
        label: cat.label,
        entries: [],
        count: 0,
        representativeId: null,
        notebookLabel: null,
        children: [],
      };
      // Count notes under this category (subtree-scoped to notebook filter).
      existing.count += this.countCategoryNotes(cat.id, scopedNotes);
      if (!existing.entries.some(e => e.id === cat.id)) {
        existing.entries.push(cat);
      }
      // Prefer representative with a notebookId.
      if (!existing.representativeId) {
        existing.representativeId = cat.id;
        existing.notebookLabel = this.getCategoryNotebookLabel(cat);
      } else if (cat.notebookId && !existing.notebookLabel) {
        existing.representativeId = cat.id;
        existing.notebookLabel = this.getCategoryNotebookLabel(cat);
      }
      labelMap.set(cat.label, existing);
    });

    // Deduplicate: keep one entry per label.
    const groups = [];
    const seenIds = new Set();
    labelMap.forEach((group) => {
      if (seenIds.has(group.representativeId)) return;
      seenIds.add(group.representativeId);
      // Collect direct children of the representative.
      group.children = this.getChildrenOf(group.representativeId);
      groups.push(group);
    });

    const renderChild = (category) => {
      const filter = this.getCategoryFilter(category.id);
      const active = this.currentFilter === filter;
      const count = this.countCategoryNotes(category.id, scopedNotes);
      const childChildren = this.getChildrenOf(category.id);
      const childHtml = childChildren.length
        ? `<div class="sidebar__category-children">${childChildren.map(c => this._renderChildLink(c, scopedNotes)).join('')}</div>`
        : '';
      return `<a class="sidebar__item sidebar__category ${active ? 'sidebar__item--active' : ''}" data-filter="${this.escapeHTML(filter)}" data-action="set-filter">
        <svg class="sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h5l2 3h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 4"/></svg>
        <span class="sidebar__item-text">${this.escapeHTML(category.label)}</span>
        <span class="sidebar__count">${count}</span>
      </a>${childHtml}`;
    };

    const renderGroup = (group) => {
      const filter = this.getCategoryFilter(group.representativeId);
      const active = this.currentFilter === filter || group.children.some(c => this.currentFilter === this.getCategoryFilter(c.id));
      const notebookLabel = group.notebookLabel
        ? `<span class="sidebar__category-notebook">${this.escapeHTML(group.notebookLabel)}</span>`
        : '';
      const childrenHtml = group.children.length
        ? `<div class="sidebar__category-children">${group.children.map(c => this._renderChildLink(c, scopedNotes)).join('')}</div>`
        : '';
      const actions = isEditor ? `<span class="sidebar__item-actions">
        <button class="sidebar__icon-btn" type="button" title="重命名分类" data-action="rename-category" data-id="${this.escapeHTML(group.representativeId)}">✎</button>
        <button class="sidebar__icon-btn" type="button" title="添加子分类" data-action="add-subcategory" data-id="${this.escapeHTML(group.representativeId)}">＋</button>
        <button class="sidebar__icon-btn sidebar__icon-btn--danger" type="button" title="删除分类" data-action="delete-category" data-id="${this.escapeHTML(group.representativeId)}">×</button>
      </span>` : '';
      return `<div class="sidebar__category-group ${group.children.length && active ? 'sidebar__category-group--active' : ''}">
        <a class="sidebar__item sidebar__category ${active ? 'sidebar__item--active' : ''}" data-filter="${this.escapeHTML(filter)}" data-action="set-filter">
          <svg class="sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h5l2 3h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 4"/></svg>
          <span class="sidebar__item-text">${this.escapeHTML(group.label)}</span>
          ${notebookLabel}
          ${group.children.length ? '<span class="sidebar__category-chevron" aria-hidden="true">›</span>' : ''}
          <span class="sidebar__count">${group.count}</span>
          ${actions}
        </a>${childrenHtml}</div>`;
    };

    container.innerHTML = groups.map(renderGroup).join('');
  },

  _renderChildLink(category, scopedNotes) {
    const filter = this.getCategoryFilter(category.id);
    const active = this.currentFilter === filter;
    const count = this.countCategoryNotes(category.id, scopedNotes);
    const childChildren = this.getChildrenOf(category.id);
    const childHtml = childChildren.length
      ? `<div class="sidebar__category-children">${childChildren.map(c => this._renderChildLink(c, scopedNotes)).join('')}</div>`
      : '';
    return `<a class="sidebar__item sidebar__category ${active ? 'sidebar__item--active' : ''}" data-filter="${this.escapeHTML(filter)}" data-action="set-filter">
      <svg class="sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h5l2 3h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 4"/></svg>
      <span class="sidebar__item-text">${this.escapeHTML(category.label)}</span>
      <span class="sidebar__count">${count}</span>
    </a>${childHtml}`;
  },

  _renderCategoriesNotebookView(container, isEditor, scopedNotes, notebookId) {
    // In notebook view, only show categories that belong to the current notebook.
    const visibleCategories = this._categories.filter(category => {
      if (notebookId && category.notebookId !== notebookId) return false;
      const ids = this.getCategorySubtreeIds(category.id);
      return [...ids].some(id => scopedNotes.some(n => n.category === id));
    });

    const renderCategory = (category) => {
      const filter = this.getCategoryFilter(category.id);
      const active = this.currentFilter === filter;
      const count = this.countCategoryNotes(category.id, scopedNotes);
      const children = visibleCategories.filter(child => child.parentId === category.id);
      const childActive = children.some(child => this.currentFilter === this.getCategoryFilter(child.id));
      const notebookLabel = this.getCategoryNotebookLabel(category)
        ? `<span class="sidebar__category-notebook">${this.escapeHTML(this.getCategoryNotebookLabel(category))}</span>`
        : '';
      return `<div class="sidebar__category-group ${children.length && (active || childActive) ? 'sidebar__category-group--active' : ''}">
        <a class="sidebar__item sidebar__category ${active ? 'sidebar__item--active' : ''}" data-filter="${this.escapeHTML(filter)}" data-action="set-filter">
          <svg class="sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h5l2 3h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 4"/></svg>
          <span class="sidebar__item-text">${this.escapeHTML(category.label)}</span>
          ${notebookLabel}
          ${children.length ? '<span class="sidebar__category-chevron" aria-hidden="true">›</span>' : ''}
          <span class="sidebar__count">${count}</span>
          ${isEditor ? `<span class="sidebar__item-actions">
            <button class="sidebar__icon-btn" type="button" title="重命名分类" data-action="rename-category" data-id="${this.escapeHTML(category.id)}">✎</button>
            <button class="sidebar__icon-btn" type="button" title="添加子分类" data-action="add-subcategory" data-id="${this.escapeHTML(category.id)}">＋</button>
            <button class="sidebar__icon-btn sidebar__icon-btn--danger" type="button" title="删除分类" data-action="delete-category" data-id="${this.escapeHTML(category.id)}">×</button>
          </span>` : ''}
        </a>${children.length ? `<div class="sidebar__category-children">${children.map(renderCategory).join('')}</div>` : ''}</div>`;
    };

    const roots = visibleCategories.filter(category => !category.parentId || !visibleCategories.some(parent => parent.id === category.parentId));
    container.innerHTML = roots.map(renderCategory).join('');
  },

  async addCategory() {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    const label = prompt('请输入新分类名称：', '新分类');
    if (!label || !label.trim()) return;
    try {
      const notebookId = this.getCurrentNotebookId();
      const category = await this.api('POST', apiPath('/categories'), { label: label.trim(), parentId: null, notebookId });
      await this.reloadCategories();
      this.renderCategories();
      this.renderMobileFilters();
      this.setFilter(this.getCategoryFilter(category.id));
      this.toast('分类已添加');
    } catch (e) { this.toast(e.message); }
  },

  async addSubcategory(parentId) {
    if (this.role !== 'editor') { this.toast('需要管理员登录'); return; }
    const parent = this.getCategoryById(parentId);
    if (!parent) return;
    const label = prompt(`请输入"${parent.label}"下的子分类名称：`, '新子分类');
    if (!label || !label.trim()) return;
    try {
      const notebookId = this.getCurrentNotebookId();
      const category = await this.api('POST', apiPath('/categories'), { label: label.trim(), parentId, notebookId });
      await this.reloadCategories(); this.renderCategories(); this.renderMobileFilters();
      this.setFilter(this.getCategoryFilter(category.id)); this.toast('子分类已添加');
    } catch (e) { this.toast(e.message); }
  },

  async renameCategory(id) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    const category = this.getCategoryById(id);
    if (!category) return;
    const label = prompt('请输入新的分类名称：', category.label);
    if (!label || !label.trim() || label.trim() === category.label) return;
    try {
      await this.api('PUT', apiPath('/categories/' + encodeURIComponent(id)), { label: label.trim(), notebookId: category.notebookId });
      await this.reloadCategories();
      this.renderCategories();
      this.renderMobileFilters();
      this.renderNotes();
      this.toast('分类已更新');
    } catch (e) { this.toast(e.message); }
  },

  async deleteCategory(id) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    const category = this.getCategoryById(id);
    if (!category) return;
    if (!confirm(`确定要删除分类"${category.label}"吗？其中的笔记会移到剩余分类。`)) return;
    try {
      await this.api('DELETE', apiPath('/categories/' + encodeURIComponent(id)));
      await this.reloadCategories();
      await this.reloadNotes();
      if (this.currentFilter === this.getCategoryFilter(id)) this.currentFilter = 'all';
      this.renderCategories();
      this.renderTags();
      this.updateCounts();
      this.renderNotes();
      this.toast('分类已删除');
    } catch (e) { this.toast(e.message); }
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
      // Group by label across all notebooks.
      const labelGroups = new Map();
      this._categories.forEach(cat => {
        const ids = this.getCategorySubtreeIds(cat.id);
        const matches = [...ids].filter(id => scopedNotes.some(n => n.category === id));
        if (matches.length === 0) return;
        const existing = labelGroups.get(cat.label) || { label: cat.label, count: 0, ids: new Set(), notebookLabel: null };
        existing.count += this.countCategoryNotes(cat.id, scopedNotes);
        matches.forEach(m => existing.ids.add(m));
        if (!existing.notebookLabel && cat.notebookId) {
          existing.notebookLabel = this._menus.find(m => m.id === cat.notebookId)?.label || null;
        }
        labelGroups.set(cat.label, existing);
      });
      labelGroups.forEach((group, label) => {
        const sampleId = [...group.ids][0];
        categoryItems.push({
          filter: this.getCategoryFilter(sampleId),
          label: `${group.notebookLabel ? `— ${group.notebookLabel}` : ''}${label}`.trimStart(),
          count: group.count,
        });
      });
    } else {
      // Notebook view: only show categories belonging to current notebook.
      this._categories
        .filter(cat => {
          if (notebookId && cat.notebookId !== notebookId) return false;
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
};
