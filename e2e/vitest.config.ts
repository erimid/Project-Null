import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/saves.gen.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
