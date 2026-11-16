<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import Icon from './Icon.vue';
import { inTauri, win } from '../lib/window';

const maximized = ref(false);
// shown inside Tauri, plus a ?chrome URL switch for browser screenshots
const show = inTauri || location.search.includes('chrome');
let off: (() => void) | undefined;
async function refresh() { maximized.value = await win.isMaximized(); }
onMounted(async () => { refresh(); off = await win.onResized(refresh); });
onBeforeUnmount(() => off && off());
</script>

<template>
  <div v-if="show" class="winctl" data-nodrag>
    <button title="Minimise" aria-label="Minimise" @click="win.minimize()"><Icon name="minus" :size="16" /></button>
    <button :title="maximized ? 'Restore' : 'Maximise'" :aria-label="maximized ? 'Restore' : 'Maximise'" @click="win.toggleMaximize()">
      <Icon :name="maximized ? 'copy' : 'square'" :size="maximized ? 14 : 13" />
    </button>
    <button class="close" title="Close" aria-label="Close" @click="win.close()"><Icon name="x" :size="17" /></button>
  </div>
</template>
