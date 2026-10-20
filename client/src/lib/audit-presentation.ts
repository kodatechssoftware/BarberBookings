import type { AdminCopy } from "@shared/business/copy/types";

export type AuditPresentationItem = {
  action: string;
  actorType: string;
  actorName?: string | null;
  summary: string;
};

const domainSummaryActions = new Set([
  "barber.created",
  "barber.updated",
  "barber.services_updated",
  "barber.hidden",
  "barber.deleted",
  "barber.password_reset",
  "barber.invite_created",
  "shop_availability.updated",
  "barber_availability.updated",
]);

export function getAuditActionLabel(action: string, copy: AdminCopy["audit"]) {
  return copy.actions[action] || copy.activityFallback;
}

export function getAuditActorLabel(
  log: AuditPresentationItem,
  copy: AdminCopy["audit"],
) {
  if (log.actorType === "admin") return log.actorName || copy.actorAdministrator;
  if (log.actorType === "barber") {
    return log.actorName
      ? `${copy.actorProfessional}: ${log.actorName}`
      : copy.actorProfessional;
  }
  if (log.actorType === "customer") {
    return log.actorName ? `${copy.actorCustomer}: ${log.actorName}` : copy.actorCustomer;
  }
  return log.actorName || copy.actorSystem;
}

export function getAuditSummary(
  log: AuditPresentationItem,
  copy: AdminCopy["audit"],
) {
  if (!domainSummaryActions.has(log.action)) return log.summary;

  const label = log.action === "barber.hidden"
    ? copy.professionalHiddenForHistory.split(":")[0]
    : getAuditActionLabel(log.action, copy);
  const separatorIndex = log.summary.indexOf(":");
  if (separatorIndex < 0) return label;

  const subject = log.summary.slice(separatorIndex + 1).trim();
  return subject ? `${label}: ${subject}` : label;
}
