import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', {});
  vi.stubGlobal('caches', {
    keys: vi.fn().mockResolvedValue(['noteflow-api-v1', 'noteflow-api-editor-v2', 'noteflow-static-v2']),
    delete: vi.fn().mockResolvedValue(true),
  });
  vi.stubGlobal('navigator', { serviceWorker: { controller: { postMessage: vi.fn() } } });
});
afterEach(() => vi.unstubAllGlobals());

describe('session API cache cleanup', () => {
  it('deletes every API cache and notifies the active worker', async () => {
    const { clearApiCache } = await import('./app/session-cache.js');
    await clearApiCache();
    expect(caches.delete).toHaveBeenCalledWith('noteflow-api-v1');
    expect(caches.delete).toHaveBeenCalledWith('noteflow-api-editor-v2');
    expect(caches.delete).not.toHaveBeenCalledWith('noteflow-static-v2');
    expect(navigator.serviceWorker.controller.postMessage).toHaveBeenCalledWith('CLEAR_API_CACHE');
  });

  it('cleans cached session data before entering viewer mode on logout', async () => {
    const { authMethods } = await import('./app/auth.js');
    const app = {
      ...authMethods,
      role: 'editor',
      confirmEditorExit: () => true,
      api: vi.fn().mockResolvedValue({}),
      enterViewerMode: vi.fn(),
      toast: vi.fn(),
    };
    await app.logout();
    expect(caches.delete).toHaveBeenCalled();
    expect(app.enterViewerMode).toHaveBeenCalledOnce();
    expect(Math.min(...caches.delete.mock.invocationCallOrder))
      .toBeLessThan(app.enterViewerMode.mock.invocationCallOrder[0]);
  });

  it('cleans cached session data before loading a newly authenticated session', async () => {
    const inputs = {
      loginUsername: { value: 'admin' },
      loginPassword: { value: 'secret', focus: vi.fn() },
    };
    vi.stubGlobal('document', { getElementById: (id) => inputs[id] });
    const { authMethods } = await import('./app/auth.js');
    const app = {
      ...authMethods,
      auth: vi.fn().mockResolvedValue({ username: 'admin' }),
      showLoading: vi.fn(), hideLogin: vi.fn(), applyRoleUI: vi.fn(), enterApp: vi.fn(), toast: vi.fn(),
    };
    await app.submitLogin();
    expect(app.role).toBe('editor');
    expect(caches.delete).toHaveBeenCalled();
    expect(Math.min(...caches.delete.mock.invocationCallOrder))
      .toBeLessThan(app.enterApp.mock.invocationCallOrder[0]);
  });

  it('labels requests for cache partitioning and clears them after session expiry', async () => {
    const { apiMethods } = await import('./app/api.js');
    const app = { ...apiMethods, role: 'editor', applyRoleUI: vi.fn(), showLogin: vi.fn() };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
    await app.api('GET', '/api/cms/notes');
    expect(fetch.mock.calls[0][1].headers['X-NoteFlow-Role']).toBe('editor');

    fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'expired' }) });
    await expect(app.api('GET', '/api/cms/notes')).rejects.toThrow('expired');
    expect(app.role).toBe('viewer');
    expect(caches.delete).toHaveBeenCalled();
    expect(app.showLogin).toHaveBeenCalledOnce();
  });
});
