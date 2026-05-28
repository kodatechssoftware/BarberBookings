import "dotenv/config";

type AppointmentMessageParams = {
  customerName: string;
  customerPhone: string;
  barberName?: string;
  serviceName: string;
  startTime: Date;
  cancelUrl?: string;
};

const SHOP_NAME = process.env.SHOP_NAME || "Baptista Barber Shop";
const SHOP_TIME_ZONE = process.env.SHOP_TIME_ZONE || "Europe/Lisbon";
const DEFAULT_COUNTRY_CODE = (process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "351").replace(/\D/g, "");
const REQUEST_TIMEOUT_MS = Number(process.env.WHATSAPP_REQUEST_TIMEOUT_MS || 10000);
const isProduction = process.env.NODE_ENV === "production";

let warnedMissingConfig = false;

function getEvolutionConfig() {
  const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  const instance = process.env.EVOLUTION_API_INSTANCE?.trim();
  const notificationsSetting = process.env.WHATSAPP_NOTIFICATIONS_ENABLED?.trim().toLowerCase();
  const notificationsEnabled = notificationsSetting !== "false" && notificationsSetting !== "0";

  if (!notificationsEnabled) return null;

  if (!apiUrl || !apiKey || !instance) {
    if (!warnedMissingConfig && (apiUrl || apiKey || instance)) {
      warnedMissingConfig = true;
      console.warn(
        "Evolution API WhatsApp config is incomplete; WhatsApp notifications were skipped.",
      );
    }
    return null;
  }

  return { apiUrl, apiKey, instance };
}

function normalizeWhatsAppNumber(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^00/, "").replace(/^0+/, "");
  if (!digits) return "";

  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    return digits;
  }

  return `${DEFAULT_COUNTRY_CODE}${digits}`;
}

function maskPhoneNumber(phone: string) {
  if (phone.length <= 5) return phone;
  return `${phone.slice(0, 3)}***${phone.slice(-3)}`;
}

function formatAppointmentDate(date: Date) {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: SHOP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatAppointmentTime(date: Date) {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: SHOP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function buildBookingConfirmationMessage({
  customerName,
  barberName,
  serviceName,
  startTime,
  cancelUrl,
}: Omit<AppointmentMessageParams, "customerPhone">) {
  const date = formatAppointmentDate(startTime);
  const time = formatAppointmentTime(startTime);

  return [
    `Ol\u00e1 ${customerName}, a sua marca\u00e7\u00e3o na ${SHOP_NAME} est\u00e1 confirmada.`,
    "",
    `Data: ${date} \u00e0s ${time}`,
    barberName ? `Barbeiro: ${barberName}` : null,
    `Servi\u00e7o: ${serviceName}`,
    "",
    cancelUrl ? "Caso n\u00e3o consiga comparecer, pode cancelar a marca\u00e7\u00e3o aqui:" : null,
    cancelUrl || null,
    "",
    "Obrigado,",
    SHOP_NAME,
  ].filter(Boolean).join("\n");
}

export function buildBookingCancellationMessage({
  customerName,
  startTime,
}: Omit<AppointmentMessageParams, "customerPhone" | "cancelUrl">) {
  const date = formatAppointmentDate(startTime);
  const time = formatAppointmentTime(startTime);

  return [
    `Ol\u00e1 ${customerName}, a sua marca\u00e7\u00e3o na ${SHOP_NAME} para ${date} \u00e0s ${time} foi cancelada com sucesso.`,
    "Se quiser voltar a marcar, estamos dispon\u00edveis para agendar uma nova data quando quiser.",
    `Obrigado, ${SHOP_NAME}`,
  ].filter(Boolean).join("\n");
}

async function sendWhatsAppText(phone: string, text: string) {
  const config = getEvolutionConfig();
  if (!config) {
    if (!isProduction) {
      console.log("WhatsApp notification skipped; Evolution API is not configured.");
    }
    return false;
  }

  const number = normalizeWhatsAppNumber(phone);
  if (!number) {
    console.warn("WhatsApp notification skipped; customer phone is empty.");
    return false;
  }

  const response = await fetch(
    `${config.apiUrl}/message/sendText/${encodeURIComponent(config.instance)}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        apikey: config.apiKey,
      },
      body: JSON.stringify({
        number,
        text,
        linkPreview: false,
      }),
    },
  );

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Evolution API returned ${response.status}: ${(responseText || response.statusText).slice(0, 800)}`,
    );
  }

  console.log(`WhatsApp notification accepted by Evolution API for ${maskPhoneNumber(number)}.`);
  return true;
}

export async function sendBookingWhatsAppConfirmation(params: AppointmentMessageParams) {
  return sendWhatsAppText(
    params.customerPhone,
    buildBookingConfirmationMessage(params),
  );
}

export async function sendBookingWhatsAppCancellation(params: AppointmentMessageParams) {
  return sendWhatsAppText(
    params.customerPhone,
    buildBookingCancellationMessage(params),
  );
}
