import { apiPath } from '../config.js';

// ===== 分类与标签 =====
export const categoryMethods = {
  getDefaultCategoryId() {
    return this._categories[0]?.id || 'work';
  },

  getCategoryById(id) {
    return this._categories.find(category => category.id === id) || null;
  },

  getCategoryLabel(id) {
    return this.getCategoryById(id)?.label || id || '未分类';
  },

  getCategoryFilter(id) {
    return `category:${id}`;
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
    select.innerHTML = this._categories.map(category => (
      `<option value="${this.escapeHTML(category.id)}">${this.escapeHTML(category.label)}</option>`
    )).join('');
    select.value = this.getCategoryById(value) ? value : this.getDefaultCategoryId();
  },

  renderCategories() {
    const container = document.getElementById('categoryList');
    const addBtn = document.getElementById('addCategoryBtn');
    if (!container) return;
    const isEditor = this.role === 'editor';
    if (addBtn) addBtn.style.display = isEditor ? 'flex' : 'none';
    const scopedNotes = this.getScopedNotes();

    if (!this._categories.length) {
      container.innerHTML = '<div style="padding:var(--s2) var(--s6);font-size:.8125rem;color:var(--c400)">暂无分类</div>';
      this.ensureCategoryOptions();
      return;
    }

    const visibleCategories = this._categories.filter((category) => (
      scopedNotes.some((note) => note.category === category.id)
    ));
    container.innerHTML = visibleCategories.map(category => {
      const filter = this.getCategoryFilter(category.id);
      const active = this.currentFilter === filter;
      const count = scopedNotes.filter(note => note.category === category.id).length;
      return `
        <a class="sidebar__item sidebar__category ${active ? 'sidebar__item--active' : ''}" data-filter="${this.escapeHTML(filter)}" data-action="set-filter">
          <svg class="sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h5l2 3h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 4"/></svg>
          <span class="sidebar__item-text">${this.escapeHTML(category.label)}</span>
          <span class="sidebar__count">${count}</span>
          ${isEditor ? `<span class="sidebar__item-actions">
            <button class="sidebar__icon-btn" type="button" title="重命名分类" data-action="rename-category" data-id="${this.escapeHTML(category.id)}">✎</button>
            <button class="sidebar__icon-btn sidebar__icon-btn--danger" type="button" title="删除分类" data-action="delete-category" data-id="${this.escapeHTML(category.id)}">×</button>
          </span>` : ''}
        </a>`;
    }).join('');
    this.ensureCategoryOptions();
  },

  async addCategory() {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    const label = prompt('请输入新分类名称：', '新分类');
    if (!label || !label.trim()) return;
    try {
      const category = await this.api('POST', apiPath('/categories'), { label: label.trim() });
      await this.reloadCategories();
      this.renderCategories();
      this.renderMobileFilters();
      this.setFilter(this.getCategoryFilter(category.id));
      this.toast('分类已添加');
    } catch (e) { this.toast(e.message); }
  },

  async renameCategory(id) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    const category = this.getCategoryById(id);
    if (!category) return;
    const label = prompt('请输入新的分类名称：', category.label);
    if (!label || !label.trim() || label.trim() === category.label) return;
    try {
      await this.api('PUT', apiPath('/categories/' + encodeURIComponent(id)), { label: label.trim() });
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
    const items = [
      { filter: 'all', label: '所有笔记', count: scopedNotes.length },
      ...this._categories.filter((category) => (
        scopedNotes.some((note) => note.category === category.id)
      )).map(category => ({
        filter: this.getCategoryFilter(category.id),
        label: category.label,
        count: scopedNotes.filter(n => n.category === category.id).length,
      })),
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
