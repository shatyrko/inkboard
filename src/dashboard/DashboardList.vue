<script setup lang="ts">
import Icon from '../components/Icon.vue';
import { fmtDate } from '../lib/format';
import type { MenuItem } from '../lib/contextmenu';
import type { DashboardSummary } from '../lib/types';

const props = defineProps<{
  entries: DashboardSummary[];
  openId: string | null;
  /** a short extra line per dashboard id, e.g. "Pushes every 15 min" */
  notes: Record<string, string>;
}>();
const emit = defineEmits<{
  (e: 'open', id: string): void;
  (e: 'create'): void;
  (e: 'rename', id: string): void;
  (e: 'duplicate', id: string): void;
  (e: 'remove', id: string): void;
}>();

const menu = (d: DashboardSummary): MenuItem[] => [
  { label: 'Open', icon: 'folder-open', action: () => emit('open', d.id), disabled: d.id === props.openId },
  { label: 'Rename', icon: 'edit', hint: 'F2', action: () => emit('rename', d.id) },
  { label: 'Duplicate', icon: 'duplicate', action: () => emit('duplicate', d.id) },
  { separator: true },
  { label: 'Delete', icon: 'trash', hint: 'Del', danger: true, action: () => emit('remove', d.id) },
];
const background = (): MenuItem[] => [{ label: 'New dashboard', icon: 'plus', hint: 'Ctrl+N', action: () => emit('create') }];

function onKey(e: KeyboardEvent, d: DashboardSummary) {
  const rows = Array.from((e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('.entry') ?? []);
  const i = rows.indexOf(e.currentTarget as HTMLElement);
  if (e.key === 'ArrowDown') rows[Math.min(rows.length - 1, i + 1)]?.focus();
  else if (e.key === 'ArrowUp') rows[Math.max(0, i - 1)]?.focus();
  else if (e.key === 'F2') emit('rename', d.id);
  else if (e.key === 'Delete') emit('remove', d.id);
  else return;
  e.preventDefault();
  e.stopPropagation();
}
</script>

<template>
  <aside class="list" aria-label="Dashboards" v-context="background">
    <div class="top">
      <span class="section-label">Dashboards</span>
      <button class="btn ghost icon small" title="New dashboard (Ctrl+N)" aria-label="New dashboard" @click="emit('create')"><Icon name="plus" :size="16" /></button>
    </div>
    <div class="rows">
      <button
        v-for="d in entries"
        :key="d.id"
        v-context="() => menu(d)"
        class="entry"
        :class="{ sel: d.id === openId }"
        :aria-current="d.id === openId"
        @click="emit('open', d.id)"
        @keydown="onKey($event, d)"
      >
        <span class="nm">{{ d.name }}</span>
        <span class="meta">{{ [fmtDate(d.updated), notes[d.id]].filter(Boolean).join(' · ') }}</span>
      </button>
      <p v-if="!entries.length" class="hint none">No dashboards yet.</p>
    </div>
  </aside>
</template>

<style scoped>
.list { width: 212px; flex: none; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--border); background: var(--panel); }
.top { display: flex; align-items: center; justify-content: space-between; padding: 10px 8px 4px 16px; }
.top .section-label { margin: 0; }
.rows { flex: 1; min-height: 0; overflow: auto; padding: 4px 8px 12px; display: flex; flex-direction: column; gap: 2px; }
.entry { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 7px 10px; border-radius: var(--radius-s); text-align: left; width: 100%; min-width: 0; }
.entry:hover { background: var(--hover); }
.entry.sel { background: var(--accent-soft); }
.nm { font-weight: 550; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entry.sel .nm { color: var(--accent); }
.meta { font-size: 12px; color: var(--faint); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.none { padding: 4px 10px; }
</style>
