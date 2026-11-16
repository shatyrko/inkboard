<script setup lang="ts">
// The reader's library: a folder tree on the left, a sortable table of the folder (or of search results) on the right.
// Everything here is permanent on the reader, so deletes are explained and confirmed (see library/actions.ts).
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import Icon from '../components/Icon.vue';
import OfflineState from '../components/OfflineState.vue';
import PageBar from '../components/PageBar.vue';
import { onFilesDropped } from '../lib/api';
import { menu, type MenuItem } from '../lib/contextmenu';
import { fmtBytes } from '../lib/format';
import { app } from '../lib/store';
import type { Entry } from '../lib/types';
import { dialog, notify } from '../lib/ui';
import { createActions } from './library/actions';
import FileTable from './library/FileTable.vue';
import FolderPicker from './library/FolderPicker.vue';
import FolderTree from './library/FolderTree.vue';
import { entriesIn, searchEntries, sortEntries, type SortDir, type SortKey } from './library/listing';
import { ROOT, parentPath, trail } from './library/paths';
import { clickSelect, emptySelection, moveSelect, prune, selectAll, type Selection } from './library/selection';
import TransferPanel from './library/TransferPanel.vue';
import { reveal, type FolderNode } from './library/tree';
import { useLibrary } from './library/useLibrary';
import { useTransfers } from './library/useTransfers';
import { useDelayed } from './shared/delayed';
import { plural, words } from './shared/text';

const lib = useLibrary();
const { entries, loaded, error, tree } = lib;
const transfers = useTransfers();
const online = computed(() => !!app.conn?.connected);
const spin = useDelayed(computed(() => lib.loading.value && !loaded.value));

// ---------- what is shown ----------
const current = ref(ROOT);
const expanded = ref<ReadonlySet<string>>(new Set([ROOT]));
const query = ref('');
const term = ref('');
const sortKey = ref<SortKey>('name');
const sortDir = ref<SortDir>('asc');
const sel = ref<Selection>(emptySelection());
const searching = computed(() => words(term.value).length > 0);

const rows = computed(() => sortEntries(searching.value ? searchEntries(entries.value, term.value) : entriesIn(entries.value, current.value), sortKey.value, sortDir.value));
const order = computed(() => rows.value.map((r) => r.id));
const picked = computed(() => rows.value.filter((r) => sel.value.ids.has(r.id)));
const folderName = computed(() => tree.value.nodes.get(current.value)?.name ?? ROOT);

const table = ref<InstanceType<typeof FileTable> | null>(null);
const searchBox = ref<HTMLInputElement | null>(null);
const focusTable = () => table.value?.focus();

// typing filters after a short pause; clearing applies at once
let debounce: number | undefined;
watch(query, (q) => {
  window.clearTimeout(debounce);
  if (!q) term.value = '';
  else debounce = window.setTimeout(() => { term.value = q; }, 150);
});
onBeforeUnmount(() => window.clearTimeout(debounce));

watch(order, (o) => { sel.value = prune(sel.value, o); });
watch([current, term], () => {
  sel.value = emptySelection();
  table.value?.resetScroll();
});
// a folder that disappeared (deleted here or on the reader) falls back to the nearest one that is left
watch(tree, (t) => {
  if (t.nodes.has(current.value)) return;
  let p = parentPath(current.value);
  while (p && !t.nodes.has(p)) p = parentPath(p);
  current.value = p || ROOT;
});

function go(path: string) {
  query.value = '';
  term.value = '';
  current.value = path;
  expanded.value = reveal(expanded.value, path).add(path);
}
function toggleFolder(path: string) {
  const next = new Set(expanded.value);
  if (!next.delete(path)) next.add(path);
  expanded.value = next;
}
const goUp = () => { if (current.value !== ROOT && !searching.value) go(parentPath(current.value)); };

function toggleSort(key: SortKey) {
  if (key === sortKey.value) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  else { sortKey.value = key; sortDir.value = key === 'name' ? 'asc' : 'desc'; }
  nextTick(() => table.value?.scrollToId(sel.value.focus));
}

// ---------- selection ----------
const plain = { ctrl: false, shift: false };
const pick = (id: string, mods: { ctrl: boolean; shift: boolean }) => { sel.value = clickSelect(sel.value, order.value, id, mods); };
function move(delta: number, extend: boolean) {
  sel.value = moveSelect(sel.value, order.value, delta, extend);
  nextTick(() => table.value?.scrollToId(sel.value.focus));
}
const only = computed<Entry | null>(() => (picked.value.length === 1 ? picked.value[0] : null));
const selectionNote = computed(() => {
  if (!picked.value.length) return plural(rows.value.length, 'item');
  const bytes = picked.value.reduce((n, e) => n + e.size, 0);
  return `${picked.value.length} selected${bytes ? `, ${fmtBytes(bytes)}` : ''}`;
});

// ---------- actions ----------
type Request = { title: string; confirm: string; taken: ReadonlySet<string>; start: string; resolve: (n: FolderNode | null) => void };
const picker = ref<Request | null>(null);
const askFolder = (o: Omit<Request, 'resolve'>) => new Promise<FolderNode | null>((resolve) => { picker.value = { ...o, resolve }; });
function closePicker(n: FolderNode | null) {
  picker.value?.resolve(n);
  picker.value = null;
}

async function refresh() {
  await lib.load();
  if (error.value) notify(error.value, 'error');
}
const actions = createActions({ entries: () => entries.value, reload: lib.load, askFolder });

/** run an action, then hand the keyboard back to the table (dialogs do not restore focus themselves) */
async function act(fn: () => Promise<unknown>) {
  await fn();
  await nextTick();
  focusTable();
}

const folderEntry = (path: string) => entries.value.find((e) => e.kind === 'folder' && e.path === path);

async function newFolder(parent: string) {
  const path = await actions.createFolder(parent);
  const made = path && parent === current.value ? entries.value.find((e) => e.path === path) : null;
  if (made) {
    sel.value = clickSelect(emptySelection(), order.value, made.id, plain);
    nextTick(() => table.value?.scrollToId(made.id));
  }
}
function open(e: Entry) {
  if (e.kind === 'folder') go(e.path);
  else actions.openOnReader(e);
}
const openSelection = () => { if (only.value) open(only.value); };
function renameSelection() {
  if (!only.value) return;
  if (only.value.kind === 'folder') notify('Folders cannot be renamed on the reader.', 'error');
  else act(() => actions.rename(only.value!));
}
const deleteSelection = () => { if (picked.value.length) act(() => actions.remove(picked.value)); };
function deleteFolder(path: string) {
  const f = folderEntry(path);
  if (f) act(() => actions.remove([f]));
}

// ---------- menus ----------
const noDocs = (list: Entry[]) => list.some((e) => e.kind === 'folder');

function rowMenu(e: Entry): MenuItem[] {
  // a right click on a row outside the selection selects it first, so the menu always names what it will act on
  if (!sel.value.ids.has(e.id)) pick(e.id, plain);
  const list = picked.value;
  const one = list.length === 1 ? list[0] : null;
  const items: MenuItem[] = [];
  if (one?.kind === 'folder') {
    items.push(
      { label: 'Open', icon: 'folder-open', hint: 'Enter', action: () => go(one.path) },
      { label: 'Upload here...', icon: 'upload', action: () => act(() => actions.uploadFromPicker(one.path)) },
      { label: 'New folder here...', icon: 'folder-plus', action: () => act(() => newFolder(one.path)) },
    );
  } else if (!noDocs(list)) {
    items.push(
      { label: 'Open on reader', icon: 'show', hint: 'Enter', disabled: !one, action: () => open(one!) },
      { label: 'Download...', icon: 'download', action: () => act(() => actions.download(list)) },
      { separator: true },
      { label: 'Rename', icon: 'edit', hint: 'F2', disabled: !one, action: renameSelection },
      { label: 'Move to...', icon: 'move', action: () => act(() => actions.transfer(list, 'move', current.value)) },
      { label: 'Copy to...', icon: 'duplicate', action: () => act(() => actions.transfer(list, 'copy', current.value)) },
    );
  }
  if (items.length) items.push({ separator: true });
  items.push({ label: 'Delete...', icon: 'trash', hint: 'Del', danger: true, action: deleteSelection });
  return items;
}

const backgroundMenu = (): MenuItem[] => [
  { label: 'New folder...', icon: 'folder-plus', hint: 'Ctrl+Shift+N', action: () => act(() => newFolder(current.value)) },
  { label: 'Upload...', icon: 'upload', hint: 'Ctrl+U', action: () => act(() => actions.uploadFromPicker(current.value)) },
  { separator: true },
  { label: 'Select all', icon: 'checklist', hint: 'Ctrl+A', disabled: !rows.value.length, action: () => { sel.value = selectAll(order.value); focusTable(); } },
  { label: 'Refresh', icon: 'refresh', hint: 'F5', action: refresh },
];

const folderMenu = (n: FolderNode): MenuItem[] => [
  { label: 'New folder here...', icon: 'folder-plus', action: () => act(() => newFolder(n.path)) },
  { label: 'Upload here...', icon: 'upload', action: () => act(() => actions.uploadFromPicker(n.path)) },
  { separator: true },
  { label: 'Delete folder...', icon: 'trash', hint: 'Del', danger: true, disabled: n.path === ROOT || !folderEntry(n.path), action: () => deleteFolder(n.path) },
];

// ---------- keyboard ----------
function onTableKey(e: KeyboardEvent) {
  const k = e.key;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k.toLowerCase() === 'a') sel.value = selectAll(order.value);
  else if (k === 'ContextMenu' || (e.shiftKey && k === 'F10')) { e.stopPropagation(); table.value?.openMenuFor(sel.value.focus); }
  else if (ctrl) return;
  else if (k === 'ArrowDown') move(1, e.shiftKey);
  else if (k === 'ArrowUp') move(-1, e.shiftKey);
  else if (k === 'PageDown') move(table.value?.pageSize() ?? 10, e.shiftKey);
  else if (k === 'PageUp') move(-(table.value?.pageSize() ?? 10), e.shiftKey);
  else if (k === 'Home') move(-Infinity, e.shiftKey);
  else if (k === 'End') move(Infinity, e.shiftKey);
  else if (k === 'Enter') openSelection();
  else if (k === 'F2') renameSelection();
  else if (k === 'Delete') deleteSelection();
  else if (k === 'Backspace' || (e.altKey && k === 'ArrowLeft')) goUp();
  else if (k === 'Escape') { if (query.value) query.value = ''; else sel.value = emptySelection(); }
  else return;
  e.preventDefault();
}
function onTreeKey(e: KeyboardEvent) {
  if (e.key === 'Delete' && !e.ctrlKey) { e.preventDefault(); deleteFolder(current.value); }
}
function onSearchKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    if (query.value) query.value = '';
    else focusTable();
  } else if (e.key === 'ArrowDown' && rows.value.length) {
    e.preventDefault();
    focusTable();
    if (!sel.value.ids.size) move(1, false);
  }
}
const busy = () => !!dialog.current || menu.open || !!picker.value;
function onWindowKey(e: KeyboardEvent) {
  if (busy() || !online.value || !loaded.value) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && !e.shiftKey && k === 'f') { e.preventDefault(); searchBox.value?.focus(); searchBox.value?.select(); }
  else if (ctrl && !e.shiftKey && k === 'u') { e.preventDefault(); act(() => actions.uploadFromPicker(current.value)); }
  else if (ctrl && e.shiftKey && k === 'n') { e.preventDefault(); act(() => newFolder(current.value)); }
  else if (e.key === 'F5' || (ctrl && k === 'r')) { e.preventDefault(); refresh(); }
}

// ---------- files dropped on the window ----------
const dragging = ref(false);
let offDrop: (() => void) | undefined;
let shown = false;
onActivated(async () => {
  shown = true;
  window.addEventListener('keydown', onWindowKey);
  if (online.value) lib.load();
  const off = await onFilesDropped({
    enter: () => { dragging.value = online.value; },
    leave: () => { dragging.value = false; },
    drop: (paths) => {
      if (!online.value) notify('The reader is not connected.', 'error');
      else if (!busy()) act(() => actions.upload(paths, current.value));
    },
  });
  if (shown && !offDrop) offDrop = off;
  else off();
});
onDeactivated(() => {
  shown = false;
  window.removeEventListener('keydown', onWindowKey);
  offDrop?.();
  offDrop = undefined;
  dragging.value = false;
});
watch(online, (on) => { if (on) lib.load(); });
</script>

<template>
  <section class="view lib">
    <PageBar title="Library" :count="loaded ? plural(tree.root.total, 'document') : null">
      <div class="search">
        <Icon name="search" :size="16" />
        <input ref="searchBox" v-model="query" class="input selectable" placeholder="Search the library" aria-label="Search the library" title="Search (Ctrl+F)" autocomplete="off" spellcheck="false" @keydown="onSearchKey" />
        <button v-if="query" class="clear" aria-label="Clear search" title="Clear search (Esc)" @click="query = ''; searchBox?.focus()"><Icon name="x" :size="14" /></button>
      </div>
      <template v-if="online">
        <button class="btn ghost icon" aria-label="Refresh" title="Refresh (F5)" @click="refresh"><Icon name="refresh" :size="18" /></button>
        <button class="btn ghost icon" aria-label="New folder" title="New folder (Ctrl+Shift+N)" @click="act(() => newFolder(current))"><Icon name="folder-plus" :size="18" /></button>
        <button class="btn primary" title="Upload PDF files (Ctrl+U)" @click="act(() => actions.uploadFromPicker(current))"><Icon name="upload" :size="16" />Upload</button>
      </template>
    </PageBar>

    <OfflineState v-if="!online" />

    <div v-else-if="!loaded" class="empty">
      <template v-if="error">
        <div class="tile"><Icon name="warn" :size="28" /></div>
        <h2>Could not read the library</h2>
        <p class="selectable">{{ error }}</p>
        <button class="btn primary" @click="refresh"><Icon name="refresh" :size="16" />Try again</button>
      </template>
      <span v-else-if="spin" class="spinner"></span>
    </div>

    <div v-else class="body">
      <aside class="side-pane">
        <FolderTree
          label="Folders"
          counts
          :root="tree.root"
          :selected="current"
          :expanded="expanded"
          :menu="folderMenu"
          @select="go"
          @toggle="toggleFolder"
          @activate="focusTable"
          @keydown="onTreeKey"
        />
      </aside>

      <div v-context="backgroundMenu" class="list-pane">
        <div class="crumbs">
          <template v-if="searching">
            <Icon name="search" :size="15" />
            <span class="here">Results for "{{ term }}" in the whole library</span>
            <button class="crumb" @click="query = ''">Clear search</button>
          </template>
          <template v-else>
            <template v-for="(c, i) in trail(current)" :key="c.path">
              <Icon v-if="i" name="chevron-right" :size="13" class="sep" />
              <button class="crumb" :class="{ here: c.path === current }" :aria-current="c.path === current ? 'location' : undefined" @click="go(c.path)">{{ c.name }}</button>
            </template>
          </template>
          <span class="grow"></span>
          <span class="note num">{{ selectionNote }}</span>
        </div>

        <FileTable
          v-if="rows.length"
          ref="table"
          :rows="rows"
          :selected="sel.ids"
          :focus-id="sel.focus"
          :sort-key="sortKey"
          :sort-dir="sortDir"
          :show-folder="searching"
          :nodes="tree.nodes"
          :row-menu="rowMenu"
          @pick="pick"
          @open="open"
          @sort="toggleSort"
          @keydown="onTableKey"
        />
        <div v-else class="empty">
          <template v-if="searching">
            <div class="tile"><Icon name="search" :size="28" /></div>
            <h2>No matches</h2>
            <p>Nothing in the library matches "{{ term }}". Try fewer words.</p>
            <button class="btn" @click="query = ''; searchBox?.focus()">Clear search</button>
          </template>
          <template v-else>
            <div class="tile"><Icon name="folder-open" :size="28" /></div>
            <h2>Nothing here yet</h2>
            <p>Drop PDF files here or press Upload. The reader only opens PDF.</p>
            <button class="btn primary" @click="act(() => actions.uploadFromPicker(current))"><Icon name="upload" :size="16" />Upload<kbd>Ctrl+U</kbd></button>
          </template>
        </div>
      </div>
    </div>

    <TransferPanel :items="transfers.items.value" @dismiss="transfers.dismiss" />
    <div v-if="dragging" class="drop-hint">Drop PDF files to upload them to {{ folderName }}</div>

    <FolderPicker
      v-if="picker"
      :title="picker.title"
      :confirm="picker.confirm"
      :root="tree.root"
      :nodes="tree.nodes"
      :taken="picker.taken"
      :start="picker.start"
      @pick="closePicker"
      @close="closePicker(null)"
    />
  </section>
</template>

<style scoped>
.lib { position: relative; }
.lib :deep(.bar-count) { flex: none; white-space: nowrap; }
.search { position: relative; flex: 0 1 240px; min-width: 120px; display: flex; align-items: center; }
.search > svg { position: absolute; left: 10px; color: var(--faint); pointer-events: none; }
.search .input { padding-left: 32px; padding-right: 30px; }
.clear { position: absolute; right: 4px; width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; color: var(--muted); }
.clear:hover { background: var(--hover); color: var(--text); }

.body { flex: 1; min-height: 0; display: grid; grid-template-columns: 240px minmax(0, 1fr); }
.side-pane { min-height: 0; overflow: auto; background: var(--panel); border-right: 1px solid var(--border); }
.list-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.list-pane > .empty { flex: 1; }

.crumbs { height: 40px; flex: none; display: flex; align-items: center; gap: 4px; padding: 0 14px 0 10px; border-bottom: 1px solid var(--border); color: var(--muted); }
.crumb { height: 26px; padding: 0 8px; border-radius: 6px; color: var(--muted); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crumb:hover { background: var(--hover); color: var(--text); }
.crumb.here { color: var(--text); font-weight: 550; }
.here { color: var(--text); }
.sep { color: var(--faint); flex: none; }
.note { font-size: 12px; color: var(--faint); white-space: nowrap; }
.list-pane :deep(.ft) { flex: 1; }
</style>
