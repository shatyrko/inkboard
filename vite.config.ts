import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// Tauri expects a fixed dev port; the same server doubles as a plain-browser preview
// (window.__TAURI_INTERNALS__ is absent there and src/mock/ answers every command).
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: { target: 'safari15', outDir: 'dist', emptyOutDir: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
