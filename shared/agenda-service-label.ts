export type AgendaServiceLabelSource = {
  name?: string | null;
  agendaLabel?: string | null;
};

export function getAgendaServiceLabel(
  service?: AgendaServiceLabelSource,
  serviceNameSnapshot?: string | null,
) {
  const snapshotName = serviceNameSnapshot?.trim();
  const catalogName = service?.name?.trim();
  const appointmentUsesCurrentCatalogName = !snapshotName || snapshotName === catalogName;
  const agendaLabel = appointmentUsesCurrentCatalogName ? service?.agendaLabel?.trim() : null;

  return agendaLabel || snapshotName || catalogName || "Serviço";
}
