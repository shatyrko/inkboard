<script setup lang="ts">
// "Move to...": walk the folders of the reader (listed one level at a time) and pick where the items go.
import { computed, onMounted, ref } from 'vue';
import Icon from '../../components/Icon.vue';
import Modal from '../../components/Modal.vue';
import { api } from '../../lib/api';
import type { MtpEntry } from '../../lib/types';
import { useDelayed } from '../shared/delayed';
import { sortEntries } from './listing';
import { currentHandle, enterFolder, goTo, goUp, type Crumb } from './nav';

const props = defineProps<{
  title: string;
  readerId: string;
  storage: number;
  /** where the picker opens: the folder being looked at */
  start: Crumb[];
  /** the items being moved: their folders are not offered, and their own folder cannot be the target */
  moving: MtpEntry[];
}>();
const emit = defineEmits<{ pick: [target: { parent: number | null; name: string; existing: MtpEntry[] }]; close: [] }>();

const stack = ref<Crumb[]>([...props.start]);
const listing = ref<MtpEntry[]>([]);
const loading = ref(false);
const error = ref('');
const slow = useDelayed(loading);

const origin = currentHandle(props.start);
const hidden = new Set(props.moving.filter((m) => m.kind === 'folder').map((m) => m.handle));
const folders = computed(() => sortEntries(listing.value.filter((e) => e.kind === 'folder' && !hidden.has(e.handle)), 'name', 'asc'));
const here = computed(() => currentHandle(stack.value));
const canPick = computed(() => !loading.value && !error.value && here.value !== origin);

let seq = 0;
async function load() {
  const mine = ++seq;
  loading.value = true;
  error.value = '';
  try {
    const list = await api.mtpList(props.readerId, props.storage, here.value);
    if (mine === seq) listing.value = list;
  } catch (e) {
    if (mine === seq) { listing.value = []; error.value = typeof e === 'string' ? e : (e as Error)?.message || 'Could not read the folder.'; }
  } finally {
    if (mine === seq) loading.value = false;
  }
}
onMounted(load);

function go(next: Crumb[]) {
  stack.value = next;
  load();
}
function choose() {
  if (!canPick.value) return;
  emit('pick', { parent: here.value, name: stack.value[stack.value.length - 1].name, existing: listing.value });
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) { e.preventDefault(); go(goUp(stack.value)); }
}
</script>

<template>
  <Modal :title="title" @close="emit('close')" @submit="choose">
    <div class="pick" @keydown="onKey">
      <nav class="crumbs" aria-label="Folder">
        <template v-for="(c, i) in stack" :key="i">
          <Icon v-if="i" name="chevron-right" :size="13" class="sep" />
          <button class="crumb" :class="{ here: i === stack.length - 1 }" :aria-current="i === stack.length - 1 ? 'location' : undefined" @click="go(goTo(stack, i))">{{ c.name }}</button>
        </template>
      </nav>
      <div class="box" data-autofocus tabindex="-1">
        <div v-if="loading && !listing.length && slow" class="state"><span class="spinner"></span>Reading the folder...</div>
        <p v-else-if="error" class="state err" role="alert">{{ error }}</p>
        <template v-else>
          <button v-for="f in folders" :key="f.handle" class="row-f" @click="go(enterFolder(stack, f))"><Icon name="folder" :size="17" class="fi" /><span class="nm">{{ f.name }}</span><Icon name="chevron-right" :size="14" class="go" /></button>
          <p v-if="!loading && !folders.length" class="state">No folders here. You can still move the items into this one.</p>
        </template>
      </div>
      <p class="hint">Click a folder to open it. Backspace goes up one level.</p>
    </div>
    <template #footer>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="!canPick" @click="choose">Move here</button>
    </template>
  </Modal>
</template>

<style scoped>
.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin-bottom: 8px; }
.crumb { height: 26px; padding: 0 8px; border-radius: 6px; color: var(--muted); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crumb:hover { background: var(--hover); color: var(--text); }
.crumb.here { color: var(--text); font-weight: 550; }
.sep { color: var(--faint); flex: none; }
.box { height: 280px; overflow: auto; padding: 6px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); outline: none; }
.row-f { display: flex; align-items: center; gap: 10px; width: 100%; height: 34px; padding: 0 8px; border-radius: var(--radius-s); text-align: left; color: var(--text); }
.row-f:hover { background: var(--hover); }
.fi { color: var(--accent); flex: none; }
.nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.go { color: var(--faint); flex: none; }
.state { display: flex; align-items: center; gap: 10px; margin: 8px; color: var(--muted); }
.err { color: var(--danger); }
.hint { margin: 8px 0 0; }
</style>
