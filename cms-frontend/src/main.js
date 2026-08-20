// ============================================================
// NoteFlow — 入口模块
// 由 Vite 打包（含 markdown-runtime），产物带 hash，无需手写 ?v= 版本号。
// index.html 中的静态内联 onclick 仍通过 window.App 调用（下一步 CSP 改造再收敛）。
// ============================================================
import './markdown-runtime.js';
import './config.js';
import { App } from './app/state.js';
import { apiMethods } from './app/api.js';
import { authMethods } from './app/auth.js';
import { menuMethods } from './app/menus.js';
import { categoryMethods } from './app/categories.js';
import { notesViewMethods } from './app/notes-view.js';
import { editorMethods } from './app/editor.js';
import { mediaMethods } from './app/media.js';
import { uiMethods } from './app/ui.js';
import { routerMethods, installRouter } from './app/router.js';
import { installDelegation } from './app/delegate.js';

Object.assign(
  App,
  apiMethods,
  authMethods,
  menuMethods,
  categoryMethods,
  notesViewMethods,
  editorMethods,
  mediaMethods,
  uiMethods,
  routerMethods,
);

window.App = App;

// ===== 启动 =====
const boot = () => {
  installDelegation(App);
  installRouter(App);
  App.init();

  window.addEventListener('beforeunload', (event) => {
    if (!App.hasUnsavedEditorInput?.()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) App.refreshFromServer('visibility');
  });
  window.addEventListener('focus', () => App.refreshFromServer('focus'));

  // 窗口跨过 1200px 断点时同步目录栏显隐
  const tocMediaQuery = window.matchMedia('(min-width: 1200px)');
  tocMediaQuery.addEventListener?.('change', () => {
    const toc = document.getElementById('tocNav');
    if (!toc) return;
    const detailEl = document.getElementById('detailView');
    if (detailEl?.classList.contains('detail-view--active')) {
      if (tocMediaQuery.matches) App.renderDetailToc(detailEl);
      else toc.style.display = 'none';
      return;
    }
    const browseVisible = document.getElementById('browseView')?.style.display !== 'none';
    toc.style.display = (tocMediaQuery.matches && browseVisible) ? '' : 'none';
  });

  // 焦点陷阱：弹窗/登录层打开时，Tab 循环限制在层内
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const overlay = document.querySelector('.modal-overlay.modal-overlay--active, .login-overlay.login-overlay--active');
    if (!overlay) return;
    const focusables = Array.from(overlay.querySelectorAll(
      'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (!overlay.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    }
  });

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      App.openShortcutModal();
      return;
    }
    const noteModalOpen = document.getElementById('noteModal')?.classList.contains('modal-overlay--active');
    if (noteModalOpen && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      App.saveNote({ keepOpen: true });
      return;
    }
    if (noteModalOpen && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      App.saveNote();
      return;
    }
    if (e.key === 'Escape') {
      const draftRecoveryModal = document.getElementById('draftRecoveryModal');
      if (draftRecoveryModal?.classList.contains('modal-overlay--active')) {
        App.resolveDraftRecovery(false);
        return;
      }
      const shortcutModal = document.getElementById('shortcutModal');
      if (shortcutModal?.classList.contains('modal-overlay--active')) {
        App.closeShortcutModal();
        return;
      }
      const notebookSheet = document.getElementById('notebookSheet');
      const filterSheet = document.getElementById('filterSheet');
      if (notebookSheet?.classList.contains('mobile-sheet--active') || filterSheet?.classList.contains('mobile-sheet--active')) {
        App.closeMobileSheets();
        return;
      }
      const passwordModal = document.getElementById('passwordModal');
      if (passwordModal?.classList.contains('modal-overlay--active')) {
        App.closePasswordModal();
        return;
      }
      const modal = document.getElementById('noteModal');
      if (modal?.classList.contains('modal-overlay--active')) {
        if (App.editingMenuId) return;
        App.closeModal();
        return;
      }
      if (App.currentNote) { App.showBrowse(); return; }
      if (App.currentNav !== 'docs') { App.navTo('docs'); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); document.getElementById('searchInput').focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); if (App.role === 'editor') App.openNoteModal(); }
  });

  // 点击遮罩关闭弹窗
  document.getElementById('noteModal')?.addEventListener('click', function (e) {
    if (e.target === this) App.closeModal();
  });
  document.getElementById('passwordModal')?.addEventListener('click', function (e) {
    if (e.target === this) App.closePasswordModal();
  });
  document.getElementById('shortcutModal')?.addEventListener('click', function (e) {
    if (e.target === this) App.closeShortcutModal();
  });
  document.getElementById('draftRecoveryModal')?.addEventListener('click', function (e) {
    if (e.target === this) App.resolveDraftRecovery(false);
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
