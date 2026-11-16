<script setup lang="ts">
// Picks a picture for the Image widget: the native file dialog, then the Rust side reads it into a data URL that is stored in the document.
import { ref } from 'vue';
import Icon from '../components/Icon.vue';
import { api, pickFiles } from '../lib/api';
import { attempt } from '../lib/ui';
import { inTauri } from '../lib/window';

const props = defineProps<{ src: string; name: string }>();
const emit = defineEmits<{ (e: 'change', src: string, name: string): void }>();
const busy = ref(false);

async function choose() {
  // a plain browser has no native picker: the mock backend then hands back a sample picture
  const picked = inTauri ? await pickFiles({ title: 'Choose a picture', multiple: false, extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }) : ['sample.png'];
  if (!picked?.length) return;
  busy.value = true;
  const src = await attempt(() => api.readImage(picked[0]), 'Could not read the picture');
  busy.value = false;
  if (src) emit('change', src, picked[0].split(/[\\/]/).pop() ?? '');
}
</script>

<template>
  <div class="pic">
    <div class="thumb" :class="{ empty: !src }">
      <img v-if="src" :src="src" alt="" draggable="false" />
      <Icon v-else name="image" :size="22" />
    </div>
    <div class="side">
      <div class="file" :title="name">{{ src ? name || 'Picture' : 'No picture yet' }}</div>
      <div class="row">
        <button class="btn small" :disabled="busy" @click="choose"><Icon name="image-plus" :size="14" />{{ src ? 'Change' : 'Choose picture' }}</button>
        <button v-if="props.src" class="btn ghost small" @click="emit('change', '', '')">Remove</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pic { display: flex; gap: 12px; align-items: center; }
.thumb { width: 64px; height: 64px; flex: none; border-radius: var(--radius-s); border: 1px solid var(--border); background: var(--panel-2); display: grid; place-items: center; overflow: hidden; color: var(--faint); }
.thumb img { width: 100%; height: 100%; object-fit: cover; filter: grayscale(1); }
.side { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.file { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
</style>
