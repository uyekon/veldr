import DOMPurify from 'dompurify';
import { marked } from 'marked';

const renderer = new marked.Renderer();

const normalizeUploadUrl = (href) => {
  if (typeof window.CMSNormalizeMarkdownUrl === 'function') {
    return window.CMSNormalizeMarkdownUrl(href);
  }
  return href;
};

const escapeAttribute = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

renderer.image = ({ href, title, text }) => {
  const src = normalizeUploadUrl(href || '');
  const safeTitle = title ? ` title="${escapeAttribute(title)}"` : '';
  return `<img class="md-img" src="${escapeAttribute(src)}" alt="${escapeAttribute(text)}"${safeTitle} loading="lazy">`;
};

renderer.link = function ({ href, title, tokens }) {
  const text = this.parser.parseInline(tokens || []);
  const safeTitle = title ? ` title="${escapeAttribute(title)}"` : '';
  return `<a href="${escapeAttribute(href || '')}"${safeTitle} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.use({
  async: false,
  breaks: true,
  gfm: true,
  renderer,
});

window.CMSMarkdown = {
  render(source) {
    const html = marked.parse(source || '');
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ['video', 'source'],
      ADD_ATTR: ['target', 'rel', 'loading', 'controls', 'preload', 'poster', 'src', 'type'],
    });
  },
  // For server-provided HTML (e.g. custom menu page content)
  sanitize(html) {
    return DOMPurify.sanitize(String(html || ''), {
      ADD_TAGS: ['video', 'source'],
      ADD_ATTR: ['target', 'rel', 'loading', 'controls', 'preload', 'poster', 'src', 'type'],
    });
  },
};
