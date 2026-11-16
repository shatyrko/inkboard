<script setup lang="ts">
// The "add widget" popover: opened from the toolbar, the A key, or the page's context menu (then it is anchored at the pointer).
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from '../components/Icon.vue';
import type { WidgetType } from './model';
import { registry } from './widgets';

const props = defineProps<{ x: number; y: number }>();
const emit = defineEmits<{ (e: 'pick', type: WidgetType): void; (e: 'close'): void }>();

const GROUPS: { label: string; types: WidgetType[] }[] = [
  { label: 'Content', types: ['text', 'checklist', 'image', 'clock', 'calendar', 'countdown'] },
  { label: 'Live data', types: ['system', 'reader', 'web', 'command'] },
  { label: 'Layout', types: ['box', 'nav', 'link'] },
];

const root = ref<HTMLElement | null>(null);
const pos = ref({ x: props.x, y: props.y });

onMounted(async () => {
  await nextTick();
  const el = root.value;
  if (!el) return;
  const m = 8;
  pos.value = {
    x: Math.max(m, Math.min(props.x, innerWidth - el.offsetWidth - m)),
    y: Math.max(m, Math.min(props.y, innerHeight - el.offsetHeight - m)),
  };
  (el.querySelector('button') as HTMLElement | null)?.focus();
  window.addEventListener('mousedown', outside, true);
});
onBeforeUnmount(() => window.removeEventListener('mousedown', outside, true));

function outside(e: MouseEvent) {
  if (!root.value?.contains(e.target as Node)) emit('close');
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); emit('close'); return; }
  const items = Array.from(root.value?.querySelectorAll<HTMLElement>('.item') ?? []);
  const i = items.indexOf(document.activeElement as HTMLElement);
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? 2 : e.key === 'ArrowUp' ? -2 : 0;
  if (!step) { if (e.key === 'Tab') { e.preventDefault(); emit('close'); } return; }
  e.preventDefault();
  e.stopPropagation();
  items[Math.max(0, Math.min(items.length - 1, i + step))]?.focus();
}
</script>

<template>
  <div ref="root" class="palette" role="dialog" aria-label="Add widget" :style="{ left: pos.x + 'px', top: pos.y + 'px' }" @keydown="onKey">
    <template v-for="g in GROUPS" :key="g.label">
      <div class="section-label">{{ g.label }}</div>
      <div class="grid">
        <button v-for="t in g.types" :key="t" class="item" @click="emit('pick', t)">
          <span class="ic"><Icon :name="registry[t].icon" :size="18" /></span>
          <span class="tx"><b>{{ registry[t].label }}</b><span>{{ registry[t].blurb }}</span></span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.palette { position: fixed; z-index: 85; width: 500px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto; padding: 10px 10px 12px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); animation: pop 0.12s ease-out; }
.section-label { margin: 10px 4px 6px; }
.section-label:first-child { margin-top: 2px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.item { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 10px; text-align: left; min-width: 0; }
.item:hover { background: var(--hover); }
.item:focus-visible { background: var(--accent-soft); outline-offset: -2px; }
.ic { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); flex: none; }
.tx { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
.tx b { font-weight: 550; }
.tx span { font-size: 12px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
