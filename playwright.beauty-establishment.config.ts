import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_BEAUTY_ESTABLISHMENT_PORT || 5034);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "beauty-single-location-settings.spec.ts",
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
      BUSINESS_VERTICAL: "beauty",
      BUSINESS_THEME: "beauty-clean",
      BUSINESS_BRANDING_PROFILE: "ana-isabel",
      SHOP_NAME: "Ana Isabel Nail Art & Design",
      SHOP_ADDRESS: "Morada anterior",
      SHOP_TIME_ZONE: "Europe/Lisbon",
      VITE_SHOP_NAME: "Ana Isabel Nail Art & Design",
      VITE_SHOP_ADDRESS: "Morada anterior",
      USE_MEMORY_STORAGE: "true",
      MULTI_LOCATION_ENABLED: "false",
      PUBLIC_BOOKING_MONTHLY_WINDOW_ENABLED: "false",
      APPOINTMENT_NOTIFICATION_EVENTS_ENABLED: "false",
      NOTIFICATION_OUTBOX_WORKER_ENABLED: "false",
      WHATSAPP_NOTIFICATIONS_ENABLED: "false",
      MESSAGING_PROVIDER: "none",
      RESEND_API_KEY: "",
      RESEND_FROM_EMAIL: "",
      DEMO_MODE: "false",
      SESSION_SECRET: "playwright-beauty-establishment-secret",
      ADMIN_INITIAL_PASSWORD: "Playwright-Test-Admin-2026!",
      PORT: String(port),
    },
    command: "npx cross-env NODE_ENV=development tsx server/index.ts",
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
