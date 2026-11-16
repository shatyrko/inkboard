<script setup lang="ts">
import { nextTick, ref } from 'vue';
import Icon from '../components/Icon.vue';
import type { MenuItem } from '../lib/contextmenu';
import type { Page } from './model';

const props = defineProps<{ pages: Page[]; currentId: string }>();
const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'add'): void;
  (e: 'rename', id: string): void;
  (e: 'duplicate', id: string): void;
  (e: 'remove', id: string): void;
  (e: 'move', id: string, delta: number): void;
}>();

const list = ref<HTMLElement | null>(null);

// drag a tab sideways to reorder; `to` is the index the tab would end up at
const drag = ref<{ from: number; to: number } | null>(null);
let pressed = -1;
let startX = 0;

function onDown(e: PointerEvent, i: number) {
  if (e.button !== 0) return;
  pressed = i;
  startX = e.clientX;
  (e.currentTarget as Element).setPointerCapture(e.pointerId);
}

function onMove(e: PointerEvent) {
  if (pressed < 0 || (!drag.value && Math.abs(e.clientX - startX) < 6)) return;
  const tabs = Array.from(list.value?.querySelectorAll<HTMLElement>('.tab') ?? []);
  const before = tabs.findIndex((t) => { const r = t.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
  const to = before < 0 ? tabs.length - 1 : before > pressed ? before - 1 : before;
  drag.value = { from: pressed, to };
}

function onUp() {
  const d = drag.value;
  if (d && d.to !== d.from) emit('move', props.pages[d.from].id, d.to - d.from);
  drag.value = null;
  pressed = -1;
}

function menu(page: Page, index: number): MenuItem[] {
  emit('select', page.id);
  return [
    { label: 'Rename', icon: 'edit', hint: 'F2', action: () => emit('rename', page.id) },
    { label: 'Duplicate page', icon: 'duplicate', action: () => emit('duplicate', page.id) },
    { separator: true },
    { label: 'Move left', icon: 'arrow-left', hint: 'Alt+Shift+←', disabled: index === 0, action: () => emit('move', page.id, -1) },
    { label: 'Move right', icon: 'arrow-right', hint: 'Alt+Shift+→', disabled: index === props.pages.length - 1, action: () => emit('move', page.id, 1) },
    { separator: true },
    { label: 'Delete page', icon: 'trash', hint: 'Del', disabled: props.pages.length < 2, action: () => emit('remove', page.id) },
  ];
}

// roving focus: arrows move between tabs, Alt+Shift+arrows reorder, Delete removes the page
async function onKey(e: KeyboardEvent, i: number) {
  const last = props.pages.length - 1;
  let to = -1;
  if (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    emit('move', props.pages[i].id, e.key === 'ArrowLeft' ? -1 : 1);
    e.preventDefault();
    await nextTick();
    (list.value?.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus();
    return;
  }
  if (e.key === 'ArrowLeft') to = Math.max(0, i - 1);
  else if (e.key === 'ArrowRight') to = Math.min(last, i + 1);
  else if (e.key === 'Home') to = 0;
  else if (e.key === 'End') to = last;
  else if (e.key === 'Delete' && props.pages.length > 1) { emit('remove', props.pages[i].id); e.preventDefault(); e.stopPropagation(); return; }
  else return;
  e.preventDefault();
  e.stopPropagation();
  emit('select', props.pages[to].id);
  await nextTick();
  (list.value?.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus();
}
</script>

<template>
  <div class="tabs">
    <div ref="list" class="list" role="tablist" aria-label="Pages">
      <button
        v-for="(p, i) in pages"
        :key="p.id"
        v-context="() => menu(p, i)"
        class="tab"
        :class="{ on: p.id === currentId, 'drop-before': drag && drag.to === i && drag.to < drag.from, 'drop-after': drag && drag.to === i && drag.to > drag.from }"
        role="tab"
        :aria-selected="p.id === currentId"
        :tabindex="p.id === currentId ? 0 : -1"
        :title="`${p.name} (double-click to rename)`"
        @pointerdown="onDown($event, i)"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @click="emit('select', p.id)"
        @dblclick="emit('rename', p.id)"
        @keydown="onKey($event, i)"
      >
        <span class="n num">{{ i + 1 }}</span>
        <span class="name">{{ p.name }}</span>
      </button>
    </div>
    <button class="btn ghost icon small" title="Add page (Ctrl+T)" aria-label="Add page" @click="emit('add')"><Icon name="plus" :size="16" /></button>
  </div>
</template>

<style scoped>
.tabs { display: flex; align-items: center; gap: 4px; min-width: 0; }
.list { display: flex; gap: 4px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.list::-webkit-scrollbar { display: none; }
.tab { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 11px 0 8px; border-radius: var(--radius-s); color: var(--muted); max-width: 200px; flex: none; }
.tab:hover { background: var(--hover); color: var(--text); }
.tab.on { background: var(--accent-soft); color: var(--accent); font-weight: 550; }
.tab.drop-before { box-shadow: inset 2px 0 0 var(--accent); }
.tab.drop-after { box-shadow: inset -2px 0 0 var(--accent); }
.n { display: grid; place-items: center; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 99px; font-size: 11px; background: var(--hover); }
.tab.on .n { background: color-mix(in srgb, var(--accent) 22%, transparent); }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
