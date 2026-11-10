import type { Pool, PoolClient } from "pg";
import type {
  AdminNotificationFeed,
  AdminNotificationItem,
  AdminNotificationType,
  RequestNotificationSettingsInput,
  RequestNotificationSettingsResponse,
} from "@shared/admin-notifications";
import { hasCapabilityAtLocation } from "@shared/auth";
import { calendarDateTimeToInstant, getCalendarDateInTimeZone } from "./calendar-timezone";
import { loadCanonicalAuthContext } from "./auth-runtime";
import { serializeSafeAuditMetadata } from "./audit-log-security";
import { staffRequestEmailsEnabled } from "./runtime-environment";

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function tableFactory(schema = process.env.DATABASE_SCHEMA?.trim() || "public") {
  return (name: string) => `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function utcTimestamp(value: Date) {
  return value.toISOString().replace("T", " ").replace("Z", "");
}

function addCalendarDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function instantForLocalTime(dateKey: string, time: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return calendarDateTimeToInstant({ year, month, day, hour, minute, second: 0 }, timeZone);
}

type NotificationSettingsRow = {
  email_enabled: boolean;
  reminder_enabled: boolean;
  reminder_delay_minutes: number;
  respect_opening_hours: boolean;
};

async function loadSettingsWithClient(
  client: PoolClient,
  locationId: number,
  table = tableFactory(),
): Promise<NotificationSettingsRow> {
  const result = await client.query<NotificationSettingsRow>(`
    SELECT email_enabled, reminder_enabled, reminder_delay_minutes, respect_opening_hours
    FROM ${table("location_request_notification_settings")}
    WHERE location_id = $1
  `, [locationId]);
  return result.rows[0] ?? {
    email_enabled: false,
    reminder_enabled: false,
    reminder_delay_minutes: 30,
    respect_opening_hours: true,
  };
}

async function resolveReminderAvailableAt(
  client: PoolClient,
  locationId: number,
  createdAt: Date,
  settings: NotificationSettingsRow,
  table = tableFactory(),
) {
  const dueAt = new Date(createdAt.getTime() + settings.reminder_delay_minutes * 60_000);
  if (!settings.respect_opening_hours) return dueAt;

  const location = await client.query<{ timezone: string }>(`
    SELECT timezone FROM ${table("locations")} WHERE id = $1
  `, [locationId]);
  const timeZone = location.rows[0]?.timezone || "Europe/Lisbon";
  const availability = await client.query<{
    day_of_week: number;
    start_time: string;
    end_time: string;
  }>(`
    SELECT day_of_week, start_time, end_time
    FROM ${table("shop_availability")}
    WHERE location_id = $1 AND is_open = true
    ORDER BY day_of_week, start_time, end_time
  `, [locationId]);
  if (availability.rows.length === 0) return dueAt;

  const firstDate = getCalendarDateInTimeZone(dueAt, timeZone);
  for (let offset = 0; offset <= 14; offset += 1) {
    const dateKey = addCalendarDays(firstDate, offset);
    const [year, month, day] = dateKey.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    for (const period of availability.rows.filter((row) => row.day_of_week === weekday)) {
      const start = instantForLocalTime(dateKey, period.start_time, timeZone);
      const end = instantForLocalTime(dateKey, period.end_time, timeZone);
      if (end.getTime() <= dueAt.getTime()) continue;
      if (dueAt.getTime() >= start.getTime() && dueAt.getTime() < end.getTime()) return dueAt;
      if (start.getTime() > dueAt.getTime()) return start;
    }
  }
  return dueAt;
}

export async function insertNewRequestAdminNotificationsWithClient(
  client: PoolClient,
  input: { requestId: number; locationId: number; revision: number; createdAt: Date },
  options: { externalEmailEnabled?: boolean } = {},
) {
  const table = tableFactory();
  const settings = await loadSettingsWithClient(client, input.locationId, table);
  const externalEmailEnabled = options.externalEmailEnabled ?? staffRequestEmailsEnabled;
  const emailDeliveryEnabled = externalEmailEnabled && settings.email_enabled;
  await client.query(`
    INSERT INTO ${table("admin_notifications")} (
      location_id, appointment_request_id, notification_type, event_key,
      available_at, email_delivery_enabled
    ) VALUES ($1, $2, 'new_request', $3, $4, $5)
    ON CONFLICT (event_key) DO NOTHING
  `, [
    input.locationId,
    input.requestId,
    `appointment-request:${input.requestId}:admin:new:${input.revision}`,
    utcTimestamp(input.createdAt),
    emailDeliveryEnabled,
  ]);

  if (!settings.reminder_enabled) return;
  const availableAt = await resolveReminderAvailableAt(
    client,
    input.locationId,
    input.createdAt,
    settings,
    table,
  );
  await client.query(`
    INSERT INTO ${table("admin_notifications")} (
      location_id, appointment_request_id, notification_type, event_key,
      available_at, email_delivery_enabled
    ) VALUES ($1, $2, 'pending_reminder', $3, $4, $5)
    ON CONFLICT (event_key) DO NOTHING
  `, [
    input.locationId,
    input.requestId,
    `appointment-request:${input.requestId}:admin:pending-reminder:${input.revision}`,
    utcTimestamp(availableAt),
    emailDeliveryEnabled,
  ]);
}

export async function cancelPendingRequestRemindersWithClient(
  client: PoolClient,
  requestId: number,
  now = new Date(),
) {
  const table = tableFactory();
  await client.query(`
    UPDATE ${table("admin_notifications")}
    SET cancelled_at = COALESCE(cancelled_at, $2::timestamp)
    WHERE appointment_request_id = $1
      AND notification_type = 'pending_reminder'
      AND cancelled_at IS NULL
  `, [requestId, utcTimestamp(now)]);
}

export async function schedulePendingRequestReminderWithClient(
  client: PoolClient,
  input: { requestId: number; locationId: number; revision: number; now: Date },
  options: { externalEmailEnabled?: boolean } = {},
) {
  const table = tableFactory();
  const settings = await loadSettingsWithClient(client, input.locationId, table);
  if (!settings.reminder_enabled) return;
  const availableAt = await resolveReminderAvailableAt(client, input.locationId, input.now, settings, table);
  const emailDeliveryEnabled = (options.externalEmailEnabled ?? staffRequestEmailsEnabled)
    && settings.email_enabled;
  await client.query(`
    INSERT INTO ${table("admin_notifications")} (
      location_id, appointment_request_id, notification_type, event_key,
      available_at, email_delivery_enabled
    ) VALUES ($1, $2, 'pending_reminder', $3, $4, $5)
    ON CONFLICT (event_key) DO NOTHING
  `, [
    input.locationId,
    input.requestId,
    `appointment-request:${input.requestId}:admin:pending-reminder:${input.revision}`,
    utcTimestamp(availableAt),
    emailDeliveryEnabled,
  ]);
}

function mapNotificationRow(row: Record<string, unknown>): AdminNotificationItem {
  const services = Array.isArray(row.services) ? row.services : [];
  return {
    id: Number(row.id),
    locationId: Number(row.location_id),
    requestId: Number(row.appointment_request_id),
    type: row.notification_type as AdminNotificationType,
    customerName: String(row.customer_name),
    requestedStartTime: new Date(row.requested_start_time as string | Date).toISOString(),
    services: services.map((service) => ({
      name: String((service as { name?: unknown }).name ?? "Serviço"),
      professionalName: String((service as { professionalName?: unknown }).professionalName ?? "Profissional"),
    })),
    availableAt: new Date(row.available_at as string | Date).toISOString(),
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    readAt: row.read_at ? new Date(row.read_at as string | Date).toISOString() : null,
  };
}

export async function getAdminNotificationFeed(
  databasePool: Pool,
  locationId: number,
  userId: number,
  limit = 20,
  now = new Date(),
): Promise<AdminNotificationFeed> {
  const table = tableFactory();
  const visiblePredicate = `
    notification.location_id = $1
    AND notification.available_at <= $3::timestamp
    AND notification.cancelled_at IS NULL
    AND (notification.notification_type <> 'pending_reminder' OR request.status = 'pending')
  `;
  const [items, unread, pending] = await Promise.all([
    databasePool.query(`
      SELECT notification.id, notification.location_id, notification.appointment_request_id,
        notification.notification_type, notification.available_at, notification.created_at,
        request.customer_name, request.requested_start_time, state.read_at,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', segment.service_name_snapshot,
            'professionalName', COALESCE(NULLIF(btrim(professional.name), ''), 'Profissional')
          ) ORDER BY segment.position)
          FROM ${table("appointment_request_segments")} segment
          LEFT JOIN ${table("barbers")} professional ON professional.id = segment.barber_id
          WHERE segment.request_id = request.id
        ), '[]'::jsonb) AS services
      FROM ${table("admin_notifications")} notification
      INNER JOIN ${table("appointment_requests")} request
        ON request.id = notification.appointment_request_id
      LEFT JOIN ${table("admin_notification_user_states")} state
        ON state.notification_id = notification.id AND state.user_id = $2
      WHERE ${visiblePredicate}
      ORDER BY notification.available_at DESC, notification.id DESC
      LIMIT $4
    `, [locationId, userId, utcTimestamp(now), limit]),
    databasePool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM ${table("admin_notifications")} notification
      INNER JOIN ${table("appointment_requests")} request
        ON request.id = notification.appointment_request_id
      LEFT JOIN ${table("admin_notification_user_states")} state
        ON state.notification_id = notification.id AND state.user_id = $2
      WHERE ${visiblePredicate} AND state.read_at IS NULL
    `, [locationId, userId, utcTimestamp(now)]),
    databasePool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM ${table("appointment_requests")}
      WHERE location_id = $1 AND status = 'pending'
    `, [locationId]),
  ]);
  return {
    items: items.rows.map((row) => mapNotificationRow(row as Record<string, unknown>)),
    unreadCount: Number(unread.rows[0]?.count ?? 0),
    pendingDecisionCount: Number(pending.rows[0]?.count ?? 0),
  };
}

export async function markAdminNotificationRead(
  databasePool: Pool,
  locationId: number,
  userId: number,
  notificationId: number,
  now = new Date(),
) {
  const table = tableFactory();
  const result = await databasePool.query<{ id: number }>(`
    WITH visible AS (
      SELECT id FROM ${table("admin_notifications")}
      WHERE id = $1 AND location_id = $2 AND cancelled_at IS NULL
    ), inserted AS (
      INSERT INTO ${table("admin_notification_user_states")} (
        notification_id, user_id, read_at, email_status, created_at, updated_at
      )
      SELECT id, $3, $4::timestamp, 'not_needed', $4::timestamp, $4::timestamp FROM visible
      ON CONFLICT (notification_id, user_id) DO UPDATE
      SET read_at = COALESCE(${table("admin_notification_user_states")}.read_at, EXCLUDED.read_at),
          updated_at = GREATEST(${table("admin_notification_user_states")}.updated_at, EXCLUDED.updated_at)
      RETURNING notification_id AS id
    ) SELECT id FROM inserted
  `, [notificationId, locationId, userId, utcTimestamp(now)]);
  return (result.rowCount ?? 0) > 0;
}

export async function markAllAdminNotificationsRead(
  databasePool: Pool,
  locationId: number,
  userId: number,
  now = new Date(),
) {
  const table = tableFactory();
  const result = await databasePool.query(`
    INSERT INTO ${table("admin_notification_user_states")} (
      notification_id, user_id, read_at, email_status, created_at, updated_at
    )
    SELECT notification.id, $2, $3::timestamp, 'not_needed', $3::timestamp, $3::timestamp
    FROM ${table("admin_notifications")} notification
    INNER JOIN ${table("appointment_requests")} request
      ON request.id = notification.appointment_request_id
    WHERE notification.location_id = $1
      AND notification.available_at <= $3::timestamp
      AND notification.cancelled_at IS NULL
      AND (notification.notification_type <> 'pending_reminder' OR request.status = 'pending')
    ON CONFLICT (notification_id, user_id) DO UPDATE
    SET read_at = COALESCE(${table("admin_notification_user_states")}.read_at, EXCLUDED.read_at),
        updated_at = GREATEST(${table("admin_notification_user_states")}.updated_at, EXCLUDED.updated_at)
  `, [locationId, userId, utcTimestamp(now)]);
  return result.rowCount ?? 0;
}

async function recipientOptions(
  databasePool: Pool | PoolClient,
  locationId: number,
) {
  const table = tableFactory();
  const users = await databasePool.query<{
    id: number;
    display_name: string;
    email: string;
    status: string;
    is_active: boolean | null;
    new_request_email: boolean | null;
    pending_reminder_email: boolean | null;
  }>(`
    SELECT user_account.id, user_account.display_name, user_account.email, user_account.status,
      recipient.is_active, recipient.new_request_email, recipient.pending_reminder_email
    FROM ${table("users")} user_account
    LEFT JOIN ${table("location_request_notification_recipients")} recipient
      ON recipient.user_id = user_account.id AND recipient.location_id = $1
    WHERE user_account.status = 'active' OR recipient.user_id IS NOT NULL
    ORDER BY lower(user_account.display_name), user_account.id
  `, [locationId]);
  const output = [];
  for (const user of users.rows) {
    const context = await loadCanonicalAuthContext(databasePool, user.id, { requireActive: false });
    const eligible = Boolean(context?.user.isActive
      && hasCapabilityAtLocation(context.access, "appointments.manage_team", locationId));
    output.push({
      userId: Number(user.id),
      displayName: user.display_name,
      email: user.email,
      eligible,
      configured: user.is_active !== null,
      isActive: user.is_active ?? false,
      newRequestEmail: user.new_request_email ?? true,
      pendingReminderEmail: user.pending_reminder_email ?? true,
    });
  }
  return output;
}

export async function getRequestNotificationSettings(
  databasePool: Pool,
  locationId: number,
): Promise<RequestNotificationSettingsResponse> {
  const table = tableFactory();
  const client = await databasePool.connect();
  try {
    const settings = await loadSettingsWithClient(client, locationId, table);
    return {
      emailEnabled: settings.email_enabled,
      reminderEnabled: settings.reminder_enabled,
      reminderDelayMinutes: settings.reminder_delay_minutes,
      respectOpeningHours: settings.respect_opening_hours,
      externalEmailRuntimeEnabled: staffRequestEmailsEnabled,
      recipients: await recipientOptions(client, locationId),
    };
  } finally {
    client.release();
  }
}

export async function updateRequestNotificationSettings(
  databasePool: Pool,
  locationId: number,
  input: RequestNotificationSettingsInput,
  actor: { userId: number; displayName: string },
) {
  const table = tableFactory();
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const location = await client.query(`SELECT id FROM ${table("locations")} WHERE id = $1 FOR SHARE`, [locationId]);
    if (!location.rowCount) throw new Error("Localização não encontrada.");

    const seen = new Set<number>();
    for (const recipient of input.recipients) {
      if (seen.has(recipient.userId)) throw new Error("O mesmo destinatário foi indicado mais do que uma vez.");
      seen.add(recipient.userId);
      const context = await loadCanonicalAuthContext(client, recipient.userId, { requireActive: false });
      const eligible = Boolean(context?.user.isActive
        && hasCapabilityAtLocation(context.access, "appointments.manage_team", locationId));
      if (recipient.isActive && !eligible) {
        throw new Error("Um dos destinatários não está ativo ou não pode gerir marcações nesta localização.");
      }
    }

    await client.query(`
      INSERT INTO ${table("location_request_notification_settings")} (
        location_id, email_enabled, reminder_enabled, reminder_delay_minutes,
        respect_opening_hours, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, now(), now())
      ON CONFLICT (location_id) DO UPDATE SET
        email_enabled = EXCLUDED.email_enabled,
        reminder_enabled = EXCLUDED.reminder_enabled,
        reminder_delay_minutes = EXCLUDED.reminder_delay_minutes,
        respect_opening_hours = EXCLUDED.respect_opening_hours,
        updated_at = now()
    `, [locationId, input.emailEnabled, input.reminderEnabled, input.reminderDelayMinutes, input.respectOpeningHours]);

    await client.query(`
      DELETE FROM ${table("location_request_notification_recipients")}
      WHERE location_id = $1 AND NOT (user_id = ANY($2::int[]))
    `, [locationId, Array.from(seen)]);
    for (const recipient of input.recipients) {
      await client.query(`
        INSERT INTO ${table("location_request_notification_recipients")} (
          location_id, user_id, is_active, new_request_email,
          pending_reminder_email, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, now(), now())
        ON CONFLICT (location_id, user_id) DO UPDATE SET
          is_active = EXCLUDED.is_active,
          new_request_email = EXCLUDED.new_request_email,
          pending_reminder_email = EXCLUDED.pending_reminder_email,
          updated_at = now()
      `, [locationId, recipient.userId, recipient.isActive, recipient.newRequestEmail, recipient.pendingReminderEmail]);
    }

    await client.query(`
      INSERT INTO ${table("audit_logs")} (
        actor_type, actor_id, actor_name, actor_user_id, location_id,
        action, entity_type, entity_id, summary, metadata
      ) VALUES ('admin', $1, $2, $1, $3, 'request_notifications.settings_updated',
        'location_request_notification_settings', $3,
        'Configuração de alertas de pedidos atualizada', $4)
    `, [
      actor.userId,
      actor.displayName,
      locationId,
      serializeSafeAuditMetadata({
        emailEnabled: input.emailEnabled,
        reminderEnabled: input.reminderEnabled,
        reminderDelayMinutes: input.reminderDelayMinutes,
        respectOpeningHours: input.respectOpeningHours,
        activeRecipientCount: input.recipients.filter((recipient) => recipient.isActive).length,
      }),
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return getRequestNotificationSettings(databasePool, locationId);
}
