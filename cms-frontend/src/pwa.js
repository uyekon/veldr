// ============================================================
// NoteFlow — PWA 注册
// 仅在 HTTPS（或 localhost）且生产构建下注册 Service Worker。
// 页面 CSP 为 script-src 'self'，不允许内联脚本，因此注册逻辑必须走模块文件。
// ============================================================

const SW_URL = `${import.meta.env.BASE_URL}sw.js`;

const notify = (message, ms = 4000) => {
  try {
    window.App?.toast?.(message, ms);
  } catch {
    /* toast 不可用时静默 */
  }
};

const isEditing = () => {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) && !el.disabled;
};

export function clearApiCache() {
  navigator.serviceWorker?.controller?.postMessage('CLEAR_API_CACHE');
}

export function registerPWA() {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) {
    console.warn('[PWA] 非安全上下文（需 HTTPS 或 localhost），已跳过 Service Worker 注册');
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(SW_URL)
      .then((registration) => {
        // 首次安装：无 controller 说明是第一次接管
        if (!navigator.serviceWorker.controller) return;

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener('statechange', () => {
            if (installing.state !== 'installed') return;
            if (!navigator.serviceWorker.controller) return;

            if (isEditing()) {
              notify('已下载新版本，保存草稿后刷新即可生效', 6000);
              return;
            }
            notify('已更新到新版本，5 秒后自动刷新', 5000);
            setTimeout(() => window.location.reload(), 5000);
          });
        });
      })
      .catch((error) => {
        console.warn('[PWA] Service Worker 注册失败:', error);
      });
  });
}

// 离线/恢复上线时给一次轻提示，避免用户以为数据丢了
export function installNetworkHints() {
  const showOffline = () => notify('网络已断开，正在使用缓存内容', 4000);
  const showOnline = () => notify('网络已恢复', 2500);
  window.addEventListener('offline', showOffline);
  window.addEventListener('online', showOnline);
}

// 供手工调用（调试台或页面按钮）
window.NoteFlowPWA = { clearApiCache };

// ------------------------------------------------------------
// 桌面快捷方式（manifest shortcuts）入参处理
// manifest 的 start_url 只能通过查询串传参，而 App 路由只认 hash，
// 因此这里必须单独消费 ?action= ，否则快捷方式是死链接。
// ------------------------------------------------------------
const LAUNCH_ACTIONS = {
  new: () => {
    // 与 Ctrl+N 保持一致：viewer 角色不弹编辑框
    if (window.App?.role !== 'editor') return;
    window.App?.openNoteModal?.();
  },
  search: () => {
    const input = document.getElementById('searchInput');
    if (!input) return;
    input.focus();
    input.select?.();
  },
};

export function handleLaunchAction() {
  const action = new URLSearchParams(location.search).get('action');
  if (!action) return;
  // 消费后立即抹掉，避免刷新/后退时重复触发
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
  // 等首屏与鉴权就绪再执行，否则 App.role 还没定
  setTimeout(() => {
    try {
      LAUNCH_ACTIONS[action]?.();
    } catch {
      /* 快捷方式失败不应影响主流程 */
    }
  }, 300);
}

export function initPWA() {
  registerPWA();
  installNetworkHints();
  handleLaunchAction();
}
