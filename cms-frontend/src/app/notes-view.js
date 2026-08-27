// ===== 浏览视图：筛选、列表、详情、目录 =====
export const notesViewMethods = {
  getCurrentMenu() {
    return this._menus.find(menu => menu.id === this.currentNav) || null;
  },

  getCurrentNotebookId() {
    const menu = this.getCurrentMenu();
    return menu && menu.type === 'notebook' ? menu.id : null;
  },

  getCurrentNotebookLabel() {
    const menu = this.getCurrentMenu();
    return menu && menu.type === 'notebook' ? menu.label : 'Docs';
  },

  getScopedNotes() {
    const notebookId = this.getCurrentNotebookId();
    if (!notebookId) return [...this._notes];
    return this._notes.filter(note => note.notebookId === notebookId);
  },

  getFilteredNotes() {
    let notes = this.getScopedNotes();
    if (this.currentFilter === 'star') notes = notes.filter(n => n.starred);
    else if (this.isCategoryFilter(this.currentFilter)) {
      const categoryId = this.getCategoryIdFromFilter(this.currentFilter);
      notes = notes.filter(n => n.category === categoryId);
    }
    else if (this.currentFilter.startsWith('tag:')) {
      const tag = this.currentFilter.slice(4);
      notes = notes.filter(n => Array.isArray(n.tags) && n.tags.includes(tag));
    }
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      notes = notes.filter(n =>
        (n.title || '').toLowerCase().includes(q) ||
        (n.desc || '').toLowerCase().includes(q) || (n.excerpt || '').toLowerCase().includes(q) ||
        (n.tags || []).some(t => t.toLowerCase().includes(q)) ||
        (n.content || '').toLowerCase().includes(q)
      );
    }
    return notes;
  },

  updateCounts() {
    const notes = this.getScopedNotes();
    document.getElementById('countAll').textContent = notes.length;
    document.getElementById('countStar').textContent = notes.filter(n => n.starred).length;
    this.renderCategories();
    this.renderMobileFilters();
    this.renderMobileNotebooks();
  },

  setSidebarActive(filter, el) {
    document.querySelectorAll('.sidebar__item--active').forEach(i => i.classList.remove('sidebar__item--active'));
    const target = el || Array.from(document.querySelectorAll('.sidebar__item'))
      .find(item => item.dataset.filter === filter);
    if (target) target.classList.add('sidebar__item--active');
  },

  setFilter(filter, el) {
    this.currentFilter = filter;
    this.searchQuery = '';
    document.getElementById('searchInput').value = '';
    this.setSidebarActive(filter, el);
    this.showBrowse(); // showBrowse 内部会 renderNotes
    this.updateCounts();
    this.closeMobileSheets();
  },

  setFilterFromElement(el) {
    if (!el) return;
    this.setFilter(el.dataset.filter || 'all', el);
  },

  showBrowse() {
    this.currentNote = null;
    document.getElementById('browseView').style.display = 'block';
    document.getElementById('detailView').classList.remove('detail-view--active');
    document.getElementById('pageView').classList.remove('page-view--active');
    document.getElementById('tocNav').style.display = (window.innerWidth >= 1200) ? '' : 'none';
    this.renderBrowseToc();
    this.renderNotes();
    this.syncHash();
  },

  showDetail(id) {
    const note = this._notes.find(n => n.id === id);
    if (!note) return;
    this.currentNote = note;
    const isEditor = this.role === 'editor';

    document.getElementById('browseView').style.display = 'none';
    document.getElementById('pageView').classList.remove('page-view--active');
    document.getElementById('tocNav').style.display = 'none';

    const detailEl = document.getElementById('detailView');
    detailEl.classList.add('detail-view--active');

    const metaHTML = [
      `<span class="detail__meta-tag">${this.escapeHTML(this.getCategoryLabel(note.category))}</span>`,
      ...(note.tags || []).map(t => `<span>#${this.escapeHTML(t)}</span>`),
      note.notebookId ? `<span>📚 ${this.escapeHTML(this._menus.find(m => m.id === note.notebookId)?.label || 'Notebook')}</span>` : '',
      `<span>📅 ${note.date}</span>`,
      `<span>⏱ ${note.readTime}阅读</span>`,
      note.starred ? '<span>⭐ 已收藏</span>' : ''
    ].join('');

    const editBtn = isEditor ? `<button class="btn btn--secondary" style="margin-left:auto" data-action="open-note-modal" data-id="${note.id}">✏️ 编辑</button>` : '';
    const contentHTML = this.renderMarkdown(note.content);

    detailEl.innerHTML = `
      <button class="detail__back" data-action="show-browse">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        返回列表
      </button>
      <div class="detail__meta">${metaHTML}${editBtn}</div>
      <div class="detail__content">${contentHTML}</div>
    `;
    this.renderDetailToc(detailEl);
    document.getElementById('mainContent').scrollTop = 0;
    this.syncHash();
  },

  renderBrowseToc() {
    const toc = document.getElementById('tocNav');
    if (!toc) return;
    toc.innerHTML = `
      <div class="toc__title">知识库导航</div>
      <div style="padding:0 var(--s3);font-size:.875rem;color:var(--c500);line-height:2.2">
        <div style="margin-bottom:8px;padding:8px 12px;background:var(--c100);border-radius:6px">
          <strong>Ctrl+K</strong> — 搜索知识条目<br>
          <strong>Esc</strong> — 返回目录 / 关闭弹窗<br>
          <strong>Ctrl+N</strong> — 新建条目
        </div>
        通过左侧分类、标签和顶部搜索快速定位资料。
      </div>`;
  },

  renderDetailToc(detailEl) {
    const toc = document.getElementById('tocNav');
    if (!toc || window.innerWidth < 1200) return;
    const headings = Array.from(detailEl.querySelectorAll('.detail__content h1, .detail__content h2, .detail__content h3'));
    if (!headings.length) {
      toc.style.display = 'none';
      return;
    }
    headings.forEach((heading, index) => { heading.id = `note-heading-${index}`; });
    toc.innerHTML = `<div class="toc__title">本文目录</div>${headings.map((heading, index) => `
      <div class="toc__item" style="padding-left:${(Number(heading.tagName.slice(1)) - 1) * 10}px">
        <a class="toc__link" data-action="scroll-heading" data-index="${index}">${this.escapeHTML(heading.textContent)}</a>
      </div>`).join('')}`;
    toc.style.display = '';
  },

  // ===== 笔记列表渲染 =====
  renderNotes() {
    const notes = this.getFilteredNotes();
    const isEditor = this.role === 'editor';
    const grid = document.getElementById('browseView');

    const categoryId = this.isCategoryFilter(this.currentFilter) ? this.getCategoryIdFromFilter(this.currentFilter) : null;
    const filterLabels = { 'all': '笔记管理文档', 'star': '收藏夹' };
    const filterDescs = {
      'all': '探索你的笔记目录结构，了解如何组织和管理个人知识库。点击卡片查看完整内容。',
      'star': '你收藏的重要笔记，方便快速查找和回顾。'
    };
    const filterTitle = categoryId
      ? `${this.getCategoryLabel(categoryId)}笔记`
      : (filterLabels[this.currentFilter] || this.currentFilter.replace('tag:', '#'));
    const notebookLabel = this.getCurrentNotebookLabel();
    const isNotebook = Boolean(this.getCurrentNotebookId());
    const title = isNotebook ? `${notebookLabel} / ${filterTitle}` : filterTitle;
    const desc = isNotebook
      ? `当前笔记本独立保存自己的笔记和分类；标签来自全局，可在此笔记本内继续筛选。`
      : (categoryId ? `当前分类下的笔记。你可以在左侧编辑分类名称，或继续用标签细分。` : (filterDescs[this.currentFilter] || ''));

    let html = `
      <div class="content-header">
        <div class="content-header__breadcrumb">
          <a data-action="nav" data-id="docs">Docs</a><span>/</span>
          <a id="breadcrumbCurrent">${this.escapeHTML(isNotebook ? notebookLabel : filterTitle)}</a>
        </div>
        <h1 class="content-header__title">${this.escapeHTML(title)}</h1>
        <p class="content-header__desc">${desc}</p>
      </div>
      <div class="stats-bar">
        <div class="stat-pill">📄 共 <strong id="totalNotes">${notes.length}</strong> 篇笔记</div>
        <div class="stat-pill">🕐 最近更新：<strong id="lastUpdated">${notes.length ? notes[0].date : '—'}</strong></div>
      </div>
      <div class="notes-grid">`;

    if (notes.length === 0) {
      const isFiltered = Boolean(this.searchQuery) || this.currentFilter !== 'all';
      html += `
        <div class="empty-state">
          <div class="empty-state__icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <div class="empty-state__title">${isFiltered ? '没有找到匹配的笔记' : '还没有笔记'}</div>
          <div class="empty-state__desc">${isFiltered ? '尝试更换搜索关键词或选择其他分类' : (isEditor ? '点击下方按钮创建第一篇笔记' : '这里还没有内容')}</div>
          ${isEditor ? `<button class="btn btn--primary" data-action="open-note-modal">+ 新建笔记</button>` : ''}
        </div>`;
    } else {
      html += notes.map(n => `
        <div class="note-card" data-action="show-detail" data-id="${n.id}" role="button" tabindex="0">
          <div class="note-card__header">
            <div class="note-card__icon">${this.getIconSVG(n.id)}</div>
            ${isEditor ? `<div class="note-card__actions">
              <button class="note-card__action-btn" title="切换收藏" data-action="toggle-star" data-id="${n.id}">${n.starred ? '⭐' : '☆'}</button>
              <button class="note-card__action-btn note-card__action-btn--delete" title="删除" data-action="delete-note" data-id="${n.id}">🗑</button>
            </div>` : ''}
          </div>
          <h3 class="note-card__title">${this.escapeHTML(n.title)}</h3>
          <p class="note-card__excerpt">${this.escapeHTML(this.getNotePreviewText(n))}</p>
          <div class="note-card__footer">
            <span class="note-card__date">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              ${n.date}
            </span>
            <span class="note-card__readtime">${n.readTime} 阅读</span>
            <div class="note-card__tags">${(n.tags || []).map(t => `<span class="note-card__tag">#${this.escapeHTML(t)}</span>`).join('')}</div>
          </div>
        </div>`).join('');
    }

    html += '</div>';
    grid.innerHTML = html;
  },

  // ===== 搜索 =====
  filter() {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this.searchQuery = document.getElementById('searchInput').value;
      this.renderNotes();
    }, 250);
  },

  // ===== Markdown 渲染 =====
  markdownToPlainText(md) {
    const host = document.createElement('div');
    host.innerHTML = this.renderMarkdown(md || '');
    return (host.textContent || '').replace(/\s+/g, ' ').trim();
  },

  getNotePreviewText(note) {
    // Markdown 全量渲染开销大，按 id+version 缓存，避免每次列表重绘都重新解析
    const cacheKey = `${note?.id}:${note?.version || 1}:${note?.updatedAt || ''}`;
    const cached = this._previewCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const explicit = String(note?.desc || '').trim();
    const text = explicit || this.markdownToPlainText(note?.content || note?.excerpt || '');
    const fallback = String(note?.excerpt || '');
    const preview = text || fallback;
    const cleaned = preview
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    const result = cleaned.length > 140 ? `${cleaned.slice(0, 140).trim()}...` : cleaned;
    if (this._previewCache.size > 500) this._previewCache.clear();
    this._previewCache.set(cacheKey, result);
    return result;
  },

  renderMarkdown(md) {
    if (window.CMSMarkdown?.render) return window.CMSMarkdown.render(md || '');
    // fail closed：渲染模块未加载时降级为纯文本，绝不走未净化的自研渲染
    return `<pre style="white-space:pre-wrap">${this.escapeHTML(md || '')}</pre>`;
  },
};
