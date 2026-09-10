import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { AppointmentNotificationEvent } from "../../shared/schema";
import {
  processAppointmentNotification,
  processClaimedAppointmentNotification,
  processPendingAppointmentNotifications,
  type AppointmentNotificationDependencies,
} from "../../server/appointment-notifications";
import { recordMetaWebhookStatuses, verifyMetaWebhookChallenge, verifyMetaWebhookSignature } from "../../server/meta-webhook";
import { MemoryStorage } from "../../server/storage";
import { sendMetaTemplate, type MetaTemplateDeliveryResult } from "../../server/whatsapp";

const starts = [new Date("2030-06-03T09:00:00Z"), new Date("2030-06-04T10:00:00Z"), new Date("2030-06-05T11:00:00Z")];
const token = "11111111-2222-4333-8444-555555555555";
const accepted = (id = "wamid.accepted"): MetaTemplateDeliveryResult => ({ outcome: "accepted", provider: "meta",
  templateName: "appointment_confirmation_v1", providerMessageId: id, providerStatus: "META_ACCEPTED", responseStatus: 200, errorCode: null });
const failed: MetaTemplateDeliveryResult = { outcome: "failed", provider: "meta", templateName: "template",
  providerMessageId: null, providerStatus: "META_ERROR_1", responseStatus: 400, errorCode: "META_ERROR_1" };
const unknown: MetaTemplateDeliveryResult = { ...failed, outcome: "unknown", providerStatus: "META_TIMEOUT", responseStatus: null, errorCode: "META_TIMEOUT" };

async function fixture(optIn = true, email: string | null = "client@example.com", event = true) {
  const storage = new MemoryStorage();
  await storage.createBarber({ name: "Barber", specialty: "Cuts", isVisible: true });
  await storage.createService({ name: "Cut", price: 1500, duration: 30, isVisible: true });
  const appointment = await storage.createAppointment({ locationId: 1, barberId: 1, serviceId: 1, startTime: starts[0],
    customerName: "Client", customerEmail: email, customerPhone: "+351910000000", whatsappOptIn: optIn,
    durationMinutes: 30, cancelToken: token, notificationEventType: event ? "appointment_confirmation" : undefined });
  return { storage, appointment };
}

function deps(storage: MemoryStorage, whatsapp: MetaTemplateDeliveryResult, counters = { wa: 0, email: 0 }, emailSent = true): AppointmentNotificationDependencies {
  const sendEmail = async () => { counters.email += 1; return { sent: emailSent, providerMessageId: emailSent ? "email.id" : null, errorCode: emailSent ? null : "EMAIL_FAIL" }; };
  return { storage, developmentEnabled: true, whatsappEnabled: true, getLocation: async () => ({ id: 1, name: "Shop", slug: "shop", address: "Street 1",
    mapUrl: null, mapEmbedUrl: null, phone: null, email: null, timezone: "Europe/Lisbon", isActive: true, isDefault: true,
    sortOrder: 0, createdAt: new Date(), updatedAt: new Date() }),
    sendWhatsApp: async () => { counters.wa += 1; return whatsapp; },
    sendConfirmationEmail: sendEmail, sendRescheduleEmail: sendEmail, sendCancellationEmail: sendEmail };
}

test("confirmation accepted stores wamid, sends no email, and retry is idempotent", async () => {
  const { storage, appointment } = await fixture(); const [event] = await storage.getAppointmentNotificationEvents(appointment.id);
  const counters = { wa: 0, email: 0 }; const dependencies = deps(storage, accepted(), counters);
  assert.equal(await processAppointmentNotification(event.id, dependencies), "whatsapp");
  assert.equal(await processAppointmentNotification(event.id, dependencies), "none");
  assert.deepEqual(counters, { wa: 1, email: 0 });
  const saved = await storage.getAppointmentNotificationEvent(event.id);
  assert.equal(saved?.providerMessageId, "wamid.accepted"); assert.equal(saved?.emailStatus, "not_needed");
});

for (const result of [failed, unknown]) test(`confirmation ${result.outcome} uses one email and never retries WhatsApp`, async () => {
  const { storage, appointment } = await fixture(); const [event] = await storage.getAppointmentNotificationEvents(appointment.id);
  const counters = { wa: 0, email: 0 }; const dependencies = deps(storage, result, counters);
  assert.equal(await processAppointmentNotification(event.id, dependencies), "email");
  assert.equal(await processAppointmentNotification(event.id, dependencies), "none");
  assert.deepEqual(counters, { wa: 1, email: 1 });
});

test("confirmation becomes stale after reschedule or cancellation", async () => {
  for (const action of ["reschedule", "cancel"] as const) {
    const { storage, appointment } = await fixture(); const [event] = await storage.getAppointmentNotificationEvents(appointment.id);
    if (action === "reschedule") await storage.rescheduleAppointment(appointment.id, 0, starts[1]);
    else await storage.cancelAppointment(appointment.id, "booked", "cancelled");
    const counters = { wa: 0, email: 0 };
    assert.equal(await processAppointmentNotification(event.id, deps(storage, failed, counters)), "none");
    assert.deepEqual(counters, { wa: 0, email: 0 });
  }
});

test("manual booking without opt-in uses email and recurring batch only creates one confirmation", async () => {
  const storage = new MemoryStorage(); await storage.createBarber({ name: "B", specialty: "S" }); await storage.createService({ name: "C", price: 1, duration: 30 });
  const base = { locationId: 1, barberId: 1, serviceId: 1, customerName: "Client", customerEmail: "c@e.pt",
    customerPhone: "+351910000000", whatsappOptIn: false, durationMinutes: 30 };
  const appointments = await storage.createAppointments([
    { ...base, startTime: starts[0], cancelToken: `${token}-1`, notificationEventType: "appointment_confirmation" },
    { ...base, startTime: starts[1], cancelToken: `${token}-2` },
  ]);
  assert.equal((await storage.getAppointmentNotificationEvents(appointments[0].id)).length, 1);
  assert.equal((await storage.getAppointmentNotificationEvents(appointments[1].id)).length, 0);
  const [event] = await storage.getAppointmentNotificationEvents(appointments[0].id); const counters = { wa: 0, email: 0 };
  assert.equal(await processAppointmentNotification(event.id, deps(storage, accepted(), counters)), "email");
  assert.deepEqual(counters, { wa: 0, email: 1 });
});

test("normal and late cancellation use the same template; concurrent cancellation creates one event", async () => {
  for (const status of ["cancelled", "late_cancelled"] as const) {
    const { storage, appointment } = await fixture(true, "c@e.pt", false);
    const [one, two] = await Promise.all([storage.cancelAppointment(appointment.id, "booked", status), storage.cancelAppointment(appointment.id, "booked", status)]);
    assert.equal([one, two].filter(Boolean).length, 1); const result = one || two; assert.ok(result);
    let template = ""; const dependencies = deps(storage, accepted(`wamid.${status}`));
    dependencies.sendWhatsApp = async (params) => { template = params.eventType; return { ...accepted(), templateName: "appointment_cancelled_v1" }; };
    assert.equal(await processAppointmentNotification(result.notificationEvent.id, dependencies), "whatsapp");
    assert.equal(template, "appointment_cancelled");
  }
});

for (const result of [failed, unknown]) test(`cancellation ${result.outcome} uses one email fallback and never retries WhatsApp`, async () => {
  const { storage, appointment } = await fixture(true, "c@e.pt", false);
  const cancellation = await storage.cancelAppointment(appointment.id, "booked", "cancelled"); assert.ok(cancellation);
  const counters = { wa: 0, email: 0 }; const dependencies = deps(storage, result, counters);
  assert.equal(await processAppointmentNotification(cancellation.notificationEvent.id, dependencies), "email");
  assert.equal(await processAppointmentNotification(cancellation.notificationEvent.id, dependencies), "none");
  assert.deepEqual(counters, { wa: 1, email: 1 });
});

test("successive reschedules create distinct revisions and only the latest event is delivered", async () => {
  const { storage, appointment } = await fixture(true, "c@e.pt", false);
  const first = await storage.rescheduleAppointment(appointment.id, 0, starts[1]); assert.ok(first);
  const second = await storage.rescheduleAppointment(appointment.id, 1, starts[2]); assert.ok(second);
  assert.equal(first.notificationEvent.eventKey, `appointment:${appointment.id}:rescheduled:1`);
  assert.equal(second.notificationEvent.eventKey, `appointment:${appointment.id}:rescheduled:2`);
  const counters = { wa: 0, email: 0 }; const dependencies = deps(storage, accepted("wamid.rescheduled"), counters);
  assert.equal(await processAppointmentNotification(first.notificationEvent.id, dependencies), "none");
  assert.equal(await processAppointmentNotification(second.notificationEvent.id, dependencies), "whatsapp");
  assert.deepEqual(counters, { wa: 1, email: 0 });
});

test("administrative modification or reopening makes pending events stale", async () => {
  for (const eventKind of ["rescheduled", "cancelled"] as const) {
    const { storage, appointment } = await fixture(true, "c@e.pt", false);
    const operation = eventKind === "rescheduled"
      ? await storage.rescheduleAppointment(appointment.id, 0, starts[1])
      : await storage.cancelAppointment(appointment.id, "booked", "cancelled");
    assert.ok(operation);
    const current = await storage.getAppointment(appointment.id); assert.ok(current);
    await storage.updateAppointment(appointment.id, {
      status: "booked",
      notificationRevision: current.notificationRevision + 1,
    });
    const counters = { wa: 0, email: 0 };
    assert.equal(await processAppointmentNotification(operation.notificationEvent.id, deps(storage, accepted(), counters)), "none");
    assert.deepEqual(counters, { wa: 0, email: 0 });
  }
});

test("both channel failures never revert cancellation", async () => {
  const { storage, appointment } = await fixture(true, "c@e.pt", false);
  const result = await storage.cancelAppointment(appointment.id, "booked", "cancelled"); assert.ok(result);
  assert.equal(await processAppointmentNotification(result.notificationEvent.id, deps(storage, failed, { wa: 0, email: 0 }, false)), "none");
  assert.equal((await storage.getAppointment(appointment.id))?.status, "cancelled");
});

test("outbox recovers an abandoned pre-send claim and two workers do not duplicate", async () => {
  const { storage, appointment } = await fixture(); const [event] = await storage.getAppointmentNotificationEvents(appointment.id);
  assert.ok(await storage.claimAppointmentNotificationEvent(event.id));
  await storage.updateAppointmentNotificationEvent(event.id, { processingStartedAt: new Date(0) });
  const counters = { wa: 0, email: 0 }; const dependencies = deps(storage, accepted(), counters);
  const [a, b] = await Promise.all([processPendingAppointmentNotifications(dependencies, 1), processPendingAppointmentNotifications(dependencies, 1)]);
  assert.equal(a + b, 1); assert.deepEqual(counters, { wa: 1, email: 0 });
});

test("an expired lease cannot let two processors send the same WhatsApp", async () => {
  const { storage, appointment } = await fixture(); const [event] = await storage.getAppointmentNotificationEvents(appointment.id);
  const counters = { wa: 0, email: 0 }; const dependencies = deps(storage, accepted(), counters);
  const [first, second] = await Promise.all([
    processClaimedAppointmentNotification({ ...event }, dependencies),
    processClaimedAppointmentNotification({ ...event }, dependencies),
  ]);
  assert.deepEqual([first, second].sort(), ["none", "whatsapp"]);
  assert.deepEqual(counters, { wa: 1, email: 0 });
  assert.ok((await storage.getAppointmentNotificationEvent(event.id))?.processingCompletedAt);
});

test("interrupted external attempt becomes unknown and is never retried", async () => {
  const { storage, appointment } = await fixture(); const [event] = await storage.getAppointmentNotificationEvents(appointment.id);
  await storage.updateAppointmentNotificationEvent(event.id, { whatsappAttemptedAt: new Date(), processingStartedAt: new Date(0) });
  const counters = { wa: 0, email: 0 };
  await processPendingAppointmentNotifications(deps(storage, accepted(), counters), 1);
  assert.deepEqual(counters, { wa: 0, email: 1 });
  assert.equal((await storage.getAppointmentNotificationEvent(event.id))?.whatsappStatus, "unknown");
});

test("disabled WhatsApp defers unattempted opt-in events until activation", async () => {
  const { storage, appointment } = await fixture(); const [event] = await storage.getAppointmentNotificationEvents(appointment.id);
  const counters = { wa: 0, email: 0 }; const dependencies = deps(storage, accepted(), counters);
  dependencies.whatsappEnabled = false;
  assert.equal(await processPendingAppointmentNotifications(dependencies), 0);
  let saved = await storage.getAppointmentNotificationEvent(event.id);
  assert.equal(saved?.processingStartedAt, null); assert.equal(saved?.processingCompletedAt, null);
  assert.equal(saved?.whatsappAttemptedAt, null); assert.deepEqual(counters, { wa: 0, email: 0 });

  dependencies.whatsappEnabled = true;
  assert.equal(await processPendingAppointmentNotifications(dependencies), 1);
  saved = await storage.getAppointmentNotificationEvent(event.id);
  assert.equal(saved?.whatsappStatus, "accepted"); assert.ok(saved?.processingCompletedAt);
  assert.deepEqual(counters, { wa: 1, email: 0 });
});

test("disabled WhatsApp still processes email-only and already-attempted fallback events", async () => {
  const emailOnly = await fixture(false); const emailCounters = { wa: 0, email: 0 };
  const emailDeps = deps(emailOnly.storage, accepted(), emailCounters); emailDeps.whatsappEnabled = false;
  assert.equal(await processPendingAppointmentNotifications(emailDeps), 1);
  assert.deepEqual(emailCounters, { wa: 0, email: 1 });

  const interrupted = await fixture(); const [event] = await interrupted.storage.getAppointmentNotificationEvents(interrupted.appointment.id);
  await interrupted.storage.updateAppointmentNotificationEvent(event.id, { whatsappAttemptedAt: new Date(), processingStartedAt: new Date(0) });
  const interruptedCounters = { wa: 0, email: 0 }; const interruptedDeps = deps(interrupted.storage, accepted(), interruptedCounters);
  interruptedDeps.whatsappEnabled = false;
  assert.equal(await processPendingAppointmentNotifications(interruptedDeps, 1), 1);
  assert.deepEqual(interruptedCounters, { wa: 0, email: 1 });
  assert.equal((await interrupted.storage.getAppointmentNotificationEvent(event.id))?.whatsappStatus, "unknown");
});

test("an opt-in event deferred while disabled is discarded if it becomes stale before activation", async () => {
  const { storage, appointment } = await fixture(); const [confirmation] = await storage.getAppointmentNotificationEvents(appointment.id);
  const counters = { wa: 0, email: 0 }; const dependencies = deps(storage, accepted("wamid.latest"), counters);
  dependencies.whatsappEnabled = false;
  assert.equal(await processPendingAppointmentNotifications(dependencies), 0);
  const rescheduled = await storage.rescheduleAppointment(appointment.id, 0, starts[1]); assert.ok(rescheduled);

  dependencies.whatsappEnabled = true;
  assert.equal(await processPendingAppointmentNotifications(dependencies), 2);
  assert.equal((await storage.getAppointmentNotificationEvent(confirmation.id))?.errorCode, "STALE_EVENT");
  assert.equal((await storage.getAppointmentNotificationEvent(rescheduled.notificationEvent.id))?.whatsappStatus, "accepted");
  assert.deepEqual(counters, { wa: 1, email: 0 });
});

test("all three Meta payloads preserve exact body and button order", async () => {
  const previousFetch = globalThis.fetch; process.env.WHATSAPP_NOTIFICATIONS_ENABLED = "true"; process.env.MESSAGING_PROVIDER = "meta";
  process.env.META_WHATSAPP_GRAPH_API_VERSION = "v25.0"; process.env.META_WHATSAPP_PHONE_NUMBER_ID = "phone";
  process.env.META_WHATSAPP_WABA_ID = "waba"; process.env.META_WHATSAPP_ACCESS_TOKEN = "fake"; process.env.META_WHATSAPP_DEV_ALLOWLIST = "+351910000000";
  const bodies: any[] = []; globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ messages: [{ id: `wamid.${bodies.length}` }] }), { status: 200 }); };
  try {
    for (const eventType of ["appointment_confirmation", "appointment_rescheduled", "appointment_cancelled"] as const) await sendMetaTemplate({
      recipient: "+351910000000", eventType, customerName: "1", locationName: "2", serviceName: "3", barberName: "4",
      date: "5", time: "6", address: "7", managementToken: token });
  } finally { globalThis.fetch = previousFetch; }
  assert.deepEqual(bodies.map((body) => body.template.name), ["appointment_confirmation_v1", "appointment_rescheduled_v1", "appointment_cancelled_v1"]);
  assert.deepEqual(bodies[0].template.components[0].parameters.map((p: any) => p.text), ["1", "2", "3", "4", "5", "6", "7"]);
  assert.deepEqual(bodies[1].template.components.slice(1).map((c: any) => [c.index, c.parameters[0].text]), [["0", token], ["1", token]]);
  assert.deepEqual(bodies[2].template.components[0].parameters.map((p: any) => p.text), ["1", "2", "3", "5", "6"]);
  assert.equal(bodies[2].template.components.length, 1);
});

test("webhook challenge and signatures validate without exposing secrets", () => {
  process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = "verify-secret"; process.env.META_WHATSAPP_APP_SECRET = "app-secret";
  assert.equal(verifyMetaWebhookChallenge({ "hub.mode": "subscribe", "hub.verify_token": "verify-secret", "hub.challenge": "123" }), "123");
  assert.equal(verifyMetaWebhookChallenge({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "123" }), null);
  const raw = Buffer.from('{"test":true}'); const signature = `sha256=${createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
  assert.equal(verifyMetaWebhookSignature(raw, signature), true); assert.equal(verifyMetaWebhookSignature(raw, undefined), false);
  assert.equal(verifyMetaWebhookSignature(raw, "sha256=bad"), false);
});

function webhook(wamid: string, statuses: Array<{ status: string; timestamp: string; errors?: unknown[] }>, waba = "waba", phone = "phone") {
  return { object: "whatsapp_business_account", entry: [{ id: waba, changes: [{ field: "messages", value: {
    metadata: { phone_number_id: phone }, statuses: statuses.map((status) => ({ id: wamid, recipient_id: "351", ...status })) } }] }] };
}

test("webhook observes batches, duplicates, out-of-order states and failed without email fallback", async () => {
  process.env.META_WHATSAPP_WABA_ID = "waba"; process.env.META_WHATSAPP_PHONE_NUMBER_ID = "phone";
  const { storage, appointment } = await fixture(); const [event] = await storage.getAppointmentNotificationEvents(appointment.id);
  await storage.updateAppointmentNotificationEvent(event.id, { providerMessageId: "wamid.webhook", whatsappStatus: "accepted" });
  const batch = webhook("wamid.webhook", [{ status: "delivered", timestamp: "200" }, { status: "sent", timestamp: "100" }, { status: "read", timestamp: "300" }]);
  assert.deepEqual(await recordMetaWebhookStatuses(batch, storage), { recorded: 3, duplicates: 0, orphans: 0 });
  assert.deepEqual(await recordMetaWebhookStatuses(batch, storage), { recorded: 0, duplicates: 3, orphans: 0 });
  await recordMetaWebhookStatuses(webhook("wamid.webhook", [{ status: "failed", timestamp: "400", errors: [{ code: 131000 }] }]), storage);
  const saved = await storage.getAppointmentNotificationEvent(event.id);
  assert.equal(saved?.whatsappStatus, "read"); assert.equal(saved?.emailStatus, "not_needed"); assert.equal(saved?.webhookFallbackClaimedAt, null);
});

test("webhook persists sent, delivered and read progression individually", async () => {
  process.env.META_WHATSAPP_WABA_ID = "waba"; process.env.META_WHATSAPP_PHONE_NUMBER_ID = "phone";
  const { storage, appointment } = await fixture(); const [event] = await storage.getAppointmentNotificationEvents(appointment.id);
  await storage.updateAppointmentNotificationEvent(event.id, { providerMessageId: "wamid.progress", whatsappStatus: "accepted" });
  for (const [status, timestamp] of [["sent", "100"], ["delivered", "200"], ["read", "300"]] as const) {
    await recordMetaWebhookStatuses(webhook("wamid.progress", [{ status, timestamp }]), storage);
    assert.equal((await storage.getAppointmentNotificationEvent(event.id))?.whatsappStatus, status);
  }
});

test("failed webhook is persisted and orphan receipt can later be reconciled", async () => {
  process.env.META_WHATSAPP_WABA_ID = "waba"; process.env.META_WHATSAPP_PHONE_NUMBER_ID = "phone";
  const { storage, appointment } = await fixture(); const [event] = await storage.getAppointmentNotificationEvents(appointment.id);
  const payload = webhook("wamid.orphan", [{ status: "failed", timestamp: "500", errors: [{ code: 131014 }] }]);
  assert.deepEqual(await recordMetaWebhookStatuses(payload, storage), { recorded: 1, duplicates: 0, orphans: 1 });
  await storage.updateAppointmentNotificationEvent(event.id, { providerMessageId: "wamid.orphan", whatsappStatus: "accepted" });
  // A redelivery (which Meta may perform) reconciles even though the receipt is duplicate.
  assert.deepEqual(await recordMetaWebhookStatuses(payload, storage), { recorded: 0, duplicates: 1, orphans: 0 });
  assert.equal((await storage.getAppointmentNotificationEvent(event.id))?.whatsappStatus, "failed");
  assert.equal((await storage.getMetaWebhookReceipts("wamid.orphan"))[0].notificationEventId, event.id);
});

test("webhook rejects unexpected WABA and Phone Number ID", async () => {
  process.env.META_WHATSAPP_WABA_ID = "waba"; process.env.META_WHATSAPP_PHONE_NUMBER_ID = "phone"; const storage = new MemoryStorage();
  await assert.rejects(recordMetaWebhookStatuses(webhook("x", [], "wrong", "phone"), storage), /ACCOUNT_MISMATCH/);
  await assert.rejects(recordMetaWebhookStatuses(webhook("x", [], "waba", "wrong"), storage), /PHONE_MISMATCH/);
});

test("production environment does not activate Development deployment", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--eval", "import('./server/runtime-environment.ts').then(m=>console.log(m.isDevelopmentDeployment))"],
    { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", APP_ENV: "production" }, encoding: "utf8" }).trim();
  assert.equal(output, "false");
});
