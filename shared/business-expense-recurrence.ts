export type RecurringExpenseFrequency = "weekly" | "monthly";

export type RecurringExpenseSchedule = {
  recurrence: RecurringExpenseFrequency;
  weekday: number | null;
  monthDay: number | null;
};

export type RecurringExpensePause = {
  pausedFrom: string;
  resumedOn: string | null;
};

const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseCalendarDate(dateKey: string) {
  if (!calendarDatePattern.test(dateKey)) throw new Error(`Invalid calendar date: ${dateKey}`);
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${dateKey}`);
  }
  return date;
}

export function formatCalendarDate(date: Date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function calendarWeekday(dateKey: string) {
  return parseCalendarDate(dateKey).getUTCDay();
}

export function calendarMonthDay(dateKey: string) {
  return parseCalendarDate(dateKey).getUTCDate();
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function lastDayOfMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function isRecurringExpensePaused(dateKey: string, pauses: readonly RecurringExpensePause[]) {
  return pauses.some((pause) => (
    dateKey >= pause.pausedFrom && (pause.resumedOn === null || dateKey < pause.resumedOn)
  ));
}

export function recurringExpenseDates(input: {
  anchorDate: string;
  from: string;
  through: string;
  schedule: RecurringExpenseSchedule;
  endedOn?: string | null;
  pauses?: readonly RecurringExpensePause[];
}) {
  const anchor = parseCalendarDate(input.anchorDate);
  const from = parseCalendarDate(input.from);
  const through = parseCalendarDate(input.through);
  if (from > through) return [];
  const pauses = input.pauses ?? [];
  const result: string[] = [];

  if (input.schedule.recurrence === "weekly") {
    const weekday = input.schedule.weekday;
    if (weekday === null || weekday < 0 || weekday > 6) throw new Error("Invalid weekly schedule.");
    let cursor = from > anchor ? from : anchor;
    const offset = (weekday - cursor.getUTCDay() + 7) % 7;
    cursor = addDays(cursor, offset);
    while (cursor <= through) {
      const dateKey = formatCalendarDate(cursor);
      if ((!input.endedOn || dateKey < input.endedOn) && !isRecurringExpensePaused(dateKey, pauses)) {
        result.push(dateKey);
      }
      cursor = addDays(cursor, 7);
    }
    return result;
  }

  const monthDay = input.schedule.monthDay;
  if (monthDay === null || monthDay < 1 || monthDay > 31) throw new Error("Invalid monthly schedule.");
  let year = Math.max(anchor.getUTCFullYear(), from.getUTCFullYear());
  let month = year === from.getUTCFullYear() ? from.getUTCMonth() : 0;
  const anchorMonth = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth();
  const endMonth = through.getUTCFullYear() * 12 + through.getUTCMonth();
  for (let monthKey = year * 12 + month; monthKey <= endMonth; monthKey += 1) {
    year = Math.floor(monthKey / 12);
    month = monthKey % 12;
    if (monthKey < anchorMonth) continue;
    const candidate = new Date(Date.UTC(year, month, Math.min(monthDay, lastDayOfMonth(year, month))));
    if (candidate < anchor || candidate < from || candidate > through) continue;
    const dateKey = formatCalendarDate(candidate);
    if ((!input.endedOn || dateKey < input.endedOn) && !isRecurringExpensePaused(dateKey, pauses)) {
      result.push(dateKey);
    }
  }
  return result;
}
