import { describe, expect, it } from 'vitest';
import { entriesIn, findByName, namesIn, searchEntries, sortEntries } from './listing';
import { doc, library } from './fixtures';

const names = (l: { name: string }[]) => l.map((e) => e.name);

describe('entriesIn', () => {
  it('lists documents and sub-folders of one folder only', () => {
    expect(names(entriesIn(library(), 'Document/Books'))).toEqual(['Poetry', 'Ёлка и ёж.pdf', 'Café Culture in Vienna.pdf']);
    expect(names(entriesIn(library(), 'Document'))).toEqual(['Books', 'Papers', 'Cafe menu.pdf']);
  });
  it('lists the names in use', () => {
    expect(namesIn(library(), 'Document/Papers')).toContain('Draft 2.pdf');
  });
});

describe('searchEntries', () => {
  it('finds across the whole library, ignoring accents and case', () => {
    expect(names(searchEntries(library(), 'CAFE'))).toEqual(['Cafe menu.pdf', 'Café Culture in Vienna.pdf']);
  });
  it('needs every word and also looks at folder names', () => {
    expect(names(searchEntries(library(), 'poetry стихи'))).toEqual(['Тихие стихи.pdf']);
    expect(names(searchEntries(library(), 'vienna menu'))).toEqual([]);
  });
  it('matches ё typed as е', () => {
    expect(names(searchEntries(library(), 'елка'))).toEqual(['Ёлка и ёж.pdf']);
  });
  it('returns nothing for a blank query', () => {
    expect(searchEntries(library(), '  ')).toEqual([]);
  });
});

describe('sortEntries', () => {
  const list = entriesIn(library(), 'Document/Papers');
  it('sorts names naturally, so Draft 2 comes before Draft 10', () => {
    expect(names(sortEntries(list, 'name', 'asc'))).toEqual(['Draft 2.pdf', 'Draft 10.pdf', 'Lecture scribbles.pdf']);
    expect(names(sortEntries(list, 'name', 'desc'))).toEqual(['Lecture scribbles.pdf', 'Draft 10.pdf', 'Draft 2.pdf']);
  });
  it('sorts by pages and size', () => {
    expect(names(sortEntries(list, 'pages', 'desc'))).toEqual(['Draft 10.pdf', 'Draft 2.pdf', 'Lecture scribbles.pdf']);
    expect(names(sortEntries(list, 'size', 'asc'))[0]).toBe('Lecture scribbles.pdf');
  });
  it('keeps folders first whatever the key and direction', () => {
    const mixed = entriesIn(library(), 'Document');
    expect(sortEntries(mixed, 'size', 'desc')[0].kind).toBe('folder');
    expect(sortEntries(mixed, 'name', 'desc').slice(0, 2).every((e) => e.kind === 'folder')).toBe(true);
  });
  it('puts never-read documents last in both directions', () => {
    const books = entriesIn(library(), 'Document/Books').filter((e) => e.kind === 'document');
    const extra = [...books, doc('Document/Books/Unread.pdf', 'x')];
    expect(sortEntries(extra, 'lastRead', 'asc').at(-1)!.name).toBe('Unread.pdf');
    expect(sortEntries(extra, 'lastRead', 'desc').at(-1)!.name).toBe('Unread.pdf');
    expect(sortEntries(extra, 'lastRead', 'desc')[0].name).toBe('Café Culture in Vienna.pdf');
  });
});

describe('findByName', () => {
  it('finds same-named documents in a folder, ignoring case', () => {
    expect(names(findByName(library(), 'Document/Papers', ['DRAFT 2.pdf', 'new.pdf']))).toEqual(['Draft 2.pdf']);
  });
  it('does not look in other folders', () => {
    expect(findByName(library(), 'Document', ['Draft 2.pdf'])).toEqual([]);
  });
});
