// ===== Hash 路由：笔记/笔记本/页面可分享、可刷新、可后退 =====
// 路由表：
//   #/            → Docs 浏览视图
//   #/nb/<id>     → 笔记本
//   #/page/<id>   → 自定义页面菜单
//   #/note/<id>   → 笔记详情
//   #/whiteboard  → 白板备忘录
export const routerMethods = {
  currentRouteHash() {
    if (this.currentNote) return `#/note/${this.currentNote.id}`;
    if (this.currentNav === 'whiteboard') return '#/whiteboard';
    const menu = this.getCurrentMenu();
    if (menu && menu.id !== 'docs') {
      const prefix = menu.type === 'page' ? 'page' : 'nb';
      return `#/${prefix}/${encodeURIComponent(menu.id)}`;
    }
    return '#/';
  },

  // 状态变化后把地址栏同步到当前状态（applyRouteFromHash 执行期间不回写）
  syncHash() {
    if (this._applyingRoute) return;
    const next = this.currentRouteHash();
    if (location.hash !== next) {
      this._suppressHashHandler = true;
      location.hash = next;
    }
  },

  // 从地址栏恢复状态（首次进入 / 用户前进后退 / 手动改 hash）
  applyRouteFromHash() {
    const hash = location.hash || '#/';
    this._applyingRoute = true;
    try {
      let match;
      if (hash === '#/whiteboard') {
        this.navTo('whiteboard');
      } else if ((match = hash.match(/^#\/note\/(\d+)$/))) {
        const id = Number(match[1]);
        if (this._notes.some(note => note.id === id)) {
          this.showDetail(id);
        } else {
          this.navTo('docs');
        }
      } else if ((match = hash.match(/^#\/(?:nb|page)\/(.+)$/))) {
        const id = decodeURIComponent(match[1]);
        this.navTo(this._menus.some(menu => menu.id === id) ? id : 'docs');
      } else {
        this.navTo('docs');
      }
    } finally {
      this._applyingRoute = false;
    }
    // 无效路由被回退到有效状态时，纠正地址栏但不新增历史记录
    const next = this.currentRouteHash();
    if (location.hash !== next) {
      history.replaceState(null, '', next);
    }
  },
};

export function installRouter(App) {
  window.addEventListener('hashchange', () => {
    if (App._suppressHashHandler) {
      App._suppressHashHandler = false;
      return;
    }
    App.applyRouteFromHash();
  });
}
