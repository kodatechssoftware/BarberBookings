import assert from "node:assert/strict";
import test from "node:test";
import {
  getAppointmentReminderAvailableAt,
  isAppointmentReminderDeliveryWindow,
} from "../../server/appointment-reminders";
import {
  processAppointmentNotification,
  processMetaLateFailureEmailFallback,
  processPendingAppointmentNotifications,
  type AppointmentNotificationDependencies,
} from "../../server/appointment-notifications";
import { buildAppointmentReminderEmail } from "../../server/email";
import { MemoryStorage } from "../../server/storage";
import {
  buildMetaAppointmentTemplateComponents,
  getMetaAppointmentTemplateName,
  type MetaTemplateDeliveryResult,
} from "../../server/whatsapp";

const token = "11111111-2222-4333-8444-555555555555";
const timeZone = "Europe/Lisbon";
const accepted = (status = "META_ACCEPTED"): MetaTemplateDeliveryResult => ({
  outcome: "accepted",
  provider: "meta",
  templateName: "appointment_reminder_day_before",
  providerMessageId: "wamid.reminder",
  providerStatus: status,
  responseStatus: 200,
  errorCode: null,
});
const failed: MetaTemplateDeliveryResult = {
  outcome: "failed",
  provider: "meta",
  templateName: "appointment_reminder_day_before",
  providerMessageId: null,
  providerStatus: "META_ERROR_131000",
  responseStatus: 400,
  errorCode: "META_ERROR_131000",
};

async function fixture(startTime: Date, createdAt: Date, optIn = true) {
  const storage = new MemoryStorage();
  await storage.createBarber({ name: "Fábio", specialty: "Cortes", isVisible: true });
  await storage.createService({ name: "Corte", price: 1500, duration: 30, isVisible: true });
  const reminderAvailableAt = getAppointmentReminderAvailableAt(startTime, timeZone, createdAt);
  const appointment = await storage.createAppointment({
    locationId: 1,
    barberId: 1,
    serviceId: 1,
    startTime,
    customerName: "Cliente",
    customerEmail: "cliente@example.test",
    customerPhone: "+351910000000",
    whatsappOptIn: optIn,
    durationMinutes: 30,
    cancelToken: token,
    reminderAvailableAt,
  });
  const event = (await storage.getAppointmentNotificationEvents(appointment.id))
    .find((candidate) => candidate.eventType === "appointment_reminder_day_before");
  return { storage, appointment, event, reminderAvailableAt };
}

function dependencies(
  storage: MemoryStorage,
  now: () => Date,
  whatsapp: MetaTemplateDeliveryResult,
  counters = { whatsapp: 0, email: 0 },
  remindersEnabled = true,
): AppointmentNotificationDependencies {
  const sendEmail = async () => {
    counters.email += 1;
    return { sent: true, providerMessageId: "email.reminder", errorCode: null };
  };
  return {
    storage,
    processingEnabled: true,
    remindersEnabled,
    whatsappEnabled: true,
    deferWhatsappWhenDisabled: false,
    now,
    getLocation: async () => ({
      id: 1,
      name: "Baptista Barber Shop",
      slug: "baptista",
      address: "Rua de Teste, 1",
      mapUrl: null,
      mapEmbedUrl: null,
      phone: null,
      email: null,
      timezone: timeZone,
      isActive: true,
      isDefault: true,
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    sendWhatsApp: async () => {
      counters.whatsapp += 1;
      return whatsapp;
    },
    sendConfirmationEmail: sendEmail,
    sendRescheduleEmail: sendEmail,
    sendUpdatedEmail: sendEmail,
    sendCancellationEmail: sendEmail,
    sendRecurringConfirmationEmail: sendEmail,
    sendReminderEmail: sendEmail,
  };
}

test("calendar reminder uses the previous local day across Lisbon DST", () => {
  const springAppointment = new Date("2030-03-31T09:00:00.000Z"); // 10:00 WEST
  const springDue = getAppointmentReminderAvailableAt(
    springAppointment,
    timeZone,
    new Date("2030-03-01T00:00:00.000Z"),
  );
  assert.equal(springDue?.toISOString(), "2030-03-30T10:00:00.000Z");
  assert.equal(springAppointment.getTime() - springDue!.getTime(), 23 * 60 * 60 * 1000);

  const autumnAppointment = new Date("2030-10-27T10:00:00.000Z"); // 10:00 WET
  const autumnDue = getAppointmentReminderAvailableAt(
    autumnAppointment,
    timeZone,
    new Date("2030-10-01T00:00:00.000Z"),
  );
  assert.equal(autumnDue?.toISOString(), "2030-10-26T09:00:00.000Z");
  assert.equal(autumnAppointment.getTime() - autumnDue!.getTime(), 25 * 60 * 60 * 1000);
});

test("eligible reminder sends Meta once and never sends premature email", async () => {
  const start = new Date("2030-06-04T09:00:00.000Z");
  const created = new Date("2030-06-01T09:00:00.000Z");
  const reminder = await fixture(start, created);
  assert.ok(reminder.event && reminder.reminderAvailableAt);
  const counters = { whatsapp: 0, email: 0 };
  const deps = dependencies(reminder.storage, () => reminder.reminderAvailableAt!, accepted("pending"), counters);

  assert.equal(await processPendingAppointmentNotifications(deps), 1);
  assert.equal(await processPendingAppointmentNotifications(deps), 0);
  assert.deepEqual(counters, { whatsapp: 1, email: 0 });
  assert.equal((await reminder.storage.getAppointmentNotificationEvent(reminder.event.id))?.processingCompletedAt instanceof Date, true);
});

test("reminder is not claimed too early", async () => {
  const reminder = await fixture(
    new Date("2030-06-04T09:00:00.000Z"),
    new Date("2030-06-01T09:00:00.000Z"),
  );
  assert.ok(reminder.event && reminder.reminderAvailableAt);
  const counters = { whatsapp: 0, email: 0 };
  const tooEarly = new Date(reminder.reminderAvailableAt.getTime() - 1);
  assert.equal(await processPendingAppointmentNotifications(
    dependencies(reminder.storage, () => tooEarly, accepted(), counters),
  ), 0);
  assert.deepEqual(counters, { whatsapp: 0, email: 0 });
  assert.equal((await reminder.storage.getAppointmentNotificationEvent(reminder.event.id))?.processingStartedAt, null);
});

test("booking created inside the reminder horizon never enqueues a retroactive reminder", async () => {
  const start = new Date("2030-06-04T09:00:00.000Z");
  const reminder = await fixture(start, new Date("2030-06-03T10:00:00.000Z"));
  assert.equal(reminder.reminderAvailableAt, null);
  assert.equal(reminder.event, undefined);
});

test("booking created exactly at the due instant remains eligible", async () => {
  const start = new Date("2030-06-04T09:00:00.000Z");
  const reminder = await fixture(start, new Date("2030-06-03T09:00:00.000Z"));
  assert.ok(reminder.event);
  assert.equal(reminder.reminderAvailableAt?.toISOString(), "2030-06-03T09:00:00.000Z");
});

test("cancellation makes the pending reminder stale", async () => {
  const reminder = await fixture(
    new Date("2030-06-04T09:00:00.000Z"),
    new Date("2030-06-01T09:00:00.000Z"),
  );
  assert.ok(reminder.event && reminder.reminderAvailableAt);
  await reminder.storage.cancelAppointment(reminder.appointment.id, "booked", "cancelled");
  const counters = { whatsapp: 0, email: 0 };
  await processAppointmentNotification(
    reminder.event.id,
    dependencies(reminder.storage, () => reminder.reminderAvailableAt!, accepted(), counters),
  );
  assert.deepEqual(counters, { whatsapp: 0, email: 0 });
  assert.equal((await reminder.storage.getAppointmentNotificationEvent(reminder.event.id))?.errorCode, "STALE_EVENT");
});

test("reschedule invalidates the old reminder and schedules only the new time", async () => {
  const oldReminder = await fixture(
    new Date("2030-06-04T09:00:00.000Z"),
    new Date("2030-06-01T09:00:00.000Z"),
  );
  assert.ok(oldReminder.event);
  const newStart = new Date("2030-06-06T10:00:00.000Z");
  const rescheduledAt = new Date("2030-06-02T10:00:00.000Z");
  const newDue = getAppointmentReminderAvailableAt(newStart, timeZone, rescheduledAt);
  assert.ok(newDue);
  await oldReminder.storage.rescheduleAppointment(oldReminder.appointment.id, 0, newStart, newDue);
  const events = await oldReminder.storage.getAppointmentNotificationEvents(oldReminder.appointment.id);
  const replacement = events.find((event) => event.eventType === "appointment_reminder_day_before"
    && event.eventRevision === 2);
  assert.ok(replacement);
  const counters = { whatsapp: 0, email: 0 };
  const deps = dependencies(oldReminder.storage, () => newDue, accepted(), counters);
  await processAppointmentNotification(oldReminder.event.id, deps);
  await processAppointmentNotification(replacement.id, deps);
  assert.deepEqual(counters, { whatsapp: 1, email: 0 });
  assert.equal((await oldReminder.storage.getAppointmentNotificationEvent(oldReminder.event.id))?.errorCode, "STALE_EVENT");
});

test("concurrent workers claim an eligible reminder exactly once", async () => {
  const reminder = await fixture(
    new Date("2030-06-04T09:00:00.000Z"),
    new Date("2030-06-01T09:00:00.000Z"),
  );
  assert.ok(reminder.event && reminder.reminderAvailableAt);
  const counters = { whatsapp: 0, email: 0 };
  const deps = dependencies(reminder.storage, () => reminder.reminderAvailableAt!, accepted(), counters);
  const results = await Promise.all([
    processAppointmentNotification(reminder.event.id, deps),
    processAppointmentNotification(reminder.event.id, deps),
  ]);
  assert.deepEqual(results.sort(), ["none", "whatsapp"]);
  assert.deepEqual(counters, { whatsapp: 1, email: 0 });
});

test("eligible Meta failure uses one reminder email fallback", async () => {
  const reminder = await fixture(
    new Date("2030-06-04T09:00:00.000Z"),
    new Date("2030-06-01T09:00:00.000Z"),
  );
  assert.ok(reminder.event && reminder.reminderAvailableAt);
  const counters = { whatsapp: 0, email: 0 };
  const deps = dependencies(reminder.storage, () => reminder.reminderAvailableAt!, failed, counters);
  assert.equal(await processAppointmentNotification(reminder.event.id, deps), "email");
  assert.equal(await processAppointmentNotification(reminder.event.id, deps), "none");
  assert.deepEqual(counters, { whatsapp: 1, email: 1 });
});

test("late Meta failure claims one reminder email while the delivery window is valid", async () => {
  const reminder = await fixture(
    new Date("2030-06-04T09:00:00.000Z"),
    new Date("2030-06-01T09:00:00.000Z"),
  );
  assert.ok(reminder.event && reminder.reminderAvailableAt);
  const counters = { whatsapp: 0, email: 0 };
  const deps = dependencies(reminder.storage, () => reminder.reminderAvailableAt!, accepted(), counters);
  assert.equal(await processAppointmentNotification(reminder.event.id, deps), "whatsapp");
  await reminder.storage.updateAppointmentNotificationEvent(reminder.event.id, {
    whatsappStatus: "failed",
    failedAt: reminder.reminderAvailableAt,
  });
  const results = await Promise.all([
    processMetaLateFailureEmailFallback(reminder.event.id, deps),
    processMetaLateFailureEmailFallback(reminder.event.id, deps),
  ]);
  assert.deepEqual(results.sort(), ["email", "none"]);
  assert.deepEqual(counters, { whatsapp: 1, email: 1 });
});

test("recurring creation schedules one independent reminder per eligible occurrence", async () => {
  const storage = new MemoryStorage();
  await storage.createBarber({ name: "Fábio", specialty: "Cortes", isVisible: true });
  await storage.createService({ name: "Corte", price: 1500, duration: 30, isVisible: true });
  const starts = [new Date("2030-06-04T09:00:00.000Z"), new Date("2030-06-11T09:00:00.000Z")];
  const createdAt = new Date("2030-06-01T09:00:00.000Z");
  const result = await storage.createRecurringAppointmentSeries({
    series: {
      id: "series-reminder",
      locationId: 1,
      barberId: 1,
      serviceId: 1,
      customerName: "Cliente",
      customerEmail: "cliente@example.test",
      customerPhone: "+351910000000",
      whatsappOptIn: true,
      whatsappOptInAt: createdAt,
      intervalWeeks: 1,
      durationMonths: 1,
      occurrenceCount: 2,
      firstStartTime: starts[0],
    },
    appointments: starts.map((startTime, index) => ({
      locationId: 1,
      barberId: 1,
      serviceId: 1,
      startTime,
      customerName: "Cliente",
      customerEmail: "cliente@example.test",
      customerPhone: "+351910000000",
      whatsappOptIn: true,
      durationMinutes: 30,
      cancelToken: `${token}-${index}`,
      reminderAvailableAt: getAppointmentReminderAvailableAt(startTime, timeZone, createdAt),
    })),
    notificationSnapshot: {
      schemaVersion: 1,
      customerName: "Cliente",
      customerEmail: "cliente@example.test",
      customerPhone: "+351910000000",
      whatsappOptIn: true,
      location: { id: 1, name: "Baptista Barber Shop", address: "Rua de Teste, 1", timezone: timeZone },
      service: { id: 1, name: "Corte" },
      barber: { id: 1, name: "Fábio" },
      recurrence: { intervalWeeks: 1, durationMonths: 1, occurrenceCount: 2 },
    },
  });
  const reminders = (await Promise.all(result.appointments.map((appointment) =>
    storage.getAppointmentNotificationEvents(appointment.id))))
    .flat()
    .filter((event) => event.eventType === "appointment_reminder_day_before");
  assert.equal(reminders.length, 2);
  assert.equal(new Set(reminders.map((event) => event.eventKey)).size, 2);
  assert.deepEqual(result.appointments.map((appointment) => appointment.notificationRevision), [1, 1]);
});

test("expired reminder window and disabled feature fail closed", async () => {
  const reminder = await fixture(
    new Date("2030-06-04T09:00:00.000Z"),
    new Date("2030-06-01T09:00:00.000Z"),
  );
  assert.ok(reminder.event && reminder.reminderAvailableAt);
  const counters = { whatsapp: 0, email: 0 };
  assert.equal(await processPendingAppointmentNotifications(
    dependencies(reminder.storage, () => reminder.reminderAvailableAt!, accepted(), counters, false),
  ), 0);
  assert.equal(await processAppointmentNotification(
    reminder.event.id,
    dependencies(reminder.storage, () => new Date("2030-06-04T00:00:00.000Z"), accepted(), counters),
  ), "none");
  assert.deepEqual(counters, { whatsapp: 0, email: 0 });
});

test("read operations never create reminder events", async () => {
  const reminder = await fixture(
    new Date("2030-06-04T09:00:00.000Z"),
    new Date("2030-06-01T09:00:00.000Z"),
  );
  const before = await reminder.storage.getAppointmentNotificationEvents(reminder.appointment.id);
  await reminder.storage.getAppointments(undefined, undefined, 1);
  await reminder.storage.getAppointment(reminder.appointment.id);
  const after = await reminder.storage.getAppointmentNotificationEvents(reminder.appointment.id);
  assert.deepEqual(after.map((event) => event.eventKey), before.map((event) => event.eventKey));
});

test("reminder Meta and email payloads contain seven variables and existing management links", () => {
  const startTime = new Date("2030-06-04T09:00:00.000Z");
  const components = buildMetaAppointmentTemplateComponents({
    recipient: "+351910000000",
    eventType: "appointment_reminder_day_before",
    customerName: "Cliente",
    locationName: "Baptista Barber Shop",
    serviceName: "Corte",
    barberName: "Fábio",
    startTime,
    timeZone,
    address: "Rua de Teste, 1",
    managementToken: token,
  });
  assert.equal((components[0] as { parameters: unknown[] }).parameters.length, 7);
  assert.equal(components.length, 3);
  assert.equal(getMetaAppointmentTemplateName("appointment_reminder_day_before", {
    NODE_ENV: "production",
    APP_ENV: "production",
    META_WHATSAPP_REMINDER_DAY_BEFORE_TEMPLATE: "appointment_reminder_day_before",
  } as NodeJS.ProcessEnv), "appointment_reminder_day_before");

  const email = buildAppointmentReminderEmail({
    customerName: "Cliente",
    barberName: "Fábio",
    serviceName: "Corte",
    startTime,
    cancelToken: token,
    durationMinutes: 30,
    locationName: "Baptista Barber Shop",
    locationAddress: "Rua de Teste, 1",
    locationTimeZone: timeZone,
  });
  assert.match(email.html, /Cliente/);
  assert.match(email.html, /Corte/);
  assert.match(email.html, /Fábio/);
  assert.match(email.html, new RegExp(`/reschedule/${token}`));
  assert.match(email.html, new RegExp(`/cancel/${token}`));
});

test("delivery window is restricted to the local previous calendar day", () => {
  const start = new Date("2030-06-04T09:00:00.000Z");
  const due = getAppointmentReminderAvailableAt(start, timeZone, new Date("2030-06-01T00:00:00.000Z"));
  assert.ok(due);
  assert.equal(isAppointmentReminderDeliveryWindow(start, due, timeZone, due), true);
  assert.equal(isAppointmentReminderDeliveryWindow(start, due, timeZone, new Date("2030-06-03T22:59:59.000Z")), true);
  assert.equal(isAppointmentReminderDeliveryWindow(start, due, timeZone, new Date("2030-06-03T23:00:00.000Z")), false);
});
