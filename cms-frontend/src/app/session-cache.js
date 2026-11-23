const API_CACHE_PREFIX = 'noteflow-api-';

// CacheStorage 与 Service Worker 同源，可直接等待删除完成；同时通知 SW
// 清理旧版本缓存，避免其他标签页继续引用已经失效的会话数据。
export async function clearApiCache() {
  if (typeof caches !== 'undefined') {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(API_CACHE_PREFIX))
      .map((name) => caches.delete(name)));
  }
  if (typeof navigator !== 'undefined') {
    navigator.serviceWorker?.controller?.postMessage('CLEAR_API_CACHE');
  }
}
