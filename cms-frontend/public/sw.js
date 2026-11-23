/* NoteFlow Service Worker
 * 缓存策略：
 *   - App Shell（index.html / manifest / 图标）  预缓存 + 网络优先
 *   - /assets/*（Vite 产物，文件名带 hash）      缓存优先（内容寻址，不会过期）
 *   - config.js（部署时可被覆盖）                网络优先
 *   - /api/*（GET）                             网络优先 + 离线回退（可关闭，见下）
 *   - /uploads/*（图片）                         缓存优先
 *   - 跨域（Google Fonts）                       缓存优先
 *
 * 修改本文件后请同步 bump VERSION，否则旧缓存不会失效。
 */

const VERSION = 'v2';
const STATIC_CACHE = `noteflow-static-${VERSION}`;
const ASSET_CACHE = `noteflow-assets-${VERSION}`;
const MEDIA_CACHE = `noteflow-media-${VERSION}`;
const API_CACHE_VIEWER = `noteflow-api-viewer-${VERSION}`;
const API_CACHE_EDITOR = `noteflow-api-editor-${VERSION}`;
const API_CACHES = [API_CACHE_VIEWER, API_CACHE_EDITOR];
const FONT_CACHE = `noteflow-fonts-${VERSION}`;

// CMS 只读接口按角色分缓存；认证与同步接口永不进入离线缓存。
// X-NoteFlow-Role 只选择缓存分区，服务端权限仍由 HttpOnly 会话决定。
const API_CACHE_ENABLED = true;

// 缓存条目上限，防止无上限增长（笔记正文可能较大）
const LIMITS = {
  [ASSET_CACHE]: 120,
  [MEDIA_CACHE]: 300,
  [API_CACHE_VIEWER]: 60,
  [API_CACHE_EDITOR]: 60,
  [FONT_CACHE]: 40,
};

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

const isApi = (url) => url.pathname.includes('/api/');
const isCacheableApi = (url) => url.pathname.includes('/api/cms/');
const apiCacheFor = (request) => request.headers.get('x-noteflow-role') === 'editor'
  ? API_CACHE_EDITOR : API_CACHE_VIEWER;
const isUpload = (url) => url.pathname.includes('/uploads/');
const isHashedAsset = (url) => url.pathname.includes('/assets/');
const isFontHost = (url) =>
  url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      // 单个资源 404 不应让整个 install 失败
      .then((cache) => Promise.allSettled(PRECACHE.map((item) => cache.add(item))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, ASSET_CACHE, MEDIA_CACHE, ...API_CACHES, FONT_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

async function trimCache(name, max) {
  if (!max) return;
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    cache.put(request, response.clone()).catch(() => {});
    trimCache(cacheName, LIMITS[cacheName]);
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => {});
        trimCache(cacheName, LIMITS[cacheName]);
      }
      return response;
    })
    .catch(() => null);
  return hit || (await network) || new Response('', { status: 504, statusText: 'Offline' });
}

async function networkFirst(request, cacheName, { cacheable = true } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (cacheable && response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
      trimCache(cacheName, LIMITS[cacheName]);
    }
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

async function handleNavigation(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put('./index.html', response.clone()).catch(() => {});
    return response;
  } catch (error) {
    const shell = (await cache.match('./index.html')) || (await cache.match('./'));
    if (shell) return shell;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // 写操作一律不拦截

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // 只处理 http(s)，跳过 chrome-extension / data / blob
  if (!url.protocol.startsWith('http')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isFontHost(url)) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  if (url.origin !== self.location.origin) return; // 其他跨域请求放行

  if (isCacheableApi(url)) {
    if (!API_CACHE_ENABLED) return;
    event.respondWith(networkFirst(request, apiCacheFor(request)));
    return;
  }
  // /api/auth/* 与 /api/v1/* 直接走网络，绝不缓存身份或同步响应。
  if (isApi(url)) return;

  if (isUpload(url)) {
    event.respondWith(cacheFirst(request, MEDIA_CACHE));
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // config.js、manifest.json、图标等：可能因部署而更新
  event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data === 'CLEAR_API_CACHE') {
    event.waitUntil((async () => {
      const names = await caches.keys();
      await Promise.all(names
        .filter((name) => name.startsWith('noteflow-api-'))
        .map((name) => caches.delete(name)));
    })());
  }
});
