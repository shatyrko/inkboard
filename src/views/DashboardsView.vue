<script setup lang="ts">
// Dashboards: compose pages out of widgets, see them rendered exactly as the reader will, and push them to the reader.
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import Icon from '../components/Icon.vue';
import PageBar from '../components/PageBar.vue';
import { menu, type MenuItem } from '../lib/contextmenu';
import { app, connectNow } from '../lib/store';
import type { DashboardSummary } from '../lib/types';
import { askDialog, attempt, chooseDialog, confirmDialog, dialog, notify } from '../lib/ui';
import DashboardList from '../dashboard/DashboardList.vue';
import { hasClipboard, useEditor } from '../dashboard/editor';
import { commandForKey, type Command } from '../dashboard/keys';
import { byName, createFromSample, deleteDashboard, duplicateDashboard, listDashboards, loadDashboard, saveDashboard } from '../dashboard/library';
import type { Widget, WidgetType } from '../dashboard/model';
import PageTabs from '../dashboard/PageTabs.vue';
import { usePreviewData } from '../dashboard/preview-data';
import PropsPanel from '../dashboard/PropsPanel.vue';
import { background } from '../dashboard/background';
import { usePushing } from '../dashboard/pushing';
import ReaderPanel from '../dashboard/ReaderPanel.vue';
import { useReaderPanel } from '../dashboard/useReaderPanel';
import { sourceOf } from '../dashboard/render';
import { SAMPLES } from '../dashboard/samples';
import StageCanvas from '../dashboard/StageCanvas.vue';
import WidgetPalette from '../dashboard/WidgetPalette.vue';
import { registry } from '../dashboard/widgets';

const LAST_KEY = 'inkboard.dashboard.last';
const LIST_KEY = 'inkboard.dashboard.list';

function readStore(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage can be unavailable */ }
}

const entries = ref<DashboardSummary[]>([]);
const loading = ref(true);
// A narrow window gets the editor first: below this width the dashboard list is hidden until it is opened on purpose.
// The remembered choice only counts in a window that is wide enough for the list to make sense.
const LIST_MIN_WINDOW = 1180;
const windowWidth = ref(window.innerWidth);
const storedList = readStore(LIST_KEY);
const chosenList = ref<boolean | null>(storedList !== null && window.innerWidth >= LIST_MIN_WINDOW ? storedList === '1' : null);
const listOpen = computed(() => chosenList.value ?? windowWidth.value >= LIST_MIN_WINDOW);
function toggleList() {
  chosenList.value = !listOpen.value;
  writeStore(LIST_KEY, chosenList.value ? '1' : '0');
}
const onResize = () => { windowWidth.value = window.innerWidth; };
const grid = ref(true);
const zoom = ref<number | 'fit'>('fit');
const scale = ref(1);
const stage = ref<InstanceType<typeof StageCanvas> | null>(null);
const addButton = ref<HTMLElement | null>(null);
const palette = ref<{ x: number; y: number; at?: { x: number; y: number } } | null>(null);
let paletteReturn: HTMLElement | null = null;

// every dashboard is kept in memory by the background module, which also runs the automatic pushes
const docs = background.docs;

// ---------- the open dashboard ----------
function upsertEntry(d: { id: string; name: string; updated: string }) {
  const next = entries.value.filter((e) => e.id !== d.id);
  next.push({ id: d.id, name: d.name, updated: d.updated });
  entries.value = next.sort(byName);
}

const ed = useEditor(async (d) => upsertEntry(await saveDashboard(d)));
const { doc, page, pageIndex, selected, selectedId, saveState } = ed;

const preview = usePreviewData(() => app.settings?.allowCommands ?? false);
const { busy, busyText, publish, exportPdf, scheduleText } = usePushing({ open: doc, flush: () => ed.flush() });
const reader = useReaderPanel({ hasDoc: computed(() => !!doc.value), selectedId });
const { on: readerOn, side, work, wide, bind: readerBind } = reader;

let previewTimer: ReturnType<typeof setTimeout> | undefined;
watch(doc, (d) => {
  if (!d) return;
  background.put(d);
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void preview.load(d), 200);
});

async function openDashboard(id: string) {
  if (doc.value?.id === id) return;
  await ed.flush();
  const d = docs.get(id) ?? (await attempt(() => loadDashboard(id), 'Could not open the dashboard'));
  if (!d) return;
  background.put(d);
  ed.open(d);
  writeStore(LAST_KEY, id);
  void preview.load(d, { force: true });
}

async function refreshList() {
  entries.value = (await attempt(listDashboards, 'Could not list the dashboards')) ?? [];
  await attempt(() => background.ensureLoaded(), 'Could not read the dashboards');
}

// ---------- dashboard list actions ----------
async function createDashboard() {
  const choice = await chooseDialog({
    title: 'New dashboard',
    body: 'Daily has a clock, calendar, countdown and a checklist. Computer status shows meters for this computer and the reader.',
    buttons: SAMPLES.map((s) => ({ label: s.label, value: s.id, kind: s.id === 'blank' ? 'plain' : 'primary' })),
  });
  const sample = SAMPLES.find((s) => s.id === choice);
  if (!sample) return;
  await ed.flush();
  const d = await attempt(() => createFromSample(sample, entries.value.map((e) => e.name)), 'Could not create the dashboard');
  if (!d) return;
  upsertEntry(d);
  background.put(d);
  ed.open(d);
  writeStore(LAST_KEY, d.id);
  void preview.load(d, { force: true });
}

async function renameDashboard(id: string) {
  const current = entries.value.find((e) => e.id === id);
  if (!current) return;
  const name = (await askDialog({ title: 'Rename dashboard', label: 'Name', value: current.name, confirm: 'Rename' }))?.trim();
  if (!name || name === current.name) return;
  if (doc.value?.id === id) { ed.rename(name); await ed.flush(); return; }
  const d = docs.get(id);
  if (!d) return;
  const saved = await attempt(() => saveDashboard({ ...d, name }), 'Could not rename the dashboard');
  if (saved) { background.put(saved); upsertEntry(saved); }
}

async function copyDashboard(id: string) {
  if (doc.value?.id === id) await ed.flush();
  const src = docs.get(id);
  if (!src) return;
  const d = await attempt(() => duplicateDashboard(src, entries.value.map((e) => e.name)), 'Could not duplicate the dashboard');
  if (!d) return;
  upsertEntry(d);
  background.put(d);
  await openDashboard(d.id);
}

async function removeDashboard(id: string) {
  const entry = entries.value.find((e) => e.id === id);
  if (!entry) return;
  const yes = await confirmDialog({
    title: `Delete "${entry.name}"?`,
    body: 'The dashboard and all of its pages are deleted for good and cannot be restored. A copy already on the reader stays there.',
    confirm: 'Delete dashboard',
    danger: true,
  });
  if (!yes) return;
  const deleted = await attempt(async () => { await deleteDashboard(id); return true; }, 'Could not delete the dashboard');
  if (!deleted) return;
  if (doc.value?.id === id) ed.close();
  background.remove(id);
  entries.value = entries.value.filter((e) => e.id !== id);
  if (!doc.value && entries.value.length) await openDashboard(entries.value[0].id);
}

// ---------- pages ----------
async function renamePageDialog(id: string) {
  const current = doc.value?.pages.find((p) => p.id === id);
  if (!current) return;
  const name = (await askDialog({ title: 'Rename page', label: 'Page name', value: current.name, confirm: 'Rename' }))?.trim();
  if (name && name !== current.name) ed.renamePage(id, name);
}

function removePage(id: string) {
  const p = doc.value?.pages.find((x) => x.id === id);
  if (!p || (doc.value?.pages.length ?? 0) < 2) return;
  ed.removePage(id);
  notify(`Page "${p.name}" deleted. Press Ctrl+Z to undo.`);
}

// ---------- adding widgets ----------
function openPalette(anchor?: { x: number; y: number }, at?: { x: number; y: number }) {
  if (!doc.value) return;
  const r = addButton.value?.getBoundingClientRect();
  paletteReturn = document.activeElement as HTMLElement | null;
  palette.value = { x: anchor?.x ?? r?.left ?? 240, y: anchor?.y ?? (r ? r.bottom + 6 : 120), at };
}

function closePalette() {
  palette.value = null;
  const back = paletteReturn && paletteReturn !== document.body && paletteReturn.isConnected ? paletteReturn : null;
  paletteReturn = null;
  void nextTick(() => (back ?? stage.value)?.focus());
}

function pickWidget(type: WidgetType) {
  ed.addWidget(type, palette.value?.at);
  closePalette();
}

// ---------- context menu ----------
function stageMenu(w: Widget | null, cell: { x: number; y: number }, point: { x: number; y: number }): MenuItem[] {
  if (!w) {
    return [
      { label: 'Add widget here', icon: 'plus', hint: 'A', action: () => openPalette(point, cell) },
      { label: 'Paste', icon: 'clipboard-paste', hint: 'Ctrl+V', disabled: !hasClipboard(), action: () => ed.paste(cell) },
      { separator: true },
      { label: grid.value ? 'Hide grid' : 'Show grid', icon: 'grid', hint: 'G', action: () => (grid.value = !grid.value) },
      { label: 'Zoom to fit', icon: 'fit', hint: 'Ctrl+0', action: () => (zoom.value = 'fit') },
    ];
  }
  const manual = registry[w.type].manual;
  return [
    ...(manual ? [{ label: manual.label, icon: 'refresh', action: () => void fetchWidget(w.id) }, { separator: true }] : []),
    { label: 'Duplicate', icon: 'duplicate', hint: 'Ctrl+D', action: () => ed.duplicate() },
    { label: 'Copy', icon: 'copy', hint: 'Ctrl+C', action: () => ed.copy() },
    { label: 'Cut', icon: 'scissors', hint: 'Ctrl+X', action: () => ed.cut() },
    { separator: true },
    { label: 'Bring to front', icon: 'bring-front', hint: 'Ctrl+Shift+]', action: () => ed.reorder('front') },
    { label: 'Bring forward', icon: 'arrow-up', hint: 'Ctrl+]', action: () => ed.reorder('forward') },
    { label: 'Send backward', icon: 'arrow-down', hint: 'Ctrl+[', action: () => ed.reorder('backward') },
    { label: 'Send to back', icon: 'send-back', hint: 'Ctrl+Shift+[', action: () => ed.reorder('back') },
    { separator: true },
    { label: 'Delete', icon: 'trash', hint: 'Del', action: () => ed.remove() },
  ];
}

// ---------- live data in the preview ----------
async function fetchWidget(id: string) {
  const d = doc.value;
  const w = page.value?.widgets.find((x) => x.id === id);
  if (!d || !w) return;
  await preview.load(d, { manual: true, force: true, only: sourceOf(w)?.key });
}

async function refreshData() {
  if (!doc.value) return;
  await preview.load(doc.value, { manual: true, force: true });
  notify('Data refreshed');
}

const notes = computed(() => Object.fromEntries([...docs].map(([id, d]) => [id, d.schedule?.enabled ? `every ${d.schedule.everyMinutes} min` : ''])));
const saveLabel = computed(() => ({ saved: 'Saved', dirty: 'Unsaved changes', saving: 'Saving...', error: 'Not saved' })[saveState.value]);

// ---------- keyboard ----------
function zoomBy(dir: 'in' | 'out' | 'fit') {
  zoom.value = dir === 'fit' ? 'fit' : Math.min(1.5, Math.max(0.1, scale.value * (dir === 'in' ? 1.25 : 1 / 1.25)));
}

/** runs a shortcut; false means it did not apply (so the key keeps its normal meaning) */
function run(cmd: Command): boolean {
  const sel = selected.value;
  switch (cmd.type) {
    case 'nudge': if (!sel) return false; ed.nudge(cmd.dx, cmd.dy); return true;
    case 'resize': if (!sel) return false; ed.resizeBy(cmd.dw, cmd.dh); return true;
    case 'delete': if (!sel) return false; ed.remove(); return true;
    case 'duplicate': if (!sel) return false; ed.duplicate(); return true;
    case 'copy': if (!sel) return false; ed.copy(); return true;
    case 'cut': if (!sel) return false; ed.cut(); return true;
    case 'paste': ed.paste(); return true;
    case 'order': if (!sel) return false; ed.reorder(cmd.how); return true;
    case 'undo': ed.undo(); return true;
    case 'redo': ed.redo(); return true;
    case 'deselect': if (!selectedId.value) return false; ed.select(null); return true;
    case 'add': openPalette(); return true;
    case 'grid': grid.value = !grid.value; return true;
    case 'zoom': zoomBy(cmd.dir); return true;
    case 'publish': void publish(); return true;
    case 'export': void exportPdf(); return true;
    case 'refresh': void refreshData(); return true;
    case 'reader': reader.toggle(); return true;
    case 'readerRefresh': reader.refresh(); return true;
    case 'newPage': ed.addPage(); return true;
    case 'renamePage': if (page.value) void renamePageDialog(page.value.id); return true;
    case 'newDashboard': void createDashboard(); return true;
    case 'page': {
      const to = doc.value?.pages[pageIndex.value + cmd.delta];
      if (to) ed.selectPage(to.id);
      return !!to;
    }
  }
}

function onKey(e: KeyboardEvent) {
  // a menu, a dialog or the palette owns the keyboard while it is open
  if (dialog.current || menu.open || palette.value) return;
  const cmd = commandForKey(e);
  if (!cmd) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input:not([type=checkbox]), textarea, select, [contenteditable]')) {
    // in a field the keys are the field's; Esc leaves it, and publishing still works
    if (cmd.type === 'deselect') { target.blur(); e.preventDefault(); }
    else if (cmd.type === 'publish' || cmd.type === 'export') { run(cmd); e.preventDefault(); }
    return;
  }
  if (!doc.value && cmd.type !== 'newDashboard') return;
  if (run(cmd)) e.preventDefault();
}

const focusFirstField = () => (document.querySelector('.props input, .props textarea, .props select') as HTMLElement | null)?.focus();

// ---------- lifecycle ----------
onMounted(async () => {
  window.addEventListener('resize', onResize);
  await refreshList();
  loading.value = false;
  const last = readStore(LAST_KEY);
  const first = entries.value.find((e) => e.id === last) ?? entries.value[0];
  if (first) await openDashboard(first.id);
});
onActivated(() => {
  window.addEventListener('keydown', onKey);
  if (doc.value) void preview.load(doc.value, { force: true });
});
onDeactivated(() => {
  window.removeEventListener('keydown', onKey);
  void ed.flush();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', onResize);
  clearTimeout(previewTimer);
  void ed.flush();
});
</script>

<template>
  <section class="view dash">
    <PageBar title="Dashboards" :count="doc?.name ?? null">
      <template v-if="doc">
        <button class="save" :class="saveState" :disabled="saveState !== 'error'" :title="saveState === 'error' ? `${ed.saveError.value} Click to retry.` : saveLabel" @click="ed.flush()">
          <span v-if="saveState === 'saving'" class="spinner"></span>
          <Icon v-else :name="saveState === 'error' ? 'warn' : saveState === 'saved' ? 'ok' : 'edit'" :size="14" />
          <span>{{ saveLabel }}</span>
        </button>
        <button class="btn" title="Save as a PDF file (Ctrl+Shift+E)" aria-label="Export PDF" :disabled="!!busy" @click="exportPdf"><Icon name="file-text" :size="16" /><span class="wide">Export PDF</span></button>
        <button class="btn primary" title="Render every page and push it to the reader (Ctrl+P)" :disabled="!!busy" @click="publish">
          <span v-if="busy" class="spinner on-accent"></span><Icon v-else name="send" :size="16" />{{ busy ? busyText : 'Publish to reader' }}
        </button>
      </template>
    </PageBar>

    <div v-if="loading" class="empty"><span class="spinner"></span></div>

    <div v-else class="body">
      <DashboardList v-show="listOpen" :entries="entries" :open-id="doc?.id ?? null" :notes="notes" @open="openDashboard" @create="createDashboard" @rename="renameDashboard" @duplicate="copyDashboard" @remove="removeDashboard" />

      <div v-if="doc && page" class="editor">
        <div class="strip">
          <button class="btn ghost icon small" :title="listOpen ? 'Hide the dashboard list' : 'Show the dashboard list'" :aria-label="listOpen ? 'Hide the dashboard list' : 'Show the dashboard list'" :aria-pressed="listOpen" @click="toggleList"><Icon name="panel-left" :size="16" /></button>
          <PageTabs :pages="doc.pages" :current-id="page.id" @select="ed.selectPage" @add="ed.addPage()" @rename="renamePageDialog" @duplicate="ed.duplicatePage" @remove="removePage" @move="ed.movePage" />
          <span class="grow"></span>
          <button ref="addButton" class="btn small" title="Add a widget (A)" @click="openPalette()"><Icon name="plus" :size="14" />Add widget</button>
          <span class="sep"></span>
          <button class="btn ghost icon small" title="Undo (Ctrl+Z)" aria-label="Undo" :disabled="!ed.canUndo.value" @click="ed.undo()"><Icon name="undo" :size="16" /></button>
          <button class="btn ghost icon small" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" :disabled="!ed.canRedo.value" @click="ed.redo()"><Icon name="redo" :size="16" /></button>
          <span class="sep"></span>
          <button class="btn ghost icon small" :class="{ on: grid }" title="Show the grid (G)" aria-label="Show the grid" :aria-pressed="grid" @click="grid = !grid"><Icon name="grid" :size="16" /></button>
          <button class="btn ghost icon small" title="Zoom out (Ctrl+-)" aria-label="Zoom out" @click="zoomBy('out')"><Icon name="zoom-out" :size="16" /></button>
          <button class="btn ghost small zoom num" title="Zoom to fit (Ctrl+0)" aria-label="Zoom to fit" @click="zoomBy('fit')">{{ Math.round(scale * 100) }}%</button>
          <button class="btn ghost icon small" title="Zoom in (Ctrl++)" aria-label="Zoom in" @click="zoomBy('in')"><Icon name="zoom" :size="16" /></button>
          <button class="btn ghost icon small" title="Refresh data, including web addresses and commands (F5)" aria-label="Refresh data" @click="refreshData"><Icon name="refresh" :size="16" /></button>
          <span class="sep"></span>
          <button class="btn ghost icon small" :class="{ on: readerOn }" title="Show the reader's screen next to the page (R)" aria-label="Show the reader's screen" :aria-pressed="readerOn" @click="reader.toggle()"><Icon name="device" :size="16" /></button>
        </div>
        <div ref="work" class="work">
          <StageCanvas
            ref="stage"
            :dashboard="doc"
            :page="page"
            :page-index="pageIndex"
            :data="preview.bag.value"
            :selected-id="selectedId"
            :grid="grid"
            :zoom="zoom"
            :menu-for="stageMenu"
            @select="ed.select"
            @live="ed.liveRect"
            @end="ed.endGesture"
            @cancel="ed.cancelGesture"
            @scale="(s) => (scale = s)"
            @add="openPalette()"
            @edit="focusFirstField"
          />
          <div v-if="readerOn && wide" class="col reader-col">
            <ReaderPanel v-bind="readerBind" @refresh="reader.refresh()" @reconnect="connectNow()" @close="reader.set(false)" />
          </div>
          <div class="col side-col">
            <div v-if="readerOn && !wide" class="seg panel-switch" role="radiogroup" aria-label="Side panel">
              <button role="radio" :aria-checked="side === 'props'" :class="{ on: side === 'props' }" @click="side = 'props'">Properties</button>
              <button role="radio" :aria-checked="side === 'reader'" :class="{ on: side === 'reader' }" @click="side = 'reader'">Reader</button>
            </div>
            <ReaderPanel v-if="readerOn && !wide && side === 'reader'" v-bind="readerBind" @refresh="reader.refresh()" @reconnect="connectNow()" @close="reader.set(false)" />
            <PropsPanel v-else :ed="ed" :bag="preview.bag.value" :defaults="{ folder: app.settings?.dashboardFolder ?? 'Document/Dashboards', display: app.settings?.displayAfterPush ?? true }" :schedule-text="scheduleText" @fetch="fetchWidget" />
          </div>
        </div>
      </div>

      <div v-else class="empty">
        <div class="tile"><Icon name="dashboard" :size="28" /></div>
        <h2>{{ entries.length ? 'Pick a dashboard' : 'No dashboards yet' }}</h2>
        <p>{{ entries.length ? 'Choose one from the list to edit it.' : 'Compose pages out of widgets such as a clock, calendar, checklist or computer status, and push them to your reader as a picture.' }}</p>
        <button class="btn primary" @click="createDashboard"><Icon name="plus" :size="16" />New dashboard <kbd>Ctrl+N</kbd></button>
      </div>
    </div>

    <WidgetPalette v-if="palette" :x="palette.x" :y="palette.y" @pick="pickWidget" @close="closePalette" />
  </section>
</template>

<style scoped>
.dash { min-width: 0; }
.body { flex: 1; min-height: 0; display: flex; }
.editor { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.strip { height: 44px; flex: none; display: flex; align-items: center; gap: 4px; padding: 0 12px; border-bottom: 1px solid var(--border); background: var(--panel); }
.work { flex: 1; min-height: 0; display: flex; }
.col { flex: none; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--border); background: var(--panel); }
.side-col { width: clamp(244px, 26vw, 296px); }
.reader-col { width: 300px; }
.panel-switch { margin: 10px 12px 0; flex: none; }
.panel-switch button { flex: 1; padding: 0 6px; }
.sep { width: 1px; height: 18px; background: var(--border); margin: 0 4px; flex: none; }
.btn.on { background: var(--accent-soft); color: var(--accent); }
.zoom { min-width: 52px; padding: 0 8px; }
.save { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--faint); height: 28px; padding: 0 8px; border-radius: var(--radius-s); }
.save.dirty { color: var(--warn); }
.save.saved { color: var(--ok); }
.save.error { color: var(--danger); cursor: pointer; }
.save.error:hover { background: var(--danger-soft); }
.spinner.on-accent { border-color: color-mix(in srgb, var(--on-accent) 30%, transparent); border-top-color: var(--on-accent); }
.empty { flex: 1; }
</style>

<style>
/* the shared .btn.small rule gives icon buttons side padding back, which squeezes their glyph */
.dash .btn.icon.small { padding: 0; }
/* the dashboard's name after the title: one line, however long */
.dash .bar-count { max-width: 22ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 1100px) { .dash .btn .wide { display: none; } }
</style>
