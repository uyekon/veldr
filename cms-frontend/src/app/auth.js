import { AUTH_API_BASE, apiPath } from '../config.js';

const authPath = (path) => AUTH_API_BASE + path;

export const authMethods = {
  async init() {
    document.querySelector('.modal__toolbar')?.addEventListener('mousedown', (event) => {
      if (event.target.closest('button')) event.preventDefault();
    });

    try {
      const me = await this.api('GET', authPath('/me'));
      if (me?.role === 'admin') {
        this.role = 'editor';
        this.adminUsername = me.username;
        this.applyRoleUI();
        this.hideLogin();
        return this.enterApp();
      }
    } catch {}

    this.role = 'viewer';
    this.applyRoleUI();
    this.hideLogin();
    this.enterApp();
  },

  async auth(username, password) {
    return this.api('POST', authPath('/login'), { username, password });
  },

  async submitLogin() {
    const usernameInput = document.getElementById('loginUsername');
    const passwordInput = document.getElementById('loginPassword');
    const username = (usernameInput?.value || '').trim();
    const password = passwordInput?.value || '';
    if (!username || !password) {
      this.toast('请输入管理员账号和密码');
      return;
    }

    this.showLoading(true);
    try {
      const data = await this.auth(username, password);
      this.role = 'editor';
      this.adminUsername = data.username || username;
      this.hideLogin();
      this.applyRoleUI();
      this.enterApp();
      this.toast('已以管理员身份进入编辑模式');
    } catch (error) {
      this.toast(error.message || '账号或密码错误');
      if (passwordInput) {
        passwordInput.value = '';
        passwordInput.focus();
      }
    } finally {
      this.showLoading(false);
    }
  },

  enterViewerMode() {
    this.role = 'viewer';
    this.hideLogin();
    this.applyRoleUI();
    this.renderMenus();
    this.enterApp();
  },

  async logout() {
    if (this.role !== 'editor') {
      this.showLogin();
      return;
    }
    try { await this.api('POST', authPath('/logout')); } catch {}
    this.enterViewerMode();
    this.toast('已退出编辑模式');
  },

  enterApp() {
    this.showLoading(true);
    Promise.all([this.reloadNotes(), this.reloadMenus(), this.reloadCategories()])
      .then(() => {
        this.showLoading(false);
        this.renderMenus();
        this.renderCategories();
        this.renderTags();
        this.updateCounts();
        this.applyRouteFromHash();
      })
      .catch(() => this.showLoading(false));
  },

  async refreshFromServer(reason = 'manual') {
    if (this.role !== 'editor' && this.role !== 'viewer') return;
    const now = Date.now();
    if (now - this._lastServerRefreshAt < 5000) return;
    this._lastServerRefreshAt = now;
    const modalOpen = document.getElementById('noteModal')?.classList.contains('modal-overlay--active');
    if (modalOpen) {
      await this.checkEditingRemoteVersion(reason);
      return;
    }

    const before = this.lastKnownNotesVersion;
    await this.reloadNotes();
    this.updateCounts();
    this.renderTags();
    this.renderNotes();
    if (this.currentNote) {
      const fresh = this._notes.find(note => note.id === this.currentNote.id);
      if (fresh) this.showDetail(fresh.id);
    }
    if (before && before !== this.lastKnownNotesVersion && reason !== 'autosave') {
      this.toast('已同步服务器最新笔记');
    }
  },

  async checkEditingRemoteVersion() {
    if (!this.editingNoteId || !this.editingNoteVersion) return;
    try {
      const remote = await this.api('GET', apiPath('/notes/' + this.editingNoteId));
      if (Number(remote.version || 1) > Number(this.editingNoteVersion || 1)) {
        this.setAutosaveStatus('其它设备有更新，保存前请处理');
      }
    } catch {}
  },

  showLogin() {
    const el = document.getElementById('loginOverlay');
    if (el) el.classList.add('login-overlay--active');
    const input = document.getElementById('loginUsername');
    if (input) setTimeout(() => input.focus(), 100);
  },

  hideLogin() {
    const el = document.getElementById('loginOverlay');
    if (el) el.classList.remove('login-overlay--active');
    ['loginUsername', 'loginPassword'].forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
  },

  applyRoleUI() {
    const isEditor = this.role === 'editor';
    const newBtn = document.getElementById('newNoteBtn');
    if (newBtn) newBtn.style.display = isEditor ? '' : 'none';
    const badge = document.getElementById('roleBadge');
    if (badge) {
      badge.textContent = isEditor ? `管理员${this.adminUsername ? ` · ${this.adminUsername}` : ''}` : '查看模式';
      badge.className = 'topnav__role ' + (isEditor ? 'topnav__role--editor' : 'topnav__role--viewer');
      badge.style.display = '';
    }
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.textContent = isEditor ? '退出登录' : '管理员登录';
      logoutBtn.title = isEditor ? '退出管理员登录' : '输入管理员账号和密码';
      logoutBtn.style.display = '';
    }
    const passwordBtn = document.getElementById('passwordBtn');
    if (passwordBtn) passwordBtn.style.display = isEditor ? '' : 'none';
    const mobilePasswordBtn = document.getElementById('mobilePasswordBtn');
    if (mobilePasswordBtn) mobilePasswordBtn.style.display = isEditor ? 'flex' : 'none';
    const addCategoryBtn = document.getElementById('addCategoryBtn');
    if (addCategoryBtn) addCategoryBtn.style.display = isEditor ? 'flex' : 'none';
    const mobileAddCategoryBtn = document.getElementById('mobileAddCategoryBtn');
    if (mobileAddCategoryBtn) mobileAddCategoryBtn.style.display = isEditor ? 'flex' : 'none';
  },

  openPasswordModal() {
    if (this.role !== 'editor') { this.toast('需要管理员登录'); return; }
    this.closeMobileSheets();
    const modal = document.getElementById('passwordModal');
    if (!modal) return;
    ['currentPasswordKey', 'newPasswordKey', 'confirmPasswordKey'].forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
    modal.classList.add('modal-overlay--active');
    setTimeout(() => document.getElementById('currentPasswordKey')?.focus(), 100);
  },

  closePasswordModal() {
    const modal = document.getElementById('passwordModal');
    if (modal) modal.classList.remove('modal-overlay--active');
    ['currentPasswordKey', 'newPasswordKey', 'confirmPasswordKey'].forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
  },

  openShortcutModal() {
    document.getElementById('shortcutModal')?.classList.add('modal-overlay--active');
  },

  closeShortcutModal() {
    document.getElementById('shortcutModal')?.classList.remove('modal-overlay--active');
  },

  async changePassword() {
    if (this.role !== 'editor') { this.toast('需要管理员登录'); return; }
    const currentPassword = document.getElementById('currentPasswordKey')?.value || '';
    const newPassword = document.getElementById('newPasswordKey')?.value || '';
    const confirmPassword = document.getElementById('confirmPasswordKey')?.value || '';
    if (newPassword.length < 8 || newPassword.length > 128) {
      this.toast('新密码需要 8 到 128 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      this.toast('两次输入的新密码不一致');
      return;
    }

    this.showLoading(true);
    try {
      await this.api('PUT', authPath('/password'), { currentPassword, newPassword });
      this.closePasswordModal();
      this.toast('密码已更新，其他设备需要重新登录');
    } catch (error) {
      this.toast(error.message);
    } finally {
      this.showLoading(false);
    }
  },
};
