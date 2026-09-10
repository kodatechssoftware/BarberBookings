import { addDays, isAfter } from "date-fns";
import type { PublicAppointment } from "@/hooks/use-appointments";

export type AvailabilityRow = {
  barberId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isWorking: boolean;
};

export type ShopAvailabilityRow = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isOpen: boolean;
};

export type BarberOption = {
  id: number;
  serviceIds?: number[] | null;
  allServicesAllowed?: boolean;
};

export type ServiceOption = {
  id: number;
  duration: number;
};

export type TimeSlot = {
  time: string;
  available: boolean;
};

function calendarDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(number("year"), number("month") - 1, number("day"), number("hour"), number("minute"), number("second")) - date.getTime();
}

export function calendarTimeInTimeZone(date: Date, time: string, timeZone: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const utcGuess = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);
  let result = new Date(utcGuess - timeZoneOffsetMs(new Date(utcGuess), timeZone));
  result = new Date(utcGuess - timeZoneOffsetMs(result, timeZone));
  return result;
}

export function canBarberPerformService(barber: BarberOption | undefined | null, serviceId?: number | null) {
  if (!barber || !serviceId) return true;
  const serviceIds = barber.serviceIds ?? [];
  return (barber.allServicesAllowed !== false && serviceIds.length === 0) || serviceIds.includes(serviceId);
}

type MinutePeriod = {
  start: number;
  end: number;
};

export function defaultPeriodsForDay(day: number): MinutePeriod[] {
  if (day === 1) return [{ start: 14 * 60, end: 20 * 60 }];
  if (day >= 2 && day <= 5) return [{ start: 9 * 60, end: 13 * 60 }, { start: 14 * 60, end: 20 * 60 }];
  if (day === 6) return [{ start: 9 * 60, end: 13 * 60 }, { start: 14 * 60, end: 19 * 60 }];
  return [];
}

export function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function rowsToPeriods(rows: Array<{ startTime: string; endTime: string }>): MinutePeriod[] {
  return rows
    .map((row) => ({ start: timeToMinutes(row.startTime), end: timeToMinutes(row.endTime) }))
    .filter((period) => period.end > period.start);
}

function intersectPeriods(primaryPeriods: MinutePeriod[], overridePeriods: MinutePeriod[]) {
  const intersections: MinutePeriod[] = [];

  primaryPeriods.forEach((primary) => {
    overridePeriods.forEach((override) => {
      const start = Math.max(primary.start, override.start);
      const end = Math.min(primary.end, override.end);
      if (end > start) intersections.push({ start, end });
    });
  });

  return intersections;
}

export function periodsForShop({
  dayOfWeek,
  shopAvailabilityRows,
}: {
  dayOfWeek: number;
  shopAvailabilityRows: ShopAvailabilityRow[];
}) {
  if (shopAvailabilityRows.length === 0) return defaultPeriodsForDay(dayOfWeek);

  return rowsToPeriods(
    shopAvailabilityRows.filter((row) => row.dayOfWeek === dayOfWeek && row.isOpen),
  );
}

export function getEffectivePeriodsForBarber({
  barberId,
  dayOfWeek,
  shopAvailabilityRows,
  availabilityRows,
}: {
  barberId: number;
  dayOfWeek: number;
  shopAvailabilityRows: ShopAvailabilityRow[];
  availabilityRows: AvailabilityRow[];
}) {
  const shopPeriods = periodsForShop({ dayOfWeek, shopAvailabilityRows });
  if (shopPeriods.length === 0) return [];

  const barberRows = availabilityRows.filter((row) => row.barberId === barberId);
  if (barberRows.length === 0) return shopPeriods;

  const barberPeriods = rowsToPeriods(
    barberRows.filter((row) => row.dayOfWeek === dayOfWeek && row.isWorking),
  );

  return intersectPeriods(shopPeriods, barberPeriods);
}

export function getAvailableTimeSlots({
  selectedService,
  selectedDate,
  selectedBarberId,
  visibleBarbers,
  availabilityRows,
  shopAvailabilityRows,
  existingAppointments,
  now = new Date(),
  timeZone,
}: {
  selectedService?: ServiceOption | null;
  selectedDate?: Date | null;
  selectedBarberId: number | null;
  visibleBarbers: BarberOption[];
  availabilityRows?: AvailabilityRow[] | null;
  shopAvailabilityRows?: ShopAvailabilityRow[] | null;
  existingAppointments?: PublicAppointment[] | null;
  now?: Date;
  timeZone?: string;
}): TimeSlot[] {
  if (!selectedService || !existingAppointments || !selectedDate) return [];

  const slotsByTime = new Map<string, TimeSlot>();
  const dayOfWeek = selectedDate.getDay();
  const availability = availabilityRows ?? [];
  const shopAvailability = shopAvailabilityRows ?? [];
  const targetBarbers = selectedBarberId === 0
    ? visibleBarbers
    : visibleBarbers.filter((barber) => barber.id === selectedBarberId);
  const eligibleBarbers = targetBarbers.filter((barber) =>
    canBarberPerformService(barber, selectedService.id),
  );

  const candidateStartMinutes = new Set<number>();
  eligibleBarbers.forEach((barber) => {
    getEffectivePeriodsForBarber({
      barberId: barber.id,
      dayOfWeek,
      shopAvailabilityRows: shopAvailability,
      availabilityRows: availability,
    }).forEach((period) => {
      for (let minutes = period.start; minutes < period.end; minutes += 30) {
        if (minutes + selectedService.duration <= period.end) {
          candidateStartMinutes.add(minutes);
        }
      }
    });
  });

  Array.from(candidateStartMinutes).sort((a, b) => a - b).forEach((minutesFromDayStart) => {
    const hours = Math.floor(minutesFromDayStart / 60);
    const minutes = minutesFromDayStart % 60;
    const timeString = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
    const slotDateTime = timeZone
      ? calendarTimeInTimeZone(selectedDate, timeString, timeZone)
      : new Date(selectedDate);
    if (!timeZone) slotDateTime.setHours(hours, minutes, 0, 0);
    const endDateTime = new Date(slotDateTime.getTime() + selectedService.duration * 60000);
    const isPast = (timeZone ? calendarDateKey(selectedDate) === dateKeyInTimeZone(now, timeZone) : calendarDateKey(selectedDate) === calendarDateKey(now))
      && slotDateTime <= now;

    const busyBarberIds = new Set(
      existingAppointments
        .filter((appointment) => {
          const appointmentStart = new Date(appointment.startTime);
          const appointmentEnd = new Date(
            appointmentStart.getTime() + (appointment.duration || 30) * 60000,
          );
          return slotDateTime < appointmentEnd && endDateTime > appointmentStart;
        })
        .map((appointment) => appointment.barberId),
    );

    const hasAvailableBarber = eligibleBarbers.some((barber) => {
      const fitsBarberSchedule = getEffectivePeriodsForBarber({
        barberId: barber.id,
        dayOfWeek,
        shopAvailabilityRows: shopAvailability,
        availabilityRows: availability,
      }).some(
        (period) => minutesFromDayStart >= period.start &&
          minutesFromDayStart + selectedService.duration <= period.end,
      );
      return fitsBarberSchedule && !busyBarberIds.has(barber.id);
    });

    slotsByTime.set(timeString, {
      time: timeString,
      available: !isPast && hasAvailableBarber,
    });
  });

  return Array.from(slotsByTime.values());
}

export function findFirstAvailableDate({
  startDate,
  endDate,
  ...availabilityInput
}: Omit<Parameters<typeof getAvailableTimeSlots>[0], "selectedDate"> & {
  startDate: Date;
  endDate: Date;
}) {
  for (let date = new Date(startDate); !isAfter(date, endDate); date = addDays(date, 1)) {
    const slots = getAvailableTimeSlots({ ...availabilityInput, selectedDate: date });
    if (slots.some((slot) => slot.available)) return date;
  }
  return null;
}
