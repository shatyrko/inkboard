// Actions on the paired reader that more than one view offers.
import { api } from '../../lib/api';
import { refreshConnection, refreshReaders } from '../../lib/store';
import { attempt, confirmDialog } from '../../lib/ui';

/** Drops the saved keys. The Digital Paper leaves the readers list: the shell shows another reader, or the connect flow if there is none. */
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
    await refreshReaders();
  }, 'Could not forget the reader');
}
