<script setup lang="ts">
// USB debugging (ADB) of a USB reader. It is opt-in: it lets this computer control the reader, and the reader asks the user
// to approve this computer the first time. The card follows the reader's own answer: off on the reader, available, waiting for
// the tap, failed, or ready (battery, Android version, screen size).
import { computed, ref } from 'vue';
import Icon from '../../components/Icon.vue';
import { adb, adbConnecting, connectAdb, disconnectAdb, refreshAdb } from '../../lib/adb';
import { notify } from '../../lib/ui';
import { batteryLine, cardState, screenLabel } from './adbCard';

const props = defineProps<{ id: string }>();

const status = computed(() => adb[props.id]);
const state = computed(() => cardState(status.value, !!adbConnecting[props.id], error.value));
const error = ref('');
const checking = ref(false);

async function turnOn() {
  error.value = '';
  try {
    await connectAdb(props.id);
  } catch (e) {
    error.value = typeof e === 'string' ? e : (e as Error)?.message || 'The reader did not approve the connection.';
  }
}
async function turnOff() {
  await disconnectAdb(props.id);
  notify('USB debugging is disconnected');
}
async function checkAgain() {
  checking.value = true;
  error.value = '';
  try { await refreshAdb(props.id); } finally { checking.value = false; }
}
</script>

<template>
  <section class="card adb" aria-label="USB debugging">
    <div class="head">
      <h2>USB debugging</h2>
      <span v-if="state === 'ready'" class="chip"><Icon name="check" :size="13" />On</span>
    </div>

    <p v-if="state === 'checking'" class="line"><span class="spinner"></span>Checking what the reader offers...</p>

    <template v-else-if="state === 'unavailable'">
      <p>USB debugging is off on the reader. With it on, Inkboard can show the reader's live screen and battery, and open files on it.</p>
      <p class="how">To turn it on, open <b>Settings &gt; Developer options &gt; USB debugging</b> on the reader. If there is no Developer options entry, tap the build number seven times in the reader's About screen to reveal it.</p>
      <button class="btn" :disabled="checking" @click="checkAgain"><span v-if="checking" class="spinner"></span><Icon v-else name="refresh" :size="16" />Check again</button>
    </template>

    <template v-else-if="state === 'off' || state === 'failed'">
      <p v-if="state === 'off'">Turn it on to see the reader's live screen and battery here, and to open files on the reader from the Files view.</p>
      <p v-if="state === 'off'" class="warn"><Icon name="info" :size="16" /><span>USB debugging lets this computer control the reader. You can revoke it on the reader at any time.</span></p>
      <p v-else class="err" role="alert"><Icon name="warn" :size="16" /><span>{{ error }}</span></p>
      <button class="btn primary" @click="turnOn"><Icon name="plug" :size="16" />{{ state === 'failed' ? 'Try again' : 'Turn on' }}</button>
    </template>

    <template v-else-if="state === 'waiting'">
      <p class="line strong" role="status"><span class="spinner"></span>Waiting for you to tap Allow on the reader...</p>
      <p>Look at the reader's screen: it asks "Allow USB debugging?". Tick <b>Always allow from this computer</b>, then tap <b>Allow</b>. This can take up to a minute.</p>
    </template>

    <template v-else>
      <dl>
        <div v-if="status?.battery" class="kv">
          <dt>Battery</dt>
          <dd>
            <span class="level">{{ batteryLine(status.battery) }}</span>
            <span class="meter" :class="status.battery.level <= 10 ? 'low' : status.battery.level <= 25 ? 'warn' : 'ok'" role="progressbar" aria-label="Reader battery" :aria-valuenow="Math.round(status.battery.level)" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: status.battery.level + '%' }"></i></span>
          </dd>
        </div>
        <div v-if="status?.android" class="kv"><dt>Android</dt><dd class="selectable">{{ status.android }}</dd></div>
        <div v-if="status?.screen" class="kv"><dt>Screen</dt><dd class="selectable">{{ screenLabel(status.screen) }}</dd></div>
      </dl>
      <button class="btn" @click="turnOff"><Icon name="unplug" :size="16" />Turn off</button>
    </template>
  </section>
</template>

<style scoped>
.adb p { margin: 0 0 10px; color: var(--muted); }
.adb p b { color: var(--text); font-weight: 550; }
.head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.head h2 { font-size: 15px; margin: 0; }
.line { display: flex; align-items: center; gap: 10px; }
.line.strong { color: var(--text); font-weight: 550; }
.how { font-size: 13px; }
.warn, .err { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: var(--radius-s); font-size: 13px; }
.warn { background: color-mix(in srgb, var(--warn) 14%, transparent); color: var(--text); }
.warn svg { color: var(--warn); flex: none; margin-top: 2px; }
.err { background: var(--danger-soft); color: var(--text); }
.err svg { color: var(--danger); flex: none; margin-top: 2px; }
dl { margin: 0 0 12px; }
.kv { display: flex; align-items: center; gap: 12px; min-height: 40px; border-top: 1px solid var(--border); }
.kv:first-child { border-top: 0; }
.kv dt { width: 112px; flex: none; color: var(--muted); }
.kv dd { margin: 0; flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; }
.level { min-width: 92px; }
.meter { flex: 1; max-width: 180px; height: 8px; border-radius: 99px; background: var(--border); overflow: hidden; display: block; }
.meter > i { display: block; height: 100%; background: var(--accent); border-radius: 99px; }
.meter.ok > i { background: var(--ok); }
.meter.warn > i { background: var(--warn); }
.meter.low > i { background: var(--danger); }
</style>
