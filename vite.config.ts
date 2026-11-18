import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import pkg from './package.json' with { type: 'json' };

// GitHub Pages serves the game from https://erimid.github.io/Project-Null/,
// so every asset URL needs that prefix.
const commit = (process.env.GITHUB_SHA ?? 'dev').slice(0, 7);

export default defineConfig({
  base: '/Project-Null/',
  plugins: [preact()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
