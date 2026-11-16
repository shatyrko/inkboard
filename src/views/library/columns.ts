// Columns of the document table. The name is the one that matters, so when the pane is narrow the others are dropped,
// least important first, until the name has room to be read.
import type { SortKey } from './listing';

export type ColumnKey = SortKey | 'folder';
export type Column = {
  key: ColumnKey;
  label: string;
  /** pixels; the name takes whatever is left */
  width: number;
  right?: boolean;
  muted?: boolean;
  /** 0 = never dropped; otherwise the higher the number, the sooner it goes */
  drop: number;
};

const ALL: Column[] = [
  { key: 'name', label: 'Name', width: 0, drop: 0 },
  { key: 'folder', label: 'Folder', width: 170, muted: true, drop: 0 },
  { key: 'pages', label: 'Pages', width: 68, right: true, drop: 2 },
  { key: 'size', label: 'Size', width: 84, right: true, muted: true, drop: 1 },
  { key: 'modified', label: 'Modified', width: 132, muted: true, drop: 3 },
  { key: 'lastRead', label: 'Last read', width: 132, muted: true, drop: 4 },
];

export function pickColumns(width: number, showFolder: boolean, minName = 220): Column[] {
  let cols = ALL.filter((c) => showFolder || c.key !== 'folder');
  const taken = (list: Column[]) => list.reduce((n, c) => n + c.width, 0);
  while (width - taken(cols) < minName) {
    const victim = cols.filter((c) => c.drop > 0).sort((a, b) => b.drop - a.drop)[0];
    if (!victim) break;
    cols = cols.filter((c) => c !== victim);
  }
  return cols;
}
