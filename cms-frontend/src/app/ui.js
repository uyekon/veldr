// ===== 通用 UI 工具：转义、图标、抽屉、toast、进度条 =====
export const uiMethods = {
  escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  getIconSVG(seed) {
    const icons = [
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/></svg>',
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
    ];
    // 按笔记 id 取模，避免每次重绘图标随机跳变
    const index = Math.abs(Number(seed) || 0) % icons.length;
    return icons[index];
  },

  toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('sidebar--open');
    document.getElementById('sidebarOverlay').classList.toggle('overlay--active');
  },

  isMobile() {
    return window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
  },

  isMobileHeaderPinned() {
    if (!this.isMobile()) return false;
    const topnav = document.querySelector('.topnav');
    return Boolean(
      topnav?.contains(document.activeElement)
      || document.querySelector('.mobile-drawer--active, .topnav__profile-menu--open, .modal-overlay--active, .login-overlay--active'),
    );
  },

  setMobileHeaderDimmed(dimmed) {
    const main = document.getElementById('mainContent');
    const shouldDim = Boolean(dimmed) && this.isMobile() && !this.isMobileHeaderPinned() && (main?.scrollTop || 0) > 2;
    document.body.classList.toggle('mobile-header--dimmed', shouldDim);
    this.mobileHeaderDimmed = shouldDim;
  },

  showMobileHeader() {
    clearTimeout(this.mobileHeaderIdleTimer);
    this.setMobileHeaderDimmed(false);
  },

  scheduleMobileHeaderIdleDim() {
    clearTimeout(this.mobileHeaderIdleTimer);
    if (!this.isMobile() || this.isMobileHeaderPinned() || (document.getElementById('mainContent')?.scrollTop || 0) <= 2) return;
    this.mobileHeaderIdleTimer = setTimeout(() => this.setMobileHeaderDimmed(true), 220);
  },

  handleMobileContentScroll() {
    const main = document.getElementById('mainContent');
    if (!main) return;
    if (!this.isMobile()) {
      this.showMobileHeader();
      this.mobileHeaderLastScrollTop = 0;
      return;
    }
    if (this.isMobileHeaderPinned()) {
      this.showMobileHeader();
      this.mobileHeaderLastScrollTop = main.scrollTop;
      return;
    }
    const current = Math.max(0, main.scrollTop);
    const previous = Number(this.mobileHeaderLastScrollTop ?? current);
    const delta = current - previous;
    this.mobileHeaderLastScrollTop = current;
    if (current <= 2 || delta <= -8) this.showMobileHeader();
    else if (delta >= 8) this.setMobileHeaderDimmed(true);
    this.scheduleMobileHeaderIdleDim();
  },

  refreshMobileHeader() {
    if (!this.isMobile() || this.isMobileHeaderPinned() || (document.getElementById('mainContent')?.scrollTop || 0) <= 2) {
      this.showMobileHeader();
      return;
    }
    this.scheduleMobileHeaderIdleDim();
  },

  installMobileHeaderBehavior() {
    const main = document.getElementById('mainContent');
    this.mobileHeaderLastScrollTop = main?.scrollTop || 0;
    document.addEventListener('focusin', () => this.refreshMobileHeader());
    document.addEventListener('focusout', () => setTimeout(() => this.refreshMobileHeader(), 0));
    const watched = ['mobileDrawer', 'profileMenu', 'noteModal', 'passwordModal', 'shortcutModal', 'draftRecoveryModal', 'diaryArchiveModal', 'loginOverlay'];
    watched.forEach((id) => {
      const element = document.getElementById(id);
      if (!element) return;
      new MutationObserver(() => this.refreshMobileHeader()).observe(element, { attributes: true, attributeFilter: ['class'] });
    });
    window.matchMedia?.('(max-width: 768px)').addEventListener?.('change', () => this.refreshMobileHeader());
    this.refreshMobileHeader();
  },

  setMobileSheetLock(on) {
    this.showMobileHeader();
    if (this.isMobile()) window.scrollTo(0, 0);
    document.body.classList.toggle('mobile-sheet-open', Boolean(on));
    const overlay = document.getElementById('sidebarOverlay');
    if (overlay) overlay.classList.toggle('overlay--active', Boolean(on));
  },

  openMobileDrawer(sectionId) {
    this.renderMobileNotebooks();
    this.renderMobileFilters();
    const drawer = document.getElementById('mobileDrawer');
    drawer?.classList.add('mobile-drawer--active');
    drawer?.setAttribute('aria-hidden', 'false');
    document.getElementById('mobileMenuBtn')?.setAttribute('aria-expanded', 'true');
    if (sectionId) document.getElementById(sectionId)?.classList.remove('mobile-drawer__section--collapsed');
    const body = drawer?.querySelector('.mobile-drawer__body');
    if (body) body.scrollTop = 0;
    this.setMobileSheetLock(true);
  },

  closeMobileDrawer() {
    const drawer = document.getElementById('mobileDrawer');
    drawer?.classList.remove('mobile-drawer--active');
    drawer?.setAttribute('aria-hidden', 'true');
    document.getElementById('mobileMenuBtn')?.setAttribute('aria-expanded', 'false');
    this.setMobileSheetLock(false);
    this.scheduleMobileHeaderIdleDim();
  },

  toggleMobileDrawerSection(sectionId) {
    document.getElementById(sectionId)?.classList.toggle('mobile-drawer__section--collapsed');
  },

  openNotebookSheet() {
    this.openMobileDrawer('mobileDrawerNotebooks');
  },

  closeNotebookSheet() {
    this.closeMobileDrawer();
  },

  openFilterSheet() {
    this.openMobileDrawer('mobileDrawerFilters');
  },

  closeFilterSheet() {
    this.closeMobileDrawer();
  },

  closeMobileSheets() {
    this.closeMobileDrawer();
    document.getElementById('sidebar')?.classList.remove('sidebar--open');
  },

  toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('toast--show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('toast--show'), 2200);
  },

  showLoading(on) {
    const bar = document.getElementById('loadingBar');
    if (!bar) return;
    bar.style.width = on ? '70%' : '0';
    if (on) setTimeout(() => { if (bar.style.width === '70%') bar.style.width = '85%'; }, 150);
    else setTimeout(() => { bar.style.width = '100%'; setTimeout(() => bar.style.width = '0', 200); }, 100);
  },
};
