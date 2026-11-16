<script setup lang="ts">
// Note templates: PDFs the reader offers as page backgrounds when you write on it.
import { computed, ref } from 'vue';
import Icon from '../../components/Icon.vue';
import { api } from '../../lib/api';
import type { MenuItem } from '../../lib/contextmenu';
import { app } from '../../lib/store';
import type { TemplateEntry } from '../../lib/types';
import { confirmDialog, notify } from '../../lib/ui';
import { useDelayed } from '../shared/delayed';
import { pickPdfFiles } from '../shared/files';
import { plural } from '../shared/text';
import { loadWhenReady } from './loadWhenReady';

const props = defineProps<{ active: boolean }>();

const message = (e: unknown) => (typeof e === 'string' ? e : (e as Error)?.message || 'Something went wrong.');

const templates = ref<TemplateEntry[] | null>(null);
const error = ref('');
const uploading = ref(false);
const slow = useDelayed(computed(() => templates.value === null && !error.value));

async function load() {
  try {
    templates.value = await api.templatesList();
    error.value = '';
  } catch (e) {
    error.value = message(e);
  }
}
loadWhenReady(() => props.active && !!app.conn?.connected, load);

async function upload() {
  const paths = await pickPdfFiles('Upload note templates');
  if (!paths?.length) return;
  uploading.value = true;
  let sent = 0;
  try {
    for (const p of paths) {
      await api.templatesUpload(p);
      sent++;
    }
    notify(`Uploaded ${plural(sent, 'template')}`);
  } catch (e) {
    notify(`Could not upload the template: ${message(e)}`, 'error');
  } finally {
    uploading.value = false;
    await load();
  }
}

async function remove(t: TemplateEntry) {
  const ok = await confirmDialog({
    title: `Delete the template "${t.name}"?`,
    body: 'It is removed from the reader for good. This cannot be undone. Your own copy of the PDF is not touched.',
    confirm: 'Delete permanently',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.templatesDelete(t.id);
    notify(`Deleted "${t.name}"`);
  } catch (e) {
    notify(`Could not delete "${t.name}": ${message(e)}`, 'error');
  }
  await load();
}

const menu = (t: TemplateEntry): MenuItem[] => [{ label: 'Delete...', icon: 'trash', danger: true, action: () => remove(t) }];
</script>

<template>
  <div class="section-label">Note templates</div>
  <div v-if="templates" class="card">
    <div class="setting">
      <div class="t"><b>Templates on the reader</b><span>PDF pages the reader offers as backgrounds for handwritten notes.</span></div>
      <div class="ctl"><button class="btn" :disabled="uploading" @click="upload"><span v-if="uploading" class="spinner"></span><Icon v-else name="upload" :size="16" />Upload template...</button></div>
    </div>
    <ul v-if="templates.length" class="list" aria-label="Templates">
      <li v-for="t in templates" :key="t.id" v-context="() => menu(t)" class="row-t">
        <Icon name="file-text" :size="16" class="ic" />
        <span class="nm selectable">{{ t.name }}</span>
        <button class="btn ghost icon small" :aria-label="`Delete ${t.name}`" title="Delete..." @click="remove(t)"><Icon name="trash" :size="16" /></button>
      </li>
    </ul>
    <p v-else class="none">No templates yet. Upload a PDF to use it as a note background.</p>
  </div>
  <div v-else class="card state">
    <template v-if="error">
      <span class="why selectable">{{ error }}</span>
      <button class="btn small" @click="load"><Icon name="refresh" :size="15" />Try again</button>
    </template>
    <span v-else-if="slow" class="spinner"></span>
  </div>
</template>

<style scoped>
.list { list-style: none; margin: 0; padding: 0; }
.row-t { display: flex; align-items: center; gap: 12px; height: 46px; border-top: 1px solid var(--border); }
.ic { color: var(--muted); flex: none; }
.nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.none { margin: 0; padding: 12px 0 2px; border-top: 1px solid var(--border); color: var(--faint); }
.state { display: flex; align-items: center; gap: 12px; min-height: 64px; }
.why { color: var(--danger); flex: 1; }
</style>
