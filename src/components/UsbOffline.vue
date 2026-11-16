<script setup lang="ts">
// Shown instead of a USB reader's content while the reader is not there: why, and a Retry that looks again right now.
import { ref } from 'vue';
import { refreshReaders } from '../lib/store';
import Icon from './Icon.vue';

defineProps<{ /** what the last failed request said, when there was one */ reason?: string }>();

const checking = ref(false);
const checked = ref(false);
async function retry() {
  checking.value = true;
  try {
    await refreshReaders();
  } catch {
    // the answer is the same as before: still not there
  } finally {
    checking.value = false;
    checked.value = true;
  }
}
</script>

<template>
  <div class="empty" data-drag>
    <div class="tile"><Icon name="usb" :size="28" /></div>
    <h2>The USB reader is not connected</h2>
    <p>Plug it in with a USB cable and unlock its screen. If it asks how to connect, choose file transfer (MTP). It appears here by itself.</p>
    <p v-if="reason" class="why selectable">{{ reason }}</p>
    <button class="btn primary" :disabled="checking" @click="retry"><span v-if="checking" class="spinner"></span><Icon v-else name="refresh" :size="16" />Retry</button>
    <p v-if="checked && !checking" class="again">Still not connected.</p>
  </div>
</template>

<style scoped>
.why { font: 12px var(--mono); color: var(--faint); background: var(--hover); border-radius: var(--radius-s); padding: 6px 10px; margin-bottom: 6px; }
.again { font-size: 12px; color: var(--faint); }
</style>
