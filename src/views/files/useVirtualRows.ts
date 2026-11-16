// Windowing for a table with fixed-height rows: only the rows in view (plus a few) are rendered, so a folder with
// thousands of files scrolls like a short one. The maths is in library/virtual.ts.
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import { scrollToRow, visibleRange } from '../library/virtual';

export function useVirtualRows(count: () => number, rowH = 40) {
  const scroller = ref<HTMLElement | null>(null);
  const headRow = ref<HTMLElement | null>(null);
  const scrollTop = ref(0);
  const viewport = ref(600);
  const headH = ref(33);
  /** width of the scroll area, for dropping columns when it is narrow */
  const width = ref(700);

  const range = computed(() => visibleRange({ scrollTop: scrollTop.value, viewport: viewport.value, rowH, headH: headH.value, count: count() }));

  let frame = 0;
  function onScroll() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      scrollTop.value = scroller.value?.scrollTop ?? 0;
    });
  }

  let observer: ResizeObserver | undefined;
  function measure() {
    const el = scroller.value;
    if (!el || el.clientHeight <= 0) return; // zero while the shell has the view parked
    viewport.value = el.clientHeight;
    width.value = el.clientWidth;
    headH.value = headRow.value?.offsetHeight || headH.value;
  }
  onMounted(() => {
    observer = new ResizeObserver(measure);
    if (scroller.value) observer.observe(scroller.value);
    measure();
  });
  onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame); });

  // an element taken out of the page and put back starts at the top again: remember where it was
  let parked = 0;
  onDeactivated(() => { parked = scrollTop.value; });
  onActivated(() => nextTick(() => { if (scroller.value) scroller.value.scrollTop = parked; }));

  function scrollToIndex(i: number) {
    const el = scroller.value;
    if (!el || i < 0) return;
    el.scrollTop = scrollToRow(i, { scrollTop: el.scrollTop, viewport: el.clientHeight, rowH, headH: headH.value });
    scrollTop.value = el.scrollTop;
  }
  function reset() {
    if (scroller.value) scroller.value.scrollTop = 0;
    scrollTop.value = 0;
  }
  /** rows that fit on one screen, for Page Up / Page Down */
  const pageSize = () => Math.max(1, Math.floor((viewport.value - headH.value) / rowH) - 1);

  return { scroller, headRow, range, width, onScroll, scrollToIndex, reset, pageSize };
}
