import {
  calendarDateTimeToInstant,
  getCalendarDateInTimeZone,
  getCalendarDateTimeParts,
} from "./calendar-timezone";

function previousCalendarDay(parts: ReturnType<typeof getCalendarDateTimeParts>) {
  const previous = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 1));
  return {
    ...parts,
    year: previous.getUTCFullYear(),
    month: previous.getUTCMonth() + 1,
    day: previous.getUTCDate(),
  };
}

/**
 * Resolves "the same local clock time on the previous calendar day". This is
 * intentionally calendar based rather than startTime - 24h so that the
 * reminder remains the day before across DST transitions.
 */
export function getAppointmentReminderAvailableAt(
  appointmentStart: Date,
  timeZone: string,
  createdAt = new Date(),
) {
  if (appointmentStart.getTime() <= createdAt.getTime()) return null;
  const availableAt = calendarDateTimeToInstant(
    previousCalendarDay(getCalendarDateTimeParts(appointmentStart, timeZone)),
    timeZone,
  );
  // Never enqueue a retroactive "24h" reminder for a booking/reschedule made
  // after the intended delivery instant. A booking made exactly at the due
  // instant is still eligible for the next worker tick.
  return availableAt.getTime() >= createdAt.getTime() ? availableAt : null;
}

export function isAppointmentReminderDeliveryWindow(
  appointmentStart: Date,
  availableAt: Date,
  timeZone: string,
  now = new Date(),
) {
  if (now.getTime() < availableAt.getTime() || now.getTime() >= appointmentStart.getTime()) return false;
  const appointmentParts = getCalendarDateTimeParts(appointmentStart, timeZone);
  const previous = previousCalendarDay(appointmentParts);
  const previousDateKey = `${String(previous.year).padStart(4, "0")}-${String(previous.month).padStart(2, "0")}-${String(previous.day).padStart(2, "0")}`;
  return getCalendarDateInTimeZone(now, timeZone) === previousDateKey;
}
