const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, created);
  return created;
}

export type CalendarDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function getCalendarDateTimeParts(date: Date, timeZone: string): CalendarDateTimeParts {
  const parts = Object.fromEntries(
    formatter(timeZone).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function calendarDateTimeToInstant(parts: CalendarDateTimeParts, timeZone: string) {
  const targetTimestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );
  let candidateTimestamp = targetTimestamp;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const represented = getCalendarDateTimeParts(new Date(candidateTimestamp), timeZone);
    const representedTimestamp = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
    );
    const difference = representedTimestamp - targetTimestamp;
    if (difference === 0) break;
    candidateTimestamp -= difference;
  }
  return new Date(candidateTimestamp);
}

function calendarDateToInstant(year: number, month: number, day: number, timeZone: string) {
  return calendarDateTimeToInstant({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);
}

export function getCalendarDateBounds(dateKey: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: calendarDateToInstant(year, month, day, timeZone),
    endExclusive: calendarDateToInstant(
      nextDate.getUTCFullYear(),
      nextDate.getUTCMonth() + 1,
      nextDate.getUTCDate(),
      timeZone,
    ),
  };
}

export function getCalendarDateInTimeZone(now: Date, timeZone: string) {
  const parts = getCalendarDateTimeParts(now, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}
