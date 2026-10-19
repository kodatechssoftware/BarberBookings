import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_BEAUTY_REMINDERS_PORT || 5046);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["beauty-appointment-reminders.spec.ts"],
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL, trace: "on-first-retry" },
  webServer: {
    env: {
      APP_ENV: "development",
      BUSINESS_VERTICAL: "beauty",
      BUSINESS_THEME: "beauty-clean",
      AUTH_RUNTIME_MODE: "legacy",
      APPOINTMENT_NOTIFICATION_EVENTS_ENABLED: "true",
      NOTIFICATION_OUTBOX_WORKER_ENABLED: "true",
      APPOINTMENT_REMINDERS_ENABLED: "true",
      WHATSAPP_NOTIFICATIONS_ENABLED: "false",
      MESSAGING_PROVIDER: "none",
      RESEND_API_KEY: "",
      RESEND_FROM_EMAIL: "",
      MULTI_LOCATION_ENABLED: "false",
      DEMO_MODE: "false",
    },
    command: `npx cross-env NODE_ENV=development USE_MEMORY_STORAGE=true PUBLIC_BOOKING_MONTHLY_WINDOW_ENABLED=false PORT=${port} SESSION_SECRET=playwright-test ADMIN_INITIAL_PASSWORD=Playwright-Test-Admin-2026! tsx server/index.ts`,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
