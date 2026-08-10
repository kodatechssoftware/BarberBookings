import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 5015);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 7_500,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npx cross-env TZ=UTC NODE_ENV=development USE_MEMORY_STORAGE=true PORT=${port} SESSION_SECRET=playwright-test tsx server/index.ts`,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
