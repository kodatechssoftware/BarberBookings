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
import { buildRecurringBookingEmail } from "../../server/email";
import {
  buildMetaAppointmentTemplateComponents,
  buildMetaRecurringTemplateParams,
  buildBookingCancellationMessage,
  buildBookingConfirmationMessage,
  formatMetaTemplateDate,
  getMetaAppointmentTemplateName,
  sendMetaTemplate,
  type MetaTemplateDeliveryResult,
} from "../../server/whatsapp";

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
  return { storage, processingEnabled: true, whatsappEnabled: true, getLocation: async () => ({ id: 1, name: "Shop", slug: "shop", address: "Street 1",
    mapUrl: null, mapEmbedUrl: null, phone: null, email: null, timezone: "Europe/Lisbon", isActive: true, isDefault: true,
    sortOrder: 0, createdAt: new Date(), updatedAt: new Date() }),
    sendWhatsApp: async () => { counters.wa += 1; return whatsapp; },
    sendConfirmationEmail: sendEmail, sendRescheduleEmail: sendEmail, sendCancellationEmail: sendEmail,
    sendRecurringConfirmationEmail: sendEmail };
}

async function recurringFixture(optIn = false) {
  const storage = new MemoryStorage();
  await storage.createBarber({ name: "Barber", specialty: "Cuts", isVisible: true });
  await storage.createService({ name: "Cut", price: 1500, duration: 30, isVisible: true });
  const result = await storage.createRecurringAppointmentSeries({
    series: { id: "series-test", locationId: 1, barberId: 1, serviceId: 1,
      customerName: "Client", customerEmail: "client@example.com", customerPhone: "+351910000000",
      whatsappOptIn: optIn, whatsappOptInAt: optIn ? new Date() : null, intervalWeeks: 1, durationMonths: 1,
      occurrenceCount: 3, firstStartTime: starts[0] },
    appointments: starts.map((startTime, index) => ({ locationId: 1, barberId: 1, serviceId: 1, startTime,
      customerName: "Client", customerEmail: "client@example.com", customerPhone: "+351910000000",
      whatsappOptIn: optIn, durationMinutes: 30, cancelToken: `${token}-${index}` })),
    notificationSnapshot: { schemaVersion: 1, customerName: "Client", customerEmail: "client@example.com",
      customerPhone: "+351910000000", whatsappOptIn: optIn,
      location: { id: 1, name: "Shop", address: "Street 1", timezone: "Europe/Lisbon" },
      service: { id: 1, name: "Cut" }, barber: { id: 1, name: "Barber" },
      recurrence: { intervalWeeks: 1, durationMonths: 1, occurrenceCount: 3 } },
  });
  return { storage, ...result };
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

test("confirmation without phone opt-in never attempts WhatsApp and uses email", async () => {
  const { storage, appointment } = await fixture(false);
  const [event] = await storage.getAppointmentNotificationEvents(appointment.id);
  const counters = { wa: 0, email: 0 };
  assert.equal(await processAppointmentNotification(event.id, deps(storage, accepted(), counters)), "email");
  assert.deepEqual(counters, { wa: 0, email: 1 });
});

test("WhatsApp failure without fallback email never reverts the booked appointment", async () => {
  const { storage, appointment } = await fixture(true, null);
  const [event] = await storage.getAppointmentNotificationEvents(appointment.id);
  const counters = { wa: 0, email: 0 };
  assert.equal(await processAppointmentNotification(event.id, deps(storage, failed, counters)), "none");
  assert.deepEqual(counters, { wa: 1, email: 0 });
  assert.equal((await storage.getAppointment(appointment.id))?.status, "booked");
  const saved = await storage.getAppointmentNotificationEvent(event.id);
  assert.equal(saved?.whatsappStatus, "failed");
  assert.equal(saved?.emailStatus, "skipped");
  assert.equal(saved?.emailErrorCode, "EMAIL_MISSING");
  assert.ok(saved?.processingCompletedAt);
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

test("disabled WhatsApp sends exactly one series email and no individual confirmation", async () => {
  const { storage, series, appointments, notificationEvent } = await recurringFixture();
  assert.equal(notificationEvent.eventKey, `series:${series.id}:recurring_confirmation:1`);
  assert.equal(notificationEvent.appointmentId, null);
  assert.equal(notificationEvent.seriesId, series.id);
  assert.equal(new Set(appointments.map((appointment) => appointment.cancelToken)).size, 3);
  assert.deepEqual(appointments.map((appointment) => appointment.seriesOccurrenceIndex), [0, 1, 2]);
  for (const appointment of appointments) {
    assert.equal((await storage.getAppointmentNotificationEvents(appointment.id)).length, 0);
  }
  assert.equal(JSON.stringify(notificationEvent.payloadSnapshot).includes("cancelToken"), false);

  const counters = { wa: 0, email: 0 };
  const dependencies = deps(storage, accepted(), counters);
  let recurringEmail: any;
  dependencies.sendRecurringConfirmationEmail = async (params) => {
    recurringEmail = params; counters.email += 1;
    return { sent: true, providerMessageId: "email.series", errorCode: null };
  };
  dependencies.whatsappEnabled = false;
  assert.equal(await processPendingAppointmentNotifications(dependencies), 1);
  assert.deepEqual(counters, { wa: 0, email: 1 });
  const saved = await storage.getAppointmentNotificationEvent(notificationEvent.id);
  assert.equal(saved?.whatsappStatus, "skipped");
  assert.equal(saved?.errorCode, "WHATSAPP_RECURRING_TEMPLATE_DISABLED");
  assert.equal(saved?.emailStatus, "sent");
  assert.equal(recurringEmail.locationTimeZone, "Europe/Lisbon");
  assert.deepEqual(recurringEmail.occurrences.map((date: Date) => date.toISOString()), starts.map((date) => date.toISOString()));
  assert.equal(recurringEmail.idempotencyKey, `${notificationEvent.eventKey}:email`);
});

test("series creation is atomic and rejects one occurrence", async () => {
  const { storage } = await recurringFixture();
  await assert.rejects(storage.createRecurringAppointmentSeries({
    series: { id: "series-one", locationId: 1, barberId: 1, serviceId: 1, customerName: "One",
      customerEmail: null, customerPhone: "+351910000001", whatsappOptIn: false, whatsappOptInAt: null,
      intervalWeeks: 52, durationMonths: 1, occurrenceCount: 1, firstStartTime: new Date("2031-01-01T10:00:00Z") },
    appointments: [{ locationId: 1, barberId: 1, serviceId: 1, startTime: new Date("2031-01-01T10:00:00Z"),
      customerName: "One", customerEmail: null, customerPhone: "+351910000001", durationMinutes: 30, cancelToken: "one" }],
    notificationSnapshot: { schemaVersion: 1, customerName: "One", customerEmail: null,
      customerPhone: "+351910000001", whatsappOptIn: false,
      location: { id: 1, name: "Shop", address: "Street", timezone: "Europe/Lisbon" },
      service: { id: 1, name: "Cut" }, barber: { id: 1, name: "Barber" },
      recurrence: { intervalWeeks: 52, durationMonths: 1, occurrenceCount: 1 } },
  }), /at least two/);
  assert.equal(await storage.getAppointmentSeries("series-one"), undefined);

  const base = { locationId: 1, barberId: 1, serviceId: 1, customerName: "Rollback",
    customerEmail: "rollback@example.com", customerPhone: "+351910000002", durationMinutes: 30 };
  await assert.rejects(storage.createRecurringAppointmentSeries({
    series: { id: "series-rollback", locationId: 1, barberId: 1, serviceId: 1, customerName: "Rollback",
      customerEmail: "rollback@example.com", customerPhone: "+351910000002", whatsappOptIn: false,
      whatsappOptInAt: null, intervalWeeks: 1, durationMonths: 1, occurrenceCount: 2,
      firstStartTime: new Date("2030-06-02T10:00:00Z") },
    appointments: [
      { ...base, startTime: new Date("2030-06-02T10:00:00Z"), cancelToken: "rollback-1" },
      { ...base, startTime: starts[0], cancelToken: "rollback-2" },
    ],
    notificationSnapshot: { schemaVersion: 1, customerName: "Rollback", customerEmail: "rollback@example.com",
      customerPhone: "+351910000002", whatsappOptIn: false,
      location: { id: 1, name: "Shop", address: "Street", timezone: "Europe/Lisbon" },
      service: { id: 1, name: "Cut" }, barber: { id: 1, name: "Barber" },
      recurrence: { intervalWeeks: 1, durationMonths: 1, occurrenceCount: 2 } },
  }));
  assert.equal(await storage.getAppointmentSeries("series-rollback"), undefined);
  assert.equal((await storage.getAppointments()).some((appointment) => appointment.customerName === "Rollback"), false);
});

test("a relevant occurrence change makes the pending series confirmation stale", async () => {
  const { storage, series, appointments, notificationEvent } = await recurringFixture();
  await storage.updateAppointment(appointments[1].id, { startTime: new Date("2030-06-04T12:00:00Z") });
  assert.equal((await storage.getAppointmentSeries(series.id))?.notificationRevision, 2);
  const counters = { wa: 0, email: 0 };
  assert.equal(await processAppointmentNotification(notificationEvent.id, deps(storage, accepted(), counters)), "none");
  assert.deepEqual(counters, { wa: 0, email: 0 });
  assert.equal((await storage.getAppointmentNotificationEvent(notificationEvent.id))?.emailErrorCode, "STALE_EVENT");
});

test("legacy and ordinary appointments remain ungrouped", async () => {
  const { storage, appointment } = await fixture(false);
  assert.equal(appointment.seriesId, null);
  assert.equal(appointment.seriesOccurrenceIndex, null);
  assert.equal((await storage.getAppointments()).filter((item) => item.seriesId !== null).length, 0);
});

test("two outbox workers send a recurring confirmation once", async () => {
  const { storage } = await recurringFixture();
  const counters = { wa: 0, email: 0 };
  const dependencies = deps(storage, accepted(), counters); dependencies.whatsappEnabled = false;
  const [first, second] = await Promise.all([
    processPendingAppointmentNotifications(dependencies), processPendingAppointmentNotifications(dependencies),
  ]);
  assert.equal(first + second, 1);
  assert.deepEqual(counters, { wa: 0, email: 1 });
});

test("recurring confirmation recovers an abandoned outbox lease without duplication", async () => {
  const { storage, notificationEvent } = await recurringFixture();
  assert.ok(await storage.claimAppointmentNotificationEvent(notificationEvent.id));
  await storage.updateAppointmentNotificationEvent(notificationEvent.id, { processingStartedAt: new Date(0) });
  const counters = { wa: 0, email: 0 };
  const dependencies = deps(storage, accepted(), counters); dependencies.whatsappEnabled = false;
  assert.equal(await processPendingAppointmentNotifications(dependencies, 1), 1);
  assert.equal(await processPendingAppointmentNotifications(dependencies, 1), 0);
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

test("Production policy sends email immediately when WhatsApp is disabled", async () => {
  const { storage, appointment } = await fixture(true);
  const counters = { wa: 0, email: 0 };
  const dependencies = deps(storage, accepted(), counters);
  dependencies.whatsappEnabled = false;
  dependencies.deferWhatsappWhenDisabled = false;
  assert.equal(await processPendingAppointmentNotifications(dependencies), 1);
  assert.deepEqual(counters, { wa: 0, email: 1 });
  const [event] = await storage.getAppointmentNotificationEvents(appointment.id);
  assert.equal(event.emailStatus, "sent");
});

test("recurring WhatsApp remains separately gated and can use Meta only after explicit activation", async () => {
  const gated = await recurringFixture(true);
  const gatedCounters = { wa: 0, email: 0 };
  const gatedDependencies = deps(gated.storage, accepted("wamid.must-not-send"), gatedCounters);
  gatedDependencies.recurringWhatsappEnabled = false;
  assert.equal(await processAppointmentNotification(gated.notificationEvent.id, gatedDependencies), "email");
  assert.deepEqual(gatedCounters, { wa: 0, email: 1 });
  assert.equal((await gated.storage.getAppointmentNotificationEvent(gated.notificationEvent.id))?.errorCode,
    "WHATSAPP_RECURRING_TEMPLATE_DISABLED");

  const { storage, notificationEvent } = await recurringFixture(true);
  const counters = { wa: 0, email: 0 };
  const dependencies = deps(storage, { ...accepted("wamid.recurring"), templateName: "appointment_recurring_confirmation_v1" }, counters);
  dependencies.recurringWhatsappEnabled = true;
  assert.equal(await processAppointmentNotification(notificationEvent.id, dependencies), "whatsapp");
  assert.deepEqual(counters, { wa: 1, email: 0 });
  const saved = await storage.getAppointmentNotificationEvent(notificationEvent.id);
  assert.equal(saved?.providerMessageId, "wamid.recurring");
  assert.equal(saved?.emailStatus, "not_needed");
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
      startTime: new Date("2026-09-15T13:30:00.000Z"), timeZone: "Europe/Lisbon", address: "7", managementToken: token });
  } finally { globalThis.fetch = previousFetch; }
  assert.deepEqual(bodies.map((body) => body.template.name), ["appointment_confirmation_v1", "appointment_rescheduled_v1", "appointment_cancelled_v1"]);
  assert.deepEqual(bodies[0].template.components[0].parameters.map((p: any) => p.text),
    ["1", "2", "3", "4", "15 de setembro de 2026", "14:30h", "7"]);
  assert.deepEqual(bodies[1].template.components.slice(1).map((c: any) => [c.index, c.parameters[0].text]), [["0", token], ["1", token]]);
  assert.deepEqual(bodies[2].template.components[0].parameters.map((p: any) => p.text),
    ["1", "2", "3", "15 de setembro de 2026", "14:30h"]);
  assert.equal(bodies[2].template.components.length, 1);
});

test("Development defaults and Production configuration select the four exact Meta templates", () => {
  const eventTypes = ["appointment_confirmation", "appointment_rescheduled", "appointment_cancelled",
    "appointment_recurring_confirmation"] as const;
  assert.deepEqual(eventTypes.map((eventType) => getMetaAppointmentTemplateName(eventType, {
    NODE_ENV: "production", APP_ENV: "development",
  })), ["appointment_confirmation_v1", "appointment_rescheduled_v1", "appointment_cancelled_v1",
    "appointment_recurring_confirmation_v1"]);

  const productionEnvironment = {
    NODE_ENV: "production", APP_ENV: "production",
    META_WHATSAPP_CONFIRMATION_TEMPLATE: "appointment_confirmation_prod_v1",
    META_WHATSAPP_RESCHEDULED_TEMPLATE: "appointment_rescheduled_prod_v2",
    META_WHATSAPP_CANCELLED_TEMPLATE: "appointment_cancelled_prod_v2",
    META_WHATSAPP_RECURRING_CONFIRMATION_TEMPLATE: "appointment_recurring_confirmation_prod_v1",
  };
  assert.deepEqual(eventTypes.map((eventType) => getMetaAppointmentTemplateName(eventType, productionEnvironment)),
    ["appointment_confirmation_prod_v1", "appointment_rescheduled_prod_v2", "appointment_cancelled_prod_v2",
      "appointment_recurring_confirmation_prod_v1"]);
  assert.equal(getMetaAppointmentTemplateName("appointment_confirmation", {
    NODE_ENV: "production", APP_ENV: "production",
  }), null);
});

test("disabled WhatsApp or messaging provider none never calls Meta with configured template names", async () => {
  const environmentNames = ["WHATSAPP_NOTIFICATIONS_ENABLED", "MESSAGING_PROVIDER",
    "META_WHATSAPP_CONFIRMATION_TEMPLATE"] as const;
  const previousEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(null, { status: 500 }); };
  const params = { recipient: "+351910000000", eventType: "appointment_confirmation" as const,
    customerName: "Cliente", locationName: "Loja", serviceName: "Corte", barberName: "Barbeiro",
    startTime: new Date("2026-09-15T13:30:00.000Z"), timeZone: "Europe/Lisbon", managementToken: token };
  try {
    process.env.META_WHATSAPP_CONFIRMATION_TEMPLATE = "configured_template";
    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = "false";
    process.env.MESSAGING_PROVIDER = "meta";
    assert.equal((await sendMetaTemplate(params)).errorCode, "META_NOT_CONFIGURED");
    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = "true";
    process.env.MESSAGING_PROVIDER = "none";
    assert.equal((await sendMetaTemplate(params)).errorCode, "META_NOT_CONFIGURED");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    for (const name of environmentNames) {
      const value = previousEnvironment[name];
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("future recurring Meta payload uses PT-PT long date, nine parameters, and no buttons", async () => {
  const params = buildMetaRecurringTemplateParams({ schemaVersion: 1, seriesId: "series-meta",
    customerName: "Cliente", customerEmail: "c@example.com", customerPhone: "+351910000000", whatsappOptIn: false,
    location: { id: 1, name: "Lisboa", address: "Rua 1", timezone: "Europe/Lisbon" },
    service: { id: 1, name: "Corte" }, barber: { id: 1, name: "João" },
    recurrence: { intervalWeeks: 1, durationMonths: 1, occurrenceCount: 4 },
    occurrences: [0, 1, 2, 3].map((occurrenceIndex) => ({ appointmentId: occurrenceIndex + 1, occurrenceIndex,
      startTime: new Date(Date.UTC(2026, 8, 15 + occurrenceIndex * 7, 13, 30)).toISOString() })) });
  const components = buildMetaAppointmentTemplateComponents(params);
  assert.deepEqual(components[0].parameters.map((parameter) => parameter.text), [
    "Cliente", "Lisboa", "Corte", "João", "Semanal", "15 de setembro de 2026", "14:30h", "4", "Rua 1",
  ]);
  assert.equal(components.length, 1);
  assert.equal(formatMetaTemplateDate(params.startTime, params.timeZone), "15 de setembro de 2026");
  const delivery = await sendMetaTemplate(params);
  assert.equal(delivery.errorCode, "META_RECURRING_TEMPLATE_DISABLED");
});

test("legacy WhatsApp messages also append h to PT-PT times", () => {
  const common = { customerName: "Cliente", barberName: "João", serviceName: "Corte",
    startTime: new Date("2026-09-15T08:30:00.000Z"), cancelUrl: "https://example.com/cancel" };
  assert.match(buildBookingConfirmationMessage(common), /09:30h/);
  assert.match(buildBookingCancellationMessage(common), /09:30h/);
});

test("recurring email keeps the established layout and complete ordered occurrence list", () => {
  const content = buildRecurringBookingEmail({ customerName: "Cliente", customerEmail: "c@example.com",
    locationName: "Loja", locationAddress: "Rua 1", locationTimeZone: "Europe/Lisbon",
    serviceName: "Corte", barberName: "João", intervalWeeks: 2, durationMonths: 3,
    occurrences: [starts[2], starts[0], starts[1]] });
  assert.match(content.subject, /Confirmação de marcações recorrentes - Loja/);
  for (const label of ["Cliente:", "Localização:", "Serviço:", "Barbeiro:", "Periodicidade:",
    "Duração configurada:", "Primeira marcação:", "Total:", "Morada:", "Datas da série"]) assert.match(content.html, new RegExp(label));
  assert.match(content.html, /Cada marcação desta série é gerida individualmente/);
  assert.match(content.html, /10:00h/);
  assert.ok(content.html.indexOf("segunda-feira") < content.html.indexOf("terça-feira"));
  assert.doesNotMatch(content.html, /Reagendar|Cancelar/);
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
