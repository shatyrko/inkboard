// Live transfer list for the panel, fed by the `transfer-progress` events (or the mock's stand-in in a plain browser).
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { onTransfer } from '../../lib/api';
import type { TransferProgress } from '../../lib/types';
import { inTauri } from '../../lib/window';
import { removeTransfer, upsertTransfer } from './transfers';

const DONE_VISIBLE_MS = 2500;

async function listen(cb: (p: TransferProgress) => void): Promise<() => void> {
  if (inTauri) return onTransfer(cb);
  const { listenMockTransfers } = await import('../../mock/transfer');
  return listenMockTransfers(cb);
}

export function useTransfers() {
  const items = ref<TransferProgress[]>([]);
  const timers = new Set<number>();
  let off: (() => void) | undefined;
  let gone = false;

  function dismiss(id: string) {
    items.value = removeTransfer(items.value, id);
  }
  function push(p: TransferProgress) {
    items.value = upsertTransfer(items.value, p);
    // a finished transfer fades out by itself; a failed one stays until the user dismisses it
    if (p.done && !p.error) timers.add(window.setTimeout(() => dismiss(p.id), DONE_VISIBLE_MS));
  }

  onMounted(async () => {
    const stop = await listen(push);
    if (gone) stop();
    else off = stop;
  });
  onBeforeUnmount(() => {
    gone = true;
    off?.();
    timers.forEach((t) => window.clearTimeout(t));
  });

  return { items, dismiss };
}
