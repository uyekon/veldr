import { apiPath } from '../config.js';

export const mediaMethods = {
  async openMediaLibrary() {
    this.currentNote = null;
    document.getElementById('browseView').style.display = 'none';
    document.getElementById('detailView').classList.remove('detail-view--active');
    const page = document.getElementById('pageView');
    page.classList.add('page-view--active');
    page.innerHTML = '<div class="page-view__title">视频库</div><p>正在加载视频…</p>';
    try {
      const data = await this.api('GET', apiPath('/media'));
      const upload = this.role === 'editor' ? '<label class="btn btn--primary" style="display:inline-flex;cursor:pointer;margin-bottom:16px">上传视频<input id="mediaLibraryInput" type="file" accept="video/mp4,video/webm,video/ogg" style="display:none"></label>' : '';
      page.innerHTML = `<div class="page-view__title">视频库</div><p>${data.total} 个视频，支持直接播放或插入笔记。</p>${upload}<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">${data.items.map(item => `<article style="border:1px solid var(--c200);border-radius:10px;padding:12px;background:#fff"><video controls preload="metadata" poster="${this.escapeHTML(item.posterUrl || '')}" src="${this.escapeHTML(item.url)}" style="width:100%;aspect-ratio:16/9;background:#111;border-radius:7px"></video><strong style="display:block;margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.escapeHTML(item.originalName)}</strong><small style="color:var(--c500)">${item.duration} 秒 · ${(item.size / 1024 / 1024).toFixed(1)} MB</small>${this.role === 'editor' ? `<button class="btn btn--secondary" data-action="delete-media" data-id="${this.escapeHTML(item.id)}" style="margin-top:8px">删除</button>` : ''}</article>`).join('')}</div>`;
      document.getElementById('mediaLibraryInput')?.addEventListener('change', (event) => this.uploadLibraryVideo(event));
    } catch (error) { page.innerHTML = `<div class="page-view__title">视频库</div><p>${this.escapeHTML(error.message)}</p>`; }
  },
  async uploadLibraryVideo(event) {
    const file = event.target.files?.[0]; if (!file) return;
    const form = new FormData(); form.append('video', file);
    try {
      const res = await fetch(apiPath('/media'), { method: 'POST', credentials: 'include', headers: this.accessKey ? { 'X-Access-Key': this.accessKey } : {}, body: form });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || '上传失败');
      this.toast('视频上传成功'); this.openMediaLibrary();
    } catch (error) { this.toast(error.message); }
  },
  async deleteMedia(id) {
    if (this.role !== 'editor' || !confirm('确定删除这个视频吗？')) return;
    try { await this.api('DELETE', apiPath('/media/' + encodeURIComponent(id))); this.toast('视频已删除'); this.openMediaLibrary(); } catch (error) { this.toast(error.message); }
  },
};
