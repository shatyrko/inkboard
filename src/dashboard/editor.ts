// The editing session for one open dashboard: the document, the current page and selection, undo/redo and autosave.
// The document is immutable (see ops.ts); every edit swaps in a new one, so the Vue state is a shallow ref and snapshots are cheap.
import { computed, ref, shallowRef } from 'vue';
import { clampRect, gridOf, moveRect, type Rect } from './grid';
import { History } from './history';
import { createWidget, type Dashboard, type Schedule, type PublishOptions, type Widget, type WidgetProps, type WidgetType } from './model';
import * as ops from './ops';
import { registry } from './widgets';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export const SAVE_DELAY_MS = 700;
const HISTORY_LIMIT = 100;

/** shared by all editors: copying in one dashboard and pasting in another works */
let clipboard: Widget | null = null;
export const hasClipboard = () => clipboard !== null;

export function useEditor(save: (doc: Dashboard) => Promise<void>) {
  const doc = shallowRef<Dashboard | null>(null);
  const pageId = ref('');
  const selectedId = ref<string | null>(null);
  const canUndo = ref(false);
  const canRedo = ref(false);
  const saveState = ref<SaveState>('saved');
  const saveError = ref('');

  let history: History<Dashboard> | null = null;
  let lastSaved: Dashboard | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let pasteStep = 0;

  const page = computed(() => doc.value?.pages.find((p) => p.id === pageId.value) ?? doc.value?.pages[0] ?? null);
  const pageIndex = computed(() => Math.max(0, doc.value?.pages.findIndex((p) => p.id === page.value?.id) ?? 0));
  const selected = computed(() => page.value?.widgets.find((w) => w.id === selectedId.value) ?? null);
  const bounds = computed(() => gridOf(doc.value?.orientation ?? 'portrait'));

  // ---------- persistence ----------
  async function persist() {
    const d = history?.present;
    if (!d) return;
    if (d === lastSaved) { saveState.value = 'saved'; return; }
    saveState.value = 'saving';
    try {
      await save(d);
      lastSaved = d;
      saveState.value = history?.present === d ? 'saved' : 'dirty';
    } catch (e) {
      saveError.value = typeof e === 'string' ? e : (e as Error)?.message || 'Could not save';
      saveState.value = 'error';
    }
  }

  /** writes any pending change now (before publishing, when leaving the view); saves run one at a time, in order */
  function flush(): Promise<void> {
    clearTimeout(timer);
    chain = chain.then(persist);
    return chain;
  }

  function markDirty() {
    saveState.value = 'dirty';
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  /** brings the reactive state in line with the history after any change */
  function sync(dirty = true) {
    const h = history;
    if (!h) return;
    doc.value = h.present;
    canUndo.value = h.canUndo;
    canRedo.value = h.canRedo;
    if (!h.present.pages.some((p) => p.id === pageId.value)) pageId.value = h.present.pages[0].id;
    if (selectedId.value && !page.value?.widgets.some((w) => w.id === selectedId.value)) selectedId.value = null;
    if (dirty) markDirty();
  }

  function open(d: Dashboard) {
    clearTimeout(timer);
    history = new History(d, HISTORY_LIMIT);
    lastSaved = d;
    pageId.value = d.pages[0].id;
    selectedId.value = null;
    saveState.value = 'saved';
    sync(false);
  }

  function close() {
    clearTimeout(timer);
    history = null;
    lastSaved = null;
    doc.value = null;
    selectedId.value = null;
  }

  /** applies an edit; edits with the same `key` in quick succession become one undo step */
  function edit(fn: (d: Dashboard) => Dashboard, key: string | null = null) {
    if (!history) return;
    history.push(fn(history.present), key);
    sync();
  }

  const select = (id: string | null) => { selectedId.value = id; };
  const selectPage = (id: string) => { pageId.value = id; selectedId.value = null; };

  // ---------- widgets ----------
  function addWidget<T extends WidgetType>(type: T, at?: { x: number; y: number }, props?: Partial<WidgetProps[T]>): Widget | null {
    const p = page.value;
    if (!p || !history) return null;
    // without a target, cascade new widgets so they do not stack exactly on top of each other
    const n = p.widgets.length % 6;
    const w = createWidget(type, bounds.value, at ?? { x: 2 + n, y: 2 + n }, props) as Widget;
    edit((d) => ops.addWidget(d, p.id, w));
    selectedId.value = w.id;
    return w;
  }

  function patchProps(id: string, patch: Record<string, unknown>, key: string) {
    const p = page.value;
    if (p) edit((d) => ops.patchProps(d, p.id, id, patch), `props:${id}:${key}`);
  }

  function setRect(id: string, rect: Rect, key: string | null = null) {
    const p = page.value;
    if (p) edit((d) => ops.setRect(d, p.id, id, rect), key);
  }

  // a drag or resize with the pointer: shown live, recorded as one undo step by endGesture
  function liveRect(id: string, rect: Rect) {
    const p = page.value;
    if (!p || !history) return;
    history.live(ops.setRect(history.present, p.id, id, rect));
    sync();
  }
  function endGesture() {
    if (!history) return;
    history.settle();
    sync(false);
    if (history.present !== lastSaved) markDirty();
  }
  function cancelGesture() {
    if (!history) return;
    history.abort();
    sync(false);
    if (history.present === lastSaved) saveState.value = 'saved';
  }

  function nudge(dx: number, dy: number) {
    const w = selected.value;
    if (w) setRect(w.id, moveRect(w, dx, dy, bounds.value), `nudge:${w.id}`);
  }

  function resizeBy(dw: number, dh: number) {
    const w = selected.value;
    if (!w) return;
    const def = registry[w.type];
    setRect(w.id, clampRect({ ...w, w: w.w + dw, h: w.h + dh }, bounds.value, { w: def.size.minW, h: def.size.minH }), `resize:${w.id}`);
  }

  /** sets a size/position field from the sidebar, in cells */
  function setGeometry(id: string, patch: Partial<Rect>) {
    const w = page.value?.widgets.find((x) => x.id === id);
    if (w) setRect(id, { x: w.x, y: w.y, w: w.w, h: w.h, ...patch }, `geometry:${id}`);
  }

  function remove(id = selectedId.value) {
    const p = page.value;
    if (!p || !id) return;
    edit((d) => ops.removeWidget(d, p.id, id));
  }

  function duplicate() {
    const p = page.value, w = selected.value;
    if (!p || !w || !history) return;
    const copy = ops.cloneWidget(history.present, p.id, w);
    edit((d) => ops.addWidget(d, p.id, copy));
    selectedId.value = copy.id;
  }

  function copy() {
    if (selected.value) { clipboard = selected.value; pasteStep = 0; }
  }
  function cut() {
    copy();
    remove();
  }
  function paste(at?: { x: number; y: number }) {
    const p = page.value;
    if (!clipboard || !p || !history) return;
    pasteStep += 1;
    const src = clipboard;
    const copyOf = ops.cloneWidget(history.present, p.id, src, at ?? { x: src.x + pasteStep, y: src.y + pasteStep });
    edit((d) => ops.addWidget(d, p.id, copyOf));
    selectedId.value = copyOf.id;
  }

  function reorder(how: ops.Order) {
    const p = page.value, w = selected.value;
    if (p && w) edit((d) => ops.reorder(d, p.id, w.id, how));
  }

  // ---------- pages ----------
  function addPage(): string | null {
    if (!history) return null;
    edit((d) => ops.addPage(d));
    const id = history.present.pages[history.present.pages.length - 1].id;
    selectPage(id);
    return id;
  }
  const renamePage = (id: string, name: string) => edit((d) => ops.renamePage(d, id, name));
  const removePage = (id: string) => edit((d) => ops.removePage(d, id));
  const movePage = (id: string, delta: number) => edit((d) => ops.movePage(d, id, delta));
  function duplicatePage(id: string) {
    if (!history) return;
    const before = new Set(history.present.pages.map((p) => p.id));
    edit((d) => ops.duplicatePage(d, id));
    const added = history.present.pages.find((p) => !before.has(p.id));
    if (added) selectPage(added.id);
  }

  // ---------- dashboard ----------
  const rename = (name: string) => edit((d) => ops.patchDashboard(d, { name }), 'name');
  const setOrientation = (o: Dashboard['orientation']) => edit((d) => ops.setOrientation(d, o));
  const setSchedule = (schedule: Schedule) => edit((d) => ops.patchDashboard(d, { schedule }), 'schedule');
  const setPublish = (publish: PublishOptions) => edit((d) => ops.patchDashboard(d, { publish }), 'publish');

  // ---------- history ----------
  function undo() { if (history?.undo()) sync(); }
  function redo() { if (history?.redo()) sync(); }

  return {
    doc, page, pageIndex, selected, selectedId, bounds, canUndo, canRedo, saveState, saveError,
    open, close, flush, select, selectPage,
    addWidget, patchProps, setRect, setGeometry, liveRect, endGesture, cancelGesture, nudge, resizeBy,
    remove, duplicate, copy, cut, paste, reorder,
    addPage, renamePage, removePage, movePage, duplicatePage,
    rename, setOrientation, setSchedule, setPublish,
    undo, redo,
  };
}

export type Editor = ReturnType<typeof useEditor>;
