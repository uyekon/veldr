import { apiPath } from '../config.js';
import { PAGE_CONTENT } from '../page-content.js';

// ===== 导航与顶部菜单（可编辑笔记本） =====
export const menuMethods = {
  navTo(target) {
    if (!this.confirmEditorExit()) return;
    this.currentNav = target;
    this.currentNote = null;
    this.currentFilter = 'all';
    this.searchQuery = '';
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    this.setSidebarActive('all');

    document.getElementById('browseView').style.display = 'none';
    document.getElementById('detailView').classList.remove('detail-view--active');
    document.getElementById('pageView').classList.remove('page-view--active');

    document.querySelectorAll('.topnav__link').forEach(l => l.classList.remove('topnav__link--active'));
    const menuEl = document.querySelector(`.topnav__link[data-nav="${target}"]`);
    if (menuEl) menuEl.classList.add('topnav__link--active');
    this.updateMobileNotebookLabel();
    this.renderMobileFilters();
    this.closeMobileSheets();

    const toc = document.getElementById('tocNav');
    toc.style.display = (window.innerWidth >= 1200 && target === 'docs') ? '' : 'none';

    if (target === 'docs') {
      document.getElementById('browseView').style.display = 'block';
      this.renderBrowseToc();
      this.updateCounts();
      this.renderNotes();
    } else {
      const menu = this._menus.find(m => m.id === target);
      if (menu && menu.type === 'page') {
        const pageEl = document.getElementById('pageView');
        pageEl.classList.add('page-view--active');
        let html;
        if (menu.contentKey && PAGE_CONTENT[menu.contentKey]) {
          html = PAGE_CONTENT[menu.contentKey];
        } else if (menu.content) {
          // 服务端存储的自定义 HTML，必须净化后再注入
          html = window.CMSMarkdown?.sanitize
            ? window.CMSMarkdown.sanitize(menu.content)
            : `<pre style="white-space:pre-wrap">${this.escapeHTML(menu.content)}</pre>`;
        } else {
          html = `<div class="page-view__title">${this.escapeHTML(menu.label)}</div><p>此页面暂无内容，你可以通过编辑菜单来添加自定义内容。</p>`;
        }
        pageEl.innerHTML = html;
      } else {
        document.getElementById('browseView').style.display = 'block';
        this.renderBrowseToc();
        this.updateCounts();
        this.renderNotes();
      }
    }

    this.syncHash();
  },

  renderMenus() {
    const container = document.getElementById('topMenu');
    const isEditor = this.role === 'editor';
    container.innerHTML = this._menus.map(m => `
      <div class="topnav__link ${this.currentNav === m.id ? 'topnav__link--active' : ''}"
           data-nav="${this.escapeHTML(m.id)}"
           data-action="nav" data-id="${this.escapeHTML(m.id)}"
           title="${isEditor ? '双击编辑名称 | 右键删除' : '查看模式'}">
        <span class="topnav__link-text">${this.escapeHTML(m.label)}</span>
        ${isEditor && m.id !== 'docs' ? `<span class="topnav__link-delete" data-action="delete-menu" data-id="${this.escapeHTML(m.id)}">✕</span>` : ''}
      </div>
    `).join('') + (isEditor ? `
      <button class="topnav__add-menu" data-action="add-menu" title="添加笔记本">+ Notebook</button>
    ` : '');
    this.updateMobileNotebookLabel();
    this.renderMobileNotebooks();
  },

  async startEditMenu(id, el) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    if (this.editingMenuId) return;
    this.editingMenuId = id;

    const menu = this._menus.find(m => m.id === id);
    const textSpan = el.querySelector('.topnav__link-text');
    const currentLabel = menu ? menu.label : textSpan.textContent;

    el.classList.add('topnav__link--editing');
    textSpan.innerHTML = `<input class="topnav__link-input" id="menuEditInput" value="${this.escapeHTML(currentLabel)}">`;

    const input = document.getElementById('menuEditInput');
    input.focus();
    input.select();

    const finish = async () => {
      const newLabel = input.value.trim();
      this.editingMenuId = null;
      if (newLabel && newLabel !== currentLabel) {
        try {
          await this.api('PUT', apiPath('/menus/' + id), { label: newLabel });
          await this.reloadMenus();
          this.renderMenus();
          if (this.currentNav === id) this.navTo(id);
          this.toast('菜单已更新');
        } catch (e) { this.toast(e.message); this.renderMenus(); }
      } else {
        this.renderMenus();
      }
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { this.editingMenuId = null; this.renderMenus(); }
    });
  },

  async addMenu() {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    this.closeMobileSheets();
    const label = prompt('请输入新笔记本名称：', '新笔记本');
    if (!label || !label.trim()) return;
    try {
      const menu = await this.api('POST', apiPath('/menus'), { label: label.trim(), type: 'notebook' });
      await this.reloadMenus();
      this.renderMenus();
      this.navTo(menu.id);
      this.toast('已添加笔记本');
    } catch (e) { this.toast(e.message); }
  },

  async renameMenu(id) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    const menu = this._menus.find(m => m.id === id);
    if (!menu) return;
    this.closeMobileSheets();
    const label = prompt('请输入新的笔记本名称：', menu.label);
    if (!label || !label.trim() || label.trim() === menu.label) return;
    try {
      await this.api('PUT', apiPath('/menus/' + id), { label: label.trim() });
      await this.reloadMenus();
      this.renderMenus();
      if (this.currentNav === id) this.navTo(id);
      this.toast('笔记本已更新');
    } catch (e) { this.toast(e.message); }
  },

  async deleteMenu(id) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    const menu = this._menus.find(m => m.id === id);
    if (!menu || id === 'docs') return;
    this.closeMobileSheets();
    if (!confirm(`确定要删除笔记本"${menu.label}"吗？其中的笔记会移回 Docs。`)) return;
    try {
      await this.api('DELETE', apiPath('/menus/' + id));
      await this.reloadMenus();
      await this.reloadNotes();
      if (this.currentNav === id) this.navTo('docs');
      this.renderMenus();
      this.toast('笔记本已删除');
    } catch (e) { this.toast(e.message); }
  },

  renderMobileNotebooks() {
    const container = document.getElementById('mobileNotebookList');
    const addBtn = document.getElementById('mobileAddNotebookBtn');
    if (!container) return;
    const isEditor = this.role === 'editor';
    if (addBtn) addBtn.style.display = isEditor ? 'flex' : 'none';

    container.innerHTML = this._menus.map(menu => {
      const isActive = this.currentNav === menu.id;
      const canEdit = isEditor && menu.id !== 'docs';
      const noteCount = menu.type === 'notebook'
        ? this._notes.filter(note => note.notebookId === menu.id).length
        : this._notes.length;
      return `
        <button class="mobile-sheet__item ${isActive ? 'mobile-sheet__item--active' : ''}" type="button" data-action="nav" data-id="${this.escapeHTML(menu.id)}">
          <span>${this.escapeHTML(menu.label)}</span>
          <span class="mobile-sheet__item-count">${noteCount}</span>
          ${canEdit ? `<span class="mobile-sheet__item-actions">
            <span class="mobile-sheet__icon-btn" title="重命名" data-action="rename-menu" data-id="${this.escapeHTML(menu.id)}">✎</span>
            <span class="mobile-sheet__icon-btn mobile-sheet__icon-btn--danger" title="删除" data-action="delete-menu" data-id="${this.escapeHTML(menu.id)}">×</span>
          </span>` : ''}
        </button>`;
    }).join('');
  },

  updateMobileNotebookLabel() {
    const label = document.getElementById('mobileNotebookLabel');
    if (!label) return;
    label.textContent = this.getCurrentNotebookLabel();
  },
};
