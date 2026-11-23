import { apiPath } from '../config.js';
import {
  IMAGE_WIDTHS,
  MAX_GALLERY_COLUMNS,
  MIN_GALLERY_COLUMNS,
} from '../markdown-utils.js';
import { videoFileError, videoUploadError } from './video-upload.js';

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


// Image and video selection, validation, upload and insertion.
export const editorMediaMethods = {
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
    const fileError = videoFileError(file);
    if (fileError) { this.toast(fileError); return; }
    const formData = new FormData();
    formData.append('video', file);
    this.showLoading(true);
    try {
      const response = await fetch(apiPath('/media'), { method: 'POST', credentials: 'include', body: formData });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(videoUploadError(response, data));
      if (!data?.url) throw new Error('视频上传响应无效');
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
