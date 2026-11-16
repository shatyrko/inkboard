<script setup lang="ts">
// Dialog shell for flows that need more than confirm / ask / choose (folder picker, add network): scrim, panel, header with
// close button, body and footer slots. Esc closes it (and stops there, so it closes one layer at a time), Tab stays inside,
// focus returns to where it was.
import { onBeforeUnmount, onMounted, ref, useId } from 'vue';
import Icon from './Icon.vue';

defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: []; submit: [] }>();

const titleId = useId();
const panel = ref<HTMLElement | null>(null);
let returnTo: HTMLElement | null = null;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

onMounted(() => {
  returnTo = document.activeElement as HTMLElement | null;
  const el = panel.value;
  const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
  first?.focus();
});
onBeforeUnmount(() => returnTo?.focus?.({ preventScroll: true }));

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    emit('close');
  } else if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    emit('submit');
  } else if (e.key === 'Tab') {
    const items = Array.from(panel.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
    e.preventDefault();
    items[next].focus();
  }
}
</script>

<template>
  <div class="scrim" @mousedown.self="emit('close')" @keydown="onKey">
    <div ref="panel" class="dialog" :class="{ wide }" role="dialog" aria-modal="true" :aria-labelledby="titleId">
      <header>
        <h2 :id="titleId">{{ title }}</h2>
        <button class="btn ghost icon small" aria-label="Close" @click="emit('close')"><Icon name="x" :size="16" /></button>
      </header>
      <div class="body"><slot /></div>
      <footer v-if="$slots.footer"><slot name="footer" /></footer>
    </div>
  </div>
</template>
