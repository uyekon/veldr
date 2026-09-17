import { beforeEach, afterEach, it, expect, vi } from 'vitest';

let methods;
beforeEach(async () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', { getElementById: () => null });
  methods = (await import('./app/whiteboard.js')).whiteboardMethods;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const appFor = methods => ({ ...methods, role: 'editor', activeWhiteboardId: 'n', whiteboardStates: {}, renderWhiteboardState: vi.fn(), updateWhiteboardMetadata: vi.fn(), toast: vi.fn() });

it('queues fresh input behind a slow request and manual save joins the queue', async () => {
  const app = appFor(methods);
  const first = deferred(); const second = deferred();
  app.api = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const state = app.getWhiteboardState();
  state.whiteboard.content = 'A'; state.dirty = true;
  const saving = app.saveWhiteboard();
  state.whiteboard.content = 'AB'; state.revision++; state.dirty = true;
  const joined = app.saveWhiteboard();
  first.resolve({ id: 'n', content: 'A', version: 2 });
  await Promise.resolve(); await Promise.resolve();
  expect(state.dirty).toBe(true);
  expect(app.api.mock.calls[1][2]).toMatchObject({ content: 'AB', version: 2 });
  second.resolve({ id: 'n', content: 'AB', version: 3 });
  expect(await saving).toBe(true); expect(await joined).toBe(true);
  expect(state.whiteboard.content).toBe('AB'); expect(state.dirty).toBe(false);
});

it('retains content on failure and retries it with the same version', async () => {
  const app = appFor(methods); const state = app.getWhiteboardState();
  state.whiteboard.content = 'keep'; state.dirty = true;
  app.api = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'n', content: 'keep', version: 2 });
  expect(await app.saveWhiteboard()).toBe(false);
  expect(state.dirty).toBe(true); expect(state.whiteboard.content).toBe('keep');
  expect(await app.saveWhiteboard()).toBe(true);
});

it('debounced saves stay bound to their original whiteboard', async () => {
  vi.useFakeTimers();
  const app = appFor(methods);
  vi.stubGlobal('document', { getElementById: () => ({ value: 'N draft' }) });
  app.saveWhiteboard = vi.fn(); app.handleWhiteboardInput();
  app.activeWhiteboardId = 't';
  await vi.advanceTimersByTimeAsync(800);
  expect(app.saveWhiteboard).toHaveBeenCalledWith({ quiet: true, id: 'n' });
});

it('reuses the conversion request after a lost response without saving again', async () => {
  const app = appFor(methods); const state = app.getWhiteboardState();
  const values = { diaryArticleTitle: 'Diary', diaryArticleNotebook: 'nb', diaryArticleCategory: 'work', diaryArticleTags: '' };
  vi.stubGlobal('document', { getElementById: id => ({ value: values[id] || '' }) });
  state.whiteboard.content = 'entry';
  app.saveWhiteboard = vi.fn().mockResolvedValue(true);
  app.api = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({ whiteboard: { id: 'n', content: '', version: 3 } });
  app.reloadNotes = vi.fn(); app.updateCounts = vi.fn(); app.renderTags = vi.fn(); app.closeDiaryArchiveModal = vi.fn();
  await app.archiveDiary();
  const original = state.conversionRequest;
  expect(original.requestId).toBeTruthy();
  await app.archiveDiary();
  expect(app.saveWhiteboard).toHaveBeenCalledTimes(1);
  expect(app.api.mock.calls[1][2]).toEqual(original);
  expect(state.whiteboard.content).toBe(''); expect(state.conversionRequest).toBe(null);
});
