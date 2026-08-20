import { Editor, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import FileHandler from '@tiptap/extension-file-handler';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { MAX_GALLERY_COLUMNS, MIN_GALLERY_COLUMNS, normalizeMarkdownForEditor } from '../markdown-utils.js';

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
  const content = editor.markdown.parse(source);
  const replaceTokens = (node) => {
    if (!node?.content) return node;
    const children = node.content.map(replaceTokens);
    if (node.type === 'paragraph' && children.length === 1 && children[0]?.type === 'text') {
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
  return replaceTokens(content);
};

export const createRichEditor = (app, host) => {
  const receiveFiles = (files, position) => {
    const layout = app.getSelectedImageLayout();
    app.uploadImageFiles(files, { mode: files.length > 1 ? 'gallery' : layout.mode, columns: layout.columns, position });
  };
  return new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
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
