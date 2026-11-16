import { describe, expect, it } from 'vitest';
import { enterFolder, startStack } from './nav';
import { file, folder } from './fixtures';
import { tipFor } from './tips';

const root = startStack('Internal storage');

describe('tipFor', () => {
  it('points to the Books folder at the root, whatever its case', () => {
    const books = folder('books');
    expect(tipFor(root, [file('a.pdf'), books])).toEqual({ kind: 'books', folder: books });
  });
  it('has nothing to say at a root without Books', () => {
    expect(tipFor(root, [folder('Download')])).toBeNull();
  });
  it('explains pen templates inside the root-level noteTemplate folder', () => {
    const inside = enterFolder(root, { handle: 7, name: 'noteTemplate' });
    expect(tipFor(inside, [])).toEqual({ kind: 'templates' });
  });
  it('only for the root-level noteTemplate, not a folder of the same name deeper down', () => {
    const books = enterFolder(root, { handle: 5, name: 'Books' });
    expect(tipFor(enterFolder(books, { handle: 9, name: 'noteTemplate' }), [])).toBeNull();
    expect(tipFor(books, [folder('Fiction')])).toBeNull();
  });
});
