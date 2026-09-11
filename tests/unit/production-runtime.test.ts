import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const baseEnvironment = {
  ...process.env,
  NODE_ENV: "production",
  APP_ENV: "production",
  PUBLIC_URL: "https://bookings.example.test",
  SESSION_SECRET: "production-test-secret-with-more-than-32-characters",
  MULTI_LOCATION_ENABLED: "false",
  MAX_LOCATIONS: "1",
  APPOINTMENT_NOTIFICATION_EVENTS_ENABLED: "false",
  NOTIFICATION_OUTBOX_WORKER_ENABLED: "false",
  WHATSAPP_NOTIFICATIONS_ENABLED: "false",
  META_WHATSAPP_WEBHOOK_ENABLED: "false",
  META_WHATSAPP_RECURRING_NOTIFICATIONS_ENABLED: "false",
};

function evaluate(environment: NodeJS.ProcessEnv, expression: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "--eval",
    `import('./server/runtime-environment.ts').then(m=>{${expression}})`], {
    cwd: process.cwd(), env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

test("Production runtime starts fail-closed without Meta credentials", () => {
  const output = evaluate(baseEnvironment, `m.validateRuntimeConfiguration(); console.log(JSON.stringify({
    production:m.isProductionDeployment, development:m.isDevelopmentDeployment,
    events:m.appointmentNotificationEventsEnabled, worker:m.appointmentNotificationWorkerEnabled,
    recurring:m.recurringWhatsappNotificationsEnabled
  }))`);
  assert.deepEqual(JSON.parse(output), {
    production: true, development: false, events: false, worker: false, recurring: false,
  });
});

test("Production notification capabilities also default to off when activation flags are absent", () => {
  const environment = { ...baseEnvironment };
  delete environment.APPOINTMENT_NOTIFICATION_EVENTS_ENABLED;
  delete environment.NOTIFICATION_OUTBOX_WORKER_ENABLED;
  delete environment.META_WHATSAPP_RECURRING_NOTIFICATIONS_ENABLED;
  const output = evaluate(environment, `console.log(JSON.stringify({
    events:m.appointmentNotificationEventsEnabled, worker:m.appointmentNotificationWorkerEnabled,
    recurring:m.recurringWhatsappNotificationsEnabled
  }))`);
  assert.deepEqual(JSON.parse(output), { events: false, worker: false, recurring: false });
});

test("Production rejects ambiguous APP_ENV, localhost URL and weak session secret", () => {
  assert.throws(() => evaluate({ ...baseEnvironment, APP_ENV: "" }, "m.validateRuntimeConfiguration()"));
  assert.throws(() => evaluate({ ...baseEnvironment, PUBLIC_URL: "http://localhost:5000" }, "m.validateRuntimeConfiguration()"));
  assert.throws(() => evaluate({ ...baseEnvironment, SESSION_SECRET: "short" }, "m.validateRuntimeConfiguration()"));
});

test("Production refuses partially activated outbox, Meta and webhook capabilities", () => {
  assert.throws(() => evaluate({ ...baseEnvironment, NOTIFICATION_OUTBOX_WORKER_ENABLED: "true" }, "m.validateRuntimeConfiguration()"));
  assert.throws(() => evaluate({ ...baseEnvironment, WHATSAPP_NOTIFICATIONS_ENABLED: "true",
    APPOINTMENT_NOTIFICATION_EVENTS_ENABLED: "true", NOTIFICATION_OUTBOX_WORKER_ENABLED: "true",
  }, "m.validateRuntimeConfiguration()"));
  assert.throws(() => evaluate({ ...baseEnvironment, META_WHATSAPP_WEBHOOK_ENABLED: "true" }, "m.validateRuntimeConfiguration()"));
});

test("disabled multi-location ignores an invalid limit and remains single-location", async () => {
  const { parseMultiLocationConfig } = await import("../../shared/multi-location-config");
  assert.deepEqual(parseMultiLocationConfig({ MULTI_LOCATION_ENABLED: "false", MAX_LOCATIONS: "not-a-number" }), {
    enabled: false, maxLocations: 1,
  });
});

test("Production Meta delivery does not depend on the Development allowlist", () => {
  const output = evaluate({
    ...baseEnvironment,
    USE_MEMORY_STORAGE: "true",
    WHATSAPP_NOTIFICATIONS_ENABLED: "true",
    MESSAGING_PROVIDER: "meta",
    META_WHATSAPP_GRAPH_API_VERSION: "v25.0",
    META_WHATSAPP_PHONE_NUMBER_ID: "production-test-phone-id",
    META_WHATSAPP_WABA_ID: "production-test-waba-id",
    META_WHATSAPP_ACCESS_TOKEN: "production-test-token",
    META_WHATSAPP_DEV_ALLOWLIST: "",
  }, `return import('./server/whatsapp.ts').then(async w => {
    globalThis.fetch = async () => new Response(JSON.stringify({messages:[{id:'wamid.production-test'}]}), {status:200});
    const result = await w.sendMetaTemplate({recipient:'+351912000009', eventType:'appointment_cancelled',
      customerName:'Cliente', locationName:'Loja', serviceName:'Corte', barberName:'Barbeiro',
      startTime:new Date('2030-01-01T10:00:00Z'), timeZone:'Europe/Lisbon'});
    console.log(JSON.stringify(result));
  })`);
  const result = JSON.parse(output);
  assert.equal(result.outcome, "accepted");
  assert.equal(result.providerMessageId, "wamid.production-test");
});
