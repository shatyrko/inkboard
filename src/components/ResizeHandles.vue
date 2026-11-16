<script setup lang="ts">
import { inTauri, win } from '../lib/window';
const dirs: Record<string, string> = { n: 'North', s: 'South', w: 'West', e: 'East', nw: 'NorthWest', ne: 'NorthEast', sw: 'SouthWest', se: 'SouthEast' };
const grab = (e: MouseEvent, d: string) => { if (e.button === 0) win.startResize(dirs[d]); };
</script>

<template>
  <template v-if="inTauri">
    <div v-for="(_, d) in dirs" :key="d" class="rz" :class="d" @mousedown.prevent="grab($event, d as string)"></div>
  </template>
</template>
