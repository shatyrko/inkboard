import { describe, expect, it } from 'vitest';
import { filterEntries, iconFor, sameNames, sortEntries } from './listing';
import { file, folder, sample } from './fixtures';

const names = (l: { name: string }[]) => l.map((e) => e.name);

describe('filterEntries', () => {
  it('matches every word, ignoring case and accents', () => {
    expect(names(filterEntries(sample(), 'cafe vienna'))).toEqual(['Café Culture in Vienna.mobi']);
    expect(names(filterEntries(sample(), 'елка'))).toEqual(['Ёлка и ёж.fb2']);
  });
  it('returns everything for a blank query', () => {
    expect(filterEntries(sample(), '  ')).toHaveLength(6);
  });
});

describe('sortEntries', () => {
  it('keeps folders first and sorts names naturally', () => {
    expect(names(sortEntries(sample(), 'name', 'asc'))).toEqual(['Fiction', 'Poetry', 'Café Culture in Vienna.mobi', 'Draft 2.pdf', 'Draft 10.pdf', 'Ёлка и ёж.fb2']);
    expect(names(sortEntries(sample(), 'name', 'desc')).slice(0, 2)).toEqual(['Poetry', 'Fiction']);
  });
  it('sorts by size', () => {
    expect(names(sortEntries(sample(), 'size', 'desc')).slice(2)).toEqual(['Draft 10.pdf', 'Café Culture in Vienna.mobi', 'Draft 2.pdf', 'Ёлка и ёж.fb2']);
  });
  it('sorts by date and puts undated files last either way', () => {
    const asc = sortEntries(sample(), 'modified', 'asc');
    const desc = sortEntries(sample(), 'modified', 'desc');
    expect(asc.at(-1)!.name).toBe('Draft 10.pdf');
    expect(desc.at(-1)!.name).toBe('Draft 10.pdf');
    expect(desc.find((e) => e.kind === 'file')!.name).toBe('Ёлка и ёж.fb2');
  });
  it('does not change its input', () => {
    const list = sample();
    const before = names(list);
    sortEntries(list, 'size', 'asc');
    expect(names(list)).toEqual(before);
  });
});

describe('iconFor', () => {
  it('picks an icon per kind of file', () => {
    expect(iconFor(folder('Books'))).toBe('folder');
    expect(iconFor(file('a.PDF'))).toBe('file-text');
    expect(iconFor(file('a.epub'))).toBe('book');
    expect(iconFor(file('a.cbz'))).toBe('book');
    expect(iconFor(file('photo.JPG'))).toBe('image');
    expect(iconFor(file('archive.zip'))).toBe('file');
    expect(iconFor(file('README'))).toBe('file');
  });
});

describe('sameNames', () => {
  it('finds entries with the same name, ignoring case', () => {
    expect(names(sameNames(sample(), ['DRAFT 2.pdf', 'new.pdf']))).toEqual(['Draft 2.pdf']);
  });
});
