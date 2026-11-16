import { describe, expect, it } from 'vitest';
import { pickColumns } from './columns';

const keys = (w: number, folder = false) => pickColumns(w, folder).map((c) => c.key);

describe('pickColumns', () => {
  it('shows everything when there is room', () => {
    expect(keys(1000)).toEqual(['name', 'pages', 'size', 'modified', 'lastRead']);
  });
  it('adds the folder column for search results', () => {
    expect(keys(1000, true)).toEqual(['name', 'folder', 'pages', 'size', 'modified', 'lastRead']);
  });
  it('drops the dates first, then pages, then size', () => {
    expect(keys(540)).toEqual(['name', 'pages', 'size', 'modified']);
    expect(keys(450)).toEqual(['name', 'pages', 'size']);
    expect(keys(330)).toEqual(['name', 'size']);
    expect(keys(250)).toEqual(['name']);
  });
  it('never drops the name or the folder', () => {
    expect(keys(100, true)).toEqual(['name', 'folder']);
  });
  it('keeps the name at least 220 px wide while it can', () => {
    for (const w of [400, 500, 600, 700, 900]) {
      const cols = pickColumns(w, true);
      const fixed = cols.reduce((n, c) => n + c.width, 0);
      expect(w - fixed >= 220 || cols.length === 2).toBe(true);
    }
  });
});
