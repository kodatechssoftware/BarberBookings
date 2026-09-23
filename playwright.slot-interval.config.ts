import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_SLOT_INTERVAL_PORT || 5021);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "booking-slot-interval.spec.ts",
  timeout: 45_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL, trace: "on-first-retry", timezoneId: "Europe/Lisbon" },
  webServer: {
    env: {
      TZ: "UTC",
      APP_ENV: "development",
      USE_MEMORY_STORAGE: "true",
      MULTI_LOCATION_ENABLED: "false",
      BOOKING_SLOT_INTERVAL_MINUTES: "60",
      PUBLIC_BOOKING_MONTHLY_WINDOW_ENABLED: "false",
      APPOINTMENT_NOTIFICATION_EVENTS_ENABLED: "true",
      NOTIFICATION_OUTBOX_WORKER_ENABLED: "false",
      WHATSAPP_NOTIFICATIONS_ENABLED: "false",
      MESSAGING_PROVIDER: "none",
      RESEND_API_KEY: "",
      RESEND_FROM_EMAIL: "",
      DEMO_MODE: "false",
      SESSION_SECRET: "playwright-slot-interval-test-secret",
      ADMIN_INITIAL_PASSWORD: "Playwright-Test-Admin-2026!",
      PORT: String(port),
    },
    command: "npx cross-env NODE_ENV=development tsx server/index.ts",
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
