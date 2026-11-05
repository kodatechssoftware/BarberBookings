import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_BEAUTY_V2_PORT || 5032);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["beauty-v2-booking.spec.ts"],
  timeout: 45_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL, trace: "on-first-retry", timezoneId: "Europe/Lisbon" },
  webServer: {
    env: {
      TZ: "UTC", APP_ENV: "development", BUSINESS_VERTICAL: "beauty", BUSINESS_THEME: "beauty-clean",
      USE_MEMORY_STORAGE: "true", MULTI_LOCATION_ENABLED: "false", PUBLIC_BOOKING_MONTHLY_WINDOW_ENABLED: "false",
      BEAUTY_V2_FEATURES_ENABLED: "false", APPOINTMENT_NOTIFICATION_EVENTS_ENABLED: "false",
      NOTIFICATION_OUTBOX_WORKER_ENABLED: "false", WHATSAPP_NOTIFICATIONS_ENABLED: "false", MESSAGING_PROVIDER: "none",
      DEMO_MODE: "false", SESSION_SECRET: "playwright-beauty-v2-secret-at-least-32-characters", PORT: String(port),
      ADMIN_INITIAL_PASSWORD: "Playwright-Beauty-v2-Admin-2026!",
    },
    command: "npx cross-env NODE_ENV=development tsx server/index.ts",
    url: `${baseURL}/health`, reuseExistingServer: false, timeout: 120_000,
  },
});
