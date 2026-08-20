import { apiPath } from '../config.js';
import {
  IMAGE_WIDTHS,
  MAX_GALLERY_COLUMNS,
  MIN_GALLERY_COLUMNS,
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

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_LABEL = '20 MB';
const ALLOWED_IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|svg\+xml|avif|bmp)$/i;

function imageAltText(name) {
  return String(name || 'image').replace(/[\[\]\n\r]/g, ' ').trim() || 'image';
}

function imageMarkdown(attrs) {
  const alt = imageAltText(attrs.alt);
  const src = String(attrs.src || attrs.url || '');
  const widthPercent = String(attrs.widthPercent || '').replace(/%$/, '');
  const width = String(attrs.width || '').replace(/%$/, '');
  const title = attrs.title ? ` "${String(attrs.title).replace(/"/g, '\\"')}"` : '';
  const base = `![${alt}](${src}${title})`;
  if (/^\d+$/.test(width)) return `${base}{width=${width}px}`;
  if (IMAGE_WIDTHS.has(widthPercent)) return `${base}{width=${widthPercent}%}`;
  return base;
}

function getUploadErrorMessage(response, data, fallback) {
  if (response.status === 413 || data?.code === 'FILE_TOO_LARGE') return `图片超过 ${MAX_IMAGE_LABEL}，无法上传`;
  if (response.status === 401 || response.status === 403) return '编辑登录已失效，请重新登录';
  if (response.status === 415) return '不支持的图片格式';
  return data?.error || data?.message || fallback || `图片上传失败（HTTP ${response.status}）`;
}

export const editorMethods = {
  async openNoteModal(editId) {
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
    const deleteBtn = document.getElementById('modalDeleteBtn');
    let content = '';
    let existingNote = null;

    if (editId) {
      existingNote = this._notes.find((item) => item.id === editId);
      if (!existingNote) return;
      document.getElementById('modalTitle').textContent = '编辑笔记';
      document.getElementById('modalSaveBtn').textContent = '更新笔记';
      titleEl.value = existingNote.title;
      this.ensureCategoryOptions(existingNote.category);
      categoryEl.value = existingNote.category;
      tagsEl.value = (existingNote.tags || []).join(', ');
      content = existingNote.content || '';
      this.editingNoteVersion = Number(existingNote.version) || 1;
      deleteBtn.style.display = '';
    } else {
      document.getElementById('modalTitle').textContent = '新建笔记';
      document.getElementById('modalSaveBtn').textContent = '保存笔记';
      titleEl.value = '';
      this.ensureCategoryOptions(this.getDefaultCategoryId());
      categoryEl.value = this.getDefaultCategoryId();
      tagsEl.value = '';
      deleteBtn.style.display = 'none';
    }
    this.draftNotebookId = existingNote?.notebookId ?? this.getCurrentNotebookId();

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
      category: document.getElementById('noteCategory')?.value,
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
    this.ensureCategoryOptions(draft.category || this.getDefaultCategoryId());
    document.getElementById('noteCategory').value = draft.category || this.getDefaultCategoryId();
    document.getElementById('noteTags').value = (draft.tags || []).join(', ');
    this.draftNotebookId = draft.notebookId ?? this.draftNotebookId;
    await this.setEditorMarkdown(draft.content);
    this.setEditorMode('write');
    this.suppressAutosave = false;
    this.autosaveDirty = true;
    this.setAutosaveStatus('已恢复本地草稿，等待保存');
    pending.resolve(true);
  },

  async saveNote(options = {}) {
    if (this.role !== 'editor') return;
    const title = document.getElementById('noteTitle').value.trim();
    if (!title) return alert('请输入笔记标题');
    if (!this.getEditorMarkdown().trim()) return alert('请输入笔记内容');

    const draftNoteId = this.editingNoteId;
    const payload = this.getNoteFormPayload();
    if (this.editingNoteId && this.editingNoteVersion) payload.version = this.editingNoteVersion;
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
      this.autosaveDirty = false;
      await this.clearEditorDraft(draftNoteId);
      await this.reloadNotes();
      this.updateCounts();
      this.renderTags();
      if (options.keepOpen) this.renderNotes();
      else { this.closeModal({ force: true }); this.showBrowse(); }
      this.toast('笔记已保存');
    } catch (error) {
      if (error.code === 'VERSION_CONFLICT' || error.status === 409) return this.handleVersionConflict(error.current);
      this.toast(error.message);
    } finally { this.showLoading(false); }
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

  hasUnsavedEditorInput() {
    if (this.autosaveDirty) return true;
    if (this.editingNoteId) return false;
    return Boolean(document.getElementById('noteTitle')?.value.trim() || this.getEditorMarkdown().trim());
  },

  closeModal(options = {}) {
    if (!options.force && this.role === 'editor' && this.hasUnsavedEditorInput() && !confirm('有未保存的修改，确定要关闭吗？')) return;
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
    if (!this.editingNoteId || this.autosaveInFlight || !this.autosaveDirty) return;
    this.autosaveInFlight = true; this.setAutosaveStatus('正在自动保存...');
    try {
      const payload = this.getNoteFormPayload();
      if (!payload.title || !payload.content) { this.setAutosaveStatus('标题或内容为空，自动保存暂停'); return; }
      payload.version = this.editingNoteVersion;
      const updated = await this.api('PUT', apiPath(`/notes/${this.editingNoteId}`), payload);
      this.editingNoteVersion = Number(updated.version) || this.editingNoteVersion;
      this.autosaveDirty = false;
      const local = this._notes.find((note) => note.id === updated.id);
      if (local) Object.assign(local, updated);
      this.lastKnownNotesVersion = this.getNotesVersionFingerprint();
      await this.clearEditorDraft(updated.id);
      this.setAutosaveStatus(`已自动保存 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    } catch (error) {
      if (error.status === 409 || error.code === 'VERSION_CONFLICT') this.handleVersionConflict(error.current);
      else this.setAutosaveStatus('自动保存失败');
    } finally { this.autosaveInFlight = false; }
  },

  getNoteFormPayload() {
    const tagsRaw = document.getElementById('noteTags').value.trim();
    return {
      title: document.getElementById('noteTitle').value.trim(),
      category: document.getElementById('noteCategory').value,
      tags: tagsRaw ? tagsRaw.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
      content: this.getEditorMarkdown().trim(),
      notebookId: this.draftNotebookId,
    };
  },

  async handleVersionConflict(remote) {
    this.conflictPending = true;
    if (confirm('这篇笔记在其他设备上更新过。加载服务器版本并放弃当前编辑吗？')) {
      if (remote) await this.applyRemoteNoteToEditor(remote);
      else if (this.editingNoteId) await this.applyRemoteNoteToEditor(await this.api('GET', apiPath(`/notes/${this.editingNoteId}`)));
      this.conflictPending = false; this.toast('已加载服务器版本'); return;
    }
    if (!confirm('要用当前内容覆盖服务器版本吗？')) return;
    try {
      this.showLoading(true);
      const payload = this.getNoteFormPayload(); payload.version = this.editingNoteVersion; payload.force = true;
      const updated = await this.api('PUT', apiPath(`/notes/${this.editingNoteId}`), payload);
      this.editingNoteVersion = Number(updated.version) || this.editingNoteVersion;
      this.autosaveDirty = false; this.conflictPending = false;
      await this.clearEditorDraft(updated.id);
      await this.reloadNotes(); this.toast('已覆盖服务器版本');
    } catch (error) { this.toast(error.message); } finally { this.showLoading(false); }
  },

  async applyRemoteNoteToEditor(note) {
    if (!note) return;
    this.suppressAutosave = true;
    document.getElementById('noteTitle').value = note.title || '';
    this.ensureCategoryOptions(note.category || this.getDefaultCategoryId());
    document.getElementById('noteCategory').value = note.category || this.getDefaultCategoryId();
    document.getElementById('noteTags').value = (note.tags || []).join(', ');
    await this.setEditorMarkdown(note.content || '');
    this.draftNotebookId = note.notebookId || null;
    this.editingNoteVersion = Number(note.version) || 1;
    this.autosaveDirty = false; this.conflictPending = false;
    this.suppressAutosave = false;
    clearTimeout(this.autosaveTimer); this.autosaveTimer = null;
    void this.clearEditorDraft(note.id);
    this.setAutosaveStatus(`服务器版本 v${this.editingNoteVersion}`);
  },

  applyMarkdownFormat(type) {
    const editor = this.richEditor;
    if (!editor || this.currentEditorMode === 'source') return;
    const chain = editor.chain().focus();
    const heading = { h1: 1, h2: 2, h3: 3 }[type];
    if (heading) chain.toggleHeading({ level: heading }).run();
    else if (type === 'bold') chain.toggleBold().run();
    else if (type === 'italic') chain.toggleItalic().run();
    else if (type === 'quote') chain.toggleBlockquote().run();
    else if (type === 'ul') chain.toggleBulletList().run();
    else if (type === 'ol') chain.toggleOrderedList().run();
    else if (type === 'task') chain.toggleTaskList().run();
    else if (type === 'inlineCode') chain.toggleCode().run();
    else if (type === 'codeBlock') chain.toggleCodeBlock().run();
    else if (type === 'table') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    else if (type === 'link') {
      const href = prompt('链接地址', 'https://');
      if (href) chain.extendMarkRange('link').setLink({ href }).run();
    }
  },

  deleteSelectedImage(options = {}) {
    const editor = this.richEditor;
    const selection = editor?.state.selection;
    const selectedImage = selection?.node?.type?.name === 'image';
    if (!editor || this.currentEditorMode === 'source' || !selectedImage) {
      if (!options.silent) this.toast('请先单击需要删除的图片，再按 Delete 或点击删除图片');
      return false;
    }

    const parent = selection.$from.parent;
    if (parent.type.name === 'imageGallery' && parent.childCount === 1) {
      const galleryPosition = selection.$from.before(selection.$from.depth);
      editor.chain().focus().setNodeSelection(galleryPosition).deleteSelection().run();
    } else {
      editor.chain().focus().deleteSelection().run();
    }
    return true;
  },

  handleEditorKeydown(event) {
    const primary = event.ctrlKey || event.metaKey;
    if (!primary) {
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (this.deleteSelectedImage({ silent: true })) {
          event.preventDefault();
          return true;
        }
      }
      if (event.key === 'Tab') {
        const editor = this.richEditor;
        const command = event.shiftKey ? editor.chain().focus().liftListItem('listItem') : editor.chain().focus().sinkListItem('listItem');
        if (command.run()) return true;
      }
      return false;
    }
    if (event.key.toLowerCase() === 's') { event.preventDefault(); this.saveNote({ keepOpen: true }); return true; }
    if (event.key === 'Enter') { event.preventDefault(); this.saveNote(); return true; }
    if (event.key === '/') { event.preventDefault(); this.openShortcutModal(); return true; }
    if (event.key.toLowerCase() === 'k') { event.preventDefault(); this.applyMarkdownFormat('link'); return true; }
    if (event.altKey && ['1', '2', '3'].includes(event.key)) { event.preventDefault(); this.applyMarkdownFormat(`h${event.key}`); return true; }
    if (event.shiftKey && event.key === '7') { event.preventDefault(); this.applyMarkdownFormat('ol'); return true; }
    if (event.shiftKey && event.key === '8') { event.preventDefault(); this.applyMarkdownFormat('ul'); return true; }
    if (event.shiftKey && event.key.toLowerCase() === 'c') { event.preventDefault(); this.applyMarkdownFormat('codeBlock'); return true; }
    if (event.shiftKey && event.key.toLowerCase() === 'x') { event.preventDefault(); this.applyMarkdownFormat('task'); return true; }
    if (event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); this.cycleEditorMode(); return true; }
    return false;
  },

  getSelectedImageLayout() {
    const value = this.imageLayout || 'default';
    const columns = Number(value.replace('grid-', ''));
    return Number.isInteger(columns) && columns >= MIN_GALLERY_COLUMNS && columns <= MAX_GALLERY_COLUMNS
      ? { mode: 'gallery', columns }
      : { mode: 'image', columns: null };
  },

  setImageLayout(value) {
    const allowed = new Set(['default', 'grid-2', 'grid-3', 'grid-4']);
    this.imageLayout = allowed.has(value) ? value : 'default';
    document.querySelectorAll('[data-action="set-image-layout"]').forEach((button) => {
      const active = button.dataset.imageLayout === this.imageLayout;
      button.classList.toggle('modal__image-layout-btn--active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  },

  uploadImage() {
    const input = document.getElementById('imageInput');
    const layout = this.getSelectedImageLayout();
    input.dataset.insertMode = layout.mode;
    input.dataset.galleryColumns = layout.columns || '';
    input.click();
  },

  uploadGallery() {
    const input = document.getElementById('imageInput');
    const layout = this.getSelectedImageLayout();
    input.dataset.insertMode = 'gallery';
    input.dataset.galleryColumns = layout.columns || MIN_GALLERY_COLUMNS;
    input.click();
  },

  uploadVideo() { document.getElementById('videoInput')?.click(); },

  async handleVideoSelected(event) {
    if (this.role !== 'editor') { this.toast('Editor access is required'); event.target.value = ''; return; }
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const formData = new FormData();
    formData.append('video', file);
    this.showLoading(true);
    try {
      const response = await fetch(apiPath('/media'), { method: 'POST', credentials: 'include', body: formData });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.url) throw new Error(data?.error || 'Video upload failed');
      if (this.currentEditorMode === 'source') {
        const source = document.getElementById('noteContent');
        const markup = `\n<video controls preload="metadata"${data.posterUrl ? ` poster="${data.posterUrl}"` : ''} src="${data.url}"></video>\n`;
        source?.setRangeText(markup, source.selectionStart, source.selectionEnd, 'end');
        this.handleSourceInput();
      } else {
        this.richEditor?.chain().focus().insertContent({ type: 'video', attrs: { src: data.url, poster: data.posterUrl || null } }).run();
      }
      this.toast('Video uploaded and inserted');
    } catch (error) {
      this.toast(error.message);
    } finally {
      this.showLoading(false);
    }
  },

  validateImageFile(file) {
    if (!file || !ALLOWED_IMAGE_TYPES.test(String(file.type || ''))) { this.toast('请选择 PNG、JPG、GIF、WebP、SVG、AVIF 或 BMP 图片'); return false; }
    if (file.size > MAX_IMAGE_BYTES) { this.toast(`图片超过 ${MAX_IMAGE_LABEL}，无法上传`); return false; }
    return true;
  },

  setImageUploadState(active, label = '') {
    const status = document.getElementById('imageUploadStatus');
    const text = document.getElementById('imageUploadLabel');
    this.imageUploadInFlight = active;
    status?.classList.toggle('upload-status--active', active);
    if (text) text.textContent = active ? label : '';
    document.querySelectorAll('[data-action="upload-image"], [data-action="upload-gallery"]').forEach((button) => { button.disabled = active; });
  },

  async handleImageSelected(event) {
    const files = Array.from(event.target.files || []); const mode = event.target.dataset.insertMode || 'image';
    const columns = Number(event.target.dataset.galleryColumns) || null;
    event.target.value = ''; event.target.dataset.insertMode = ''; event.target.dataset.galleryColumns = '';
    if (files.length) await this.uploadImageFiles(files, { mode, columns });
  },

  async uploadImageFiles(files, options = {}) {
    if (this.role !== 'editor' || this.imageUploadInFlight) return;
    const valid = Array.from(files).filter((file) => this.validateImageFile(file));
    if (!valid.length) return;
    const uploaded = [];
    this.showLoading(true);
    try {
      for (let index = 0; index < valid.length; index += 1) {
        const file = valid[index];
        this.setImageUploadState(true, `正在上传 ${index + 1}/${valid.length}: ${imageAltText(file.name)}`);
        uploaded.push({ name: file.name, url: await this.uploadImageFile(file) });
      }
      this.insertUploadedImages(uploaded, options);
      this.toast(uploaded.length > 1 ? `${uploaded.length} 张图片已插入` : '图片已插入');
    } catch (error) { this.toast(error.message); }
    finally { this.setImageUploadState(false); this.showLoading(false); }
  },

  async uploadImageFile(file) {
    const formData = new FormData(); formData.append('image', file);
    const response = await fetch(apiPath('/upload'), { method: 'POST', credentials: 'include', body: formData });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
    const fallback = data ? '' : (await response.text().catch(() => '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!response.ok || !data?.url) throw new Error(getUploadErrorMessage(response, data, fallback));
    return data.url;
  },

  insertUploadedImages(images, options = {}) {
    if (!images.length) return;
    const useGallery = options.mode === 'gallery' && images.length > 1;
    const galleryColumns = Math.min(MAX_GALLERY_COLUMNS, Math.max(MIN_GALLERY_COLUMNS, Number(options.columns) || MIN_GALLERY_COLUMNS));
    if (this.currentEditorMode === 'source') {
      const markdown = useGallery
        ? `\n:::images{columns=${galleryColumns}}\n${images.map((image) => imageMarkdown({ ...image, widthPercent: 100 })).join('\n')}\n:::\n`
        : images.map((image) => imageMarkdown(image)).join('\n');
      const source = document.getElementById('noteContent');
      const start = source.selectionStart; source.setRangeText(markdown, start, source.selectionEnd, 'end'); this.handleSourceInput(); return;
    }
    const nodeForImage = (image, gallery = false) => ({
      type: 'image',
      attrs: {
        src: image.url || image.src,
        alt: imageAltText(image.name || image.alt),
        title: image.title || null,
        ...(gallery ? { widthPercent: 100 } : {}),
      },
    });
    const content = useGallery
      ? { type: 'imageGallery', attrs: { columns: galleryColumns }, content: images.map((image) => nodeForImage(image, true)) }
      : images.map((image) => nodeForImage(image));
    const chain = this.richEditor.chain().focus();
    if (Number.isInteger(options.position)) chain.insertContentAt(options.position, content).run();
    else chain.insertContent(content).run();
  },
};
