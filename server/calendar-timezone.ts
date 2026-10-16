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

function calendarDateToInstant(year: number, month: number, day: number, timeZone: string) {
  const targetTimestamp = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let candidateTimestamp = targetTimestamp;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter(timeZone).formatToParts(new Date(candidateTimestamp)).map((part) => [part.type, part.value]),
    );
    const representedTimestamp = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const difference = representedTimestamp - targetTimestamp;
    if (difference === 0) break;
    candidateTimestamp -= difference;
  }
  return new Date(candidateTimestamp);
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
  const parts = Object.fromEntries(
    formatter(timeZone).formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
