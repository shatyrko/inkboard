import { describe, expect, it } from 'vitest';
import { deleteBody, deleteTitle, summarise } from './deletion';
import { file, folder } from './fixtures';

describe('delete wording', () => {
  it('counts files and folders and adds up file sizes', () => {
    expect(summarise([file('a.pdf', 2_000_000), file('b.pdf', 1_500_000), folder('X')])).toEqual({ files: 2, folders: 1, bytes: 3_500_000 });
  });
  it('names a single item', () => {
    expect(deleteTitle([file('a.epub', 1_200_000)])).toBe('Delete "a.epub" (1.2 MB)?');
    expect(deleteTitle([folder('Old')])).toBe('Delete "Old"?');
  });
  it('puts the count and size in the title for several', () => {
    expect(deleteTitle([file('a.pdf', 2_000_000), file('b.pdf', 3_000_000)])).toBe('Delete 2 files (5.0 MB)?');
    expect(deleteTitle([file('a.pdf', 2_000_000), folder('X'), folder('Y')])).toBe('Delete 1 file and 2 folders (2.0 MB)?');
  });
  it('says it cannot be undone and that a folder takes its content along', () => {
    expect(deleteBody([file('a.pdf')])).toContain('cannot be undone');
    expect(deleteBody([file('a.pdf')])).not.toContain('inside');
    expect(deleteBody([folder('X')])).toContain('with everything inside it');
    expect(deleteBody([folder('X'), folder('Y')])).toContain('with everything inside them');
  });
});
