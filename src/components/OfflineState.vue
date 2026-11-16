<script setup lang="ts">
// Shown instead of a view's content while there is no live session with the paired reader: "connecting" during the first
// attempt, otherwise the reason and the two ways out (reconnect, or switch to another reader).
// `compact` is the same message as a card, for a page that has other content (Settings) next to it.
import { app, connectNow } from '../lib/store';
import { forgetReader } from '../views/shared/reader';
import Icon from './Icon.vue';

defineProps<{ compact?: boolean }>();
</script>

<template>
  <div v-if="compact" class="card cmp">
    <span v-if="app.connecting" class="spinner"></span>
    <Icon v-else name="unplug" :size="20" class="ic" />
    <div class="txt">
      <b>{{ app.connecting ? 'Connecting to the reader' : 'The reader is not connected' }}</b>
      <span v-if="!app.connecting">Its settings are available again once it is. <span v-if="app.connectError" class="selectable">{{ app.connectError }}</span></span>
    </div>
    <button v-if="!app.connecting" class="btn" @click="connectNow()"><Icon name="refresh" :size="16" />Reconnect</button>
  </div>

  <div v-else class="empty" data-drag>
    <template v-if="app.connecting">
      <div class="tile"><span class="spinner big"></span></div>
      <h2>Connecting to the reader</h2>
      <p>Looking for it at {{ app.conn?.addr ?? 'its address' }}. This usually takes a few seconds.</p>
    </template>
    <template v-else>
      <div class="tile"><Icon name="unplug" :size="28" /></div>
      <h2>The reader is not connected</h2>
      <p>Inkboard could not reach it. Check that the reader is awake, that its Wi-Fi is on, and that it is on the same network as this computer.</p>
      <p v-if="app.connectError" class="why selectable">{{ app.connectError }}</p>
      <button class="btn primary" @click="connectNow()"><Icon name="refresh" :size="16" />Reconnect</button>
      <button class="link" @click="forgetReader()">Use a different reader</button>
    </template>
  </div>
</template>

<style scoped>
.why { font: 12px var(--mono); color: var(--faint); background: var(--hover); border-radius: var(--radius-s); padding: 6px 10px; margin-bottom: 6px; }
.link { color: var(--accent); border-radius: 4px; margin-top: 2px; }
.link:hover { text-decoration: underline; }
.big { width: 26px; height: 26px; border-width: 3px; }
.cmp { display: flex; align-items: center; gap: 14px; }
.cmp .ic { color: var(--muted); flex: none; }
.cmp .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.cmp .txt span { color: var(--muted); font-size: 13px; }
</style>
