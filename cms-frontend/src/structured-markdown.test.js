import { describe, expect, it } from 'vitest';
import { extractStructuredBlocks } from './structured-markdown.js';

describe('structured Markdown directives', () => {
  it('extracts nested toggles while leaving fenced code untouched', () => {
    const source = '```md\n:::indent 4\ncode\n:::endindent\n```\n\n:::toggle\n外层\n:::content\n:::toggle\n内层\n:::content\n文字\n:::endtoggle\n:::endtoggle';
    const result = extractStructuredBlocks(source);
    expect(result.markdown).toContain(':::indent 4\ncode\n:::endindent');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({ type: 'toggle', summary: '外层' });
    expect(extractStructuredBlocks(result.blocks[0].body).blocks[0]).toMatchObject({ type: 'toggle', summary: '内层' });
  });

  it('preserves incomplete directives as readable source', () => {
    const source = ':::toggle\n标题\n:::content\n正文';
    expect(extractStructuredBlocks(source)).toMatchObject({ markdown: source, blocks: [] });
  });
});
