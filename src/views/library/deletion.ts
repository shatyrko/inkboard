// Deleting from the library is permanent, so the user is told exactly what goes before anything is sent.
import type { Entry } from '../../lib/types';
import { fmtBytes } from '../../lib/format';
import { plural } from '../shared/text';

export type DeleteStep = { id: string; kind: 'document' | 'folder'; name: string };
export type DeletePlan = {
  /** documents first, then folders deepest first: the reader refuses to delete a folder that still has content */
  steps: DeleteStep[];
  documents: number;
  folders: number;
  notes: number;
  bytes: number;
};

export function planDelete(entries: readonly Entry[], ids: ReadonlySet<string>): DeletePlan {
  const pickedFolders = entries.filter((e) => ids.has(e.id) && e.kind === 'folder').map((e) => `${e.path}/`);
  const doomed = entries.filter((e) => ids.has(e.id) || pickedFolders.some((f) => e.path.startsWith(f)));
  const docs = doomed.filter((e) => e.kind === 'document');
  const folders = doomed.filter((e) => e.kind === 'folder').sort((a, b) => b.path.split('/').length - a.path.split('/').length);
  return {
    steps: [...docs, ...folders].map((e) => ({ id: e.id, kind: e.kind, name: e.name })),
    documents: docs.length,
    folders: folders.length,
    notes: docs.filter((d) => d.docType === 'note').length,
    bytes: docs.reduce((sum, d) => sum + d.size, 0),
  };
}

/** "Delete 3 documents (24.5 MB)?" / "Delete the folder "Books" and 12 documents (210 MB)?" */
export function deleteTitle(plan: DeletePlan, picked: readonly Entry[]): string {
  const size = plan.bytes ? ` (${fmtBytes(plan.bytes)})` : '';
  const only = picked.length === 1 ? picked[0] : null;
  if (only?.kind === 'folder') {
    const inside = plan.documents ? ` and ${plural(plan.documents, 'document')}` : '';
    return `Delete the folder "${only.name}"${inside}${size}?`;
  }
  if (only) return `Delete "${only.name}"${size}?`;
  const what = plan.folders ? plural(picked.length, 'item') : plural(plan.documents, 'document');
  return `Delete ${what}${size}?`;
}

export function deleteBody(plan: DeletePlan): string {
  const lines = ['They are removed from the reader for good. This cannot be undone.'];
  if (plan.notes) lines.push(`${plural(plan.notes, 'handwritten note')} included: the reader keeps no other copy of ${plan.notes === 1 ? 'it' : 'them'}.`);
  return lines.join(' ');
}
