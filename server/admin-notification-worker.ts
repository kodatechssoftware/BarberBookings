import type { Pool } from "pg";
import { hasCapabilityAtLocation } from "@shared/auth";
import { pool } from "./db";
import { loadCanonicalAuthContext } from "./auth-runtime";
import {
  sendStaffRequestNotificationEmail,
  type EmailDeliveryResult,
  type StaffRequestNotificationEmailParams,
} from "./email";
import { staffRequestEmailsEnabled } from "./runtime-environment";

const MAX_EMAIL_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe database identifier: ${identifier}`);
  return `"${identifier}"`;
}

function tableFactory(schema = process.env.DATABASE_SCHEMA?.trim() || "public") {
  return (name: string) => `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function utcTimestamp(value: Date) {
  return value.toISOString().replace("T", " ").replace("Z", "");
}

type EmailCandidate = {
  notificationId: number;
  userId: number;
  attempts: number;
  eventKey: string;
  notificationType: "new_request" | "pending_reminder";
  locationId: number;
  requestId: number;
  recipientEmail: string;
  recipientName: string;
  locationName: string;
  locationTimeZone: string;
  customerName: string;
  requestedStartTime: Date;
  serviceNames: string[];
};

export type AdminRequestNotificationWorkerDependencies = {
  databasePool: Pool;
  sendEmail: (params: StaffRequestNotificationEmailParams) => Promise<EmailDeliveryResult>;
  processingEnabled: boolean;
  now: () => Date;
};

export const defaultAdminRequestNotificationWorkerDependencies: AdminRequestNotificationWorkerDependencies = {
  databasePool: pool,
  sendEmail: sendStaffRequestNotificationEmail,
  processingEnabled: staffRequestEmailsEnabled,
  now: () => new Date(),
};

export async function prepareDueAdminRequestNotificationEmails(
  deps = defaultAdminRequestNotificationWorkerDependencies,
) {
  if (!deps.processingEnabled) return 0;
  const table = tableFactory();
  const client = await deps.databasePool.connect();
  const now = deps.now();
  try {
    await client.query("BEGIN");
    const notificationResult = await client.query<{
      id: number;
      location_id: number;
      notification_type: "new_request" | "pending_reminder";
      request_status: string;
    }>(`
      SELECT notification.id, notification.location_id, notification.notification_type,
        request.status AS request_status
      FROM ${table("admin_notifications")} notification
      INNER JOIN ${table("appointment_requests")} request
        ON request.id = notification.appointment_request_id
      WHERE notification.email_delivery_enabled = true
        AND notification.recipients_prepared_at IS NULL
        AND notification.cancelled_at IS NULL
        AND notification.available_at <= $1::timestamp
      ORDER BY notification.available_at, notification.id
      FOR UPDATE OF notification SKIP LOCKED
      LIMIT 1
    `, [utcTimestamp(now)]);
    const notification = notificationResult.rows[0];
    if (!notification) {
      await client.query("COMMIT");
      return 0;
    }
    if (notification.notification_type === "pending_reminder" && notification.request_status !== "pending") {
      await client.query(`
        UPDATE ${table("admin_notifications")}
        SET cancelled_at = $2::timestamp, recipients_prepared_at = $2::timestamp
        WHERE id = $1
      `, [notification.id, utcTimestamp(now)]);
      await client.query("COMMIT");
      return 1;
    }

    const channelColumn = notification.notification_type === "new_request"
      ? "new_request_email"
      : "pending_reminder_email";
    const recipients = await client.query<{ user_id: number }>(`
      SELECT recipient.user_id
      FROM ${table("location_request_notification_recipients")} recipient
      INNER JOIN ${table("users")} user_account ON user_account.id = recipient.user_id
      WHERE recipient.location_id = $1
        AND recipient.is_active = true
        AND recipient.${channelColumn} = true
        AND user_account.status = 'active'
      ORDER BY recipient.user_id
    `, [notification.location_id]);

    for (const recipient of recipients.rows) {
      const context = await loadCanonicalAuthContext(client, recipient.user_id, { requireActive: false });
      const eligible = Boolean(context?.user.isActive
        && hasCapabilityAtLocation(context.access, "appointments.manage_team", notification.location_id));
      if (!eligible) continue;
      await client.query(`
        INSERT INTO ${table("admin_notification_user_states")} (
          notification_id, user_id, email_status, email_attempts,
          next_email_attempt_at, created_at, updated_at
        ) VALUES ($1, $2, 'pending', 0, $3::timestamp, $3::timestamp, $3::timestamp)
        ON CONFLICT (notification_id, user_id) DO UPDATE SET
          email_status = CASE
            WHEN ${table("admin_notification_user_states")}.read_at IS NOT NULL THEN 'skipped'
            WHEN ${table("admin_notification_user_states")}.email_status IN ('sent', 'failed')
              THEN ${table("admin_notification_user_states")}.email_status
            ELSE 'pending'
          END,
          next_email_attempt_at = CASE
            WHEN ${table("admin_notification_user_states")}.read_at IS NOT NULL THEN NULL
            ELSE COALESCE(${table("admin_notification_user_states")}.next_email_attempt_at, EXCLUDED.next_email_attempt_at)
          END,
          email_error_code = CASE
            WHEN ${table("admin_notification_user_states")}.read_at IS NOT NULL THEN 'READ_BEFORE_EMAIL'
            ELSE ${table("admin_notification_user_states")}.email_error_code
          END,
          updated_at = EXCLUDED.updated_at
      `, [notification.id, recipient.user_id, utcTimestamp(now)]);
    }
    await client.query(`
      UPDATE ${table("admin_notifications")}
      SET recipients_prepared_at = $2::timestamp
      WHERE id = $1
    `, [notification.id, utcTimestamp(now)]);
    await client.query("COMMIT");
    return 1;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function claimNextEmail(
  deps: AdminRequestNotificationWorkerDependencies,
  leaseMs: number,
): Promise<EmailCandidate | null> {
  const table = tableFactory();
  const client = await deps.databasePool.connect();
  const now = deps.now();
  try {
    await client.query("BEGIN");
    await client.query(`
      UPDATE ${table("admin_notification_user_states")}
      SET email_status = 'retry', next_email_attempt_at = $1::timestamp,
        email_lease_started_at = NULL, email_error_code = 'LEASE_RECOVERED', updated_at = $1::timestamp
      WHERE email_status = 'sending'
        AND email_lease_started_at < $2::timestamp
    `, [utcTimestamp(now), utcTimestamp(new Date(now.getTime() - leaseMs))]);
    const claimed = await client.query<{
      notification_id: number;
      user_id: number;
      email_attempts: number;
      event_key: string;
      notification_type: "new_request" | "pending_reminder";
      location_id: number;
      appointment_request_id: number;
      request_status: string;
      recipient_email: string;
      recipient_name: string;
      location_name: string;
      location_timezone: string;
      customer_name: string;
      requested_start_time: Date;
      service_names: string[];
    }>(`
      SELECT state.notification_id, state.user_id, state.email_attempts,
        notification.event_key, notification.notification_type, notification.location_id,
        notification.appointment_request_id, request.status AS request_status,
        user_account.email AS recipient_email, user_account.display_name AS recipient_name,
        location.name AS location_name, location.timezone AS location_timezone,
        request.customer_name, request.requested_start_time,
        COALESCE((
          SELECT array_agg(segment.service_name_snapshot ORDER BY segment.position)
          FROM ${table("appointment_request_segments")} segment
          WHERE segment.request_id = request.id
        ), ARRAY[]::text[]) AS service_names
      FROM ${table("admin_notification_user_states")} state
      INNER JOIN ${table("admin_notifications")} notification ON notification.id = state.notification_id
      INNER JOIN ${table("appointment_requests")} request ON request.id = notification.appointment_request_id
      INNER JOIN ${table("users")} user_account ON user_account.id = state.user_id
      INNER JOIN ${table("locations")} location ON location.id = notification.location_id
      WHERE state.email_status IN ('pending', 'retry')
        AND state.next_email_attempt_at <= $1::timestamp
        AND notification.email_delivery_enabled = true
        AND notification.cancelled_at IS NULL
        AND (notification.notification_type <> 'pending_reminder' OR request.status = 'pending')
      ORDER BY state.next_email_attempt_at, state.notification_id, state.user_id
      FOR UPDATE OF state SKIP LOCKED
      LIMIT 1
    `, [utcTimestamp(now)]);
    const row = claimed.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    await client.query(`
      UPDATE ${table("admin_notification_user_states")}
      SET email_status = 'sending', email_attempts = email_attempts + 1,
        email_lease_started_at = $3::timestamp, next_email_attempt_at = NULL,
        email_error_code = NULL, updated_at = $3::timestamp
      WHERE notification_id = $1 AND user_id = $2
    `, [row.notification_id, row.user_id, utcTimestamp(now)]);
    await client.query("COMMIT");
    return {
      notificationId: row.notification_id,
      userId: row.user_id,
      attempts: row.email_attempts + 1,
      eventKey: row.event_key,
      notificationType: row.notification_type,
      locationId: row.location_id,
      requestId: row.appointment_request_id,
      recipientEmail: row.recipient_email,
      recipientName: row.recipient_name,
      locationName: row.location_name,
      locationTimeZone: row.location_timezone || "Europe/Lisbon",
      customerName: row.customer_name,
      requestedStartTime: new Date(row.requested_start_time),
      serviceNames: row.service_names,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function finishEmail(
  deps: AdminRequestNotificationWorkerDependencies,
  candidate: EmailCandidate,
  result: EmailDeliveryResult,
) {
  const table = tableFactory();
  const now = deps.now();
  const permanentFailure = result.errorCode === "EMAIL_NOT_CONFIGURED";
  const retry = !result.sent && !permanentFailure && candidate.attempts < MAX_EMAIL_ATTEMPTS;
  const retryAt = retry
    ? new Date(now.getTime() + RETRY_DELAYS_MS[Math.min(candidate.attempts - 1, RETRY_DELAYS_MS.length - 1)])
    : null;
  await deps.databasePool.query(`
    UPDATE ${table("admin_notification_user_states")}
    SET email_status = $3, next_email_attempt_at = $4::timestamp,
      email_lease_started_at = NULL, email_provider_message_id = $5,
      email_error_code = $6, email_sent_at = $7::timestamp, updated_at = $8::timestamp
    WHERE notification_id = $1 AND user_id = $2 AND email_status = 'sending'
  `, [
    candidate.notificationId,
    candidate.userId,
    result.sent ? "sent" : retry ? "retry" : "failed",
    retryAt ? utcTimestamp(retryAt) : null,
    result.providerMessageId,
    result.errorCode,
    result.sent ? utcTimestamp(now) : null,
    utcTimestamp(now),
  ]);
}

async function skipEmail(
  deps: AdminRequestNotificationWorkerDependencies,
  candidate: EmailCandidate,
  reason: string,
) {
  const table = tableFactory();
  const now = deps.now();
  await deps.databasePool.query(`
    UPDATE ${table("admin_notification_user_states")}
    SET email_status = 'skipped', next_email_attempt_at = NULL,
      email_lease_started_at = NULL, email_error_code = $3, updated_at = $4::timestamp
    WHERE notification_id = $1 AND user_id = $2 AND email_status = 'sending'
  `, [candidate.notificationId, candidate.userId, reason, utcTimestamp(now)]);
}

export async function processNextAdminRequestNotificationEmail(
  deps = defaultAdminRequestNotificationWorkerDependencies,
  leaseMs = 60_000,
) {
  if (!deps.processingEnabled) return false;
  const candidate = await claimNextEmail(deps, leaseMs);
  if (!candidate) return false;
  const table = tableFactory();
  const recipient = await deps.databasePool.query<{
    is_active: boolean;
    channel_enabled: boolean;
    user_status: string;
  }>(`
    SELECT recipient.is_active,
      CASE WHEN $3 = 'new_request' THEN recipient.new_request_email ELSE recipient.pending_reminder_email END AS channel_enabled,
      user_account.status AS user_status
    FROM ${table("location_request_notification_recipients")} recipient
    INNER JOIN ${table("users")} user_account ON user_account.id = recipient.user_id
    WHERE recipient.location_id = $1 AND recipient.user_id = $2
  `, [candidate.locationId, candidate.userId, candidate.notificationType]);
  const context = await loadCanonicalAuthContext(deps.databasePool, candidate.userId, { requireActive: false });
  const authorized = recipient.rows[0]?.is_active
    && recipient.rows[0]?.channel_enabled
    && recipient.rows[0]?.user_status === "active"
    && context?.user.isActive
    && hasCapabilityAtLocation(context.access, "appointments.manage_team", candidate.locationId);
  if (!authorized) {
    await skipEmail(deps, candidate, "RECIPIENT_NOT_AUTHORIZED");
    return true;
  }
  let result: EmailDeliveryResult;
  try {
    result = await deps.sendEmail({
      recipientEmail: candidate.recipientEmail,
      recipientName: candidate.recipientName,
      locationName: candidate.locationName,
      locationTimeZone: candidate.locationTimeZone,
      requestId: candidate.requestId,
      locationId: candidate.locationId,
      customerName: candidate.customerName,
      serviceNames: candidate.serviceNames,
      requestedStartTime: candidate.requestedStartTime,
      notificationType: candidate.notificationType,
      idempotencyKey: `${candidate.eventKey}:user:${candidate.userId}:email`,
    });
  } catch {
    result = { sent: false, providerMessageId: null, errorCode: "EMAIL_UNEXPECTED_ERROR" };
  }
  await finishEmail(deps, candidate, result);
  return true;
}

export async function processPendingAdminRequestNotificationEmails(
  deps = defaultAdminRequestNotificationWorkerDependencies,
) {
  if (!deps.processingEnabled) return 0;
  let processed = 0;
  for (let count = 0; count < 25; count += 1) {
    const prepared = await prepareDueAdminRequestNotificationEmails(deps);
    const delivered = await processNextAdminRequestNotificationEmail(deps);
    if (!prepared && !delivered) break;
    if (delivered) processed += 1;
  }
  return processed;
}

export function startAdminRequestNotificationWorker(
  intervalMs = Number(process.env.STAFF_REQUEST_EMAIL_POLL_INTERVAL_MS || 10_000),
  deps = defaultAdminRequestNotificationWorkerDependencies,
  enabled = staffRequestEmailsEnabled,
) {
  if (!enabled) return () => undefined;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processPendingAdminRequestNotificationEmails(deps);
    } catch (error) {
      console.error("Staff request notification worker tick failed:", error instanceof Error ? error.name : "UnknownError");
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
