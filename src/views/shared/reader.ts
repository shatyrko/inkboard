// Actions on the paired reader that more than one view offers.
import { api } from '../../lib/api';
import { refreshConnection } from '../../lib/store';
import { attempt, confirmDialog } from '../../lib/ui';

/** Drops the saved keys; the shell then shows the connect flow again. */
export async function forgetReader(): Promise<void> {
  const ok = await confirmDialog({
    title: 'Forget this reader?',
    body: 'Inkboard deletes the pairing keys it saved on this computer. Nothing on the reader changes and its documents stay where they are. To use it with Inkboard again you pair it with a new PIN.',
    confirm: 'Forget reader',
  });
  if (!ok) return;
  await attempt(async () => {
    await api.forgetDevice();
    await refreshConnection();
  }, 'Could not forget the reader');
}
