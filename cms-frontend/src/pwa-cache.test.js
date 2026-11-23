import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const requestKey = (request) => typeof request === 'string' ? request : request.url;
const basicResponse = (body) => ({ ok: true, type: 'basic', body, clone() { return this; } });

function createWorker() {
  const listeners = {};
  const stores = new Map();
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(request) { return store.get(requestKey(request)); },
        async put(request, response) { store.set(requestKey(request), response); },
        async delete(request) { return store.delete(requestKey(request)); },
        async keys() { return Array.from(store.keys(), (url) => new Request(url)); },
        async add() {},
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const sandbox = {
    self: {
      location: new URL('https://notes.test/sw.js'),
      addEventListener: (type, handler) => { listeners[type] = handler; },
      clients: { claim: vi.fn() },
      skipWaiting: vi.fn(),
    },
    caches,
    fetch: vi.fn(),
    Request, Response, URL, Promise, Map, Set, console,
  };
  vm.runInNewContext(source, sandbox);
  return { listeners, stores, fetch: sandbox.fetch, caches };
}

function dispatchFetch(worker, url, role = 'viewer') {
  let response;
  let handled = false;
  worker.listeners.fetch({
    request: new Request(url, { headers: { 'x-noteflow-role': role } }),
    respondWith(value) { handled = true; response = value; },
  });
  return { handled, response };
}

describe('service worker API cache isolation', () => {
  it('never falls back to an editor response in the viewer partition', async () => {
    const worker = createWorker();
    worker.fetch.mockResolvedValueOnce(basicResponse('private note'));
    const editorOnline = dispatchFetch(worker, 'https://notes.test/api/cms/notes', 'editor');
    expect(editorOnline.handled).toBe(true);
    await editorOnline.response;

    worker.fetch.mockRejectedValue(new Error('offline'));
    const viewerOffline = dispatchFetch(worker, 'https://notes.test/api/cms/notes', 'viewer');
    await expect(viewerOffline.response).rejects.toThrow('offline');
    const editorOffline = dispatchFetch(worker, 'https://notes.test/api/cms/notes', 'editor');
    await expect(editorOffline.response).resolves.toMatchObject({ body: 'private note' });
    expect([...worker.stores.keys()]).toEqual(expect.arrayContaining([
      'noteflow-api-editor-v2', 'noteflow-api-viewer-v2',
    ]));
  });

  it.each(['/api/auth/me', '/api/v1/cms/sync/changes?cursor=1'])(
    'does not intercept or cache %s', async (path) => {
      const worker = createWorker();
      const event = dispatchFetch(worker, `https://notes.test${path}`, 'editor');
      expect(event.handled).toBe(false);
      expect(worker.fetch).not.toHaveBeenCalled();
      expect(worker.stores.size).toBe(0);
    },
  );

  it('removes legacy shared caches during activation', async () => {
    const worker = createWorker();
    worker.stores.set('noteflow-api-v1', new Map());
    let pending;
    worker.listeners.activate({ waitUntil(value) { pending = value; } });
    await pending;
    expect(worker.stores.has('noteflow-api-v1')).toBe(false);
  });

  it('clears every API partition without deleting static assets', async () => {
    const worker = createWorker();
    worker.stores.set('noteflow-api-v1', new Map());
    worker.stores.set('noteflow-api-editor-v2', new Map());
    worker.stores.set('noteflow-api-viewer-v2', new Map());
    worker.stores.set('noteflow-static-v2', new Map());
    let pending;
    worker.listeners.message({ data: 'CLEAR_API_CACHE', waitUntil(value) { pending = value; } });
    await pending;
    expect([...worker.stores.keys()]).toEqual(['noteflow-static-v2']);
  });
});
