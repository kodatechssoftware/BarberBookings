import type { Appointment, AppointmentNotificationEvent } from "@shared/schema";
import {
  formatAppointmentForEmail,
  sendBookingRescheduled,
  type EmailDeliveryResult,
} from "./email";
import { isDevelopmentDeployment } from "./runtime-environment";
import { storage, type IStorage } from "./storage";
import {
  sendMetaAppointmentRescheduled,
  type MetaRescheduleTemplateParams,
  type MetaTemplateDeliveryResult,
} from "./whatsapp";

export type RescheduleNotificationContext = {
  eventId: number;
  appointmentId: number;
  eventRevision: number;
  customerName: string;
  customerEmail?: string | null;
  customerPhone: string;
  whatsappOptIn: boolean;
  barberName: string;
  serviceName: string;
  startTime: Date;
  cancelToken: string;
  durationMinutes: number;
  locationName: string;
  locationAddress: string;
  locationTimeZone: string;
};

export type RescheduleNotificationDependencies = {
  storage: Pick<IStorage,
    | "getAppointment"
    | "claimAppointmentNotificationEvent"
    | "updateAppointmentNotificationEvent"
  >;
  sendWhatsApp: (params: MetaRescheduleTemplateParams) => Promise<MetaTemplateDeliveryResult>;
  sendEmail: typeof sendBookingRescheduled;
  developmentEnabled: boolean;
};

const defaultDependencies: RescheduleNotificationDependencies = {
  storage,
  sendWhatsApp: sendMetaAppointmentRescheduled,
  sendEmail: sendBookingRescheduled,
  developmentEnabled: isDevelopmentDeployment,
};

function isCurrentRevision(appointment: Appointment | undefined, context: RescheduleNotificationContext) {
  return Boolean(
    appointment
    && appointment.status === "booked"
    && appointment.rescheduleRevision === context.eventRevision
    && new Date(appointment.startTime).getTime() === context.startTime.getTime(),
  );
}

async function updateEvent(
  deps: RescheduleNotificationDependencies,
  eventId: number,
  patch: Parameters<IStorage["updateAppointmentNotificationEvent"]>[1],
) {
  await deps.storage.updateAppointmentNotificationEvent(eventId, patch);
}

async function sendEmailFallback(
  context: RescheduleNotificationContext,
  event: AppointmentNotificationEvent,
  deps: RescheduleNotificationDependencies,
): Promise<"email" | "none"> {
  if (!context.customerEmail?.trim()) {
    await updateEvent(deps, event.id, { emailStatus: "skipped", emailErrorCode: "EMAIL_MISSING" });
    return "none";
  }

  const latest = await deps.storage.getAppointment(context.appointmentId);
  if (!isCurrentRevision(latest, context)) {
    await updateEvent(deps, event.id, { emailStatus: "skipped", emailErrorCode: "STALE_EVENT" });
    return "none";
  }

  const attemptedAt = new Date();
  await updateEvent(deps, event.id, { emailStatus: "sending", emailAttemptedAt: attemptedAt });
  let result: EmailDeliveryResult;
  try {
    result = await deps.sendEmail({
      customerName: context.customerName,
      customerEmail: context.customerEmail,
      barberName: context.barberName,
      serviceName: context.serviceName,
      startTime: context.startTime,
      cancelToken: context.cancelToken,
      durationMinutes: context.durationMinutes,
      locationName: context.locationName,
      locationAddress: context.locationAddress,
      locationTimeZone: context.locationTimeZone,
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

export async function processRescheduleNotification(
  context: RescheduleNotificationContext,
  dependencies: RescheduleNotificationDependencies = defaultDependencies,
): Promise<"whatsapp" | "email" | "none"> {
  if (!dependencies.developmentEnabled) return "none";

  const event = await dependencies.storage.claimAppointmentNotificationEvent(context.eventId);
  if (!event) return "none";

  const current = await dependencies.storage.getAppointment(context.appointmentId);
  if (!isCurrentRevision(current, context)) {
    await updateEvent(dependencies, event.id, {
      whatsappStatus: "skipped",
      errorCode: "STALE_EVENT",
      emailStatus: "skipped",
      emailErrorCode: "STALE_EVENT",
    });
    return "none";
  }

  if (!context.whatsappOptIn) {
    await updateEvent(dependencies, event.id, {
      provider: "meta",
      templateName: "appointment_rescheduled_v1",
      whatsappStatus: "skipped",
      errorCode: "WHATSAPP_OPT_IN_MISSING",
    });
    return sendEmailFallback(context, event, dependencies);
  }

  const { date, time } = formatAppointmentForEmail(context.startTime, context.locationTimeZone);
  const attemptedAt = new Date();
  let whatsappResult: MetaTemplateDeliveryResult;
  try {
    whatsappResult = await dependencies.sendWhatsApp({
      recipient: context.customerPhone,
      customerName: context.customerName,
      locationName: context.locationName,
      serviceName: context.serviceName,
      barberName: context.barberName,
      date,
      time,
      address: context.locationAddress,
      managementToken: context.cancelToken,
    });
  } catch {
    whatsappResult = {
      outcome: "failed",
      provider: "meta",
      templateName: "appointment_rescheduled_v1",
      providerMessageId: null,
      providerStatus: "META_UNEXPECTED_ERROR",
      responseStatus: null,
      errorCode: "META_UNEXPECTED_ERROR",
    };
  }

  await updateEvent(dependencies, event.id, {
    provider: whatsappResult.provider,
    templateName: whatsappResult.templateName,
    whatsappStatus: whatsappResult.outcome,
    providerMessageId: whatsappResult.providerMessageId,
    providerStatus: whatsappResult.providerStatus,
    responseStatus: whatsappResult.responseStatus,
    errorCode: whatsappResult.errorCode,
    whatsappAttemptedAt: attemptedAt,
    whatsappAcceptedAt: whatsappResult.outcome === "accepted" ? new Date() : null,
  });

  if (whatsappResult.outcome === "accepted" && whatsappResult.providerMessageId) {
    console.log(`Reschedule WhatsApp accepted; event=${event.id}; wamid=${whatsappResult.providerMessageId}.`);
    return "whatsapp";
  }

  // Unknown is deliberately not retried: the claim remains consumed and only email may run once.
  return sendEmailFallback(context, event, dependencies);
}
