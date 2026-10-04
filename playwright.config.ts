import { availableParallelism } from "node:os";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  expect: { toHaveScreenshot: { threshold: 0.25, maxDiffPixelRatio: 0.005 } },
  workers: Math.min(4, availableParallelism()),
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:6016",
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "pnpm exec vite preview --outDir build/storybook --host 127.0.0.1 --port 6016 --strictPort",
      url: "http://127.0.0.1:6016",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "node scripts/serve-consumer.mjs",
      url: "http://127.0.0.1:6017",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
