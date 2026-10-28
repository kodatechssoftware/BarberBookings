import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_AVAILABILITY_PROMOTION_PORT || 5036);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "availability-promotion.spec.ts",
  timeout: 60_000,
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
    env: {
      TZ: "UTC",
      APP_ENV: "development",
      SHOP_NAME: "Baptista Barber Shop",
      SHOP_ADDRESS: "R. Cmte. Agatão Lança 28, 4640-142 Baião",
      SHOP_TIME_ZONE: "Europe/Lisbon",
      VITE_SHOP_NAME: "Baptista Barber Shop",
      VITE_SHOP_SHORT_NAME: "Baptista",
      VITE_SHOP_LOGO_URL: "/images/logo.jpg",
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
      SESSION_SECRET: "playwright-availability-promotion-secret",
      ADMIN_INITIAL_PASSWORD: "Playwright-Test-Admin-2026!",
      PORT: String(port),
    },
    command: "npx cross-env NODE_ENV=development tsx server/index.ts",
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
