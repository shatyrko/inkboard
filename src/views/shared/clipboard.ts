import { notify } from '../../lib/ui';

/** Copies text and says so. Falls back to a hidden field where the async clipboard API is refused. */
export async function copyText(text: string, what = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const f = document.createElement('textarea');
    f.value = text;
    f.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(f);
    f.select();
    const ok = document.execCommand('copy');
    f.remove();
    if (!ok) { notify('Could not copy', 'error'); return; }
  }
  notify(what);
}
