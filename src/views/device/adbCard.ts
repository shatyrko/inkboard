// Words and states for the "USB debugging" card of a USB reader. Pure, so the mapping can be tested.
import type { AdbStatus } from '../../lib/types';

/** what the card shows: checking, 'unavailable' (off on the reader), 'off' (available, not connected), waiting for the tap, failed, ready */
export type CardState = 'checking' | 'unavailable' | 'off' | 'waiting' | 'failed' | 'ready';

export function cardState(status: AdbStatus | undefined, connecting: boolean, error: string): CardState {
  if (connecting) return 'waiting';
  if (!status) return 'checking';
  if (status.state === 'ready') return 'ready';
  if (status.state === 'unavailable') return 'unavailable';
  return error ? 'failed' : 'off';
}

/** "87%" or "87%, charging" */
export function batteryLine(b: { level: number; charging: boolean }): string {
  return `${Math.round(b.level)}%${b.charging ? ', charging' : ''}`;
}

/** "2400 x 3200 px" */
export function screenLabel(s: { width: number; height: number }): string {
  return `${s.width} x ${s.height} px`;
}

/** width / height of the screen, for the live picture; the common 3:4 e-reader shape when the size is unknown */
export function screenAspect(s: { width: number; height: number } | null | undefined): number {
  return s && s.width > 0 && s.height > 0 ? s.width / s.height : 3 / 4;
}
