import type { Appointment, AppointmentNotificationEvent, RecurringNotificationSnapshot } from "@shared/schema";
import {
  sendBookingCancellationConfirmation,
  sendBookingConfirmation,
  sendBookingRescheduled,
  sendRecurringBookingConfirmation,
  type EmailDeliveryResult,
} from "./email";
import { getLocation } from "./location-store";
import { reconcileMetaStatusReceipts } from "./meta-webhook";
import {
  appointmentNotificationWorkerEnabled,
  isDevelopmentDeployment,
  recurringWhatsappNotificationsEnabled,
} from "./runtime-environment";
import { storage, type IStorage } from "./storage";
import {
  areWhatsappNotificationsEnabled,
  buildMetaRecurringTemplateParams,
  getMetaAppointmentTemplateName,
  sendMetaTemplate,
  type MetaAppointmentTemplateParams,
  type MetaTemplateDeliveryResult,
} from "./whatsapp";

type Channel = "whatsapp" | "email" | "none";
type EventType = Exclude<MetaAppointmentTemplateParams["eventType"], "appointment_recurring_confirmation">;

export type AppointmentNotificationDependencies = {
  storage: Pick<IStorage,
    | "getAppointment" | "getAppointmentSeries" | "getAppointmentSeriesAppointments" | "getBarber" | "getService"
    | "getAppointmentNotificationEvent" | "claimAppointmentNotificationEvent"
    | "claimNextAppointmentNotificationEvent" | "claimAppointmentNotificationWhatsappAttempt"
    | "claimAppointmentNotificationWebhookFallback"
    | "updateAppointmentNotificationEvent"
    | "reconcileMetaWebhookReceipts" | "getAppointmentNotificationEventByProviderId"
    | "createMetaWebhookReceipt" | "getMetaWebhookReceipts"
  >;
  getLocation: typeof getLocation;
  sendWhatsApp: (params: MetaAppointmentTemplateParams) => Promise<MetaTemplateDeliveryResult>;
  sendConfirmationEmail: typeof sendBookingConfirmation;
  sendRescheduleEmail: typeof sendBookingRescheduled;
  sendCancellationEmail: typeof sendBookingCancellationConfirmation;
  sendRecurringConfirmationEmail: typeof sendRecurringBookingConfirmation;
  processingEnabled: boolean;
  whatsappEnabled: boolean;
  recurringWhatsappEnabled?: boolean;
  deferWhatsappWhenDisabled?: boolean;
};

export const defaultDependencies: AppointmentNotificationDependencies = {
  storage,
  getLocation,
  sendWhatsApp: sendMetaTemplate,
  sendConfirmationEmail: sendBookingConfirmation,
  sendRescheduleEmail: sendBookingRescheduled,
  sendCancellationEmail: sendBookingCancellationConfirmation,
  sendRecurringConfirmationEmail: sendRecurringBookingConfirmation,
  processingEnabled: appointmentNotificationWorkerEnabled,
  whatsappEnabled: areWhatsappNotificationsEnabled(),
  recurringWhatsappEnabled: recurringWhatsappNotificationsEnabled,
  deferWhatsappWhenDisabled: isDevelopmentDeployment,
};

function eventType(value: string): EventType | null {
  return ["appointment_confirmation", "appointment_rescheduled", "appointment_cancelled"].includes(value)
    ? value as EventType : null;
}

function isCurrentEvent(appointment: Appointment | undefined, event: AppointmentNotificationEvent) {
  if (!appointment || appointment.notificationRevision !== event.eventRevision) return false;
  if (new Date(appointment.startTime).getTime() !== new Date(event.appointmentStartTime).getTime()) return false;
  if (event.eventType === "appointment_cancelled") {
    return appointment.status === "cancelled" || appointment.status === "late_cancelled";
  }
  return appointment.status === "booked";
}

function recurringSnapshot(event: AppointmentNotificationEvent): RecurringNotificationSnapshot | null {
  const snapshot = event.payloadSnapshot;
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.seriesId !== event.seriesId
    || !Array.isArray(snapshot.occurrences) || snapshot.occurrences.length < 2) return null;
  return snapshot;
}

async function isCurrentRecurringEvent(
  event: AppointmentNotificationEvent,
  snapshot: RecurringNotificationSnapshot,
  deps: AppointmentNotificationDependencies,
) {
  if (!event.seriesId) return false;
  const [series, occurrences] = await Promise.all([
    deps.storage.getAppointmentSeries(event.seriesId),
    deps.storage.getAppointmentSeriesAppointments(event.seriesId),
  ]);
  if (!series || series.status !== "active" || series.notificationRevision !== event.eventRevision
    || series.occurrenceCount !== snapshot.recurrence.occurrenceCount
    || occurrences.length !== snapshot.occurrences.length) return false;
  return occurrences.every((appointment, index) => {
    const saved = snapshot.occurrences[index];
    return appointment.id === saved.appointmentId
      && appointment.seriesOccurrenceIndex === saved.occurrenceIndex
      && appointment.status === "booked"
      && new Date(appointment.startTime).getTime() === new Date(saved.startTime).getTime();
  });
}

async function updateEvent(deps: AppointmentNotificationDependencies, id: number, patch: Parameters<IStorage["updateAppointmentNotificationEvent"]>[1]) {
  await deps.storage.updateAppointmentNotificationEvent(id, patch);
}

async function emailFallback(
  appointment: Appointment,
  event: AppointmentNotificationEvent,
  details: { barberName: string; serviceName: string; locationName: string; locationAddress: string; locationTimeZone: string },
  deps: AppointmentNotificationDependencies,
): Promise<Channel> {
  if (event.emailStatus === "sent") return "email";
  if (!appointment.customerEmail?.trim()) {
    await updateEvent(deps, event.id, { emailStatus: "skipped", emailErrorCode: "EMAIL_MISSING" });
    return "none";
  }
  const latest = await deps.storage.getAppointment(appointment.id);
  if (!isCurrentEvent(latest, event)) {
    await updateEvent(deps, event.id, { emailStatus: "skipped", emailErrorCode: "STALE_EVENT" });
    return "none";
  }

  await updateEvent(deps, event.id, { emailStatus: "sending", emailAttemptedAt: new Date() });
  const common = {
    customerName: appointment.customerName,
    customerEmail: appointment.customerEmail,
    barberName: details.barberName,
    serviceName: details.serviceName,
    startTime: new Date(event.appointmentStartTime),
    locationName: details.locationName,
    locationTimeZone: details.locationTimeZone,
    idempotencyKey: `${event.eventKey}:email`,
  };
  let result: EmailDeliveryResult;
  try {
    if (event.eventType === "appointment_confirmation") {
      result = await deps.sendConfirmationEmail({ ...common, cancelToken: appointment.cancelToken,
        durationMinutes: appointment.durationMinutes, locationAddress: details.locationAddress,
        depositRequired: appointment.depositRequired, depositReason: appointment.depositReason });
    } else if (event.eventType === "appointment_rescheduled") {
      result = await deps.sendRescheduleEmail({ ...common, cancelToken: appointment.cancelToken,
        durationMinutes: appointment.durationMinutes, locationAddress: details.locationAddress });
    } else {
      result = await deps.sendCancellationEmail({ ...common, lateCancellation: appointment.status === "late_cancelled",
        includeLateCancellationNotice: false });
    }
  } catch {
    result = { sent: false, providerMessageId: null, errorCode: "EMAIL_UNEXPECTED_ERROR" };
  }
  await updateEvent(deps, event.id, {
    emailStatus: result.sent ? "sent" : "failed",
    emailProviderMessageId: result.providerMessageId,
    emailErrorCode: result.errorCode,
    emailSentAt: result.sent ? new Date() : null,
  });
  return result.sent ? "email" : "none";
}

async function recurringEmailFallback(
  event: AppointmentNotificationEvent,
  snapshot: RecurringNotificationSnapshot,
  deps: AppointmentNotificationDependencies,
): Promise<Channel> {
  if (event.emailStatus === "sent") return "email";
  if (!snapshot.customerEmail?.trim()) {
    await updateEvent(deps, event.id, { emailStatus: "skipped", emailErrorCode: "EMAIL_MISSING" });
    return "none";
  }
  if (!await isCurrentRecurringEvent(event, snapshot, deps)) {
    await updateEvent(deps, event.id, { emailStatus: "skipped", emailErrorCode: "STALE_EVENT" });
    return "none";
  }
  await updateEvent(deps, event.id, { emailStatus: "sending", emailAttemptedAt: new Date() });
  let result: EmailDeliveryResult;
  try {
    result = await deps.sendRecurringConfirmationEmail({
      customerName: snapshot.customerName,
      customerEmail: snapshot.customerEmail,
      locationName: snapshot.location.name,
      locationAddress: snapshot.location.address,
      locationTimeZone: snapshot.location.timezone,
      serviceName: snapshot.service.name,
      barberName: snapshot.barber.name,
      intervalWeeks: snapshot.recurrence.intervalWeeks,
      durationMonths: snapshot.recurrence.durationMonths,
      occurrences: snapshot.occurrences.map((occurrence) => new Date(occurrence.startTime)),
      idempotencyKey: `${event.eventKey}:email`,
    });
  } catch {
    result = { sent: false, providerMessageId: null, errorCode: "EMAIL_UNEXPECTED_ERROR" };
  }
  await updateEvent(deps, event.id, {
    emailStatus: result.sent ? "sent" : "failed",
    emailProviderMessageId: result.providerMessageId,
    emailErrorCode: result.errorCode,
    emailSentAt: result.sent ? new Date() : null,
  });
  return result.sent ? "email" : "none";
}

async function processRecurringConfirmation(
  event: AppointmentNotificationEvent,
  deps: AppointmentNotificationDependencies,
): Promise<Channel> {
  const snapshot = recurringSnapshot(event);
  if (!snapshot || !await isCurrentRecurringEvent(event, snapshot, deps)) {
    await updateEvent(deps, event.id, { whatsappStatus: "skipped", errorCode: "STALE_EVENT",
      emailStatus: "skipped", emailErrorCode: "STALE_EVENT" });
    return "none";
  }
  if (snapshot.whatsappOptIn && !deps.whatsappEnabled && !event.whatsappAttemptedAt
    && deps.deferWhatsappWhenDisabled !== false) {
    return "none";
  }
  if (snapshot.whatsappOptIn && deps.whatsappEnabled && deps.recurringWhatsappEnabled) {
    if (["accepted", "sent", "delivered", "read"].includes(event.whatsappStatus)) return "whatsapp";
    if (!event.whatsappAttemptedAt && await isCurrentRecurringEvent(event, snapshot, deps)) {
      const attempt = await deps.storage.claimAppointmentNotificationWhatsappAttempt(event.id);
      if (!attempt) return "none";
      const params = buildMetaRecurringTemplateParams(snapshot);
      let whatsappResult: MetaTemplateDeliveryResult;
      try {
        whatsappResult = await deps.sendWhatsApp(params);
      } catch {
        whatsappResult = {
          outcome: "failed", provider: "meta", templateName: templateName("appointment_recurring_confirmation") || "",
          providerMessageId: null, providerStatus: "META_UNEXPECTED_ERROR", responseStatus: null,
          errorCode: "META_UNEXPECTED_ERROR",
        };
      }
      await updateEvent(deps, event.id, {
        provider: whatsappResult.provider,
        templateName: whatsappResult.templateName,
        whatsappStatus: whatsappResult.outcome,
        providerMessageId: whatsappResult.providerMessageId,
        providerStatus: whatsappResult.providerStatus,
        responseStatus: whatsappResult.responseStatus,
        errorCode: whatsappResult.errorCode,
        whatsappAcceptedAt: whatsappResult.outcome === "accepted" ? new Date() : null,
      });
      if (whatsappResult.outcome === "accepted" && whatsappResult.providerMessageId) {
        await deps.storage.reconcileMetaWebhookReceipts(whatsappResult.providerMessageId, event.id);
        await reconcileMetaStatusReceipts(whatsappResult.providerMessageId, deps.storage,
          (eventId) => processMetaLateFailureEmailFallback(eventId, deps));
        return "whatsapp";
      }
    }
  }
  await updateEvent(deps, event.id, {
    provider: "meta", templateName: templateName("appointment_recurring_confirmation"),
    whatsappStatus: "skipped",
    errorCode: snapshot.whatsappOptIn && !deps.whatsappEnabled
      ? "WHATSAPP_DISABLED"
      : !deps.recurringWhatsappEnabled
      ? "WHATSAPP_RECURRING_TEMPLATE_DISABLED"
      : "WHATSAPP_OPT_IN_MISSING",
  });
  return recurringEmailFallback(event, snapshot, deps);
}

export async function processMetaLateFailureEmailFallback(
  eventId: number,
  deps: AppointmentNotificationDependencies = defaultDependencies,
): Promise<Channel> {
  const claimed = await deps.storage.claimAppointmentNotificationWebhookFallback(eventId);
  if (!claimed) {
    const existing = await deps.storage.getAppointmentNotificationEvent(eventId);
    if (existing?.emailStatus === "sent") {
      console.log(`Meta late fallback skipped; event=${eventId}; reason=email_already_sent.`);
    } else {
      console.log(`Meta late fallback skipped; event=${eventId}; reason=already_claimed_or_ineligible.`);
    }
    return existing?.emailStatus === "sent" ? "email" : "none";
  }

  console.log(`Meta late fallback email claimed; event=${eventId}; type=${claimed.eventType}.`);
  let channel: Channel = "none";
  if (claimed.eventType === "appointment_recurring_confirmation") {
    const snapshot = recurringSnapshot(claimed);
    if (snapshot) channel = await recurringEmailFallback(claimed, snapshot, deps);
    else await updateEvent(deps, claimed.id, { emailStatus: "skipped", emailErrorCode: "STALE_EVENT" });
  } else {
    const type = eventType(claimed.eventType);
    const appointment = claimed.appointmentId === null ? undefined : await deps.storage.getAppointment(claimed.appointmentId);
    if (type && appointment) {
      const [barber, service, location] = await Promise.all([
        deps.storage.getBarber(appointment.barberId),
        appointment.serviceId ? deps.storage.getService(appointment.serviceId) : Promise.resolve(undefined),
        deps.getLocation(appointment.locationId, true),
      ]);
      channel = await emailFallback(appointment, claimed, {
        barberName: barber?.name || "Barbeiro indisponível",
        serviceName: service?.name || "Serviço indisponível",
        locationName: location?.name || process.env.SHOP_NAME || "Barbearia",
        locationAddress: location?.address || process.env.SHOP_ADDRESS || "",
        locationTimeZone: location?.timezone || process.env.SHOP_TIME_ZONE || "Europe/Lisbon",
      }, deps);
    } else {
      await updateEvent(deps, claimed.id, { emailStatus: "skipped", emailErrorCode: "STALE_EVENT" });
    }
  }

  const saved = await deps.storage.getAppointmentNotificationEvent(eventId);
  if (channel === "email") {
    console.log(`Meta late fallback email sent; event=${eventId}; type=${claimed.eventType}.`);
  } else if (saved?.emailErrorCode === "EMAIL_MISSING") {
    console.log(`Meta late fallback skipped; event=${eventId}; reason=email_missing.`);
  } else {
    console.log(`Meta late fallback email not sent; event=${eventId}; reason=${saved?.emailErrorCode || "ineligible"}.`);
  }
  return channel;
}

async function processClaimedCore(
  event: AppointmentNotificationEvent,
  deps: AppointmentNotificationDependencies = defaultDependencies,
): Promise<Channel | "deferred" | "in_progress"> {
  if (!deps.processingEnabled) return "none";
  if (event.eventType === "appointment_recurring_confirmation") {
    return processRecurringConfirmation(event, deps);
  }
  const type = eventType(event.eventType);
  const appointment = event.appointmentId === null ? undefined : await deps.storage.getAppointment(event.appointmentId);
  if (!type || !isCurrentEvent(appointment, event)) {
    await updateEvent(deps, event.id, { whatsappStatus: "skipped", errorCode: "STALE_EVENT",
      emailStatus: "skipped", emailErrorCode: "STALE_EVENT" });
    return "none";
  }
  if (appointment!.whatsappOptIn && !deps.whatsappEnabled && !event.whatsappAttemptedAt
    && deps.deferWhatsappWhenDisabled !== false) {
    return "deferred";
  }
  const [barber, service, location] = await Promise.all([
    deps.storage.getBarber(appointment!.barberId),
    appointment!.serviceId ? deps.storage.getService(appointment!.serviceId) : Promise.resolve(undefined),
    deps.getLocation(appointment!.locationId, true),
  ]);
  const details = {
    barberName: barber?.name || "Barbeiro indisponível",
    serviceName: service?.name || "Serviço indisponível",
    locationName: location?.name || process.env.SHOP_NAME || "Barbearia",
    locationAddress: location?.address || process.env.SHOP_ADDRESS || "",
    locationTimeZone: location?.timezone || process.env.SHOP_TIME_ZONE || "Europe/Lisbon",
  };

  // A reclaimed event with an external attempt has an ambiguous outcome. Never repeat WhatsApp.
  if (["accepted", "sent", "delivered", "read"].includes(event.whatsappStatus)) return "whatsapp";
  if (event.whatsappAttemptedAt) {
    if (event.whatsappStatus === "pending") {
      await updateEvent(deps, event.id, { whatsappStatus: "unknown", providerStatus: "META_ATTEMPT_INTERRUPTED",
        errorCode: "META_ATTEMPT_INTERRUPTED" });
    }
    return emailFallback(appointment!, event, details, deps);
  }
  if (appointment!.whatsappOptIn && !deps.whatsappEnabled) {
    await updateEvent(deps, event.id, {
      provider: "meta", templateName: templateName(type),
      whatsappStatus: "skipped", errorCode: "WHATSAPP_DISABLED",
    });
    return emailFallback(appointment!, event, details, deps);
  }
  if (!appointment!.whatsappOptIn) {
    await updateEvent(deps, event.id, { provider: "meta", templateName: templateName(type),
      whatsappStatus: "skipped", errorCode: "WHATSAPP_OPT_IN_MISSING" });
    return emailFallback(appointment!, event, details, deps);
  }

  const latestBeforeWhatsApp = await deps.storage.getAppointment(appointment!.id);
  if (!isCurrentEvent(latestBeforeWhatsApp, event)) {
    await updateEvent(deps, event.id, { whatsappStatus: "skipped", errorCode: "STALE_EVENT",
      emailStatus: "skipped", emailErrorCode: "STALE_EVENT" });
    return "none";
  }

  const attempt = await deps.storage.claimAppointmentNotificationWhatsappAttempt(event.id);
  if (!attempt) return "in_progress";
  await updateEvent(deps, event.id, { provider: "meta", templateName: templateName(type) });
  let result: MetaTemplateDeliveryResult;
  try {
    result = await deps.sendWhatsApp({ recipient: appointment!.customerPhone, eventType: type,
      customerName: appointment!.customerName, locationName: details.locationName,
      serviceName: details.serviceName, barberName: details.barberName,
      startTime: new Date(event.appointmentStartTime), timeZone: details.locationTimeZone,
      address: details.locationAddress, managementToken: appointment!.cancelToken });
  } catch {
    result = { outcome: "failed", provider: "meta", templateName: templateName(type) || "", providerMessageId: null,
      providerStatus: "META_UNEXPECTED_ERROR", responseStatus: null, errorCode: "META_UNEXPECTED_ERROR" };
  }
  await updateEvent(deps, event.id, { provider: result.provider, templateName: result.templateName,
    whatsappStatus: result.outcome, providerMessageId: result.providerMessageId,
    providerStatus: result.providerStatus, responseStatus: result.responseStatus, errorCode: result.errorCode,
    whatsappAcceptedAt: result.outcome === "accepted" ? new Date() : null });
  if (result.outcome === "accepted" && result.providerMessageId) {
    await deps.storage.reconcileMetaWebhookReceipts(result.providerMessageId, event.id);
    await reconcileMetaStatusReceipts(result.providerMessageId, deps.storage,
      (eventId) => processMetaLateFailureEmailFallback(eventId, deps));
    console.log(`Appointment WhatsApp accepted; event=${event.id}; type=${type}; wamid=${result.providerMessageId}.`);
    return "whatsapp";
  }
  return emailFallback(appointment!, event, details, deps);
}

export async function processClaimedAppointmentNotification(
  event: AppointmentNotificationEvent,
  deps: AppointmentNotificationDependencies = defaultDependencies,
): Promise<Channel> {
  const channel = await processClaimedCore(event, deps);
  if (channel === "deferred") {
    await updateEvent(deps, event.id, { processingStartedAt: null });
    return "none";
  }
  if (channel === "in_progress") return "none";
  await updateEvent(deps, event.id, { processingCompletedAt: new Date() });
  return channel;
}

function templateName(type: MetaAppointmentTemplateParams["eventType"]) {
  return getMetaAppointmentTemplateName(type);
}

export async function processAppointmentNotification(id: number, deps = defaultDependencies): Promise<Channel> {
  if (!deps.processingEnabled) return "none";
  const event = await deps.storage.claimAppointmentNotificationEvent(id);
  return event ? processClaimedAppointmentNotification(event, deps) : "none";
}

export async function processPendingAppointmentNotifications(deps = defaultDependencies, leaseMs = 60_000) {
  if (!deps.processingEnabled) return 0;
  let processed = 0;
  for (let count = 0; count < 25; count += 1) {
    const event = await deps.storage.claimNextAppointmentNotificationEvent(
      new Date(Date.now() - leaseMs),
      deps.whatsappEnabled || deps.deferWhatsappWhenDisabled === false,
    );
    if (!event) break;
    await processClaimedAppointmentNotification(event, deps);
    processed += 1;
  }
  return processed;
}

export function startAppointmentNotificationWorker(intervalMs = Number(process.env.NOTIFICATION_OUTBOX_POLL_INTERVAL_MS || 5000)) {
  if (!appointmentNotificationWorkerEnabled) return () => undefined;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processPendingAppointmentNotifications(); }
    catch (error) { console.error("Appointment notification outbox tick failed:", error instanceof Error ? error.name : "UnknownError"); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
