export const DEFAULT_PUBLIC_BOOKING_OPEN_DAY = 20;
export const PUBLIC_BOOKING_WINDOW_CLOSED_CODE = "PUBLIC_BOOKING_WINDOW_CLOSED";

export type PublicBookingWindow = {
  enabled: boolean;
  today: string;
  maxDate: string;
  openDay: number;
  nextMonthAvailable: boolean;
  nextOpeningDate: string;
};

export type PublicBookingMonthOpeningNotice = {
  bookingMonth: string;
  openingDate: string;
};

type CalendarDate = { year: number; month: number; day: number };

function dateKey({ year, month, day }: CalendarDate) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftMonth(year: number, month: number, offset: number) {
  const value = new Date(Date.UTC(year, month - 1 + offset, 1));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1 };
}

function endOfCalendarMonth(year: number, month: number): CalendarDate {
  const value = new Date(Date.UTC(year, month, 0));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

export function normalizePublicBookingOpenDay(rawValue: string | number | undefined) {
  const parsed = typeof rawValue === "number" ? rawValue : Number(rawValue);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 28
    ? parsed
    : DEFAULT_PUBLIC_BOOKING_OPEN_DAY;
}

export function getCalendarDateInTimeZone(now: Date, timeZone: string): CalendarDate {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));

  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

export function getPublicBookingWindow(
  now: Date,
  timeZone: string,
  rawOpenDay: string | number | undefined = DEFAULT_PUBLIC_BOOKING_OPEN_DAY,
): PublicBookingWindow {
  const today = getCalendarDateInTimeZone(now, timeZone);
  const openDay = normalizePublicBookingOpenDay(rawOpenDay);
  const nextMonthAvailable = today.day >= openDay;
  const maxMonth = shiftMonth(today.year, today.month, nextMonthAvailable ? 1 : 0);
  const openingMonth = shiftMonth(today.year, today.month, nextMonthAvailable ? 1 : 0);

  return {
    enabled: true,
    today: dateKey(today),
    maxDate: dateKey(endOfCalendarMonth(maxMonth.year, maxMonth.month)),
    openDay,
    nextMonthAvailable,
    nextOpeningDate: dateKey({ ...openingMonth, day: openDay }),
  };
}

export function isDateWithinPublicBookingWindow(date: Date, window: PublicBookingWindow, timeZone: string) {
  const requestedDate = dateKey(getCalendarDateInTimeZone(date, timeZone));
  return requestedDate >= window.today && requestedDate <= window.maxDate;
}

export function getPublicBookingMonthOpeningNotice(
  window: PublicBookingWindow | undefined,
  visibleMonthDate: string,
): PublicBookingMonthOpeningNotice | null {
  if (!window?.enabled) return null;

  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(visibleMonthDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;

  const nextMonth = shiftMonth(year, month, 1);
  const nextMonthFirstDate = dateKey({ ...nextMonth, day: 1 });
  if (nextMonthFirstDate <= window.maxDate) return null;

  return {
    bookingMonth: nextMonthFirstDate.slice(0, 7),
    openingDate: window.nextOpeningDate,
  };
}

export function formatPublicBookingMonthOpeningNotice(
  notice: PublicBookingMonthOpeningNotice,
  locale = "pt-PT",
) {
  const bookingMonth = new Date(`${notice.bookingMonth}-01T00:00:00.000Z`);
  const openingDate = new Date(`${notice.openingDate}T00:00:00.000Z`);
  const monthName = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  }).format(bookingMonth);
  const formattedOpeningDate = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(openingDate);

  return `As marcações para ${monthName} ficam disponíveis a partir de ${formattedOpeningDate}.`;
}
