import { apiPath } from '../config.js';

const WHITEBOARD_IDS = ['t', 'b', 'w', 'dailyPush', 'n'];

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
  savePromise: null,
  revision: 0,
  converting: false,
  conversionRequest: null,
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
      || { id, updatedAt: this.getWhiteboardState(id)?.whiteboard.updatedAt || null }
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
        <span>${this.escapeHTML(whiteboard.id)}</span>
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
    const diaryConvertBtn = document.getElementById('diaryConvertBtn');
    if (title) title.textContent = this.activeWhiteboardId;
    if (diaryConvertBtn) diaryConvertBtn.style.display = this.activeWhiteboardId === 'n' && this.role === 'editor' ? '' : 'none';
    if (textarea) {
      textarea.readOnly = this.role !== 'editor' || state.converting || Boolean(state.conversionRequest);
      textarea.setAttribute('aria-label', `白板 ${this.activeWhiteboardId} 内容`);
    }
    if (saveButton) saveButton.style.display = this.role === 'editor' ? '' : 'none';
    if (statusEl) {
      statusEl.textContent = status || (state.dirty ? '有未保存的修改' : formatUpdatedAt(state.whiteboard.updatedAt));
    }
    const submit = document.getElementById('diarySubmitBtn');
    if (submit) { submit.disabled = state.converting; submit.textContent = state.converting ? '正在转换…' : state.conversionRequest ? '重试确认转换结果' : '转为文章并清空白板'; }
    for (const id of ['diaryArticleTitle', 'diaryArticleNotebook', 'diaryArticleCategory', 'diaryArticleTags']) {
      const field = document.getElementById(id);
      if (field) field.disabled = state.converting || Boolean(state.conversionRequest);
    }
  },

  async loadWhiteboardList() {
    if (this.whiteboardListLoadPromise) return this.whiteboardListLoadPromise;
    this.whiteboardListLoadPromise = this.api('GET', apiPath('/whiteboards'))
      .then((whiteboards) => {
        this.whiteboards = WHITEBOARD_IDS.map((id) => (
          whiteboards.find((whiteboard) => whiteboard.id === id) || { id, updatedAt: null }
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
        if ((!state.dirty && !state.saveInFlight && !state.converting && !state.conversionRequest && Number(whiteboard.version) >= Number(state.whiteboard.version)) || options.force) {
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
    const item = { id: whiteboard.id, updatedAt: whiteboard.updatedAt };
    if (index === -1) this.whiteboards.push(item);
    else this.whiteboards[index] = item;
    this.renderWhiteboardSwitcher();
  },

  renderDiaryCategories() {
    const select = document.getElementById('diaryArticleCategory');
    if (!select || !Array.isArray(this._categories)) return;
    const current = select.value;
    const notebookId = document.getElementById('diaryArticleNotebook')?.value;
    const categories = this._categories.filter(category => {
      const seen = new Set();
      let item = category;
      while (item && !seen.has(item.id)) {
        seen.add(item.id);
        const scope = Array.isArray(item.notebookId) ? item.notebookId : item.notebookId ? [item.notebookId] : [];
        if (scope.length && !scope.includes(notebookId)) return false;
        item = this._categories.find(parent => parent.id === item.parentId);
      }
      return true;
    });
    select.innerHTML = categories.length ? categories.map((category) => (
      `<option value="${this.escapeHTML(category.id)}">${this.escapeHTML(`${'— '.repeat(this.getCategoryDepth(category))}${category.label}`)}</option>`
    )).join('') : '<option value="">该 Notebook 暂无可用分类</option>';
    if (categories.some((category) => category.id === current)) select.value = current;
  },

  renderDiaryNotebooks() {
    const select = document.getElementById('diaryArticleNotebook');
    if (!select || !Array.isArray(this._menus)) return;
    const current = select.value;
    const notebooks = this._menus.filter((menu) => menu.type === 'notebook');
    select.innerHTML = notebooks.map((menu) => `<option value="${this.escapeHTML(menu.id)}">${this.escapeHTML(menu.label)}</option>`).join('');
    if (!notebooks.length) select.innerHTML = '<option value="">请先新建 Notebook</option>';
    if (notebooks.some((menu) => menu.id === current)) select.value = current;
  },

  openDiaryArchiveModal() {
    if (this.activeWhiteboardId !== 'n' || this.role !== 'editor') return;
    if (!this.getWhiteboardState('n').conversionRequest && !this.getWhiteboardState('n').whiteboard.content.trim()) { this.toast('日记内容为空'); return; }
    this.renderDiaryNotebooks();
    this.renderDiaryCategories();
    document.getElementById('diaryArchiveModal')?.classList.add('modal-overlay--active');
    document.getElementById('diaryArticleTitle')?.focus();
  },

  closeDiaryArchiveModal() {
    if (this.getWhiteboardState('n').converting) return;
    document.getElementById('diaryArchiveModal')?.classList.remove('modal-overlay--active');
    document.getElementById('diaryConvertBtn')?.focus();
  },

  async archiveDiary() {
    if (this.activeWhiteboardId !== 'n' || this.role !== 'editor') return;
    const state = this.getWhiteboardState('n');
    if (state.converting) return;
    const title = document.getElementById('diaryArticleTitle')?.value.trim();
    const notebookId = document.getElementById('diaryArticleNotebook')?.value;
    const category = document.getElementById('diaryArticleCategory')?.value;
    const tags = document.getElementById('diaryArticleTags')?.value.split(',').map((tag) => tag.trim()).filter(Boolean) || [];
    if (!title) { this.toast('请输入文章标题'); return; }
    if (!notebookId || !category) { this.toast('请选择有效的 Notebook 和分类'); return; }
    if (!state.whiteboard.content.trim()) { this.toast('日记内容为空'); return; }
    state.converting = true;
    this.renderWhiteboardState();
    try {
      if (!state.conversionRequest) {
        if (!await this.saveWhiteboard({ quiet: true, id: 'n' })) return;
        state.conversionRequest = { title, notebookId, category, tags, version: state.whiteboard.version, requestId: crypto.randomUUID() };
      }
      const result = await this.api('POST', apiPath('/whiteboards/n/archive'), state.conversionRequest);
      state.conversionRequest = null;
      state.whiteboard = result.whiteboard;
      state.dirty = false;
      const textarea = document.getElementById('whiteboardContent');
      if (textarea && this.activeWhiteboardId === 'n') textarea.value = result.whiteboard.content;
      this.updateWhiteboardMetadata(result.whiteboard);
      await this.reloadNotes();
      this.updateCounts(); this.renderTags();
      state.converting = false;
      this.closeDiaryArchiveModal();
      ['diaryArticleTitle', 'diaryArticleTags'].forEach((id) => { const field = document.getElementById(id); if (field) field.value = ''; });
      this.renderWhiteboardState();
      this.toast('已归档为文章，日记白板已清空');
    } catch (error) {
      if ([400, 404, 409].includes(error.status)) state.conversionRequest = null;
      this.toast(error.message || '结果尚未确认，请重试；当前内容已保留');
    } finally { state.converting = false; this.renderWhiteboardState(); }
  },

  async selectWhiteboard(id) {
    if (!WHITEBOARD_IDS.includes(id) || id === this.activeWhiteboardId) return;
    const current = this.getWhiteboardState();
    if (current.converting || current.conversionRequest) {
      this.toast('请先确认转换结果');
      return;
    }
    if ((current.dirty || current.saveInFlight) && !await this.saveWhiteboard({ quiet: true })) return;

    this.activeWhiteboardId = id;
    this.renderWhiteboardSwitcher();
    this.renderWhiteboardState('正在加载…');
    await this.loadWhiteboard(id);
    this.syncHash();
  },

  handleWhiteboardInput() {
    if (this.role !== 'editor') return;
    const state = this.getWhiteboardState();
    if (state.converting || state.conversionRequest) return;
    const textarea = document.getElementById('whiteboardContent');
    if (!textarea) return;
    state.whiteboard = { ...state.whiteboard, content: textarea.value };
    state.dirty = true;
    state.revision += 1;
    this.renderWhiteboardState();
    clearTimeout(state.saveTimer);
    const id = this.activeWhiteboardId;
    state.saveTimer = setTimeout(() => this.saveWhiteboard({ quiet: true, id }), 800);
  },

  async saveWhiteboard(options = {}) {
    const id = options.id || this.activeWhiteboardId;
    const state = this.getWhiteboardState(id);
    if (this.role !== 'editor' || state.conversionRequest) return false;
    if (state.savePromise) return state.savePromise;
    clearTimeout(state.saveTimer);
    state.saveInFlight = true;
    state.savePromise = this.drainWhiteboardSaves(id, options);
    try { return await state.savePromise; }
    finally { state.saveInFlight = false; state.savePromise = null; }
  },

  async drainWhiteboardSaves(id, options) {
    const state = this.getWhiteboardState(id);
    do {
    const revision = state.revision;
    const content = state.whiteboard.content;
    if (id === this.activeWhiteboardId) this.renderWhiteboardState('正在保存…');
    try {
      const whiteboard = await this.api('PUT', apiPath(`/whiteboards/${id}`), {
        content,
        version: state.whiteboard.version,
      });
      const changed = state.revision !== revision;
      state.whiteboard = { ...whiteboard, content: changed ? state.whiteboard.content : whiteboard.content };
      state.dirty = changed;
      this.updateWhiteboardMetadata(whiteboard);
      if (id === this.activeWhiteboardId) this.renderWhiteboardState();
    } catch (error) {
      if (error.status === 409 && error.current?.content === content) {
        state.whiteboard.version = error.current.version;
        state.dirty = state.revision !== revision;
        continue;
      }
      if (error.status === 409 && confirm('白板已在其他设备更新。要用当前内容覆盖服务器版本吗？')) {
        try {
          const whiteboard = await this.api('PUT', apiPath(`/whiteboards/${id}`), { content, force: true });
          const changed = state.revision !== revision;
          state.whiteboard = { ...whiteboard, content: changed ? state.whiteboard.content : content };
          state.dirty = changed;
          this.updateWhiteboardMetadata(whiteboard);
          if (id === this.activeWhiteboardId) this.renderWhiteboardState();
          if (!options.quiet) this.toast(`白板 ${id} 已覆盖保存`);
          continue;
        } catch (forceError) {
          if (id === this.activeWhiteboardId) this.renderWhiteboardState('保存失败');
          if (!options.quiet) this.toast(forceError.message || '白板保存失败');
          return false;
        }
      }
      if (id === this.activeWhiteboardId) this.renderWhiteboardState('保存失败，请重试');
      if (!options.quiet) this.toast(error.message || '白板保存失败');
      return false;
    }
    } while (state.dirty);
    clearTimeout(state.saveTimer);
    if (!options.quiet) this.toast(`白板 ${id} 已保存`);
    return true;
  },

  hasUnsavedWhiteboardInput() {
    return Object.values(this.whiteboardStates).some(state => state.dirty || state.saveInFlight || state.converting || state.conversionRequest);
  },

  confirmWhiteboardExit() {
    if (this.getWhiteboardState()?.converting || this.getWhiteboardState()?.conversionRequest) {
      this.toast('请先确认日记转换结果'); return false;
    }
    if (!this.hasUnsavedWhiteboardInput()) return true;
    if (!confirm('白板有未保存的修改，确定要离开吗？')) return false;
    void this.saveWhiteboard({ quiet: true });
    return true;
  },
};
