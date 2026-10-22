import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 5027);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "canonical-multi-location.spec.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    timezoneId: "Europe/Lisbon",
  },
  webServer: {
    command: `node --import tsx script/run-canonical-multilocation-e2e.ts`,
    env: { PORT: String(port) },
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

