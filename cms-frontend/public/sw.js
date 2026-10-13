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

const VERSION = 'v1';
const STATIC_CACHE = `noteflow-static-${VERSION}`;
const ASSET_CACHE = `noteflow-assets-${VERSION}`;
const MEDIA_CACHE = `noteflow-media-${VERSION}`;
const API_CACHE = `noteflow-api-${VERSION}`;
const FONT_CACHE = `noteflow-fonts-${VERSION}`;

// 是否缓存 /api GET 响应。
// 开启后离线也能看到上次加载过的笔记；若同一域名会被多人以不同角色（viewer/editor）访问，
// 请改为 false —— 否则 editor 视角的 private 笔记可能残留在缓存中被 viewer 命中。
const API_CACHE_ENABLED = true;

// 缓存条目上限，防止无上限增长（笔记正文可能较大）
const LIMITS = {
  [ASSET_CACHE]: 120,
  [MEDIA_CACHE]: 300,
  [API_CACHE]: 60,
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
      const keep = new Set([STATIC_CACHE, ASSET_CACHE, MEDIA_CACHE, API_CACHE, FONT_CACHE]);
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

  if (isApi(url)) {
    if (!API_CACHE_ENABLED) return;
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

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
    event.waitUntil(caches.delete(API_CACHE));
  }
});
