import { apiPath } from '../config.js';

const WHITEBOARD_IDS = ['t', 'b', 'w', 'dailyPush', 'n'];
const WHITEBOARD_NAMES = { t: '白板', b: '白板 B', w: '白板 W', dailyPush: '每日推送', n: '日记' };

const formatUpdatedAt = (value) => {
  if (!value) return '尚未保存';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '已保存' : `上次保存 ${date.toLocaleString()}`;
};

const createWhiteboardState = (id) => ({
  whiteboard: { id, content: '', version: 1, updatedAt: null, archives: [] },
  dirty: false,
  saveTimer: null,
  saveInFlight: false,
  loadPromise: null,
});

export const whiteboardMethods = {
  openWhiteboard() {
    this.navTo('whiteboard');
  },

  getWhiteboardState(id = this.activeWhiteboardId) {
    if (!WHITEBOARD_IDS.includes(id)) return null;
    if (!this.whiteboardStates[id]) this.whiteboardStates[id] = createWhiteboardState(id);
    return this.whiteboardStates[id];
  },

  whiteboardItems() {
    return WHITEBOARD_IDS.map((id) => (
      this.whiteboards.find((whiteboard) => whiteboard.id === id)
      || { id, name: WHITEBOARD_NAMES[id] || id, updatedAt: this.getWhiteboardState(id)?.whiteboard.updatedAt || null }
    ));
  },

  showWhiteboard() {
    const view = document.getElementById('whiteboardView');
    if (!view) return;
    view.classList.add('whiteboard-view--active');
    const toc = document.getElementById('tocNav');
    if (toc) toc.style.display = window.innerWidth >= 1200 ? '' : 'none';
    document.getElementById('mainContent').scrollTop = 0;
    this.renderWhiteboardSwitcher();
    this.renderWhiteboardState('正在加载…');
    void this.loadWhiteboardList();
    void this.loadWhiteboard(this.activeWhiteboardId);
  },

  renderWhiteboardSwitcher() {
    const buttons = this.whiteboardItems().map((whiteboard) => {
      const active = whiteboard.id === this.activeWhiteboardId;
      return `<button class="whiteboard-switcher__button ${active ? 'whiteboard-switcher__button--active' : ''}" type="button" data-action="select-whiteboard" data-id="${whiteboard.id}" aria-pressed="${active}">
        <span>${this.escapeHTML(whiteboard.name || WHITEBOARD_NAMES[whiteboard.id] || whiteboard.id)}</span>
        <small>${whiteboard.updatedAt ? formatUpdatedAt(whiteboard.updatedAt).replace('上次保存 ', '') : '尚未保存'}</small>
      </button>`;
    }).join('');

    const mobileSwitcher = document.getElementById('whiteboardMobileSwitcher');
    if (mobileSwitcher) mobileSwitcher.innerHTML = buttons;

    const toc = document.getElementById('tocNav');
    if (toc && this.currentNav === 'whiteboard' && window.innerWidth >= 1200) {
      toc.innerHTML = `<div class="toc__title">切换白板</div><div class="whiteboard-switcher">${buttons}</div>`;
      toc.style.display = '';
    }
  },

  renderWhiteboardState(status) {
    const state = this.getWhiteboardState();
    const textarea = document.getElementById('whiteboardContent');
    const saveButton = document.getElementById('whiteboardSaveBtn');
    const statusEl = document.getElementById('whiteboardStatus');
    const title = document.getElementById('whiteboardTitle');
    const diaryTools = document.getElementById('diaryTools');
    if (title) title.textContent = WHITEBOARD_NAMES[this.activeWhiteboardId] || `白板 ${this.activeWhiteboardId}`;
    if (diaryTools) diaryTools.style.display = this.activeWhiteboardId === 'n' ? '' : 'none';
    if (textarea) {
      textarea.readOnly = this.role !== 'editor';
      textarea.setAttribute('aria-label', `白板 ${this.activeWhiteboardId} 内容`);
    }
    if (saveButton) saveButton.style.display = this.role === 'editor' ? '' : 'none';
    if (statusEl) {
      statusEl.textContent = status || (state.dirty ? '有未保存的修改' : formatUpdatedAt(state.whiteboard.updatedAt));
    }
    if (this.activeWhiteboardId === 'n') {
      this.renderDiaryCategories();
      this.renderDiaryArchives();
    }
  },

  async loadWhiteboardList() {
    if (this.whiteboardListLoadPromise) return this.whiteboardListLoadPromise;
    this.whiteboardListLoadPromise = this.api('GET', apiPath('/whiteboards'))
      .then((whiteboards) => {
        this.whiteboards = WHITEBOARD_IDS.map((id) => (
          whiteboards.find((whiteboard) => whiteboard.id === id) || { id, name: WHITEBOARD_NAMES[id] || id, updatedAt: null }
        ));
        this.renderWhiteboardSwitcher();
        return this.whiteboards;
      })
      .catch((error) => {
        this.toast(error.message || '白板列表加载失败');
        return null;
      })
      .finally(() => { this.whiteboardListLoadPromise = null; });
    return this.whiteboardListLoadPromise;
  },

  async loadWhiteboard(id = this.activeWhiteboardId, options = {}) {
    const state = this.getWhiteboardState(id);
    if (state.loadPromise) return state.loadPromise;
    state.loadPromise = this.api('GET', apiPath(`/whiteboards/${id}`))
      .then((whiteboard) => {
        if (!state.dirty || options.force) {
          state.whiteboard = whiteboard;
          if (this.activeWhiteboardId === id) {
            const textarea = document.getElementById('whiteboardContent');
            if (textarea) textarea.value = whiteboard.content || '';
            this.renderWhiteboardState();
          }
        }
        this.updateWhiteboardMetadata(whiteboard);
        return whiteboard;
      })
      .catch((error) => {
        if (this.activeWhiteboardId === id) this.renderWhiteboardState('白板加载失败');
        this.toast(error.message || '白板加载失败');
        return null;
      })
      .finally(() => { state.loadPromise = null; });
    return state.loadPromise;
  },

  updateWhiteboardMetadata(whiteboard) {
    const index = this.whiteboards.findIndex((item) => item.id === whiteboard.id);
    const item = { id: whiteboard.id, name: WHITEBOARD_NAMES[whiteboard.id] || whiteboard.id, updatedAt: whiteboard.updatedAt };
    if (index === -1) this.whiteboards.push(item);
    else this.whiteboards[index] = item;
    this.renderWhiteboardSwitcher();
  },

  renderDiaryCategories() {
    const select = document.getElementById('diaryArticleCategory');
    if (!select || !Array.isArray(this._categories)) return;
    const current = select.value;
    select.innerHTML = this._categories.map((category) => (
      `<option value="${this.escapeHTML(category.id)}">${this.escapeHTML(`${'— '.repeat(this.getCategoryDepth(category))}${category.label}`)}</option>`
    )).join('');
    if (this._categories.some((category) => category.id === current)) select.value = current;
  },

  renderDiaryArchives() {
    const list = document.getElementById('diaryArchives');
    if (!list) return;
    const archives = this.getWhiteboardState('n')?.whiteboard.archives || [];
    list.innerHTML = archives.length ? archives.slice().reverse().map((archive) => `
      <button class="diary__archive" type="button" data-action="restore-diary-archive" data-id="${this.escapeHTML(archive.id)}">
        <span>${this.escapeHTML(archive.title || '日记归档')}</span>
        <small>${this.escapeHTML(new Date(archive.createdAt).toLocaleString())}</small>
      </button>`).join('') : '<span class="diary__empty">暂无归档</span>';
  },

  async archiveDiary() {
    if (this.activeWhiteboardId !== 'n' || this.role !== 'editor') return;
    if (!await this.saveWhiteboard({ quiet: true })) return;
    const state = this.getWhiteboardState('n');
    try {
      const archive = await this.api('POST', apiPath('/whiteboards/n/archives'), {
        title: document.getElementById('diaryArchiveTitle')?.value.trim() || '日记归档',
        content: state.whiteboard.content,
      });
      state.whiteboard.archives = [...(state.whiteboard.archives || []), archive].slice(-100);
      this.renderDiaryArchives();
      this.toast('日记已归档');
    } catch (error) { this.toast(error.message || '归档失败'); }
  },

  async restoreDiaryArchive(id) {
    if (this.role !== 'editor') return;
    const state = this.getWhiteboardState('n');
    if (state.dirty && !confirm('当前日记有未保存修改，仍要载入归档吗？')) return;
    try {
      const archive = await this.api('GET', apiPath(`/whiteboards/n/archives/${encodeURIComponent(id)}`));
      const textarea = document.getElementById('whiteboardContent');
      if (textarea) textarea.value = archive.content || '';
      state.whiteboard = { ...state.whiteboard, content: archive.content || '' };
      state.dirty = true;
      this.handleWhiteboardInput();
      this.renderWhiteboardState('已载入归档，等待自动保存…');
    } catch (error) { this.toast(error.message || '归档加载失败'); }
  },

  async saveDiaryAsArticle() {
    if (this.activeWhiteboardId !== 'n' || this.role !== 'editor') return;
    const title = document.getElementById('diaryArticleTitle')?.value.trim();
    const content = this.getWhiteboardState('n')?.whiteboard.content || '';
    const category = document.getElementById('diaryArticleCategory')?.value;
    const tags = document.getElementById('diaryArticleTags')?.value.split(',').map((tag) => tag.trim()).filter(Boolean) || [];
    if (!title) { this.toast('请输入文章标题'); return; }
    if (!content.trim()) { this.toast('日记内容为空'); return; }
    if (!await this.saveWhiteboard({ quiet: true })) return;
    try {
      await this.api('POST', apiPath('/notes'), { title, content, category, tags, notebookId: null });
      await this.reloadNotes();
      this.toast('已保存为文章');
    } catch (error) { this.toast(error.message || '保存文章失败'); }
  },

  async selectWhiteboard(id) {
    if (!WHITEBOARD_IDS.includes(id) || id === this.activeWhiteboardId) return;
    const current = this.getWhiteboardState();
    if (current.saveInFlight) {
      this.toast('当前白板正在保存');
      return;
    }
    if (current.dirty && !await this.saveWhiteboard({ quiet: true })) return;

    this.activeWhiteboardId = id;
    this.renderWhiteboardSwitcher();
    this.renderWhiteboardState('正在加载…');
    await this.loadWhiteboard(id);
    this.syncHash();
  },

  handleWhiteboardInput() {
    if (this.role !== 'editor') return;
    const state = this.getWhiteboardState();
    const textarea = document.getElementById('whiteboardContent');
    if (!textarea) return;
    state.whiteboard = { ...state.whiteboard, content: textarea.value };
    state.dirty = true;
    this.renderWhiteboardState();
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => this.saveWhiteboard({ quiet: true }), 800);
  },

  async saveWhiteboard(options = {}) {
    const id = options.id || this.activeWhiteboardId;
    const state = this.getWhiteboardState(id);
    if (this.role !== 'editor' || state.saveInFlight) return false;
    const textarea = document.getElementById('whiteboardContent');
    const content = id === this.activeWhiteboardId && textarea ? textarea.value : state.whiteboard.content;
    clearTimeout(state.saveTimer);
    state.saveInFlight = true;
    if (id === this.activeWhiteboardId) this.renderWhiteboardState('正在保存…');
    try {
      const whiteboard = await this.api('PUT', apiPath(`/whiteboards/${id}`), {
        content,
        version: state.whiteboard.version,
      });
      state.whiteboard = whiteboard;
      state.dirty = false;
      this.updateWhiteboardMetadata(whiteboard);
      if (id === this.activeWhiteboardId) this.renderWhiteboardState();
      if (!options.quiet) this.toast(`白板 ${id} 已保存`);
      return true;
    } catch (error) {
      if (error.status === 409 && confirm('白板已在其他设备更新。要用当前内容覆盖服务器版本吗？')) {
        try {
          const whiteboard = await this.api('PUT', apiPath(`/whiteboards/${id}`), { content, force: true });
          state.whiteboard = whiteboard;
          state.dirty = false;
          this.updateWhiteboardMetadata(whiteboard);
          if (id === this.activeWhiteboardId) this.renderWhiteboardState();
          if (!options.quiet) this.toast(`白板 ${id} 已覆盖保存`);
          return true;
        } catch (forceError) {
          if (id === this.activeWhiteboardId) this.renderWhiteboardState('保存失败');
          if (!options.quiet) this.toast(forceError.message || '白板保存失败');
          return false;
        }
      }
      if (id === this.activeWhiteboardId) this.renderWhiteboardState('保存失败，请重试');
      if (!options.quiet) this.toast(error.message || '白板保存失败');
      return false;
    } finally {
      state.saveInFlight = false;
    }
  },

  hasUnsavedWhiteboardInput() {
    return this.currentNav === 'whiteboard' && this.getWhiteboardState()?.dirty;
  },

  confirmWhiteboardExit() {
    if (!this.hasUnsavedWhiteboardInput()) return true;
    if (!confirm('白板有未保存的修改，确定要离开吗？')) return false;
    void this.saveWhiteboard({ quiet: true });
    return true;
  },
};
