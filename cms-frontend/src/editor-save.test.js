import { beforeEach, afterEach, it, expect, vi } from 'vitest';

let methods;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', { getElementById: () => ({ value: 'title', style: {} }) });
  methods = (await import('./app/editor.js')).editorMethods;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const createApp = () => {
  const app = {
    ...methods, role: 'editor', editingNoteId: 1, editingNoteVersion: 1, autosaveDirty: true,
    _notes: [{ id: 1 }], payload: { title: 'title', content: 'A', tags: [] },
    getNoteFormPayload() { return { ...this.payload }; }, getEditorMarkdown() { return this.payload.content; },
  };
  for (const name of ['scheduleDraftSave', 'clearEditorDraft', 'showLoading', 'setAutosaveStatus', 'getNotesVersionFingerprint', 'reloadNotes', 'updateCounts', 'renderTags', 'renderNotes', 'closeModal', 'showBrowse', 'toast']) app[name] = vi.fn();
  return app;
};

it('manual save waits for autosave and uses its new version', async () => {
  const app = createApp(); const first = deferred();
  app.api = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ id: 1, version: 3 });
  const autosave = app.autosaveNote();
  app.payload.content = 'AB';
  const manual = app.saveNote({ keepOpen: true });
  expect(app.api).toHaveBeenCalledTimes(1);
  first.resolve({ id: 1, version: 2, content: 'A' });
  await autosave; await manual;
  expect(app.api.mock.calls[1][2]).toMatchObject({ content: 'AB', version: 2 });
  expect(app.autosaveDirty).toBe(false);
});

it('retains input typed while a conflict override is in flight', async () => {
  const app = createApp(); const request = deferred();
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
  app.api = vi.fn().mockReturnValue(request.promise);
  const saving = app.handleVersionConflict({ id: 1, content: 'remote', version: 2 });
  app.payload.content = 'AB';
  request.resolve({ id: 1, content: 'A', version: 3 });
  await saving;
  expect(app.payload.content).toBe('AB');
  expect(app.autosaveDirty).toBe(true);
  expect(app.clearEditorDraft).not.toHaveBeenCalled();
  expect(app.autosaveTimer).toBeTruthy();
});

it('does not prompt when only the server version differs', async () => {
  const app = createApp(); vi.stubGlobal('confirm', vi.fn());
  await app.handleVersionConflict({ ...app.payload, id: 1, version: 4 });
  expect(confirm).not.toHaveBeenCalled();
  expect(app.editingNoteVersion).toBe(4);
  expect(app.autosaveDirty).toBe(false);
});
