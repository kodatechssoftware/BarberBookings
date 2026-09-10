import "dotenv/config";

import { storage } from "./storage";
import type { WhatsappMessageStatus, WhatsappMessageType } from "@shared/schema";
import { isDevelopmentDeployment } from "./runtime-environment";

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

export function areWhatsappNotificationsEnabled() {
  const value = process.env.WHATSAPP_NOTIFICATIONS_ENABLED?.trim().toLowerCase();
  return value === "true" || value === "1";
}

function getMessagingProvider(): "none" | "evolution" | "twilio" | "meta" {
  const provider = process.env.MESSAGING_PROVIDER?.trim().toLowerCase();
  if (provider === "evolution") return "evolution";
  if (provider === "twilio" || provider === "twilio_whatsapp") return "twilio";
  if (provider === "meta") return "meta";
  return "none";
}

function getEvolutionConfig() {
  const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  const instance = process.env.EVOLUTION_API_INSTANCE?.trim();
  if (!areWhatsappNotificationsEnabled()) return null;

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
  if (!areWhatsappNotificationsEnabled()) return null;

  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim();
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM?.trim() || process.env.TWILIO_FROM_NUMBER?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  const bookingConfirmationContentSid =
    process.env.TWILIO_BOOKING_CONFIRMATION_CONTENT_SID?.trim() ||
    process.env.TWILIO_CONTENT_SID?.trim();
  const bookingCancellationContentSid =
    process.env.TWILIO_BOOKING_CANCELLATION_CONTENT_SID?.trim() ||
    process.env.TWILIO_CONTENT_SID?.trim();

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
    bookingConfirmationContentSid,
    bookingCancellationContentSid,
  };
}

function normalizeWhatsAppNumber(phone: string) {
  const trimmed = phone.trim();
  const hasExplicitCountryCode = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digits = trimmed.replace(/\D/g, "").replace(/^00/, "").replace(/^0+/, "");
  if (!digits) return "";

  if (hasExplicitCountryCode) {
    return digits;
  }

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

type MetaConfig = {
  graphApiVersion: string;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  testTemplate: string;
  testTemplateLanguage: string;
  allowedRecipients: Set<string>;
};

export class MetaWhatsAppTestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly recordId?: number,
  ) {
    super(message);
    this.name = "MetaWhatsAppTestError";
  }
}

function getMetaConfig(): MetaConfig {
  if (!areWhatsappNotificationsEnabled()) {
    throw new MetaWhatsAppTestError("As notificacoes WhatsApp estao desativadas em Development.", 400);
  }
  if (getMessagingProvider() !== "meta") {
    throw new MetaWhatsAppTestError("O provider WhatsApp ativo em Development nao e meta.", 400);
  }

  const graphApiVersion = process.env.META_WHATSAPP_GRAPH_API_VERSION?.trim() || "";
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim() || "";
  const wabaId = process.env.META_WHATSAPP_WABA_ID?.trim() || "";
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() || "";
  const testTemplate = process.env.META_WHATSAPP_TEST_TEMPLATE?.trim() || "hello_world";
  const testTemplateLanguage = process.env.META_WHATSAPP_TEST_TEMPLATE_LANGUAGE?.trim() || "en_US";
  const allowlist = process.env.META_WHATSAPP_DEV_ALLOWLIST?.trim() || "";

  if (!/^v\d+\.\d+$/.test(graphApiVersion)) {
    throw new MetaWhatsAppTestError("META_WHATSAPP_GRAPH_API_VERSION esta em falta ou e invalida.", 400);
  }
  if (!phoneNumberId || !wabaId || !accessToken) {
    throw new MetaWhatsAppTestError("A configuracao Meta WhatsApp de Development esta incompleta.", 400);
  }

  const allowedRecipients = new Set(
    allowlist.split(",").map(normalizeWhatsAppNumber).filter(Boolean),
  );
  if (allowedRecipients.size === 0) {
    throw new MetaWhatsAppTestError("META_WHATSAPP_DEV_ALLOWLIST e obrigatoria em Development.", 400);
  }

  return {
    graphApiVersion,
    phoneNumberId,
    wabaId,
    accessToken,
    testTemplate,
    testTemplateLanguage,
    allowedRecipients,
  };
}

function getSafeMetaResponse(responseJson: unknown) {
  const wamid = getNestedString(responseJson, ["messages", "0", "id"]);
  const messageStatus = getNestedString(responseJson, ["messages", "0", "message_status"]);
  const waId = getNestedString(responseJson, ["contacts", "0", "wa_id"]);
  const error = getNestedValue(responseJson, ["error"]);
  const safeError = error && typeof error === "object" ? {
    type: typeof (error as Record<string, unknown>).type === "string"
      ? (error as Record<string, unknown>).type
      : undefined,
    code: typeof (error as Record<string, unknown>).code === "number"
      ? (error as Record<string, unknown>).code
      : undefined,
    error_subcode: typeof (error as Record<string, unknown>).error_subcode === "number"
      ? (error as Record<string, unknown>).error_subcode
      : undefined,
  } : undefined;

  return {
    wamid,
    messageStatus,
    waId,
    storedBody: truncate(safeStringify({
      messaging_product: getNestedString(responseJson, ["messaging_product"]),
      message_id: wamid,
      message_status: messageStatus,
      error: safeError,
    }), 4000),
    providerStatus: safeError?.code
      ? `META_ERROR_${safeError.code}`
      : messageStatus || (wamid ? "META_ACCEPTED" : "META_RESPONSE_UNKNOWN"),
  };
}

export async function sendMetaWhatsAppTestMessage(recipient: string) {
  if (!isDevelopmentDeployment) {
    throw new MetaWhatsAppTestError("Este teste so esta disponivel em Development.", 404);
  }

  const config = getMetaConfig();
  const number = normalizeWhatsAppNumber(recipient);
  if (!number || !config.allowedRecipients.has(number)) {
    throw new MetaWhatsAppTestError("O destinatario nao pertence a allowlist de Development.", 403);
  }

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${encodeURIComponent(config.graphApiVersion)}/${encodeURIComponent(config.phoneNumberId)}/messages`,
      {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: number,
          type: "template",
          template: {
            name: config.testTemplate,
            language: { code: config.testTemplateLanguage },
          },
        }),
      },
    );
  } catch (error) {
    const created = await storage.createWhatsappMessage({
      messageType: "provider_test",
      phone: number,
      status: "failed",
      providerStatus: error instanceof DOMException && error.name === "TimeoutError"
        ? "META_TIMEOUT"
        : "META_NETWORK_ERROR",
      responseBody: safeStringify({ error: "Meta request failed before an HTTP response." }),
    });
    console.warn(
      `Meta WhatsApp DEV test failed for ${maskPhoneNumber(number)} before an HTTP response; record=${created.id}; durationMs=${Date.now() - startedAt}.`,
    );
    throw new MetaWhatsAppTestError("Nao foi possivel contactar a Meta Cloud API.", 502, created.id);
  }

  const responseText = await response.text();
  let responseJson: unknown = null;
  try {
    responseJson = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseJson = null;
  }
  const safeResponse = getSafeMetaResponse(responseJson);
  const created = await storage.createWhatsappMessage({
    messageType: "provider_test",
    phone: number,
    providerMessageId: safeResponse.wamid,
    status: response.ok && safeResponse.wamid ? "pending" : "failed",
    providerStatus: safeResponse.providerStatus,
    responseStatus: response.status,
    responseBody: safeResponse.storedBody,
  });

  if (!response.ok || !safeResponse.wamid) {
    console.warn(
      `Meta WhatsApp DEV test rejected for ${maskPhoneNumber(number)}; HTTP=${response.status}; record=${created.id}; durationMs=${Date.now() - startedAt}.`,
    );
    throw new MetaWhatsAppTestError("A Meta Cloud API nao aceitou a mensagem de teste.", 502, created.id);
  }

  console.log(
    `Meta WhatsApp DEV test accepted for ${maskPhoneNumber(number)}; wamid=${safeResponse.wamid}; record=${created.id}; durationMs=${Date.now() - startedAt}.`,
  );
  return {
    accepted: true as const,
    recordId: created.id,
    wamid: safeResponse.wamid,
    status: created.status,
    providerStatus: created.providerStatus,
    responseStatus: created.responseStatus,
    recipient: maskPhoneNumber(number),
    template: config.testTemplate,
    language: config.testTemplateLanguage,
    createdAt: created.createdAt,
  };
}

export type MetaTemplateDeliveryResult = {
  outcome: "accepted" | "failed" | "unknown";
  provider: "meta";
  templateName: string;
  providerMessageId: string | null;
  providerStatus: string;
  responseStatus: number | null;
  errorCode: string | null;
};

export type MetaAppointmentTemplateParams = {
  recipient: string;
  eventType: "appointment_confirmation" | "appointment_rescheduled" | "appointment_cancelled";
  customerName: string;
  locationName: string;
  serviceName: string;
  barberName: string;
  date: string;
  time: string;
  address?: string;
  managementToken?: string;
};

const metaTemplateConfig = {
  appointment_confirmation: {
    nameEnv: "META_WHATSAPP_CONFIRMATION_TEMPLATE",
    languageEnv: "META_WHATSAPP_CONFIRMATION_TEMPLATE_LANGUAGE",
    defaultName: "appointment_confirmation_v1",
  },
  appointment_rescheduled: {
    nameEnv: "META_WHATSAPP_RESCHEDULED_TEMPLATE",
    languageEnv: "META_WHATSAPP_RESCHEDULED_TEMPLATE_LANGUAGE",
    defaultName: "appointment_rescheduled_v1",
  },
  appointment_cancelled: {
    nameEnv: "META_WHATSAPP_CANCELLED_TEMPLATE",
    languageEnv: "META_WHATSAPP_CANCELLED_TEMPLATE_LANGUAGE",
    defaultName: "appointment_cancelled_v1",
  },
} as const;

export async function sendMetaTemplate(
  params: MetaAppointmentTemplateParams,
): Promise<MetaTemplateDeliveryResult> {
  const template = metaTemplateConfig[params.eventType];
  const templateName = process.env[template.nameEnv]?.trim() || template.defaultName;
  const templateLanguage = process.env[template.languageEnv]?.trim() || "pt_PT";

  if (!isDevelopmentDeployment) {
    return {
      outcome: "failed", provider: "meta", templateName, providerMessageId: null,
      providerStatus: "ENVIRONMENT_BLOCKED", responseStatus: null, errorCode: "ENVIRONMENT_BLOCKED",
    };
  }

  let config: MetaConfig;
  try {
    config = getMetaConfig();
  } catch {
    return {
      outcome: "failed", provider: "meta", templateName, providerMessageId: null,
      providerStatus: "META_NOT_CONFIGURED", responseStatus: null, errorCode: "META_NOT_CONFIGURED",
    };
  }

  const number = normalizeWhatsAppNumber(params.recipient);
  if (!number) {
    return {
      outcome: "failed", provider: "meta", templateName, providerMessageId: null,
      providerStatus: "INVALID_RECIPIENT", responseStatus: null, errorCode: "INVALID_RECIPIENT",
    };
  }
  if (!config.allowedRecipients.has(number)) {
    return {
      outcome: "failed", provider: "meta", templateName, providerMessageId: null,
      providerStatus: "DEV_ALLOWLIST_BLOCKED", responseStatus: null, errorCode: "DEV_ALLOWLIST_BLOCKED",
    };
  }

  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${encodeURIComponent(config.graphApiVersion)}/${encodeURIComponent(config.phoneNumberId)}/messages`,
      {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: number,
          type: "template",
          template: {
            name: templateName,
            language: { code: templateLanguage },
            components: [
              {
                type: "body",
                parameters: (params.eventType === "appointment_cancelled" ? [
                  params.customerName,
                  params.locationName,
                  params.serviceName,
                  params.date,
                  params.time,
                ] : [
                  params.customerName,
                  params.locationName,
                  params.serviceName,
                  params.barberName,
                  params.date,
                  params.time,
                  params.address || "",
                ]).map((text) => ({ type: "text", text })),
              },
              ...(params.eventType !== "appointment_cancelled" ? [{
                type: "button",
                sub_type: "url",
                index: "0",
                parameters: [{ type: "text", text: params.managementToken || "" }],
              }, {
                type: "button",
                sub_type: "url",
                index: "1",
                parameters: [{ type: "text", text: params.managementToken || "" }],
              }] : []),
            ],
          },
        }),
      },
    );
  } catch (error) {
    const isTimeout = error instanceof DOMException
      && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      outcome: isTimeout ? "unknown" : "failed",
      provider: "meta",
      templateName,
      providerMessageId: null,
      providerStatus: isTimeout ? "META_TIMEOUT" : "META_NETWORK_ERROR",
      responseStatus: null,
      errorCode: isTimeout ? "META_TIMEOUT" : "META_NETWORK_ERROR",
    };
  }

  const responseText = await response.text();
  let responseJson: unknown = null;
  try {
    responseJson = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseJson = null;
  }
  const safeResponse = getSafeMetaResponse(responseJson);
  if (response.ok && safeResponse.wamid) {
    return {
      outcome: "accepted",
      provider: "meta",
      templateName,
      providerMessageId: safeResponse.wamid,
      providerStatus: safeResponse.providerStatus,
      responseStatus: response.status,
      errorCode: null,
    };
  }

  return {
    outcome: "failed",
    provider: "meta",
    templateName,
    providerMessageId: null,
    providerStatus: safeResponse.providerStatus,
    responseStatus: response.status,
    errorCode: safeResponse.providerStatus,
  };
}

export function sendMetaAppointmentRescheduled(params: Omit<MetaAppointmentTemplateParams, "eventType">) {
  return sendMetaTemplate({ ...params, eventType: "appointment_rescheduled" });
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
    contentVariables?: Record<string, string>;
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

  if (provider === "meta") {
    if (!isProduction) {
      console.log("Automatic WhatsApp notification skipped; Meta is only enabled for the isolated DEV test.");
    }
    return false;
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
    contentVariables?: Record<string, string>;
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

  const contentSid = options.messageType === "booking_cancellation"
    ? config.bookingCancellationContentSid
    : config.bookingConfirmationContentSid;

  const body = new URLSearchParams({
    To: number,
  });

  if (contentSid) {
    body.set("ContentSid", contentSid);
    if (options.contentVariables) {
      body.set("ContentVariables", JSON.stringify(options.contentVariables));
    }
  } else {
    body.set("Body", text);
  }

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
      contentVariables: {
        "1": params.customerName,
        "2": formatAppointmentDate(params.startTime),
        "3": formatAppointmentTime(params.startTime),
        "4": params.barberName || "",
        "5": params.serviceName,
        "6": params.cancelUrl || "",
        "7": SHOP_NAME,
      },
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
      contentVariables: {
        "1": params.customerName,
        "2": formatAppointmentDate(params.startTime),
        "3": formatAppointmentTime(params.startTime),
        "4": params.serviceName,
        "5": SHOP_NAME,
      },
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
