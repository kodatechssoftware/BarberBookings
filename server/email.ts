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
}

interface SendCancellationParams {
  customerName: string;
  customerEmail: string;
  barberName: string;
  serviceName: string;
  startTime: Date;
  lateCancellation?: boolean;
  cancellationPolicyHours?: number;
  locationName?: string;
  locationTimeZone?: string;
}

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
    time: startTime.toLocaleTimeString("pt-PT", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
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
}: SendConfirmationParams) {
  if (!resend) {
    console.warn("RESEND_API_KEY or RESEND_FROM_EMAIL not found; booking confirmation email was skipped.");
    return false;
  }

  const { date: dateStr, time: timeStr } = formatAppointmentForEmail(startTime, locationTimeZone);

  const publicUrl = getPublicUrl();
  const cancelUrl = `${publicUrl}/cancel/${cancelToken}`;
  const rescheduleUrl = `${publicUrl}/reschedule/${cancelToken}`;
  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
  const calendarParams = new URLSearchParams({
    action: "TEMPLATE",
    text: `${locationName} - ${serviceName}`,
    dates: `${toCalendarDate(startTime)}/${toCalendarDate(endTime)}`,
    details: `${serviceName} com ${barberName}`,
    location: locationAddress,
  });
  const googleCalendarUrl = `https://calendar.google.com/calendar/render?${calendarParams.toString()}`;

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
            Caso não consiga comparecer, pode reagendar ou cancelar através dos links abaixo. Cancelamentos a menos de ${cancellationPolicyHours} horas da marcação podem ficar registados como cancelamento tardio.
          </p>
          <p style="text-align: center; margin-top: 20px;">
            <a href="${googleCalendarUrl}" style="background-color: #111; color: white; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin: 4px;">Adicionar ao Google Calendar</a>
            <a href="${rescheduleUrl}" style="background-color: #d4af37; color: #111; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin: 4px;">Reagendar</a>
            <a href="${cancelUrl}" style="background-color: #ef4444; color: white; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin: 4px;">Cancelar</a>
          </p>
        </div>
      `,
    });

    if (response.error) {
      console.error("Resend error while sending booking confirmation:", response.error);
      return false;
    }

    if (!isProduction) {
      console.log("Booking confirmation email sent.");
    }

    return true;
  } catch (error) {
    console.error("Error sending confirmation email:", error);
    return false;
  }
}

export async function sendBookingCancellationConfirmation({
  customerName,
  customerEmail,
  startTime,
  lateCancellation = false,
  cancellationPolicyHours = 4,
  locationName = shopName,
  locationTimeZone = shopTimeZone,
}: SendCancellationParams) {
  if (!resend) {
    console.warn("RESEND_API_KEY or RESEND_FROM_EMAIL not found; booking cancellation email was skipped.");
    return false;
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
            lateCancellation
              ? `<p style="font-size: 0.92em; color: #b45309;">Este cancelamento foi registado como tardio por estar a menos de ${cancellationPolicyHours} horas da marcação.</p>`
              : ""
          }
          <p>Se quiser voltar a marcar, estamos disponíveis para agendar uma nova data quando quiser.</p>
          <p>Obrigado,<br />${escapeHtml(locationName)}</p>
        </div>
      `,
    });

    if (response.error) {
      console.error("Resend error while sending booking cancellation:", response.error);
      return false;
    }

    if (!isProduction) {
      console.log("Booking cancellation email sent.");
    }

    return true;
  } catch (error) {
    console.error("Error sending cancellation email:", error);
    return false;
  }
}
