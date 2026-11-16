// Toasts and promise-based dialogs. Never alert()/confirm()/prompt().
import { reactive } from 'vue';

export type Toast = { id: number; text: string; kind: 'ok' | 'error' };
export const toasts = reactive<{ items: Toast[] }>({ items: [] });
let tid = 0;

export function notify(text: string, kind: 'ok' | 'error' = 'ok') {
  const t: Toast = { id: ++tid, text, kind };
  toasts.items = [t]; // one at a time
  setTimeout(() => {
    toasts.items = toasts.items.filter((x) => x.id !== t.id);
  }, kind === 'error' ? 6500 : 3200);
}

/** Run an async action; a throw becomes an error toast instead of an unhandled rejection. */
export async function attempt<T>(fn: () => Promise<T>, failure?: string): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    const msg = typeof e === 'string' ? e : (e as Error)?.message || 'Something went wrong';
    notify(failure ? `${failure}: ${msg}` : msg, 'error');
    return undefined;
  }
}

export type DialogButton = { label: string; value: string; kind?: 'primary' | 'danger' | 'plain' };
export type DialogState =
  | { kind: 'confirm'; title: string; body?: string; confirm: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'ask'; title: string; body?: string; label?: string; value: string; placeholder?: string; confirm: string; resolve: (v: string | null) => void }
  | { kind: 'choose'; title: string; body?: string; buttons: DialogButton[]; resolve: (v: string | null) => void };

export const dialog = reactive<{ current: DialogState | null }>({ current: null });

/** Title states the consequence; body names the object and whether it can be undone; the button is a verb. */
export function confirmDialog(o: { title: string; body?: string; confirm?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.current = { kind: 'confirm', title: o.title, body: o.body, confirm: o.confirm ?? 'OK', danger: !!o.danger, resolve };
  });
}
export function askDialog(o: { title: string; body?: string; label?: string; value?: string; placeholder?: string; confirm?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    dialog.current = { kind: 'ask', title: o.title, body: o.body, label: o.label, value: o.value ?? '', placeholder: o.placeholder, confirm: o.confirm ?? 'OK', resolve };
  });
}
export function chooseDialog(o: { title: string; body?: string; buttons: DialogButton[] }): Promise<string | null> {
  return new Promise((resolve) => {
    dialog.current = { kind: 'choose', title: o.title, body: o.body, buttons: o.buttons, resolve };
  });
}
