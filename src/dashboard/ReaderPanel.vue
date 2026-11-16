<script setup lang="ts">
// "What the reader shows right now", framed like the page stage so the two can be compared side by side.
// The picture and the refresh policy come from reader-preview.ts; this only draws them and reports clicks.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from '../components/Icon.vue';
import type { MenuItem } from '../lib/contextmenu';
import { notify } from '../lib/ui';
import { fitScale } from './grid';
import { dataUrlToBlob } from './reader-preview';

const props = defineProps<{
  /** false when the target reader cannot be mirrored: the panel then only shows `info` */
  available: boolean;
  /** what to say when it cannot */
  info: string;
  /** the Digital Paper can be reconnected from here; a USB reader has to be plugged in */
  canReconnect: boolean;
  image: string | null;
  updatedAt: number | null;
  loading: boolean;
  /** why the last screenshot failed ('' when it did not) */
  error: string;
  connected: boolean;
  connecting: boolean;
  /** why there is no connection, when known */
  reason: string;
}>();
const emit = defineEmits<{ (e: 'refresh'): void; (e: 'reconnect'): void; (e: 'close'): void }>();

const stage = ref<HTMLElement | null>(null);
const room = ref({ width: 0, height: 0 });
// until the first picture says otherwise the sheet is portrait, 3:4 like the reader held upright
const natural = ref({ width: 825, height: 1100 });

const sheet = computed(() => {
  const s = fitScale(natural.value, room.value, 14, 1);
  return { width: `${Math.round(natural.value.width * s)}px`, height: `${Math.round(natural.value.height * s)}px` };
});
const dim = computed(() => !props.connected || !!props.error);
const updated = computed(() => (props.updatedAt === null ? '' : new Date(props.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })));

let observer: ResizeObserver | undefined;
onMounted(() => {
  // measured on the next frame: resizing inside the callback itself can trigger "ResizeObserver loop" errors
  observer = new ResizeObserver(() => requestAnimationFrame(() => {
    const el = stage.value;
    if (el && el.clientWidth > 0) room.value = { width: el.clientWidth, height: el.clientHeight };
  }));
  if (stage.value) observer.observe(stage.value);
});
onBeforeUnmount(() => observer?.disconnect());

function onLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  if (img.naturalWidth) natural.value = { width: img.naturalWidth, height: img.naturalHeight };
}

// not every webview can put an image on the clipboard: the menu item only appears where it can
const canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
async function copyImage() {
  try {
    const blob = dataUrlToBlob(props.image!);
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    notify('Copied the reader screen');
  } catch {
    notify('Could not copy the picture', 'error');
  }
}

const menu = (): MenuItem[] => [
  { label: 'Refresh', icon: 'refresh', hint: 'Shift+R', disabled: !props.connected, action: () => emit('refresh') },
  ...(canCopy && props.image ? [{ label: 'Copy image', icon: 'copy', action: copyImage }] : []),
  { separator: true },
  { label: 'Hide reader panel', icon: 'x', hint: 'R', action: () => emit('close') },
];
</script>

<template>
  <section class="reader" aria-label="Reader screen">
    <header>
      <Icon name="device" :size="16" />
      <h2>Reader screen</h2>
      <span v-if="loading" class="spinner busy" role="status" aria-label="Refreshing"></span>
      <span class="grow"></span>
      <button class="btn ghost icon small" title="Refresh (Shift+R)" aria-label="Refresh the reader screen" :disabled="!connected || !available" @click="emit('refresh')"><Icon name="refresh" :size="16" /></button>
      <button class="btn ghost icon small" title="Hide the reader panel (R)" aria-label="Hide the reader panel" @click="emit('close')"><Icon name="x" :size="16" /></button>
    </header>

    <div v-if="!available" class="stage">
      <div class="unavailable">
        <Icon name="info" :size="22" />
        <p>{{ info }}</p>
      </div>
    </div>

    <div v-show="available" ref="stage" v-context="menu" class="stage">
      <div class="sheet" :class="{ dim, empty: !image }" :style="sheet">
        <img v-if="image" :src="image" alt="What the reader is showing right now" draggable="false" @load="onLoad" />
        <div v-else class="hold"><Icon name="device" :size="26" /><span>No picture yet</span></div>
      </div>
    </div>

    <footer v-show="available" class="note" role="status">
      <template v-if="!connected">
        <Icon name="unplug" :size="16" />
        <div class="msg"><b>Reader not connected</b><span :title="reason">{{ reason || 'Connect the reader to see its screen.' }}</span></div>
        <button v-if="canReconnect" class="btn small" :disabled="connecting" @click="emit('reconnect')"><span v-if="connecting" class="spinner"></span><Icon v-else name="refresh" :size="14" />Reconnect</button>
      </template>
      <template v-else-if="error">
        <Icon name="warn" :size="16" class="bad" />
        <div class="msg"><b>Can't read the screen</b><span :title="error">{{ error }}. Trying again.</span></div>
      </template>
      <template v-else-if="updated">
        <div class="msg"><span class="num">Updated {{ updated }}</span></div>
      </template>
      <template v-else-if="loading">
        <div class="msg"><span>Reading the reader's screen...</span></div>
      </template>
      <template v-else>
        <div class="msg"><span>Nothing read yet.</span></div>
        <button class="btn small" @click="emit('refresh')"><Icon name="refresh" :size="14" />Refresh</button>
      </template>
    </footer>
  </section>
</template>

<style scoped>
.reader { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--panel); }
header { display: flex; align-items: center; gap: 8px; height: 44px; flex: none; padding: 0 8px 0 14px; border-bottom: 1px solid var(--border); color: var(--muted); }
h2 { font-size: 13px; color: var(--text); }
.busy { opacity: 0; animation: reveal 0.2s 0.7s forwards; }
@keyframes reveal { to { opacity: 1; } }
.stage { flex: 1; min-height: 0; display: grid; place-items: center; overflow: hidden; background: var(--side); }
.sheet { position: relative; flex: none; overflow: hidden; background: var(--panel); border: 1px solid var(--border); box-shadow: var(--shadow); }
.sheet img { display: block; width: 100%; height: 100%; transition: opacity 0.2s; }
.sheet.dim img { opacity: 0.4; }
.sheet.empty { border-style: dashed; box-shadow: none; background: transparent; }
.hold { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--faint); }
.note { display: flex; align-items: center; gap: 10px; flex: none; min-height: 56px; padding: 8px 14px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); }
.note .msg { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.note .msg b { font-weight: 550; color: var(--text); }
.note .msg span { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
.bad { color: var(--danger); flex: none; }
.unavailable { display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: 220px; padding: 20px; text-align: center; color: var(--muted); }
.unavailable p { margin: 0; }
</style>
