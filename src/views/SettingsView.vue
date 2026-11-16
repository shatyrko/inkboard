<script setup lang="ts">
// Settings in groups: the reader itself (clock, Wi-Fi, templates; only for readers that have them), the app, and the pairing.
import { computed, onActivated, onDeactivated, ref } from 'vue';
import Icon from '../components/Icon.vue';
import OfflineState from '../components/OfflineState.vue';
import PageBar from '../components/PageBar.vue';
import { capabilities, readerTitle } from '../lib/readers';
import { activeReader, app, loadSettings } from '../lib/store';
import { attempt } from '../lib/ui';
import AppSection from './settings/AppSection.vue';
import PairedSection from './settings/PairedSection.vue';
import ReaderSection from './settings/ReaderSection.vue';
import TemplatesSection from './settings/TemplatesSection.vue';
import WifiSection from './settings/WifiSection.vue';

const visible = ref(false);
const reader = computed(() => activeReader());
const caps = computed(() => capabilities(reader.value?.kind ?? 'digital-paper'));
// the Digital Paper is reached over Wi-Fi; its settings need a live session
const online = computed(() => !!app.conn?.connected);

onActivated(() => {
  visible.value = true;
  if (!app.settings) attempt(loadSettings);
});
onDeactivated(() => { visible.value = false; });
</script>

<template>
  <section class="view">
    <PageBar title="Settings" />
    <div class="scroll">
      <div class="page">
        <template v-if="caps.deviceSettings">
          <template v-if="online">
            <ReaderSection :active="visible" />
            <WifiSection v-if="caps.wifiManagement" :active="visible" />
            <TemplatesSection v-if="caps.files === 'documents'" :active="visible" />
          </template>
          <template v-else>
            <div class="section-label">Reader</div>
            <OfflineState compact />
          </template>
        </template>
        <template v-else>
          <div class="section-label">Reader</div>
          <div class="card note">
            <Icon name="info" :size="20" class="ic" />
            <div class="txt">
              <b>Settings on this reader are changed on the reader itself</b>
              <span>Date and time, Wi-Fi, standby and the rest live in the settings of the {{ reader ? readerTitle(reader) : 'reader' }}. Inkboard only manages its files.</span>
            </div>
          </div>
        </template>
        <AppSection />
        <PairedSection v-if="app.conn?.configured" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.note { display: flex; align-items: flex-start; gap: 14px; }
.note .ic { color: var(--muted); flex: none; margin-top: 2px; }
.note .txt { display: flex; flex-direction: column; }
.note .txt span { color: var(--muted); font-size: 13px; }
</style>
