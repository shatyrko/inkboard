// Folder tree built from the reader's flat entry list.
import type { Entry } from '../../lib/types';
import { ROOT, baseName, isInside, parentPath, trail } from './paths';

export type FolderNode = {
  path: string;
  name: string;
  /** null for a folder the list only implies (a path with no folder entry and no document to name its id) */
  id: string | null;
  parent: string | null;
  children: FolderNode[];
  /** documents directly in this folder */
  docs: number;
  /** documents in this folder and everything below it */
  total: number;
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The root folder may or may not appear in the list: it is created either way, and its id is taken from whatever sits
 * directly in it (every child names its parent's id), so "move here" works for the root too.
 */
export function buildTree(entries: readonly Entry[]): { root: FolderNode; nodes: Map<string, FolderNode> } {
  const nodes = new Map<string, FolderNode>();
  const ensure = (path: string): FolderNode => {
    let n = nodes.get(path);
    if (n) return n;
    const parent = path === ROOT ? null : parentPath(path);
    n = { path, name: baseName(path), id: null, parent, children: [], docs: 0, total: 0 };
    nodes.set(path, n);
    if (parent !== null) ensure(parent).children.push(n);
    return n;
  };
  const root = ensure(ROOT);

  for (const e of entries) {
    if (!isInside(e.path, ROOT)) continue;
    if (e.kind === 'folder') {
      ensure(e.path).id = e.id;
      if (e.path !== ROOT) {
        const p = ensure(parentPath(e.path));
        p.id ??= e.parentId;
      }
    } else {
      const p = ensure(parentPath(e.path));
      p.docs++;
      p.id ??= e.parentId;
    }
  }

  const finish = (n: FolderNode): number => {
    n.children.sort((a, b) => collator.compare(a.name, b.name));
    n.total = n.docs + n.children.reduce((sum, c) => sum + finish(c), 0);
    return n.total;
  };
  finish(root);
  return { root, nodes };
}

export type TreeRow = { node: FolderNode; depth: number };

/** the rows to draw: a folder's children only appear when it is expanded */
export function flattenVisible(root: FolderNode, expanded: ReadonlySet<string>): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (n: FolderNode, depth: number) => {
    out.push({ node: n, depth });
    if (expanded.has(n.path)) for (const c of n.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
}

/** a copy of `expanded` with every folder above `path` opened, so the folder is visible in the tree */
export function reveal(expanded: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(expanded);
  for (const t of trail(path).slice(0, -1)) next.add(t.path);
  return next;
}

/** entries shown for a folder row: documents plus sub-folders */
export function itemCount(node: FolderNode): number {
  return node.docs + node.children.length;
}
