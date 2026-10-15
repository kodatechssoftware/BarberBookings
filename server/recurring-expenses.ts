import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "./db";
import {
  businessExpenseRecurringPauses,
  businessExpenseRecurringSeries,
  businessExpenseRecurringVersions,
  businessExpenses,
  locations,
  type BusinessExpenseCategory,
  type BusinessExpenseRecurrence,
  type BusinessExpenseRecurringStatus,
} from "@shared/schema";
import {
  calendarMonthDay,
  calendarWeekday,
  formatCalendarDate,
  parseCalendarDate,
  recurringExpenseDates,
  type RecurringExpenseFrequency,
} from "@shared/business-expense-recurrence";
import { getCalendarDateBounds, getCalendarDateInTimeZone } from "./calendar-timezone";

export type RecurringExpenseTermsInput = {
  category: BusinessExpenseCategory;
  description: string;
  amountCents: number;
  recurrence: RecurringExpenseFrequency;
  notes?: string | null;
};

export type RecurringExpenseSeriesView = {
  id: number;
  locationId: number;
  status: BusinessExpenseRecurringStatus;
  anchorDate: string;
  endedOn: string | null;
  occurrenceCount: number;
  hasOccurrences: boolean;
  locationToday: string;
  minimumFutureEffectiveFrom: string;
  nextOccurrenceDate: string | null;
  currentVersion: {
    id: number;
    effectiveFrom: string;
    category: BusinessExpenseCategory;
    description: string;
    amountCents: number;
    recurrence: RecurringExpenseFrequency;
    weekday: number | null;
    monthDay: number | null;
    notes: string | null;
    createdAt: Date;
  };
  versions: Array<RecurringExpenseSeriesView["currentVersion"]>;
  pauses: Array<{ id: number; pausedFrom: string; resumedOn: string | null; createdAt: Date }>;
  occurrences: Array<{
    id: number;
    scheduledDate: string;
    category: BusinessExpenseCategory;
    description: string;
    amountCents: number;
    recurrence: RecurringExpenseFrequency;
    notes: string | null;
    isOccurrenceOverride: boolean;
    updatedAt: Date;
  }>;
};

function recurrenceSchedule(recurrence: RecurringExpenseFrequency, dateKey: string) {
  return recurrence === "weekly"
    ? { weekday: calendarWeekday(dateKey), monthDay: null }
    : { weekday: null, monthDay: calendarMonthDay(dateKey) };
}

function previousDate(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function followingDate(dateKey: string) {
  const date = parseCalendarDate(dateKey);
  date.setUTCDate(date.getUTCDate() + 1);
  return formatCalendarDate(date);
}

function addCalendarYears(dateKey: string, years: number) {
  const date = parseCalendarDate(dateKey);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return formatCalendarDate(date);
}

function nextSeriesOccurrenceDate(input: {
  status: BusinessExpenseRecurringStatus;
  anchorDate: string;
  endedOn: string | null;
  fromDate: string;
  versions: RecurringExpenseSeriesView["versions"];
  pauses: RecurringExpenseSeriesView["pauses"];
}) {
  if (input.status === "ended") return null;
  const horizon = addCalendarYears(input.fromDate, 5);
  for (let index = 0; index < input.versions.length; index += 1) {
    const version = input.versions[index];
    const nextVersion = input.versions[index + 1];
    const from = [input.fromDate, input.anchorDate, version.effectiveFrom].sort().at(-1)!;
    const through = nextVersion
      ? [horizon, previousDate(nextVersion.effectiveFrom)].sort().at(0)!
      : horizon;
    if (from > through) continue;
    const [nextDate] = recurringExpenseDates({
      anchorDate: input.anchorDate,
      from,
      through,
      endedOn: input.endedOn,
      schedule: version,
      pauses: input.pauses,
    });
    if (nextDate) return nextDate;
  }
  return null;
}

type ExpenseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockExpenseLocation(tx: ExpenseTransaction, locationId: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(424243, ${locationId})`);
}

async function lockSeries(tx: ExpenseTransaction, seriesId: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(424244, ${seriesId})`);
  const [series] = await tx
    .select()
    .from(businessExpenseRecurringSeries)
    .where(eq(businessExpenseRecurringSeries.id, seriesId))
    .for("update");
  return series;
}

async function locationTimeZone(tx: ExpenseTransaction, locationId: number) {
  const [location] = await tx.select({ timezone: locations.timezone }).from(locations).where(eq(locations.id, locationId));
  if (!location) throw new Error("LOCATION_NOT_FOUND");
  return location.timezone;
}

async function occurrenceCount(tx: ExpenseTransaction, seriesId: number) {
  const [row] = await tx.select({ count: sql<number>`count(*)::integer` })
    .from(businessExpenses)
    .where(eq(businessExpenses.recurringSeriesId, seriesId));
  return Number(row?.count ?? 0);
}

function effectiveSeriesStatus(input: {
  endedOn: string | null;
  today: string;
  pauses: RecurringExpenseSeriesView["pauses"];
}): BusinessExpenseRecurringStatus {
  if (input.endedOn && input.endedOn <= input.today) return "ended";
  if (input.pauses.some((pause) => (
    pause.pausedFrom <= input.today && (pause.resumedOn === null || input.today < pause.resumedOn)
  ))) return "paused";
  return "active";
}

export async function listRecurringExpenseSeries(locationId: number): Promise<RecurringExpenseSeriesView[]> {
  const [seriesRows, location] = await Promise.all([
    db.select().from(businessExpenseRecurringSeries)
      .where(eq(businessExpenseRecurringSeries.locationId, locationId))
      .orderBy(desc(businessExpenseRecurringSeries.createdAt), desc(businessExpenseRecurringSeries.id)),
    db.select({ timezone: locations.timezone }).from(locations).where(eq(locations.id, locationId)).then((rows) => rows[0]),
  ]);
  if (seriesRows.length === 0) return [];
  if (!location) throw new Error("LOCATION_NOT_FOUND");
  const today = getCalendarDateInTimeZone(new Date(), location.timezone);
  const seriesIds = seriesRows.map((series) => series.id);
  const [versionRows, pauseRows, occurrenceRows] = await Promise.all([
    db.select().from(businessExpenseRecurringVersions)
      .where(inArray(businessExpenseRecurringVersions.seriesId, seriesIds))
      .orderBy(asc(businessExpenseRecurringVersions.effectiveFrom), asc(businessExpenseRecurringVersions.id)),
    db.select().from(businessExpenseRecurringPauses)
      .where(inArray(businessExpenseRecurringPauses.seriesId, seriesIds))
      .orderBy(asc(businessExpenseRecurringPauses.pausedFrom), asc(businessExpenseRecurringPauses.id)),
    db.select().from(businessExpenses)
      .where(inArray(businessExpenses.recurringSeriesId, seriesIds))
      .orderBy(desc(businessExpenses.scheduledDate), desc(businessExpenses.id)),
  ]);
  return seriesRows.map((series) => {
    const versions = versionRows.filter((version) => version.seriesId === series.id).map((version) => ({
      id: version.id,
      effectiveFrom: version.effectiveFrom,
      category: version.category,
      description: version.description,
      amountCents: version.amountCents,
      recurrence: version.recurrence as RecurringExpenseFrequency,
      weekday: version.weekday,
      monthDay: version.monthDay,
      notes: version.notes,
      createdAt: version.createdAt,
    }));
    const currentVersion = [...versions].reverse().find((version) => version.effectiveFrom <= today) ?? versions[0];
    if (!currentVersion) throw new Error(`Recurring expense series ${series.id} has no version.`);
    const pauses = pauseRows.filter((pause) => pause.seriesId === series.id).map((pause) => ({
      id: pause.id,
      pausedFrom: pause.pausedFrom,
      resumedOn: pause.resumedOn,
      createdAt: pause.createdAt,
    }));
    const allOccurrences = occurrenceRows
      .filter((occurrence) => occurrence.recurringSeriesId === series.id && occurrence.scheduledDate !== null)
      .map((occurrence) => ({
        id: occurrence.id,
        scheduledDate: occurrence.scheduledDate!,
        category: occurrence.category,
        description: occurrence.description,
        amountCents: occurrence.amountCents,
        recurrence: occurrence.recurrence as RecurringExpenseFrequency,
        notes: occurrence.notes,
        isOccurrenceOverride: occurrence.isOccurrenceOverride,
        updatedAt: occurrence.updatedAt,
      }));
    const occurrences = allOccurrences.filter((occurrence) => occurrence.scheduledDate <= today);
    const status = effectiveSeriesStatus({ endedOn: series.endedOn, today, pauses });
    const nextSearchDate = occurrences.some((occurrence) => occurrence.scheduledDate === today)
      ? followingDate(today)
      : today;
    return {
      id: series.id,
      locationId: series.locationId,
      status,
      anchorDate: series.anchorDate,
      endedOn: series.endedOn,
      occurrenceCount: allOccurrences.length,
      hasOccurrences: allOccurrences.length > 0,
      locationToday: today,
      minimumFutureEffectiveFrom: followingDate(today),
      nextOccurrenceDate: nextSeriesOccurrenceDate({
        status,
        anchorDate: series.anchorDate,
        endedOn: series.endedOn,
        fromDate: nextSearchDate,
        versions,
        pauses,
      }),
      currentVersion,
      versions,
      pauses,
      occurrences,
    };
  });
}

export async function createRecurringExpenseSeries(input: {
  locationId: number;
  startDate: string;
  idempotencyKey: string;
  terms: RecurringExpenseTermsInput;
}) {
  return db.transaction(async (tx) => {
    await lockExpenseLocation(tx, input.locationId);
    await locationTimeZone(tx, input.locationId);
    const [existing] = await tx.select().from(businessExpenseRecurringSeries).where(and(
      eq(businessExpenseRecurringSeries.locationId, input.locationId),
      eq(businessExpenseRecurringSeries.creationKey, input.idempotencyKey),
    ));
    if (existing) {
      const [version] = await tx.select().from(businessExpenseRecurringVersions)
        .where(eq(businessExpenseRecurringVersions.seriesId, existing.id))
        .orderBy(asc(businessExpenseRecurringVersions.effectiveFrom), asc(businessExpenseRecurringVersions.id))
        .limit(1);
      const matches = existing.anchorDate === input.startDate
        && version?.category === input.terms.category
        && version?.description === input.terms.description
        && version?.amountCents === input.terms.amountCents
        && version?.recurrence === input.terms.recurrence
        && (version?.notes ?? null) === (input.terms.notes ?? null);
      if (!matches) throw new Error("IDEMPOTENCY_KEY_REUSED");
      return { series: existing, version, reused: true as const };
    }
    const [series] = await tx.insert(businessExpenseRecurringSeries).values({
      locationId: input.locationId,
      creationKey: input.idempotencyKey,
      anchorDate: input.startDate,
      status: "active",
    }).returning();
    const schedule = recurrenceSchedule(input.terms.recurrence, input.startDate);
    const [version] = await tx.insert(businessExpenseRecurringVersions).values({
      seriesId: series.id,
      effectiveFrom: input.startDate,
      ...input.terms,
      ...schedule,
    }).returning();
    return { series, version, reused: false as const };
  });
}

export async function updateRecurringExpenseSeries(input: {
  seriesId: number;
  locationId: number;
  startDate: string;
  terms: RecurringExpenseTermsInput;
}) {
  return db.transaction(async (tx) => {
    await lockExpenseLocation(tx, input.locationId);
    const series = await lockSeries(tx, input.seriesId);
    if (!series || series.locationId !== input.locationId) return null;
    if (await occurrenceCount(tx, series.id) > 0) throw new Error("SERIES_HAS_OCCURRENCES");
    await locationTimeZone(tx, input.locationId);

    await tx.delete(businessExpenseRecurringPauses)
      .where(eq(businessExpenseRecurringPauses.seriesId, series.id));
    await tx.delete(businessExpenseRecurringVersions)
      .where(eq(businessExpenseRecurringVersions.seriesId, series.id));
    const [updatedSeries] = await tx.update(businessExpenseRecurringSeries).set({
      anchorDate: input.startDate,
      status: "active",
      endedOn: null,
      updatedAt: new Date(),
    }).where(eq(businessExpenseRecurringSeries.id, series.id)).returning();
    const [version] = await tx.insert(businessExpenseRecurringVersions).values({
      seriesId: series.id,
      effectiveFrom: input.startDate,
      ...input.terms,
      ...recurrenceSchedule(input.terms.recurrence, input.startDate),
    }).returning();
    return { series: updatedSeries, version };
  });
}

export async function deleteRecurringExpenseSeries(input: { seriesId: number; locationId: number }) {
  return db.transaction(async (tx) => {
    await lockExpenseLocation(tx, input.locationId);
    const series = await lockSeries(tx, input.seriesId);
    if (!series || series.locationId !== input.locationId) return null;
    if (await occurrenceCount(tx, series.id) > 0) throw new Error("SERIES_HAS_OCCURRENCES");
    await tx.delete(businessExpenseRecurringSeries)
      .where(eq(businessExpenseRecurringSeries.id, series.id));
    return series;
  });
}

export async function createRecurringExpenseVersion(input: {
  seriesId: number;
  locationId: number;
  effectiveFrom: string;
  terms: RecurringExpenseTermsInput;
}) {
  return db.transaction(async (tx) => {
    await lockExpenseLocation(tx, input.locationId);
    const series = await lockSeries(tx, input.seriesId);
    if (!series || series.locationId !== input.locationId) return null;
    const timeZone = await locationTimeZone(tx, input.locationId);
    const today = getCalendarDateInTimeZone(new Date(), timeZone);
    if (series.endedOn && series.endedOn <= today) throw new Error("SERIES_ENDED");
    if (await occurrenceCount(tx, series.id) === 0) throw new Error("SERIES_WITHOUT_HISTORY_EDIT_INSTEAD");
    if (input.effectiveFrom <= today) throw new Error("FUTURE_EFFECTIVE_DATE_REQUIRED");
    if (series.endedOn && input.effectiveFrom >= series.endedOn) throw new Error("EFFECTIVE_DATE_AFTER_END");
    const [previousVersion] = await tx.select().from(businessExpenseRecurringVersions)
      .where(eq(businessExpenseRecurringVersions.seriesId, series.id))
      .orderBy(desc(businessExpenseRecurringVersions.effectiveFrom), desc(businessExpenseRecurringVersions.id))
      .limit(1);
    if (previousVersion && input.effectiveFrom < previousVersion.effectiveFrom) {
      throw new Error("VERSION_OUT_OF_ORDER");
    }
    const schedule = previousVersion?.recurrence === input.terms.recurrence
      ? { weekday: previousVersion.weekday, monthDay: previousVersion.monthDay }
      : recurrenceSchedule(input.terms.recurrence, input.effectiveFrom);
    const versionValues = {
      seriesId: series.id,
      effectiveFrom: input.effectiveFrom,
      ...input.terms,
      ...schedule,
    };
    const [version] = previousVersion?.effectiveFrom === input.effectiveFrom
      ? await tx.update(businessExpenseRecurringVersions)
        .set(versionValues)
        .where(eq(businessExpenseRecurringVersions.id, previousVersion.id))
        .returning()
      : await tx.insert(businessExpenseRecurringVersions).values(versionValues).returning();
    await tx.delete(businessExpenses).where(and(
      eq(businessExpenses.recurringSeriesId, series.id),
      gte(businessExpenses.scheduledDate, input.effectiveFrom),
      eq(businessExpenses.isOccurrenceOverride, false),
    ));
    await tx.update(businessExpenseRecurringSeries)
      .set({ updatedAt: new Date() })
      .where(eq(businessExpenseRecurringSeries.id, series.id));
    return version;
  });
}

export async function setRecurringExpenseSeriesState(input: {
  seriesId: number;
  locationId: number;
  action: "pause" | "resume" | "end";
  effectiveFrom: string;
  resumeOn?: string | null;
}) {
  return db.transaction(async (tx) => {
    await lockExpenseLocation(tx, input.locationId);
    const series = await lockSeries(tx, input.seriesId);
    if (!series || series.locationId !== input.locationId) return null;
    const timeZone = await locationTimeZone(tx, input.locationId);
    const today = getCalendarDateInTimeZone(new Date(), timeZone);
    const count = await occurrenceCount(tx, series.id);
    if (count === 0) throw new Error("SERIES_WITHOUT_HISTORY_DELETE_INSTEAD");
    if (series.endedOn && series.endedOn <= today) throw new Error("SERIES_ENDED");
    if (input.effectiveFrom < today) throw new Error("PAST_EFFECTIVE_DATE");
    if (input.action !== "resume" && input.effectiveFrom <= today) {
      throw new Error("FUTURE_EFFECTIVE_DATE_REQUIRED");
    }

    if (input.action === "pause") {
      if (input.resumeOn && input.resumeOn <= input.effectiveFrom) throw new Error("PAUSE_RANGE_INVALID");
      if (series.endedOn && (
        input.effectiveFrom >= series.endedOn
        || (input.resumeOn !== undefined && input.resumeOn !== null && input.resumeOn > series.endedOn)
      )) throw new Error("EFFECTIVE_DATE_AFTER_END");
      const pauses = await tx.select().from(businessExpenseRecurringPauses)
        .where(eq(businessExpenseRecurringPauses.seriesId, series.id));
      const overlaps = pauses.some((pause) => (
        (input.resumeOn === null || input.resumeOn === undefined || pause.pausedFrom < input.resumeOn)
        && (pause.resumedOn === null || input.effectiveFrom < pause.resumedOn)
      ));
      if (overlaps) throw new Error("PAUSE_OVERLAP");
      await tx.insert(businessExpenseRecurringPauses).values({
        seriesId: series.id,
        pausedFrom: input.effectiveFrom,
        resumedOn: input.resumeOn ?? null,
      });
      const pausedToday = input.effectiveFrom <= today && (!input.resumeOn || today < input.resumeOn);
      await tx.update(businessExpenseRecurringSeries).set({
        status: series.endedOn ? "ended" : pausedToday ? "paused" : "active",
        updatedAt: new Date(),
      })
        .where(eq(businessExpenseRecurringSeries.id, series.id));
    } else if (input.action === "resume") {
      const [openPause] = await tx.select().from(businessExpenseRecurringPauses).where(and(
        eq(businessExpenseRecurringPauses.seriesId, series.id),
        isNull(businessExpenseRecurringPauses.resumedOn),
      )).orderBy(desc(businessExpenseRecurringPauses.pausedFrom)).limit(1);
      if (!openPause || openPause.pausedFrom > input.effectiveFrom) throw new Error("OPEN_PAUSE_NOT_FOUND");
      const [pause] = await tx.update(businessExpenseRecurringPauses)
        .set({ resumedOn: input.effectiveFrom })
        .where(eq(businessExpenseRecurringPauses.id, openPause.id)).returning();
      if (!pause) throw new Error("OPEN_PAUSE_NOT_FOUND");
      await tx.update(businessExpenseRecurringSeries).set({
        status: series.endedOn ? "ended" : "active",
        updatedAt: new Date(),
      })
        .where(eq(businessExpenseRecurringSeries.id, series.id));
    } else {
      const [latestHistorical] = await tx.select({ scheduledDate: businessExpenses.scheduledDate })
        .from(businessExpenses)
        .where(and(
          eq(businessExpenses.recurringSeriesId, series.id),
          lte(businessExpenses.scheduledDate, today),
        ))
        .orderBy(desc(businessExpenses.scheduledDate))
        .limit(1);
      if (latestHistorical?.scheduledDate && input.effectiveFrom <= latestHistorical.scheduledDate) {
        throw new Error("END_DATE_BEFORE_HISTORY");
      }
      await tx.update(businessExpenseRecurringSeries)
        .set({ status: "ended", endedOn: input.effectiveFrom, updatedAt: new Date() })
        .where(eq(businessExpenseRecurringSeries.id, series.id));
    }
    await tx.delete(businessExpenses).where(and(
      eq(businessExpenses.recurringSeriesId, series.id),
      gte(businessExpenses.scheduledDate, input.effectiveFrom),
    ));
    return {
      ...series,
      status: input.action === "end" ? "ended" : series.endedOn ? "ended" : "active",
      endedOn: input.action === "end" ? input.effectiveFrom : series.endedOn,
      effectiveOn: input.effectiveFrom,
    };
  });
}

export async function updateRecurringExpenseOccurrence(input: {
  expenseId: number;
  locationId: number;
  terms: Pick<RecurringExpenseTermsInput, "category" | "description" | "amountCents" | "notes">;
}) {
  return db.transaction(async (tx) => {
    await lockExpenseLocation(tx, input.locationId);
    const [existing] = await tx.select().from(businessExpenses).where(and(
      eq(businessExpenses.id, input.expenseId),
      eq(businessExpenses.locationId, input.locationId),
    )).for("update");
    if (!existing?.recurringSeriesId) return null;
    const [updated] = await tx.update(businessExpenses).set({
      ...input.terms,
      isOccurrenceOverride: true,
      updatedAt: new Date(),
    }).where(eq(businessExpenses.id, existing.id)).returning();
    return updated;
  });
}

export async function materializeRecurringExpenseOccurrences(input: {
  locationId: number;
  startDate: string;
  endDate: string;
}) {
  if (process.env.USE_MEMORY_STORAGE === "true") return;
  await db.transaction(async (tx) => {
    await lockExpenseLocation(tx, input.locationId);
    const timeZone = await locationTimeZone(tx, input.locationId);
    const seriesRows = await tx.select().from(businessExpenseRecurringSeries)
      .where(eq(businessExpenseRecurringSeries.locationId, input.locationId));
    for (const series of seriesRows) {
      const [versions, pauses] = await Promise.all([
        tx.select().from(businessExpenseRecurringVersions)
          .where(eq(businessExpenseRecurringVersions.seriesId, series.id))
          .orderBy(asc(businessExpenseRecurringVersions.effectiveFrom), asc(businessExpenseRecurringVersions.id)),
        tx.select().from(businessExpenseRecurringPauses)
          .where(eq(businessExpenseRecurringPauses.seriesId, series.id))
          .orderBy(asc(businessExpenseRecurringPauses.pausedFrom)),
      ]);
      for (let index = 0; index < versions.length; index += 1) {
        const version = versions[index];
        const nextVersion = versions[index + 1];
        const from = [input.startDate, series.anchorDate, version.effectiveFrom].sort().at(-1)!;
        const through = nextVersion
          ? [input.endDate, previousDate(nextVersion.effectiveFrom)].sort().at(0)!
          : input.endDate;
        if (from > through) continue;
        const dates = recurringExpenseDates({
          anchorDate: series.anchorDate,
          from,
          through,
          endedOn: series.endedOn,
          schedule: {
            recurrence: version.recurrence as RecurringExpenseFrequency,
            weekday: version.weekday,
            monthDay: version.monthDay,
          },
          pauses: pauses.map((pause) => ({ pausedFrom: pause.pausedFrom, resumedOn: pause.resumedOn })),
        });
        if (dates.length === 0) continue;
        await tx.insert(businessExpenses).values(dates.map((scheduledDate) => ({
          locationId: series.locationId,
          category: version.category,
          description: version.description,
          amountCents: version.amountCents,
          expenseDate: getCalendarDateBounds(scheduledDate, timeZone).start,
          recurrence: version.recurrence as BusinessExpenseRecurrence,
          notes: version.notes,
          recurringSeriesId: series.id,
          recurringVersionId: version.id,
          scheduledDate,
          isOccurrenceOverride: false,
        }))).onConflictDoNothing();
      }
    }
  });
}
