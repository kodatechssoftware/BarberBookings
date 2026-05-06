import { isSameDay } from "date-fns";
import type { PublicAppointment } from "@/hooks/use-appointments";

export type AvailabilityRow = {
  barberId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isWorking: boolean;
};

export type BarberOption = {
  id: number;
};

export type ServiceOption = {
  duration: number;
};

export type TimeSlot = {
  time: string;
  available: boolean;
};

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

function periodsForBarber({
  barberId,
  dayOfWeek,
  availabilityRows,
}: {
  barberId: number;
  dayOfWeek: number;
  availabilityRows: AvailabilityRow[];
}) {
  const barberRows = availabilityRows.filter((row) => row.barberId === barberId);
  if (barberRows.length === 0) return defaultPeriodsForDay(dayOfWeek);

  return barberRows
    .filter((row) => row.dayOfWeek === dayOfWeek && row.isWorking)
    .map((row) => ({ start: timeToMinutes(row.startTime), end: timeToMinutes(row.endTime) }))
    .filter((period) => period.end > period.start);
}

export function getAvailableTimeSlots({
  selectedService,
  selectedDate,
  selectedBarberId,
  visibleBarbers,
  availabilityRows,
  existingAppointments,
  now = new Date(),
}: {
  selectedService?: ServiceOption | null;
  selectedDate?: Date | null;
  selectedBarberId: number | null;
  visibleBarbers: BarberOption[];
  availabilityRows?: AvailabilityRow[] | null;
  existingAppointments?: PublicAppointment[] | null;
  now?: Date;
}): TimeSlot[] {
  if (!selectedService || !existingAppointments || !selectedDate) return [];

  const slotsByTime = new Map<string, TimeSlot>();
  const dayOfWeek = selectedDate.getDay();
  const availability = availabilityRows ?? [];
  const targetBarbers = selectedBarberId === 0
    ? visibleBarbers
    : visibleBarbers.filter((barber) => barber.id === selectedBarberId);

  const candidateStartMinutes = new Set<number>();
  targetBarbers.forEach((barber) => {
    periodsForBarber({ barberId: barber.id, dayOfWeek, availabilityRows: availability }).forEach((period) => {
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
    const slotDateTime = new Date(selectedDate);
    slotDateTime.setHours(hours, minutes, 0, 0);
    const endDateTime = new Date(slotDateTime.getTime() + selectedService.duration * 60000);
    const isPast = isSameDay(selectedDate, now) && slotDateTime <= now;

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

    const hasAvailableBarber = targetBarbers.some((barber) => {
      const fitsBarberSchedule = periodsForBarber({ barberId: barber.id, dayOfWeek, availabilityRows: availability }).some(
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
