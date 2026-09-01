import { apiPath } from '../config.js';

const formatUpdatedAt = (value) => {
  if (!value) return '尚未保存';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '已保存' : `上次保存 ${date.toLocaleString()}`;
};

export const whiteboardMethods = {
  openWhiteboard() {
    this.navTo('whiteboard');
  },

  showWhiteboard() {
    const view = document.getElementById('whiteboardView');
    if (!view) return;
    view.classList.add('whiteboard-view--active');
    document.getElementById('tocNav').style.display = 'none';
    document.getElementById('mainContent').scrollTop = 0;
    this.renderWhiteboardState();
    void this.loadWhiteboard();
  },

  renderWhiteboardState(status) {
    const textarea = document.getElementById('whiteboardContent');
    const saveButton = document.getElementById('whiteboardSaveBtn');
    const statusEl = document.getElementById('whiteboardStatus');
    if (textarea) textarea.readOnly = this.role !== 'editor';
    if (saveButton) saveButton.style.display = this.role === 'editor' ? '' : 'none';
    if (statusEl) {
      statusEl.textContent = status || (this.whiteboardDirty ? '有未保存的修改' : formatUpdatedAt(this.whiteboard?.updatedAt));
    }
  },

  async loadWhiteboard(options = {}) {
    if (this.whiteboardLoadPromise) return this.whiteboardLoadPromise;
    this.whiteboardLoadPromise = this.api('GET', apiPath('/whiteboard'))
      .then((whiteboard) => {
        if (!this.whiteboardDirty || options.force) {
          this.whiteboard = whiteboard;
          const textarea = document.getElementById('whiteboardContent');
          if (textarea) textarea.value = whiteboard.content || '';
          this.renderWhiteboardState();
        }
        return whiteboard;
      })
      .catch((error) => {
        this.renderWhiteboardState('白板加载失败');
        this.toast(error.message || '白板加载失败');
        return null;
      })
      .finally(() => { this.whiteboardLoadPromise = null; });
    return this.whiteboardLoadPromise;
  },

  handleWhiteboardInput() {
    if (this.role !== 'editor') return;
    this.whiteboardDirty = true;
    this.renderWhiteboardState();
    clearTimeout(this.whiteboardSaveTimer);
    this.whiteboardSaveTimer = setTimeout(() => this.saveWhiteboard({ quiet: true }), 800);
  },

  async saveWhiteboard(options = {}) {
    if (this.role !== 'editor' || this.whiteboardSaveInFlight) return;
    const textarea = document.getElementById('whiteboardContent');
    if (!textarea) return;
    const content = textarea.value;
    this.whiteboardSaveInFlight = true;
    this.renderWhiteboardState('正在保存…');
    try {
      const whiteboard = await this.api('PUT', apiPath('/whiteboard'), {
        content,
        version: this.whiteboard?.version,
      });
      this.whiteboard = whiteboard;
      this.whiteboardDirty = false;
      this.renderWhiteboardState();
      if (!options.quiet) this.toast('白板已保存');
    } catch (error) {
      if (error.status === 409 && confirm('白板已在其他设备更新。要用当前内容覆盖服务器版本吗？')) {
        try {
          const whiteboard = await this.api('PUT', apiPath('/whiteboard'), { content, force: true });
          this.whiteboard = whiteboard;
          this.whiteboardDirty = false;
          this.renderWhiteboardState();
          if (!options.quiet) this.toast('白板已覆盖保存');
          return;
        } catch (forceError) {
          this.renderWhiteboardState('保存失败');
          this.toast(forceError.message || '白板保存失败');
          return;
        }
      }
      this.renderWhiteboardState('保存失败，请重试');
      if (!options.quiet) this.toast(error.message || '白板保存失败');
    } finally {
      this.whiteboardSaveInFlight = false;
    }
  },

  hasUnsavedWhiteboardInput() {
    return this.currentNav === 'whiteboard' && this.whiteboardDirty;
  },

  confirmWhiteboardExit() {
    if (!this.hasUnsavedWhiteboardInput()) return true;
    if (!confirm('白板有未保存的修改，确定要离开吗？')) return false;
    void this.saveWhiteboard({ quiet: true });
    return true;
  },
};
