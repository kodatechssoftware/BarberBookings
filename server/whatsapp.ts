import "dotenv/config";

import { storage } from "./storage";
import type { WhatsappMessageStatus, WhatsappMessageType } from "@shared/schema";

type AppointmentMessageParams = {
  appointmentId?: number;
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
const TWILIO_REQUEST_TIMEOUT_MS = Number(process.env.TWILIO_REQUEST_TIMEOUT_MS || 10000);
const isProduction = process.env.NODE_ENV === "production";

let warnedMissingConfig = false;

function getMessagingProvider() {
  const provider = process.env.MESSAGING_PROVIDER?.trim().toLowerCase();
  if (provider === "none") return "none";
  if (provider === "twilio" || provider === "twilio_whatsapp") return "twilio";
  return "evolution";
}

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

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim();
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM?.trim() || process.env.TWILIO_FROM_NUMBER?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();

  if (!accountSid || !apiKeySid || !apiKeySecret || (!fromNumber && !messagingServiceSid)) {
    if (!warnedMissingConfig && (accountSid || apiKeySid || apiKeySecret || fromNumber || messagingServiceSid)) {
      warnedMissingConfig = true;
      console.warn(
        "Twilio WhatsApp config is incomplete; WhatsApp notifications were skipped.",
      );
    }
    return null;
  }

  return {
    accountSid,
    apiKeySid,
    apiKeySecret,
    fromNumber,
    messagingServiceSid,
  };
}

function normalizeWhatsAppNumber(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^00/, "").replace(/^0+/, "");
  if (!digits) return "";

  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    return digits;
  }

  return `${DEFAULT_COUNTRY_CODE}${digits}`;
}

function normalizeSmsNumber(phone: string) {
  const number = normalizeWhatsAppNumber(phone);
  return number ? `+${number}` : "";
}

function normalizeTwilioWhatsAppAddress(phone: string) {
  const trimmedPhone = phone.trim();
  if (trimmedPhone.startsWith("whatsapp:")) return trimmedPhone;

  const normalizedNumber = normalizeSmsNumber(trimmedPhone);
  return normalizedNumber ? `whatsapp:${normalizedNumber}` : "";
}

function maskPhoneNumber(phone: string) {
  if (phone.length <= 5) return phone;
  return `${phone.slice(0, 3)}***${phone.slice(-3)}`;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function truncate(value: string | null | undefined, maxLength: number) {
  if (!value) return value ?? null;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

async function readEvolutionResponse(response: Response) {
  const responseText = await response.text();
  if (!responseText) return { responseText, responseJson: null as unknown };

  try {
    return { responseText, responseJson: JSON.parse(responseText) as unknown };
  } catch {
    return { responseText, responseJson: null as unknown };
  }
}

function getNestedString(value: unknown, path: string[]): string | null {
  const current = getNestedValue(value, path);
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function getNestedValue(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) return null;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function extractEvolutionMessageId(responseJson: unknown): string | null {
  const paths = [
    ["key", "id"],
    ["data", "key", "id"],
    ["message", "key", "id"],
    ["data", "message", "key", "id"],
    ["id"],
    ["messageId"],
    ["keyId"],
    ["data", "id"],
    ["data", "messageId"],
    ["data", "keyId"],
  ];

  for (const path of paths) {
    const value = getNestedString(responseJson, path);
    if (value) return value;
  }

  return null;
}

function mapEvolutionDeliveryStatus(providerStatus: unknown): WhatsappMessageStatus {
  const normalizedStatus = String(providerStatus ?? "").trim().toLowerCase();

  if (["read", "played", "read_ack", "3", "4"].includes(normalizedStatus)) return "read";
  if (["delivered", "delivery_ack", "server_ack", "2"].includes(normalizedStatus)) return "delivered";
  if (["sent", "send", "sent_ack", "1"].includes(normalizedStatus)) return "sent";
  if (["error", "failed", "failure", "undelivered", "-1"].includes(normalizedStatus)) return "failed";
  if (["pending", "0"].includes(normalizedStatus)) return "pending";

  return "unknown";
}

function mapTwilioDeliveryStatus(providerStatus: unknown): WhatsappMessageStatus {
  const normalizedStatus = String(providerStatus ?? "").trim().toLowerCase();

  if (normalizedStatus === "delivered") return "delivered";
  if (["sent", "sending", "queued", "accepted", "scheduled"].includes(normalizedStatus)) return "sent";
  if (["failed", "undelivered", "canceled"].includes(normalizedStatus)) return "failed";

  return "pending";
}

function formatTwilioWhatsAppFrom(from: string) {
  const trimmedFrom = from.trim();
  if (trimmedFrom.startsWith("whatsapp:")) return trimmedFrom;
  return `whatsapp:${trimmedFrom}`;
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
    `Ol\u00e1 ${customerName}, a sua marca\u00e7\u00e3o est\u00e1 confirmada.`,
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
    `Ol\u00e1 ${customerName}, a sua marca\u00e7\u00e3o para ${date} \u00e0s ${time} foi cancelada com sucesso.`,
    "Se quiser voltar a marcar, estamos dispon\u00edveis para agendar uma nova data quando quiser.",
    "Obrigado,",
    SHOP_NAME,
  ].filter(Boolean).join("\n");
}

async function sendWhatsAppText(
  phone: string,
  text: string,
  options: {
    appointmentId?: number;
    messageType: WhatsappMessageType;
  },
) {
  const provider = getMessagingProvider();
  if (provider === "none") {
    if (!isProduction) {
      console.log("Message notification skipped; messaging provider is disabled.");
    }
    return false;
  }

  if (provider === "twilio") {
    return sendTwilioWhatsApp(phone, text, options);
  }

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

  const { responseText, responseJson } = await readEvolutionResponse(response);

  if (!response.ok) {
    throw new Error(
      `Evolution API returned ${response.status}: ${(responseText || response.statusText).slice(0, 800)}`,
    );
  }

  const providerMessageId = extractEvolutionMessageId(responseJson);
  await storage.createWhatsappMessage({
    appointmentId: options.appointmentId,
    messageType: options.messageType,
    phone: number,
    providerMessageId,
    status: "pending",
    providerStatus: "HTTP_ACCEPTED",
    responseStatus: response.status,
    responseBody: truncate(responseText, 4000),
  });

  console.log(
    `WhatsApp notification accepted by Evolution API for ${maskPhoneNumber(number)}; delivery is pending webhook confirmation.`,
  );
  return {
    accepted: true,
    status: "pending" as const,
    providerMessageId,
  };
}

async function sendTwilioWhatsApp(
  phone: string,
  text: string,
  options: {
    appointmentId?: number;
    messageType: WhatsappMessageType;
  },
) {
  const config = getTwilioConfig();
  if (!config) {
    if (!isProduction) {
      console.log("WhatsApp notification skipped; Twilio is not configured.");
    }
    return false;
  }

  const number = normalizeTwilioWhatsAppAddress(phone);
  if (!number) {
    console.warn("WhatsApp notification skipped; customer phone is empty.");
    return false;
  }

  const body = new URLSearchParams({
    To: number,
    Body: text,
  });

  if (config.messagingServiceSid) {
    body.set("MessagingServiceSid", config.messagingServiceSid);
  } else if (config.fromNumber) {
    body.set("From", formatTwilioWhatsAppFrom(config.fromNumber));
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
    {
      method: "POST",
      signal: AbortSignal.timeout(TWILIO_REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.apiKeySid}:${config.apiKeySecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );

  const { responseText, responseJson } = await readEvolutionResponse(response);
  const providerMessageId = getNestedString(responseJson, ["sid"]);
  const providerStatus = getNestedString(responseJson, ["status"]) || (response.ok ? "accepted" : "failed");

  if (!response.ok) {
    throw new Error(
      `Twilio returned ${response.status}: ${(responseText || response.statusText).slice(0, 800)}`,
    );
  }

  await storage.createWhatsappMessage({
    appointmentId: options.appointmentId,
    messageType: options.messageType,
    phone: number,
    providerMessageId,
    status: mapTwilioDeliveryStatus(providerStatus),
    providerStatus,
    responseStatus: response.status,
    responseBody: truncate(responseText, 4000),
  });

  console.log(
    `WhatsApp notification accepted by Twilio for ${maskPhoneNumber(number)}; provider status is ${providerStatus}.`,
  );
  return {
    accepted: true,
    status: mapTwilioDeliveryStatus(providerStatus),
    providerMessageId,
  };
}

export async function sendBookingWhatsAppConfirmation(params: AppointmentMessageParams) {
  return sendWhatsAppText(
    params.customerPhone,
    buildBookingConfirmationMessage(params),
    {
      appointmentId: params.appointmentId,
      messageType: "booking_confirmation",
    },
  );
}

export async function sendBookingWhatsAppCancellation(params: AppointmentMessageParams) {
  return sendWhatsAppText(
    params.customerPhone,
    buildBookingCancellationMessage(params),
    {
      appointmentId: params.appointmentId,
      messageType: "booking_cancellation",
    },
  );
}

function extractWebhookMessageId(data: unknown): string | null {
  const paths = [
    ["key", "id"],
    ["id"],
    ["messageId"],
    ["keyId"],
    ["message", "key", "id"],
    ["update", "key", "id"],
  ];

  for (const path of paths) {
    const value = getNestedValue(data, path);
    if (
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
      String(value).trim()
    ) {
      return String(value).trim();
    }
  }

  return null;
}

function extractWebhookProviderStatus(data: unknown): string | number | boolean | null {
  const paths = [
    ["status"],
    ["update", "status"],
    ["message", "status"],
    ["receipt", "status"],
  ];

  for (const path of paths) {
    const value = getNestedString(data, path);
    if (value) return value;
  }

  if (data && typeof data === "object" && "status" in data) {
    const status = (data as Record<string, unknown>).status;
    if (typeof status === "string" || typeof status === "number" || typeof status === "boolean") {
      return status;
    }
  }

  return null;
}

export async function recordEvolutionMessagesUpdate(payload: unknown) {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rawData = body.data;
  const items = Array.isArray(rawData) ? rawData : [rawData];
  const updates: Array<{
    providerMessageId: string;
    status: WhatsappMessageStatus;
    updated: boolean;
  }> = [];

  for (const item of items) {
    if (!item) continue;
    const providerMessageId = extractWebhookMessageId(item);
    if (!providerMessageId) continue;

    const providerStatus = extractWebhookProviderStatus(item);
    const status = mapEvolutionDeliveryStatus(providerStatus);
    const updated = await storage.updateWhatsappMessageStatusByProviderId(
      providerMessageId,
      status,
      providerStatus === null || providerStatus === undefined ? null : String(providerStatus),
      truncate(safeStringify(payload), 8000),
    );

    updates.push({
      providerMessageId,
      status,
      updated: Boolean(updated),
    });
  }

  return updates;
}
