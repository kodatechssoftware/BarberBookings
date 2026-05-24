import { Resend } from "resend";
import "dotenv/config";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const isProduction = process.env.NODE_ENV === "production";

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
}: SendConfirmationParams) {
  if (!resend) {
    console.warn("RESEND_API_KEY not found; booking confirmation email was skipped.");
    return;
  }

  const dateStr = startTime.toLocaleDateString("pt-PT", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const timeStr = startTime.toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const publicUrl = getPublicUrl();
  const cancelUrl = `${publicUrl}/cancel/${cancelToken}`;
  const rescheduleUrl = `${publicUrl}/reschedule/${cancelToken}`;
  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
  const calendarParams = new URLSearchParams({
    action: "TEMPLATE",
    text: `Baptista Barber Shop - ${serviceName}`,
    dates: `${toCalendarDate(startTime)}/${toCalendarDate(endTime)}`,
    details: `${serviceName} com ${barberName}`,
    location: "Rua Comandante Agatão Lança Nº28",
  });
  const googleCalendarUrl = `https://calendar.google.com/calendar/render?${calendarParams.toString()}`;

  try {
    const response = await resend.emails.send({
      from: "Baptista Barber Shop <onboarding@resend.dev>",
      to: customerEmail,
      subject: "Confirmação de marcação - Baptista Barber Shop",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eee; border-radius: 14px; color: #111;">
          <h2 style="color: #d4af37; text-align: center; margin-top: 0;">Baptista Barber Shop</h2>
          <p>Olá <strong>${escapeHtml(customerName)}</strong>,</p>
          <p>A sua marcação foi confirmada com sucesso.</p>
          <div style="background-color: #f9f9f9; padding: 16px; border-radius: 10px; margin: 20px 0;">
            <p style="margin: 6px 0;"><strong>Barbeiro:</strong> ${escapeHtml(barberName)}</p>
            <p style="margin: 6px 0;"><strong>Serviço:</strong> ${escapeHtml(serviceName)}</p>
            <p style="margin: 6px 0;"><strong>Data:</strong> ${escapeHtml(dateStr)}</p>
            <p style="margin: 6px 0;"><strong>Hora:</strong> ${escapeHtml(timeStr)}</p>
            <p style="margin: 6px 0;"><strong>Morada:</strong> Rua Comandante Agatão Lança Nº28</p>
          </div>
          <p style="font-size: 0.92em; color: #555;">
            Pode reagendar ou cancelar através dos links abaixo. Cancelamentos a menos de ${cancellationPolicyHours} horas da marcação podem ficar registados como cancelamento tardio.
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
    } else if (!isProduction) {
      console.log("Booking confirmation email sent.");
    }
  } catch (error) {
    console.error("Error sending confirmation email:", error);
  }
}
