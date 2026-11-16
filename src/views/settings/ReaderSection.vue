<script setup lang="ts">
// Date, time, time zone, standby and owner of the reader itself, plus setting its clock from this computer.
import { computed, ref, watch } from 'vue';
import Icon from '../../components/Icon.vue';
import SearchSelect from '../../components/SearchSelect.vue';
import { api } from '../../lib/api';
import { app } from '../../lib/store';
import { notify } from '../../lib/ui';
import { useDelayed } from '../shared/delayed';
import { loadWhenReady } from './loadWhenReady';
import { dateFormatChoices, standbyChoices, timeZoneChoices } from './options';
import { useReaderConfig } from './useReaderConfig';

const props = defineProps<{ active: boolean }>();
const { config, error, load, save } = useReaderConfig();
loadWhenReady(() => props.active && !!app.conn?.connected, load);
const slow = useDelayed(computed(() => !config.value && !error.value));

const dates = computed(() => dateFormatChoices(config.value?.dateFormat ?? ''));
const standby = computed(() => standbyChoices(config.value?.timeoutToStandby ?? ''));
const zones = computed(() => timeZoneChoices(config.value?.timezone ?? ''));
const clocks = [{ value: '12hour', label: '12-hour' }, { value: '24hour', label: '24-hour' }];

// the owner name is text: it saves when the field is left or Enter is pressed, not on every keystroke
const owner = ref('');
watch(() => config.value?.owner, (o) => { owner.value = o ?? ''; }, { immediate: true });
function commitOwner() {
  const next = owner.value.trim();
  if (config.value && next !== config.value.owner) save('owner', next);
  else owner.value = config.value?.owner ?? '';
}

const syncing = ref(false);
async function syncClock() {
  syncing.value = true;
  try {
    await api.syncClock();
    notify("Set the reader's clock from this computer");
  } catch (e) {
    notify(`Could not set the clock: ${typeof e === 'string' ? e : (e as Error)?.message || 'something went wrong'}`, 'error');
  } finally {
    syncing.value = false;
  }
}
</script>

<template>
  <div class="section-label">Reader</div>
  <div v-if="config" class="card">
    <div class="setting">
      <div class="t"><b>Date format</b><span>How dates appear on the reader.</span></div>
      <div class="ctl">
        <select class="select" aria-label="Date format" :value="config.dateFormat" @change="save('date_format', ($event.target as HTMLSelectElement).value)">
          <option v-for="c in dates" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
      </div>
    </div>
    <div class="setting">
      <div class="t"><b>Time format</b></div>
      <div class="ctl">
        <div class="seg" role="radiogroup" aria-label="Time format">
          <button v-for="c in clocks" :key="c.value" role="radio" :aria-checked="config.timeFormat === c.value" :class="{ on: config.timeFormat === c.value }" @click="save('time_format', c.value)">{{ c.label }}</button>
        </div>
      </div>
    </div>
    <div class="setting">
      <div class="t"><b>Time zone</b><span>Type to search, for example "Berlin".</span></div>
      <div class="ctl"><SearchSelect :model-value="config.timezone" :options="zones" label="Time zone" @update:model-value="save('timezone', $event)" /></div>
    </div>
    <div class="setting">
      <div class="t"><b>Auto standby</b><span>The reader goes to sleep after this long without use.</span></div>
      <div class="ctl">
        <select class="select" aria-label="Auto standby" :value="config.timeoutToStandby" @change="save('timeout_to_standby', ($event.target as HTMLSelectElement).value)">
          <option v-for="c in standby" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
      </div>
    </div>
    <div class="setting">
      <div class="t"><b>Owner name</b><span>Stored on the reader.</span></div>
      <div class="ctl"><input v-model="owner" class="input selectable" aria-label="Owner name" autocomplete="off" spellcheck="false" @blur="commitOwner" @keydown.enter="($event.target as HTMLInputElement).blur()" /></div>
    </div>
    <div class="setting">
      <div class="t"><b>Clock</b><span>Copies this computer's date and time to the reader.</span></div>
      <div class="ctl"><button class="btn" :disabled="syncing" @click="syncClock"><span v-if="syncing" class="spinner"></span><Icon v-else name="clock" :size="16" />Set from this computer</button></div>
    </div>
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
.state { display: flex; align-items: center; gap: 12px; min-height: 64px; }
.why { color: var(--danger); flex: 1; }
</style>
