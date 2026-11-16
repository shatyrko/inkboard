<script setup lang="ts">
// The paired reader at a glance: battery, pen, storage, identity, and what its screen shows.
import { computed, onActivated, onDeactivated, ref, watch } from 'vue';
import Icon from '../components/Icon.vue';
import OfflineState from '../components/OfflineState.vue';
import PageBar from '../components/PageBar.vue';
import { api } from '../lib/api';
import type { MenuItem } from '../lib/contextmenu';
import { fmtBytes } from '../lib/format';
import { app } from '../lib/store';
import type { DeviceStatus } from '../lib/types';
import ScreenPanel from './device/ScreenPanel.vue';
import { copyText } from './shared/clipboard';
import { useDelayed } from './shared/delayed';

const status = ref<DeviceStatus | null>(null);
const loading = ref(false);
const error = ref('');
const visible = ref(false);
const screen = ref<InstanceType<typeof ScreenPanel> | null>(null);

const online = computed(() => !!app.conn?.connected);
const slow = useDelayed(loading);

async function load() {
  if (!online.value || loading.value) return;
  loading.value = true;
  try {
    status.value = await api.deviceStatus();
    error.value = '';
  } catch (e) {
    error.value = typeof e === 'string' ? e : (e as Error)?.message || 'Could not read the reader status.';
  } finally {
    loading.value = false;
  }
}
function refreshAll() {
  load();
  screen.value?.refresh();
}

// the shell keeps this view alive, so "shown again" is an activation, not a mount
onActivated(() => { visible.value = true; load(); });
onDeactivated(() => { visible.value = false; });
watch(online, (on) => { if (on) load(); });

function onKey(e: KeyboardEvent) {
  if (e.key === 'F5' && online.value) { e.preventDefault(); refreshAll(); }
}
watch(visible, (v) => {
  if (v) window.addEventListener('keydown', onKey);
  else window.removeEventListener('keydown', onKey);
});

const used = computed(() => (status.value ? Math.max(0, status.value.storage.capacity - status.value.storage.available) : 0));
const usedPct = computed(() => (status.value?.storage.capacity ? Math.min(100, (used.value / status.value.storage.capacity) * 100) : 0));

/** colour of a charge meter: green, amber when getting low, red when nearly empty */
const charge = (level: number) => (level <= 10 ? 'low' : level <= 25 ? 'warn' : 'ok');

const WORDS: Record<string, string> = { charging: 'Charging', discharging: 'On battery', full: 'Full', usb: 'USB', none: 'not plugged in' };
const word = (s: string) => WORDS[s.toLowerCase()] ?? (s ? s[0].toUpperCase() + s.slice(1) : '');
const powerLine = computed(() => {
  const b = status.value?.battery;
  if (!b) return '';
  const state = b.charging ? 'Charging' : word(b.status);
  const plug = b.plugged && b.plugged.toLowerCase() !== 'none' ? `${word(b.plugged)} connected` : '';
  return [state, plug].filter(Boolean).join(' · ');
});

const copyMenu = (what: string, value: string) => (): MenuItem[] => [{ label: `Copy ${what.toLowerCase()}`, icon: 'copy', action: () => copyText(value, `${what} copied`) }];

const rows = computed(() => {
  const s = status.value;
  if (!s) return [];
  return [
    { label: 'Model', value: s.model, mono: false },
    { label: 'Serial number', value: s.serial, mono: true },
    { label: 'Firmware', value: s.firmware, mono: true },
    { label: 'API version', value: s.apiVersion, mono: true },
    { label: 'Colour', value: s.color, mono: false },
    ...(app.conn?.addr ? [{ label: 'Address', value: app.conn.addr, mono: true }] : []),
  ];
});
</script>

<template>
  <section class="view">
    <PageBar title="Device">
      <button v-if="online" class="btn ghost icon" aria-label="Refresh" title="Refresh (F5)" @click="refreshAll"><Icon name="refresh" :size="18" /></button>
    </PageBar>

    <div class="scroll">
      <OfflineState v-if="!online" />

      <div v-else-if="!status" class="empty">
        <template v-if="error">
          <div class="tile"><Icon name="warn" :size="28" /></div>
          <h2>Could not read the reader</h2>
          <p class="selectable">{{ error }}</p>
          <button class="btn primary" @click="refreshAll"><Icon name="refresh" :size="16" />Try again</button>
        </template>
        <span v-else-if="slow" class="spinner"></span>
      </div>

      <div v-else class="page wide cols">
        <div class="left">
          <div class="pair">
            <section class="card stat" aria-label="Battery">
              <div class="label"><Icon :name="status.battery.charging ? 'battery-charging' : 'battery'" :size="16" />Battery</div>
              <div class="big num">{{ status.battery.level }}<small>%</small></div>
              <div class="meter" :class="charge(status.battery.level)" role="progressbar" aria-label="Battery level" :aria-valuenow="status.battery.level" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: status.battery.level + '%' }"></i></div>
              <div class="sub">{{ powerLine }}</div>
            </section>
            <section class="card stat" aria-label="Pen battery">
              <div class="label"><Icon name="pen" :size="16" />Pen</div>
              <div class="big num">{{ status.battery.pen }}<small>%</small></div>
              <div class="meter" :class="charge(status.battery.pen)" role="progressbar" aria-label="Pen battery level" :aria-valuenow="status.battery.pen" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: status.battery.pen + '%' }"></i></div>
              <div class="sub">Battery of the pen</div>
            </section>
          </div>

          <section class="card stat" aria-label="Storage">
            <div class="label"><Icon name="drive" :size="16" />Storage</div>
            <div class="big num">{{ fmtBytes(used) }}<small> used of {{ fmtBytes(status.storage.capacity) }}</small></div>
            <div class="meter" :class="{ warn: usedPct > 85 }" role="progressbar" aria-label="Storage used" :aria-valuenow="Math.round(usedPct)" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: usedPct + '%' }"></i></div>
            <div class="sub">{{ fmtBytes(status.storage.available) }} free</div>
          </section>

          <section class="card info" aria-label="About this reader">
            <h2>Reader</h2>
            <dl>
              <div v-for="r in rows" :key="r.label" v-context="copyMenu(r.label, r.value)" class="kv">
                <dt>{{ r.label }}</dt>
                <dd class="selectable" :class="{ mono: r.mono }">{{ r.value }}</dd>
                <button v-if="r.label === 'Serial number'" class="btn ghost icon small" :aria-label="`Copy ${r.label.toLowerCase()}`" :title="`Copy ${r.label.toLowerCase()}`" @click="copyText(r.value, `${r.label} copied`)"><Icon name="copy" :size="15" /></button>
              </div>
              <div class="kv">
                <dt>Wi-Fi</dt>
                <dd><span class="chip" :class="{ plain: !status.wifiEnabled }"><Icon :name="status.wifiEnabled ? 'wifi' : 'wifi-off'" :size="14" />{{ status.wifiEnabled ? 'On' : 'Off' }}</span></dd>
              </div>
            </dl>
          </section>
        </div>

        <ScreenPanel ref="screen" class="right" :active="visible" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.cols { display: flex; flex-wrap: wrap; gap: 14px 18px; align-items: flex-start; }
.left { flex: 1 1 340px; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.right { flex: 0 1 380px; min-width: 280px; }
.left .card + .card { margin-top: 0; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

.stat .label { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12.5px; font-weight: 500; }
.stat .big { font-size: 28px; font-weight: 650; letter-spacing: -0.02em; margin: 6px 0 10px; }
.stat .big small { font-size: 13px; font-weight: 450; color: var(--muted); letter-spacing: 0; }
.stat .sub { margin-top: 8px; font-size: 12.5px; color: var(--muted); }
.meter.low > i { background: var(--danger); }

.info h2 { font-size: 15px; margin-bottom: 6px; }
.kv { display: flex; align-items: center; gap: 12px; min-height: 40px; border-top: 1px solid var(--border); }
.kv:first-child { border-top: 0; }
.kv dt { width: 112px; flex: none; color: var(--muted); }
.kv dd { margin: 0; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.info dl { margin: 0; }
</style>
