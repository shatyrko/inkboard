// App-wide state: which view is shown, the reader connection, app settings and the theme.
import { reactive } from 'vue';
import { api } from './api';
import type { AppSettings, ConnectionState, Reader } from './types';

export type ViewName = 'device' | 'library' | 'dashboards' | 'settings';

const VIEWS: ViewName[] = ['device', 'library', 'dashboards', 'settings'];
/** `?view=dashboards` opens on that section (handy for screenshots and for `tauri dev --config` runs) */
function startView(): ViewName {
  try {
    const v = new URLSearchParams(location.search).get('view') as ViewName | null;
    if (v && VIEWS.includes(v)) return v;
  } catch { /* no location in tests */ }
  return 'device';
}

export const app = reactive({
  view: startView(),
  conn: null as ConnectionState | null,
  /** true while the first connection attempt is running */
  connecting: false,
  /** last connection error, shown with a Retry button */
  connectError: '' as string,
  settings: null as AppSettings | null,
  /** every reader known right now: the paired Digital Paper and the USB devices that are plugged in */
  readers: [] as Reader[],
  /** Reader.id of the reader the views show; remembered between runs */
  reader: readStored('inkboard.reader') || 'dpt',
});

function readStored(key: string): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}

/** the reader the views are about; falls back to the first known one when the remembered reader is gone */
export function activeReader(): Reader | null {
  return app.readers.find((r) => r.id === app.reader) ?? app.readers[0] ?? null;
}

export function selectReader(id: string) {
  app.reader = id;
  try { localStorage.setItem('inkboard.reader', id); } catch { /* storage can be unavailable */ }
}

export async function refreshReaders(): Promise<void> {
  app.readers = await api.readersList();
}

export async function refreshConnection(): Promise<void> {
  app.conn = await api.connectionState();
}

/** Authenticates against the saved reader. Never throws: a failure lands in app.connectError. */
export async function connectNow(): Promise<void> {
  app.connecting = true;
  app.connectError = '';
  try {
    app.conn = await api.connect();
  } catch (e) {
    app.connectError = typeof e === 'string' ? e : (e as Error)?.message || 'Could not reach the reader';
    await refreshConnection().catch(() => {});
  } finally {
    app.connecting = false;
  }
}

export async function loadSettings(): Promise<void> {
  app.settings = await api.settingsGet();
}

export type Theme = 'system' | 'light' | 'dark';
export function getTheme(): Theme {
  try { return (localStorage.getItem('inkboard.theme') as Theme) || 'system'; } catch { return 'system'; }
}
export function applyTheme(t: Theme) {
  try { localStorage.setItem('inkboard.theme', t); } catch { /* storage can be unavailable */ }
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
