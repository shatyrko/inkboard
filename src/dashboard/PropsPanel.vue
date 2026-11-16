<script setup lang="ts">
// The right-hand sidebar: the selected widget's properties, or (with nothing selected) the page and dashboard settings.
import { computed } from 'vue';
import Icon from '../components/Icon.vue';
import type { DataBag } from './data';
import type { Editor } from './editor';
import FieldForm from './FieldForm.vue';
import { clamp } from './grid';
import { drawOrder, sourceOf } from './render';
import { registry } from './widgets';

const props = defineProps<{
  ed: Editor;
  bag: DataBag;
  /** what a dashboard without its own setting falls back to (the app's settings) */
  defaults: { folder: string; display: boolean };
  /** "Next push in 12 min · Last push 14:02 ok" */
  scheduleText: string;
}>();
const emit = defineEmits<{ (e: 'fetch', id: string): void }>();

const { doc, page, selected, bounds } = props.ed;
const def = computed(() => (selected.value ? registry[selected.value.type] : null));
const layers = computed(() => (page.value ? drawOrder(page.value.widgets).reverse() : []));
const schedule = computed(() => doc.value?.schedule ?? { enabled: false, everyMinutes: 30 });

/** how the selected widget's data is doing, for the line under its settings */
const status = computed(() => {
  const w = selected.value;
  const s = w ? sourceOf(w) : null;
  if (!w || !s) return null;
  const r = props.bag.results[s.key];
  if (!r) return { kind: 'idle', text: registry[w.type].manual ? 'Not loaded yet.' : 'Loading...' };
  return r.ok ? { kind: 'ok', text: 'Loaded.' } : { kind: 'error', text: r.error };
});

function patch(key: string, value: unknown, more: Record<string, unknown> = {}) {
  if (selected.value) props.ed.patchProps(selected.value.id, { [key]: value, ...more }, key);
}

function geometry(key: 'x' | 'y' | 'w' | 'h', e: Event) {
  const w = selected.value;
  const el = e.target as HTMLInputElement;
  if (!w) return;
  const v = el.valueAsNumber;
  if (!Number.isFinite(v)) { el.value = String(w[key]); return; }
  props.ed.setGeometry(w.id, { [key]: Math.round(v) });
  // show what was actually applied after clamping to the page
  el.value = String(selected.value?.[key] ?? v);
}
const limit = (key: 'x' | 'y' | 'w' | 'h') => (key === 'x' || key === 'w' ? bounds.value.cols : bounds.value.rows);

function setEvery(e: Event) {
  const el = e.target as HTMLInputElement;
  const v = clamp(Math.round(el.valueAsNumber || 30), 1, 1440);
  el.value = String(v);
  props.ed.setSchedule({ ...schedule.value, everyMinutes: v });
}

const peek = (w: NonNullable<typeof selected.value>) => {
  const p = w.props as Record<string, unknown>;
  const t = [p.text, p.title, p.label, p.caption, p.command, p.url].find((v) => typeof v === 'string' && v.trim());
  return typeof t === 'string' ? t.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 40) : '';
};
</script>

<template>
  <aside class="props" aria-label="Properties">
    <div v-if="selected && def" :key="selected.id" class="scroll">
      <div class="head">
        <span class="ic"><Icon :name="def.icon" :size="18" /></span>
        <h2 class="grow">{{ def.label }}</h2>
        <button class="btn ghost icon small" title="Duplicate (Ctrl+D)" aria-label="Duplicate widget" @click="ed.duplicate()"><Icon name="duplicate" :size="16" /></button>
        <button class="btn ghost icon small" title="Delete (Del)" aria-label="Delete widget" @click="ed.remove()"><Icon name="trash" :size="16" /></button>
      </div>

      <FieldForm :fields="def.fields" :values="selected.props" :pages="doc?.pages ?? []" @patch="patch" />

      <div v-if="def.manual" class="fetch">
        <button class="btn small" @click="emit('fetch', selected.id)"><Icon name="refresh" :size="14" />{{ def.manual.label }}</button>
        <span v-if="status" class="status" :class="status.kind" role="status">{{ status.text }}</span>
      </div>
      <p v-else-if="status && status.kind !== 'ok'" class="status" :class="status.kind" role="status">{{ status.text }}</p>

      <div class="section-label">Position and size</div>
      <div class="geo">
        <div v-for="k in (['x', 'y', 'w', 'h'] as const)" :key="k" class="field">
          <label :for="'geo-' + k">{{ { x: 'Left', y: 'Top', w: 'Width', h: 'Height' }[k] }}</label>
          <input :id="'geo-' + k" class="input num" type="number" :min="k === 'w' || k === 'h' ? def.size[k === 'w' ? 'minW' : 'minH'] : 0" :max="limit(k)" :value="selected[k]" @change="geometry(k, $event)" />
        </div>
      </div>
      <div class="hint geohint">In grid cells of 50 px. Arrow keys move, Ctrl and arrow keys resize.</div>

      <div class="section-label">Stacking</div>
      <div class="row wrap">
        <button class="btn small" title="Bring to front (Ctrl+Shift+])" @click="ed.reorder('front')"><Icon name="bring-front" :size="14" />Front</button>
        <button class="btn small" title="Bring forward (Ctrl+])" @click="ed.reorder('forward')"><Icon name="arrow-up" :size="14" />Forward</button>
        <button class="btn small" title="Send backward (Ctrl+[)" @click="ed.reorder('backward')"><Icon name="arrow-down" :size="14" />Backward</button>
        <button class="btn small" title="Send to back (Ctrl+Shift+[)" @click="ed.reorder('back')"><Icon name="send-back" :size="14" />Back</button>
      </div>
    </div>

    <div v-else-if="doc && page" class="scroll">
      <div class="head"><span class="ic"><Icon name="dashboard" :size="18" /></span><h2 class="grow">Dashboard</h2></div>
      <div class="form">
        <div class="field">
          <label for="d-name">Name</label>
          <input id="d-name" class="input selectable" :value="doc.name" spellcheck="false" autocomplete="off" @input="ed.rename(($event.target as HTMLInputElement).value)" />
          <div class="hint">Also the name of the document on the reader.</div>
        </div>
        <div class="field">
          <span class="lbl">Orientation</span>
          <div class="seg" role="radiogroup" aria-label="Orientation">
            <button role="radio" :aria-checked="doc.orientation === 'portrait'" :class="{ on: doc.orientation === 'portrait' }" @click="ed.setOrientation('portrait')">Portrait</button>
            <button role="radio" :aria-checked="doc.orientation === 'landscape'" :class="{ on: doc.orientation === 'landscape' }" @click="ed.setOrientation('landscape')">Landscape</button>
          </div>
          <div class="hint">Widgets that no longer fit are pulled onto the page.</div>
        </div>
      </div>

      <div class="section-label">Publishing</div>
      <div class="form">
        <div class="field">
          <label for="d-folder">Folder on the reader</label>
          <input id="d-folder" class="input selectable mono" :value="doc.publish?.folder ?? ''" :placeholder="defaults.folder" spellcheck="false" autocomplete="off" @input="ed.setPublish({ ...doc.publish, folder: ($event.target as HTMLInputElement).value })" />
          <div class="hint">Empty uses the folder from Settings.</div>
        </div>
        <div class="field">
          <div class="row">
            <label for="d-display" class="grow sw-label">Open on the reader after pushing</label>
            <button id="d-display" class="switch" role="switch" :aria-checked="doc.publish?.display ?? defaults.display" aria-label="Open on the reader after pushing" @click="ed.setPublish({ ...doc.publish, display: !(doc.publish?.display ?? defaults.display) })"></button>
          </div>
        </div>
        <div class="field">
          <div class="row">
            <label for="d-auto" class="grow sw-label">Push automatically</label>
            <button id="d-auto" class="switch" role="switch" :aria-checked="schedule.enabled" aria-label="Push automatically" @click="ed.setSchedule({ ...schedule, enabled: !schedule.enabled })"></button>
          </div>
          <div v-if="schedule.enabled" class="row every">
            <span class="hint">Every</span>
            <input class="input num" type="number" min="1" max="1440" :value="schedule.everyMinutes" aria-label="Minutes between pushes" @change="setEvery" />
            <span class="hint">minutes</span>
          </div>
          <div class="hint">{{ schedule.enabled ? (scheduleText || 'Runs while Inkboard is open.') : 'Pushes only when you press Publish.' }}</div>
        </div>
      </div>

      <div class="section-label">This page</div>
      <div class="form">
        <div class="field">
          <label for="p-name">Page name</label>
          <input id="p-name" class="input selectable" :value="page.name" spellcheck="false" autocomplete="off" @input="ed.renamePage(page.id, ($event.target as HTMLInputElement).value)" />
        </div>
      </div>

      <div class="section-label">Layers</div>
      <div v-if="!layers.length" class="hint">Nothing on this page yet.</div>
      <div v-else class="layers">
        <button v-for="w in layers" :key="w.id" class="layer" @click="ed.select(w.id)">
          <Icon :name="registry[w.type].icon" :size="15" />
          <span class="nm">{{ registry[w.type].label }}</span>
          <span class="pk">{{ peek(w) }}</span>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.props { width: clamp(244px, 26vw, 296px); flex: none; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--border); background: var(--panel); }
.scroll { padding: 14px 16px 24px; }
.head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.head .ic { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); flex: none; }
.form { display: flex; flex-direction: column; gap: 14px; }
.lbl { font-size: 12px; font-weight: 500; color: var(--muted); }
.sw-label { font-size: 13px; color: var(--text); font-weight: 400; }
.mono { font-family: var(--mono); font-size: 12px; }
.seg { width: 100%; }
.seg button { flex: 1; padding: 0 6px; }
.every { margin-top: 2px; }
.every .input { width: 76px; }
.fetch { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.status { font-size: 12px; color: var(--faint); margin: 10px 0 0; overflow-wrap: anywhere; }
.status.error { color: var(--danger); }
.status.ok { color: var(--ok); }
.geo { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.geohint { margin-top: 8px; }
.layers { display: flex; flex-direction: column; gap: 2px; }
.layer { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px; border-radius: 7px; color: var(--muted); text-align: left; min-width: 0; }
.layer:hover { background: var(--hover); color: var(--text); }
.layer .nm { color: var(--text); flex: none; }
.layer .pk { font-size: 12px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
