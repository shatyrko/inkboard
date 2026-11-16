<script setup lang="ts">
// Joins the reader to a Wi-Fi network: pick one the reader can see, or type the name for a hidden one.
import { computed, nextTick, onMounted, ref } from 'vue';
import Icon from '../../components/Icon.vue';
import Modal from '../../components/Modal.vue';
import { api } from '../../lib/api';
import type { WifiScanResult } from '../../lib/types';
import { signalLabel, strongestPerSsid } from './options';

const emit = defineEmits<{ close: []; added: [ssid: string] }>();

const message = (e: unknown) => (typeof e === 'string' ? e : (e as Error)?.message || 'Something went wrong.');

const found = ref<WifiScanResult[]>([]);
const scanning = ref(false);
const scanError = ref('');
const list = computed(() => strongestPerSsid(found.value));

const ssid = ref('');
const security = ref<'psk' | 'nonsec'>('psk');
const password = ref('');
const reveal = ref(false);
const joining = ref(false);
const error = ref('');
const passwordField = ref<HTMLInputElement | null>(null);
const canJoin = computed(() => !!ssid.value.trim() && (security.value === 'nonsec' || !!password.value) && !joining.value);

async function scan() {
  if (scanning.value) return;
  scanning.value = true;
  scanError.value = '';
  try {
    found.value = await api.wifiScan();
  } catch (e) {
    scanError.value = message(e);
  } finally {
    scanning.value = false;
  }
}
onMounted(scan);

async function choose(n: WifiScanResult) {
  ssid.value = n.ssid;
  // the reader only joins open and password-protected networks; anything else is tried with a password
  security.value = n.security === 'nonsec' ? 'nonsec' : 'psk';
  error.value = '';
  await nextTick();
  passwordField.value?.focus();
}

async function join() {
  if (!canJoin.value) return;
  joining.value = true;
  error.value = '';
  try {
    const name = ssid.value.trim();
    await api.wifiConnect({ ssid: name, security: security.value, password: security.value === 'psk' ? password.value : '', dhcp: true });
    emit('added', name);
    emit('close');
  } catch (e) {
    error.value = message(e);
  } finally {
    joining.value = false;
  }
}
</script>

<template>
  <Modal title="Add a Wi-Fi network" @close="emit('close')" @submit="join">
    <div class="row head">
      <b>Networks the reader can see</b>
      <span class="grow"></span>
      <button class="btn ghost small" :disabled="scanning" @click="scan"><span v-if="scanning" class="spinner"></span><Icon v-else name="refresh" :size="15" />Scan again</button>
    </div>
    <div class="nets" role="radiogroup" aria-label="Networks the reader can see">
      <div v-if="scanning && !list.length" class="state"><span class="spinner"></span>The reader is scanning. This takes a few seconds.</div>
      <button v-for="n in list" :key="n.ssid" class="net" :class="{ on: ssid === n.ssid }" role="radio" :aria-checked="ssid === n.ssid" @click="choose(n)">
        <Icon name="wifi" :size="16" />
        <span class="nm">{{ n.ssid }}</span>
        <Icon v-if="n.security !== 'nonsec'" name="lock" :size="14" class="lock" />
        <span class="sig">{{ signalLabel(n.signal) }}</span>
      </button>
      <p v-if="scanError" class="err" role="alert">{{ scanError }}</p>
      <p v-else-if="!scanning && !list.length" class="state">No networks found. You can still type a name below.</p>
    </div>

    <div class="form">
      <div class="field">
        <label for="net-ssid">Network name</label>
        <input id="net-ssid" v-model="ssid" class="input selectable" data-autofocus autocomplete="off" spellcheck="false" @keydown.enter.prevent="join" />
      </div>
      <div class="field">
        <label for="net-sec">Security</label>
        <select id="net-sec" v-model="security" class="select">
          <option value="psk">WPA / WPA2 with a password</option>
          <option value="nonsec">Open, no password</option>
        </select>
      </div>
      <div v-if="security === 'psk'" class="field">
        <label for="net-pw">Password</label>
        <div class="pw">
          <input id="net-pw" ref="passwordField" v-model="password" class="input selectable" :type="reveal ? 'text' : 'password'" autocomplete="off" spellcheck="false" @keydown.enter.prevent="join" />
          <button type="button" class="btn ghost icon small" :aria-pressed="reveal" :aria-label="reveal ? 'Hide password' : 'Show password'" @click="reveal = !reveal"><Icon name="eye" :size="16" /></button>
        </div>
      </div>
      <p v-if="error" class="err" role="alert"><Icon name="warn" :size="16" /><span>{{ error }}</span></p>
      <p class="hint">The reader gets its address automatically (DHCP). If you join a network this computer is not on, Inkboard loses contact with the reader.</p>
    </div>

    <template #footer>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="!canJoin" @click="join"><span v-if="joining" class="spinner"></span>Join network</button>
    </template>
  </Modal>
</template>

<style scoped>
.head { margin-bottom: 8px; color: var(--text); }
.nets { display: flex; flex-direction: column; gap: 4px; max-height: 190px; overflow: auto; margin-bottom: 14px; }
.net { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px; border-radius: var(--radius-s); text-align: left; color: var(--text); border: 1px solid transparent; }
.net:hover { background: var(--hover); }
.net.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lock { color: var(--faint); }
.sig { font-size: 12px; color: var(--faint); min-width: 44px; text-align: right; }
.state { display: flex; align-items: center; gap: 10px; margin: 4px 2px; color: var(--muted); }
.form { display: flex; flex-direction: column; gap: 12px; }
.pw { display: flex; gap: 6px; align-items: center; }
.err { display: flex; gap: 8px; align-items: flex-start; margin: 0; color: var(--danger); }
.err svg { flex: none; margin-top: 2px; }
.hint { margin: 0; }
</style>
