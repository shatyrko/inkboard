<script setup lang="ts">
// "Move to..." / "Copy to...": pick a folder on the reader from its tree.
import { computed, ref } from 'vue';
import Modal from '../../components/Modal.vue';
import FolderTree from './FolderTree.vue';
import { ROOT } from './paths';
import { reveal, type FolderNode } from './tree';

const props = defineProps<{
  title: string;
  confirm: string;
  root: FolderNode;
  nodes: ReadonlyMap<string, FolderNode>;
  /** folders already holding the items: not offered when moving */
  taken: ReadonlySet<string>;
  /** the folder to open the tree at */
  start: string;
}>();
const emit = defineEmits<{ pick: [node: FolderNode]; close: [] }>();

const selected = ref('');
const expanded = ref<ReadonlySet<string>>(reveal(new Set([ROOT]), props.start));
const unusable = (n: FolderNode) => !n.id || props.taken.has(n.path);
const chosen = computed(() => {
  const n = props.nodes.get(selected.value);
  return n && !unusable(n) ? n : null;
});

function toggle(path: string) {
  const next = new Set(expanded.value);
  if (!next.delete(path)) next.add(path);
  expanded.value = next;
}
function choose() {
  if (chosen.value) emit('pick', chosen.value);
}
</script>

<template>
  <Modal :title="title" @close="emit('close')" @submit="choose">
    <p class="lead">Choose a folder on the reader.<template v-if="taken.size"> Folders that already hold {{ taken.size > 1 ? 'these items' : 'this item' }} are dimmed.</template></p>
    <div class="box">
      <FolderTree
        data-autofocus
        label="Folders on the reader"
        :root="root"
        :selected="selected"
        :expanded="expanded"
        :disabled="unusable"
        @select="selected = $event"
        @toggle="toggle"
        @activate="choose"
      />
    </div>
    <template #footer>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="!chosen" @click="choose">{{ confirm }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.lead { margin: 0 0 10px; }
.box { height: 300px; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); }
</style>
