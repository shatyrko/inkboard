// Keeps app.readers current: a USB reader plugged in or pulled out shows up within a few seconds, and again at once when
// the window gets focus. Started once from App.vue.
import { ref } from 'vue';
import { app, refreshConnection, refreshReaders } from './store';
import { dptStateDiffers } from './readerList';

const EVERY_MS = 4000;

/** true once the first readers list has arrived, so the shell can tell "none yet" from "none at all" */
export const readersReady = ref(false);

let busy = false;
async function refresh() {
  if (busy || document.hidden) return;
  busy = true;
  try {
    await refreshReaders();
    readersReady.value = true;
    if (dptStateDiffers(app.readers, app.conn) && !app.connecting) await refreshConnection();
  } catch {
    // a failed poll keeps the last list; the next one tries again
  } finally {
    busy = false;
  }
}

/** returns the function that stops it */
export function startReaderWatch(): () => void {
  refresh();
  const timer = window.setInterval(refresh, EVERY_MS);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
}
