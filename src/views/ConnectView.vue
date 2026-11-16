<script setup lang="ts">
// First run: find the reader, then pair with the PIN it shows on its own screen. Takes the whole window.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from '../components/Icon.vue';
import { api } from '../lib/api';
import { app, connectNow, refreshConnection } from '../lib/store';
import type { DiscoveredDevice } from '../lib/types';
import { digitsOnly, normaliseAddress } from './connect/address';

type Reader = { addr: string; model: string; serial: string | null };

const message = (e: unknown) => (typeof e === 'string' ? e : (e as Error)?.message || 'Something went wrong.');

const step = ref<1 | 2>(1);

// ---------- step 1: find ----------
const found = ref<DiscoveredDevice[]>([]);
const scanning = ref(false);
const scanned = ref(false);
const scanError = ref('');
const chosen = ref<Reader | null>(null);
const manual = ref('');
const probing = ref(false);
const probeError = ref('');

const cards = computed<Reader[]>(() => {
  const list = found.value.map((d) => ({ addr: d.addr, model: d.model ?? d.name, serial: d.serial }));
  // a reader entered by hand shows up as a card too, so there is one place that says what is selected
  if (chosen.value && !list.some((r) => r.addr === chosen.value?.addr)) list.unshift(chosen.value);
  return list;
});

async function scan() {
  if (scanning.value) return;
  scanning.value = true;
  scanError.value = '';
  try {
    found.value = await api.discoverDevices();
    if (!chosen.value && found.value.length === 1) {
      const d = found.value[0];
      chosen.value = { addr: d.addr, model: d.model ?? d.name, serial: d.serial };
    }
  } catch (e) {
    scanError.value = message(e);
  } finally {
    scanning.value = false;
    scanned.value = true;
  }
}

async function probe() {
  const addr = normaliseAddress(manual.value);
  if (!addr || probing.value) return;
  probing.value = true;
  probeError.value = '';
  try {
    const r = await api.probeDevice(addr);
    chosen.value = { addr: r.addr, model: r.model, serial: r.serial };
  } catch (e) {
    probeError.value = message(e);
  } finally {
    probing.value = false;
  }
}

// ---------- step 2: pair ----------
const phase = ref<'idle' | 'asking' | 'shown'>('idle');
const pin = ref('');
const pinField = ref<HTMLInputElement | null>(null);
const pairing = ref(false);
const importing = ref(false);
const pairError = ref('');
const busy = computed(() => phase.value === 'asking' || pairing.value || importing.value);

function next() {
  if (!chosen.value) return;
  step.value = 2;
  nextTick(() => document.querySelector<HTMLElement>('[data-first]')?.focus());
}
function back() {
  step.value = 1;
  phase.value = 'idle';
  pin.value = '';
  pairError.value = '';
}

async function showPin() {
  if (!chosen.value || busy.value) return;
  phase.value = 'asking';
  pairError.value = '';
  try {
    await api.pairStart(chosen.value.addr);
    phase.value = 'shown';
    pin.value = '';
    await nextTick();
    pinField.value?.focus();
  } catch (e) {
    phase.value = 'idle';
    pairError.value = message(e);
  }
}

function onPin(e: Event) {
  const el = e.target as HTMLInputElement;
  pin.value = digitsOnly(el.value);
  el.value = pin.value; // a rejected character must not stay visible
}

/** once the keys are saved the shell swaps this view for the main UI, so nothing here may depend on staying mounted */
async function enter() {
  await refreshConnection();
  await connectNow();
}

async function finish() {
  if (pin.value.length < 4 || busy.value) return;
  pairing.value = true;
  pairError.value = '';
  try {
    await api.pairFinish(pin.value);
    await enter();
  } catch (e) {
    pairError.value = message(e);
    pinField.value?.select();
  } finally {
    pairing.value = false;
  }
}

async function importKeys() {
  if (!chosen.value || busy.value) return;
  importing.value = true;
  pairError.value = '';
  try {
    await api.importLegacyCredentials(chosen.value.addr);
    await enter();
  } catch (e) {
    pairError.value = message(e);
  } finally {
    importing.value = false;
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && step.value === 2 && !busy.value) back();
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  scan();
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <section class="connect">
    <div class="strip" data-drag></div>
    <div class="scroll">
      <div class="wrap">
        <div class="hero">
          <div class="logo big"><Icon name="book" :size="24" /></div>
          <h1>Connect your reader</h1>
          <p>Inkboard manages a Sony Digital Paper (DPT-RP1) over Wi-Fi and turns it into a dashboard screen.</p>
        </div>

        <ol class="steps" aria-label="Steps">
          <li :class="{ on: step === 1, done: step > 1 }" :aria-current="step === 1 ? 'step' : undefined"><span class="n">{{ step > 1 ? '' : '1' }}<Icon v-if="step > 1" name="check" :size="13" /></span>Find your reader</li>
          <li class="bar-line" aria-hidden="true"></li>
          <li :class="{ on: step === 2 }" :aria-current="step === 2 ? 'step' : undefined"><span class="n">2</span>Pair</li>
        </ol>

        <!-- ===== step 1 ===== -->
        <template v-if="step === 1">
          <div class="note"><Icon name="wifi" :size="16" /><span>The reader's Wi-Fi must be switched on, and the reader and this computer must be on the <b>same Wi-Fi network</b>.</span></div>

          <div class="card">
            <div class="row head">
              <h2>Readers on your network</h2>
              <span class="grow"></span>
              <button class="btn small" :disabled="scanning" @click="scan">
                <span v-if="scanning" class="spinner"></span><Icon v-else name="radar" :size="15" />{{ scanned ? 'Scan again' : 'Scan network' }}
              </button>
            </div>

            <div v-if="scanning && !cards.length" class="state"><span class="spinner"></span>Looking for readers. This takes a few seconds.</div>
            <div v-else-if="cards.length" class="cards" role="radiogroup" aria-label="Readers found">
              <button v-for="r in cards" :key="r.addr" class="rcard" :class="{ on: chosen?.addr === r.addr }" role="radio" :aria-checked="chosen?.addr === r.addr" @click="chosen = r">
                <span class="tile"><Icon name="device" :size="22" /></span>
                <span class="who">
                  <b>{{ r.model }}</b>
                  <span class="mono">{{ r.addr }}<template v-if="r.serial"> &middot; {{ r.serial }}</template></span>
                </span>
                <span class="tick" aria-hidden="true"><Icon v-if="chosen?.addr === r.addr" name="check" :size="16" /></span>
              </button>
            </div>
            <p v-else-if="scanError" class="err" role="alert"><Icon name="warn" :size="16" />{{ scanError }}</p>
            <p v-else-if="scanned" class="state">No reader answered. Check the points above, then scan again, or type its address below.</p>

            <div class="or"><span>or enter its address</span></div>
            <form class="manual" @submit.prevent="probe">
              <input v-model="manual" class="input mono selectable" placeholder="For example 192.0.2.41" aria-label="Reader address" autocomplete="off" spellcheck="false" />
              <button class="btn" type="submit" :disabled="!manual.trim() || probing"><span v-if="probing" class="spinner"></span>Check</button>
            </form>
            <p v-if="probeError" class="err" role="alert"><Icon name="warn" :size="16" />{{ probeError }}</p>
          </div>

          <div class="actions">
            <span class="grow"></span>
            <button class="btn primary" :disabled="!chosen" @click="next">Continue<Icon name="arrow-right" :size="16" /></button>
          </div>
        </template>

        <!-- ===== step 2 ===== -->
        <template v-else-if="chosen">
          <div class="card">
            <div class="rcard static">
              <span class="tile"><Icon name="device" :size="22" /></span>
              <span class="who">
                <b>{{ chosen.model }}</b>
                <span class="mono">{{ chosen.addr }}<template v-if="chosen.serial"> &middot; {{ chosen.serial }}</template></span>
              </span>
            </div>

            <template v-if="app.conn?.legacyCredentials">
              <div class="legacy">
                <div class="t"><b>Already set up with dpt-rp1-py?</b><span>This computer has keys saved by that tool. If they belong to this reader you can skip the PIN.</span></div>
                <button class="btn primary" :disabled="busy" data-first @click="importKeys"><span v-if="importing" class="spinner"></span><Icon v-else name="key" :size="16" />Use the keys from dpt-rp1-py</button>
              </div>
              <div class="or"><span>or pair with a PIN</span></div>
            </template>

            <ol class="how">
              <li>Press <b>Show PIN</b>. The reader displays a PIN on its own screen.</li>
              <li>Type that PIN here and press <kbd>Enter</kbd>.</li>
            </ol>

            <button v-if="phase !== 'shown'" class="btn" :class="{ primary: !app.conn?.legacyCredentials }" :disabled="busy" :data-first="app.conn?.legacyCredentials ? undefined : ''" @click="showPin">
              <span v-if="phase === 'asking'" class="spinner"></span><Icon v-else name="show" :size="16" />Show PIN on the reader
            </button>
            <form v-else class="pinform" @submit.prevent="finish">
              <label class="lbl" for="pin">PIN shown on the reader</label>
              <div class="row">
                <input id="pin" ref="pinField" class="input pin selectable" :value="pin" inputmode="numeric" autocomplete="one-time-code" placeholder="00000000" maxlength="12" @input="onPin" />
                <button class="btn primary" type="submit" :disabled="pin.length < 4 || busy"><span v-if="pairing" class="spinner"></span>Pair</button>
              </div>
              <button type="button" class="link" :disabled="busy" @click="showPin">Show a new PIN</button>
            </form>

            <p v-if="pairError" class="err" role="alert"><Icon name="warn" :size="16" /><span>{{ pairError }}</span></p>
            <p v-if="pairError && phase === 'shown'" class="hint">The PIN changes each time the reader shows one. Use the number that is on its screen now.</p>
          </div>

          <div class="actions">
            <button class="btn" :disabled="busy" @click="back"><Icon name="arrow-left" :size="16" />Back</button>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.connect { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; }
.strip { position: absolute; top: 0; left: 0; right: 0; height: var(--bar); z-index: 1; }
.scroll { padding-top: var(--bar); }
/* top-aligned, so the card does not jump when the second step is taller than the first */
.wrap { width: 100%; max-width: 540px; margin: 4vh auto 0; padding: 8px 24px 40px; }

.hero { text-align: center; margin-bottom: 18px; }
.hero h1 { font-size: 24px; margin: 14px 0 6px; }
.hero p { margin: 0 auto; max-width: 400px; color: var(--muted); }
.logo.big { width: 52px; height: 52px; margin: 0 auto; }

.steps { list-style: none; display: flex; align-items: center; gap: 10px; justify-content: center; margin: 0 0 16px; padding: 0; color: var(--faint); font-size: 13px; }
.steps li { display: flex; align-items: center; gap: 8px; }
.steps .n { width: 22px; height: 22px; border-radius: 99px; display: grid; place-items: center; font-size: 12px; font-weight: 600; background: var(--panel-2); border: 1px solid var(--border); }
.steps .on { color: var(--text); font-weight: 550; }
.steps .on .n { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.steps .done { color: var(--muted); }
.steps .done .n { background: var(--accent-soft); border-color: transparent; color: var(--accent); }
.steps .bar-line { width: 40px; height: 1px; background: var(--border); }

.note { display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px; margin-bottom: 14px; border-radius: var(--radius); background: var(--accent-soft); color: var(--text); font-size: 13px; }
.note svg { color: var(--accent); flex: none; margin-top: 1px; }

.head { margin-bottom: 12px; }
.head h2 { font-size: 15px; margin: 0; }

.state { display: flex; align-items: center; gap: 10px; margin: 6px 0 4px; color: var(--muted); }
.cards { display: flex; flex-direction: column; gap: 8px; }
.rcard { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; text-align: left; border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel-2); }
button.rcard:hover { background: color-mix(in srgb, var(--panel-2) 80%, var(--text) 8%); }
.rcard.on { border-color: var(--accent); background: var(--accent-soft); }
.rcard.static { border-color: transparent; background: var(--hover); margin-bottom: 14px; }
.rcard .tile { width: 40px; height: 40px; border-radius: 28%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); flex: none; }
.rcard .who { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.rcard .who .mono { color: var(--muted); }
.tick { width: 20px; color: var(--accent); display: grid; place-items: center; }

.or { display: flex; align-items: center; gap: 12px; margin: 16px 0 12px; color: var(--faint); font-size: 12px; }
.or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.manual { display: flex; gap: 8px; }
.err { display: flex; gap: 8px; align-items: flex-start; margin: 10px 0 0; color: var(--danger); }
.err svg { flex: none; margin-top: 2px; }
.hint { margin: 6px 0 0; }

.actions { display: flex; align-items: center; margin-top: 16px; }

.legacy { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: var(--radius); border: 1px solid var(--border); }
.legacy .t { display: flex; flex-direction: column; }
.legacy .t span { color: var(--muted); font-size: 13px; }
.how { margin: 0 0 14px; padding-left: 20px; color: var(--muted); }
.how li + li { margin-top: 4px; }
.how b { color: var(--text); font-weight: 550; }
.pinform { display: flex; flex-direction: column; gap: 8px; }
.pinform .lbl { font-size: 12px; font-weight: 500; color: var(--muted); }
.pin { height: 46px; font: 600 22px var(--mono); letter-spacing: 0.28em; text-align: center; }
.pinform .btn.primary { height: 46px; padding: 0 22px; }
.link { align-self: flex-start; color: var(--accent); border-radius: 4px; }
.link:hover { text-decoration: underline; }
.link[disabled] { opacity: 0.45; pointer-events: none; }
</style>
