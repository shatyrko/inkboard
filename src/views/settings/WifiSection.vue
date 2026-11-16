<script setup lang="ts">
// The reader's Wi-Fi: the switch, the saved networks and joining a new one.
import { computed, ref } from 'vue';
import Icon from '../../components/Icon.vue';
import { api } from '../../lib/api';
import type { MenuItem } from '../../lib/contextmenu';
import { app } from '../../lib/store';
import type { WifiNetwork } from '../../lib/types';
import { confirmDialog, notify } from '../../lib/ui';
import { useDelayed } from '../shared/delayed';
import AddNetworkDialog from './AddNetworkDialog.vue';
import { loadWhenReady } from './loadWhenReady';

const props = defineProps<{ active: boolean }>();

const message = (e: unknown) => (typeof e === 'string' ? e : (e as Error)?.message || 'Something went wrong.');

const enabled = ref<boolean | null>(null);
const networks = ref<WifiNetwork[]>([]);
const error = ref('');
const adding = ref(false);
const slow = useDelayed(computed(() => enabled.value === null && !error.value));

async function load() {
  try {
    const [status, saved] = await Promise.all([api.deviceStatus(), api.wifiList()]);
    enabled.value = status.wifiEnabled;
    networks.value = saved;
    error.value = '';
  } catch (e) {
    error.value = message(e);
  }
}
loadWhenReady(() => props.active && !!app.conn?.connected, load);

async function setEnabled(on: boolean) {
  if (!on) {
    // the app itself talks to the reader over Wi-Fi: switching it off cuts the connection this very request rides on
    const ok = await confirmDialog({
      title: "Turn off the reader's Wi-Fi?",
      body: 'Inkboard talks to the reader over Wi-Fi, so it loses contact as soon as Wi-Fi goes off. To bring it back, switch Wi-Fi on again on the reader itself.',
      confirm: 'Turn off Wi-Fi',
    });
    if (!ok) return;
  }
  const before = enabled.value;
  enabled.value = on;
  try {
    await api.wifiSetEnabled(on);
    if (!on && app.conn) {
      app.connectError = 'Wi-Fi was switched off on the reader.';
      app.conn = { ...app.conn, connected: false };
    }
  } catch (e) {
    enabled.value = before;
    notify(`Could not change Wi-Fi: ${message(e)}`, 'error');
  }
}

async function forget(n: WifiNetwork) {
  const ok = await confirmDialog({
    title: `Forget "${n.ssid}"?`,
    body: 'The reader stops joining this network by itself. You can add it again later, with its password.',
    confirm: 'Forget network',
  });
  if (!ok) return;
  try {
    await api.wifiForget(n.ssid, n.security);
    notify(`Forgot "${n.ssid}"`);
  } catch (e) {
    notify(`Could not forget "${n.ssid}": ${message(e)}`, 'error');
  }
  await load();
}

const menu = (n: WifiNetwork): MenuItem[] => [{ label: 'Forget network...', icon: 'trash', action: () => forget(n) }];
const security = (s: string) => (s === 'nonsec' ? 'Open' : s === 'psk' ? 'WPA / WPA2' : s.toUpperCase());
</script>

<template>
  <div class="section-label">Wi-Fi</div>
  <div v-if="enabled !== null" class="card">
    <div class="setting">
      <div class="t"><b>Wi-Fi</b><span>Inkboard reaches the reader over Wi-Fi, so keep it on.</span></div>
      <div class="ctl"><button class="switch" role="switch" aria-label="Wi-Fi" :aria-checked="enabled" @click="setEnabled(!enabled)"></button></div>
    </div>
    <div class="setting">
      <div class="t"><b>Saved networks</b><span>The reader joins these by itself when it is in range.</span></div>
      <div class="ctl"><button class="btn" @click="adding = true"><Icon name="plus" :size="16" />Add network...</button></div>
    </div>
    <ul v-if="networks.length" class="nets" aria-label="Saved networks">
      <li v-for="n in networks" :key="n.ssid + n.security" v-context="() => menu(n)" class="net">
        <Icon name="wifi" :size="16" class="ic" />
        <span class="nm selectable">{{ n.ssid }}</span>
        <span class="chip plain">{{ security(n.security) }}</span>
        <button class="btn ghost small" :aria-label="`Forget ${n.ssid}`" @click="forget(n)">Forget</button>
      </li>
    </ul>
    <p v-else class="none">No saved networks yet.</p>
  </div>
  <div v-else class="card state">
    <template v-if="error">
      <span class="why selectable">{{ error }}</span>
      <button class="btn small" @click="load"><Icon name="refresh" :size="15" />Try again</button>
    </template>
    <span v-else-if="slow" class="spinner"></span>
  </div>

  <AddNetworkDialog v-if="adding" @close="adding = false" @added="(s) => { notify(`Joined ${s}`); load(); }" />
</template>

<style scoped>
.nets { list-style: none; margin: 0; padding: 0; }
.net { display: flex; align-items: center; gap: 12px; height: 46px; border-top: 1px solid var(--border); }
.ic { color: var(--muted); flex: none; }
.nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.none { margin: 0; padding: 12px 0 2px; border-top: 1px solid var(--border); color: var(--faint); }
.state { display: flex; align-items: center; gap: 12px; min-height: 64px; }
.why { color: var(--danger); flex: 1; }
</style>
