import type { Pool, PoolClient } from "pg";
import {
  appointmentCommunicationEventTypes,
  type AppointmentCommunicationEventType,
  type AppointmentCommunicationFailure,
  type AppointmentManualContactMethod,
} from "@shared/appointment-communications";
import { serializeSafeAuditMetadata } from "./audit-log-security";
import { isBeautyV2FeatureEnabledWithClient } from "./multi-service-appointment-engine";
import { parseBeautyV2MasterSwitch } from "@shared/business/v2-features";

type FeatureOptions = {
  masterEnabled?: boolean;
  businessVertical?: string;
};

type ManualContactActor = {
  userId: number;
  displayName: string;
  actorType?: "admin" | "barber";
};

type FailureRow = {
  appointment_id: number;
  event_id: number;
  event_type: AppointmentCommunicationEventType;
  failed_at: Date | string;
  email_status: string;
  email_sent_at: Date | string | null;
  contacted_at: Date | string | null;
  contacted_by_user_id: number | null;
  contacted_by_name: string | null;
  contact_method: AppointmentManualContactMethod | null;
};

export class AppointmentCommunicationFollowupError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AppointmentCommunicationFollowupError";
  }
}

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function tableFactory(schema = process.env.DATABASE_SCHEMA?.trim() || "public") {
  return (name: string) => `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function canUseCommunicationFollowups(options: FeatureOptions) {
  if (process.env.USE_MEMORY_STORAGE?.trim().toLowerCase() === "true") return false;
  const masterEnabled = options.masterEnabled
    ?? parseBeautyV2MasterSwitch(process.env.BEAUTY_V2_FEATURES_ENABLED);
  const vertical = (options.businessVertical ?? process.env.BUSINESS_VERTICAL ?? "barber")
    .trim()
    .toLowerCase();
  return masterEnabled && vertical === "beauty";
}

function utcTimestamp(value: Date) {
  return value.toISOString().replace("T", " ").replace("Z", "");
}

function toIso(value: Date | string | null) {
  return value === null ? null : new Date(value).toISOString();
}

function mapFailureRow(row: FailureRow): AppointmentCommunicationFailure {
  return {
    eventId: Number(row.event_id),
    eventType: row.event_type,
    failedAt: new Date(row.failed_at).toISOString(),
    emailStatus: row.email_status,
    emailSentAt: toIso(row.email_sent_at),
    contactedAt: toIso(row.contacted_at),
    contactedByUserId: row.contacted_by_user_id === null ? null : Number(row.contacted_by_user_id),
    contactedByName: row.contacted_by_name,
    contactMethod: row.contact_method,
  };
}

async function featureEnabled(
  client: PoolClient,
  locationId: number,
  options: FeatureOptions,
  table: (name: string) => string,
) {
  return isBeautyV2FeatureEnabledWithClient(
    client,
    locationId,
    "notificationDeliveryStatus",
    options,
    table,
  );
}

export async function getAppointmentCommunicationFailures(
  databasePool: Pool,
  locationId: number,
  appointmentIds: readonly number[],
  options: FeatureOptions = {},
) {
  const ids = Array.from(new Set(appointmentIds.filter((id) => Number.isInteger(id) && id > 0)));
  const failures = new Map<number, AppointmentCommunicationFailure[]>();
  if (ids.length === 0) return failures;
  if (!canUseCommunicationFollowups(options)) return failures;

  const table = tableFactory();
  const client = await databasePool.connect();
  try {
    if (!await featureEnabled(client, locationId, options, table)) return failures;
    const result = await client.query<FailureRow>(`
      SELECT appointment.id AS appointment_id,
        event.id AS event_id,
        event.event_type,
        COALESCE(event.failed_at, event.updated_at, event.created_at) AS failed_at,
        event.email_status,
        event.email_sent_at,
        followup.contacted_at,
        followup.contacted_by_user_id,
        user_account.display_name AS contacted_by_name,
        followup.contact_method
      FROM ${table("appointment_notification_events")} event
      INNER JOIN ${table("appointments")} appointment
        ON appointment.id = event.appointment_id
      LEFT JOIN ${table("appointment_communication_followups")} followup
        ON followup.appointment_notification_event_id = event.id
      LEFT JOIN ${table("users")} user_account
        ON user_account.id = followup.contacted_by_user_id
      WHERE appointment.location_id = $1
        AND appointment.id = ANY($2::int[])
        AND event.whatsapp_status = 'failed'
        AND event.event_type = ANY($3::text[])
        AND event.event_revision = appointment.notification_revision
        AND event.appointment_start_time = appointment.start_time
        AND (
          (event.event_type = 'appointment_cancelled' AND appointment.status IN ('cancelled', 'late_cancelled'))
          OR (event.event_type <> 'appointment_cancelled' AND appointment.status NOT IN ('cancelled', 'late_cancelled'))
        )
      ORDER BY appointment.id, COALESCE(event.failed_at, event.updated_at, event.created_at), event.id
    `, [locationId, ids, appointmentCommunicationEventTypes]);
    for (const row of result.rows) {
      const appointmentId = Number(row.appointment_id);
      const current = failures.get(appointmentId) ?? [];
      current.push(mapFailureRow(row));
      failures.set(appointmentId, current);
    }
    return failures;
  } finally {
    client.release();
  }
}

export async function attachAppointmentCommunicationFailures<AppointmentRecord extends { id: number }>(
  databasePool: Pool,
  locationId: number,
  appointments: readonly AppointmentRecord[],
  options: FeatureOptions = {},
) {
  const failures = await getAppointmentCommunicationFailures(
    databasePool,
    locationId,
    appointments.map((appointment) => appointment.id),
    options,
  );
  return appointments.map((appointment) => ({
    ...appointment,
    communicationFailures: failures.get(appointment.id) ?? [],
  }));
}

export async function markAppointmentCommunicationContacted(
  databasePool: Pool,
  input: {
    locationId: number;
    appointmentId: number;
    eventId: number;
    contactMethod: AppointmentManualContactMethod;
    actor: ManualContactActor;
    now?: Date;
  },
  options: FeatureOptions = {},
) {
  if (!canUseCommunicationFollowups(options)) {
    throw new AppointmentCommunicationFollowupError(
      "O acompanhamento de falhas de comunicação não está ativo nesta localização.",
      "APPOINTMENT_COMMUNICATION_FOLLOWUPS_DISABLED",
      404,
    );
  }
  const table = tableFactory();
  const client = await databasePool.connect();
  const now = input.now ?? new Date();
  const timestamp = utcTimestamp(now);
  try {
    await client.query("BEGIN");
    if (!await featureEnabled(client, input.locationId, options, table)) {
      throw new AppointmentCommunicationFollowupError(
        "O acompanhamento de falhas de comunicação não está ativo nesta localização.",
        "APPOINTMENT_COMMUNICATION_FOLLOWUPS_DISABLED",
        404,
      );
    }

    const eligible = await client.query<{
      event_id: number;
      event_type: AppointmentCommunicationEventType;
    }>(`
      SELECT event.id AS event_id, event.event_type
      FROM ${table("appointment_notification_events")} event
      INNER JOIN ${table("appointments")} appointment
        ON appointment.id = event.appointment_id
      WHERE event.id = $1
        AND appointment.id = $2
        AND appointment.location_id = $3
        AND event.whatsapp_status = 'failed'
        AND event.event_type = ANY($4::text[])
        AND event.event_revision = appointment.notification_revision
        AND event.appointment_start_time = appointment.start_time
        AND (
          (event.event_type = 'appointment_cancelled' AND appointment.status IN ('cancelled', 'late_cancelled'))
          OR (event.event_type <> 'appointment_cancelled' AND appointment.status NOT IN ('cancelled', 'late_cancelled'))
        )
      FOR UPDATE OF event, appointment
    `, [input.eventId, input.appointmentId, input.locationId, appointmentCommunicationEventTypes]);
    const event = eligible.rows[0];
    if (!event) {
      throw new AppointmentCommunicationFollowupError(
        "A falha de comunicação não existe, já não é atual ou não pertence a esta localização.",
        "APPOINTMENT_COMMUNICATION_FAILURE_NOT_FOUND",
        404,
      );
    }

    const inserted = await client.query<{ event_id: number }>(`
      INSERT INTO ${table("appointment_communication_followups")} (
        appointment_notification_event_id, contacted_by_user_id, contact_method,
        contacted_at, created_at
      ) VALUES ($1, $2, $3, $4::timestamp, $4::timestamp)
      ON CONFLICT (appointment_notification_event_id) DO NOTHING
      RETURNING appointment_notification_event_id AS event_id
    `, [
      input.eventId,
      input.actor.userId,
      input.contactMethod,
      timestamp,
    ]);

    if (inserted.rowCount) {
      await client.query(`
        INSERT INTO ${table("audit_logs")} (
          actor_type, actor_id, actor_name, actor_user_id, location_id,
          action, entity_type, entity_id, summary, metadata, created_at
        ) VALUES ($1, $2, $3, $2, $4,
          'appointment.communication_manual_contact_recorded',
          'appointment_notification_event', $5,
          'Contacto manual após falha de WhatsApp registado.', $6, $7::timestamp)
      `, [
        input.actor.actorType ?? "admin",
        input.actor.userId,
        input.actor.displayName,
        input.locationId,
        input.eventId,
        serializeSafeAuditMetadata({
          appointmentId: input.appointmentId,
          notificationEventId: input.eventId,
          eventType: event.event_type,
          contactMethod: input.contactMethod,
        }),
        timestamp,
      ]);
    }

    const saved = await client.query<{
      contacted_at: Date | string;
      contacted_by_user_id: number;
      contacted_by_name: string;
      contact_method: AppointmentManualContactMethod;
    }>(`
      SELECT followup.contacted_at, followup.contacted_by_user_id,
        user_account.display_name AS contacted_by_name, followup.contact_method
      FROM ${table("appointment_communication_followups")} followup
      INNER JOIN ${table("users")} user_account
        ON user_account.id = followup.contacted_by_user_id
      WHERE followup.appointment_notification_event_id = $1
    `, [input.eventId]);
    await client.query("COMMIT");
    const followup = saved.rows[0];
    return {
      created: Boolean(inserted.rowCount),
      eventId: input.eventId,
      contactedAt: new Date(followup.contacted_at).toISOString(),
      contactedByUserId: Number(followup.contacted_by_user_id),
      contactedByName: followup.contacted_by_name,
      contactMethod: followup.contact_method,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
