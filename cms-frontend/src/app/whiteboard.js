import { apiPath } from '../config.js';

const WHITEBOARD_IDS = ['t', 'b', 'w', 'dailyPush'];

const formatUpdatedAt = (value) => {
  if (!value) return '尚未保存';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '已保存' : `上次保存 ${date.toLocaleString()}`;
};

const createWhiteboardState = (id) => ({
  whiteboard: { id, content: '', version: 1, updatedAt: null },
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
      || { id, name: id, updatedAt: this.getWhiteboardState(id)?.whiteboard.updatedAt || null }
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
        <span>${whiteboard.id}</span>
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
    if (title) title.textContent = `白板 ${this.activeWhiteboardId}`;
    if (textarea) {
      textarea.readOnly = this.role !== 'editor';
      textarea.setAttribute('aria-label', `白板 ${this.activeWhiteboardId} 内容`);
    }
    if (saveButton) saveButton.style.display = this.role === 'editor' ? '' : 'none';
    if (statusEl) {
      statusEl.textContent = status || (state.dirty ? '有未保存的修改' : formatUpdatedAt(state.whiteboard.updatedAt));
    }
  },

  async loadWhiteboardList() {
    if (this.whiteboardListLoadPromise) return this.whiteboardListLoadPromise;
    this.whiteboardListLoadPromise = this.api('GET', apiPath('/whiteboards'))
      .then((whiteboards) => {
        this.whiteboards = WHITEBOARD_IDS.map((id) => (
          whiteboards.find((whiteboard) => whiteboard.id === id) || { id, name: id, updatedAt: null }
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
    const item = { id: whiteboard.id, name: whiteboard.id, updatedAt: whiteboard.updatedAt };
    if (index === -1) this.whiteboards.push(item);
    else this.whiteboards[index] = item;
    this.renderWhiteboardSwitcher();
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
