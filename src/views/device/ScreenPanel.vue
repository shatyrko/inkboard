<script setup lang="ts">
// What the reader is showing right now, as a picture. Refreshes when the view becomes visible and, if switched on, every 5 s
// while it stays visible. The previous picture stays on screen while the next one loads.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import Icon from '../../components/Icon.vue';
import { api } from '../../lib/api';
import type { MenuItem } from '../../lib/contextmenu';
import { attempt, notify } from '../../lib/ui';
import { useDelayed } from '../shared/delayed';

const props = defineProps<{ active: boolean }>();

const EVERY_MS = 5000;
const KEY = 'inkboard.autoRefreshScreen';

const image = ref('');
const loading = ref(false);
const error = ref('');
const updated = ref<Date | null>(null);
const slow = useDelayed(loading);

const auto = ref(false);
try { auto.value = localStorage.getItem(KEY) === '1'; } catch { /* storage can be unavailable */ }

async function refresh() {
  if (loading.value) return;
  loading.value = true;
  try {
    image.value = await api.screenshot();
    updated.value = new Date();
    error.value = '';
  } catch (e) {
    error.value = typeof e === 'string' ? e : (e as Error)?.message || 'Could not read the screen.';
  } finally {
    loading.value = false;
  }
}

let timer: number | undefined;
function stop() {
  window.clearInterval(timer);
  timer = undefined;
}
// the timer exists only while the view is visible and the switch is on; a hidden window does not poll the reader
watch(() => [props.active, auto.value] as const, ([active, on]) => {
  stop();
  if (active && on) timer = window.setInterval(() => { if (!document.hidden) refresh(); }, EVERY_MS);
}, { immediate: true });
watch(() => props.active, (a) => { if (a) refresh(); }, { immediate: true });
onBeforeUnmount(stop);

function setAuto(on: boolean) {
  auto.value = on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage can be unavailable */ }
  if (on) refresh();
}

const canCopy = typeof ClipboardItem !== 'undefined';
async function copyImage() {
  await attempt(async () => {
    const bytes = Uint8Array.from(atob(image.value.slice(image.value.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    notify('Image copied');
  }, 'Could not copy the image');
}

const menu = (): MenuItem[] => [
  { label: 'Refresh', icon: 'refresh', hint: 'F5', action: refresh },
  { label: 'Auto-refresh every 5 s', icon: 'timer', checked: auto.value, action: () => setAuto(!auto.value) },
  ...(canCopy && image.value ? [{ separator: true }, { label: 'Copy image', icon: 'image', action: copyImage }] : []),
];

const time = computed(() => updated.value?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) ?? '');
defineExpose({ refresh });
</script>

<template>
  <section class="card screen" aria-labelledby="screen-title">
    <div class="row head">
      <h2 id="screen-title">Reader screen</h2>
      <span class="grow"></span>
      <span id="auto-label" class="auto">Auto-refresh</span>
      <button class="switch" role="switch" :aria-checked="auto" aria-labelledby="auto-label" title="Refresh every 5 seconds while this page is open" @click="setAuto(!auto)"></button>
      <button class="btn small" :disabled="loading" @click="refresh"><span v-if="loading && slow" class="spinner"></span><Icon v-else name="refresh" :size="15" />Refresh</button>
    </div>

    <figure v-context="menu" class="frame" :aria-busy="loading">
      <img v-if="image" :src="image" alt="What the reader is showing right now" draggable="false" />
      <div v-else class="blank">
        <template v-if="error">
          <Icon name="warn" :size="22" />
          <b>Could not read the screen</b>
          <span class="selectable">{{ error }}</span>
        </template>
        <span v-else-if="slow" class="spinner"></span>
      </div>
    </figure>

    <p class="cap" :class="{ bad: error && image }">
      <template v-if="error && image">Could not update: {{ error }}</template>
      <template v-else-if="time">Updated {{ time }}<template v-if="auto"> &middot; refreshes every 5 s</template></template>
      <template v-else>&nbsp;</template>
    </p>
  </section>
</template>

<style scoped>
.screen { display: flex; flex-direction: column; min-width: 0; }
.head { margin-bottom: 12px; }
.head h2 { margin: 0; font-size: 15px; }
.auto { font-size: 12.5px; color: var(--muted); }
/* the reader's screen is always white paper, whatever the app theme: these two are part of the picture, not of the chrome */
.frame { /* 3:4 like the reader; the whole picture stays visible whatever the window height */ --paper: #f7f7f5; --ink: #5a5a5a; margin: 0 auto; width: 100%; max-width: calc((100vh - 230px) * 0.75); min-width: 200px; aspect-ratio: 3 / 4; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--paper); box-shadow: 0 1px 0 var(--border); }
.frame img { display: block; width: 100%; height: 100%; object-fit: contain; }
.blank { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 16px; text-align: center; color: var(--ink); font-size: 13px; }
.cap { margin: 10px 0 0; text-align: center; font-size: 12px; color: var(--faint); }
.cap.bad { color: var(--danger); }
</style>
