import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  AppointmentRequestProposalResponseInput,
  AppointmentRequestProposalInput,
  AppointmentRequestRefusalInput,
  CreateAppointmentRequestInput,
} from "@shared/appointment-requests";
import type { AppointmentRequestStatus } from "@shared/schema";
import {
  MultiServiceAppointmentValidationError,
  planSequentialAppointmentServices,
  type MultiServiceSegmentTerms,
} from "@shared/multi-service-appointments";
import { serializeSafeAuditMetadata } from "./audit-log-security";
import {
  assertBeautyV2FeaturesEnabledWithClient,
  createSequentialAppointmentInTransaction,
  MultiServiceFeatureDisabledError,
  MultiServiceConflictError,
  MultiServiceScopeError,
  resolveAppointmentServiceTermsWithClient,
  type MultiServiceEngineOptions,
  type MultiServiceSelection,
} from "./multi-service-appointment-engine";

export type AppointmentRequestActor = {
  actorType: "admin" | "professional" | "client" | "system";
  actorId?: number | null;
  actorName?: string | null;
  actorUserId?: number | null;
  actorProfessionalId?: number | null;
};

export type AppointmentRequestEngineOptions = Pick<MultiServiceEngineOptions, "masterEnabled" | "businessVertical"> & {
  appointmentNotificationsEnabled?: boolean;
  responseTokenSecret?: string;
  now?: () => Date;
  afterAppointmentCreated?: (client: PoolClient, appointmentId: number) => Promise<void>;
};

type RequestRow = {
  id: number;
  location_id: number;
  status: AppointmentRequestStatus;
  revision: number;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string;
  whatsapp_opt_in: boolean;
  requested_start_time: Date;
  idempotency_key: string;
  request_fingerprint: string;
  appointment_id: number | null;
  refusal_reason: string | null;
  decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type SegmentRow = {
  id: number;
  request_id: number;
  position: number;
  service_id: number;
  barber_id: number;
  start_time: Date;
  duration_minutes: number;
  buffer_before_minutes_snapshot: number;
  buffer_after_minutes_snapshot: number;
  service_name_snapshot: string;
  service_price_cents_snapshot: number;
  created_at: Date;
};

type ProposalRow = {
  id: number;
  request_id: number;
  revision: number;
  proposed_start_time: Date;
  status: "active" | "accepted" | "rejected" | "replaced" | "expired" | "unavailable";
  response_token_hash: string;
  command_key: string;
  proposal_fingerprint: string;
  expires_at: Date;
  responded_at: Date | null;
  created_by_user_id: number | null;
  created_by_professional_id: number | null;
  created_at: Date;
};

export class AppointmentRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppointmentRequestError";
  }
}
export class AppointmentRequestAvailabilityError extends AppointmentRequestError {
  constructor() {
    super(409, "APPOINTMENT_REQUEST_TIME_UNAVAILABLE", "O horário deixou de estar disponível. É necessária outra proposta.");
  }
}

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe database identifier: ${identifier}`);
  return `"${identifier}"`;
}

function tableFactory() {
  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const schema = quoteIdentifier(schemaName);
  return (name: string) => `${schema}.${quoteIdentifier(name)}`;
}

function utcTimestamp(value: Date) {
  return value.toISOString().replace("T", " ").replace("Z", "");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableFingerprint(value: unknown) {
  return sha256(JSON.stringify(value));
}

function proposalToken(secret: string, requestId: number, revision: number, commandKey: string, fingerprint: string) {
  if (secret.length < 32) {
    throw new AppointmentRequestError(503, "APPOINTMENT_REQUEST_TOKEN_SECRET_INVALID", "A resposta segura a propostas não está configurada.");
  }
  return createHmac("sha256", secret)
    .update(`${requestId}:${revision}:${commandKey}:${fingerprint}`)
    .digest("base64url");
}

function tokenSecret(options: AppointmentRequestEngineOptions) {
  return options.responseTokenSecret ?? process.env.SESSION_SECRET ?? "";
}

function databaseCode(error: unknown) {
  let current = error;
  const visited = new Set<object>();
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

function isAvailabilityError(error: unknown) {
  return error instanceof MultiServiceConflictError
    || databaseCode(error) === "23P01"
    || (error instanceof MultiServiceAppointmentValidationError
      && error.code === "MULTI_SERVICE_OUTSIDE_AVAILABILITY");
}

function mapRequest(row: RequestRow, segments: SegmentRow[] = [], proposal?: ProposalRow | null) {
  return {
    id: Number(row.id),
    locationId: Number(row.location_id),
    status: row.status,
    revision: Number(row.revision),
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    whatsappOptIn: Boolean(row.whatsapp_opt_in),
    requestedStartTime: new Date(row.requested_start_time),
    appointmentId: row.appointment_id === null ? null : Number(row.appointment_id),
    refusalReason: row.refusal_reason,
    decidedAt: row.decided_at ? new Date(row.decided_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    segments: segments.map((segment) => ({
      id: Number(segment.id),
      position: Number(segment.position),
      serviceId: Number(segment.service_id),
      barberId: Number(segment.barber_id),
      startTime: new Date(segment.start_time),
      durationMinutes: Number(segment.duration_minutes),
      bufferBeforeMinutesSnapshot: Number(segment.buffer_before_minutes_snapshot),
      bufferAfterMinutesSnapshot: Number(segment.buffer_after_minutes_snapshot),
      serviceNameSnapshot: segment.service_name_snapshot,
      servicePriceCentsSnapshot: Number(segment.service_price_cents_snapshot),
    })),
    activeProposal: proposal ? {
      id: Number(proposal.id),
      revision: Number(proposal.revision),
      proposedStartTime: new Date(proposal.proposed_start_time),
      status: proposal.status,
      expiresAt: new Date(proposal.expires_at),
      createdAt: new Date(proposal.created_at),
    } : null,
  };
}

function segmentTerms(rows: SegmentRow[]): MultiServiceSegmentTerms[] {
  return rows.map((segment) => ({
    serviceId: Number(segment.service_id),
    barberId: Number(segment.barber_id),
    serviceName: segment.service_name_snapshot,
    priceCents: Number(segment.service_price_cents_snapshot),
    durationMinutes: Number(segment.duration_minutes),
    bufferBeforeMinutes: Number(segment.buffer_before_minutes_snapshot),
    bufferAfterMinutes: Number(segment.buffer_after_minutes_snapshot),
  }));
}

function selections(rows: SegmentRow[]): MultiServiceSelection[] {
  return rows.map((segment) => ({ serviceId: Number(segment.service_id), barberId: Number(segment.barber_id) }));
}

async function loadSegments(client: PoolClient, requestId: number, table: ReturnType<typeof tableFactory>) {
  const result = await client.query<SegmentRow>(`
    SELECT * FROM ${table("appointment_request_segments")}
    WHERE request_id = $1 ORDER BY position
  `, [requestId]);
  return result.rows;
}

async function loadRequest(client: PoolClient, requestId: number, table: ReturnType<typeof tableFactory>, lock = false) {
  const result = await client.query<RequestRow>(`
    SELECT * FROM ${table("appointment_requests")} WHERE id = $1${lock ? " FOR UPDATE" : ""}
  `, [requestId]);
  return result.rows[0];
}

async function loadActiveProposal(client: PoolClient, requestId: number, table: ReturnType<typeof tableFactory>, lock = false) {
  const result = await client.query<ProposalRow>(`
    SELECT * FROM ${table("appointment_request_proposals")}
    WHERE request_id = $1 AND status = 'active'
    ORDER BY revision DESC LIMIT 1${lock ? " FOR UPDATE" : ""}
  `, [requestId]);
  return result.rows[0] ?? null;
}

async function assertRequestFeature(
  client: PoolClient,
  locationId: number,
  serviceCount: number,
  options: AppointmentRequestEngineOptions,
  table: ReturnType<typeof tableFactory>,
) {
  try {
    await assertBeautyV2FeaturesEnabledWithClient(client, locationId, {
      masterEnabled: options.masterEnabled,
      businessVertical: options.businessVertical,
      requiredFeatures: serviceCount > 1
        ? ["appointmentRequests", "multiServiceAppointments"]
        : ["appointmentRequests"],
    }, table);
  } catch (error) {
    if (error instanceof MultiServiceFeatureDisabledError) {
      throw new AppointmentRequestError(
        404,
        "APPOINTMENT_REQUESTS_DISABLED",
        "Os pedidos de marcação não estão ativos nesta instalação.",
      );
    }
    throw error;
  }
}

async function insertHistory(
  client: PoolClient,
  table: ReturnType<typeof tableFactory>,
  input: {
    requestId: number;
    proposalId?: number | null;
    appointmentId?: number | null;
    eventType: string;
    actor: AppointmentRequestActor;
    fromStatus?: AppointmentRequestStatus | null;
    toStatus: AppointmentRequestStatus;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  await client.query(`
    INSERT INTO ${table("appointment_request_events")} (
      request_id, proposal_id, appointment_id, event_type, actor_type,
      actor_user_id, actor_professional_id, from_status, to_status, reason, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
  `, [
    input.requestId,
    input.proposalId ?? null,
    input.appointmentId ?? null,
    input.eventType,
    input.actor.actorType,
    input.actor.actorUserId ?? null,
    input.actor.actorProfessionalId ?? null,
    input.fromStatus ?? null,
    input.toStatus,
    input.reason ?? null,
    JSON.stringify(input.metadata ?? {}),
  ]);
}

async function insertAudit(
  client: PoolClient,
  table: ReturnType<typeof tableFactory>,
  request: Pick<RequestRow, "id" | "location_id" | "customer_name">,
  actor: AppointmentRequestActor,
  action: string,
  summary: string,
  metadata: Record<string, unknown>,
) {
  await client.query(`
    INSERT INTO ${table("audit_logs")} (
      actor_type, actor_id, actor_name, actor_user_id, actor_professional_id,
      location_id, action, entity_type, entity_id, summary, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'appointment_request', $8, $9, $10)
  `, [
    actor.actorType,
    actor.actorId ?? null,
    actor.actorName ?? null,
    actor.actorUserId ?? null,
    actor.actorProfessionalId ?? null,
    request.location_id,
    action,
    request.id,
    summary,
    serializeSafeAuditMetadata(metadata),
  ]);
}

async function insertPreparedNotification(
  client: PoolClient,
  table: ReturnType<typeof tableFactory>,
  input: {
    requestId: number;
    revision: number;
    eventType: string;
    eventKey: string;
    startTime: Date;
    payload?: Record<string, unknown>;
  },
) {
  await client.query(`
    INSERT INTO ${table("appointment_notification_events")} (
      appointment_request_id, event_type, event_revision, event_key,
      appointment_start_time, payload_snapshot,
      whatsapp_status, error_code, processing_completed_at,
      email_status, email_error_code
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'skipped', 'DELIVERY_NOT_ENABLED', now(), 'skipped', 'DELIVERY_NOT_ENABLED')
    ON CONFLICT DO NOTHING
  `, [
    input.requestId,
    input.eventType,
    input.revision,
    input.eventKey,
    utcTimestamp(input.startTime),
    JSON.stringify({ schemaVersion: 1, requestId: input.requestId, ...input.payload }),
  ]);
}

async function insertAppointmentConfirmation(
  client: PoolClient,
  table: ReturnType<typeof tableFactory>,
  appointmentId: number,
  startTime: Date,
) {
  await client.query(`UPDATE ${table("appointments")} SET notification_revision = 1 WHERE id = $1`, [appointmentId]);
  await client.query(`
    INSERT INTO ${table("appointment_notification_events")} (
      appointment_id, event_type, event_revision, event_key, appointment_start_time, new_start_time
    ) VALUES ($1, 'appointment_confirmation', 1, $2, $3, $3)
    ON CONFLICT DO NOTHING
  `, [appointmentId, `appointment:${appointmentId}:confirmation:1`, utcTimestamp(startTime)]);
}

async function createConfirmedAppointment(
  client: PoolClient,
  request: RequestRow,
  rows: SegmentRow[],
  startTime: Date,
  options: AppointmentRequestEngineOptions,
) {
  const terms = segmentTerms(rows);
  return createSequentialAppointmentInTransaction(client, {
    locationId: Number(request.location_id),
    startTime,
    customerName: request.customer_name,
    customerEmail: request.customer_email,
    customerPhone: request.customer_phone,
    whatsappOptIn: request.whatsapp_opt_in,
    cancelToken: randomUUID(),
    manualOutsideHours: false,
    services: selections(rows),
  }, {
    masterEnabled: options.masterEnabled,
    businessVertical: options.businessVertical,
    requiredFeatures: rows.length > 1
      ? ["appointmentRequests", "multiServiceAppointments"]
      : ["appointmentRequests"],
    minimumSegments: 1,
    termsSnapshot: terms,
    afterSegmentsInserted: options.afterAppointmentCreated,
  });
}

async function markAvailabilityConflict(
  client: PoolClient,
  table: ReturnType<typeof tableFactory>,
  request: RequestRow,
  actor: AppointmentRequestActor,
  proposal: ProposalRow | null,
  now: Date,
) {
  if (proposal) {
    await client.query(`
      UPDATE ${table("appointment_request_proposals")}
      SET status = 'unavailable' WHERE id = $1 AND status = 'active'
    `, [proposal.id]);
  }
  const nextRevision = request.revision + 1;
  await client.query(`
    UPDATE ${table("appointment_requests")}
    SET status = 'pending', revision = $2, updated_at = $3
    WHERE id = $1
  `, [request.id, nextRevision, utcTimestamp(now)]);
  await insertHistory(client, table, {
    requestId: request.id,
    proposalId: proposal?.id,
    eventType: proposal ? "proposal_unavailable" : "approval_conflict",
    actor,
    fromStatus: request.status,
    toStatus: "pending",
  });
  await insertAudit(client, table, request, actor, "appointment_request.availability_conflict",
    `Pedido de marcação requer outro horário: ${request.customer_name}`,
    { previousStatus: request.status, newStatus: "pending", proposalId: proposal?.id ?? null });
  await insertPreparedNotification(client, table, {
    requestId: request.id,
    revision: nextRevision,
    eventType: "appointment_request_time_unavailable",
    eventKey: `appointment-request:${request.id}:unavailable:${nextRevision}`,
    startTime: proposal?.proposed_start_time ?? request.requested_start_time,
    payload: { status: "pending", proposalId: proposal?.id ?? null },
  });
}

export async function createAppointmentRequestWithPool(
  databasePool: Pool,
  locationId: number,
  input: CreateAppointmentRequestInput,
  options: AppointmentRequestEngineOptions = {},
) {
  const table = tableFactory();
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await assertRequestFeature(client, locationId, input.services.length, options, table);
    const now = options.now?.() ?? new Date();
    if (input.startTime <= now) {
      throw new AppointmentRequestError(
        400,
        "APPOINTMENT_REQUEST_TIME_INVALID",
        "O horário pedido tem de ser futuro.",
      );
    }
    const location = await client.query(`
      SELECT id FROM ${table("locations")} WHERE id = $1 AND is_active = true FOR SHARE
    `, [locationId]);
    if (!location.rowCount) throw new MultiServiceScopeError("A localização não está disponível.");

    const terms = await resolveAppointmentServiceTermsWithClient(client, locationId, input.services, table);
    const plan = planSequentialAppointmentServices(input.startTime, terms, 1);
    const fingerprint = stableFingerprint({
      locationId,
      startTime: plan.startTime.toISOString(),
      customerName: input.customerName,
      customerEmail: input.customerEmail ?? null,
      customerPhone: input.customerPhone,
      whatsappOptIn: input.whatsappOptIn,
      services: input.services,
    });
    const existing = await client.query<RequestRow>(`
      SELECT * FROM ${table("appointment_requests")}
      WHERE location_id = $1 AND idempotency_key = $2 FOR UPDATE
    `, [locationId, input.idempotencyKey]);
    if (existing.rows[0]) {
      if (existing.rows[0].request_fingerprint !== fingerprint) {
        throw new AppointmentRequestError(409, "APPOINTMENT_REQUEST_IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada noutro pedido.");
      }
      const rows = await loadSegments(client, existing.rows[0].id, table);
      const proposal = await loadActiveProposal(client, existing.rows[0].id, table);
      await client.query("COMMIT");
      return { request: mapRequest(existing.rows[0], rows, proposal), reused: true };
    }

    const created = await client.query<RequestRow>(`
      INSERT INTO ${table("appointment_requests")} (
        location_id, customer_name, customer_email, customer_phone, whatsapp_opt_in,
        requested_start_time, idempotency_key, request_fingerprint
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (location_id, idempotency_key) DO NOTHING
      RETURNING *
    `, [
      locationId,
      input.customerName.trim(),
      input.customerEmail?.trim() || null,
      input.customerPhone.trim(),
      input.whatsappOptIn,
      utcTimestamp(plan.startTime),
      input.idempotencyKey,
      fingerprint,
    ]);
    if (!created.rows[0]) {
      const concurrent = await client.query<RequestRow>(`
        SELECT * FROM ${table("appointment_requests")}
        WHERE location_id = $1 AND idempotency_key = $2
      `, [locationId, input.idempotencyKey]);
      const request = concurrent.rows[0];
      if (!request || request.request_fingerprint !== fingerprint) {
        throw new AppointmentRequestError(409, "APPOINTMENT_REQUEST_IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada noutro pedido.");
      }
      const rows = await loadSegments(client, request.id, table);
      const proposal = await loadActiveProposal(client, request.id, table);
      await client.query("COMMIT");
      return { request: mapRequest(request, rows, proposal), reused: true };
    }
    const request = created.rows[0];
    const insertedSegments: SegmentRow[] = [];
    for (const segment of plan.segments) {
      const result = await client.query<SegmentRow>(`
        INSERT INTO ${table("appointment_request_segments")} (
          request_id, position, service_id, barber_id, start_time, duration_minutes,
          buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
          service_name_snapshot, service_price_cents_snapshot
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `, [
        request.id,
        segment.position,
        segment.serviceId,
        segment.barberId,
        utcTimestamp(segment.startTime),
        segment.durationMinutes,
        segment.bufferBeforeMinutesSnapshot,
        segment.bufferAfterMinutesSnapshot,
        segment.serviceNameSnapshot,
        segment.servicePriceCentsSnapshot,
      ]);
      insertedSegments.push(result.rows[0]);
    }
    const clientActor: AppointmentRequestActor = {
      actorType: "client",
      actorName: request.customer_name,
    };
    await insertHistory(client, table, {
      requestId: request.id,
      eventType: "request_created",
      actor: clientActor,
      toStatus: "pending",
      metadata: { serviceCount: insertedSegments.length },
    });
    await insertAudit(client, table, request, clientActor, "appointment_request.created",
      `Pedido de marcação recebido: ${request.customer_name}`,
      { status: "pending", serviceCount: insertedSegments.length });
    await insertPreparedNotification(client, table, {
      requestId: request.id,
      revision: request.revision,
      eventType: "appointment_request_received",
      eventKey: `appointment-request:${request.id}:received:${request.revision}`,
      startTime: request.requested_start_time,
      payload: { status: "pending", serviceCount: insertedSegments.length },
    });
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("COMMIT");
    return { request: mapRequest(request, insertedSegments), reused: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
export async function listAppointmentRequestsWithPool(
  databasePool: Pool,
  locationId: number,
  status?: AppointmentRequestStatus,
  options: AppointmentRequestEngineOptions = {},
) {
  const table = tableFactory();
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await assertRequestFeature(client, locationId, 1, options, table);
    const result = await client.query<RequestRow>(`
      SELECT * FROM ${table("appointment_requests")}
      WHERE location_id = $1 AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC, id DESC
    `, [locationId, status ?? null]);
    const mapped = [];
    for (const request of result.rows) {
      mapped.push(mapRequest(
        request,
        await loadSegments(client, request.id, table),
        await loadActiveProposal(client, request.id, table),
      ));
    }
    await client.query("COMMIT");
    return mapped;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getAppointmentRequestWithPool(
  databasePool: Pool,
  requestId: number,
  locationId: number,
  options: AppointmentRequestEngineOptions = {},
) {
  const table = tableFactory();
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await assertRequestFeature(client, locationId, 1, options, table);
    const request = await loadRequest(client, requestId, table);
    if (!request || request.location_id !== locationId) return null;
    const rows = await loadSegments(client, request.id, table);
    const proposal = await loadActiveProposal(client, request.id, table);
    const history = await client.query(`
      SELECT id, proposal_id, appointment_id, event_type, actor_type,
        from_status, to_status, reason, metadata, created_at
      FROM ${table("appointment_request_events")}
      WHERE request_id = $1 ORDER BY created_at, id
    `, [request.id]);
    await client.query("COMMIT");
    return { ...mapRequest(request, rows, proposal), history: history.rows };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function approveLockedRequest(
  client: PoolClient,
  table: ReturnType<typeof tableFactory>,
  request: RequestRow,
  rows: SegmentRow[],
  actor: AppointmentRequestActor,
  startTime: Date,
  proposal: ProposalRow | null,
  options: AppointmentRequestEngineOptions,
) {
  const now = options.now?.() ?? new Date();
  if (startTime <= now) {
    await markAvailabilityConflict(client, table, request, actor, proposal, now);
    return { conflict: true as const };
  }
  await client.query("SAVEPOINT appointment_request_confirmation");
  try {
    const created = await createConfirmedAppointment(client, request, rows, startTime, options);
    const nextRevision = request.revision + 1;
    if (proposal) {
      await client.query(`
        UPDATE ${table("appointment_request_proposals")}
        SET status = 'accepted', responded_at = $2
        WHERE id = $1 AND status = 'active'
      `, [proposal.id, utcTimestamp(now)]);
    }
    const updated = await client.query<RequestRow>(`
      UPDATE ${table("appointment_requests")}
      SET status = 'approved', revision = $2, appointment_id = $3,
        decided_at = $4, updated_at = $4
      WHERE id = $1 RETURNING *
    `, [request.id, nextRevision, created.appointment.id, utcTimestamp(now)]);
    await insertHistory(client, table, {
      requestId: request.id,
      proposalId: proposal?.id,
      appointmentId: created.appointment.id,
      eventType: proposal ? "proposal_accepted" : "request_approved",
      actor,
      fromStatus: request.status,
      toStatus: "approved",
    });
    await insertAudit(client, table, request, actor,
      proposal ? "appointment_request.proposal_accepted" : "appointment_request.approved",
      `Pedido de marcação aprovado: ${request.customer_name}`,
      { previousStatus: request.status, newStatus: "approved", appointmentId: created.appointment.id, proposalId: proposal?.id ?? null });
    await insertPreparedNotification(client, table, {
      requestId: request.id,
      revision: nextRevision,
      eventType: proposal ? "appointment_request_proposal_accepted" : "appointment_request_approved",
      eventKey: `appointment-request:${request.id}:${proposal ? "proposal-accepted" : "approved"}:${nextRevision}`,
      startTime,
      payload: { status: "approved", appointmentId: created.appointment.id, proposalId: proposal?.id ?? null },
    });
    if (options.appointmentNotificationsEnabled) {
      await insertAppointmentConfirmation(client, table, created.appointment.id, startTime);
    }
    await client.query("RELEASE SAVEPOINT appointment_request_confirmation");
    return { request: mapRequest(updated.rows[0], rows), appointment: created.appointment, reused: false };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT appointment_request_confirmation");
    if (!isAvailabilityError(error)) throw error;
    await markAvailabilityConflict(client, table, request, actor, proposal, now);
    return { conflict: true as const };
  }
}

export async function approveAppointmentRequestWithPool(
  databasePool: Pool,
  requestId: number,
  locationId: number,
  actor: AppointmentRequestActor,
  options: AppointmentRequestEngineOptions = {},
) {
  const table = tableFactory();
  const client = await databasePool.connect();
  let conflict = false;
  try {
    await client.query("BEGIN");
    const request = await loadRequest(client, requestId, table, true);
    if (!request || request.location_id !== locationId) throw new AppointmentRequestError(404, "APPOINTMENT_REQUEST_NOT_FOUND", "Pedido não encontrado.");
    const rows = await loadSegments(client, request.id, table);
    await assertRequestFeature(client, locationId, rows.length, options, table);
    if (request.status === "approved") {
      await client.query("COMMIT");
      return { request: mapRequest(request, rows), appointment: { id: request.appointment_id! }, reused: true };
    }
    if (request.status !== "pending") {
      throw new AppointmentRequestError(409, "APPOINTMENT_REQUEST_TRANSITION_INVALID", "Este pedido não pode ser aprovado no estado atual.");
    }
    const result = await approveLockedRequest(
      client, table, request, rows, actor, new Date(request.requested_start_time), null, options,
    );
    conflict = "conflict" in result;
    await client.query("COMMIT");
    if (conflict) throw new AppointmentRequestAvailabilityError();
    return result;
  } catch (error) {
    if (!conflict) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function refuseAppointmentRequestWithPool(
  databasePool: Pool,
  requestId: number,
  locationId: number,
  input: AppointmentRequestRefusalInput,
  actor: AppointmentRequestActor,
  options: AppointmentRequestEngineOptions = {},
) {
  const table = tableFactory();
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const request = await loadRequest(client, requestId, table, true);
    if (!request || request.location_id !== locationId) throw new AppointmentRequestError(404, "APPOINTMENT_REQUEST_NOT_FOUND", "Pedido não encontrado.");
    const rows = await loadSegments(client, request.id, table);
    await assertRequestFeature(client, locationId, rows.length, options, table);
    if (request.status === "refused") {
      await client.query("COMMIT");
      return { request: mapRequest(request, rows), reused: true };
    }
    if (request.status === "approved") {
      throw new AppointmentRequestError(409, "APPOINTMENT_REQUEST_TRANSITION_INVALID", "Uma marcação aprovada não pode ser recusada.");
    }
    const now = options.now?.() ?? new Date();
    const proposal = await loadActiveProposal(client, request.id, table, true);
    if (proposal) {
      await client.query(`UPDATE ${table("appointment_request_proposals")} SET status = 'replaced' WHERE id = $1`, [proposal.id]);
    }
    const nextRevision = request.revision + 1;
    const updated = await client.query<RequestRow>(`
      UPDATE ${table("appointment_requests")}
      SET status = 'refused', revision = $2, refusal_reason = $3,
        decided_at = $4, updated_at = $4
      WHERE id = $1 RETURNING *
    `, [request.id, nextRevision, input.reason?.trim() || null, utcTimestamp(now)]);
    await insertHistory(client, table, {
      requestId: request.id,
      proposalId: proposal?.id,
      eventType: "request_refused",
      actor,
      fromStatus: request.status,
      toStatus: "refused",
      reason: input.reason?.trim() || null,
    });
    await insertAudit(client, table, request, actor, "appointment_request.refused",
      `Pedido de marcação recusado: ${request.customer_name}`,
      { previousStatus: request.status, newStatus: "refused", reasonProvided: Boolean(input.reason?.trim()) });
    await insertPreparedNotification(client, table, {
      requestId: request.id,
      revision: nextRevision,
      eventType: "appointment_request_refused",
      eventKey: `appointment-request:${request.id}:refused:${nextRevision}`,
      startTime: request.requested_start_time,
      payload: { status: "refused", reasonProvided: Boolean(input.reason?.trim()) },
    });
    await client.query("COMMIT");
    return { request: mapRequest(updated.rows[0], rows), reused: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function proposeAppointmentRequestTimeWithPool(
  databasePool: Pool,
  requestId: number,
  locationId: number,
  input: AppointmentRequestProposalInput,
  actor: AppointmentRequestActor,
  options: AppointmentRequestEngineOptions = {},
) {
  const table = tableFactory();
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const request = await loadRequest(client, requestId, table, true);
    if (!request || request.location_id !== locationId) throw new AppointmentRequestError(404, "APPOINTMENT_REQUEST_NOT_FOUND", "Pedido não encontrado.");
    const rows = await loadSegments(client, request.id, table);
    await assertRequestFeature(client, locationId, rows.length, options, table);
    if (!(["pending", "proposed"] as AppointmentRequestStatus[]).includes(request.status)) {
      throw new AppointmentRequestError(409, "APPOINTMENT_REQUEST_TRANSITION_INVALID", "Este pedido já tem uma decisão final.");
    }
    const now = options.now?.() ?? new Date();
    if (input.startTime <= now || input.expiresAt <= now || input.expiresAt > new Date(now.getTime() + 30 * 86_400_000)) {
      throw new AppointmentRequestError(400, "APPOINTMENT_REQUEST_PROPOSAL_TIME_INVALID", "A proposta ou a sua validade não é válida.");
    }
    const fingerprint = stableFingerprint({ startTime: input.startTime.toISOString(), expiresAt: input.expiresAt.toISOString() });
    const duplicate = await client.query<ProposalRow>(`
      SELECT * FROM ${table("appointment_request_proposals")}
      WHERE request_id = $1 AND command_key = $2
    `, [request.id, input.commandKey]);
    if (duplicate.rows[0]) {
      if (duplicate.rows[0].proposal_fingerprint !== fingerprint) {
        throw new AppointmentRequestError(409, "APPOINTMENT_REQUEST_IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada noutra proposta.");
      }
      const token = proposalToken(tokenSecret(options), request.id, duplicate.rows[0].revision, input.commandKey, fingerprint);
      await client.query("COMMIT");
      return { request: mapRequest(request, rows, duplicate.rows[0]), proposal: mapRequest(request, rows, duplicate.rows[0]).activeProposal, responseToken: token, reused: true };
    }
    const active = await loadActiveProposal(client, request.id, table, true);
    if (active) {
      await client.query(`UPDATE ${table("appointment_request_proposals")} SET status = 'replaced' WHERE id = $1`, [active.id]);
      await insertHistory(client, table, {
        requestId: request.id,
        proposalId: active.id,
        eventType: "proposal_replaced",
        actor,
        fromStatus: request.status,
        toStatus: "proposed",
      });
    }
    const nextRevision = request.revision + 1;
    const token = proposalToken(tokenSecret(options), request.id, nextRevision, input.commandKey, fingerprint);
    const created = await client.query<ProposalRow>(`
      INSERT INTO ${table("appointment_request_proposals")} (
        request_id, revision, proposed_start_time, response_token_hash,
        command_key, proposal_fingerprint, expires_at,
        created_by_user_id, created_by_professional_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      request.id,
      nextRevision,
      utcTimestamp(input.startTime),
      sha256(token),
      input.commandKey,
      fingerprint,
      utcTimestamp(input.expiresAt),
      actor.actorUserId ?? null,
      actor.actorProfessionalId ?? null,
    ]);
    const proposal = created.rows[0];
    const updated = await client.query<RequestRow>(`
      UPDATE ${table("appointment_requests")}
      SET status = 'proposed', revision = $2, updated_at = $3
      WHERE id = $1 RETURNING *
    `, [request.id, nextRevision, utcTimestamp(now)]);
    await insertHistory(client, table, {
      requestId: request.id,
      proposalId: proposal.id,
      eventType: "proposal_created",
      actor,
      fromStatus: request.status,
      toStatus: "proposed",
      metadata: { proposedStartTime: input.startTime.toISOString(), expiresAt: input.expiresAt.toISOString() },
    });
    await insertAudit(client, table, request, actor, "appointment_request.proposed",
      `Novo horário proposto: ${request.customer_name}`,
      { previousStatus: request.status, newStatus: "proposed", proposalId: proposal.id });
    await insertPreparedNotification(client, table, {
      requestId: request.id,
      revision: nextRevision,
      eventType: "appointment_request_time_proposed",
      eventKey: `appointment-request:${request.id}:proposed:${nextRevision}`,
      startTime: input.startTime,
      payload: {
        status: "proposed",
        proposalId: proposal.id,
        expiresAt: input.expiresAt.toISOString(),
        responseEndpoint: "/api/appointment-request-proposals/respond",
        responseToken: token,
      },
    });
    await client.query("COMMIT");
    return {
      request: mapRequest(updated.rows[0], rows, proposal),
      proposal: mapRequest(updated.rows[0], rows, proposal).activeProposal,
      responseToken: token,
      reused: false,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function respondToAppointmentRequestProposalWithPool(
  databasePool: Pool,
  input: AppointmentRequestProposalResponseInput,
  options: AppointmentRequestEngineOptions = {},
) {
  const table = tableFactory();
  const client = await databasePool.connect();
  let committedConflict = false;
  try {
    await client.query("BEGIN");
    const proposalResult = await client.query<ProposalRow>(`
      SELECT * FROM ${table("appointment_request_proposals")}
      WHERE response_token_hash = $1 FOR UPDATE
    `, [sha256(input.token)]);
    const proposal = proposalResult.rows[0];
    if (!proposal) throw new AppointmentRequestError(404, "APPOINTMENT_REQUEST_PROPOSAL_NOT_FOUND", "A proposta não existe ou o link é inválido.");
    const request = await loadRequest(client, proposal.request_id, table, true);
    if (!request) throw new AppointmentRequestError(404, "APPOINTMENT_REQUEST_NOT_FOUND", "Pedido não encontrado.");
    const rows = await loadSegments(client, request.id, table);
    await assertRequestFeature(client, request.location_id, rows.length, options, table);
    if (proposal.status === "accepted" && request.status === "approved") {
      await client.query("COMMIT");
      return { request: mapRequest(request, rows), decision: "accepted" as const, reused: true };
    }
    if (proposal.status === "rejected") {
      await client.query("COMMIT");
      return { request: mapRequest(request, rows), decision: "rejected" as const, reused: true };
    }
    if (proposal.status !== "active" || request.status !== "proposed" || request.revision !== proposal.revision) {
      throw new AppointmentRequestError(409, "APPOINTMENT_REQUEST_PROPOSAL_STALE", "Esta proposta já foi substituída ou deixou de estar ativa.");
    }
    const now = options.now?.() ?? new Date();
    const clientActor: AppointmentRequestActor = { actorType: "client", actorName: request.customer_name };
    if (proposal.expires_at <= now) {
      await client.query(`
        UPDATE ${table("appointment_request_proposals")}
        SET status = 'expired', responded_at = $2 WHERE id = $1
      `, [proposal.id, utcTimestamp(now)]);
      const nextRevision = request.revision + 1;
      await client.query(`
        UPDATE ${table("appointment_requests")}
        SET status = 'pending', revision = $2, updated_at = $3 WHERE id = $1
      `, [request.id, nextRevision, utcTimestamp(now)]);
      await insertHistory(client, table, {
        requestId: request.id,
        proposalId: proposal.id,
        eventType: "proposal_expired",
        actor: clientActor,
        fromStatus: "proposed",
        toStatus: "pending",
      });
      await insertAudit(client, table, request, clientActor, "appointment_request.proposal_expired",
        `Proposta expirada: ${request.customer_name}`,
        { previousStatus: "proposed", newStatus: "pending", proposalId: proposal.id });
      await client.query("COMMIT");
      committedConflict = true;
      throw new AppointmentRequestError(410, "APPOINTMENT_REQUEST_PROPOSAL_EXPIRED", "Esta proposta expirou. Aguarde um novo horário.");
    }
    if (input.decision === "reject") {
      await client.query(`
        UPDATE ${table("appointment_request_proposals")}
        SET status = 'rejected', responded_at = $2 WHERE id = $1
      `, [proposal.id, utcTimestamp(now)]);
      const nextRevision = request.revision + 1;
      const updated = await client.query<RequestRow>(`
        UPDATE ${table("appointment_requests")}
        SET status = 'pending', revision = $2, updated_at = $3 WHERE id = $1 RETURNING *
      `, [request.id, nextRevision, utcTimestamp(now)]);
      await insertHistory(client, table, {
        requestId: request.id,
        proposalId: proposal.id,
        eventType: "proposal_rejected",
        actor: clientActor,
        fromStatus: "proposed",
        toStatus: "pending",
      });
      await insertAudit(client, table, request, clientActor, "appointment_request.proposal_rejected",
        `Proposta recusada pelo cliente: ${request.customer_name}`,
        { previousStatus: "proposed", newStatus: "pending", proposalId: proposal.id });
      await insertPreparedNotification(client, table, {
        requestId: request.id,
        revision: nextRevision,
        eventType: "appointment_request_proposal_rejected",
        eventKey: `appointment-request:${request.id}:proposal-rejected:${nextRevision}`,
        startTime: proposal.proposed_start_time,
        payload: { status: "pending", proposalId: proposal.id },
      });
      await client.query("COMMIT");
      return { request: mapRequest(updated.rows[0], rows), decision: "rejected" as const, reused: false };
    }
    const result = await approveLockedRequest(
      client,
      table,
      request,
      rows,
      clientActor,
      new Date(proposal.proposed_start_time),
      proposal,
      options,
    );
    committedConflict = "conflict" in result;
    await client.query("COMMIT");
    if (committedConflict) throw new AppointmentRequestAvailabilityError();
    return { ...result, decision: "accepted" as const };
  } catch (error) {
    if (!committedConflict) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function inspectAppointmentRequestProposalWithPool(
  databasePool: Pool,
  token: string,
  options: AppointmentRequestEngineOptions = {},
) {
  const table = tableFactory();
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const proposalResult = await client.query<ProposalRow>(`
      SELECT * FROM ${table("appointment_request_proposals")}
      WHERE response_token_hash = $1
    `, [sha256(token)]);
    const proposal = proposalResult.rows[0];
    if (!proposal) throw new AppointmentRequestError(404, "APPOINTMENT_REQUEST_PROPOSAL_NOT_FOUND", "A proposta não existe ou o link é inválido.");
    const request = await loadRequest(client, proposal.request_id, table);
    if (!request) throw new AppointmentRequestError(404, "APPOINTMENT_REQUEST_NOT_FOUND", "Pedido não encontrado.");
    const rows = await loadSegments(client, request.id, table);
    await assertRequestFeature(client, request.location_id, rows.length, options, table);
    await client.query("COMMIT");
    const expired = proposal.expires_at <= (options.now?.() ?? new Date());
    return {
      status: expired && proposal.status === "active" ? "expired" : proposal.status,
      requestStatus: request.status,
      proposedStartTime: new Date(proposal.proposed_start_time),
      expiresAt: new Date(proposal.expires_at),
      services: rows.map((row) => ({
        position: Number(row.position),
        name: row.service_name_snapshot,
        durationMinutes: Number(row.duration_minutes),
        priceCents: Number(row.service_price_cents_snapshot),
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
