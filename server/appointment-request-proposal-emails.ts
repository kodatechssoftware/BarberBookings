import type { Pool, PoolClient } from "pg";
import type { AppointmentRequestActor } from "./appointment-request-engine";
import {
  AppointmentRequestError,
  appointmentRequestProposalTokenHash,
  generateAppointmentRequestProposalToken,
} from "./appointment-request-engine";
import {
  sendAppointmentRequestProposalEmail,
  type AppointmentRequestProposalEmailParams,
  type EmailDeliveryResult,
} from "./email";
import { getPublicBaseUrl } from "./public-url";
import { serializeSafeAuditMetadata } from "./audit-log-security";
import { appointmentRequestProposalEmailsEnabled } from "./runtime-environment";
import { pool } from "./db";

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

type ProposalEmailCandidate = {
  proposalId: number;
  requestId: number;
  locationId: number;
  proposalRevision: number;
  deliveryRevision: number;
  attempts: number;
  commandKey: string;
  proposalFingerprint: string;
  responseTokenHash: string;
  customerName: string;
  customerEmail: string;
  requestedStartTime: Date;
  proposedStartTime: Date;
  expiresAt: Date;
  locationName: string;
  locationTimeZone: string;
  services: Array<{ name: string; durationMinutes: number }>;
};

export type AppointmentRequestProposalEmailWorkerDependencies = {
  databasePool: Pool;
  sendEmail: (params: AppointmentRequestProposalEmailParams) => Promise<EmailDeliveryResult>;
  processingEnabled: boolean;
  responseTokenSecret: string;
  publicBaseUrl: string;
  now: () => Date;
};

export const defaultAppointmentRequestProposalEmailWorkerDependencies: AppointmentRequestProposalEmailWorkerDependencies = {
  databasePool: pool,
  sendEmail: sendAppointmentRequestProposalEmail,
  processingEnabled: appointmentRequestProposalEmailsEnabled,
  responseTokenSecret: process.env.SESSION_SECRET?.trim() || "",
  publicBaseUrl: appointmentRequestProposalEmailsEnabled ? getPublicBaseUrl() : "",
  now: () => new Date(),
};

function tokenForProposal(input: {
  requestId: number;
  revision: number;
  commandKey: string;
  fingerprint: string;
  responseTokenHash: string;
}, secret: string) {
  const token = generateAppointmentRequestProposalToken(
    secret,
    input.requestId,
    input.revision,
    input.commandKey,
    input.fingerprint,
  );
  if (appointmentRequestProposalTokenHash(token) !== input.responseTokenHash) {
    throw new AppointmentRequestError(
      503,
      "APPOINTMENT_REQUEST_PROPOSAL_TOKEN_ROTATED",
      "A ligação segura desta proposta já não pode ser regenerada. Crie uma nova proposta.",
    );
  }
  return token;
}

function responseUrl(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/+$/, "")}/appointment-request/proposal#token=${encodeURIComponent(token)}`;
}

async function loadActiveProposalForAction(
  client: PoolClient,
  requestId: number,
  locationId: number,
  lock = false,
) {
  const table = tableFactory();
  const result = await client.query<{
    proposal_id: number;
    request_id: number;
    location_id: number;
    request_status: string;
    request_revision: number;
    revision: number;
    status: string;
    command_key: string;
    proposal_fingerprint: string;
    response_token_hash: string;
    customer_email: string | null;
    expires_at: Date;
    email_status: "disabled" | "missing" | "pending" | "sending" | "retry" | "sent" | "failed";
    email_delivery_revision: number;
  }>(`
    SELECT proposal.id AS proposal_id, request.id AS request_id, request.location_id,
      request.status AS request_status, request.revision AS request_revision,
      proposal.revision, proposal.status, proposal.command_key,
      proposal.proposal_fingerprint, proposal.response_token_hash, request.customer_email,
      proposal.expires_at,
      proposal.email_status, proposal.email_delivery_revision
    FROM ${table("appointment_requests")} request
    INNER JOIN ${table("appointment_request_proposals")} proposal
      ON proposal.request_id = request.id AND proposal.status = 'active'
    WHERE request.id = $1 AND request.location_id = $2
    ${lock ? "FOR UPDATE OF request, proposal" : ""}
  `, [requestId, locationId]);
  const row = result.rows[0];
  if (!row) throw new AppointmentRequestError(404, "APPOINTMENT_REQUEST_PROPOSAL_NOT_FOUND", "Não existe uma proposta ativa para este pedido.");
  if (row.request_status !== "proposed" || row.request_revision !== row.revision) {
    throw new AppointmentRequestError(409, "APPOINTMENT_REQUEST_PROPOSAL_STALE", "Esta proposta já não está disponível.");
  }
  return row;
}

async function insertCommunicationAudit(
  client: PoolClient,
  requestId: number,
  locationId: number,
  actor: AppointmentRequestActor,
  action: string,
  summary: string,
  metadata: Record<string, unknown>,
) {
  const table = tableFactory();
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
    locationId,
    action,
    requestId,
    summary,
    serializeSafeAuditMetadata(metadata),
  ]);
}

export async function getAppointmentRequestProposalSecureLink(
  databasePool: Pool,
  requestId: number,
  locationId: number,
  actor: AppointmentRequestActor,
  options: { responseTokenSecret?: string; publicBaseUrl?: string; now?: Date } = {},
) {
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const proposal = await loadActiveProposalForAction(client, requestId, locationId);
    if (new Date(proposal.expires_at) <= (options.now ?? new Date())) {
      throw new AppointmentRequestError(410, "APPOINTMENT_REQUEST_PROPOSAL_EXPIRED", "Esta proposta já expirou.");
    }
    const token = tokenForProposal({
      requestId: proposal.request_id,
      revision: proposal.revision,
      commandKey: proposal.command_key,
      fingerprint: proposal.proposal_fingerprint,
      responseTokenHash: proposal.response_token_hash,
    }, options.responseTokenSecret ?? (process.env.SESSION_SECRET?.trim() || ""));
    await insertCommunicationAudit(
      client,
      requestId,
      locationId,
      actor,
      "appointment_request.proposal_link_copied",
      "Ligação segura da proposta consultada.",
      { proposalId: proposal.proposal_id, proposalRevision: proposal.revision },
    );
    await client.query("COMMIT");
    return { url: responseUrl(options.publicBaseUrl ?? getPublicBaseUrl(), token) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function requeueAppointmentRequestProposalEmail(
  databasePool: Pool,
  requestId: number,
  locationId: number,
  actor: AppointmentRequestActor,
  options: { enabled?: boolean; now?: Date; responseTokenSecret?: string } = {},
) {
  if (!(options.enabled ?? appointmentRequestProposalEmailsEnabled)) {
    throw new AppointmentRequestError(409, "APPOINTMENT_REQUEST_PROPOSAL_EMAIL_DISABLED", "O envio de propostas por email está desativado.");
  }
  const table = tableFactory();
  const client = await databasePool.connect();
  const now = options.now ?? new Date();
  try {
    await client.query("BEGIN");
    const proposal = await loadActiveProposalForAction(client, requestId, locationId, true);
    if (new Date(proposal.expires_at) <= now) {
      throw new AppointmentRequestError(410, "APPOINTMENT_REQUEST_PROPOSAL_EXPIRED", "Esta proposta já expirou.");
    }
    if (!proposal.customer_email?.trim()) {
      throw new AppointmentRequestError(409, "APPOINTMENT_REQUEST_PROPOSAL_EMAIL_MISSING", "A cliente não tem um email válido neste pedido.");
    }
    tokenForProposal({
      requestId: proposal.request_id,
      revision: proposal.revision,
      commandKey: proposal.command_key,
      fingerprint: proposal.proposal_fingerprint,
      responseTokenHash: proposal.response_token_hash,
    }, options.responseTokenSecret ?? (process.env.SESSION_SECRET?.trim() || ""));
    if (["pending", "sending", "retry"].includes(proposal.email_status)) {
      await client.query("COMMIT");
      return {
        queued: true,
        reused: true,
        emailDeliveryRevision: Number(proposal.email_delivery_revision),
      };
    }
    const updated = await client.query<{ email_delivery_revision: number }>(`
      UPDATE ${table("appointment_request_proposals")}
      SET email_status = 'pending', email_delivery_revision = email_delivery_revision + 1,
        email_attempts = 0, next_email_attempt_at = $2::timestamp,
        email_lease_started_at = NULL, email_provider_message_id = NULL,
        email_error_code = NULL, email_last_attempt_at = NULL, email_sent_at = NULL
      WHERE id = $1 RETURNING email_delivery_revision
    `, [proposal.proposal_id, utcTimestamp(now)]);
    await insertCommunicationAudit(
      client,
      requestId,
      locationId,
      actor,
      "appointment_request.proposal_email_requeued",
      "Reenvio do email da proposta solicitado.",
      { proposalId: proposal.proposal_id, emailDeliveryRevision: updated.rows[0].email_delivery_revision },
    );
    await client.query("COMMIT");
    return { queued: true, reused: false, emailDeliveryRevision: updated.rows[0].email_delivery_revision };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function claimNextProposalEmail(
  deps: AppointmentRequestProposalEmailWorkerDependencies,
  leaseMs: number,
): Promise<ProposalEmailCandidate | null> {
  const table = tableFactory();
  const client = await deps.databasePool.connect();
  const now = deps.now();
  try {
    await client.query("BEGIN");
    await client.query(`
      UPDATE ${table("appointment_request_proposals")}
      SET email_status = 'retry', next_email_attempt_at = $1::timestamp,
        email_lease_started_at = NULL, email_error_code = 'LEASE_RECOVERED'
      WHERE email_status = 'sending' AND email_lease_started_at < $2::timestamp
    `, [utcTimestamp(now), utcTimestamp(new Date(now.getTime() - leaseMs))]);
    const result = await client.query<{
      proposal_id: number;
      request_id: number;
      location_id: number;
      proposal_revision: number;
      email_delivery_revision: number;
      email_attempts: number;
      command_key: string;
      proposal_fingerprint: string;
      response_token_hash: string;
      customer_name: string;
      customer_email: string;
      requested_start_time: Date;
      proposed_start_time: Date;
      expires_at: Date;
      location_name: string;
      location_timezone: string;
      services: Array<{ name: string; durationMinutes: number }>;
    }>(`
      SELECT proposal.id AS proposal_id, request.id AS request_id, request.location_id,
        proposal.revision AS proposal_revision, proposal.email_delivery_revision,
        proposal.email_attempts, proposal.command_key, proposal.proposal_fingerprint,
        proposal.response_token_hash, request.customer_name, request.customer_email,
        request.requested_start_time, proposal.proposed_start_time, proposal.expires_at,
        location.name AS location_name, location.timezone AS location_timezone,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', segment.service_name_snapshot,
            'durationMinutes', segment.duration_minutes
          ) ORDER BY segment.position)
          FROM ${table("appointment_request_segments")} segment
          WHERE segment.request_id = request.id
        ), '[]'::jsonb) AS services
      FROM ${table("appointment_request_proposals")} proposal
      INNER JOIN ${table("appointment_requests")} request ON request.id = proposal.request_id
      INNER JOIN ${table("locations")} location ON location.id = request.location_id
      WHERE proposal.email_status IN ('pending', 'retry')
        AND proposal.next_email_attempt_at <= $1::timestamp
        AND proposal.status = 'active'
        AND proposal.expires_at > $1::timestamp
        AND request.status = 'proposed'
        AND request.revision = proposal.revision
        AND request.customer_email IS NOT NULL
      ORDER BY proposal.next_email_attempt_at, proposal.id
      FOR UPDATE OF proposal SKIP LOCKED
      LIMIT 1
    `, [utcTimestamp(now)]);
    const row = result.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    await client.query(`
      UPDATE ${table("appointment_request_proposals")}
      SET email_status = 'sending', email_attempts = email_attempts + 1,
        email_lease_started_at = $2::timestamp, next_email_attempt_at = NULL,
        email_error_code = NULL, email_last_attempt_at = $2::timestamp
      WHERE id = $1
    `, [row.proposal_id, utcTimestamp(now)]);
    await client.query("COMMIT");
    return {
      proposalId: row.proposal_id,
      requestId: row.request_id,
      locationId: row.location_id,
      proposalRevision: row.proposal_revision,
      deliveryRevision: row.email_delivery_revision,
      attempts: row.email_attempts + 1,
      commandKey: row.command_key,
      proposalFingerprint: row.proposal_fingerprint,
      responseTokenHash: row.response_token_hash,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      requestedStartTime: new Date(row.requested_start_time),
      proposedStartTime: new Date(row.proposed_start_time),
      expiresAt: new Date(row.expires_at),
      locationName: row.location_name,
      locationTimeZone: row.location_timezone || "Europe/Lisbon",
      services: row.services,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function finishProposalEmail(
  deps: AppointmentRequestProposalEmailWorkerDependencies,
  candidate: ProposalEmailCandidate,
  result: EmailDeliveryResult,
) {
  const table = tableFactory();
  const now = deps.now();
  const permanentFailure = ["EMAIL_NOT_CONFIGURED", "PROPOSAL_TOKEN_ROTATED"].includes(result.errorCode || "");
  const retry = !result.sent && !permanentFailure && candidate.attempts < MAX_EMAIL_ATTEMPTS;
  const retryAt = retry
    ? new Date(now.getTime() + RETRY_DELAYS_MS[Math.min(candidate.attempts - 1, RETRY_DELAYS_MS.length - 1)])
    : null;
  await deps.databasePool.query(`
    UPDATE ${table("appointment_request_proposals")}
    SET email_status = $2, next_email_attempt_at = $3::timestamp,
      email_lease_started_at = NULL, email_provider_message_id = $4,
      email_error_code = $5, email_sent_at = $6::timestamp
    WHERE id = $1 AND email_status = 'sending'
  `, [
    candidate.proposalId,
    result.sent ? "sent" : retry ? "retry" : "failed",
    retryAt ? utcTimestamp(retryAt) : null,
    result.providerMessageId,
    result.errorCode,
    result.sent ? utcTimestamp(now) : null,
  ]);
}

export async function processNextAppointmentRequestProposalEmail(
  deps = defaultAppointmentRequestProposalEmailWorkerDependencies,
  leaseMs = 60_000,
) {
  if (!deps.processingEnabled) return false;
  const candidate = await claimNextProposalEmail(deps, leaseMs);
  if (!candidate) return false;
  let result: EmailDeliveryResult;
  try {
    const token = tokenForProposal({
      requestId: candidate.requestId,
      revision: candidate.proposalRevision,
      commandKey: candidate.commandKey,
      fingerprint: candidate.proposalFingerprint,
      responseTokenHash: candidate.responseTokenHash,
    }, deps.responseTokenSecret);
    result = await deps.sendEmail({
      customerName: candidate.customerName,
      customerEmail: candidate.customerEmail,
      locationName: candidate.locationName,
      locationTimeZone: candidate.locationTimeZone,
      requestedStartTime: candidate.requestedStartTime,
      proposedStartTime: candidate.proposedStartTime,
      expiresAt: candidate.expiresAt,
      services: candidate.services,
      responseUrl: responseUrl(deps.publicBaseUrl, token),
      idempotencyKey: `appointment-request:${candidate.requestId}:proposal:${candidate.proposalRevision}:email:${candidate.deliveryRevision}`,
    });
  } catch (error) {
    result = {
      sent: false,
      providerMessageId: null,
      errorCode: error instanceof AppointmentRequestError && error.code === "APPOINTMENT_REQUEST_PROPOSAL_TOKEN_ROTATED"
        ? "PROPOSAL_TOKEN_ROTATED"
        : "EMAIL_UNEXPECTED_ERROR",
    };
  }
  await finishProposalEmail(deps, candidate, result);
  return true;
}

export async function processPendingAppointmentRequestProposalEmails(
  deps = defaultAppointmentRequestProposalEmailWorkerDependencies,
) {
  if (!deps.processingEnabled) return 0;
  let processed = 0;
  for (let count = 0; count < 25; count += 1) {
    if (!await processNextAppointmentRequestProposalEmail(deps)) break;
    processed += 1;
  }
  return processed;
}

export function startAppointmentRequestProposalEmailWorker(
  intervalMs = Number(process.env.APPOINTMENT_REQUEST_PROPOSAL_EMAIL_POLL_INTERVAL_MS || 10_000),
  deps = defaultAppointmentRequestProposalEmailWorkerDependencies,
  enabled = appointmentRequestProposalEmailsEnabled,
) {
  if (!enabled) return () => undefined;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processPendingAppointmentRequestProposalEmails(deps);
    } catch (error) {
      console.error("Appointment request proposal email worker tick failed:", error instanceof Error ? error.name : "UnknownError");
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
