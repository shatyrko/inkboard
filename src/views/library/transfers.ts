// State and wording for the transfer panel. The Rust side emits one `transfer-progress` event per chunk;
// the last event of a transfer has done = true, with `error` set when it failed.
import type { TransferProgress } from '../../lib/types';
import { fmtBytes } from '../../lib/format';

/** replaces the row with the same id, or appends a new one */
export function upsertTransfer(list: readonly TransferProgress[], p: TransferProgress): TransferProgress[] {
  const i = list.findIndex((t) => t.id === p.id);
  if (i < 0) return [...list, p];
  const next = [...list];
  next[i] = p;
  return next;
}

export function removeTransfer(list: readonly TransferProgress[], id: string): TransferProgress[] {
  return list.filter((t) => t.id !== id);
}

/** 0-100 for the meter */
export function percent(p: TransferProgress): number {
  if (p.done && !p.error) return 100;
  return p.total > 0 ? Math.max(0, Math.min(100, Math.round((p.sent / p.total) * 100))) : 0;
}

/** "3.2 MB of 12 MB", "Done" or the error */
export function describeTransfer(p: TransferProgress): string {
  if (p.error) return p.error;
  if (p.done) return `Done, ${fmtBytes(p.total)}`;
  return p.total > 0 ? `${fmtBytes(p.sent)} of ${fmtBytes(p.total)}` : fmtBytes(p.sent);
}
