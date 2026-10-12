export type AppointmentOccupancyInput = {
  startTime: Date | string;
  durationMinutes?: number | null;
  bufferBeforeMinutes?: number | null;
  bufferAfterMinutes?: number | null;
};

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

export function appointmentOccupancyOverlaps(
  left: AppointmentOccupancyInput,
  right: AppointmentOccupancyInput,
) {
  const leftBounds = getOperationalAppointmentBounds(left);
  const rightBounds = getOperationalAppointmentBounds(right);
  return leftBounds.operationalStart < rightBounds.operationalEnd
    && leftBounds.operationalEnd > rightBounds.operationalStart;
}
