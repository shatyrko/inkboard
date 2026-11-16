<script setup lang="ts">
// Settings of Inkboard itself: theme, and how dashboards behave. Nothing here touches the reader.
import { ref, watch } from 'vue';
import { api } from '../../lib/api';
import { applyTheme, app, getTheme, type Theme } from '../../lib/store';
import type { AppSettings } from '../../lib/types';
import { confirmDialog, notify } from '../../lib/ui';
import { normaliseFolder } from '../library/paths';

const themes: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const theme = ref<Theme>(getTheme());
function setTheme(t: Theme) {
  theme.value = t;
  applyTheme(t);
}

/** optimistic: the switch moves at once and goes back, with a toast, if saving fails */
async function patch(change: Partial<AppSettings>) {
  const before = app.settings;
  if (!before) return;
  app.settings = { ...before, ...change };
  try {
    app.settings = await api.settingsSet(change);
  } catch (e) {
    app.settings = before;
    notify(`Could not save the setting: ${typeof e === 'string' ? e : (e as Error)?.message || 'something went wrong'}`, 'error');
  }
}

async function setCommands(on: boolean) {
  if (on) {
    // red because a command can change or delete anything the user's account can; Cancel is the focused button
    const ok = await confirmDialog({
      title: 'Let dashboards run shell commands?',
      body: "A dashboard's Command widget runs a command on this computer, as you, every time the dashboard refreshes. A dashboard you import from someone else could run something you did not expect. Turn this on only for dashboards you trust.",
      confirm: 'Allow commands',
      danger: true,
    });
    if (!ok) return;
  }
  await patch({ allowCommands: on });
}

const folder = ref('');
const syncFolder = () => { folder.value = app.settings?.dashboardFolder ?? ''; };
watch(() => app.settings?.dashboardFolder, syncFolder, { immediate: true });
async function commitFolder() {
  const typed = folder.value.trim();
  if (!typed) { syncFolder(); return; }
  const next = normaliseFolder(typed);
  folder.value = next;
  if (next !== app.settings?.dashboardFolder) await patch({ dashboardFolder: next });
}
</script>

<template>
  <div class="section-label">App</div>
  <div class="card">
    <div class="setting">
      <div class="t"><b>Theme</b></div>
      <div class="ctl">
        <div class="seg" role="radiogroup" aria-label="Theme">
          <button v-for="t in themes" :key="t.value" role="radio" :aria-checked="theme === t.value" :class="{ on: theme === t.value }" @click="setTheme(t.value)">{{ t.label }}</button>
        </div>
      </div>
    </div>
    <template v-if="app.settings">
      <div class="setting">
        <div class="t"><b>Allow shell commands in dashboards</b><span>Lets a dashboard's Command widget run commands on this computer. Off unless you turn it on.</span></div>
        <div class="ctl"><button class="switch" role="switch" aria-label="Allow shell commands in dashboards" :aria-checked="app.settings.allowCommands" @click="setCommands(!app.settings.allowCommands)"></button></div>
      </div>
      <div class="setting">
        <div class="t"><b>Dashboard folder on the reader</b><span>Where dashboards are uploaded. It is created if it does not exist.</span></div>
        <div class="ctl"><input v-model="folder" class="input mono selectable" aria-label="Dashboard folder on the reader" autocomplete="off" spellcheck="false" @blur="commitFolder" @keydown.enter="($event.target as HTMLInputElement).blur()" /></div>
      </div>
      <div class="setting">
        <div class="t"><b>Open the dashboard on the reader after publishing</b><span>Shows it on the reader's screen as soon as it is uploaded.</span></div>
        <div class="ctl"><button class="switch" role="switch" aria-label="Open the dashboard on the reader after publishing" :aria-checked="app.settings.displayAfterPush" @click="patch({ displayAfterPush: !app.settings.displayAfterPush })"></button></div>
      </div>
    </template>
  </div>
</template>
