<script setup lang="ts">
// Which reader this computer is paired with, and how to let go of it.
import Icon from '../../components/Icon.vue';
import type { MenuItem } from '../../lib/contextmenu';
import { app } from '../../lib/store';
import { copyText } from '../shared/clipboard';
import { forgetReader } from '../shared/reader';

const copyMenu = (what: string, value: string) => (): MenuItem[] => [{ label: `Copy ${what.toLowerCase()}`, icon: 'copy', action: () => copyText(value, `${what} copied`) }];
</script>

<template>
  <div class="section-label">Paired Digital Paper</div>
  <div class="card">
    <div class="setting">
      <div class="t"><b>Status</b></div>
      <div class="ctl">
        <span class="chip" :class="{ plain: !app.conn?.connected }"><Icon :name="app.conn?.connected ? 'plug' : 'unplug'" :size="14" />{{ app.conn?.connected ? 'Connected' : app.connecting ? 'Connecting...' : 'Not connected' }}</span>
      </div>
    </div>
    <div class="setting">
      <div class="t"><b>Address</b></div>
      <div class="ctl"><span v-context="copyMenu('Address', app.conn?.addr ?? '')" class="mono selectable">{{ app.conn?.addr ?? '-' }}</span></div>
    </div>
    <div class="setting">
      <div class="t"><b>Serial number</b></div>
      <div class="ctl"><span v-context="copyMenu('Serial number', app.conn?.serial ?? '')" class="mono selectable">{{ app.conn?.serial ?? '-' }}</span></div>
    </div>
    <div class="setting">
      <div class="t"><b>Forget this reader</b><span>Deletes the pairing keys saved on this computer. The reader itself is not changed.</span></div>
      <div class="ctl"><button class="btn" @click="forgetReader"><Icon name="unplug" :size="16" />Forget this reader...</button></div>
    </div>
  </div>
</template>
