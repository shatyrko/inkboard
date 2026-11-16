import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

/** Turns true only once `source` has been true for `ms`: short waits show nothing, longer ones get a spinner. */
export function useDelayed(source: Ref<boolean>, ms = 300): Ref<boolean> {
  const shown = ref(false);
  let timer: number | undefined;
  watch(source, (on) => {
    window.clearTimeout(timer);
    if (on) timer = window.setTimeout(() => { shown.value = true; }, ms);
    else shown.value = false;
  }, { immediate: true });
  onBeforeUnmount(() => window.clearTimeout(timer));
  return shown;
}
