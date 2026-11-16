// What the file table shows: one folder's entries, or search results over the whole library, sorted.
import type { Entry } from '../../lib/types';
import { matchesAll, words } from '../shared/text';
import { parentPath, relativeToRoot } from './paths';

export type SortKey = 'name' | 'pages' | 'size' | 'modified' | 'lastRead';
export type SortDir = 'asc' | 'desc';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** documents and sub-folders directly in a folder */
export function entriesIn(entries: readonly Entry[], folderPath: string): Entry[] {
  return entries.filter((e) => parentPath(e.path) === folderPath);
}

/** names taken in a folder, for duplicate checks */
export function namesIn(entries: readonly Entry[], folderPath: string): string[] {
  return entriesIn(entries, folderPath).map((e) => e.name);
}

/** every word must match somewhere in the path below the root, ignoring case and accents */
export function searchEntries(entries: readonly Entry[], query: string): Entry[] {
  const needles = words(query);
  if (!needles.length) return [];
  return entries.filter((e) => matchesAll(relativeToRoot(e.path), needles));
}

function numeric(e: Entry, key: SortKey): number | null {
  switch (key) {
    case 'pages': return e.totalPage;
    case 'size': return e.size;
    case 'modified': return Date.parse(e.modified) || 0;
    case 'lastRead': return e.lastRead ? Date.parse(e.lastRead) || null : null;
    default: return null;
  }
}

/** Folders always come first. A missing value (never read) sorts last in both directions. */
export function sortEntries(list: readonly Entry[], key: SortKey, dir: SortDir): Entry[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    const byName = collator.compare(a.name, b.name);
    if (key === 'name') return sign * byName;
    if (a.kind === 'folder') return byName;
    const va = numeric(a, key);
    const vb = numeric(b, key);
    if (va === null && vb === null) return byName;
    if (va === null) return 1;
    if (vb === null) return -1;
    return va === vb ? byName : sign * (va - vb);
  });
}

/** the documents among the entries sharing a folder with a name; used to spot uploads that would replace something */
export function findByName(entries: readonly Entry[], folderPath: string, names: readonly string[]): Entry[] {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  return entriesIn(entries, folderPath).filter((e) => e.kind === 'document' && wanted.has(e.name.toLowerCase()));
}
