<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, watch } from 'vue';
import Icon from './components/Icon.vue';
import Logo from './components/Logo.vue';
import ContextMenu from './components/ContextMenu.vue';
import DialogHost from './components/DialogHost.vue';
import WindowControls from './components/WindowControls.vue';
import ResizeHandles from './components/ResizeHandles.vue';
import ConnectView from './views/ConnectView.vue';
import DeviceView from './views/DeviceView.vue';
import LibraryView from './views/LibraryView.vue';
import DashboardsView from './views/DashboardsView.vue';
import SettingsView from './views/SettingsView.vue';
import { app, refreshConnection, connectNow, loadSettings, type ViewName } from './lib/store';
import { installContextMenu } from './lib/contextmenu';
import { installDrag } from './lib/window';
import { attempt } from './lib/ui';
import { background } from './dashboard/background';

const nav: { id: ViewName; label: string; icon: string; key: string }[] = [
  { id: 'device', label: 'Device', icon: 'device', key: '1' },
  { id: 'library', label: 'Library', icon: 'library', key: '2' },
  { id: 'dashboards', label: 'Dashboards', icon: 'dashboard', key: '3' },
  { id: 'settings', label: 'Settings', icon: 'settings', key: '4' },
];
const views = { device: DeviceView, library: LibraryView, dashboards: DashboardsView, settings: SettingsView };

// without a paired reader there is nothing to manage: the connect flow takes the whole window
const needsConnect = computed(() => !app.conn || !app.conn.configured);
const online = computed(() => !!app.conn?.connected);

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    const n = nav.find((x) => x.key === e.key);
    if (n && !needsConnect.value) { e.preventDefault(); app.view = n.id; return; }
    if (e.key === ',' && !needsConnect.value) { e.preventDefault(); app.view = 'settings'; return; }
  }
  void inField;
}

onMounted(async () => {
  installContextMenu();
  installDrag();
  window.addEventListener('keydown', onKey);
  await attempt(refreshConnection);
  await attempt(loadSettings);
  if (app.conn?.configured && !app.conn.connected) await connectNow();
});
// scheduled dashboard pushes run whichever view is showing, for as long as the reader is connected
watch(online, (on) => { if (on) background.start(); }, { immediate: true });
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  background.stop();
});
</script>

<template>
  <ResizeHandles />
  <WindowControls />

  <ConnectView v-if="needsConnect && app.conn" />
  <div v-else-if="app.conn" class="app">
    <aside class="side">
      <div class="side-top" data-drag>
        <Logo :size="26" data-drag />
        <span class="brand" data-drag>Inkboard</span>
      </div>
      <nav class="nav" aria-label="Sections">
        <button v-for="n in nav" :key="n.id" class="nav-item" :class="{ active: app.view === n.id }" :title="`${n.label} (Ctrl+${n.key})`" @click="app.view = n.id">
          <Icon :name="n.icon" :size="18" />
          <span>{{ n.label }}</span>
        </button>
      </nav>
      <div class="side-foot" :title="online ? 'Connected' : app.connecting ? 'Connecting...' : app.connectError || 'Not connected'">
        <span class="dot" :class="online ? 'ok' : app.connecting ? '' : 'bad'"></span>
        <span>{{ online ? 'Reader connected' : app.connecting ? 'Connecting...' : 'Reader offline' }}</span>
        <button v-if="!online && !app.connecting" class="btn ghost icon small" style="margin-left: auto" title="Reconnect" aria-label="Reconnect" @click="connectNow()">
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

  <ContextMenu />
  <DialogHost />
</template>
