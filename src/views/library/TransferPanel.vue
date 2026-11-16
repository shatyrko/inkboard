<script setup lang="ts">
// Uploads and downloads in flight, as a small panel that never blocks the table. Finished transfers fade out by themselves
// (the parent removes them); failed ones stay until dismissed.
import Icon from '../../components/Icon.vue';
import type { TransferProgress } from '../../lib/types';
import { describeTransfer, percent } from './transfers';

defineProps<{ items: TransferProgress[] }>();
const emit = defineEmits<{ dismiss: [id: string] }>();
</script>

<template>
  <div v-if="items.length" class="tp" role="region" aria-label="Transfers" aria-live="polite">
    <div v-for="t in items" :key="t.id" class="t" :class="{ bad: t.error }">
      <Icon :name="t.error ? 'warn' : t.done ? 'ok' : t.direction === 'up' ? 'upload' : 'download'" :size="16" class="ic" />
      <div class="mid">
        <div class="nm" :title="t.name">{{ t.direction === 'up' ? 'Uploading' : 'Downloading' }} {{ t.name }}</div>
        <div v-if="t.error" class="sub selectable">{{ t.error }}</div>
        <template v-else>
          <div class="meter" :class="{ ok: t.done }" role="progressbar" :aria-label="t.name" :aria-valuenow="percent(t)" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: percent(t) + '%' }"></i></div>
          <div class="sub num">{{ describeTransfer(t) }}</div>
        </template>
      </div>
      <button v-if="t.error" class="btn ghost icon small" aria-label="Dismiss" title="Dismiss" @click="emit('dismiss', t.id)"><Icon name="x" :size="15" /></button>
    </div>
  </div>
</template>

<style scoped>
.tp { position: absolute; right: 16px; bottom: 16px; z-index: 5; width: 340px; max-width: calc(100% - 32px); display: flex; flex-direction: column; gap: 6px; }
.t { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: var(--radius); background: var(--panel-2); border: 1px solid var(--border); box-shadow: var(--shadow); }
.t.bad { border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); }
.ic { margin-top: 1px; color: var(--accent); flex: none; }
.t.bad .ic { color: var(--danger); }
.mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.sub { font-size: 12px; color: var(--faint); margin-top: -2px; }
.t.bad .sub { color: var(--muted); margin-top: 0; }
.meter { height: 5px; }
</style>
