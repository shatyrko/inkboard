<script setup lang="ts">
// A select you can type into: for long lists such as time zones. Matching ignores case and accents and needs every word.
import { computed, nextTick, ref, useId } from 'vue';
import { matchesAll, words } from '../views/shared/text';
import Icon from './Icon.vue';

export type Option = { value: string; label: string };

const props = defineProps<{ modelValue: string; options: Option[]; label: string; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const listId = useId();
const open = ref(false);
const query = ref('');
const active = ref(0);
const list = ref<HTMLElement | null>(null);

const currentLabel = computed(() => props.options.find((o) => o.value === props.modelValue)?.label ?? props.modelValue);
const shown = computed(() => {
  const needles = words(query.value);
  return needles.length ? props.options.filter((o) => matchesAll(`${o.label} ${o.value}`, needles)) : props.options;
});

function show() {
  if (open.value) return;
  open.value = true;
  query.value = '';
  active.value = Math.max(0, props.options.findIndex((o) => o.value === props.modelValue));
  nextTick(reveal);
}
function hide() {
  open.value = false;
}
function reveal() {
  list.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
}
function pick(o?: Option) {
  if (!o) return;
  hide();
  if (o.value !== props.modelValue) emit('update:modelValue', o.value);
}
function onInput(e: Event) {
  open.value = true; // typing after Esc reopens the list
  query.value = (e.target as HTMLInputElement).value;
  active.value = 0;
  nextTick(reveal);
}
function onKey(e: KeyboardEvent) {
  const k = e.key;
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    e.preventDefault();
    if (!open.value) { show(); return; }
    active.value = Math.max(0, Math.min(shown.value.length - 1, active.value + (k === 'ArrowDown' ? 1 : -1)));
    nextTick(reveal);
  } else if (k === 'Enter' && open.value) {
    e.preventDefault();
    pick(shown.value[active.value]);
  } else if (k === 'Escape' && open.value) {
    e.stopPropagation(); // closes the list only; the next Esc reaches whatever is behind
    hide();
  }
}
</script>

<template>
  <div class="ss">
    <input
      class="input selectable"
      role="combobox"
      aria-autocomplete="list"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="listId"
      :placeholder="open ? currentLabel : placeholder"
      :value="open ? query : currentLabel"
      autocomplete="off"
      spellcheck="false"
      @focus="show"
      @click="show"
      @blur="hide"
      @input="onInput"
      @keydown="onKey"
    />
    <Icon name="chevron-down" :size="14" class="ss-chev" />
    <div v-if="open" :id="listId" ref="list" class="ss-list" role="listbox" :aria-label="label">
      <button
        v-for="(o, i) in shown"
        :key="o.value"
        class="ss-opt"
        :class="{ on: i === active }"
        role="option"
        tabindex="-1"
        :aria-selected="o.value === modelValue"
        :data-active="i === active"
        @mousedown.prevent
        @mousemove="active = i"
        @click="pick(o)"
      >
        <span class="ss-name">{{ o.label }}</span>
        <span v-if="o.value === modelValue" class="ss-check" aria-hidden="true">&#10003;</span>
      </button>
      <div v-if="!shown.length" class="ss-none">No match</div>
    </div>
  </div>
</template>

<style scoped>
.ss { position: relative; width: 100%; }
.ss .input { padding-right: 28px; }
.ss-chev { position: absolute; right: 9px; top: 9px; color: var(--faint); pointer-events: none; }
.ss-list { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; right: 0; max-height: 260px; overflow: auto; padding: 5px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); }
.ss-opt { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; border-radius: 8px; text-align: left; color: var(--text); }
.ss-opt.on { background: var(--accent-soft); color: var(--accent); }
.ss-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ss-check { font-size: 12px; }
.ss-none { padding: 8px 10px; color: var(--faint); }
</style>
