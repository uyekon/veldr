import { Editor, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import FileHandler from '@tiptap/extension-file-handler';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Paragraph from '@tiptap/extension-paragraph';
import { MAX_GALLERY_COLUMNS, MIN_GALLERY_COLUMNS, normalizeMarkdownForEditor } from '../markdown-utils.js';
import { extractStructuredBlocks, indentLevel } from '../structured-markdown.js';

const IndentedParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      indent: {
        default: 0,
        parseHTML: (element) => indentLevel(element.getAttribute('data-indent')),
        renderHTML: (attributes) => indentLevel(attributes.indent)
          ? { 'data-indent': indentLevel(attributes.indent) } : {},
      },
    };
  },
  renderMarkdown(node, helpers, context) {
    const plain = Paragraph.config.renderMarkdown(node, helpers, context);
    const level = indentLevel(node.attrs?.indent);
    return level ? `:::indent ${level}\n${plain || '&nbsp;'}\n:::endindent` : plain;
  },
});

const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: '[data-veldr-toggle-summary]' }]; },
  renderHTML() { return ['div', { 'data-veldr-toggle-summary': '', class: 'md-toggle__summary' }, 0]; },
  renderMarkdown(node, helpers) { return helpers.renderChildren(node.content || [], ''); },
});

const ToggleContent = Node.create({
  name: 'toggleContent',
  content: 'block+',
  defining: true,
  parseHTML() { return [{ tag: '[data-veldr-toggle-content]' }]; },
  renderHTML() { return ['div', { 'data-veldr-toggle-content': '', class: 'md-toggle__content' }, 0]; },
  renderMarkdown(node, helpers) { return helpers.renderChildren(node.content || [], '\n\n'); },
});

const ToggleItem = Node.create({
  name: 'toggleItem',
  group: 'block',
  content: 'toggleSummary toggleContent',
  defining: true,
  isolating: true,
  parseHTML() { return [{ tag: '[data-veldr-toggle-item]' }]; },
  renderHTML() { return ['div', { 'data-veldr-toggle-item': '', class: 'md-toggle' }, 0]; },
  renderMarkdown(node, helpers) {
    const summary = helpers.renderChildren(node.content?.[0]?.content || [], '');
    const body = helpers.renderChildren(node.content?.[1]?.content || [], '\n\n');
    return `:::toggle\n${summary}\n:::content\n${body}\n:::endtoggle\n\n`;
  },
  addNodeView() {
    return () => {
      const dom = document.createElement('div');
      dom.className = 'md-toggle md-toggle--editor';
      dom.setAttribute('data-veldr-toggle-item', '');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'md-toggle__button';
      button.contentEditable = 'false';
      button.setAttribute('aria-label', '折叠内容');
      button.setAttribute('aria-expanded', 'true');
      button.textContent = '▾';
      const contentDOM = document.createElement('div');
      contentDOM.className = 'md-toggle__editor-content';
      dom.append(button, contentDOM);
      button.addEventListener('click', () => {
        const open = !dom.classList.toggle('md-toggle--closed');
        button.setAttribute('aria-expanded', String(open));
        button.setAttribute('aria-label', open ? '折叠内容' : '展开内容');
        button.textContent = open ? '▾' : '▸';
      });
      return { dom, contentDOM, update: (node) => node.type.name === 'toggleItem' };
    };
  },
});

const imageAltText = (name) => String(name || 'image').replace(/[\[\]\n\r]/g, ' ').trim() || 'image';

const imageMarkdown = (attrs) => {
  const alt = imageAltText(attrs.alt);
  const src = String(attrs.src || attrs.url || '');
  const widthPercent = String(attrs.widthPercent || '').replace(/%$/, '');
  const width = String(attrs.width || '').replace(/%$/, '');
  const title = attrs.title ? ` \"${String(attrs.title).replace(/\"/g, '\\\"')}\"` : '';
  const base = `![${alt}](${src}${title})`;
  if (/^\d+$/.test(width)) return `${base}{width=${width}px}`;
  if (/^(25|33|50|66|75|100)$/.test(widthPercent)) return `${base}{width=${widthPercent}%}`;
  return base;
};

const VeldrImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      widthPercent: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-width-percent'),
        renderHTML: (attributes) => attributes.widthPercent ? { 'data-width-percent': attributes.widthPercent } : {},
      },
    };
  },
  parseMarkdown(token, helpers) {
    const widthMatch = String(token.title || '').match(/^veldr-width=(\d+)(%|px)$/);
    return helpers.createNode('image', {
      src: token.href,
      alt: token.text || null,
      title: widthMatch ? null : (token.title || null),
      width: widthMatch?.[2] === 'px' ? Number(widthMatch[1]) : null,
      widthPercent: widthMatch?.[2] === '%' ? Number(widthMatch[1]) : null,
    });
  },
  renderMarkdown(node) { return imageMarkdown(node.attrs || {}); },
}).configure({
  resize: {
    enabled: true,
    directions: ['left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
    minWidth: 80,
    minHeight: 50,
    alwaysPreserveAspectRatio: true,
  },
});

const ImageGallery = Node.create({
  name: 'imageGallery',
  group: 'block',
  content: 'image+',
  isolating: true,
  draggable: true,
  addAttributes() { return { columns: { default: 2 } }; },
  parseHTML() { return [{ tag: 'div[data-veldr-image-gallery]' }]; },
  renderHTML({ HTMLAttributes }) {
    const columns = Math.min(MAX_GALLERY_COLUMNS, Math.max(MIN_GALLERY_COLUMNS, Number(HTMLAttributes.columns) || MIN_GALLERY_COLUMNS));
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-veldr-image-gallery': '', class: 'tiptap-image-gallery', style: `--gallery-columns:${columns}`,
    }), 0];
  },
  renderMarkdown(node, helpers) {
    const columns = Math.min(MAX_GALLERY_COLUMNS, Math.max(MIN_GALLERY_COLUMNS, Number(node.attrs?.columns) || MIN_GALLERY_COLUMNS));
    return `:::images{columns=${columns}}\n${helpers.renderChildren(node.content || [], '\n')}\n:::\n\n`;
  },
});

const VeldrVideo = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null }, poster: { default: null } };
  },
  parseHTML() { return [{ tag: 'video[src]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes({ controls: 'controls', preload: 'metadata' }, HTMLAttributes)];
  },
  renderMarkdown(node) {
    const src = String(node.attrs?.src || '').replace(/"/g, '&quot;');
    const poster = node.attrs?.poster ? ` poster="${String(node.attrs.poster).replace(/"/g, '&quot;')}"` : '';
    return `<video controls preload="metadata"${poster} src="${src}"></video>`;
  },
});

const galleryImages = (markdown) => {
  const images = [];
  const matcher = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)(?:\{width=(\d+)(?:%|px)?\})?/g;
  let match;
  while ((match = matcher.exec(markdown))) {
    const encodedWidth = String(match[3] || '').match(/^veldr-width=(\d+)(%|px)$/);
    images.push({ type: 'image', attrs: {
      alt: match[1] || null,
      src: match[2],
      title: encodedWidth ? null : (match[3] || null),
      width: match[4] ? Number(match[4]) : (encodedWidth?.[2] === 'px' ? Number(encodedWidth[1]) : null),
      widthPercent: encodedWidth?.[2] === '%' ? Number(encodedWidth[1]) : null,
    } });
  }
  return images;
};

export const parseLegacyMarkdown = (editor, markdown) => {
  const galleries = [];
  const videos = [];
  let source = normalizeMarkdownForEditor(markdown).replace(
    /^:::images\{columns=(2|3|4)\}\s*$([\s\S]*?)^:::\s*$/gm,
    (_, columns, body) => {
      const token = `VELDR_GALLERY_${galleries.length}_TOKEN`;
      galleries.push({ columns: Number(columns), images: galleryImages(body) });
      return `\n\n${token}\n\n`;
    },
  );
  source = source.replace(/<video\b([^>]*)><\/video>/gi, (_match, attributes) => {
    const src = String(attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1] || '');
    if (!src) return '';
    const poster = String(attributes.match(/\bposter=["']([^"']+)["']/i)?.[1] || '');
    const token = `VELDR_VIDEO_${videos.length}_TOKEN`;
    videos.push({ src, poster });
    return `\n\n${token}\n\n`;
  });
  const parseContent = (value) => {
    const { markdown: extracted, blocks } = extractStructuredBlocks(value);
    const content = editor.markdown.parse(extracted);
    return replaceTokens(content, blocks);
  };
  const replaceTokens = (node, blocks) => {
    if (!node?.content) return node;
    const children = node.content.flatMap((child) => {
      const replaced = replaceTokens(child, blocks);
      return Array.isArray(replaced) ? replaced : [replaced];
    });
    if (node.type === 'paragraph' && children.length === 1 && children[0]?.type === 'text') {
      const structured = blocks.find((block) => block.token === children[0].text);
      if (structured?.type === 'indent') {
        const parsed = parseContent(structured.body).content || [];
        return parsed.length ? parsed.map((item) => item.type === 'paragraph'
          ? { ...item, attrs: { ...item.attrs, indent: structured.level } } : item)
          : [{ type: 'paragraph', attrs: { indent: structured.level } }];
      }
      if (structured?.type === 'toggle') {
        const summary = editor.markdown.parse(structured.summary).content?.[0]?.content || [];
        const body = parseContent(structured.body).content || [];
        return { type: 'toggleItem', content: [
          { type: 'toggleSummary', content: summary },
          { type: 'toggleContent', content: body.length ? body : [{ type: 'paragraph' }] },
        ] };
      }
      const match = String(children[0].text || '').match(/^VELDR_GALLERY_(\d+)_TOKEN$/);
      if (match) {
        const gallery = galleries[Number(match[1])];
        if (gallery?.images.length) return { type: 'imageGallery', attrs: { columns: gallery.columns }, content: gallery.images };
      }
      const videoMatch = String(children[0].text || '').match(/^VELDR_VIDEO_(\d+)_TOKEN$/);
      if (videoMatch) {
        const video = videos[Number(videoMatch[1])];
        if (video?.src) return { type: 'video', attrs: video };
      }
    }
    return { ...node, content: children };
  };
  return parseContent(source);
};

export const createRichEditor = (app, host) => {
  const receiveFiles = (files, position) => {
    const layout = app.getSelectedImageLayout();
    app.uploadImageFiles(files, { mode: files.length > 1 ? 'gallery' : layout.mode, columns: layout.columns, position });
  };
  return new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, paragraph: false }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      IndentedParagraph, ToggleItem, ToggleSummary, ToggleContent,
      VeldrImage, ImageGallery, VeldrVideo,
      Placeholder.configure({ placeholder: '在此编写笔记内容，支持 Markdown 快捷输入…' }),
      FileHandler.configure({
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif', 'image/bmp'],
        consumePasteEvent: true,
        onPaste: (_editor, files) => receiveFiles(files),
        onDrop: (_editor, files, position) => receiveFiles(files, position),
      }),
      TableKit.configure({ table: { resizable: true } }), TaskList, TaskItem.configure({ nested: true }),
    ],
    editorProps: {
      attributes: { class: 'tiptap' },
      handleKeyDown: (_view, event) => app.handleEditorKeydown(event),
      handleClickOn: (_view, _position, node, nodePosition) => {
        if (node.type.name !== 'image' || !app.richEditor) return false;
        app.richEditor.chain().focus().setNodeSelection(nodePosition).run();
        return true;
      },
      handleDOMEvents: {
        click: (view, event) => {
          if (!(event.target instanceof Element) || !event.target.closest('img')) return false;
          const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
          const candidates = [hit?.pos, hit?.pos && hit.pos - 1].filter(Number.isInteger);
          const imagePosition = candidates.find((position) => view.state.doc.nodeAt(position)?.type.name === 'image');
          if (!Number.isInteger(imagePosition) || !app.richEditor) return false;
          app.richEditor.chain().focus().setNodeSelection(imagePosition).run();
          event.preventDefault();
          return true;
        },
      },
    },
    onUpdate: () => { app.clearPercentWidthAfterResize(); app.updateMarkdownPreview(); },
  });
};
