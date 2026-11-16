<script setup lang="ts">
// The reader the views are about, at the top of the sidebar. A click (or Enter / Space) opens the app's own menu with every
// known reader, the active one checked, and the way to add a Digital Paper. Ctrl+` cycles (handled in App.vue).
import { computed, ref } from 'vue';
import type { MenuItem } from '../lib/contextmenu';
import { activeReader, app, selectReader } from '../lib/store';
import { readerStatus } from '../lib/readerList';
import { readerTitle } from '../lib/readers';
import Icon from './Icon.vue';

const emit = defineEmits<{ add: [] }>();

const button = ref<HTMLElement | null>(null);
const active = computed(() => activeReader());
const status = computed(() => (active.value ? readerStatus(active.value, app.connecting) : ''));
const hasDpt = computed(() => app.readers.some((r) => r.kind === 'digital-paper'));
const glyph = (link: 'wifi' | 'usb') => (link === 'usb' ? 'usb' : 'wifi');

const items = (): MenuItem[] => [
  ...app.readers.map((r) => ({
    label: readerTitle(r),
    icon: glyph(r.link),
    checked: r.id === active.value?.id,
    hint: r.connected ? (r.link === 'usb' ? 'USB' : 'Wi-Fi') : 'not connected',
    action: () => selectReader(r.id),
  })),
  { separator: true },
  { label: hasDpt.value ? 'Pair another Digital Paper...' : 'Add a Digital Paper...', icon: 'plus', action: () => emit('add') },
];

/** opens the same menu a right click would, right under the button */
function open() {
  const el = button.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left, clientY: r.bottom + 4 }));
}
</script>

<template>
  <button
    v-if="active"
    ref="button"
    v-context="items"
    class="rs"
    :class="{ off: !active.connected }"
    title="Switch reader (Ctrl+`)"
    aria-haspopup="menu"
    :aria-label="`Reader: ${readerTitle(active)}, ${status}. Switch reader`"
    @click="open"
  >
    <span class="glyph"><Icon :name="glyph(active.link)" :size="16" /></span>
    <span class="txt">
      <b>{{ readerTitle(active) }}</b>
      <span class="st"><i class="dot" :class="active.connected ? 'ok' : app.connecting && active.id === 'dpt' ? '' : 'bad'"></i>{{ status }}</span>
    </span>
    <Icon name="chevrons-updown" :size="15" class="chev" />
  </button>
</template>

<style scoped>
.rs { display: flex; align-items: center; gap: 10px; width: calc(100% - 20px); margin: 2px 10px 8px; padding: 7px 8px; text-align: left; border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel-2); }
.rs:hover { background: color-mix(in srgb, var(--panel-2) 80%, var(--text) 8%); }
.glyph { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: 9px; background: var(--accent-soft); color: var(--accent); }
.rs.off .glyph { background: var(--hover); color: var(--faint); }
.txt { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.3; }
.txt b { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.st .dot { width: 7px; height: 7px; }
.chev { flex: none; color: var(--faint); }
</style>
