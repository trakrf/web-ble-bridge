import { defineConfig } from '@playwright/test';

// Playwright tests ALWAYS run once and exit - no watch mode
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: true,
  reporter: 'list',
  outputDir: './tmp/test-results',
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    video: 'retain-on-failure',
    baseURL: 'http://localhost:3000',
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        browserName: 'chromium',
        launchOptions: {
          args: ['--disable-blink-features=AutomationControlled']
        }
      },
    },
  ],
  webServer: {
    command: 'python3 -m http.server 3000 --directory .',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});