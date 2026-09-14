import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { AppointmentNotificationEvent, MetaWebhookReceipt } from "@shared/schema";
import type { AppointmentNotificationDependencies } from "./appointment-notifications";
import { storage, type IStorage } from "./storage";
import { sendMetaInboundAutoReply, type MetaTextDeliveryResult } from "./whatsapp";

type StatusWebhookStorage = AppointmentNotificationDependencies["storage"];
type WebhookStorage = StatusWebhookStorage & Pick<
  IStorage,
  "claimMetaInboundAutoReply" | "completeMetaInboundAutoReply"
>;

type LateFallbackHandler = (eventId: number, store: StatusWebhookStorage) => Promise<unknown>;
type InboundAutoReplySender = (recipient: string) => Promise<MetaTextDeliveryResult>;

const INBOUND_AUTO_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const inboundUserMessageTypes = new Set([
  "text", "image", "audio", "video", "document", "sticker", "contacts", "location", "interactive", "button", "order",
]);

const defaultLateFallbackHandler: LateFallbackHandler = async (eventId, store) => {
  const { defaultDependencies, processMetaLateFailureEmailFallback } = await import("./appointment-notifications");
  return processMetaLateFailureEmailFallback(eventId, { ...defaultDependencies, storage: store });
};

export function isMetaWebhookEnabled() {
  return ["true", "1"].includes(process.env.META_WHATSAPP_WEBHOOK_ENABLED?.trim().toLowerCase() || "");
}

export function isMetaInboundAutoReplyEnabled() {
  return ["true", "1"].includes(
    process.env.META_WHATSAPP_INBOUND_AUTO_REPLY_ENABLED?.trim().toLowerCase() || "",
  );
}

export function verifyMetaWebhookChallenge(query: Record<string, unknown>) {
  const expected = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim();
  const mode = String(query["hub.mode"] || "");
  const token = String(query["hub.verify_token"] || "");
  const challenge = String(query["hub.challenge"] || "");
  return Boolean(expected && mode === "subscribe" && token === expected && challenge) ? challenge : null;
}

export function verifyMetaWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined) {
  const secret = process.env.META_WHATSAPP_APP_SECRET?.trim();
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const supplied = signatureHeader.slice(7);
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied, "utf8"), Buffer.from(expected, "utf8"));
}

function providerDate(timestamp: unknown) {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

function safeErrorCode(status: Record<string, unknown>) {
  const errors = Array.isArray(status.errors) ? status.errors : [];
  const code = errors[0] && typeof errors[0] === "object" ? (errors[0] as Record<string, unknown>).code : null;
  return code === null || code === undefined ? null : String(code).slice(0, 80);
}

function normalizedDigits(value: unknown) {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function senderKey(wabaId: string, phoneNumberId: string, number: string) {
  return createHash("sha256").update(`${wabaId}|${phoneNumberId}|${number}`).digest("hex");
}

async function processInboundMessages(
  messages: unknown[],
  metadata: Record<string, unknown>,
  expectedWabaId: string,
  expectedPhoneNumberId: string,
  store: WebhookStorage,
  sendAutoReply: InboundAutoReplySender,
  now: Date,
) {
  let inboundEligible = 0;
  let autoReplies = 0;
  let inboundDuplicates = 0;
  let inboundRateLimited = 0;
  let inboundIgnored = 0;
  const businessNumber = normalizedDigits(metadata.display_phone_number);

  for (const rawMessage of messages) {
    const message = rawMessage && typeof rawMessage === "object" ? rawMessage as Record<string, unknown> : {};
    const inboundMessageId = typeof message.id === "string" ? message.id.trim() : "";
    const from = normalizedDigits(message.from);
    const messageType = typeof message.type === "string" ? message.type.trim().toLowerCase() : "";
    if (!inboundMessageId || !from || !inboundUserMessageTypes.has(messageType)
      || messageType === "reaction" || (businessNumber && from === businessNumber)) {
      inboundIgnored += 1;
      continue;
    }
    inboundEligible += 1;

    const receiptKey = createHash("sha256").update(`inbound|${inboundMessageId}`).digest("hex");
    const claim = await store.claimMetaInboundAutoReply({
      receiptKey,
      inboundMessageId,
      senderKey: senderKey(expectedWabaId, expectedPhoneNumberId, from),
      messageType,
      providerTimestamp: providerDate(message.timestamp),
      wabaId: expectedWabaId,
      phoneNumberId: expectedPhoneNumberId,
      windowStart: new Date(now.getTime() - INBOUND_AUTO_REPLY_WINDOW_MS),
    });
    if (!claim.claimed || !claim.receipt) {
      if (claim.reason === "duplicate") inboundDuplicates += 1;
      else inboundRateLimited += 1;
      continue;
    }

    try {
      const result = await sendAutoReply(from);
      if (result.outcome === "accepted") {
        autoReplies += 1;
        await store.completeMetaInboundAutoReply(claim.receipt.id, `inbound_auto_reply_sent:${messageType}`);
        console.log(`Meta inbound auto-reply accepted; receipt=${claim.receipt.id}; type=${messageType}.`);
      } else if (result.outcome === "unknown") {
        await store.completeMetaInboundAutoReply(
          claim.receipt.id,
          `inbound_auto_reply_unknown:${messageType}`,
          result.errorCode,
        );
        console.warn(`Meta inbound auto-reply outcome unknown; receipt=${claim.receipt.id}; type=${messageType}; error=${result.errorCode || "META_UNKNOWN"}.`);
      } else {
        await store.completeMetaInboundAutoReply(
          claim.receipt.id,
          `inbound_auto_reply_failed:${messageType}`,
          result.errorCode,
        );
        console.warn(`Meta inbound auto-reply failed; receipt=${claim.receipt.id}; type=${messageType}; error=${result.errorCode || "META_UNKNOWN"}.`);
      }
    } catch {
      await store.completeMetaInboundAutoReply(claim.receipt.id, `inbound_auto_reply_failed:${messageType}`, "META_UNEXPECTED_ERROR");
      console.error(`Meta inbound auto-reply failed unexpectedly; receipt=${claim.receipt.id}; type=${messageType}.`);
    }
  }
  return { inboundEligible, autoReplies, inboundDuplicates, inboundRateLimited, inboundIgnored };
}

const progression: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3 };

async function applyReceipt(
  event: AppointmentNotificationEvent,
  receipt: MetaWebhookReceipt,
  store: StatusWebhookStorage,
  lateFallback: LateFallbackHandler,
) {
  const currentRank = progression[event.whatsappStatus] ?? -1;
  const nextRank = progression[receipt.status] ?? -1;
  if (receipt.status === "failed") {
    if (currentRank >= progression.delivered) return;
    await store.updateAppointmentNotificationEvent(event.id, {
      whatsappStatus: "failed", providerStatus: receipt.errorCode ? `META_ERROR_${receipt.errorCode}` : "META_FAILED",
      errorCode: receipt.errorCode ? `META_ERROR_${receipt.errorCode}` : "META_FAILED",
      failedAt: receipt.providerTimestamp || new Date(), lastProviderTimestamp: receipt.providerTimestamp,
    });
    console.warn(`Meta late failed; event=${event.id}; error=${receipt.errorCode ? `META_ERROR_${receipt.errorCode}` : "META_FAILED"}.`);
    try {
      await lateFallback(event.id, store);
    } catch {
      console.error(`Meta late fallback processing failed; event=${event.id}.`);
    }
    return;
  }
  if (event.whatsappStatus === "failed" && ["sent", "delivered", "read"].includes(receipt.status)) return;
  if (nextRank < 1 || nextRank <= currentRank) return;
  await store.updateAppointmentNotificationEvent(event.id, {
    whatsappStatus: receipt.status,
    providerStatus: `META_${receipt.status.toUpperCase()}`,
    lastProviderTimestamp: receipt.providerTimestamp,
    ...(receipt.status === "sent" ? { sentAt: receipt.providerTimestamp || new Date() } : {}),
    ...(receipt.status === "delivered" ? { deliveredAt: receipt.providerTimestamp || new Date() } : {}),
    ...(receipt.status === "read" ? { readAt: receipt.providerTimestamp || new Date() } : {}),
  });
}

export async function reconcileMetaStatusReceipts(
  providerMessageId: string,
  store: StatusWebhookStorage = storage,
  lateFallback: LateFallbackHandler = defaultLateFallbackHandler,
) {
  const event = await store.getAppointmentNotificationEventByProviderId(providerMessageId);
  if (!event) return 0;
  await store.reconcileMetaWebhookReceipts(providerMessageId, event.id);
  const receipts = await store.getMetaWebhookReceipts(providerMessageId);
  for (const receipt of receipts) {
    await applyReceipt((await store.getAppointmentNotificationEventByProviderId(providerMessageId))!, receipt, store, lateFallback);
  }
  return receipts.length;
}

export async function recordMetaWebhookStatuses(
  payload: unknown,
  store: WebhookStorage = storage,
  lateFallback: LateFallbackHandler = defaultLateFallbackHandler,
  sendAutoReply: InboundAutoReplySender = sendMetaInboundAutoReply,
  now: Date = new Date(),
) {
  const expectedWabaId = process.env.META_WHATSAPP_WABA_ID?.trim();
  const expectedPhoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!expectedWabaId || !expectedPhoneNumberId) throw new Error("META_WEBHOOK_CONFIG_INCOMPLETE");
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) throw new Error("META_WEBHOOK_PAYLOAD_INVALID");
  let recorded = 0;
  let duplicates = 0;
  let orphans = 0;
  let inboundEligible = 0;
  let autoReplies = 0;
  let inboundDuplicates = 0;
  let inboundRateLimited = 0;
  let inboundIgnored = 0;
  for (const rawEntry of body.entry) {
    const entry = rawEntry && typeof rawEntry === "object" ? rawEntry as Record<string, unknown> : {};
    if (String(entry.id || "") !== expectedWabaId) throw new Error("META_WEBHOOK_ACCOUNT_MISMATCH");
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const rawChange of changes) {
      const change = rawChange && typeof rawChange === "object" ? rawChange as Record<string, unknown> : {};
      if (change.field !== "messages") continue;
      const value = change.value && typeof change.value === "object" ? change.value as Record<string, unknown> : {};
      const metadata = value.metadata && typeof value.metadata === "object" ? value.metadata as Record<string, unknown> : {};
      if (String(metadata.phone_number_id || "") !== expectedPhoneNumberId) throw new Error("META_WEBHOOK_PHONE_MISMATCH");
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const rawStatus of statuses) {
        const status = rawStatus && typeof rawStatus === "object" ? rawStatus as Record<string, unknown> : {};
        const wamid = typeof status.id === "string" ? status.id : "";
        const statusName = typeof status.status === "string" ? status.status : "";
        if (!wamid || !["sent", "delivered", "read", "failed"].includes(statusName)) continue;
        const timestamp = providerDate(status.timestamp);
        const errorCode = safeErrorCode(status);
        const receiptKey = createHash("sha256").update(`${wamid}|${statusName}|${timestamp?.toISOString() || ""}|${errorCode || ""}`).digest("hex");
        const event = await store.getAppointmentNotificationEventByProviderId(wamid);
        const result = await store.createMetaWebhookReceipt({ receiptKey, providerMessageId: wamid,
          status: statusName, providerTimestamp: timestamp, errorCode,
          wabaId: expectedWabaId, phoneNumberId: expectedPhoneNumberId,
          notificationEventId: event?.id || null,
          payloadSummary: JSON.stringify({ status: statusName, errorCode }), });
        if (result.created) recorded += 1; else duplicates += 1;
        if (event) await reconcileMetaStatusReceipts(wamid, store, lateFallback); else orphans += 1;
      }
      if (isMetaInboundAutoReplyEnabled()) {
        try {
          const inbound = await processInboundMessages(
            Array.isArray(value.messages) ? value.messages : [],
            metadata,
            expectedWabaId,
            expectedPhoneNumberId,
            store,
            sendAutoReply,
            now,
          );
          inboundEligible += inbound.inboundEligible;
          autoReplies += inbound.autoReplies;
          inboundDuplicates += inbound.inboundDuplicates;
          inboundRateLimited += inbound.inboundRateLimited;
          inboundIgnored += inbound.inboundIgnored;
        } catch {
          console.error("Meta inbound auto-reply processing failed; status webhook processing remains acknowledged.");
        }
      }
    }
  }
  const statusResult = { recorded, duplicates, orphans };
  return inboundEligible || autoReplies || inboundDuplicates || inboundRateLimited || inboundIgnored
    ? { ...statusResult, inboundEligible, autoReplies, inboundDuplicates, inboundRateLimited, inboundIgnored }
    : statusResult;
}
