import {
  createClockAlignedTimeOptions,
  isClockTimeAligned,
  type BookingSlotIntervalMinutes,
} from "@shared/booking-slot-interval";

export type AppointmentTimeOption = {
  value: string;
  label: string;
};

export function createAppointmentTimeOptions({
  currentTime,
  intervalMinutes,
}: {
  currentTime: string;
  intervalMinutes: BookingSlotIntervalMinutes;
}): AppointmentTimeOption[] {
  const alignedOptions = createClockAlignedTimeOptions({
    startMinute: 0,
    endMinuteExclusive: 24 * 60,
    intervalMinutes,
  }).map((value) => ({ value, label: value }));

  if (isClockTimeAligned(currentTime, intervalMinutes)) {
    return alignedOptions;
  }

  return [
    ...alignedOptions,
    { value: currentTime, label: `${currentTime} — Hora atual` },
  ].sort((left, right) => left.value.localeCompare(right.value));
}
