// The window has no system title bar (decorations are off): the app draws its own.
// In a plain browser everything here is a no-op.
export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let cur: any = null;
async function w() {
  if (!cur) cur = (await import('@tauri-apps/api/window')).getCurrentWindow();
  return cur;
}
const call = (f: string, fallback?: unknown) => async (...a: unknown[]) => (inTauri ? (await w())[f](...a) : fallback);

export const win = {
  minimize: call('minimize'),
  toggleMaximize: call('toggleMaximize'),
  close: call('close'),
  isMaximized: call('isMaximized', false) as () => Promise<boolean>,
  startResize: call('startResizeDragging') as (dir: string) => Promise<void>,
  onResized: async (cb: () => void): Promise<() => void> => (inTauri ? (await w()).onResized(cb) : () => {}),
};

// A press on a bar (an element with `data-drag`) that is not on a control starts moving the window; a double click maximises.
const controls = 'button, input, select, textarea, a, label, .pop, [data-nodrag]';
function bar(e: MouseEvent): boolean {
  if (e.button !== 0 || !inTauri) return false;
  const t = e.target as HTMLElement | null;
  return !!(t && t.closest && t.closest('[data-drag]') && !t.closest(controls));
}
export function installDrag() {
  window.addEventListener('mousedown', async (e) => {
    if (!bar(e)) return;
    if (e.detail === 2) win.toggleMaximize();
    else (await w()).startDragging();
  });
}
