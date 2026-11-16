// The Publish and Export PDF buttons: flush pending edits, run the job through the background lock, report with toasts.
import { computed, ref, type Ref } from 'vue';
import { pickSavePath } from '../lib/api';
import { fmtBytes } from '../lib/format';
import { attempt, notify } from '../lib/ui';
import { inTauri } from '../lib/window';
import { background } from './background';
import type { Dashboard } from './model';
import { describeProgress, safeDocName } from './publish';

type Deps = {
  /** the dashboard open in the editor, with its unsaved edits */
  open: Ref<Dashboard | null>;
  /** writes pending edits, so what is pushed matches what is saved */
  flush: () => Promise<void>;
};

export function usePushing({ open, flush }: Deps) {
  /** true from the click until the job ends, including time spent waiting for another push to finish */
  const working = ref(false);
  const mine = computed(() => (background.busy.value?.id === open.value?.id ? background.busy.value : null));
  /** also true while an automatic push of the open dashboard is running */
  const busy = computed(() => working.value || !!mine.value);
  const busyText = computed(() => (mine.value ? describeProgress(mine.value.progress) : working.value ? 'Waiting' : ''));
  const scheduleText = computed(() => (open.value ? background.scheduleText(open.value.id) : ''));

  async function publish() {
    const d = open.value;
    if (!d || busy.value) return;
    working.value = true;
    try {
      await flush();
      const result = await attempt(() => background.push(open.value ?? d), 'Could not publish');
      if (result) notify(`Published "${d.name}" to ${result.path} (${result.pages} ${result.pages === 1 ? 'page' : 'pages'}, ${fmtBytes(result.bytes)})`);
    } finally {
      working.value = false;
    }
  }

  async function exportPdf() {
    const d = open.value;
    if (!d || busy.value) return;
    if (!inTauri) { notify('Saving a PDF needs the desktop app.'); return; }
    const dest = await pickSavePath(`${safeDocName(d.name)}.pdf`, ['pdf']);
    if (!dest) return;
    working.value = true;
    try {
      await flush();
      const done = await attempt(async () => { await background.exportPdf(open.value ?? d, dest); return true; }, 'Could not export the PDF');
      if (done) notify(`Saved ${dest}`);
    } finally {
      working.value = false;
    }
  }

  return { busy, busyText, publish, exportPdf, scheduleText };
}
