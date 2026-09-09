import type { Appointment, AppointmentNotificationEvent } from "@shared/schema";
import {
  formatAppointmentForEmail,
  sendBookingCancellationConfirmation,
  sendBookingConfirmation,
  sendBookingRescheduled,
  type EmailDeliveryResult,
} from "./email";
import { getLocation } from "./location-store";
import { reconcileMetaStatusReceipts } from "./meta-webhook";
import { isDevelopmentDeployment } from "./runtime-environment";
import { storage, type IStorage } from "./storage";
import { sendMetaTemplate, type MetaAppointmentTemplateParams, type MetaTemplateDeliveryResult } from "./whatsapp";

type Channel = "whatsapp" | "email" | "none";
type EventType = MetaAppointmentTemplateParams["eventType"];

export type AppointmentNotificationDependencies = {
  storage: Pick<IStorage,
    | "getAppointment" | "getBarber" | "getService"
    | "getAppointmentNotificationEvent" | "claimAppointmentNotificationEvent"
    | "claimNextAppointmentNotificationEvent" | "updateAppointmentNotificationEvent"
    | "reconcileMetaWebhookReceipts" | "getAppointmentNotificationEventByProviderId"
    | "createMetaWebhookReceipt" | "getMetaWebhookReceipts"
  >;
  getLocation: typeof getLocation;
  sendWhatsApp: (params: MetaAppointmentTemplateParams) => Promise<MetaTemplateDeliveryResult>;
  sendConfirmationEmail: typeof sendBookingConfirmation;
  sendRescheduleEmail: typeof sendBookingRescheduled;
  sendCancellationEmail: typeof sendBookingCancellationConfirmation;
  developmentEnabled: boolean;
};

const defaultDependencies: AppointmentNotificationDependencies = {
  storage,
  getLocation,
  sendWhatsApp: sendMetaTemplate,
  sendConfirmationEmail: sendBookingConfirmation,
  sendRescheduleEmail: sendBookingRescheduled,
  sendCancellationEmail: sendBookingCancellationConfirmation,
  developmentEnabled: isDevelopmentDeployment,
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

async function processClaimedCore(
  event: AppointmentNotificationEvent,
  deps: AppointmentNotificationDependencies = defaultDependencies,
): Promise<Channel> {
  if (!deps.developmentEnabled) return "none";
  const type = eventType(event.eventType);
  const appointment = await deps.storage.getAppointment(event.appointmentId);
  if (!type || !isCurrentEvent(appointment, event)) {
    await updateEvent(deps, event.id, { whatsappStatus: "skipped", errorCode: "STALE_EVENT",
      emailStatus: "skipped", emailErrorCode: "STALE_EVENT" });
    return "none";
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

  const { date, time } = formatAppointmentForEmail(new Date(event.appointmentStartTime), details.locationTimeZone);
  await updateEvent(deps, event.id, { whatsappAttemptedAt: new Date(), provider: "meta", templateName: templateName(type) });
  let result: MetaTemplateDeliveryResult;
  try {
    result = await deps.sendWhatsApp({ recipient: appointment!.customerPhone, eventType: type,
      customerName: appointment!.customerName, locationName: details.locationName,
      serviceName: details.serviceName, barberName: details.barberName, date, time,
      address: details.locationAddress, managementToken: appointment!.cancelToken });
  } catch {
    result = { outcome: "failed", provider: "meta", templateName: templateName(type), providerMessageId: null,
      providerStatus: "META_UNEXPECTED_ERROR", responseStatus: null, errorCode: "META_UNEXPECTED_ERROR" };
  }
  await updateEvent(deps, event.id, { provider: result.provider, templateName: result.templateName,
    whatsappStatus: result.outcome, providerMessageId: result.providerMessageId,
    providerStatus: result.providerStatus, responseStatus: result.responseStatus, errorCode: result.errorCode,
    whatsappAcceptedAt: result.outcome === "accepted" ? new Date() : null });
  if (result.outcome === "accepted" && result.providerMessageId) {
    await deps.storage.reconcileMetaWebhookReceipts(result.providerMessageId, event.id);
    await reconcileMetaStatusReceipts(result.providerMessageId, deps.storage);
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
  await updateEvent(deps, event.id, { processingCompletedAt: new Date() });
  return channel;
}

function templateName(type: EventType) {
  if (type === "appointment_confirmation") return "appointment_confirmation_v1";
  if (type === "appointment_cancelled") return "appointment_cancelled_v1";
  return "appointment_rescheduled_v1";
}

export async function processAppointmentNotification(id: number, deps = defaultDependencies): Promise<Channel> {
  if (!deps.developmentEnabled) return "none";
  const event = await deps.storage.claimAppointmentNotificationEvent(id);
  return event ? processClaimedAppointmentNotification(event, deps) : "none";
}

export async function processPendingAppointmentNotifications(deps = defaultDependencies, leaseMs = 60_000) {
  if (!deps.developmentEnabled) return 0;
  let processed = 0;
  for (let count = 0; count < 25; count += 1) {
    const event = await deps.storage.claimNextAppointmentNotificationEvent(new Date(Date.now() - leaseMs));
    if (!event) break;
    await processClaimedAppointmentNotification(event, deps);
    processed += 1;
  }
  return processed;
}

export function startAppointmentNotificationWorker(intervalMs = Number(process.env.NOTIFICATION_OUTBOX_POLL_INTERVAL_MS || 5000)) {
  if (!isDevelopmentDeployment) return () => undefined;
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
