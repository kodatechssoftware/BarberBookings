import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAppointmentManagementLinks,
  buildGoogleCalendarUrl,
  type EmailDeliveryResult,
} from "../../server/email";
import {
  processRescheduleNotification,
  type RescheduleNotificationContext,
  type RescheduleNotificationDependencies,
} from "../../server/reschedule-notifications";
import { MemoryStorage } from "../../server/storage";
import {
  sendMetaAppointmentRescheduled,
  type MetaTemplateDeliveryResult,
} from "../../server/whatsapp";

const originalStart = new Date("2030-06-03T09:00:00.000Z");
const rescheduledStarts = [
  new Date("2030-06-04T10:00:00.000Z"),
  new Date("2030-06-05T11:00:00.000Z"),
  new Date("2030-06-06T12:00:00.000Z"),
];
const token = "11111111-2222-4333-8444-555555555555";

async function createAppointment(storage: MemoryStorage, overrides: { email?: string | null; optIn?: boolean } = {}) {
  return storage.createAppointment({
    locationId: 1,
    barberId: 1,
    serviceId: 1,
    startTime: originalStart,
    customerName: "Cliente Teste",
    customerEmail: overrides.email === undefined ? "cliente@example.com" : overrides.email,
    customerPhone: "+351910000000",
    whatsappOptIn: overrides.optIn ?? true,
    durationMinutes: 30,
    cancelToken: token,
  });
}

function contextFor(
  result: Awaited<ReturnType<MemoryStorage["rescheduleAppointment"]>> & {},
): RescheduleNotificationContext {
  const appointment = result.appointment;
  return {
    eventId: result.notificationEvent.id,
    appointmentId: appointment.id,
    eventRevision: appointment.rescheduleRevision,
    customerName: appointment.customerName,
    customerEmail: appointment.customerEmail,
    customerPhone: appointment.customerPhone,
    whatsappOptIn: appointment.whatsappOptIn,
    barberName: "Barbeiro Teste",
    serviceName: "Corte",
    startTime: new Date(appointment.startTime),
    cancelToken: appointment.cancelToken,
    durationMinutes: appointment.durationMinutes,
    locationName: "Loja Teste",
    locationAddress: "Rua de Teste, 1",
    locationTimeZone: "Europe/Lisbon",
  };
}

const acceptedResult: MetaTemplateDeliveryResult = {
  outcome: "accepted",
  provider: "meta",
  templateName: "appointment_rescheduled_v1",
  providerMessageId: "wamid.test.accepted",
  providerStatus: "META_ACCEPTED",
  responseStatus: 200,
  errorCode: null,
};

const failedResult: MetaTemplateDeliveryResult = {
  outcome: "failed",
  provider: "meta",
  templateName: "appointment_rescheduled_v1",
  providerMessageId: null,
  providerStatus: "META_ERROR_131000",
  responseStatus: 400,
  errorCode: "META_ERROR_131000",
};

function dependencies(
  storage: MemoryStorage,
  whatsappResult: MetaTemplateDeliveryResult,
  counters: { whatsapp: number; email: number },
  emailResult: EmailDeliveryResult = { sent: true, providerMessageId: "email_test", errorCode: null },
): RescheduleNotificationDependencies {
  return {
    storage,
    developmentEnabled: true,
    sendWhatsApp: async () => {
      counters.whatsapp += 1;
      return whatsappResult;
    },
    sendEmail: async () => {
      counters.email += 1;
      return emailResult;
    },
  };
}

test("first, second and third reschedules create distinct revisions and keep the management token", async () => {
  const storage = new MemoryStorage();
  let appointment = await createAppointment(storage);
  const keys: string[] = [];

  for (const startTime of rescheduledStarts) {
    const result = await storage.rescheduleAppointment(appointment.id, appointment.rescheduleRevision, startTime);
    assert.ok(result);
    appointment = result.appointment;
    keys.push(result.notificationEvent.eventKey);
    assert.equal(appointment.cancelToken, token);
    assert.equal(new Date(appointment.startTime).getTime(), startTime.getTime());
  }

  assert.equal(appointment.rescheduleRevision, 3);
  assert.deepEqual(keys, [
    "appointment:1:rescheduled:1",
    "appointment:1:rescheduled:2",
    "appointment:1:rescheduled:3",
  ]);
  assert.equal((await storage.getAppointmentByToken(token))?.rescheduleRevision, 3);
});

test("two concurrent requests using the same revision allow only one real reschedule", async () => {
  const storage = new MemoryStorage();
  const appointment = await createAppointment(storage);
  const [first, second] = await Promise.all([
    storage.rescheduleAppointment(appointment.id, 0, rescheduledStarts[0]),
    storage.rescheduleAppointment(appointment.id, 0, rescheduledStarts[1]),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal((await storage.getAppointment(appointment.id))?.rescheduleRevision, 1);
});

test("Meta acceptance persists wamid, sends no email and a retry does not duplicate", async () => {
  const storage = new MemoryStorage();
  const appointment = await createAppointment(storage);
  const result = await storage.rescheduleAppointment(appointment.id, 0, rescheduledStarts[0]);
  assert.ok(result);
  const counters = { whatsapp: 0, email: 0 };
  const deps = dependencies(storage, acceptedResult, counters);

  assert.equal(await processRescheduleNotification(contextFor(result), deps), "whatsapp");
  assert.equal(await processRescheduleNotification(contextFor(result), deps), "none");
  assert.deepEqual(counters, { whatsapp: 1, email: 0 });
  const event = await storage.getAppointmentNotificationEvent(result.notificationEvent.id);
  assert.equal(event?.whatsappStatus, "accepted");
  assert.equal(event?.providerMessageId, "wamid.test.accepted");
  assert.equal(event?.emailStatus, "not_needed");
});

test("clear Meta failure sends exactly one email fallback", async () => {
  const storage = new MemoryStorage();
  const appointment = await createAppointment(storage);
  const result = await storage.rescheduleAppointment(appointment.id, 0, rescheduledStarts[0]);
  assert.ok(result);
  const counters = { whatsapp: 0, email: 0 };
  const deps = dependencies(storage, failedResult, counters);

  assert.equal(await processRescheduleNotification(contextFor(result), deps), "email");
  assert.equal(await processRescheduleNotification(contextFor(result), deps), "none");
  assert.deepEqual(counters, { whatsapp: 1, email: 1 });
  const event = await storage.getAppointmentNotificationEvent(result.notificationEvent.id);
  assert.equal(event?.whatsappStatus, "failed");
  assert.equal(event?.emailStatus, "sent");
});

test("timeout is unknown, is not retried, and both channel failures do not alter the reschedule", async () => {
  const storage = new MemoryStorage();
  const appointment = await createAppointment(storage);
  const result = await storage.rescheduleAppointment(appointment.id, 0, rescheduledStarts[0]);
  assert.ok(result);
  const counters = { whatsapp: 0, email: 0 };
  const unknownResult: MetaTemplateDeliveryResult = {
    ...failedResult,
    outcome: "unknown",
    providerStatus: "META_TIMEOUT",
    responseStatus: null,
    errorCode: "META_TIMEOUT",
  };
  const deps = dependencies(
    storage,
    unknownResult,
    counters,
    { sent: false, providerMessageId: null, errorCode: "EMAIL_NETWORK_ERROR" },
  );

  assert.equal(await processRescheduleNotification(contextFor(result), deps), "none");
  assert.equal(await processRescheduleNotification(contextFor(result), deps), "none");
  assert.deepEqual(counters, { whatsapp: 1, email: 1 });
  assert.equal((await storage.getAppointment(appointment.id))?.rescheduleRevision, 1);
  const event = await storage.getAppointmentNotificationEvent(result.notificationEvent.id);
  assert.equal(event?.whatsappStatus, "unknown");
  assert.equal(event?.emailStatus, "failed");
});

test("an older event cannot send fallback after a later reschedule", async () => {
  const storage = new MemoryStorage();
  const appointment = await createAppointment(storage);
  const first = await storage.rescheduleAppointment(appointment.id, 0, rescheduledStarts[0]);
  assert.ok(first);
  const second = await storage.rescheduleAppointment(appointment.id, 1, rescheduledStarts[1]);
  assert.ok(second);
  const counters = { whatsapp: 0, email: 0 };

  assert.equal(await processRescheduleNotification(contextFor(first), dependencies(storage, failedResult, counters)), "none");
  assert.deepEqual(counters, { whatsapp: 0, email: 0 });
  assert.equal((await storage.getAppointmentNotificationEvent(first.notificationEvent.id))?.emailErrorCode, "STALE_EVENT");
});

test("links keep the stable token and Google Calendar uses the latest start and end", () => {
  process.env.PUBLIC_URL = "https://barberbookings-dev.onrender.com";
  assert.deepEqual(buildAppointmentManagementLinks(token), {
    rescheduleUrl: `https://barberbookings-dev.onrender.com/reschedule/${token}`,
    cancelUrl: `https://barberbookings-dev.onrender.com/cancel/${token}`,
  });

  const calendarUrl = buildGoogleCalendarUrl({
    locationName: "Loja Teste",
    locationAddress: "Rua de Teste, 1",
    serviceName: "Corte",
    barberName: "Barbeiro Teste",
    startTime: rescheduledStarts[2],
    durationMinutes: 30,
  });
  assert.equal(
    new URL(calendarUrl).searchParams.get("dates"),
    "20300606T120000Z/20300606T123000Z",
  );
});

test("Meta reschedule payload uses pt_PT, seven body values and the token in both URL buttons", async () => {
  const previousFetch = globalThis.fetch;
  process.env.WHATSAPP_NOTIFICATIONS_ENABLED = "true";
  process.env.MESSAGING_PROVIDER = "meta";
  process.env.META_WHATSAPP_GRAPH_API_VERSION = "v23.0";
  process.env.META_WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
  process.env.META_WHATSAPP_WABA_ID = "test-waba-id";
  process.env.META_WHATSAPP_ACCESS_TOKEN = "test-token-not-real";
  process.env.META_WHATSAPP_DEV_ALLOWLIST = "+351910000000";
  let requestBody: any;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ messages: [{ id: "wamid.payload.test" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await sendMetaAppointmentRescheduled({
      recipient: "+351910000000",
      customerName: "Cliente Teste",
      locationName: "Loja Teste",
      serviceName: "Corte",
      barberName: "Barbeiro Teste",
      date: "6 de junho de 2030",
      time: "13:00",
      address: "Rua de Teste, 1",
      managementToken: token,
    });
    assert.equal(result.outcome, "accepted");
    assert.equal(result.providerMessageId, "wamid.payload.test");
    assert.equal(requestBody.template.name, "appointment_rescheduled_v1");
    assert.equal(requestBody.template.language.code, "pt_PT");
    assert.equal(requestBody.template.components[0].parameters.length, 7);
    assert.equal(requestBody.template.components[1].parameters[0].text, token);
    assert.equal(requestBody.template.components[2].parameters[0].text, token);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
