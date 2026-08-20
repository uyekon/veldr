export const IMAGE_WIDTHS = new Set(['25', '33', '50', '66', '75', '100']);
export const MIN_GALLERY_COLUMNS = 2;
export const MAX_GALLERY_COLUMNS = 4;

const LIST_ITEM_PATTERN = /^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const CODE_FENCE_PATTERN = /^\s*(```|~~~)/;

// Notes created by the early rich-text migration escaped image delimiters and
// URL underscores. Normalize them before either editor parsing or rendering.
export const normalizeEscapedImageMarkdown = (source) => String(source || '').replace(
  /!\\+\[([\s\S]*?)\\+\]\(([^)\r\n]*)\)/g,
  (_, alt, target) => {
    const cleanAlt = String(alt).replace(/\\+([\[\]\\])/g, '$1');
    const cleanTarget = String(target).replace(/\\+([_()[\]\\])/g, '$1');
    return `![${cleanAlt}](${cleanTarget})`;
  },
);

export const normalizeMarkdownStructure = (source) => {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const normalized = [];
  let inCodeFence = false;
  let previousWasListItem = false;

  lines.forEach((line) => {
    if (CODE_FENCE_PATTERN.test(line)) inCodeFence = !inCodeFence;
    const isListItem = !inCodeFence && LIST_ITEM_PATTERN.test(line);
    const isPlainTopLevelLine = !inCodeFence && line.trim() && !isListItem && !/^\s/.test(line);
    if (previousWasListItem && isPlainTopLevelLine) normalized.push('');
    normalized.push(line);
    previousWasListItem = isListItem;
  });

  return normalized.join('\n');
};

export const normalizeImageWidths = (source) => normalizeEscapedImageMarkdown(source).replace(
  /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)\{width=([^}]+)\}/g,
  (_, alt, href, rawWidth) => {
    const match = String(rawWidth).trim().match(/^(\d+)(%|px)?$/);
    const width = match?.[1];
    const unit = match?.[2] || 'px';
    return width && (unit === 'px' || IMAGE_WIDTHS.has(width))
      ? `![${alt}](${href} "veldr-width=${width}${unit}")`
      : `![${alt}](${href})`;
  },
);

export const promoteIndentedImageBlocks = (source) => String(source || '').replace(
  /^[\t ]+(!\[[^\]]*\]\([^\r\n]+\)(?:\{width=\d+(?:%|px)?\})?)\s*$/gm,
  '\n$1\n',
);

export const normalizeMarkdownForEditor = (source) => (
  promoteIndentedImageBlocks(normalizeMarkdownStructure(normalizeImageWidths(source)))
);
