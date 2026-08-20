// ===== 事件委托：JS 生成的 DOM 一律用 data-action，不再拼接内联 onclick =====
// （消除 id/标签值注入内联 JS 的风险，也为将来启用 CSP 扫清 JS 侧障碍。）

const clickActions = {
  'nav': (App, el) => App.navTo(el.dataset.id),
  'add-menu': (App) => App.addMenu(),
  'rename-menu': (App, el) => App.renameMenu(el.dataset.id),
  'delete-menu': (App, el) => App.deleteMenu(el.dataset.id),
  'set-filter': (App, el) => App.setFilterFromElement(el),
  'add-category': (App) => App.addCategory(),
  'rename-category': (App, el) => App.renameCategory(el.dataset.id),
  'delete-category': (App, el) => App.deleteCategory(el.dataset.id),
  'show-detail': (App, el) => App.showDetail(Number(el.dataset.id)),
  'show-browse': (App) => App.showBrowse(),
  'toggle-star': (App, el) => App.toggleStar(Number(el.dataset.id)),
  'delete-note': (App, el) => App.deleteNoteDirect(Number(el.dataset.id)),
  'open-note-modal': (App, el) => App.openNoteModal(el.dataset.id ? Number(el.dataset.id) : undefined),
  'scroll-heading': (App, el) => {
    document.getElementById(`note-heading-${el.dataset.index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  // —— index.html 静态控件（原内联 onclick）——
  'open-notebook-sheet': (App) => App.openNotebookSheet(),
  'close-notebook-sheet': (App) => App.closeNotebookSheet(),
  'open-filter-sheet': (App) => App.openFilterSheet(),
  'close-filter-sheet': (App) => App.closeFilterSheet(),
  'close-mobile-sheets': (App) => App.closeMobileSheets(),
  'open-password-modal': (App) => App.openPasswordModal(),
  'close-password-modal': (App) => App.closePasswordModal(),
  'change-password': (App) => App.changePassword(),
  'open-shortcut-modal': (App) => App.openShortcutModal(),
  'close-shortcut-modal': (App) => App.closeShortcutModal(),
  'close-note-modal': (App) => App.closeModal(),
  'restore-draft': (App) => App.resolveDraftRecovery(true),
  'use-server-draft': (App) => App.resolveDraftRecovery(false),
  'save-note': (App) => App.saveNote(),
  'delete-editing-note': (App) => App.deleteNote(),
  'upload-image': (App) => App.uploadImage(),
  'upload-video': (App) => App.uploadVideo(),
  'open-media-library': (App) => App.openMediaLibrary(),
  'upload-gallery': (App) => App.uploadGallery(),
  'delete-selected-image': (App) => App.deleteSelectedImage(),
  'set-image-layout': (App, el) => App.setImageLayout(el.dataset.imageLayout),
  'markdown-format': (App, el) => App.applyMarkdownFormat(el.dataset.format),
  'editor-mode': (App, el) => App.setEditorMode(el.dataset.editorMode),
  'logout': (App) => App.logout(),
  'toggle-profile-menu': (App, el) => {
    const menu = document.getElementById('profileMenu');
    if (!menu) return;
    const open = menu.classList.toggle('topnav__profile-menu--open');
    el.setAttribute('aria-expanded', String(open));
  },
  'submit-login': (App) => App.submitLogin(),
  'enter-viewer-mode': (App) => App.enterViewerMode(),
};

export function installDelegation(App) {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const handler = clickActions[el.dataset.action];
    if (!handler) return;
    handler(App, el);
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('.topnav__profile')) return;
    document.getElementById('profileMenu')?.classList.remove('topnav__profile-menu--open');
    document.getElementById('profileAvatar')?.setAttribute('aria-expanded', 'false');
  });

  // 笔记卡片 role="button"：补齐键盘可达（Enter / Space 打开详情）
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target;
    if (!(el instanceof Element) || !el.matches('.note-card[data-action="show-detail"]')) return;
    e.preventDefault();
    App.showDetail(Number(el.dataset.id));
  });

  // 顶部菜单：双击重命名、右键删除（原内联 ondblclick/oncontextmenu）
  document.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.topnav__link[data-action="nav"]');
    if (!el || App.role !== 'editor') return;
    App.startEditMenu(el.dataset.id, el);
  });

  document.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.topnav__link[data-action="nav"]');
    if (!el || App.role !== 'editor') return;
    e.preventDefault();
    App.deleteMenu(el.dataset.id); // docs 菜单由 deleteMenu 内部拦截
  });

  // —— 输入类事件（原 index.html 内联 oninput/onkeydown/onchange 等）——
  const bind = (id, type, handler) => document.getElementById(id)?.addEventListener(type, handler);

  bind('searchInput', 'input', () => App.filter());
  bind('noteTitle', 'input', () => App.scheduleAutosave());
  bind('noteCategory', 'change', () => App.scheduleAutosave());
  bind('noteTags', 'input', () => App.scheduleAutosave());
  bind('imageInput', 'change', (e) => App.handleImageSelected(e));
  bind('videoInput', 'change', (e) => App.handleVideoSelected(e));
  bind('noteContent', 'input', () => App.handleSourceInput());
  bind('confirmPasswordKey', 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); App.changePassword(); }
  });
  ['loginUsername', 'loginPassword'].forEach((id) => bind(id, 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); App.submitLogin(); }
  }));
}
