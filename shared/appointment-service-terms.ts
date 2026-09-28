export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;
export const MAX_APPOINTMENT_SERVICE_NAME_LENGTH = 100;
export const MAX_APPOINTMENT_SERVICE_PRICE_CENTS = 1_000_000;
export const MAX_APPOINTMENT_DURATION_MINUTES = 720;

export type AppointmentServiceTermsLike = {
  serviceId?: number | null;
  serviceNameSnapshot?: string | null;
  servicePriceCentsSnapshot?: number | null;
  durationMinutes?: number | null;
};

export function hasAppointmentServiceTermsSnapshot(
  appointment: AppointmentServiceTermsLike,
) {
  return appointment.serviceNameSnapshot !== null
    && appointment.serviceNameSnapshot !== undefined
    && appointment.servicePriceCentsSnapshot !== null
    && appointment.servicePriceCentsSnapshot !== undefined;
}

export function getAppointmentServiceName(
  appointment: AppointmentServiceTermsLike,
  serviceNames: ReadonlyMap<number, string>,
  fallback = "Serviço indisponível",
) {
  const snapshot = appointment.serviceNameSnapshot?.trim();
  if (snapshot) return snapshot;
  if (appointment.serviceId) return serviceNames.get(appointment.serviceId) || fallback;
  return fallback;
}

export function getAppointmentPriceCents(
  appointment: AppointmentServiceTermsLike,
  servicePrices: ReadonlyMap<number, number>,
) {
  if (appointment.servicePriceCentsSnapshot !== null
    && appointment.servicePriceCentsSnapshot !== undefined) {
    return appointment.servicePriceCentsSnapshot;
  }
  return appointment.serviceId ? servicePrices.get(appointment.serviceId) ?? 0 : 0;
}

export function getEffectiveAppointmentDurationMinutes(
  appointment: AppointmentServiceTermsLike,
  serviceDurations: ReadonlyMap<number, number>,
) {
  const serviceDuration = appointment.serviceId
    ? serviceDurations.get(appointment.serviceId) ?? DEFAULT_APPOINTMENT_DURATION_MINUTES
    : DEFAULT_APPOINTMENT_DURATION_MINUTES;
  const storedDuration = appointment.durationMinutes;

  if (typeof storedDuration !== "number" || !Number.isFinite(storedDuration) || storedDuration <= 0) {
    return serviceDuration;
  }

  if (hasAppointmentServiceTermsSnapshot(appointment)) return storedDuration;

  // Legacy appointments may have inherited the historical 30-minute default
  // before duration snapshots were consistently persisted.
  if (
    appointment.serviceId
    && storedDuration === DEFAULT_APPOINTMENT_DURATION_MINUTES
    && serviceDuration !== DEFAULT_APPOINTMENT_DURATION_MINUTES
  ) {
    return serviceDuration;
  }

  return storedDuration;
}
