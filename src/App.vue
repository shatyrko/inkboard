<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import Icon from './components/Icon.vue';
import Logo from './components/Logo.vue';
import ContextMenu from './components/ContextMenu.vue';
import DialogHost from './components/DialogHost.vue';
import WindowControls from './components/WindowControls.vue';
import ResizeHandles from './components/ResizeHandles.vue';
import ReaderSwitcher from './components/ReaderSwitcher.vue';
import ConnectView from './views/ConnectView.vue';
import DeviceView from './views/DeviceView.vue';
import LibraryView from './views/LibraryView.vue';
import DashboardsView from './views/DashboardsView.vue';
import SettingsView from './views/SettingsView.vue';
import MtpDeviceView from './views/device/MtpDeviceView.vue';
import MtpFilesView from './views/files/MtpFilesView.vue';
import { activeReader, app, refreshConnection, refreshReaders, connectNow, loadSettings, selectReader, type ViewName } from './lib/store';
import { cycleReader } from './lib/readerList';
import { readersReady, startReaderWatch } from './lib/readerWatch';
import { installContextMenu } from './lib/contextmenu';
import { installDrag } from './lib/window';
import { attempt } from './lib/ui';
import { background } from './dashboard/background';

const reader = computed(() => activeReader());
// a USB reader (MTP) has a file manager where the Digital Paper has its document library
const usb = computed(() => reader.value?.kind === 'mtp');

const nav = computed<{ id: ViewName; label: string; icon: string; key: string }[]>(() => [
  { id: 'device', label: 'Device', icon: 'device', key: '1' },
  { id: 'library', label: usb.value ? 'Files' : 'Library', icon: usb.value ? 'folder' : 'library', key: '2' },
  { id: 'dashboards', label: 'Dashboards', icon: 'dashboard', key: '3' },
  { id: 'settings', label: 'Settings', icon: 'settings', key: '4' },
]);
const views = computed(() => ({
  device: usb.value ? MtpDeviceView : DeviceView,
  library: usb.value ? MtpFilesView : LibraryView,
  dashboards: DashboardsView,
  settings: SettingsView,
}));

// the connect flow takes the whole window only while there is no reader at all: nothing paired and nothing plugged in
const ready = computed(() => !!app.conn && readersReady.value);
const needsConnect = computed(() => ready.value && app.readers.length === 0);
/** "Add a Digital Paper..." from the switcher: the connect flow on top of the app */
const adding = ref(false);
const online = computed(() => !!app.conn?.connected);

// the sidebar footer tells about the reader that is shown
const foot = computed(() => {
  if (usb.value) {
    const up = !!reader.value?.connected;
    return { ok: up, wait: false, text: up ? 'USB reader connected' : 'USB reader offline', title: up ? 'Connected' : 'Plug it in and unlock it', retry: () => refreshReaders().catch(() => {}) };
  }
  return { ok: online.value, wait: app.connecting, text: online.value ? 'Reader connected' : app.connecting ? 'Connecting...' : 'Reader offline', title: online.value ? 'Connected' : app.connecting ? 'Connecting...' : app.connectError || 'Not connected', retry: connectNow };
});

function cycle(step: 1 | -1) {
  const id = cycleReader(app.readers, reader.value?.id ?? null, step);
  if (id) selectReader(id);
}

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  // Ctrl+` (Shift: backwards) switches reader; by key position, so it works on any keyboard layout
  if (e.ctrlKey && !e.altKey && e.code === 'Backquote' && !needsConnect.value) { e.preventDefault(); cycle(e.shiftKey ? -1 : 1); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    const n = nav.value.find((x) => x.key === e.key);
    if (n && !needsConnect.value) { e.preventDefault(); app.view = n.id; return; }
    if (e.key === ',' && !needsConnect.value) { e.preventDefault(); app.view = 'settings'; return; }
  }
  void inField;
}

let stopWatch: (() => void) | undefined;
onMounted(async () => {
  installContextMenu();
  installDrag();
  window.addEventListener('keydown', onKey);
  stopWatch = startReaderWatch();
  await attempt(refreshConnection);
  await attempt(loadSettings);
  if (app.conn?.configured && !app.conn.connected) await connectNow();
});
// scheduled dashboard pushes run whichever view is showing, for as long as the reader is connected
watch(online, (on) => { if (on) background.start(); }, { immediate: true });
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  stopWatch?.();
  background.stop();
});
</script>

<template>
  <ResizeHandles />
  <WindowControls />

  <ConnectView v-if="needsConnect" />
  <div v-else-if="ready" class="app" :inert="adding">
    <aside class="side">
      <div class="side-top" data-drag>
        <Logo :size="26" data-drag />
        <span class="brand" data-drag>Inkboard</span>
      </div>
      <ReaderSwitcher @add="adding = true" />
      <nav class="nav" aria-label="Sections">
        <button v-for="n in nav" :key="n.id" class="nav-item" :class="{ active: app.view === n.id }" :title="`${n.label} (Ctrl+${n.key})`" @click="app.view = n.id">
          <Icon :name="n.icon" :size="18" />
          <span>{{ n.label }}</span>
        </button>
      </nav>
      <div class="side-foot" :title="foot.title">
        <span class="dot" :class="foot.ok ? 'ok' : foot.wait ? '' : 'bad'"></span>
        <span>{{ foot.text }}</span>
        <button v-if="!foot.ok && !foot.wait" class="btn ghost icon small" style="margin-left: auto" :title="usb ? 'Check again' : 'Reconnect'" :aria-label="usb ? 'Check again' : 'Reconnect'" @click="foot.retry()">
          <Icon name="refresh" :size="15" />
        </button>
      </div>
    </aside>
    <main class="main">
      <KeepAlive>
        <component :is="views[app.view]" />
      </KeepAlive>
    </main>
  </div>
  <div v-else class="empty" data-drag><span class="spinner"></span></div>
  <ConnectView v-if="adding && !needsConnect" overlay @close="adding = false" />

  <ContextMenu />
  <DialogHost />
</template>
