// Glue between the editor and the Reader panel: whether it is on (remembered), where it sits for the current window width,
// and when the live preview may poll (reader-preview.ts holds the policy itself).
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch, type Ref } from 'vue';
import { app } from '../lib/store';
import { notify } from '../lib/ui';
import { background } from './background';
import { captureReaderScreen, createReaderPreview } from './reader-preview';

const KEY = 'inkboard.dashboard.reader';
/** below this width of the editing area, stage + reader + properties do not fit and the reader takes the properties column's place */
const WIDE_PX = 1000;

function remembered(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function useReaderPanel({ hasDoc, selectedId }: { hasDoc: Ref<boolean>; selectedId: Ref<string | null> }) {
  const on = ref(remembered());
  /** in the narrow layout: which of the two shares the right-hand column (a remembered "on" opens it on the reader) */
  const side = ref<'props' | 'reader'>(on.value ? 'reader' : 'props');
  const work = ref<HTMLElement | null>(null);
  const width = ref(0);
  const wide = computed(() => width.value >= WIDE_PX);
  /** the panel is on screen (not hidden behind the Properties tab) */
  const shown = computed(() => hasDoc.value && on.value && (wide.value || side.value === 'reader'));

  const preview = createReaderPreview({
    capture: captureReaderScreen,
    onFailureStreak: (message) => notify(`Could not read the reader's screen: ${message}`, 'error'),
  });

  const viewActive = ref(false);
  const windowVisible = ref(document.visibilityState === 'visible');
  const connected = computed(() => !!app.conn?.connected);
  watch([shown, viewActive, windowVisible, connected], ([panelVisible, active, visible, online]) => {
    preview.update({ panelVisible, viewActive: active, windowVisible: visible, connected: online });
  }, { immediate: true });

  // a push of any dashboard may have changed what the reader shows
  watch(background.lastPush, () => preview.afterPush());
  // choosing a widget means the user wants its properties
  watch(selectedId, (id) => { if (id && !wide.value) side.value = 'props'; });

  function set(next: boolean) {
    on.value = next;
    try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* storage can be unavailable */ }
    if (next && !wide.value) side.value = 'reader';
  }
  const toggle = () => set(!on.value);
  /** Shift+R: bring the panel up if it is not, and look again */
  function refresh() {
    const wasShown = shown.value;
    set(true);
    if (wasShown) preview.refresh();
  }

  const bind = computed(() => ({
    image: preview.image.value,
    updatedAt: preview.updatedAt.value,
    loading: preview.loading.value,
    error: preview.error.value,
    connected: connected.value,
    connecting: app.connecting,
    reason: app.connectError,
  }));

  let observer: ResizeObserver | undefined;
  const onVisibility = () => { windowVisible.value = document.visibilityState === 'visible'; };
  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibility);
    observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      // a view that is switched away from reports 0: keep the last real width
      if (w > 0) width.value = w;
    });
    watch(work, (el, old) => {
      if (old) observer?.unobserve(old);
      if (el) observer?.observe(el);
    }, { immediate: true, flush: 'post' });
  });
  onActivated(() => { viewActive.value = true; });
  onDeactivated(() => { viewActive.value = false; });
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    observer?.disconnect();
    preview.dispose();
  });

  return { on, side, work, wide, bind, toggle, refresh, set };
}
