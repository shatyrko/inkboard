<script setup lang="ts">
// Edits the items of a Checklist widget: tick, retype, reorder, delete, add. Enter in the last item adds another.
import { nextTick, ref } from 'vue';
import Icon from '../components/Icon.vue';
import { newId } from './ids';
import type { ChecklistItem } from './model';

const props = defineProps<{ items: ChecklistItem[] }>();
const emit = defineEmits<{ (e: 'change', items: ChecklistItem[]): void }>();

const list = ref<HTMLElement | null>(null);

const replace = (i: number, patch: Partial<ChecklistItem>) => emit('change', props.items.map((it, n) => (n === i ? { ...it, ...patch } : it)));
const remove = (i: number) => emit('change', props.items.filter((_, n) => n !== i));
function move(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= props.items.length) return;
  const next = [...props.items];
  next.splice(j, 0, next.splice(i, 1)[0]);
  emit('change', next);
}

async function add(after = props.items.length - 1) {
  const next = [...props.items];
  next.splice(after + 1, 0, { id: newId(), text: '', done: false });
  emit('change', next);
  await nextTick();
  (list.value?.querySelectorAll<HTMLInputElement>('input[type=text]')[after + 1])?.focus();
}

function onKey(e: KeyboardEvent, i: number) {
  if (e.key === 'Enter') { e.preventDefault(); void add(i); }
  else if (e.key === 'Backspace' && !props.items[i].text && props.items.length > 0) { e.preventDefault(); remove(i); void nextTick(() => list.value?.querySelectorAll<HTMLInputElement>('input[type=text]')[Math.max(0, i - 1)]?.focus()); }
  else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
  else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
}
</script>

<template>
  <div ref="list" class="items">
    <div v-for="(it, i) in items" :key="it.id" class="item">
      <input type="checkbox" class="tick" :checked="it.done" :aria-label="`Done: ${it.text || 'item ' + (i + 1)}`" @change="replace(i, { done: ($event.target as HTMLInputElement).checked })" />
      <input type="text" class="input selectable" :value="it.text" placeholder="Item" spellcheck="false" :aria-label="`Item ${i + 1}`" @input="replace(i, { text: ($event.target as HTMLInputElement).value })" @keydown="onKey($event, i)" />
      <button class="btn ghost icon small" :title="'Move up (Alt+↑)'" aria-label="Move up" :disabled="i === 0" @click="move(i, -1)"><Icon name="arrow-up" :size="14" /></button>
      <button class="btn ghost icon small" :title="'Move down (Alt+↓)'" aria-label="Move down" :disabled="i === items.length - 1" @click="move(i, 1)"><Icon name="arrow-down" :size="14" /></button>
      <button class="btn ghost icon small" title="Remove item" aria-label="Remove item" @click="remove(i)"><Icon name="x" :size="14" /></button>
    </div>
    <button class="btn small add" @click="add()"><Icon name="plus" :size="14" />Add item</button>
  </div>
</template>

<style scoped>
.items { display: flex; flex-direction: column; gap: 6px; }
.item { display: flex; align-items: center; gap: 4px; }
.item .input { height: 30px; flex: 1; }
.item .btn.icon { width: 26px; height: 28px; flex: none; }
.tick { accent-color: var(--accent); width: 16px; height: 16px; margin: 0 4px 0 2px; flex: none; }
.add { align-self: flex-start; }
</style>
