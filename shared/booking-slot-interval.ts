export const DEFAULT_BOOKING_SLOT_INTERVAL_MINUTES = 30;
export const SUPPORTED_BOOKING_SLOT_INTERVAL_MINUTES = [15, 30, 60] as const;

export type BookingSlotIntervalMinutes = typeof SUPPORTED_BOOKING_SLOT_INTERVAL_MINUTES[number];

export function parseBookingSlotIntervalMinutes(rawValue: string | undefined): BookingSlotIntervalMinutes {
  const value = rawValue?.trim();
  if (!value) return DEFAULT_BOOKING_SLOT_INTERVAL_MINUTES;

  if (!/^\d+$/.test(value)) {
    throw new Error("BOOKING_SLOT_INTERVAL_MINUTES must be one of: 15, 30, 60.");
  }

  const parsed = Number(value);
  if (!SUPPORTED_BOOKING_SLOT_INTERVAL_MINUTES.includes(parsed as BookingSlotIntervalMinutes)) {
    throw new Error("BOOKING_SLOT_INTERVAL_MINUTES must be one of: 15, 30, 60.");
  }

  return parsed as BookingSlotIntervalMinutes;
}

export function isMinuteOfDayAligned(
  hour: number,
  minute: number,
  intervalMinutes: BookingSlotIntervalMinutes,
) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return false;
  }

  return (hour * 60 + minute) % intervalMinutes === 0;
}

export function isClockTimeAligned(
  time: string,
  intervalMinutes: BookingSlotIntervalMinutes,
) {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return Boolean(match && isMinuteOfDayAligned(Number(match[1]), Number(match[2]), intervalMinutes));
}

export function firstClockAlignedMinute(
  minuteOfDay: number,
  intervalMinutes: BookingSlotIntervalMinutes,
) {
  return Math.ceil(minuteOfDay / intervalMinutes) * intervalMinutes;
}

export function createClockAlignedTimeOptions({
  startMinute,
  endMinuteExclusive,
  intervalMinutes,
}: {
  startMinute: number;
  endMinuteExclusive: number;
  intervalMinutes: BookingSlotIntervalMinutes;
}) {
  const options: string[] = [];
  const firstMinute = firstClockAlignedMinute(startMinute, intervalMinutes);

  for (let minuteOfDay = firstMinute; minuteOfDay < endMinuteExclusive; minuteOfDay += intervalMinutes) {
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    if (hour > 23) break;
    options.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }

  return options;
}

export function bookingSlotIntervalMessage(intervalMinutes: BookingSlotIntervalMinutes) {
  if (intervalMinutes === 60) {
    return "As marcações só podem começar à hora certa.";
  }

  return `As marcações só podem começar em intervalos de ${intervalMinutes} minutos.`;
}
