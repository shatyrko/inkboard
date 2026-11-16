// Pure helpers over the readers list, so the switcher and the polling can be tested without a window.
import type { ConnectionState, Reader } from './types';

/** the id of the reader `step` places after (or before) `currentId`, wrapping round; null when there is nothing to switch to */
export function cycleReader(readers: readonly Reader[], currentId: string | null, step: 1 | -1 = 1): string | null {
  const n = readers.length;
  if (n < 2) return null;
  const at = readers.findIndex((r) => r.id === currentId);
  return readers[(Math.max(at, 0) + step + n) % n].id;
}

/** "Connected", "Connecting...", "Not connected" */
export function readerStatus(r: Pick<Reader, 'id' | 'connected'>, connecting: boolean): string {
  if (r.id === 'dpt' && connecting) return 'Connecting...';
  return r.connected ? 'Connected' : 'Not connected';
}

/**
 * The readers list and the Digital Paper's own connection state come from two commands. When they disagree the
 * connection state is read again, so the views that use it (Device, Library, Settings) never lag behind the switcher.
 */
export function dptStateDiffers(readers: readonly Reader[], conn: ConnectionState | null): boolean {
  const dpt = readers.find((r) => r.id === 'dpt');
  return !!dpt && !!conn && dpt.connected !== conn.connected;
}
