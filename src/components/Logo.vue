<script setup lang="ts">
// The app icon (src-tauri/icons/icon.svg) at UI size: an e-ink slate with a gauge and two meters on the brand gradient.
withDefaults(defineProps<{ size?: number }>(), { size: 26 });
</script>

<template>
  <svg :width="size" :height="size" viewBox="64 64 896 896" aria-hidden="true" style="flex: none">
    <defs>
      <linearGradient id="logo-tile" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7aa0ff" />
        <stop offset="1" stop-color="#8f6cf0" />
      </linearGradient>
    </defs>
    <rect x="64" y="64" width="896" height="896" rx="236" fill="url(#logo-tile)" />
    <rect x="262" y="148" width="500" height="690" rx="64" fill="#ffffff" />
    <g transform="rotate(-90 512 396)" fill="none" stroke-linecap="round">
      <circle cx="512" cy="396" r="132" stroke="#dcdfe8" stroke-width="52" />
      <circle cx="512" cy="396" r="132" stroke="#14161c" stroke-width="52" stroke-dasharray="580 830" />
    </g>
    <rect x="340" y="610" width="344" height="40" rx="20" fill="#dcdfe8" />
    <rect x="340" y="610" width="236" height="40" rx="20" fill="#14161c" />
    <rect x="340" y="684" width="344" height="40" rx="20" fill="#dcdfe8" />
    <rect x="340" y="684" width="138" height="40" rx="20" fill="#14161c" />
  </svg>
</template>
