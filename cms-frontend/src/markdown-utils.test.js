import { describe, expect, it } from 'vitest';
import {
  normalizeEscapedImageMarkdown,
  normalizeImageWidths,
  normalizeMarkdownForEditor,
  normalizeMarkdownStructure,
} from './markdown-utils.js';
import { createDraftRecord, isDraftNewerThanNote } from './app/drafts.js';

describe('NoteFlow Markdown compatibility', () => {
  it('separates consecutive list groups without touching fenced code', () => {
    const source = '02\n- first\n03\n- second\n\n```\n- code item\n```';
    expect(normalizeMarkdownStructure(source)).toBe('02\n- first\n\n03\n- second\n\n```\n- code item\n```');
  });

  it('repairs escaped legacy image markdown and preserves underscore URLs', () => {
    const source = '!\\[cover\\](/uploads/cms/my_image.png)';
    expect(normalizeEscapedImageMarkdown(source)).toBe('![cover](/uploads/cms/my_image.png)');
  });

  it('normalizes image width syntax and lifts indented image blocks', () => {
    const source = '  ![cover](/uploads/cms/cover.png){width=50%}';
    expect(normalizeMarkdownForEditor(source)).toContain('![cover](/uploads/cms/cover.png "veldr-width=50%")');
    expect(normalizeImageWidths(source)).toContain('"veldr-width=50%"');
    expect(normalizeImageWidths('![cover](/uploads/cms/cover.png){width=wide}')).toBe('![cover](/uploads/cms/cover.png)');
  });

  it('serializes drafts and restores only drafts newer than the server note', () => {
    const draft = createDraftRecord({ noteId: 7, title: 'Draft', tags: ['one'], content: 'Text', updatedAt: 2000 });
    expect(draft).toMatchObject({ key: 'note:7', title: 'Draft', tags: ['one'], content: 'Text' });
    expect(isDraftNewerThanNote(draft, { updatedAt: new Date(1000).toISOString() })).toBe(true);
    expect(isDraftNewerThanNote(draft, { updatedAt: new Date(3000).toISOString() })).toBe(false);
  });
});
