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
    env: { MULTI_LOCATION_ENABLED: "false", DEMO_MODE: "false", RESEND_API_KEY: "", RESEND_FROM_EMAIL: "", WHATSAPP_NOTIFICATIONS_ENABLED: "false", MESSAGING_PROVIDER: "none" },
    command: `npx cross-env TZ=UTC NODE_ENV=development USE_MEMORY_STORAGE=true PUBLIC_BOOKING_MONTHLY_WINDOW_ENABLED=false PORT=${port} SESSION_SECRET=playwright-test ADMIN_INITIAL_PASSWORD=Playwright-Test-Admin-2026! tsx server/index.ts`,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
