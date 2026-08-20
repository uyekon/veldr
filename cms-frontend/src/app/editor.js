import { apiPath } from '../config.js';

// ===== 笔记编辑器：弹窗、保存、自动保存、冲突处理、Markdown 工具、上传 =====
export const editorMethods = {
  openNoteModal(editId) {
    if (this.role !== 'editor') { this.toast('查看模式下无法编辑，请输入编辑密码'); return; }
    this.editingNoteId = editId || null;
    this.editingNoteVersion = null;
    const modal = document.getElementById('noteModal');
    const titleEl = document.getElementById('noteTitle');
    const categoryEl = document.getElementById('noteCategory');
    const tagsEl = document.getElementById('noteTags');
    const contentEl = document.getElementById('noteContent');
    const deleteBtn = document.getElementById('modalDeleteBtn');

    if (editId) {
      const note = this._notes.find(n => n.id === editId);
      if (!note) return;
      document.getElementById('modalTitle').textContent = '编辑笔记';
      document.getElementById('modalSaveBtn').textContent = '更新笔记';
      titleEl.value = note.title;
      this.ensureCategoryOptions(note.category);
      categoryEl.value = note.category;
      tagsEl.value = (note.tags || []).join(', ');
      contentEl.value = note.content;
      this.editingNoteVersion = Number(note.version) || 1;
      deleteBtn.style.display = '';
    } else {
      document.getElementById('modalTitle').textContent = '新建笔记';
      document.getElementById('modalSaveBtn').textContent = '保存笔记';
      titleEl.value = '';
      this.ensureCategoryOptions(this.getDefaultCategoryId());
      categoryEl.value = this.getDefaultCategoryId();
      tagsEl.value = '';
      contentEl.value = '';
      this.editingNoteVersion = null;
      deleteBtn.style.display = 'none';
    }
    modal.classList.add('modal-overlay--active');
    this.autosaveDirty = false;
    this.conflictPending = false;
    // 每次打开笔记默认使用“预览编辑”：左侧编辑源码，右侧实时预览。
    // 移动端也保持同一默认模式，用户可手动切换到源码或只读预览。
    this.setEditorMode('split');
    this.suppressAutosave = true;
    this.updateMarkdownPreview(true);
    this.suppressAutosave = false;
    this.setAutosaveStatus(this.editingNoteId ? `服务器版本 v${this.editingNoteVersion || 1}` : '新笔记尚未保存');
    setTimeout(() => titleEl.focus(), 100);
  },

  async saveNote(options = {}) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    const keepOpen = Boolean(options.keepOpen);
    const title = document.getElementById('noteTitle').value.trim();
    const content = document.getElementById('noteContent').value.trim();
    if (!title) { alert('请输入笔记标题'); return; }
    if (!content) { alert('请输入笔记内容'); return; }

    const payload = this.getNoteFormPayload();
    if (this.editingNoteId && this.editingNoteVersion) payload.version = this.editingNoteVersion;

    this.showLoading(true);
    try {
      if (this.editingNoteId) {
        const updated = await this.api('PUT', apiPath('/notes/' + this.editingNoteId), payload);
        this.editingNoteVersion = Number(updated.version) || this.editingNoteVersion;
        this.autosaveDirty = false;
        this.setAutosaveStatus(`已保存 v${this.editingNoteVersion}`);
        this.toast('笔记已更新');
      } else {
        const created = await this.api('POST', apiPath('/notes'), payload);
        this.editingNoteId = created.id;
        this.editingNoteVersion = Number(created.version) || null;
        document.getElementById('modalTitle').textContent = '编辑笔记';
        document.getElementById('modalSaveBtn').textContent = '更新笔记';
        document.getElementById('modalDeleteBtn').style.display = '';
        this.autosaveDirty = false;
        this.setAutosaveStatus(`已保存 v${this.editingNoteVersion || 1}`);
        this.toast('笔记已创建');
      }
      await this.reloadNotes();
      this.updateCounts();
      this.renderTags();
      if (!keepOpen) {
        this.closeModal({ force: true });
        this.showBrowse(); // showBrowse 内部会 renderNotes
      } else {
        this.renderNotes();
      }
    } catch (e) {
      if (e.code === 'VERSION_CONFLICT' || e.status === 409) {
        this.handleVersionConflict(e.current);
        return;
      }
      this.toast(e.message);
    } finally {
      this.showLoading(false);
    }
  },

  async deleteNote() {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    if (!this.editingNoteId) return;
    if (!confirm('确定要删除这篇笔记吗？此操作不可撤销。')) return;
    this.showLoading(true);
    try {
      await this.api('DELETE', apiPath('/notes/' + this.editingNoteId));
      await this.reloadNotes();
      this.updateCounts();
      this.renderTags();
      this.closeModal({ force: true });
      this.showBrowse();
      this.toast('笔记已删除');
    } catch (e) {
      this.toast(e.message);
    } finally {
      this.showLoading(false);
    }
  },

  async deleteNoteDirect(id) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    if (!confirm('确定要删除这篇笔记吗？')) return;
    this.showLoading(true);
    try {
      await this.api('DELETE', apiPath('/notes/' + id));
      await this.reloadNotes();
      this.updateCounts();
      this.renderTags();
      if (this.currentNote && this.currentNote.id === id) { this.currentNote = null; this.showBrowse(); }
      this.renderNotes();
      this.toast('笔记已删除');
    } catch (e) {
      this.toast(e.message);
    } finally {
      this.showLoading(false);
    }
  },

  async toggleStar(id) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    const note = this._notes.find(n => n.id === id);
    if (!note) return;
    const newStar = !note.starred;
    // 乐观更新
    note.starred = newStar;
    this.updateCounts();
    if (this.currentNote && this.currentNote.id === id) this.currentNote.starred = newStar;
    this.renderNotes();
    try {
      await this.api('PUT', apiPath('/notes/' + id), { starred: newStar });
    } catch (e) {
      note.starred = !newStar;
      this.updateCounts();
      this.renderNotes();
      this.toast(e.message);
    }
  },

  hasUnsavedEditorInput() {
    if (this.autosaveDirty) return true;
    if (this.editingNoteId) return false;
    // 新笔记：只要写了内容就视为未保存
    const title = document.getElementById('noteTitle')?.value.trim() || '';
    const content = document.getElementById('noteContent')?.value.trim() || '';
    return Boolean(title || content);
  },

  closeModal(options = {}) {
    if (!options.force && this.role === 'editor' && this.hasUnsavedEditorInput()) {
      if (!confirm('有未保存的修改，确定要关闭吗？')) return;
    }
    document.getElementById('noteModal').classList.remove('modal-overlay--active');
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    this.autosaveDirty = false;
    this.conflictPending = false;
    this.editingNoteId = null;
    this.editingNoteVersion = null;
  },

  setEditorMode(mode) {
    const editor = document.getElementById('markdownEditor');
    if (!editor) return;
    const safeMode = ['split', 'write', 'preview'].includes(mode) ? mode : 'split';
    this.currentEditorMode = safeMode;
    editor.className = `markdown-editor markdown-editor--${safeMode}`;
    document.querySelectorAll('.modal__view-btn').forEach(btn => {
      btn.classList.toggle('modal__view-btn--active', btn.dataset.editorMode === safeMode);
    });
    if (safeMode !== 'write') {
      // 切换视图只重渲染，不标记未保存
      const previousSuppress = this.suppressAutosave;
      this.suppressAutosave = true;
      this.updateMarkdownPreview(true);
      this.suppressAutosave = previousSuppress;
    }
  },

  cycleEditorMode() {
    const order = ['split', 'write', 'preview'];
    const index = Math.max(0, order.indexOf(this.currentEditorMode));
    this.setEditorMode(order[(index + 1) % order.length]);
  },

  updateMarkdownPreview(immediate = false) {
    this.updateMarkdownStats();
    if (!this.suppressAutosave) this.scheduleAutosave();
    clearTimeout(this._previewTimer);
    if (immediate) {
      this.renderPreviewNow();
    } else {
      // 防抖：长文逐字全量 parse + sanitize 会卡输入
      this._previewTimer = setTimeout(() => this.renderPreviewNow(), 150);
    }
  },

  renderPreviewNow() {
    if (this.currentEditorMode === 'write') return; // 预览隐藏时跳过渲染
    const content = document.getElementById('noteContent');
    const preview = document.getElementById('markdownPreview');
    if (!content || !preview) return;
    preview.innerHTML = this.renderMarkdown(content.value);
  },

  updateMarkdownStats() {
    const content = document.getElementById('noteContent');
    if (!content) return;
    const text = content.value || '';
    const trimmed = text.trim();
    const wordCount = trimmed ? (trimmed.match(/[一-龥]|[A-Za-z0-9_]+/g) || []).length : 0;
    const lines = text ? text.split('\n').length : 0;
    const readTime = Math.max(1, Math.ceil(wordCount / 350));
    const wordsEl = document.getElementById('markdownWords');
    const linesEl = document.getElementById('markdownLines');
    const readEl = document.getElementById('markdownReadTime');
    const notebookEl = document.getElementById('markdownNotebook');
    if (wordsEl) wordsEl.textContent = `${wordCount} 字`;
    if (linesEl) linesEl.textContent = `${lines} 行`;
    if (readEl) readEl.textContent = `${readTime} min 阅读`;
    if (notebookEl) notebookEl.textContent = this.getCurrentNotebookLabel();
  },

  setAutosaveStatus(text) {
    const el = document.getElementById('markdownAutosave');
    if (el) el.textContent = text;
  },

  scheduleAutosave() {
    if (this.role !== 'editor') return;
    this.autosaveDirty = true;
    if (!this.editingNoteId) return; // 新笔记未创建前只标记脏状态，供关闭确认使用
    if (this.conflictPending) return; // 冲突未处理时暂停自动保存，避免反复 409
    this.setAutosaveStatus('有未保存修改');
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.autosaveNote(), 2500);
  },

  async autosaveNote() {
    if (!this.editingNoteId || this.autosaveInFlight || !this.autosaveDirty) return;
    this.autosaveInFlight = true;
    this.setAutosaveStatus('正在自动保存...');
    try {
      const payload = this.getNoteFormPayload();
      if (!payload.title || !payload.content) {
        this.setAutosaveStatus('标题或内容为空，自动保存暂停');
        return;
      }
      payload.version = this.editingNoteVersion;
      const updated = await this.api('PUT', apiPath('/notes/' + this.editingNoteId), payload);
      this.editingNoteVersion = Number(updated.version) || this.editingNoteVersion;
      this.autosaveDirty = false;
      const local = this._notes.find(note => note.id === updated.id);
      if (local) Object.assign(local, updated);
      this.lastKnownNotesVersion = this.getNotesVersionFingerprint();
      this.setAutosaveStatus(`已自动保存 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    } catch (e) {
      if (e.status === 409 || e.code === 'VERSION_CONFLICT') {
        this.setAutosaveStatus('其它设备有更新，自动保存已暂停');
        this.handleVersionConflict(e.current);
      } else {
        this.setAutosaveStatus('自动保存失败');
      }
    } finally {
      this.autosaveInFlight = false;
    }
  },

  getNoteFormPayload() {
    const title = document.getElementById('noteTitle').value.trim();
    const category = document.getElementById('noteCategory').value;
    const tagsRaw = document.getElementById('noteTags').value.trim();
    const content = document.getElementById('noteContent').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    return { title, category, tags, content, notebookId: this.getCurrentNotebookId() };
  },

  async handleVersionConflict(remote) {
    this.conflictPending = true;
    if (confirm('这篇笔记在其它设备上更新过。选择“确定”重新加载服务器版本（当前编辑内容会丢弃）。')) {
      if (remote) {
        this.applyRemoteNoteToEditor(remote);
      } else if (this.editingNoteId) {
        this.applyRemoteNoteToEditor(await this.api('GET', apiPath('/notes/' + this.editingNoteId)));
      }
      this.conflictPending = false;
      this.toast('已加载服务器版本');
      return;
    }

    // 覆盖服务器是破坏性操作，必须单独确认；取消则保留本地编辑、暂停自动保存
    if (!confirm('要用当前编辑内容覆盖服务器版本吗？服务器上的修改将丢失。')) {
      this.setAutosaveStatus('存在版本冲突，自动保存已暂停，请手动保存或重新打开');
      return;
    }

    if (!this.editingNoteId) return;
    try {
      this.showLoading(true);
      const payload = this.getNoteFormPayload();
      payload.version = this.editingNoteVersion;
      payload.force = true;
      const updated = await this.api('PUT', apiPath('/notes/' + this.editingNoteId), payload);
      this.editingNoteVersion = Number(updated.version) || this.editingNoteVersion;
      this.autosaveDirty = false;
      this.conflictPending = false;
      this.setAutosaveStatus('已覆盖保存');
      await this.reloadNotes();
      this.toast('已覆盖服务器版本');
    } catch (e) {
      this.toast(e.message);
    } finally {
      this.showLoading(false);
    }
  },

  applyRemoteNoteToEditor(note) {
    if (!note) return;
    const previousSuppress = this.suppressAutosave;
    this.suppressAutosave = true;
    try {
      document.getElementById('noteTitle').value = note.title || '';
      this.ensureCategoryOptions(note.category || this.getDefaultCategoryId());
      document.getElementById('noteCategory').value = note.category || this.getDefaultCategoryId();
      document.getElementById('noteTags').value = (note.tags || []).join(', ');
      document.getElementById('noteContent').value = note.content || '';
      this.editingNoteVersion = Number(note.version) || 1;
      this.autosaveDirty = false;
      this.conflictPending = false;
      this.updateMarkdownPreview(true);
    } finally {
      this.suppressAutosave = previousSuppress;
    }
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    this.autosaveDirty = false;
    this.setAutosaveStatus(`服务器版本 v${this.editingNoteVersion}`);
  },

  getEditorTextarea() {
    return document.getElementById('noteContent');
  },

  replaceEditorSelection(text, selectStart, selectEnd) {
    const ta = this.getEditorTextarea();
    if (!ta) return;
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || 0;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.focus();
    const nextStart = start + (selectStart ?? text.length);
    const nextEnd = start + (selectEnd ?? text.length);
    ta.selectionStart = nextStart;
    ta.selectionEnd = nextEnd;
    this.updateMarkdownPreview();
  },

  wrapEditorSelection(before, after, placeholder) {
    const ta = this.getEditorTextarea();
    if (!ta) return;
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || 0;
    const selected = ta.value.slice(start, end) || placeholder;
    const text = before + selected + after;
    this.replaceEditorSelection(text, before.length, before.length + selected.length);
  },

  prefixEditorLines(prefix, fallback) {
    const ta = this.getEditorTextarea();
    if (!ta) return;
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || 0;
    const selected = ta.value.slice(start, end) || fallback;
    const lines = selected.split('\n');
    const text = lines.map((line, index) => (
      typeof prefix === 'function' ? prefix(line, index) : prefix + line
    )).join('\n');
    this.replaceEditorSelection(text, 0, text.length);
  },

  applyMarkdownFormat(type) {
    const ta = this.getEditorTextarea();
    if (!ta) return;
    const selected = ta.value.slice(ta.selectionStart || 0, ta.selectionEnd || 0);
    const actions = {
      h1: () => this.prefixEditorLines('# ', '标题'),
      h2: () => this.prefixEditorLines('## ', '标题'),
      h3: () => this.prefixEditorLines('### ', '标题'),
      bold: () => this.wrapEditorSelection('**', '**', '粗体文本'),
      italic: () => this.wrapEditorSelection('*', '*', '斜体文本'),
      quote: () => this.prefixEditorLines('> ', '引用内容'),
      ul: () => this.prefixEditorLines('- ', '列表项'),
      ol: () => this.prefixEditorLines((line, index) => `${index + 1}. ${line}`, '列表项'),
      task: () => this.prefixEditorLines('- [ ] ', '待办事项'),
      inlineCode: () => this.wrapEditorSelection('`', '`', 'code'),
      codeBlock: () => this.replaceEditorSelection(`\`\`\`\n${selected || 'code'}\n\`\`\``, 4, 4 + (selected || 'code').length),
      table: () => this.replaceEditorSelection('| Name | Value |\n| --- | --- |\n| Item | Detail |'),
      link: () => this.wrapEditorSelection('[', '](https://example.com)', selected || '链接文本'),
    };
    if (actions[type]) actions[type]();
  },

  handleEditorKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveNote({ keepOpen: true }); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.saveNote(); return; }
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === '1') { e.preventDefault(); this.applyMarkdownFormat('h1'); return; }
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === '2') { e.preventDefault(); this.applyMarkdownFormat('h2'); return; }
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === '3') { e.preventDefault(); this.applyMarkdownFormat('h3'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); this.applyMarkdownFormat('bold'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); this.applyMarkdownFormat('italic'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.applyMarkdownFormat('link'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); this.openShortcutModal(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === '7') { e.preventDefault(); this.applyMarkdownFormat('ol'); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === '8') { e.preventDefault(); this.applyMarkdownFormat('ul'); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); this.applyMarkdownFormat('codeBlock'); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); this.applyMarkdownFormat('task'); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); this.cycleEditorMode(); return; }
    if (e.key === 'Tab') { e.preventDefault(); this.indentEditorLines(!e.shiftKey); }
  },

  indentEditorLines(indent) {
    const ta = this.getEditorTextarea();
    if (!ta) return;
    const value = ta.value;
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || 0;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEndIndex = value.indexOf('\n', end);
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const next = lines.map(line => indent ? '  ' + line : line.replace(/^ {1,2}/, '')).join('\n');
    ta.value = value.slice(0, lineStart) + next + value.slice(lineEnd);
    ta.selectionStart = lineStart;
    ta.selectionEnd = lineStart + next.length;
    this.updateMarkdownPreview();
  },

  // ===== 图片上传 =====
  uploadImage() {
    document.getElementById('imageInput').click();
  },

  async handleImageSelected(e) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); e.target.value = ''; return; }
    const file = e.target.files && e.target.files[0];
    e.target.value = '';                       // 允许重复选择同一文件
    if (!file) return;
    await this.uploadImageFile(file);
  },

  async uploadImageFile(file) {
    const fd = new FormData();
    fd.append('image', file);
    this.showLoading(true);
    try {
      const res = await fetch(apiPath('/upload'), { method: 'POST', credentials: 'include', headers: this.accessKey ? { 'X-Access-Key': this.accessKey } : {}, body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || '上传失败');
      this.insertMarkdownImage(file.name || data.name || 'image', data.url);
      this.toast('图片已插入');
    } catch (err) {
      this.toast(err.message);
    } finally {
      this.showLoading(false);
    }
  },

  uploadVideo() { document.getElementById('videoInput')?.click(); },

  async handleVideoSelected(e) {
    if (this.role !== 'editor') { this.toast('需要编辑密码'); e.target.value = ''; return; }
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const fd = new FormData(); fd.append('video', file);
    this.showLoading(true);
    try {
      const res = await fetch(apiPath('/media'), { method: 'POST', credentials: 'include', headers: this.accessKey ? { 'X-Access-Key': this.accessKey } : {}, body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || '视频上传失败');
      this.replaceEditorSelection(`\n<video controls preload="metadata" poster="${data.posterUrl || ''}" src="${data.url}"></video>\n`);
      this.updateMarkdownPreview(); this.toast('视频已上传并插入');
    } catch (err) { this.toast(err.message); } finally { this.showLoading(false); }
  },

  insertMarkdownImage(name, url) {
    const safeName = String(name || 'image').replace(/[\[\]\n\r]/g, ' ').trim() || 'image';
    const snippet = `![${safeName}](${url})`;
    this.replaceEditorSelection(snippet);
  },

  async handleEditorPaste(e) {
    const files = Array.from(e.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    for (const file of files) await this.uploadImageFile(file);
  },

  async handleEditorDrop(e) {
    const files = Array.from(e.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    if (this.role !== 'editor') { this.toast('需要编辑密码'); return; }
    const ta = this.getEditorTextarea();
    if (ta) ta.focus();
    for (const file of files) await this.uploadImageFile(file);
  },
};
