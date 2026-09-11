import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PRODUCTION_PORT || 5018);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "production-runtime.spec.ts",
  timeout: 45_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL, trace: "on-first-retry" },
  webServer: {
    env: {
      NODE_ENV: "production",
      APP_ENV: "production",
      USE_MEMORY_STORAGE: "true",
      MULTI_LOCATION_ENABLED: "false",
      MAX_LOCATIONS: "1",
      APPOINTMENT_NOTIFICATION_EVENTS_ENABLED: "false",
      NOTIFICATION_OUTBOX_WORKER_ENABLED: "false",
      WHATSAPP_NOTIFICATIONS_ENABLED: "false",
      META_WHATSAPP_WEBHOOK_ENABLED: "false",
      META_WHATSAPP_RECURRING_NOTIFICATIONS_ENABLED: "false",
      MESSAGING_PROVIDER: "meta",
      META_WHATSAPP_ACCESS_TOKEN: "",
      META_WHATSAPP_PHONE_NUMBER_ID: "",
      META_WHATSAPP_WABA_ID: "",
      RESEND_API_KEY: "",
      RESEND_FROM_EMAIL: "",
      DEMO_MODE: "false",
      PUBLIC_BOOKING_MONTHLY_WINDOW_ENABLED: "false",
      PUBLIC_URL: "https://bookings.example.test",
      ALLOWED_ORIGINS: baseURL,
      SESSION_SECRET: "production-runtime-test-secret-with-32-characters",
      SESSION_SAME_SITE: "lax",
      ADMIN_INITIAL_PASSWORD: "Playwright-Test-Admin-2026!",
      PORT: String(port),
    },
    command: "node dist/index.cjs",
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
