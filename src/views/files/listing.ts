// What the file manager shows for one folder of a USB reader: filtered by the search box, sorted, with an icon per file.
import type { MtpEntry } from '../../lib/types';
import { matchesAll, words } from '../shared/text';

export type MtpSortKey = 'name' | 'size' | 'modified';
export type SortDir = 'asc' | 'desc';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** every word of the query must be in the name, ignoring case and accents */
export function filterEntries(list: readonly MtpEntry[], query: string): MtpEntry[] {
  const needles = words(query);
  return needles.length ? list.filter((e) => matchesAll(e.name, needles)) : [...list];
}

/** Folders first, always. A file with no date sorts last in both directions. */
export function sortEntries(list: readonly MtpEntry[], key: MtpSortKey, dir: SortDir): MtpEntry[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    const byName = collator.compare(a.name, b.name);
    if (key === 'name') return sign * byName;
    if (a.kind === 'folder' && key === 'size') return byName;
    const va = key === 'size' ? a.size : a.modified ? Date.parse(a.modified) || null : null;
    const vb = key === 'size' ? b.size : b.modified ? Date.parse(b.modified) || null : null;
    if (va === null && vb === null) return byName;
    if (va === null) return 1;
    if (vb === null) return -1;
    return va === vb ? byName : sign * (va - vb);
  });
}

const BOOKS = new Set(['epub', 'fb2', 'mobi', 'azw', 'azw3', 'cbz', 'cbr', 'djvu', 'txt', 'rtf']);
const IMAGES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic']);

/** the Icon name for an entry */
export function iconFor(e: Pick<MtpEntry, 'name' | 'kind'>): string {
  if (e.kind === 'folder') return 'folder';
  const ext = e.name.slice(e.name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'pdf') return 'file-text';
  if (BOOKS.has(ext)) return 'book';
  if (IMAGES.has(ext)) return 'image';
  return 'file';
}

/** entries of a folder that share a name (ignoring case) with something about to be put there */
export function sameNames(existing: readonly MtpEntry[], names: readonly string[]): MtpEntry[] {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  return existing.filter((e) => wanted.has(e.name.toLowerCase()));
}
