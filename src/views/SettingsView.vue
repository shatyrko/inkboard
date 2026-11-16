<script setup lang="ts">
// Settings in four groups: the reader itself (clock, Wi-Fi, templates), the app, and the pairing.
import { computed, onActivated, onDeactivated, ref } from 'vue';
import OfflineState from '../components/OfflineState.vue';
import PageBar from '../components/PageBar.vue';
import { app, loadSettings } from '../lib/store';
import { attempt } from '../lib/ui';
import AppSection from './settings/AppSection.vue';
import PairedSection from './settings/PairedSection.vue';
import ReaderSection from './settings/ReaderSection.vue';
import TemplatesSection from './settings/TemplatesSection.vue';
import WifiSection from './settings/WifiSection.vue';

const visible = ref(false);
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
        <template v-if="online">
          <ReaderSection :active="visible" />
          <WifiSection :active="visible" />
          <TemplatesSection :active="visible" />
        </template>
        <template v-else>
          <div class="section-label">Reader</div>
          <OfflineState compact />
        </template>
        <AppSection />
        <PairedSection />
      </div>
    </div>
  </section>
</template>
