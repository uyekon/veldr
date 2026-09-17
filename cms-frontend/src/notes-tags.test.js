import { expect, it } from 'vitest';
import { notesViewMethods } from './app/notes-view.js';

const notes = [
  { id: 1, notebookId: 'health', tags: ['强身健体', ' 强身健体 ', '体态'] },
  { id: 2, notebookId: 'health', tags: ['强身健体', 'archived'] },
  { id: 3, notebookId: 'work', tags: ['强身健体'] },
  { id: 4, notebookId: 'work', tags: ['工作', 'ARCHIVED'] },
];

const appFor = (currentNav, currentFilter = 'all') => ({
  ...notesViewMethods,
  _notes: notes,
  _menus: [
    { id: 'docs', type: 'docs' },
    { id: 'health', type: 'notebook' },
    { id: 'work', type: 'notebook' },
  ],
  _categories: [], currentNav, currentFilter, searchQuery: '', isCategoryFilter: () => false,
});

it('shows tag counts for the selected notebook and excludes archived notes from ordinary tags', () => {
  expect(Object.fromEntries(appFor('health').getScopedTagCounts().map(({ tag, count }) => [tag, count])))
    .toEqual({ archived: 1, 强身健体: 1, 体态: 1 });
  expect(Object.fromEntries(appFor('work').getScopedTagCounts().map(({ tag, count }) => [tag, count])))
    .toEqual({ archived: 1, 强身健体: 1 });
});

it('uses global counts in Docs while keeping archived notes behind archived', () => {
  expect(Object.fromEntries(appFor('docs').getScopedTagCounts().map(({ tag, count }) => [tag, count])))
    .toEqual({ archived: 2, 强身健体: 2, 体态: 1 });
});

it('only displays archived notes for the archived filter', () => {
  expect(appFor('health', 'tag:强身健体').getFilteredNotes().map(note => note.id)).toEqual([1]);
  expect(appFor('health', 'tag:archived').getFilteredNotes().map(note => note.id)).toEqual([2]);
});
