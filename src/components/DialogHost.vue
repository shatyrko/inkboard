<script setup lang="ts">
// Renders confirmDialog / askDialog / chooseDialog (src/lib/ui.ts) and the toast.
import { ref, watch, nextTick, computed } from 'vue';
import { dialog, toasts } from '../lib/ui';
import Icon from './Icon.vue';

const text = ref('');
const panel = ref<HTMLElement | null>(null);
const field = ref<HTMLInputElement | null>(null);
const cur = computed(() => dialog.current);

watch(cur, async (d) => {
  if (!d) return;
  text.value = d.kind === 'ask' ? d.value : '';
  await nextTick();
  if (d.kind === 'ask') field.value?.select();
  else if (d.kind === 'confirm' && d.danger) (panel.value?.querySelector('[data-safe]') as HTMLElement | null)?.focus();
  else (panel.value?.querySelector('[data-default]') as HTMLElement | null)?.focus();
});

function close(v: boolean | string | null) {
  const d = dialog.current;
  if (!d) return;
  dialog.current = null;
  if (d.kind === 'confirm') d.resolve(v === true);
  else d.resolve(typeof v === 'string' ? v : null);
}
function onKey(e: KeyboardEvent) {
  const d = dialog.current;
  if (!d) return;
  if (e.key === 'Escape') { e.stopPropagation(); close(d.kind === 'confirm' ? false : null); }
  else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); close(d.kind === 'confirm' ? true : d.kind === 'ask' ? text.value : null); }
  else if (e.key === 'Enter' && d.kind === 'ask' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); close(text.value); }
  else if (e.key === 'Tab') {
    // keep focus inside the dialog
    const f = Array.from(panel.value?.querySelectorAll('button, input') ?? []) as HTMLElement[];
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1;
    e.preventDefault();
    f[next].focus();
  }
}
</script>

<template>
  <div v-if="cur" class="scrim" @mousedown.self="close(cur.kind === 'confirm' ? false : null)" @keydown.capture="onKey">
    <div ref="panel" class="dialog" :role="cur.kind === 'confirm' ? 'alertdialog' : 'dialog'" aria-modal="true" aria-labelledby="dlg-title">
      <header>
        <h2 id="dlg-title">{{ cur.title }}</h2>
        <button class="btn ghost icon small" aria-label="Close" @click="close(cur.kind === 'confirm' ? false : null)"><Icon name="x" :size="16" /></button>
      </header>
      <div class="body">
        <p v-if="cur.body" style="margin: 0 0 10px">{{ cur.body }}</p>
        <div v-if="cur.kind === 'ask'" class="field">
          <label v-if="cur.label" for="dlg-input">{{ cur.label }}</label>
          <input id="dlg-input" ref="field" v-model="text" class="input selectable" :placeholder="cur.placeholder" autocomplete="off" spellcheck="false" />
        </div>
      </div>
      <footer>
        <template v-if="cur.kind === 'confirm'">
          <button class="btn" data-safe @click="close(false)">Cancel</button>
          <button class="btn" :class="cur.danger ? 'danger' : 'primary'" data-default @click="close(true)">{{ cur.confirm }}</button>
        </template>
        <template v-else-if="cur.kind === 'ask'">
          <button class="btn" @click="close(null)">Cancel</button>
          <button class="btn primary" :disabled="!text.trim()" @click="close(text)">{{ cur.confirm }}</button>
        </template>
        <template v-else>
          <button v-for="b in cur.buttons" :key="b.value" class="btn" :class="b.kind === 'primary' ? 'primary' : b.kind === 'danger' ? 'danger' : ''" @click="close(b.value)">{{ b.label }}</button>
        </template>
      </footer>
    </div>
  </div>
  <div class="toasts" role="status" aria-live="polite">
    <div v-for="t in toasts.items" :key="t.id" class="toast" :class="t.kind">
      <span class="ic"><Icon :name="t.kind === 'error' ? 'warn' : 'ok'" :size="18" /></span>
      <span>{{ t.text }}</span>
    </div>
  </div>
</template>
