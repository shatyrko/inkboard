import { describe, expect, it } from 'vitest';
import { deleteBody, deleteTitle, planDelete } from './deletion';
import { library } from './fixtures';

describe('planDelete', () => {
  const all = library();
  const byName = (n: string) => all.find((e) => e.name === n)!;

  it('plans a single document', () => {
    const plan = planDelete(all, new Set([byName('Draft 2.pdf').id]));
    expect(plan).toMatchObject({ documents: 1, folders: 0, notes: 0, bytes: 1_000_000 });
    expect(plan.steps).toEqual([{ id: byName('Draft 2.pdf').id, kind: 'document', name: 'Draft 2.pdf' }]);
  });
  it('takes a folder with everything below it, documents first and the deepest folder before its parent', () => {
    const plan = planDelete(all, new Set([byName('Books').id]));
    expect(plan.documents).toBe(3);
    expect(plan.folders).toBe(2);
    const kinds = plan.steps.map((s) => s.kind);
    expect(kinds).toEqual(['document', 'document', 'document', 'folder', 'folder']);
    expect(plan.steps.slice(3).map((s) => s.name)).toEqual(['Poetry', 'Books']);
  });
  it('does not delete a document twice when it and its folder are both selected', () => {
    const plan = planDelete(all, new Set([byName('Papers').id, byName('Draft 2.pdf').id]));
    expect(plan.steps.filter((s) => s.name === 'Draft 2.pdf')).toHaveLength(1);
  });
  it('counts handwritten notes', () => {
    expect(planDelete(all, new Set([byName('Papers').id])).notes).toBe(1);
  });
});

describe('wording', () => {
  const all = library();
  const pick = (...names: string[]) => all.filter((e) => names.includes(e.name));

  it('puts the count and size in the title', () => {
    const picked = pick('Draft 2.pdf', 'Draft 10.pdf');
    const plan = planDelete(all, new Set(picked.map((e) => e.id)));
    expect(deleteTitle(plan, picked)).toBe('Delete 2 documents (2.0 MB)?');
  });
  it('names a single document or folder', () => {
    const one = pick('Cafe menu.pdf');
    expect(deleteTitle(planDelete(all, new Set(one.map((e) => e.id))), one)).toBe('Delete "Cafe menu.pdf" (500 KB)?');
    const folder = pick('Papers');
    expect(deleteTitle(planDelete(all, new Set(folder.map((e) => e.id))), folder)).toBe('Delete the folder "Papers" and 3 documents (2.2 MB)?');
  });
  it('says it cannot be undone and warns about notes', () => {
    const plan = planDelete(all, new Set(pick('Papers').map((e) => e.id)));
    expect(deleteBody(plan)).toContain('cannot be undone');
    expect(deleteBody(plan)).toContain('1 handwritten note');
  });
});
