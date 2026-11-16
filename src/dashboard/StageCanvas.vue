<script setup lang="ts">
// The page preview: the real renderer drawing at screen size, with a selection box, handles and pointer editing on top.
// Pointer positions are mapped to page pixels through the canvas's on-screen size, never through devicePixelRatio.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { MenuItem } from '../lib/contextmenu';
import Icon from '../components/Icon.vue';
import type { DataBag } from './data';
import { ensureFonts, fontSample } from './fonts';
import { CELL, HANDLES, fitScale, moveRect, pageSize, resizeRect, snapToCell, type Handle, type Rect } from './grid';
import type { Dashboard, Page, Widget } from './model';
import { widgetAt } from './ops';
import { renderPage } from './render';
import { registry } from './widgets';

const props = defineProps<{
  dashboard: Dashboard;
  page: Page;
  pageIndex: number;
  data: DataBag;
  selectedId: string | null;
  grid: boolean;
  /** screen pixels per page pixel, or "fit" */
  zoom: number | 'fit';
  /** items for a right click on `widget` (null: the empty page) at a cell, with the pointer's screen position */
  menuFor: (widget: Widget | null, cell: { x: number; y: number }, point: { x: number; y: number }) => MenuItem[];
}>();
const emit = defineEmits<{
  (e: 'select', id: string | null): void;
  (e: 'live', id: string, rect: Rect): void;
  (e: 'end'): void;
  (e: 'cancel'): void;
  (e: 'scale', value: number): void;
  (e: 'add'): void;
  (e: 'edit', id: string): void;
}>();

const scroller = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const hit = ref<HTMLElement | null>(null);
const room = ref({ width: 0, height: 0 });
const hover = ref(false);

const size = computed(() => pageSize(props.dashboard.orientation));
const bounds = computed(() => ({ cols: size.value.width / CELL, rows: size.value.height / CELL }));
const scale = computed(() => (props.zoom === 'fit' ? fitScale(size.value, room.value, 28) : Math.min(2, Math.max(0.05, props.zoom))));
const view = computed(() => ({ w: Math.round(size.value.width * scale.value), h: Math.round(size.value.height * scale.value) }));
const selected = computed(() => props.page.widgets.find((w) => w.id === props.selectedId) ?? null);
const selStyle = computed(() => {
  const w = selected.value;
  if (!w) return null;
  const k = CELL * scale.value;
  return { left: `${w.x * k}px`, top: `${w.y * k}px`, width: `${w.w * k}px`, height: `${w.h * k}px` };
});
const selLabel = computed(() => (selected.value ? registry[selected.value.type].label : ''));

watch(scale, (s) => emit('scale', s), { immediate: true });

// ---------- drawing: debounced for edits, throttled while a drag is running ----------
let timer: ReturnType<typeof setTimeout> | undefined;
let token = 0;

async function render() {
  const mine = ++token;
  await ensureFonts(fontSample(props.dashboard, props.data));
  const c = canvas.value;
  if (mine !== token || !c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(view.value.w * dpr), h = Math.round(view.value.h * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d');
  if (!g) return;
  g.setTransform(w / size.value.width, 0, 0, h / size.value.height, 0, 0);
  renderPage(g, props.page, { ...props.data, now: new Date() }, { width: size.value.width, height: size.value.height, dashboard: props.dashboard, pageIndex: props.pageIndex });
}

function schedule(throttle: boolean) {
  if (throttle) { if (timer) return; } else clearTimeout(timer);
  timer = setTimeout(() => { timer = undefined; requestAnimationFrame(() => void render()); }, throttle ? 40 : 70);
}

watch(() => [props.page, props.data, props.dashboard.pages, props.pageIndex], () => schedule(drag !== null));
watch(view, () => { clearTimeout(timer); timer = undefined; void render(); });

// ---------- sizing ----------
let observer: ResizeObserver | undefined;
onMounted(() => {
  // measured on the next frame: resizing inside the callback itself can trigger "ResizeObserver loop" errors
  observer = new ResizeObserver(() => requestAnimationFrame(() => {
    const el = scroller.value;
    // a view that is switched away from reports 0 x 0: keep the last real size instead of shrinking the preview
    if (el && el.clientWidth > 0) room.value = { width: el.clientWidth, height: el.clientHeight };
  }));
  if (scroller.value) { observer.observe(scroller.value); room.value = { width: scroller.value.clientWidth, height: scroller.value.clientHeight }; }
  void render();
});
onBeforeUnmount(() => { observer?.disconnect(); clearTimeout(timer); window.removeEventListener('keydown', onDragKey, true); });

// ---------- pointer editing ----------
type Drag = { mode: 'move' | 'resize'; id: string; handle: Handle | null; x: number; y: number; origin: Rect; min: { w: number; h: number }; moved: boolean };
let drag: Drag | null = null;

function pagePoint(e: PointerEvent | MouseEvent) {
  const r = hit.value!.getBoundingClientRect();
  return { px: ((e.clientX - r.left) / r.width) * size.value.width, py: ((e.clientY - r.top) / r.height) * size.value.height };
}
const cellAt = (e: PointerEvent | MouseEvent) => { const p = pagePoint(e); return { x: p.px / CELL, y: p.py / CELL }; };
const minOf = (w: Widget) => ({ w: registry[w.type].size.minW, h: registry[w.type].size.minH });

function begin(e: PointerEvent, mode: Drag['mode'], w: Widget, handle: Handle | null, target: Element) {
  drag = { mode, id: w.id, handle, x: e.clientX, y: e.clientY, origin: { x: w.x, y: w.y, w: w.w, h: w.h }, min: minOf(w), moved: false };
  target.setPointerCapture(e.pointerId);
  window.addEventListener('keydown', onDragKey, true);
}

function onDown(e: PointerEvent) {
  if (e.button !== 0) return;
  hit.value?.focus({ preventScroll: true });
  const c = cellAt(e);
  const w = widgetAt(props.page, c.x, c.y) ?? null;
  emit('select', w?.id ?? null);
  if (w) begin(e, 'move', w, null, hit.value!);
}

function onHandleDown(e: PointerEvent, handle: Handle) {
  const w = selected.value;
  if (e.button !== 0 || !w) return;
  e.stopPropagation();
  begin(e, 'resize', w, handle, e.currentTarget as Element);
}

function onMove(e: PointerEvent) {
  if (!drag) {
    const c = cellAt(e);
    hover.value = !!widgetAt(props.page, c.x, c.y);
    return;
  }
  // a click that wobbles a little must not move anything
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
  drag.moved = true;
  // screen distance -> page pixels -> whole cells
  const dx = snapToCell((e.clientX - drag.x) / scale.value), dy = snapToCell((e.clientY - drag.y) / scale.value);
  const rect = drag.mode === 'move' ? moveRect(drag.origin, dx, dy, bounds.value) : resizeRect(drag.origin, drag.handle!, dx, dy, drag.min, bounds.value);
  emit('live', drag.id, rect);
}

function finish() {
  window.removeEventListener('keydown', onDragKey, true);
  if (drag?.moved) emit('end');
  drag = null;
}

// Esc while dragging puts the widget back; it must not also reach the shortcut handler that would deselect it
function onDragKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !drag) return;
  e.stopPropagation();
  e.preventDefault();
  if (drag.moved) emit('cancel');
  drag = null;
  window.removeEventListener('keydown', onDragKey, true);
}

function onContext(e: MouseEvent): MenuItem[] {
  const c = cellAt(e);
  const w = widgetAt(props.page, c.x, c.y) ?? null;
  emit('select', w?.id ?? null);
  return props.menuFor(w, { x: Math.floor(c.x), y: Math.floor(c.y) }, { x: e.clientX, y: e.clientY });
}

// the keyboard route to the context menu: open it for the selected widget (the global handler would aim at a fixed spot)
function onHitKey(e: KeyboardEvent) {
  if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
  e.preventDefault();
  e.stopPropagation();
  const k = CELL * scale.value;
  const box = hit.value!.getBoundingClientRect();
  const w = selected.value;
  const x = box.left + (w ? (w.x + w.w / 2) * k : box.width / 2);
  const y = box.top + (w ? (w.y + w.h / 2) * k : box.height / 2);
  hit.value!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
}

const handleCursor: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
const handleStyle = (h: Handle) => ({
  left: h.includes('w') ? '0%' : h.includes('e') ? '100%' : '50%',
  top: h.includes('n') ? '0%' : h.includes('s') ? '100%' : '50%',
  cursor: handleCursor[h],
});

defineExpose({ focus: () => hit.value?.focus() });
</script>

<template>
  <div ref="scroller" class="stage" v-context="onContext">
    <div class="paper" :style="{ width: view.w + 'px', height: view.h + 'px', '--cell': CELL * scale + 'px' }" @pointermove="onMove" @pointerup="finish" @pointercancel="finish" @pointerleave="hover = false">
      <canvas ref="canvas" :style="{ width: view.w + 'px', height: view.h + 'px' }" aria-hidden="true"></canvas>
      <div v-if="grid" class="grid" aria-hidden="true"></div>
      <div
        ref="hit"
        class="hit"
        :class="{ over: hover }"
        tabindex="0"
        role="group"
        aria-label="Page canvas. Arrow keys move the selected widget, Ctrl and arrow keys resize it."
        @pointerdown="onDown"
        @keydown="onHitKey"
        @dblclick="selected && emit('edit', selected.id)"
      ></div>
      <div v-if="selStyle" class="sel" :style="selStyle" aria-hidden="true">
        <span class="tag">{{ selLabel }}</span>
        <i v-for="h in HANDLES" :key="h" class="handle" :style="handleStyle(h)" @pointerdown="onHandleDown($event, h)"></i>
      </div>
      <div v-if="!page.widgets.length" class="blank">
        <div class="tile"><Icon name="shapes" :size="26" /></div>
        <h2>This page is empty</h2>
        <p>Add widgets, then drag them into place.</p>
        <button class="btn primary" @click="emit('add')"><Icon name="plus" :size="16" />Add widget <kbd>A</kbd></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage { flex: 1; min-width: 0; min-height: 0; overflow: auto; display: flex; background: var(--side); }
.paper { position: relative; flex: none; margin: auto; /* the page itself, not chrome: always white, as on the reader */ background: #fff; box-shadow: var(--shadow); border: 1px solid var(--border); }
canvas { display: block; filter: grayscale(1); }
.grid {
  position: absolute; inset: 0; pointer-events: none;
  --line: color-mix(in srgb, var(--accent) 15%, transparent);
  --major: color-mix(in srgb, var(--accent) 32%, transparent);
  background-image:
    linear-gradient(to right, var(--major) 1px, transparent 1px), linear-gradient(to bottom, var(--major) 1px, transparent 1px),
    linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px);
  background-size: calc(var(--cell) * 5) calc(var(--cell) * 5), calc(var(--cell) * 5) calc(var(--cell) * 5), var(--cell) var(--cell), var(--cell) var(--cell);
}
.hit { position: absolute; inset: 0; touch-action: none; }
.hit.over { cursor: move; }
.hit:focus-visible { outline-offset: -3px; border-radius: 0; }
.sel { position: absolute; border: 2px solid var(--accent); pointer-events: none; box-shadow: 0 0 0 1px color-mix(in srgb, var(--bg) 70%, transparent); }
.tag { position: absolute; left: -2px; bottom: 100%; padding: 1px 7px; font-size: 11px; font-weight: 600; background: var(--accent); color: var(--on-accent); border-radius: 5px 5px 0 0; white-space: nowrap; }
.handle { position: absolute; width: 11px; height: 11px; margin: -6px 0 0 -6px; background: var(--panel); border: 2px solid var(--accent); border-radius: 3px; pointer-events: auto; touch-action: none; }
.blank { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center; color: var(--muted); pointer-events: none; padding: 24px; }
.blank .tile { width: 56px; height: 56px; border-radius: 28%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.blank h2 { color: var(--text); }
.blank p { margin: 0; }
.blank .btn { pointer-events: auto; margin-top: 4px; }
.blank kbd { margin-left: 4px; background: transparent; border-color: color-mix(in srgb, var(--on-accent) 45%, transparent); color: inherit; }
.stage.ctx-open { background: var(--side); }
</style>
