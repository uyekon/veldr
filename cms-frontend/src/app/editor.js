import { apiPath } from '../config.js';
import {
  normalizeMarkdownStructure,
  normalizeImageWidths,
} from '../markdown-utils.js';
import {
  createDraftRecord,
  isDraftNewerThanNote,
  loadDraft,
  removeDraft,
  saveDraft,
} from './drafts.js';
import { editorFormatMethods } from './editor-format.js';
import { editorMediaMethods } from './editor-media.js';

// 版本号可能因同一台设备的并发自动保存而短暂落后。只有用户可编辑的
// 字段确实不同，才把它视为需要人工决定的冲突。
function hasSameNotePayload(left, right) {
  const normalized = (note = {}) => ({
    title: String(note.title || '').trim(),
    desc: String(note.desc || '').trim(),
    category: String(note.category || ''),
    notebookId: note.notebookId || null,
    tags: Array.isArray(note.tags) ? note.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
    content: normalizeMarkdownStructure(String(note.content || '')).trim(),
  });
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

export const editorMethods = {
  toggleEditorFullscreen() {
    const modal = document.getElementById('noteModal')?.querySelector('.modal');
    modal?.classList.toggle('modal--fullscreen');
  },
  async openNoteModal(editId) {
    if (this.getWhiteboardState?.('n')?.converting || this.getWhiteboardState?.('n')?.conversionRequest) { this.toast('请先确认日记转换结果'); return; }
    if (this.autosaveInFlight || this.manualSaveInFlight) { this.toast('正在保存，请稍候'); return; }
    if (this.role !== 'editor') {
      this.toast('查看模式下不能编辑，请先登录管理员账号');
      return;
    }

    this.editingNoteId = editId || null;
    this.editingNoteVersion = null;
    const modal = document.getElementById('noteModal');
    const titleEl = document.getElementById('noteTitle');
    const categoryEl = document.getElementById('noteCategory');
    const tagsEl = document.getElementById('noteTags');
    const descEl = document.getElementById('noteDesc');
    const deleteBtn = document.getElementById('modalDeleteBtn');
    let content = '';
    let existingNote = null;

    if (editId) {
      existingNote = this._notes.find((item) => item.id === editId);
      if (!existingNote) return;
      document.getElementById('modalTitle').textContent = '编辑笔记';
      document.getElementById('modalSaveBtn').textContent = '更新笔记';
      titleEl.value = existingNote.title;
      tagsEl.value = (existingNote.tags || []).join(', ');
      if (descEl) descEl.value = existingNote.desc || '';
      content = existingNote.content || '';
      this.editingNoteVersion = Number(existingNote.version) || 1;
      deleteBtn.style.display = '';
    } else {
      document.getElementById('modalTitle').textContent = '新建笔记';
      document.getElementById('modalSaveBtn').textContent = '保存笔记';
      titleEl.value = '';
      tagsEl.value = '';
      if (descEl) descEl.value = '';
      deleteBtn.style.display = 'none';
    }
    this.draftNotebookId = existingNote?.notebookId ?? this.getCurrentNotebookId();
    this.ensureNotebookOptions(this.draftNotebookId);
    this.setCategorySelection(existingNote?.category || this.getDefaultCategoryId(), this.draftNotebookId);

    modal.classList.add('modal-overlay--active');
    this.autosaveDirty = false;
    this.conflictPending = false;
    this.suppressAutosave = true;
    await this.setEditorMarkdown(content);
    this.setEditorMode('write');
    this.updateMarkdownPreview(true);
    this.suppressAutosave = false;
    const restoredDraft = await this.restoreEditorDraft(existingNote);
    if (!restoredDraft) this.setAutosaveStatus(this.editingNoteId ? `服务器版本 v${this.editingNoteVersion || 1}` : '新笔记尚未保存');
    setTimeout(() => titleEl.focus(), 100);
  },


  getEditorMarkdown() {
    const source = document.getElementById('noteContent');
    if (this.currentEditorMode === 'source' && source) return normalizeMarkdownStructure(source.value);
    return normalizeMarkdownStructure(this.richEditor?.getMarkdown?.() || '');
  },

  clearPercentWidthAfterResize() {
    const editor = this.richEditor;
    if (!editor) return;
    const changes = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'image' && node.attrs.width && node.attrs.widthPercent) changes.push({ node, position });
    });
    if (!changes.length) return;
    editor.commands.command(({ tr }) => {
      changes.forEach(({ node, position }) => tr.setNodeMarkup(position, undefined, { ...node.attrs, widthPercent: null }));
      return true;
    });
  },

  async ensureRichEditor() {
    if (this.richEditor) return this.richEditor;
    if (this.richEditorLoadPromise) return this.richEditorLoadPromise;
    const host = document.getElementById('noteContentHost');
    if (!host) return null;
    document.getElementById('editorLoading')?.classList.add('editor-loading--active');
    this.richEditorLoadPromise = import('./rich-editor.js')
      .then(({ createRichEditor, parseLegacyMarkdown }) => {
        this.richEditorModule = { parseLegacyMarkdown };
        this.richEditor = createRichEditor(this, host);
        return this.richEditor;
      })
      .finally(() => {
        this.richEditorLoadPromise = null;
        document.getElementById('editorLoading')?.classList.remove('editor-loading--active');
      });
    return this.richEditorLoadPromise;
  },

  async setEditorMarkdown(markdown) {
    const editor = await this.ensureRichEditor();
    if (!editor) return;
    const source = normalizeMarkdownStructure(normalizeImageWidths(markdown));
    const sourceEl = document.getElementById('noteContent');
    if (sourceEl) sourceEl.value = source;
    editor.commands.setContent(this.richEditorModule.parseLegacyMarkdown(editor, source), { emitUpdate: false });
  },

  getEditorDraft() {
    const tagsRaw = document.getElementById('noteTags')?.value.trim() || '';
    return createDraftRecord({
      noteId: this.editingNoteId,
      title: document.getElementById('noteTitle')?.value,
      desc: document.getElementById('noteDesc')?.value || '',
      category: this.getSelectedCategoryId(),
      tags: tagsRaw ? tagsRaw.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
      content: this.getEditorMarkdown(),
      notebookId: this.draftNotebookId,
      serverVersion: this.editingNoteVersion,
      serverUpdatedAt: this._notes.find((note) => note.id === this.editingNoteId)?.updatedAt || null,
    });
  },

  scheduleDraftSave() {
    if (this.role !== 'editor' || this.suppressAutosave) return;
    clearTimeout(this.draftSaveTimer);
    this.draftSaveTimer = setTimeout(() => {
      const draft = this.getEditorDraft();
      if (!draft.title && !draft.content) return;
      saveDraft(draft).catch(() => {});
    }, 500);
  },

  async clearEditorDraft(noteId = this.editingNoteId) {
    clearTimeout(this.draftSaveTimer);
    this.draftSaveTimer = null;
    await removeDraft(noteId).catch(() => {});
  },

  async restoreEditorDraft(note) {
    const draft = await loadDraft(note?.id).catch(() => null);
    if (!draft || !isDraftNewerThanNote(draft, note)) return false;

    return new Promise((resolve) => {
      this.pendingDraftRecovery = { draft, note, resolve };
      document.getElementById('draftRecoveryMessage').textContent = note
        ? `检测到比服务器版本更新的本地草稿，保存时间：${new Date(draft.updatedAt).toLocaleString()}。`
        : `检测到未保存的新笔记草稿，保存时间：${new Date(draft.updatedAt).toLocaleString()}。`;
      document.getElementById('draftRecoveryModal')?.classList.add('modal-overlay--active');
      setTimeout(() => document.getElementById('restoreDraftBtn')?.focus(), 0);
    });

  },

  async resolveDraftRecovery(restore) {
    const pending = this.pendingDraftRecovery;
    if (!pending) return;
    this.pendingDraftRecovery = null;
    document.getElementById('draftRecoveryModal')?.classList.remove('modal-overlay--active');
    if (!restore) {
      await removeDraft(pending.note?.id).catch(() => {});
      pending.resolve(false);
      return;
    }
    const { draft } = pending;
    this.suppressAutosave = true;
    document.getElementById('noteTitle').value = draft.title;
    document.getElementById('noteDesc').value = draft.desc || '';
    this.draftNotebookId = draft.notebookId ?? this.draftNotebookId;
    this.ensureNotebookOptions(this.draftNotebookId);
    this.setCategorySelection(draft.category || this.getDefaultCategoryId(), this.draftNotebookId);
    document.getElementById('noteTags').value = (draft.tags || []).join(', ');
    await this.setEditorMarkdown(draft.content);
    this.setEditorMode('write');
    this.suppressAutosave = false;
    this.autosaveDirty = true;
    this.setAutosaveStatus('已恢复本地草稿，等待保存');
    pending.resolve(true);
  },

  async saveNote(options = {}) {
    if (this.role !== 'editor') return;
    if (this.manualSaveInFlight) return;
    if (this.noteSavePromise) await this.noteSavePromise;
    if (this.manualSaveInFlight) return;
    const title = document.getElementById('noteTitle').value.trim();
    if (!title) return alert('请输入笔记标题');
    if (!this.getEditorMarkdown().trim()) return alert('请输入笔记内容');

    const draftNoteId = this.editingNoteId;
    const payload = this.getNoteFormPayload();
    if (this.editingNoteId && this.editingNoteVersion) payload.version = this.editingNoteVersion;
    clearTimeout(this.autosaveTimer);
    this.manualSaveInFlight = true;
    this.showLoading(true);
    try {
      if (this.editingNoteId) {
        const updated = await this.api('PUT', apiPath(`/notes/${this.editingNoteId}`), payload);
        this.editingNoteVersion = Number(updated.version) || this.editingNoteVersion;
        this.setAutosaveStatus(`已保存 v${this.editingNoteVersion}`);
      } else {
        const created = await this.api('POST', apiPath('/notes'), payload);
        this.editingNoteId = created.id;
        this.editingNoteVersion = Number(created.version) || 1;
        document.getElementById('modalTitle').textContent = '编辑笔记';
        document.getElementById('modalSaveBtn').textContent = '更新笔记';
        document.getElementById('modalDeleteBtn').style.display = '';
        this.setAutosaveStatus(`已保存 v${this.editingNoteVersion}`);
      }
      this.autosaveDirty = !hasSameNotePayload(payload, this.getNoteFormPayload());
      if (!this.autosaveDirty) await this.clearEditorDraft(draftNoteId);
      else this.scheduleAutosave();
      await this.reloadNotes();
      this.updateCounts();
      this.renderTags();
      if (options.keepOpen || this.autosaveDirty) this.renderNotes();
      else {
        this._browseReturnNoteId = this.editingNoteId;
        this.closeModal({ force: true });
        this.showBrowse();
      }
      this.toast(this.autosaveDirty ? '已保存提交内容，新增修改等待保存' : '笔记已保存');
    } catch (error) {
      if (error.code === 'VERSION_CONFLICT' || error.status === 409) return await this.handleVersionConflict(error.current);
      this.toast(error.message);
    } finally {
      this.manualSaveInFlight = false; this.showLoading(false);
      if (this.autosaveDirty && !this.conflictPending) this.scheduleAutosave();
    }
  },

  async deleteNote() {
    if (!this.editingNoteId || !confirm('确定要删除这篇笔记吗？此操作不可撤销。')) return;
    this.showLoading(true);
    try {
      await this.api('DELETE', apiPath(`/notes/${this.editingNoteId}`));
      await this.clearEditorDraft(this.editingNoteId);
      await this.reloadNotes(); this.updateCounts(); this.renderTags();
      this.closeModal({ force: true }); this.showBrowse(); this.toast('笔记已删除');
    } catch (error) { this.toast(error.message); } finally { this.showLoading(false); }
  },

  async deleteNoteDirect(id) {
    if (this.role !== 'editor' || !confirm('确定要删除这篇笔记吗？')) return;
    this.showLoading(true);
    try {
      await this.api('DELETE', apiPath(`/notes/${id}`));
      await this.clearEditorDraft(id);
      await this.reloadNotes(); this.updateCounts(); this.renderTags();
      if (this.currentNote?.id === id) { this.currentNote = null; this.showBrowse(); }
      this.renderNotes(); this.toast('笔记已删除');
    } catch (error) { this.toast(error.message); } finally { this.showLoading(false); }
  },

  async toggleStar(id) {
    if (this.role !== 'editor') return;
    const note = this._notes.find((item) => item.id === id);
    if (!note) return;
    const starred = !note.starred;
    note.starred = starred; this.updateCounts(); this.renderNotes();
    try { await this.api('PUT', apiPath(`/notes/${id}`), { starred }); }
    catch (error) { note.starred = !starred; this.updateCounts(); this.renderNotes(); this.toast(error.message); }
  },

  async togglePin(id) {
    if (this.role !== 'editor') return;
    const note = this._notes.find((item) => item.id === id);
    if (!note) return;
    const pinned = !note.pinned;
    note.pinned = pinned; this.renderNotes();
    try { await this.api('PUT', apiPath(`/notes/${id}`), { pinned }); }
    catch (error) { note.pinned = !pinned; this.renderNotes(); this.toast(error.message); }
  },

  async toggleArchive(id) {
    if (this.role !== 'editor') return;
    const note = this._notes.find((item) => item.id === id);
    if (!note) return;
    const archived = (note.tags || []).some((tag) => String(tag).toLowerCase() === 'archived');
    const tags = (note.tags || []).filter((tag) => String(tag).toLowerCase() !== 'archived');
    if (!archived) tags.push('archived');
    const previousTags = note.tags;
    note.tags = tags;
    this.updateCounts(); this.renderTags(); this.renderNotes();
    try {
      const updated = await this.api('PUT', apiPath(`/notes/${id}`), { tags, version: note.version });
      Object.assign(note, updated);
      if (this.currentNote?.id === id) this.showDetail(id);
      this.toast(archived ? '文章已取消归档' : '文章已归档');
    } catch (error) {
      note.tags = previousTags;
      this.updateCounts(); this.renderTags(); this.renderNotes();
      this.toast(error.message || '归档操作失败');
      if (this.currentNote?.id === id) this.showDetail(id);
    }
  },

  hasUnsavedEditorInput() {
    if (this.autosaveDirty) return true;
    if (this.editingNoteId) return false;
    return Boolean(document.getElementById('noteTitle')?.value.trim() || this.getEditorMarkdown().trim());
  },

  confirmEditorExit() {
    if (this.autosaveInFlight || this.manualSaveInFlight) { this.toast('正在保存，请稍候'); return false; }
    const modal = document.getElementById('noteModal');
    if (!modal?.classList.contains('modal-overlay--active') || !this.hasUnsavedEditorInput()) return true;
    if (confirm('有未保存的修改，确定要离开编辑吗？')) {
      void saveDraft(this.getEditorDraft()).catch(() => {});
      return true;
    }
    return false;
  },

  closeModal(options = {}) {
    if (!options.force && this.role === 'editor' && !this.confirmEditorExit()) return;
    if (!options.force && this.hasUnsavedEditorInput()) {
      void saveDraft(this.getEditorDraft()).catch(() => {});
    }
    document.getElementById('noteModal').classList.remove('modal-overlay--active');
    clearTimeout(this.autosaveTimer);
    clearTimeout(this.draftSaveTimer);
    this.autosaveTimer = null; this.autosaveDirty = false; this.conflictPending = false;
    this.editingNoteId = null; this.editingNoteVersion = null; this.draftNotebookId = null;
  },

  setEditorMode(mode) {
    const wrapper = document.getElementById('markdownEditor');
    const editor = this.richEditor;
    const source = document.getElementById('noteContent');
    if (!wrapper || !editor) return;
    const nextMode = ['write', 'source', 'preview'].includes(mode) ? mode : 'write';
    if (this.currentEditorMode === 'source' && nextMode === 'write') void this.setEditorMarkdown(source?.value || '');
    if (nextMode === 'source' && source) source.value = editor.getMarkdown();
    this.currentEditorMode = nextMode;
    wrapper.className = `markdown-editor markdown-editor--${nextMode}`;
    document.querySelectorAll('.modal__view-btn').forEach((button) => {
      button.classList.toggle('modal__view-btn--active', button.dataset.editorMode === nextMode);
    });
    this.updateMarkdownPreview(true);
    if (nextMode === 'source') {
      if (source) source.scrollTop = 0;
      const preview = document.getElementById('markdownPreview');
      if (preview) preview.scrollTop = 0;
    }
  },

  cycleEditorMode() {
    const modes = ['write', 'source', 'preview'];
    this.setEditorMode(modes[(modes.indexOf(this.currentEditorMode) + 1) % modes.length]);
  },

  handleSourceInput() { this.updateMarkdownPreview(); },

  updateMarkdownPreview(immediate = false) {
    this.updateMarkdownStats();
    if (!this.suppressAutosave) this.scheduleAutosave();
    clearTimeout(this._previewTimer);
    if (immediate) this.renderPreviewNow();
    else this._previewTimer = setTimeout(() => this.renderPreviewNow(), 120);
  },

  renderPreviewNow() {
    const preview = document.getElementById('markdownPreview');
    if (this.currentEditorMode !== 'write' && preview) preview.innerHTML = this.renderMarkdown(this.getEditorMarkdown());
  },

  updateMarkdownStats() {
    const text = this.getEditorMarkdown();
    const words = text.trim() ? (text.match(/[\u4e00-\u9fff]|[A-Za-z0-9_]+/g) || []).length : 0;
    const lines = text ? text.split('\n').length : 0;
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('markdownWords', `${words} 字`); set('markdownLines', `${lines} 行`);
    set('markdownReadTime', `${Math.max(1, Math.ceil(words / 350))} min 阅读`);
    set('markdownNotebook', this.getCurrentNotebookLabel());
  },

  setAutosaveStatus(text) { const el = document.getElementById('markdownAutosave'); if (el) el.textContent = text; },

  scheduleAutosave() {
    if (this.role !== 'editor') return;
    this.scheduleDraftSave();
    this.autosaveDirty = true;
    if (!this.editingNoteId || this.conflictPending) return;
    this.setAutosaveStatus('有未保存修改');
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.autosaveNote(), 2500);
  },

  async autosaveNote() {
    if (this.noteSavePromise) return this.noteSavePromise;
    if (this.manualSaveInFlight) return;
    this.noteSavePromise = this.performAutosaveNote();
    try { return await this.noteSavePromise; } finally { this.noteSavePromise = null; }
  },

  async performAutosaveNote() {
    if (!this.editingNoteId || !this.autosaveDirty) return;
    this.autosaveInFlight = true; this.setAutosaveStatus('正在自动保存...');
    try {
      const payload = this.getNoteFormPayload();
      if (!payload.title || !payload.content) { this.setAutosaveStatus('标题或内容为空，自动保存暂停'); return; }
      payload.version = this.editingNoteVersion;
      const updated = await this.api('PUT', apiPath(`/notes/${this.editingNoteId}`), payload);
      this.editingNoteVersion = Number(updated.version) || this.editingNoteVersion;
      const local = this._notes.find((note) => note.id === updated.id);
      if (local) Object.assign(local, updated);
      this.lastKnownNotesVersion = this.getNotesVersionFingerprint();
      if (hasSameNotePayload(payload, this.getNoteFormPayload())) {
        this.autosaveDirty = false;
        await this.clearEditorDraft(updated.id);
        if (this.autosaveDirty) this.scheduleAutosave();
        else this.setAutosaveStatus(`已自动保存 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      } else {
        // 请求发送后又输入了内容：保留脏状态并继续排队，不能把新输入误标记为已保存。
        this.autosaveDirty = true;
        this.setAutosaveStatus('检测到新修改，等待下一次自动保存');
        clearTimeout(this.autosaveTimer);
        this.autosaveTimer = setTimeout(() => this.autosaveNote(), 2500);
      }
    } catch (error) {
      if (error.status === 409 || error.code === 'VERSION_CONFLICT') await this.handleVersionConflict(error.current);
      else this.setAutosaveStatus('自动保存失败');
    } finally { this.autosaveInFlight = false; }
  },

  getNoteFormPayload() {
    const tagsRaw = document.getElementById('noteTags').value.trim();
    return {
      title: document.getElementById('noteTitle').value.trim(),
      desc: document.getElementById('noteDesc')?.value.trim() || '',
      category: this.getSelectedCategoryId(),
      tags: tagsRaw ? tagsRaw.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
      content: this.getEditorMarkdown().trim(),
      notebookId: this.draftNotebookId,
    };
  },

  async handleVersionConflict(remote) {
    const localPayload = this.getNoteFormPayload();
    if (remote && hasSameNotePayload(localPayload, remote)) {
      this.editingNoteVersion = Number(remote.version) || this.editingNoteVersion;
      this.autosaveDirty = false;
      this.conflictPending = false;
      const local = this._notes.find((note) => note.id === remote.id);
      if (local) Object.assign(local, remote);
      this.lastKnownNotesVersion = this.getNotesVersionFingerprint();
      await this.clearEditorDraft(remote.id);
      if (this.autosaveDirty) this.scheduleAutosave();
      else this.setAutosaveStatus(`已同步服务器版本 v${this.editingNoteVersion}`);
      return;
    }

    this.conflictPending = true;
    if (confirm('这篇笔记在其他设备上更新过。加载服务器版本并放弃当前编辑吗？')) {
      if (remote) await this.applyRemoteNoteToEditor(remote);
      else if (this.editingNoteId) await this.applyRemoteNoteToEditor(await this.api('GET', apiPath(`/notes/${this.editingNoteId}`)));
      this.conflictPending = false; this.toast('已加载服务器版本'); return;
    }
    try {
      this.showLoading(true);
      const payload = this.getNoteFormPayload(); payload.version = this.editingNoteVersion; payload.force = true;
      const updated = await this.api('PUT', apiPath(`/notes/${this.editingNoteId}`), payload);
      this.editingNoteVersion = Number(updated.version) || this.editingNoteVersion;
      this.autosaveDirty = !hasSameNotePayload(payload, this.getNoteFormPayload()); this.conflictPending = false;
      if (!this.autosaveDirty) await this.clearEditorDraft(updated.id);
      if (this.autosaveDirty) this.scheduleAutosave();
      await this.reloadNotes(); this.toast('已覆盖服务器版本');
    } catch (error) { this.toast(error.message); } finally { this.showLoading(false); }
  },

  async applyRemoteNoteToEditor(note) {
    if (!note) return;
    this.suppressAutosave = true;
    document.getElementById('noteTitle').value = note.title || '';
    this.draftNotebookId = note.notebookId || null;
    this.ensureNotebookOptions(this.draftNotebookId);
    this.setCategorySelection(note.category || this.getDefaultCategoryId(), this.draftNotebookId);
    document.getElementById('noteTags').value = (note.tags || []).join(', ');
    document.getElementById('noteDesc').value = note.desc || '';
    await this.setEditorMarkdown(note.content || '');
    this.editingNoteVersion = Number(note.version) || 1;
    this.autosaveDirty = false; this.conflictPending = false;
    this.suppressAutosave = false;
    clearTimeout(this.autosaveTimer); this.autosaveTimer = null;
    void this.clearEditorDraft(note.id);
    this.setAutosaveStatus(`服务器版本 v${this.editingNoteVersion}`);
  },

};

Object.assign(editorMethods, editorFormatMethods, editorMediaMethods);
