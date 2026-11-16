import { describe, expect, it } from 'vitest';
import { buildTree, flattenVisible, itemCount, reveal } from './tree';
import { doc, folder, library } from './fixtures';

describe('buildTree', () => {
  it('nests folders and counts documents', () => {
    const { root, nodes } = buildTree(library());
    expect(root.children.map((c) => c.name)).toEqual(['Books', 'Papers']);
    expect(nodes.get('Document/Books')!.docs).toBe(2);
    expect(nodes.get('Document/Books')!.total).toBe(3);
    expect(root.docs).toBe(1);
    expect(root.total).toBe(7);
    expect(itemCount(nodes.get('Document/Books')!)).toBe(3);
  });
  it('takes ids from folder entries and, for the unlisted root, from its children', () => {
    const { root, nodes } = buildTree(library());
    expect(root.id).toBe('root');
    expect(nodes.get('Document/Books')!.id).toMatch(/^f/);
  });
  it('uses the root entry when the reader lists it', () => {
    const { root } = buildTree([folder('Document', 'top', { id: 'doc-root' }), doc('Document/a.pdf', 'doc-root')]);
    expect(root.id).toBe('doc-root');
  });
  it('implies folders that only appear in a document path', () => {
    const { nodes } = buildTree([doc('Document/Ghost/a.pdf', 'g1')]);
    expect(nodes.get('Document/Ghost')).toMatchObject({ docs: 1, id: 'g1' });
  });
  it('sorts siblings naturally and ignores entries outside the root', () => {
    const { root } = buildTree([folder('Document/10', 'r'), folder('Document/2', 'r'), folder('Elsewhere/x', 'r')]);
    expect(root.children.map((c) => c.name)).toEqual(['2', '10']);
  });
  it('is fine with an empty library', () => {
    const { root } = buildTree([]);
    expect(root).toMatchObject({ path: 'Document', docs: 0, total: 0, id: null });
  });
});

describe('flattenVisible', () => {
  const { root } = buildTree(library());
  it('shows only the root while collapsed', () => {
    expect(flattenVisible(root, new Set()).map((r) => r.node.name)).toEqual(['Document']);
  });
  it('shows children of expanded folders, with depth', () => {
    const rows = flattenVisible(root, new Set(['Document', 'Document/Books']));
    expect(rows.map((r) => `${r.depth}:${r.node.name}`)).toEqual(['0:Document', '1:Books', '2:Poetry', '1:Papers']);
  });
  it('reveals every ancestor of a path', () => {
    expect([...reveal(new Set(), 'Document/Books/Poetry')].sort()).toEqual(['Document', 'Document/Books']);
  });
});
