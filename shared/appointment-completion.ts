export const appointmentCompletionTimingMessage =
  "Só pode marcar como feita depois da hora de fim da marcação.";

type AppointmentCompletionTiming = {
  startTime: Date | string;
  durationMinutes: number;
};

export function getAppointmentCompletionEnd(
  appointment: AppointmentCompletionTiming,
) {
  const startTime = appointment.startTime instanceof Date
    ? appointment.startTime
    : new Date(appointment.startTime);

  return new Date(startTime.getTime() + appointment.durationMinutes * 60_000);
}

export function getAppointmentCompletionTimingError(
  appointment: AppointmentCompletionTiming,
  now: Date = new Date(),
) {
  return getAppointmentCompletionEnd(appointment).getTime() > now.getTime()
    ? appointmentCompletionTimingMessage
    : null;
}

export function canCompleteAppointment(
  appointment: AppointmentCompletionTiming,
  now: Date = new Date(),
) {
  return getAppointmentCompletionTimingError(appointment, now) === null;
}
