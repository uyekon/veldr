import { apiPath } from '../config.js';

// ===== API 客户端 =====
export const apiMethods = {
  exportNotes(id) {
    if (this.role !== 'editor') return;
    const link = document.createElement('a');
    link.href = apiPath(id ? `/notes/${id}/export` : '/export');
    link.download = id ? `note-${id}.md` : 'noteflow-notes.zip';
    document.body.append(link); link.click(); link.remove();
    this.toast('正在准备导出');
  },
  async api(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(30000), ...opts });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401 && this.role === 'editor') {
        this.role = 'viewer';
        this.applyRoleUI();
        this.showLogin();
      }
      const error = new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
      error.status = res.status;
      error.code = data && data.code;
      error.current = data && data.current;
      throw error;
    }
    return data;
  },

  async reloadNotes() {
    try {
      this._notes = (await this.api('GET', apiPath('/notes?includeArchived=1'))) || [];
      this.lastKnownNotesVersion = this.getNotesVersionFingerprint();
    } catch (e) { this.toast('加载笔记失败'); }
  },

  async reloadMenus() {
    try { this._menus = (await this.api('GET', apiPath('/menus'))) || []; } catch (e) { this.toast('加载菜单失败'); }
  },

  async reloadCategories() {
    try { this._categories = (await this.api('GET', apiPath('/categories'))) || []; } catch (e) { this.toast('加载分类失败'); }
  },

  getNotesVersionFingerprint() {
    return this._notes
      .map(note => `${note.id}:${note.version || 1}:${note.updatedAt || note.date || ''}`)
      .sort()
      .join('|');
  },
};
