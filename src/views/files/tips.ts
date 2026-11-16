// The quiet tip above a folder's list, for the few folders where a reader has something particular to say.
import type { MtpEntry } from '../../lib/types';
import type { Crumb } from './nav';

export type Tip = { kind: 'books'; folder: MtpEntry } | { kind: 'templates' };

/** the folder Boox Notes reads custom pen templates from, at the storage root */
export const TEMPLATE_FOLDER = 'noteTemplate';

/** at the storage root: a pointer to the Books folder when there is one. Inside noteTemplate: how templates should look. */
export function tipFor(stack: readonly Crumb[], entries: readonly MtpEntry[]): Tip | null {
  if (stack.length === 1) {
    const folder = entries.find((e) => e.kind === 'folder' && e.name.toLowerCase() === 'books');
    return folder ? { kind: 'books', folder } : null;
  }
  return stack.length === 2 && stack[1].name === TEMPLATE_FOLDER ? { kind: 'templates' } : null;
}
