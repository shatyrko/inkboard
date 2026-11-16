// Keeps app.readers current: a USB reader plugged in or pulled out shows up within a few seconds, and again at once when
// the window gets focus. It also keeps the USB debugging status of a connected reader fresh (the battery in the switcher).
// Started once from App.vue.
import { ref } from 'vue';
import { adb, adbReady, refreshAdb } from './adb';
import { app, refreshConnection, refreshReaders } from './store';
import { adbWork, dptStateDiffers } from './readerList';

const EVERY_MS = 4000;

/** true once the first readers list has arrived, so the shell can tell "none yet" from "none at all" */
export const readersReady = ref(false);

let busy = false;
let ticks = 0;
async function refresh() {
  if (busy || document.hidden) return;
  busy = true;
  try {
    await refreshReaders();
    readersReady.value = true;
    if (dptStateDiffers(app.readers, app.conn) && !app.connecting) await refreshConnection();
    const work = adbWork(app.readers, adbReady, ++ticks);
    work.forget.forEach((id) => { adb[id] = undefined; });
    work.refresh.forEach((id) => { refreshAdb(id); });
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
