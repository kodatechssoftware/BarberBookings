import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { AppointmentNotificationEvent, MetaWebhookReceipt } from "@shared/schema";
import { storage, type IStorage } from "./storage";

type WebhookStorage = Pick<IStorage,
  | "getAppointmentNotificationEventByProviderId" | "updateAppointmentNotificationEvent"
  | "createMetaWebhookReceipt" | "getMetaWebhookReceipts" | "reconcileMetaWebhookReceipts"
>;

export function isMetaWebhookEnabled() {
  return ["true", "1"].includes(process.env.META_WHATSAPP_WEBHOOK_ENABLED?.trim().toLowerCase() || "");
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

const progression: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3 };

async function applyReceipt(event: AppointmentNotificationEvent, receipt: MetaWebhookReceipt, store: WebhookStorage) {
  const currentRank = progression[event.whatsappStatus] ?? -1;
  const nextRank = progression[receipt.status] ?? -1;
  if (receipt.status === "failed") {
    if (currentRank >= progression.delivered) return;
    await store.updateAppointmentNotificationEvent(event.id, {
      whatsappStatus: "failed", providerStatus: receipt.errorCode ? `META_ERROR_${receipt.errorCode}` : "META_FAILED",
      errorCode: receipt.errorCode ? `META_ERROR_${receipt.errorCode}` : "META_FAILED",
      failedAt: receipt.providerTimestamp || new Date(), lastProviderTimestamp: receipt.providerTimestamp,
      // Observation mode: deliberately do not claim or send late email fallback.
      webhookFallbackClaimedAt: null,
    });
    return;
  }
  if (event.whatsappStatus === "failed" && receipt.status === "sent") return;
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

export async function reconcileMetaStatusReceipts(providerMessageId: string, store: WebhookStorage = storage) {
  const event = await store.getAppointmentNotificationEventByProviderId(providerMessageId);
  if (!event) return 0;
  await store.reconcileMetaWebhookReceipts(providerMessageId, event.id);
  const receipts = await store.getMetaWebhookReceipts(providerMessageId);
  for (const receipt of receipts) await applyReceipt((await store.getAppointmentNotificationEventByProviderId(providerMessageId))!, receipt, store);
  return receipts.length;
}

export async function recordMetaWebhookStatuses(payload: unknown, store: WebhookStorage = storage) {
  const expectedWabaId = process.env.META_WHATSAPP_WABA_ID?.trim();
  const expectedPhoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!expectedWabaId || !expectedPhoneNumberId) throw new Error("META_WEBHOOK_CONFIG_INCOMPLETE");
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) throw new Error("META_WEBHOOK_PAYLOAD_INVALID");
  let recorded = 0;
  let duplicates = 0;
  let orphans = 0;
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
        if (event) await reconcileMetaStatusReceipts(wamid, store); else orphans += 1;
      }
    }
  }
  return { recorded, duplicates, orphans };
}
