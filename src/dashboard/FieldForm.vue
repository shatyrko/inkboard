<script setup lang="ts">
// Renders a widget's `fields` (see widgets/types.ts) as sidebar controls and reports every change as patch(key, value).
import { useId } from 'vue';
import type { Page } from './model';
import type { Field } from './widgets/types';
import ChecklistField from './ChecklistField.vue';
import ImageField from './ImageField.vue';

const props = defineProps<{ fields: Field<any>[]; values: Record<string, any>; pages: Page[] }>();
const emit = defineEmits<{ (e: 'patch', key: string, value: unknown, more?: Record<string, unknown>): void }>();

const uid = useId();
const id = (f: Field<any>) => `${uid}-${f.key}`;
const visible = (f: Field<any>) => !f.when || f.when(props.values);

/** number fields apply while typing when the value is valid and in range, and clamp when the field is left */
function num(f: Extract<Field<any>, { kind: 'number' }>, e: Event, final: boolean) {
  const el = e.target as HTMLInputElement;
  const v = el.valueAsNumber;
  if (!Number.isFinite(v)) { if (final) el.value = String(props.values[f.key]); return; }
  const inRange = v >= f.min && v <= f.max;
  if (!inRange && !final) return;
  const next = Math.min(f.max, Math.max(f.min, Math.round(v)));
  if (final) el.value = String(next);
  emit('patch', f.key, next);
}

function toggle(f: Extract<Field<any>, { kind: 'multi' }>, value: string) {
  const cur: string[] = props.values[f.key] ?? [];
  emit('patch', f.key, cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]);
}

const targetOptions = (pages: Page[]) => pages.map((p, i) => ({ value: p.id, label: `${i + 1}. ${p.name}` }));
</script>

<template>
  <div class="form">
    <template v-for="f in fields" :key="f.key">
      <template v-if="visible(f)">
        <div v-if="f.kind === 'switch'" class="field">
          <div class="row">
            <label :for="id(f)" class="grow sw-label">{{ f.label }}</label>
            <button :id="id(f)" class="switch" role="switch" :aria-checked="!!values[f.key]" :aria-label="f.label" @click="emit('patch', f.key, !values[f.key])"></button>
          </div>
          <div v-if="f.hint" class="hint">{{ f.hint }}</div>
        </div>

        <div v-else class="field">
          <label v-if="f.kind !== 'checklist' && f.kind !== 'image'" :for="id(f)" :class="{ lbl: f.kind === 'seg' || f.kind === 'multi' }">{{ f.label }}</label>
          <span v-else class="lbl">{{ f.label }}</span>

          <input v-if="f.kind === 'text'" :id="id(f)" class="input selectable" :class="{ mono: f.mono }" :value="values[f.key]" :placeholder="f.placeholder" autocomplete="off" spellcheck="false" @input="emit('patch', f.key, ($event.target as HTMLInputElement).value)" />

          <textarea v-else-if="f.kind === 'area'" :id="id(f)" class="input selectable" :class="{ mono: f.mono }" :rows="f.rows ?? 4" :value="values[f.key]" :placeholder="f.placeholder" spellcheck="false" @input="emit('patch', f.key, ($event.target as HTMLTextAreaElement).value)"></textarea>

          <div v-else-if="f.kind === 'number'" class="row">
            <input :id="id(f)" class="input num" type="number" :min="f.min" :max="f.max" :step="f.step ?? 1" :value="values[f.key]" @input="num(f, $event, false)" @change="num(f, $event, true)" />
            <span v-if="f.unit" class="hint unit">{{ f.unit }}</span>
          </div>

          <select v-else-if="f.kind === 'select'" :id="id(f)" class="select" :value="values[f.key]" @change="emit('patch', f.key, ($event.target as HTMLSelectElement).value)">
            <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>

          <div v-else-if="f.kind === 'seg'" class="seg" role="radiogroup" :aria-label="f.label">
            <button v-for="o in f.options" :key="o.value" role="radio" :aria-checked="values[f.key] === o.value" :class="{ on: values[f.key] === o.value }" @click="emit('patch', f.key, o.value)">{{ o.label }}</button>
          </div>

          <input v-else-if="f.kind === 'date'" :id="id(f)" class="input" type="date" :value="values[f.key]" @change="emit('patch', f.key, ($event.target as HTMLInputElement).value)" />

          <div v-else-if="f.kind === 'multi'" class="checks" role="group" :aria-label="f.label">
            <label v-for="o in f.options" :key="o.value" class="check">
              <input type="checkbox" :checked="(values[f.key] ?? []).includes(o.value)" @change="toggle(f, o.value)" />
              <span>{{ o.label }}</span>
            </label>
          </div>

          <ChecklistField v-else-if="f.kind === 'checklist'" :items="values[f.key]" @change="emit('patch', f.key, $event)" />

          <ImageField v-else-if="f.kind === 'image'" :src="values[f.key]" :name="values.name" @change="(src, name) => emit('patch', f.key, src, { name })" />

          <select v-else-if="f.kind === 'target'" :id="id(f)" class="select" :value="values[f.key]" @change="emit('patch', f.key, ($event.target as HTMLSelectElement).value)">
            <optgroup label="Relative">
              <option value="next">Next page</option>
              <option value="prev">Previous page</option>
              <option value="first">First page</option>
              <option value="last">Last page</option>
            </optgroup>
            <optgroup label="A specific page">
              <option v-for="o in targetOptions(pages)" :key="o.value" :value="o.value">{{ o.label }}</option>
            </optgroup>
          </select>

          <div v-if="f.hint" class="hint">{{ f.hint }}</div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 14px; }
.sw-label { font-size: 13px; color: var(--text); font-weight: 400; }
.lbl { font-size: 12px; font-weight: 500; color: var(--muted); }
.mono { font-family: var(--mono); font-size: 12px; }
.unit { flex: none; }
.checks { display: flex; flex-direction: column; gap: 2px; }
.check { display: flex; align-items: center; gap: 9px; height: 28px; padding: 0 4px; border-radius: 6px; font-size: 13px; color: var(--text); }
.check:hover { background: var(--hover); }
.check input { accent-color: var(--accent); width: 15px; height: 15px; margin: 0; }
.seg { width: 100%; }
.seg button { flex: 1; padding: 0 6px; }
</style>
