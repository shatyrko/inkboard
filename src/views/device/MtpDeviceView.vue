<script setup lang="ts">
// A USB reader at a glance: storage, who made it, how fast the cable is, and what Inkboard can and cannot do with it.
import { computed, onActivated, onDeactivated, ref, watch } from 'vue';
import Icon from '../../components/Icon.vue';
import PageBar from '../../components/PageBar.vue';
import UsbOffline from '../../components/UsbOffline.vue';
import { api } from '../../lib/api';
import type { MenuItem } from '../../lib/contextmenu';
import { fmtBytes } from '../../lib/format';
import { capabilities } from '../../lib/readers';
import { activeReader } from '../../lib/store';
import type { MtpStatus } from '../../lib/types';
import { speedAdvice, usage } from '../files/usb';
import { copyText } from '../shared/clipboard';
import { useDelayed } from '../shared/delayed';

const status = ref<MtpStatus | null>(null);
const loading = ref(false);
const error = ref('');
const visible = ref(false);

const reader = computed(() => activeReader());
const online = computed(() => !!reader.value?.connected);
const slow = useDelayed(loading);
const caps = capabilities('mtp');
const advice = computed(() => speedAdvice(status.value?.usbSpeed ?? null));

async function load() {
  const id = reader.value?.id;
  if (!id || !online.value || loading.value) return;
  loading.value = true;
  try {
    status.value = await api.mtpStatus(id);
    error.value = '';
  } catch (e) {
    error.value = typeof e === 'string' ? e : (e as Error)?.message || 'Could not read the reader.';
  } finally {
    loading.value = false;
  }
}

// the shell keeps this view alive, so "shown again" is an activation, not a mount
onActivated(() => { visible.value = true; load(); });
onDeactivated(() => { visible.value = false; });
watch(online, (on) => { if (on) load(); });
watch(() => reader.value?.id, () => { status.value = null; error.value = ''; if (visible.value) load(); });

function onKey(e: KeyboardEvent) {
  if (e.key === 'F5' && online.value) { e.preventDefault(); load(); }
}
watch(visible, (v) => {
  if (v) window.addEventListener('keydown', onKey);
  else window.removeEventListener('keydown', onKey);
});

const rows = computed(() => {
  const s = status.value;
  if (!s) return [];
  return [
    { label: 'Maker', value: s.maker, mono: false },
    { label: 'Model', value: s.model, mono: true },
    { label: 'Name', value: s.name, mono: false },
  ];
});

// what the capability table says, in words: first what works here, then what is done on the reader itself
const works = computed(() => [
  caps.files === 'filesystem' ? 'Browse the files and folders; upload, download, rename, move and delete them' : '',
  caps.dashboardFormats.length ? `Publish dashboards as ${caps.dashboardFormats.map((f) => f.toUpperCase()).join(' or ')} files` : '',
].filter(Boolean));
const onReader = computed(() => [
  !caps.openOnReader ? "Showing a dashboard on its screen: open the file from the reader's own file app" : '',
  !caps.deviceSettings ? 'Date and time, Wi-Fi, standby and the like: change them on the reader' : '',
  !caps.screenMirror ? "Showing the reader's screen here" : '',
].filter(Boolean));

const copyMenu = (what: string, value: string) => (): MenuItem[] => [{ label: `Copy ${what.toLowerCase()}`, icon: 'copy', action: () => copyText(value, `${what} copied`) }];
</script>

<template>
  <section class="view">
    <PageBar title="Device">
      <button v-if="online" class="btn ghost icon" aria-label="Refresh" title="Refresh (F5)" @click="load"><Icon name="refresh" :size="18" /></button>
    </PageBar>

    <div class="scroll">
      <UsbOffline v-if="!online" :reason="error" />

      <div v-else-if="!status" class="empty">
        <template v-if="error">
          <div class="tile"><Icon name="warn" :size="28" /></div>
          <h2>Could not read the reader</h2>
          <p class="selectable">{{ error }}</p>
          <button class="btn primary" @click="load"><Icon name="refresh" :size="16" />Try again</button>
        </template>
        <span v-else-if="slow" class="spinner"></span>
      </div>

      <div v-else class="page wide cols">
        <div class="left">
          <section v-for="s in status.storages" :key="s.id" class="card stat" :aria-label="s.name">
            <div class="label"><Icon name="drive" :size="16" />{{ s.name }}</div>
            <div class="big num">{{ fmtBytes(usage(s.total, s.free).used) }}<small> used of {{ fmtBytes(s.total) }}</small></div>
            <div class="meter" :class="{ warn: usage(s.total, s.free).pct > 85 }" role="progressbar" :aria-label="`${s.name} used`" :aria-valuenow="Math.round(usage(s.total, s.free).pct)" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: usage(s.total, s.free).pct + '%' }"></i></div>
            <div class="sub">{{ fmtBytes(s.free) }} free</div>
          </section>

          <section class="card info" aria-label="About this reader">
            <h2>Reader</h2>
            <dl>
              <div v-for="r in rows" :key="r.label" v-context="copyMenu(r.label, r.value)" class="kv">
                <dt>{{ r.label }}</dt>
                <dd class="selectable" :class="{ mono: r.mono }">{{ r.value }}</dd>
              </div>
              <div class="kv">
                <dt>Connection</dt>
                <dd><span class="chip"><Icon name="usb" :size="14" />USB</span><span v-if="status.usbSpeed" class="speed selectable">{{ status.usbSpeed }}</span></dd>
              </div>
            </dl>
            <p class="advice" :class="advice.level"><Icon :name="advice.level === 'ok' ? 'ok' : 'info'" :size="16" /><span>{{ advice.text }}</span></p>
          </section>
        </div>

        <div class="right">
          <section class="card can" aria-label="What Inkboard can do">
            <h2>What Inkboard can do here</h2>
            <ul class="yes">
              <li v-for="w in works" :key="w"><Icon name="check" :size="16" /><span>{{ w }}</span></li>
            </ul>
            <template v-if="onReader.length">
              <h3>Done on the reader itself</h3>
              <ul class="no">
                <li v-for="w in onReader" :key="w"><Icon name="minus" :size="16" /><span>{{ w }}</span></li>
              </ul>
            </template>
          </section>

          <section class="card unplug" aria-label="Unplugging">
            <h2>Safe to unplug</h2>
            <p>Transfers are finished when the progress panel in Files is gone. After that you can unplug the cable; no eject step is needed.</p>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cols { display: flex; flex-wrap: wrap; gap: 14px 18px; align-items: flex-start; }
.left { flex: 1 1 340px; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.right { flex: 1 1 340px; min-width: 280px; display: flex; flex-direction: column; gap: 14px; }
.left .card + .card, .right .card + .card { margin-top: 0; }

.stat .label { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12.5px; font-weight: 500; }
.stat .big { font-size: 28px; font-weight: 650; letter-spacing: -0.02em; margin: 6px 0 10px; }
.stat .big small { font-size: 13px; font-weight: 450; color: var(--muted); letter-spacing: 0; }
.stat .sub { margin-top: 8px; font-size: 12.5px; color: var(--muted); }

.info h2, .can h2, .unplug h2 { font-size: 15px; margin-bottom: 6px; }
.info dl { margin: 0; }
.kv { display: flex; align-items: center; gap: 12px; min-height: 40px; border-top: 1px solid var(--border); }
.kv:first-child { border-top: 0; }
.kv dt { width: 112px; flex: none; color: var(--muted); }
.kv dd { margin: 0; flex: 1; min-width: 0; overflow-wrap: anywhere; display: flex; align-items: center; gap: 10px; }
.speed { color: var(--muted); font-size: 13px; }
.advice { display: flex; align-items: flex-start; gap: 8px; margin: 8px 0 0; padding: 10px 12px; border-radius: var(--radius-s); background: var(--hover); color: var(--muted); font-size: 13px; }
.advice svg { flex: none; margin-top: 2px; }
.advice.ok svg { color: var(--ok); }
.advice.slow { background: color-mix(in srgb, var(--warn) 14%, transparent); color: var(--text); }
.advice.slow svg { color: var(--warn); }

.can h3 { margin: 16px 0 6px; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint); }
.can ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.can li { display: flex; align-items: flex-start; gap: 10px; }
.can li svg { flex: none; margin-top: 2px; }
.can .yes svg { color: var(--ok); }
.can .no { color: var(--muted); }
.can .no svg { color: var(--faint); }
.unplug p { margin: 0; color: var(--muted); }
</style>
