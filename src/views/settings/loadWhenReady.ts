import { watch } from 'vue';

/**
 * Runs `load` now if ready and again whenever it becomes ready: the view is visible and the reader connected.
 * (A parked view is not "mounted again" when it comes back, so a plain onMounted would never refresh.)
 */
export function loadWhenReady(ready: () => boolean, load: () => unknown): void {
  watch(ready, (r) => { if (r) load(); }, { immediate: true });
}
