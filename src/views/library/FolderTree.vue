<script setup lang="ts">
// The folder tree: one focusable container (arrows, Enter) with the selected folder highlighted. Used for the library
// sidebar and, with `disabled`, inside the "Move to / Copy to" picker.
import { computed, nextTick, useId, watch } from 'vue';
import Icon from '../../components/Icon.vue';
import type { MenuItem } from '../../lib/contextmenu';
import { flattenVisible, type FolderNode } from './tree';

const props = defineProps<{
  root: FolderNode;
  selected: string;
  expanded: ReadonlySet<string>;
  label: string;
  counts?: boolean;
  menu?: (node: FolderNode) => MenuItem[];
  /** folders that cannot be chosen (shown dimmed, skipped by the arrow keys) */
  disabled?: (node: FolderNode) => boolean;
}>();
const emit = defineEmits<{ select: [path: string]; toggle: [path: string]; activate: [path: string] }>();

const uid = useId();
const rows = computed(() => flattenVisible(props.root, props.expanded));
const off = (n: FolderNode) => !!props.disabled?.(n);
const rowId = (i: number) => `${uid}-${i}`;
const current = computed(() => rows.value.findIndex((r) => r.node.path === props.selected));

/** moves the selection to the next enabled row in a direction */
function step(from: number, dir: 1 | -1) {
  for (let i = from + dir; i >= 0 && i < rows.value.length; i += dir) {
    if (!off(rows.value[i].node)) { emit('select', rows.value[i].node.path); return; }
  }
}
function onKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const i = current.value;
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    // the keyboard route to the row's menu, anchored on the selected folder
    const el = document.getElementById(rowId(i));
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + r.height / 2 }));
    return;
  }
  const n = rows.value[i]?.node;
  switch (e.key) {
    case 'ArrowDown': step(i, 1); break;
    case 'ArrowUp': step(i, -1); break;
    case 'Home': step(-1, 1); break;
    case 'End': step(rows.value.length, -1); break;
    case 'ArrowRight':
      if (!n?.children.length) return;
      if (!props.expanded.has(n.path)) emit('toggle', n.path);
      else step(i, 1);
      break;
    case 'ArrowLeft':
      if (n && n.children.length && props.expanded.has(n.path)) emit('toggle', n.path);
      else if (n?.parent !== null && n?.parent !== undefined) emit('select', n.parent);
      break;
    case 'Enter': if (n && !off(n)) emit('activate', n.path); break;
    default: return;
  }
  e.preventDefault();
}

function pick(n: FolderNode) {
  if (!off(n)) emit('select', n.path);
}

watch(() => props.selected, async () => {
  await nextTick();
  document.getElementById(rowId(current.value))?.scrollIntoView({ block: 'nearest' });
});
</script>

<template>
  <div class="tree" role="tree" tabindex="0" :aria-label="label" :aria-activedescendant="current >= 0 ? rowId(current) : undefined" @keydown="onKey">
    <div
      v-for="(r, i) in rows"
      :id="rowId(i)"
      :key="r.node.path"
      v-context="() => menu?.(r.node)"
      class="tr"
      :class="{ on: r.node.path === selected, off: off(r.node) }"
      role="treeitem"
      :aria-level="r.depth + 1"
      :aria-expanded="r.node.children.length ? expanded.has(r.node.path) : undefined"
      :aria-selected="r.node.path === selected"
      :aria-disabled="off(r.node) || undefined"
      :style="{ paddingLeft: 6 + r.depth * 16 + 'px' }"
      @click="pick(r.node)"
      @dblclick="!off(r.node) && emit('activate', r.node.path)"
    >
      <button v-if="r.node.children.length" class="chev" tabindex="-1" :class="{ open: expanded.has(r.node.path) }" :aria-label="expanded.has(r.node.path) ? 'Collapse' : 'Expand'" @click.stop="emit('toggle', r.node.path)">
        <Icon name="chevron-right" :size="14" />
      </button>
      <span v-else class="chev"></span>
      <Icon :name="r.node.path === selected || expanded.has(r.node.path) ? 'folder-open' : 'folder'" :size="17" class="fi" />
      <span class="nm">{{ r.node.name }}</span>
      <span v-if="counts" class="ct num" :title="`${r.node.total} documents`">{{ r.node.total }}</span>
    </div>
  </div>
</template>

<style scoped>
.tree { padding: 6px; min-height: 100%; }
.tr { display: flex; align-items: center; gap: 6px; height: 32px; padding-right: 8px; border-radius: var(--radius-s); color: var(--text); }
.tr:hover { background: var(--hover); }
.tr.on { background: var(--accent-soft); color: var(--accent); font-weight: 550; }
.tr.off { color: var(--faint); }
.tr.off:hover { background: none; }
.chev { width: 18px; height: 18px; flex: none; display: grid; place-items: center; border-radius: 5px; color: var(--muted); }
button.chev:hover { background: var(--hover); color: var(--text); }
.chev svg { transition: transform 0.12s; }
.chev.open svg { transform: rotate(90deg); }
.fi { flex: none; color: var(--accent); }
.tr.off .fi { color: var(--faint); }
.nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct { flex: none; font-size: 12px; color: var(--faint); font-weight: 400; }
.tr.on .ct { color: inherit; opacity: 0.8; }
.tree:focus-visible { outline-offset: -2px; }
</style>
