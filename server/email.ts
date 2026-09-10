import { Resend } from "resend";
import "dotenv/config";

const resendApiKey = process.env.RESEND_API_KEY?.trim();
const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
const resend = resendApiKey && fromEmail ? new Resend(resendApiKey) : null;
const isProduction = process.env.NODE_ENV === "production";
const shopName = process.env.SHOP_NAME?.trim() || "Baptista Barber Shop";
const shopAddress = process.env.SHOP_ADDRESS?.trim() || "Rua Comandante Agatão Lança Nº28";
const shopTimeZone = process.env.SHOP_TIME_ZONE?.trim() || "Europe/Lisbon";
const emailFrom = fromEmail ? `${shopName} <${fromEmail}>` : "";

interface SendConfirmationParams {
  customerName: string;
  customerEmail: string;
  barberName: string;
  serviceName: string;
  startTime: Date;
  cancelToken: string;
  durationMinutes?: number;
  depositRequired?: boolean;
  depositReason?: string | null;
  cancellationPolicyHours?: number;
  locationName?: string;
  locationAddress?: string;
  locationTimeZone?: string;
  idempotencyKey?: string;
}

interface SendCancellationParams {
  customerName: string;
  customerEmail: string;
  barberName: string;
  serviceName: string;
  startTime: Date;
  lateCancellation?: boolean;
  includeLateCancellationNotice?: boolean;
  cancellationPolicyHours?: number;
  locationName?: string;
  locationTimeZone?: string;
  idempotencyKey?: string;
}

interface SendRescheduleParams {
  customerName: string;
  customerEmail: string;
  barberName: string;
  serviceName: string;
  startTime: Date;
  cancelToken: string;
  durationMinutes?: number;
  locationName?: string;
  locationAddress?: string;
  locationTimeZone?: string;
  idempotencyKey?: string;
}

export interface SendRecurringConfirmationParams {
  customerName: string;
  customerEmail: string;
  locationName: string;
  locationAddress: string;
  locationTimeZone: string;
  serviceName: string;
  barberName: string;
  intervalWeeks: number;
  durationMonths: number;
  occurrences: Date[];
  idempotencyKey?: string;
}

export type EmailDeliveryResult = {
  sent: boolean;
  providerMessageId: string | null;
  errorCode: string | null;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const toCalendarDate = (date: Date) =>
  date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export function formatAppointmentForEmail(startTime: Date, timeZone = shopTimeZone) {
  return {
    date: startTime.toLocaleDateString("pt-PT", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    time: `${startTime.toLocaleTimeString("pt-PT", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    })}h`,
  };
}

export function formatRecurringPeriodicity(intervalWeeks: number) {
  return intervalWeeks === 1 ? "Semanal" : `A cada ${intervalWeeks} semanas`;
}

export function buildRecurringBookingEmail(params: SendRecurringConfirmationParams) {
  const occurrences = [...params.occurrences].sort((left, right) => left.getTime() - right.getTime());
  if (occurrences.length < 2) throw new Error("A recurring confirmation requires at least two occurrences.");
  const first = formatAppointmentForEmail(occurrences[0], params.locationTimeZone);
  const periodicity = formatRecurringPeriodicity(params.intervalWeeks);
  const duration = `${params.durationMonths} ${params.durationMonths === 1 ? "mês" : "meses"}`;
  const occurrenceItems = occurrences.map((occurrence, index) => {
    const formatted = formatAppointmentForEmail(occurrence, params.locationTimeZone);
    return `<li style="margin: 6px 0;">${index + 1}. ${escapeHtml(formatted.date)} às ${escapeHtml(formatted.time)}</li>`;
  }).join("");
  return {
    subject: `Confirmação de marcações recorrentes - ${params.locationName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eee; border-radius: 14px; color: #111;">
        <h2 style="color: #d4af37; text-align: center; margin-top: 0;">${escapeHtml(params.locationName)}</h2>
        <p>Olá <strong>${escapeHtml(params.customerName)}</strong>,</p>
        <p>A sua série de marcações foi confirmada com sucesso.</p>
        <div style="background-color: #f9f9f9; padding: 16px; border-radius: 10px; margin: 20px 0;">
          <p style="margin: 6px 0;"><strong>Cliente:</strong> ${escapeHtml(params.customerName)}</p>
          <p style="margin: 6px 0;"><strong>Localização:</strong> ${escapeHtml(params.locationName)}</p>
          <p style="margin: 6px 0;"><strong>Serviço:</strong> ${escapeHtml(params.serviceName)}</p>
          <p style="margin: 6px 0;"><strong>Barbeiro:</strong> ${escapeHtml(params.barberName)}</p>
          <p style="margin: 6px 0;"><strong>Periodicidade:</strong> ${escapeHtml(periodicity)}</p>
          <p style="margin: 6px 0;"><strong>Duração configurada:</strong> ${escapeHtml(duration)}</p>
          <p style="margin: 6px 0;"><strong>Primeira marcação:</strong> ${escapeHtml(first.date)} às ${escapeHtml(first.time)}</p>
          <p style="margin: 6px 0;"><strong>Total:</strong> ${occurrences.length} marcações</p>
          <p style="margin: 6px 0;"><strong>Morada:</strong> ${escapeHtml(params.locationAddress)}</p>
        </div>
        <h3 style="margin-bottom: 8px;">Datas da série</h3>
        <ol style="padding-left: 22px;">${occurrenceItems}</ol>
        <p style="font-size: 0.92em; color: #555; margin-top: 20px;">Cada marcação desta série é gerida individualmente. Para alterações à série completa, contacte a barbearia.</p>
      </div>
    `,
  };
}

export async function sendRecurringBookingConfirmation(
  params: SendRecurringConfirmationParams,
): Promise<EmailDeliveryResult> {
  if (!resend) {
    console.warn("RESEND_API_KEY or RESEND_FROM_EMAIL not found; recurring booking confirmation email was skipped.");
    return { sent: false, providerMessageId: null, errorCode: "EMAIL_NOT_CONFIGURED" };
  }
  const content = buildRecurringBookingEmail(params);
  try {
    const response = await resend.emails.send({
      from: emailFrom,
      to: params.customerEmail,
      subject: content.subject,
      html: content.html,
    }, params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined);
    if (response.error) {
      console.error("Resend error while sending recurring booking confirmation:", response.error.name);
      return { sent: false, providerMessageId: null, errorCode: "EMAIL_PROVIDER_REJECTED" };
    }
    if (!isProduction) console.log("Recurring booking confirmation email sent.");
    return { sent: true, providerMessageId: response.data?.id || null, errorCode: null };
  } catch (error) {
    console.error("Error sending recurring confirmation email:", error instanceof Error ? error.name : "UnknownError");
    return { sent: false, providerMessageId: null, errorCode: "EMAIL_NETWORK_ERROR" };
  }
}

function getPublicUrl() {
  return (
    process.env.PUBLIC_URL ||
    process.env.APP_BASE_URL ||
    (process.env.REPL_SLUG && process.env.REPL_OWNER
      ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
      : "http://localhost:5000")
  ).replace(/\/$/, "");
}

export function buildAppointmentManagementLinks(cancelToken: string) {
  const publicUrl = getPublicUrl();
  return {
    rescheduleUrl: `${publicUrl}/reschedule/${cancelToken}`,
    cancelUrl: `${publicUrl}/cancel/${cancelToken}`,
  };
}

export function buildGoogleCalendarUrl({
  locationName,
  locationAddress,
  serviceName,
  barberName,
  startTime,
  durationMinutes,
}: {
  locationName: string;
  locationAddress: string;
  serviceName: string;
  barberName: string;
  startTime: Date;
  durationMinutes: number;
}) {
  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
  const calendarParams = new URLSearchParams({
    action: "TEMPLATE",
    text: `${locationName} - ${serviceName}`,
    dates: `${toCalendarDate(startTime)}/${toCalendarDate(endTime)}`,
    details: `${serviceName} com ${barberName}`,
    location: locationAddress,
  });
  return `https://calendar.google.com/calendar/render?${calendarParams.toString()}`;
}

export async function sendBookingConfirmation({
  customerName,
  customerEmail,
  barberName,
  serviceName,
  startTime,
  cancelToken,
  durationMinutes = 30,
  depositRequired = false,
  depositReason,
  cancellationPolicyHours = 4,
  locationName = shopName,
  locationAddress = shopAddress,
  locationTimeZone = shopTimeZone,
  idempotencyKey,
}: SendConfirmationParams): Promise<EmailDeliveryResult> {
  if (!resend) {
    console.warn("RESEND_API_KEY or RESEND_FROM_EMAIL not found; booking confirmation email was skipped.");
    return { sent: false, providerMessageId: null, errorCode: "EMAIL_NOT_CONFIGURED" };
  }

  const { date: dateStr, time: timeStr } = formatAppointmentForEmail(startTime, locationTimeZone);

  const { cancelUrl, rescheduleUrl } = buildAppointmentManagementLinks(cancelToken);
  const googleCalendarUrl = buildGoogleCalendarUrl({
    locationName, locationAddress, serviceName, barberName, startTime, durationMinutes,
  });

  try {
    const response = await resend.emails.send({
      from: emailFrom,
      to: customerEmail,
      subject: `Confirmação de marcação - ${locationName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eee; border-radius: 14px; color: #111;">
          <h2 style="color: #d4af37; text-align: center; margin-top: 0;">${escapeHtml(locationName)}</h2>
          <p>Olá <strong>${escapeHtml(customerName)}</strong>,</p>
          <p>A sua marcação foi confirmada com sucesso.</p>
          <div style="background-color: #f9f9f9; padding: 16px; border-radius: 10px; margin: 20px 0;">
            <p style="margin: 6px 0;"><strong>Barbeiro:</strong> ${escapeHtml(barberName)}</p>
            <p style="margin: 6px 0;"><strong>Serviço:</strong> ${escapeHtml(serviceName)}</p>
            <p style="margin: 6px 0;"><strong>Data:</strong> ${escapeHtml(dateStr)}</p>
            <p style="margin: 6px 0;"><strong>Hora:</strong> ${escapeHtml(timeStr)}</p>
            <p style="margin: 6px 0;"><strong>Morada:</strong> ${escapeHtml(locationAddress)}</p>
          </div>
          <p style="font-size: 0.92em; color: #555;">
            Caso não consiga comparecer, pode reagendar ou cancelar a sua marcação através dos links abaixo.
          </p>
          <p style="text-align: center; margin-top: 20px;">
            <a href="${googleCalendarUrl}" style="background-color: #111; color: white; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin: 4px;">Adicionar ao Google Calendar</a>
            <a href="${rescheduleUrl}" style="background-color: #d4af37; color: #111; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin: 4px;">Reagendar</a>
            <a href="${cancelUrl}" style="background-color: #ef4444; color: white; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin: 4px;">Cancelar</a>
          </p>
        </div>
      `,
    }, idempotencyKey ? { idempotencyKey } : undefined);

    if (response.error) {
      console.error("Resend error while sending booking confirmation:", response.error.name);
      return { sent: false, providerMessageId: null, errorCode: "EMAIL_PROVIDER_REJECTED" };
    }

    if (!isProduction) {
      console.log("Booking confirmation email sent.");
    }

    return { sent: true, providerMessageId: response.data?.id || null, errorCode: null };
  } catch (error) {
    console.error("Error sending confirmation email:", error instanceof Error ? error.name : "UnknownError");
    return { sent: false, providerMessageId: null, errorCode: "EMAIL_NETWORK_ERROR" };
  }
}

export async function sendBookingRescheduled({
  customerName,
  customerEmail,
  barberName,
  serviceName,
  startTime,
  cancelToken,
  durationMinutes = 30,
  locationName = shopName,
  locationAddress = shopAddress,
  locationTimeZone = shopTimeZone,
  idempotencyKey,
}: SendRescheduleParams): Promise<EmailDeliveryResult> {
  if (!resend) {
    console.warn("RESEND_API_KEY or RESEND_FROM_EMAIL not found; reschedule email was skipped.");
    return { sent: false, providerMessageId: null, errorCode: "EMAIL_NOT_CONFIGURED" };
  }

  const { date: dateStr, time: timeStr } = formatAppointmentForEmail(startTime, locationTimeZone);
  const { cancelUrl, rescheduleUrl } = buildAppointmentManagementLinks(cancelToken);
  const googleCalendarUrl = buildGoogleCalendarUrl({
    locationName, locationAddress, serviceName, barberName, startTime, durationMinutes,
  });

  try {
    const response = await resend.emails.send({
      from: emailFrom,
      to: customerEmail,
      subject: `Marcação reagendada - ${locationName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eee; border-radius: 14px; color: #111;">
          <h2 style="color: #d4af37; text-align: center; margin-top: 0;">${escapeHtml(locationName)}</h2>
          <p>Olá <strong>${escapeHtml(customerName)}</strong>,</p>
          <p>A sua marcação foi reagendada com sucesso.</p>
          <div style="background-color: #f9f9f9; padding: 16px; border-radius: 10px; margin: 20px 0;">
            <p style="margin: 6px 0;"><strong>Barbeiro:</strong> ${escapeHtml(barberName)}</p>
            <p style="margin: 6px 0;"><strong>Serviço:</strong> ${escapeHtml(serviceName)}</p>
            <p style="margin: 6px 0;"><strong>Nova data:</strong> ${escapeHtml(dateStr)}</p>
            <p style="margin: 6px 0;"><strong>Nova hora:</strong> ${escapeHtml(timeStr)}</p>
            <p style="margin: 6px 0;"><strong>Morada:</strong> ${escapeHtml(locationAddress)}</p>
          </div>
          <p style="font-size: 0.92em; color: #555;">Caso não consiga comparecer, pode voltar a reagendar ou cancelar a sua marcação.</p>
          <p style="text-align: center; margin-top: 20px;">
            <a href="${googleCalendarUrl}" style="background-color: #111; color: white; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin: 4px;">Adicionar ao Google Calendar</a>
            <a href="${rescheduleUrl}" style="background-color: #d4af37; color: #111; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin: 4px;">Reagendar</a>
            <a href="${cancelUrl}" style="background-color: #ef4444; color: white; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin: 4px;">Cancelar</a>
          </p>
        </div>
      `,
    }, idempotencyKey ? { idempotencyKey } : undefined);

    if (response.error) {
      console.error("Resend error while sending reschedule notification:", response.error.name);
      return { sent: false, providerMessageId: null, errorCode: "EMAIL_PROVIDER_REJECTED" };
    }

    if (!isProduction) console.log("Reschedule email sent.");
    return { sent: true, providerMessageId: response.data?.id || null, errorCode: null };
  } catch (error) {
    console.error("Error sending reschedule email:", error instanceof Error ? error.name : "UnknownError");
    return { sent: false, providerMessageId: null, errorCode: "EMAIL_NETWORK_ERROR" };
  }
}

export async function sendBookingCancellationConfirmation({
  customerName,
  customerEmail,
  startTime,
  lateCancellation = false,
  includeLateCancellationNotice = true,
  cancellationPolicyHours = 4,
  locationName = shopName,
  locationTimeZone = shopTimeZone,
  idempotencyKey,
}: SendCancellationParams): Promise<EmailDeliveryResult> {
  if (!resend) {
    console.warn("RESEND_API_KEY or RESEND_FROM_EMAIL not found; booking cancellation email was skipped.");
    return { sent: false, providerMessageId: null, errorCode: "EMAIL_NOT_CONFIGURED" };
  }

  const { date: dateStr, time: timeStr } = formatAppointmentForEmail(startTime, locationTimeZone);

  try {
    const response = await resend.emails.send({
      from: emailFrom,
      to: customerEmail,
      subject: `Cancelamento de marcação - ${locationName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eee; border-radius: 14px; color: #111;">
          <h2 style="color: #d4af37; text-align: center; margin-top: 0;">${escapeHtml(locationName)}</h2>
          <p>Olá <strong>${escapeHtml(customerName)}</strong>,</p>
          <p>A sua marcação foi cancelada com sucesso.</p>
          <div style="background-color: #f9f9f9; padding: 16px; border-radius: 10px; margin: 20px 0;">
            <p style="margin: 6px 0;"><strong>Data:</strong> ${escapeHtml(dateStr)}</p>
            <p style="margin: 6px 0;"><strong>Hora:</strong> ${escapeHtml(timeStr)}</p>
          </div>
          ${
            includeLateCancellationNotice && lateCancellation
              ? `<p style="font-size: 0.92em; color: #b45309;">Este cancelamento foi registado como tardio por estar a menos de ${cancellationPolicyHours} horas da marcação.</p>`
              : ""
          }
          <p>Se quiser voltar a marcar, estamos disponíveis para agendar uma nova data quando quiser.</p>
          <p>Obrigado,<br />${escapeHtml(locationName)}</p>
        </div>
      `,
    }, idempotencyKey ? { idempotencyKey } : undefined);

    if (response.error) {
      console.error("Resend error while sending booking cancellation:", response.error.name);
      return { sent: false, providerMessageId: null, errorCode: "EMAIL_PROVIDER_REJECTED" };
    }

    if (!isProduction) {
      console.log("Booking cancellation email sent.");
    }

    return { sent: true, providerMessageId: response.data?.id || null, errorCode: null };
  } catch (error) {
    console.error("Error sending cancellation email:", error instanceof Error ? error.name : "UnknownError");
    return { sent: false, providerMessageId: null, errorCode: "EMAIL_NETWORK_ERROR" };
  }
}
