// Transfer progress for the mocks. A plain browser has no Tauri events, so the views listen here instead
// (src/views/library/useTransfers.ts) and the mock readers report into the same list.
import type { TransferProgress } from '../lib/types';
import { newId } from './device-data';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const listeners = new Set<(p: TransferProgress) => void>();

export function listenMockTransfers(cb: (p: TransferProgress) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** six progress events over about a second, the last one with done = true */
export async function simulateTransfer(name: string, direction: 'up' | 'down', total: number): Promise<void> {
  const id = newId();
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await sleep(150);
    const p: TransferProgress = { id, name, direction, sent: Math.round((total * i) / steps), total, done: i === steps, error: null };
    listeners.forEach((l) => l(p));
  }
}
