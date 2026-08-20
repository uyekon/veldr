import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  normalizeEscapedImageMarkdown,
  normalizeImageWidths,
  normalizeMarkdownStructure,
} from './markdown-utils.js';

const renderer = new marked.Renderer();
const IMAGE_WIDTHS = new Set(['25', '33', '50', '66', '75', '100']);

const normalizeUploadUrl = (href) => (
  typeof window.CMSNormalizeMarkdownUrl === 'function'
    ? window.CMSNormalizeMarkdownUrl(href)
    : href
);

const escapeAttribute = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const parseImageTitle = (title) => {
  const value = String(title || '');
  const match = value.match(/^veldr-width=(\d+)(%|px)$/);
  return {
    width: match?.[1] || null,
    unit: match?.[2] || null,
    title: match ? '' : value,
  };
};

const imageMarkup = (href, text, title = '') => {
  const src = normalizeUploadUrl(href || '');
  const parsed = parseImageTitle(title);
  const sizeClass = parsed.width && parsed.unit === '%' && IMAGE_WIDTHS.has(parsed.width) ? ` md-img--w-${parsed.width}` : '';
  const sizeStyle = parsed.width && parsed.unit === 'px' ? ` style="width:min(100%,${escapeAttribute(parsed.width)}px)"` : '';
  const safeTitle = parsed.title ? ` title="${escapeAttribute(parsed.title)}"` : '';
  return `<img class="md-img${sizeClass}" src="${escapeAttribute(src)}" alt="${escapeAttribute(text)}"${safeTitle}${sizeStyle} loading="lazy">`;
};

renderer.image = ({ href, title, text }) => imageMarkup(href, text, title);

renderer.link = function ({ href, title, tokens }) {
  const text = this.parser.parseInline(tokens || []);
  const safeTitle = title ? ` title="${escapeAttribute(title)}"` : '';
  return `<a href="${escapeAttribute(href || '')}"${safeTitle} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.use({ async: false, breaks: true, gfm: true, renderer });

const renderGridImages = (body, columns) => {
  const images = [];
  const imagePattern = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)\{width=(\d+)(%|px)?\}|!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g;
  let match;
  while ((match = imagePattern.exec(body))) {
    const alt = match[1] ?? match[6];
    const href = match[2] ?? match[7];
    // A gallery controls its own cell width. Keep any legacy per-image width
    // out of the rendered markup so every cell fills its column consistently.
    images.push(imageMarkup(href, alt));
  }
  if (!images.length) return '';
  return `<div class="md-image-grid md-image-grid--${columns}">${images.join('')}</div>`;
};

const extractImageGrids = (source) => {
  const grids = [];
  const markdown = String(source || '').replace(
    /^:::images\{columns=(2|3|4)\}\s*$([\s\S]*?)^:::\s*$/gm,
    (_, columns, body) => {
      const token = `VELDR_IMAGE_GRID_${grids.length}_TOKEN`;
      grids.push(renderGridImages(body, columns));
      return `\n\n${token}\n\n`;
    },
  );
  return { markdown, grids };
};

const render = (source) => {
  const normalizedSource = normalizeMarkdownStructure(normalizeImageWidths(normalizeEscapedImageMarkdown(source)));
  const { markdown, grids } = extractImageGrids(normalizedSource);
  let html = marked.parse(markdown);
  grids.forEach((grid, index) => {
    const token = `VELDR_IMAGE_GRID_${index}_TOKEN`;
    html = html.replace(new RegExp(`<p>\\s*${token}\\s*</p>`, 'g'), grid);
  });
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['video', 'source'],
    ADD_ATTR: ['target', 'rel', 'loading', 'controls', 'preload', 'poster', 'src', 'type'],
  });
};

window.CMSMarkdown = {
  render,
  sanitize(html) {
    return DOMPurify.sanitize(String(html || ''), {
      ADD_TAGS: ['video', 'source'],
      ADD_ATTR: ['target', 'rel', 'loading', 'controls', 'preload', 'poster', 'src', 'type'],
    });
  },
};
