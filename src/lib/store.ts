// App-wide state: which view is shown, the reader connection, app settings and the theme.
import { reactive } from 'vue';
import { api } from './api';
import type { AppSettings, ConnectionState } from './types';

export type ViewName = 'device' | 'library' | 'dashboards' | 'settings';

export const app = reactive({
  view: 'device' as ViewName,
  conn: null as ConnectionState | null,
  /** true while the first connection attempt is running */
  connecting: false,
  /** last connection error, shown with a Retry button */
  connectError: '' as string,
  settings: null as AppSettings | null,
});

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
