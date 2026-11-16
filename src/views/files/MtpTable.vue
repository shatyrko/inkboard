<script setup lang="ts">
// The file table of a USB reader: Name, Size, Modified, windowed (see useVirtualRows). Selection, keys and menus are
// owned by the parent; this component draws and reports clicks.
import { computed, useId } from 'vue';
import Icon from '../../components/Icon.vue';
import type { MenuItem } from '../../lib/contextmenu';
import { fmtBytes, fmtDate, fmtDateTime } from '../../lib/format';
import type { MtpEntry } from '../../lib/types';
import { iconFor, type MtpSortKey, type SortDir } from './listing';
import { useVirtualRows } from './useVirtualRows';

const props = defineProps<{
  rows: MtpEntry[];
  selected: ReadonlySet<string>;
  focusId: string | null;
  sortKey: MtpSortKey;
  sortDir: SortDir;
  rowMenu: (entry: MtpEntry) => MenuItem[];
}>();
const emit = defineEmits<{ pick: [id: string, mods: { ctrl: boolean; shift: boolean }]; open: [entry: MtpEntry]; sort: [key: MtpSortKey] }>();

const uid = useId();
const { scroller, headRow, range, width, onScroll, scrollToIndex, reset, pageSize } = useVirtualRows(() => props.rows.length);
const slice = computed(() => props.rows.slice(range.value.start, range.value.end));
const showDate = computed(() => width.value >= 500);
const columns = computed<{ key: MtpSortKey; label: string; right?: boolean; width: number }[]>(() => [
  { key: 'name', label: 'Name', width: 0 },
  { key: 'size', label: 'Size', right: true, width: 104 },
  ...(showDate.value ? [{ key: 'modified' as const, label: 'Modified', width: 140 }] : []),
]);

const idOf = (e: MtpEntry) => String(e.handle);
const rowDomId = (id: string) => `${uid}-${id}`;
const ariaSort = (key: string) => (key === props.sortKey ? (props.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');

function scrollToId(id: string | null) {
  scrollToIndex(id ? props.rows.findIndex((r) => idOf(r) === id) : -1);
}
/** opens the context menu for a row from the keyboard (Menu key, Shift+F10), anchored on the row */
function openMenuFor(id: string | null) {
  const target = (id && document.getElementById(rowDomId(id))) || scroller.value;
  if (!target) return;
  const r = target.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + Math.min(40, r.width / 2), clientY: r.top + r.height / 2 }));
}
defineExpose({ scrollToId, resetScroll: reset, pageSize, openMenuFor, focus: () => scroller.value?.focus({ preventScroll: true }) });
</script>

<template>
  <div ref="scroller" class="ft scroll" tabindex="0" aria-label="Files" :aria-activedescendant="focusId ? rowDomId(focusId) : undefined" @scroll.passive="onScroll">
    <table class="table" role="grid" aria-multiselectable="true" :aria-rowcount="rows.length + 1">
      <colgroup><col v-for="c in columns" :key="c.key" :style="c.width ? { width: c.width + 'px' } : undefined" /></colgroup>
      <thead>
        <tr ref="headRow" role="row">
          <th v-for="c in columns" :key="c.key" scope="col" role="columnheader" :class="{ r: c.right }" :aria-sort="ariaSort(c.key)">
            <button class="th-btn" tabindex="-1" :class="{ on: c.key === sortKey }" @click="emit('sort', c.key)">
              {{ c.label }}<Icon v-if="c.key === sortKey" :name="sortDir === 'asc' ? 'arrow-up' : 'arrow-down'" :size="12" />
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="range.padTop" class="pad" aria-hidden="true" :style="{ height: range.padTop + 'px' }"><td :colspan="columns.length"></td></tr>
        <tr
          v-for="(e, i) in slice"
          :id="rowDomId(idOf(e))"
          :key="e.handle"
          v-context="() => rowMenu(e)"
          role="row"
          :aria-rowindex="range.start + i + 2"
          :aria-selected="selected.has(idOf(e))"
          :class="{ sel: selected.has(idOf(e)), cur: idOf(e) === focusId }"
          @mousedown.left="emit('pick', idOf(e), { ctrl: $event.ctrlKey || $event.metaKey, shift: $event.shiftKey })"
          @dblclick="emit('open', e)"
        >
          <td role="gridcell" :title="e.name">
            <span class="ic" :class="{ dir: e.kind === 'folder' }"><Icon :name="iconFor(e)" :size="18" /></span>
            <span class="nm">{{ e.name }}</span>
          </td>
          <td role="gridcell" class="r num muted">{{ e.kind === 'file' ? fmtBytes(e.size) : '' }}</td>
          <td v-if="showDate" role="gridcell" class="muted" :title="fmtDateTime(e.modified)">{{ fmtDate(e.modified) }}</td>
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
.th-btn { display: inline-flex; align-items: center; gap: 4px; padding: 0 12px; height: 100%; font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit; border-radius: 0; }
.table th.r > .th-btn { justify-content: flex-end; width: 100%; }
.th-btn:hover, .th-btn.on { color: var(--text); }
.pad > td { height: 0; padding: 0; border: 0; }
.table td { font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.ic { display: inline-block; vertical-align: middle; margin-right: 10px; color: var(--muted); line-height: 0; }
.ic.dir { color: var(--accent); }
.nm { vertical-align: middle; }
.ft:focus-visible tr.cur td:first-child { box-shadow: inset 2px 0 0 var(--accent); }
</style>
