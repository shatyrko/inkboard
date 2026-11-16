<script setup lang="ts">
// The first row of a view: the 52 px bar. Title on the left, actions via the default slot; empty space drags the window.
defineProps<{ title: string; count?: string | number | null }>();
</script>

<template>
  <div class="bar" data-drag>
    <h1 data-drag>{{ title }}</h1>
    <span v-if="count !== undefined && count !== null" class="bar-count num" data-drag>{{ count }}</span>
    <span class="grow" data-drag></span>
    <slot />
  </div>
</template>
