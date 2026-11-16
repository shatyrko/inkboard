<script setup lang="ts">
// The file manager of a USB reader (an Android e-reader over MTP): folders are listed one level at a time by handle, so a
// device with thousands of files opens at once. Everything that changes the reader is permanent and explained first.
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import Icon from '../../components/Icon.vue';
import PageBar from '../../components/PageBar.vue';
import UsbOffline from '../../components/UsbOffline.vue';
import { api, onFilesDropped } from '../../lib/api';
import { menu, type MenuItem } from '../../lib/contextmenu';
import { fmtBytes } from '../../lib/format';
import { activeReader } from '../../lib/store';
import type { MtpEntry, MtpStatus } from '../../lib/types';
import { dialog, notify } from '../../lib/ui';
import { clickSelect, emptySelection, moveSelect, prune, selectAll, type Selection } from '../library/selection';
import TransferPanel from '../library/TransferPanel.vue';
import { useTransfers } from '../library/useTransfers';
import { useDelayed } from '../shared/delayed';
import { plural, words } from '../shared/text';
import { createActions, type MoveTarget } from './actions';
import { filterEntries, sortEntries, type MtpSortKey, type SortDir } from './listing';
import MtpFolderPicker from './MtpFolderPicker.vue';
import MtpTable from './MtpTable.vue';
import { currentHandle, enterFolder, goTo, goUp, startStack, type Crumb } from './nav';

const reader = computed(() => activeReader());
const readerId = computed(() => reader.value?.id ?? '');
const online = computed(() => !!reader.value?.connected);
const transfers = useTransfers();

// ---------- the reader and where we are in it ----------
const status = ref<MtpStatus | null>(null);
const storageId = ref<number | null>(null);
const stack = ref<Crumb[]>([]);
const entries = ref<MtpEntry[]>([]);
const loading = ref(false);
const listed = ref(false);
const error = ref('');
const spin = useDelayed(computed(() => loading.value && !listed.value));

const atRoot = computed(() => stack.value.length <= 1);

const query = ref('');
const term = ref('');
const sortKey = ref<MtpSortKey>('name');
const sortDir = ref<SortDir>('asc');
const sel = ref<Selection>(emptySelection());
const searching = computed(() => words(term.value).length > 0);

const rows = computed(() => sortEntries(filterEntries(entries.value, term.value), sortKey.value, sortDir.value));
const order = computed(() => rows.value.map((r) => String(r.handle)));
const picked = computed(() => rows.value.filter((r) => sel.value.ids.has(String(r.handle))));
const only = computed<MtpEntry | null>(() => (picked.value.length === 1 ? picked.value[0] : null));
const books = computed(() => (atRoot.value ? entries.value.find((e) => e.kind === 'folder' && e.name.toLowerCase() === 'books') : undefined));
const selectionNote = computed(() => {
  if (!picked.value.length) return plural(rows.value.length, 'item');
  const bytes = picked.value.reduce((n, e) => n + (e.kind === 'file' ? e.size : 0), 0);
  return `${picked.value.length} selected${bytes ? `, ${fmtBytes(bytes)}` : ''}`;
});

const table = ref<InstanceType<typeof MtpTable> | null>(null);
const searchBox = ref<HTMLInputElement | null>(null);
const focusTable = () => table.value?.focus();

let debounce: number | undefined;
watch(query, (q) => {
  window.clearTimeout(debounce);
  if (!q) term.value = '';
  else debounce = window.setTimeout(() => { term.value = q; }, 150);
});
onBeforeUnmount(() => window.clearTimeout(debounce));
watch(order, (o) => { sel.value = prune(sel.value, o); });

let seq = 0;
/** lists the folder being looked at; a slower answer for a folder we already left is dropped */
async function listFolder(): Promise<void> {
  const id = readerId.value;
  if (!id || storageId.value === null) return;
  const mine = ++seq;
  loading.value = true;
  try {
    const list = await api.mtpList(id, storageId.value, currentHandle(stack.value));
    if (mine !== seq) return;
    entries.value = list;
    error.value = '';
    listed.value = true;
  } catch (e) {
    if (mine !== seq) return;
    entries.value = [];
    error.value = typeof e === 'string' ? e : (e as Error)?.message || 'Could not read the folder.';
  } finally {
    if (mine === seq) loading.value = false;
  }
}

function forget() {
  seq++;
  status.value = null;
  storageId.value = null;
  stack.value = [];
  entries.value = [];
  listed.value = false;
  error.value = '';
  query.value = '';
  term.value = '';
  sel.value = emptySelection();
}

/** reads the storages, then the folder: first time, after a reconnect, and when the shown reader changes */
async function init(): Promise<void> {
  if (!readerId.value || !online.value) return;
  try {
    status.value = await api.mtpStatus(readerId.value);
  } catch (e) {
    error.value = typeof e === 'string' ? e : (e as Error)?.message || 'Could not read the reader.';
    return;
  }
  const s = status.value.storages.find((x) => x.id === storageId.value) ?? status.value.storages[0];
  if (!s) { error.value = 'This reader has no storage to show.'; return; }
  if (s.id !== storageId.value || !stack.value.length) {
    storageId.value = s.id;
    stack.value = startStack(s.name);
  }
  await listFolder();
}

function leaveFolder() {
  query.value = '';
  term.value = '';
  sel.value = emptySelection();
  table.value?.resetScroll();
}
function navigate(next: Crumb[]) {
  stack.value = next;
  leaveFolder();
  listFolder();
}
const open = (e: MtpEntry) => { if (e.kind === 'folder') navigate(enterFolder(stack.value, e)); };
const goUpLevel = () => { if (!atRoot.value) navigate(goUp(stack.value)); };
const goToCrumb = (i: number) => { if (i < stack.value.length - 1) navigate(goTo(stack.value, i)); };
function chooseStorage(id: number) {
  const s = status.value?.storages.find((x) => x.id === id);
  if (!s || id === storageId.value) return;
  storageId.value = id;
  navigate(startStack(s.name));
}
function toggleSort(key: MtpSortKey) {
  if (key === sortKey.value) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  else { sortKey.value = key; sortDir.value = key === 'name' ? 'asc' : 'desc'; }
  nextTick(() => table.value?.scrollToId(sel.value.focus));
}
async function refresh() {
  await listFolder();
  if (error.value) notify(error.value, 'error');
}

// ---------- selection ----------
const plain = { ctrl: false, shift: false };
const pick = (id: string, mods: { ctrl: boolean; shift: boolean }) => { sel.value = clickSelect(sel.value, order.value, id, mods); };
function move(delta: number, extend: boolean) {
  sel.value = moveSelect(sel.value, order.value, delta, extend);
  nextTick(() => table.value?.scrollToId(sel.value.focus));
}

// ---------- actions ----------
type Request = { moving: MtpEntry[]; resolve: (t: MoveTarget | null) => void };
const picker = ref<Request | null>(null);
const askFolder = (moving: MtpEntry[]) => new Promise<MoveTarget | null>((resolve) => { picker.value = { moving, resolve }; });
function closePicker(t: MoveTarget | null) {
  picker.value?.resolve(t);
  picker.value = null;
}

const actions = createActions({
  readerId: () => readerId.value,
  storage: () => storageId.value ?? 0,
  stack: () => stack.value,
  entries: () => entries.value,
  reload: listFolder,
  askFolder,
});

/** run an action, then hand the keyboard back to the table (dialogs do not restore focus themselves) */
async function act(fn: () => Promise<unknown>) {
  await fn();
  await nextTick();
  focusTable();
}
async function newFolder() {
  const handle = await actions.newFolder();
  const made = handle === null ? null : entries.value.find((e) => e.handle === handle);
  if (made) {
    sel.value = clickSelect(emptySelection(), order.value, String(made.handle), plain);
    nextTick(() => table.value?.scrollToId(String(made.handle)));
  }
}
const deleteSelection = () => { if (picked.value.length) act(() => actions.remove(picked.value)); };
const renameSelection = () => { if (only.value) act(() => actions.rename(only.value!)); };
const moveSelection = () => { if (picked.value.length) act(() => actions.move(picked.value)); };
const openSelection = () => { if (only.value) open(only.value); };

// ---------- menus ----------
function rowMenu(e: MtpEntry): MenuItem[] {
  // a right click on a row outside the selection selects it first, so the menu always names what it will act on
  if (!sel.value.ids.has(String(e.handle))) pick(String(e.handle), plain);
  const list = picked.value;
  const one = list.length === 1 ? list[0] : null;
  const files = list.every((x) => x.kind === 'file');
  const items: MenuItem[] = [];
  if (one?.kind === 'folder') items.push({ label: 'Open', icon: 'folder-open', hint: 'Enter', action: () => open(one) });
  if (files) items.push({ label: 'Download...', icon: 'download', action: () => act(() => actions.download(list)) });
  if (items.length) items.push({ separator: true });
  items.push(
    { label: 'Rename', icon: 'edit', hint: 'F2', disabled: !one, action: renameSelection },
    { label: 'Move to...', icon: 'move', action: moveSelection },
    { separator: true },
    { label: 'Delete...', icon: 'trash', hint: 'Del', danger: true, action: deleteSelection },
  );
  return items;
}
const backgroundMenu = (): MenuItem[] => [
  { label: 'New folder...', icon: 'folder-plus', hint: 'Ctrl+Shift+N', action: () => act(newFolder) },
  { label: 'Upload...', icon: 'upload', hint: 'Ctrl+U', action: () => act(actions.uploadFromPicker) },
  { separator: true },
  ...(atRoot.value ? [] : [{ label: 'Up one level', icon: 'folder-up', hint: 'Backspace', action: goUpLevel }]),
  { label: 'Select all', icon: 'checklist', hint: 'Ctrl+A', disabled: !rows.value.length, action: () => { sel.value = selectAll(order.value); focusTable(); } },
  { label: 'Refresh', icon: 'refresh', hint: 'F5', action: refresh },
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
  else if (k === 'Backspace' || (e.altKey && k === 'ArrowLeft')) goUpLevel();
  else if (k === 'Escape') { if (query.value) query.value = ''; else sel.value = emptySelection(); }
  else return;
  e.preventDefault();
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
  if (busy() || !online.value || storageId.value === null) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && !e.shiftKey && k === 'f') { e.preventDefault(); searchBox.value?.focus(); searchBox.value?.select(); }
  else if (ctrl && !e.shiftKey && k === 'u') { e.preventDefault(); act(actions.uploadFromPicker); }
  else if (ctrl && e.shiftKey && k === 'n') { e.preventDefault(); act(newFolder); }
  else if (e.key === 'F5' || (ctrl && k === 'r')) { e.preventDefault(); refresh(); }
}

// ---------- files dropped on the window ----------
const dragging = ref(false);
let offDrop: (() => void) | undefined;
let shown = false;
onActivated(async () => {
  shown = true;
  window.addEventListener('keydown', onWindowKey);
  if (online.value) { if (status.value) listFolder(); else init(); }
  const off = await onFilesDropped({
    enter: () => { dragging.value = online.value && storageId.value !== null; },
    leave: () => { dragging.value = false; },
    drop: (paths) => {
      if (!online.value) notify('The reader is not connected.', 'error');
      else if (!busy()) act(() => actions.upload(paths));
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
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKey));

// another reader, or the same one plugged back in
watch(readerId, () => { forget(); if (online.value) init(); });
// folder handles do not outlive the connection: after a replug everything is listed again from the top
watch(online, (on) => { if (on) { forget(); init(); } });
const where = computed(() => stack.value[stack.value.length - 1]?.name ?? '');
const storages = computed(() => status.value?.storages ?? []);
const pickerTitle = computed(() => {
  const m = picker.value?.moving ?? [];
  return m.length === 1 ? `Move "${m[0].name}" to...` : `Move ${m.length} items to...`;
});
</script>

<template>
  <section class="view mtp">
    <PageBar title="Files" :count="online && listed ? plural(entries.length, 'item') : null">
      <div v-if="online && storageId !== null" class="search">
        <Icon name="search" :size="16" />
        <input ref="searchBox" v-model="query" class="input selectable" placeholder="Search this folder" aria-label="Search this folder" title="Search (Ctrl+F)" autocomplete="off" spellcheck="false" @keydown="onSearchKey" />
        <button v-if="query" class="clear" aria-label="Clear search" title="Clear search (Esc)" @click="query = ''; searchBox?.focus()"><Icon name="x" :size="14" /></button>
      </div>
      <template v-if="online && storageId !== null">
        <button class="btn ghost icon" aria-label="Refresh" title="Refresh (F5)" @click="refresh"><Icon name="refresh" :size="18" /></button>
        <button class="btn ghost icon" aria-label="New folder" title="New folder (Ctrl+Shift+N)" @click="act(newFolder)"><Icon name="folder-plus" :size="18" /></button>
        <button class="btn primary" title="Upload files (Ctrl+U)" @click="act(actions.uploadFromPicker)"><Icon name="upload" :size="16" />Upload</button>
      </template>
    </PageBar>

    <UsbOffline v-if="!online" :reason="error" />

    <div v-else-if="storageId === null" class="empty">
      <template v-if="error">
        <div class="tile"><Icon name="warn" :size="28" /></div>
        <h2>Could not read the reader</h2>
        <p class="selectable">{{ error }}</p>
        <button class="btn primary" @click="init"><Icon name="refresh" :size="16" />Try again</button>
      </template>
      <span v-else class="spinner"></span>
    </div>

    <div v-else v-context="backgroundMenu" class="body">
      <div class="crumbs">
        <select v-if="storages.length > 1" class="select store" aria-label="Storage" :value="storageId" @change="chooseStorage(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="s in storages" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <template v-for="(c, i) in stack" :key="i">
          <Icon v-if="i" name="chevron-right" :size="13" class="sep" />
          <button v-if="i > 0 || storages.length <= 1" class="crumb" :class="{ here: i === stack.length - 1 }" :aria-current="i === stack.length - 1 ? 'location' : undefined" @click="goToCrumb(i)">{{ c.name }}</button>
        </template>
        <span class="grow"></span>
        <span class="note num">{{ selectionNote }}</span>
      </div>

      <p v-if="books && !searching" class="tip">
        <Icon name="book" :size="16" />
        <span>This reader opens EPUB, PDF, FB2, MOBI, CBZ and more as they are, so books need no conversion. Any folder works; <button class="link" @click="open(books)">Books</button> is the usual place.</span>
      </p>

      <MtpTable
        v-if="rows.length"
        ref="table"
        :rows="rows"
        :selected="sel.ids"
        :focus-id="sel.focus"
        :sort-key="sortKey"
        :sort-dir="sortDir"
        :row-menu="rowMenu"
        @pick="pick"
        @open="open"
        @sort="toggleSort"
        @keydown="onTableKey"
      />
      <div v-else-if="error" class="empty">
        <div class="tile"><Icon name="warn" :size="28" /></div>
        <h2>Could not read this folder</h2>
        <p class="selectable">{{ error }}</p>
        <button class="btn primary" @click="refresh"><Icon name="refresh" :size="16" />Try again</button>
        <button v-if="!atRoot" class="btn" @click="navigate(goTo(stack, 0))"><Icon name="folder-up" :size="16" />Go to the top</button>
      </div>
      <div v-else-if="loading && !listed && spin" class="empty"><span class="spinner"></span></div>
      <div v-else-if="loading" class="empty"></div>
      <div v-else class="empty">
        <template v-if="searching">
          <div class="tile"><Icon name="search" :size="28" /></div>
          <h2>No matches</h2>
          <p>Nothing in this folder matches "{{ term }}". Try fewer words.</p>
          <button class="btn" @click="query = ''; searchBox?.focus()">Clear search</button>
        </template>
        <template v-else>
          <div class="tile"><Icon name="folder-open" :size="28" /></div>
          <h2>Nothing here yet</h2>
          <p>Drop files here or press Upload. "{{ where }}" is empty.</p>
          <button class="btn primary" @click="act(actions.uploadFromPicker)"><Icon name="upload" :size="16" />Upload<kbd>Ctrl+U</kbd></button>
        </template>
      </div>
    </div>

    <TransferPanel :items="transfers.items.value" @dismiss="transfers.dismiss" />
    <div v-if="dragging" class="drop-hint">Drop files to upload them to {{ where }}</div>

    <MtpFolderPicker
      v-if="picker && storageId !== null"
      :title="pickerTitle"
      :reader-id="readerId"
      :storage="storageId"
      :start="stack"
      :moving="picker.moving"
      @pick="closePicker"
      @close="closePicker(null)"
    />
  </section>
</template>

<style scoped>
.mtp { position: relative; }
.mtp :deep(.bar-count) { flex: none; white-space: nowrap; }
.search { position: relative; flex: 0 1 240px; min-width: 120px; display: flex; align-items: center; }
.search > svg { position: absolute; left: 10px; color: var(--faint); pointer-events: none; }
.search .input { padding-left: 32px; padding-right: 30px; }
.clear { position: absolute; right: 4px; width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; color: var(--muted); }
.clear:hover { background: var(--hover); color: var(--text); }

.body { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
.body > .empty { flex: 1; }
.body :deep(.ft) { flex: 1; }
.crumbs { min-height: 40px; flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; padding: 4px 14px 4px 10px; border-bottom: 1px solid var(--border); color: var(--muted); }
.store { width: auto; height: 28px; min-width: 150px; margin-right: 4px; }
.crumb { height: 26px; padding: 0 8px; border-radius: 6px; color: var(--muted); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crumb:hover { background: var(--hover); color: var(--text); }
.crumb.here { color: var(--text); font-weight: 550; }
.sep { color: var(--faint); flex: none; }
.note { font-size: 12px; color: var(--faint); white-space: nowrap; }
.tip { display: flex; align-items: flex-start; gap: 10px; margin: 0; padding: 9px 16px; border-bottom: 1px solid var(--border); background: var(--accent-soft); color: var(--text); font-size: 13px; }
.tip svg { color: var(--accent); flex: none; margin-top: 2px; }
.link { color: var(--accent); font-weight: 550; border-radius: 4px; }
.link:hover { text-decoration: underline; }
</style>
