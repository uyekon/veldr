// NoteFlow block directives are deliberately distinct from Markdown list
// indentation: four leading spaces would turn an ordinary paragraph into code.
const OPEN_TOGGLE = /^:::toggle\s*$/;
const OPEN_INDENT = /^:::indent ([1-4])\s*$/;
const OPEN_GALLERY = /^:::images\{columns=[234]\}\s*$/;
const CLOSE = { toggle: ':::endtoggle', indent: ':::endindent', gallery: ':::' };

const opening = (line) => {
  if (OPEN_TOGGLE.test(line)) return { type: 'toggle' };
  const indent = line.match(OPEN_INDENT);
  if (indent) return { type: 'indent', level: Number(indent[1]) };
  if (OPEN_GALLERY.test(line)) return { type: 'gallery' };
  return null;
};

const fence = (line) => line.match(/^\s*(`{3,}|~{3,})/);

export function extractStructuredBlocks(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  const output = [];
  const prefix = `VELDR_STRUCT_${Math.random().toString(36).slice(2).toUpperCase()}_`;
  let activeFence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = fence(line);
    if (marker) {
      if (!activeFence) activeFence = marker[1];
      else if (marker[1][0] === activeFence[0] && marker[1].length >= activeFence.length) activeFence = null;
    }
    const start = activeFence ? null : opening(line);
    if (!start || start.type === 'gallery') { output.push(line); continue; }

    const stack = [start.type];
    let innerFence = null;
    let closeIndex = -1;
    for (let next = index + 1; next < lines.length; next += 1) {
      const innerLine = lines[next];
      const innerMarker = fence(innerLine);
      if (innerMarker) {
        if (!innerFence) innerFence = innerMarker[1];
        else if (innerMarker[1][0] === innerFence[0] && innerMarker[1].length >= innerFence.length) innerFence = null;
        continue;
      }
      if (innerFence) continue;
      const nested = opening(innerLine);
      if (nested) { stack.push(nested.type); continue; }
      if (innerLine.trim() === CLOSE[stack.at(-1)]) {
        stack.pop();
        if (!stack.length) { closeIndex = next; break; }
      }
    }
    if (closeIndex < 0) { output.push(line); continue; }

    const body = lines.slice(index + 1, closeIndex).join('\n');
    let block;
    if (start.type === 'toggle') {
      const parts = body.split('\n');
      const divider = parts.findIndex((part) => part.trim() === ':::content');
      if (divider !== 1) { output.push(line); continue; }
      block = { type: 'toggle', summary: parts[0], body: parts.slice(2).join('\n') };
    } else {
      block = { type: 'indent', level: start.level, body };
    }
    const token = `${prefix}${blocks.length}_TOKEN`;
    blocks.push({ ...block, token });
    output.push('', token, '');
    index = closeIndex;
  }
  return { markdown: output.join('\n'), blocks };
}

export const indentLevel = (value) => Math.min(4, Math.max(0, Number(value) || 0));
