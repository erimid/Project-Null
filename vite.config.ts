import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import pkg from './package.json' with { type: 'json' };
import { offline } from './tools/offline.mjs';

// GitHub Pages serves the game from https://erimid.github.io/Project-Null/,
// so every asset URL needs that prefix.
const commit = (process.env.GITHUB_SHA ?? 'dev').slice(0, 7);

export default defineConfig({
  base: '/Project-Null/',
  // offline() writes the service worker that lets the game play with no connection.
  plugins: [preact(), offline()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Whole careers are played in some tests: seconds each, more on a slow runner.
    testTimeout: 30_000,
  },
});
