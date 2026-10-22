import type { AppointmentStatus } from "./schema";

export const appointmentStatusTransitions: Readonly<Record<AppointmentStatus, ReadonlySet<AppointmentStatus>>> = {
  booked: new Set<AppointmentStatus>([
    "booked",
    "completed",
    "cancelled",
    "late_cancelled",
    "no_show",
  ]),
  completed: new Set<AppointmentStatus>(),
  cancelled: new Set<AppointmentStatus>(),
  late_cancelled: new Set<AppointmentStatus>(),
  no_show: new Set<AppointmentStatus>(),
};

export function isAllowedAppointmentStatusTransition(
  currentStatus: AppointmentStatus,
  nextStatus: AppointmentStatus,
) {
  return appointmentStatusTransitions[currentStatus].has(nextStatus);
}

export function appointmentStatusTransitionError(
  currentStatus: AppointmentStatus,
  nextStatus: AppointmentStatus,
) {
  if (isAllowedAppointmentStatusTransition(currentStatus, nextStatus)) return null;
  if (currentStatus === "completed") {
    return "Uma marcação concluída não pode ser reaberta nem alterar de estado.";
  }
  return "Esta marcação já tem um estado final e não pode ser alterada.";
}
