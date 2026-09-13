import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 5017);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "multi-location.spec.ts",
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL, trace: "on-first-retry", timezoneId: "Europe/Lisbon" },
  webServer: {
    env: { TZ: "UTC", SHOP_TIME_ZONE: "Europe/Lisbon", DEMO_MODE: "false", PUBLIC_BOOKING_MONTHLY_WINDOW_ENABLED: "false", RESEND_API_KEY: "", RESEND_FROM_EMAIL: "", WHATSAPP_NOTIFICATIONS_ENABLED: "false", MESSAGING_PROVIDER: "none" },
    command: `npx cross-env NODE_ENV=development USE_MEMORY_STORAGE=true MULTI_LOCATION_ENABLED=true MAX_LOCATIONS=4 PORT=${port} SESSION_SECRET=playwright-multilocation ADMIN_INITIAL_PASSWORD=Playwright-Test-Admin-2026! SHOP_NAME=BarberBook_Demo SHOP_ADDRESS=Praca_do_Comercio_Lisboa VITE_SHOP_MAP_URL=https://www.google.com/maps?q=Lisboa VITE_SHOP_MAP_EMBED_URL=https://www.google.com/maps/embed?pb=demo tsx server/index.ts`,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
