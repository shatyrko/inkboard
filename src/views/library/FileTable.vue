<script setup lang="ts">
// The document table. Rows have a fixed height, so only the rows in view (plus a few) are rendered: a library of
// thousands of documents scrolls as smoothly as a short one. Selection and keys are owned by the parent; this
// component draws, reports clicks and scrolls.
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, useId } from 'vue';
import Icon from '../../components/Icon.vue';
import type { MenuItem } from '../../lib/contextmenu';
import { fmtBytes, fmtDate, fmtDateTime } from '../../lib/format';
import type { Entry } from '../../lib/types';
import { pickColumns, type ColumnKey } from './columns';
import type { SortDir, SortKey } from './listing';
import { relativeToRoot, parentPath } from './paths';
import type { FolderNode } from './tree';
import { itemCount } from './tree';
import { scrollToRow, visibleRange } from './virtual';

const props = defineProps<{
  rows: Entry[];
  selected: ReadonlySet<string>;
  focusId: string | null;
  sortKey: SortKey;
  sortDir: SortDir;
  /** search results come from the whole library, so they need a Folder column */
  showFolder: boolean;
  nodes: ReadonlyMap<string, FolderNode>;
  rowMenu: (entry: Entry) => MenuItem[];
}>();
const emit = defineEmits<{ pick: [id: string, mods: { ctrl: boolean; shift: boolean }]; open: [entry: Entry]; sort: [key: SortKey] }>();

const ROW_H = 40;
const uid = useId();
const scroller = ref<HTMLElement | null>(null);
const headRow = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewport = ref(600);
const headH = ref(33);

const width = ref(700);
const columns = computed(() => pickColumns(width.value, props.showFolder));

const range = computed(() => visibleRange({ scrollTop: scrollTop.value, viewport: viewport.value, rowH: ROW_H, headH: headH.value, count: props.rows.length }));
const slice = computed(() => props.rows.slice(range.value.start, range.value.end));

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
  const h = scroller.value?.clientHeight ?? 0;
  if (h > 0) { // 0 while the view is parked by the shell
    viewport.value = h;
    width.value = scroller.value?.clientWidth ?? width.value;
  }
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

function scrollToId(id: string | null) {
  const el = scroller.value;
  const i = id ? props.rows.findIndex((r) => r.id === id) : -1;
  if (!el || i < 0) return;
  el.scrollTop = scrollToRow(i, { scrollTop: el.scrollTop, viewport: el.clientHeight, rowH: ROW_H, headH: headH.value });
  scrollTop.value = el.scrollTop;
}
function resetScroll() {
  if (scroller.value) scroller.value.scrollTop = 0;
  scrollTop.value = 0;
}
/** rows that fit on one screen, for Page Up / Page Down */
const pageSize = () => Math.max(1, Math.floor((viewport.value - headH.value) / ROW_H) - 1);
/** opens the context menu for a row from the keyboard (Menu key, Shift+F10), anchored on the row */
function openMenuFor(id: string | null) {
  const target = (id && document.getElementById(rowIdOf(id))) || scroller.value;
  if (!target) return;
  const r = target.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + Math.min(40, r.width / 2), clientY: r.top + r.height / 2 }));
}
defineExpose({ scrollToId, resetScroll, pageSize, openMenuFor, focus: () => scroller.value?.focus({ preventScroll: true }) });

function cell(e: Entry, key: ColumnKey): string {
  const folder = e.kind === 'folder';
  switch (key) {
    case 'folder': return where(e);
    case 'pages': return !folder && e.totalPage ? String(e.totalPage) : '';
    case 'size': return folder ? items(e) : fmtBytes(e.size);
    case 'modified': return folder ? '' : fmtDate(e.modified);
    case 'lastRead': return fmtDate(e.lastRead);
    default: return '';
  }
}
function cellTitle(e: Entry, key: ColumnKey): string {
  if (key === 'name') return e.name;
  if (key === 'folder') return where(e);
  return key === 'modified' ? fmtDateTime(e.modified) : key === 'lastRead' ? fmtDateTime(e.lastRead) : '';
}
const ariaSort = (key: string) => (key === props.sortKey ? (props.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
const icon = (e: Entry) => (e.kind === 'folder' ? 'folder' : e.docType === 'note' ? 'note' : 'file-text');
const rowIdOf = (id: string) => `${uid}-${id}`;
const where = (e: Entry) => relativeToRoot(parentPath(e.path)) || 'Document';
function items(e: Entry): string {
  const n = props.nodes.get(e.path);
  const c = n ? itemCount(n) : 0;
  return `${c} ${c === 1 ? 'item' : 'items'}`;
}
</script>

<template>
  <div ref="scroller" class="ft scroll" tabindex="0" aria-label="Documents" :aria-activedescendant="focusId ? rowIdOf(focusId) : undefined" @scroll.passive="onScroll">
    <table class="table" role="grid" aria-multiselectable="true" :aria-rowcount="rows.length + 1">
      <colgroup><col v-for="c in columns" :key="c.key" :style="c.width ? { width: c.width + 'px' } : undefined" /></colgroup>
      <thead>
        <tr ref="headRow" role="row">
          <th v-for="c in columns" :key="c.key" scope="col" role="columnheader" :class="{ r: c.right }" :aria-sort="c.key === 'folder' ? undefined : ariaSort(c.key)">
            <span v-if="c.key === 'folder'">{{ c.label }}</span>
            <button v-else class="th-btn" tabindex="-1" :class="{ on: c.key === sortKey }" @click="emit('sort', c.key)">
              {{ c.label }}<Icon v-if="c.key === sortKey" :name="sortDir === 'asc' ? 'arrow-up' : 'arrow-down'" :size="12" />
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="range.padTop" class="pad" aria-hidden="true" :style="{ height: range.padTop + 'px' }"><td :colspan="columns.length"></td></tr>
        <tr
          v-for="(e, i) in slice"
          :id="rowIdOf(e.id)"
          :key="e.id"
          v-context="() => rowMenu(e)"
          role="row"
          :aria-rowindex="range.start + i + 2"
          :aria-selected="selected.has(e.id)"
          :class="{ sel: selected.has(e.id), cur: e.id === focusId }"
          @mousedown.left="emit('pick', e.id, { ctrl: $event.ctrlKey || $event.metaKey, shift: $event.shiftKey })"
          @dblclick="emit('open', e)"
        >
          <td v-for="c in columns" :key="c.key" role="gridcell" :class="{ r: c.right, muted: c.muted, num: c.right }" :title="cellTitle(e, c.key)">
            <template v-if="c.key === 'name'">
              <span class="ic" :class="{ dir: e.kind === 'folder', fresh: e.isNew }"><Icon :name="icon(e)" :size="18" /></span>
              <span class="nm">{{ e.name }}</span><span v-if="e.isNew" class="sr"> (new)</span>
            </template>
            <template v-else>{{ cell(e, c.key) }}</template>
          </td>
        </tr>
        <tr v-if="range.padBottom" class="pad" aria-hidden="true" :style="{ height: range.padBottom + 'px' }"><td :colspan="columns.length"></td></tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.ft { outline-offset: -2px; }
.table { table-layout: fixed; }
.table th { padding: 0; height: 33px; }
.table th > span, .th-btn { display: inline-flex; align-items: center; gap: 4px; padding: 0 12px; height: 100%; }
.table th.r > .th-btn { justify-content: flex-end; width: 100%; }
.th-btn { font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit; border-radius: 0; }
.th-btn:hover, .th-btn.on { color: var(--text); }
.table tbody tr:not(.pad) { cursor: default; }
.pad > td { height: 0; padding: 0; border: 0; }
.table td { font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.ic { position: relative; display: inline-block; vertical-align: middle; margin-right: 10px; color: var(--muted); line-height: 0; }
.ic.dir { color: var(--accent); }
.ic.fresh::after { content: ''; position: absolute; top: -3px; right: -4px; width: 8px; height: 8px; border-radius: 99px; background: var(--accent-2); }
.nm { vertical-align: middle; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.ft:focus-visible tr.cur td:first-child { box-shadow: inset 2px 0 0 var(--accent); }
</style>
