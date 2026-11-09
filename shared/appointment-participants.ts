export type AppointmentWithProfessionalSegments = {
  barberId: number;
  serviceSegments?: ReadonlyArray<{ barberId: number }>;
};

export function getAppointmentProfessionalIds(
  appointment: AppointmentWithProfessionalSegments,
) {
  return Array.from(new Set([
    appointment.barberId,
    ...(appointment.serviceSegments ?? []).map((segment) => segment.barberId),
  ].filter((professionalId) => Number.isInteger(professionalId) && professionalId > 0)));
}

export function appointmentIncludesProfessional(
  appointment: AppointmentWithProfessionalSegments,
  professionalId: number,
) {
  return getAppointmentProfessionalIds(appointment).includes(professionalId);
}
