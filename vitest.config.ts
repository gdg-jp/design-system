import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "harness/**/*.test.mjs"],
    maxWorkers: 2,
  },
});
