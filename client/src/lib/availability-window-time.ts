function clockMinutes(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function clockValue(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export type AvailabilityWindowTime = { startTime: string; endTime: string };

export function rebaseAvailabilityWindows(
  windows: AvailabilityWindowTime[],
  previousServiceStart: string,
  nextServiceStart: string,
  nextServiceEnd: string,
): AvailabilityWindowTime[] {
  const previousStart = clockMinutes(previousServiceStart);
  const nextStart = clockMinutes(nextServiceStart);
  const nextEnd = clockMinutes(nextServiceEnd);
  if (previousStart === null || nextStart === null || nextEnd === null || nextEnd <= nextStart) {
    return windows;
  }

  const shift = nextStart - previousStart;
  return windows.map((window) => {
    const start = clockMinutes(window.startTime);
    const end = clockMinutes(window.endTime);
    if (start === null || end === null || end <= start) return window;

    const width = Math.min(end - start, nextEnd - nextStart);
    const shiftedStart = Math.max(nextStart, Math.min(start + shift, nextEnd - width));
    return {
      startTime: clockValue(shiftedStart),
      endTime: clockValue(shiftedStart + width),
    };
  });
}

export function getWindowTimeOptions(minTime: string, maxTime: string, selectedHour: string) {
  const minimum = clockMinutes(minTime);
  const maximum = clockMinutes(maxTime);
  if (minimum === null || maximum === null || maximum < minimum) {
    return { hours: [], minutes: [] };
  }

  const hours = Array.from(
    { length: Math.floor(maximum / 60) - Math.floor(minimum / 60) + 1 },
    (_, index) => String(Math.floor(minimum / 60) + index).padStart(2, "0"),
  );
  const hour = Number(selectedHour);
  const minutes = hours.includes(selectedHour)
    ? Array.from({ length: 60 }, (_, index) => index)
      .filter((minute) => hour * 60 + minute >= minimum && hour * 60 + minute <= maximum)
      .map((minute) => String(minute).padStart(2, "0"))
    : [];

  return { hours, minutes };
}

export function clampWindowTimeToHour(hour: string, minute: string, minTime: string, maxTime: string) {
  const minimum = clockMinutes(minTime);
  const maximum = clockMinutes(maxTime);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  if (minimum === null || maximum === null || maximum < minimum
    || !Number.isInteger(hourNumber) || !Number.isInteger(minuteNumber)) {
    return null;
  }
  const hourStart = hourNumber * 60;
  const earliest = Math.max(minimum, hourStart);
  const latest = Math.min(maximum, hourStart + 59);
  if (earliest > latest) return null;
  return clockValue(Math.min(latest, Math.max(earliest, hourStart + minuteNumber)));
}
