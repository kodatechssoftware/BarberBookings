export type AppointmentOccupancyInput = {
  startTime: Date | string;
  durationMinutes?: number | null;
  bufferBeforeMinutes?: number | null;
  bufferAfterMinutes?: number | null;
  availabilityWindows?: readonly AppointmentAvailabilityWindowInput[] | null;
};

export type AppointmentAvailabilityWindowInput = {
  startTime: Date | string;
  endTime: Date | string;
};

export type AppointmentOccupancyPeriod = {
  startTime: Date;
  endTime: Date;
};

export type AppointmentAvailabilityWindowValidation =
  | { valid: true; windows: AppointmentOccupancyPeriod[] }
  | { valid: false; code: "INVALID_DATE" | "INVALID_RANGE" | "OUTSIDE_APPOINTMENT" | "OVERLAP" };

const DEFAULT_DURATION_MINUTES = 30;

function nonNegativeMinutes(value: number | null | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0;
}

export function getOperationalAppointmentBounds(input: AppointmentOccupancyInput) {
  const startTime = input.startTime instanceof Date ? input.startTime : new Date(input.startTime);
  const durationMinutes = Number.isFinite(input.durationMinutes) && Number(input.durationMinutes) > 0
    ? Number(input.durationMinutes)
    : DEFAULT_DURATION_MINUTES;
  const bufferBeforeMinutes = nonNegativeMinutes(input.bufferBeforeMinutes);
  const bufferAfterMinutes = nonNegativeMinutes(input.bufferAfterMinutes);
  const commercialEnd = new Date(startTime.getTime() + durationMinutes * 60_000);

  return {
    commercialStart: startTime,
    commercialEnd,
    operationalStart: new Date(startTime.getTime() - bufferBeforeMinutes * 60_000),
    operationalEnd: new Date(commercialEnd.getTime() + bufferAfterMinutes * 60_000),
    durationMinutes,
    bufferBeforeMinutes,
    bufferAfterMinutes,
  };
}

export function validateAppointmentAvailabilityWindows(
  appointment: Omit<AppointmentOccupancyInput, "availabilityWindows">,
  windows: readonly AppointmentAvailabilityWindowInput[] | null | undefined,
): AppointmentAvailabilityWindowValidation {
  const bounds = getOperationalAppointmentBounds(appointment);
  const normalized: AppointmentOccupancyPeriod[] = [];

  for (const window of windows ?? []) {
    const startTime = window.startTime instanceof Date ? window.startTime : new Date(window.startTime);
    const endTime = window.endTime instanceof Date ? window.endTime : new Date(window.endTime);
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      return { valid: false, code: "INVALID_DATE" };
    }
    if (startTime >= endTime) return { valid: false, code: "INVALID_RANGE" };
    if (startTime < bounds.commercialStart || endTime > bounds.commercialEnd) {
      return { valid: false, code: "OUTSIDE_APPOINTMENT" };
    }
    normalized.push({ startTime, endTime });
  }

  normalized.sort((left, right) => left.startTime.getTime() - right.startTime.getTime()
    || left.endTime.getTime() - right.endTime.getTime());
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].startTime < normalized[index - 1].endTime) {
      return { valid: false, code: "OVERLAP" };
    }
  }
  return { valid: true, windows: normalized };
}

export function getAppointmentOccupancyPeriods(input: AppointmentOccupancyInput): AppointmentOccupancyPeriod[] {
  const bounds = getOperationalAppointmentBounds(input);
  const validation = validateAppointmentAvailabilityWindows(input, input.availabilityWindows);
  if (!validation.valid) {
    throw new RangeError(`Invalid appointment availability windows: ${validation.code}`);
  }
  if (validation.windows.length === 0) {
    return [{ startTime: bounds.operationalStart, endTime: bounds.operationalEnd }];
  }

  const periods: AppointmentOccupancyPeriod[] = [];
  let occupiedFrom = bounds.operationalStart;
  for (const window of validation.windows) {
    if (occupiedFrom < window.startTime) {
      periods.push({ startTime: occupiedFrom, endTime: window.startTime });
    }
    occupiedFrom = window.endTime;
  }
  if (occupiedFrom < bounds.operationalEnd) {
    periods.push({ startTime: occupiedFrom, endTime: bounds.operationalEnd });
  }
  return periods;
}

export function appointmentOccupancyOverlaps(
  left: AppointmentOccupancyInput,
  right: AppointmentOccupancyInput,
) {
  const leftPeriods = getAppointmentOccupancyPeriods(left);
  const rightPeriods = getAppointmentOccupancyPeriods(right);
  return leftPeriods.some((leftPeriod) => rightPeriods.some((rightPeriod) =>
    leftPeriod.startTime < rightPeriod.endTime && leftPeriod.endTime > rightPeriod.startTime));
}
