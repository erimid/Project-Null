/**
 * The robot playtester: plays the guided first job and opens every window
 * in a real browser, at desk, tablet and phone size, in each desk design.
 * See e2e/README.md.
 */
import { defineConfig, devices } from '@playwright/test';
import type { RobotOptions } from './e2e/robot';

const DESIGNS: readonly RobotOptions['design'][] = ['classic', 'deck', 'cards', 'sidebar', 'hybrid'];

export default defineConfig<RobotOptions>({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  outputDir: 'e2e-output/results',
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['./e2e/sheet.ts']],
  use: {
    baseURL: 'http://localhost:4173/Project-Null/',
    trace: 'off',
    // Sounds are not needed and some runners have no audio device.
    launchOptions: { args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [
    ...DESIGNS.map((design) => ({
      name: `desk-${design}`,
      use: { viewport: { width: 1440, height: 900 }, design },
    })),
    { name: 'tablet', use: { ...devices['iPad (gen 7) landscape'], browserName: 'chromium' as const, deviceScaleFactor: 1, design: 'classic' } },
    { name: 'phone', use: { ...devices['Pixel 7'], deviceScaleFactor: 1, design: 'classic' } },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/Project-Null/',
    reuseExistingServer: !process.env.CI,
  },
});
