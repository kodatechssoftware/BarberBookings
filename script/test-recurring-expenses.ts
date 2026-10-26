import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import ExcelJS from "exceljs";
import express from "express";
import pg from "pg";
import { runDatabaseBootstrap } from "../server/database-bootstrap";
import { getCalendarDateInTimeZone } from "../server/calendar-timezone";
import { recurringExpenseDates } from "../shared/business-expense-recurrence";

async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function firstDayOfMonth(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`;
}

function addMonths(dateKey: string, months: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, day));
  return date.toISOString().slice(0, 10);
}

function businessDayInstant(dateKey: string) {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

async function assertResponseOk(response: Response) {
  if (!response.ok) assert.fail(`HTTP ${response.status}: ${await response.text()}`);
}

function workbookTextValues(workbook: ExcelJS.Workbook) {
  const values: string[] = [];
  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value ?? ""))));
  }
  return values;
}

const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-recurring-expenses-pg-"));
const port = await availablePort();
const password = "recurring-expenses-test";
const postgres = new EmbeddedPostgres({
  databaseDir,
  port,
  user: "postgres",
  password,
  persistent: false,
  onLog: () => undefined,
  onError: () => undefined,
});
let setupPool: pg.Pool | undefined;
let routeServer: Server | undefined;

try {
  await postgres.initialise();
  await postgres.start();
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  setupPool = new pg.Pool({ connectionString: databaseUrl });
  const environment = {
    NODE_ENV: "test",
    APP_ENV: "development",
    MIGRATION_DEFAULT_LOCATION_NAME: "Beauty Expense Test",
    MIGRATION_DEFAULT_LOCATION_ADDRESS: "Test address",
    MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
  };
  const firstBootstrap = await runDatabaseBootstrap(setupPool, { environment });
  assert.ok(firstBootstrap.applied.includes("0018_recurring_expense_management.sql"));
  const secondBootstrap = await runDatabaseBootstrap(setupPool, { environment });
  assert.deepEqual(secondBootstrap.applied, []);

  const ledger = await setupPool.query("SELECT name FROM schema_migrations WHERE name = '0018_recurring_expense_management.sql'");
  assert.equal(ledger.rowCount, 1);
  assert.equal(Number((await setupPool.query("SELECT count(*) FROM users")).rows[0].count), 0);
  assert.equal(Number((await setupPool.query("SELECT count(*) FROM barbers")).rows[0].count), 0);
  assert.equal(Number((await setupPool.query("SELECT count(*) FROM admins")).rows[0].count), 0);

  const locationId = Number((await setupPool.query("SELECT id FROM locations WHERE is_default = true")).rows[0].id);
  const today = getCalendarDateInTimeZone(new Date(), "Europe/Lisbon");
  await setupPool.query(`
    INSERT INTO business_expenses (location_id, category, description, amount_cents, expense_date, recurrence)
    VALUES ($1, 'rent', 'Legacy weekly label', 1000, $2, 'weekly')
  `, [locationId, new Date(`${today}T00:00:00.000Z`)]);

  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_SCHEMA = "public";
  process.env.USE_MEMORY_STORAGE = "false";
  process.env.AUTH_RUNTIME_MODE = "legacy";
  process.env.MULTI_LOCATION_ENABLED = "false";
  process.env.SESSION_SECRET = "recurring-expenses-route-test-secret";
  process.env.ADMIN_INITIAL_PASSWORD = "Recurring-Expenses-Test-Admin-2026!";
  process.env.APPOINTMENT_NOTIFICATION_EVENTS_ENABLED = "false";
  process.env.NOTIFICATION_OUTBOX_WORKER_ENABLED = "false";
  const recurring = await import("../server/recurring-expenses");
  const database = await import("../server/db");
  const storageModule = await import("../server/storage");

  // A series with no materialized occurrence can be edited and deleted freely.
  const draftStart = addDays(today, 30);
  const draft = await recurring.createRecurringExpenseSeries({
    locationId,
    startDate: draftStart,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    terms: {
      category: "internet",
      description: "Subscricao futura",
      amountCents: 1500,
      recurrence: "monthly",
      notes: null,
    },
  });
  const draftLedgerBeforeRead = Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [draft.series.id],
  )).rows[0].count);
  const forecast = recurring.projectRecurringExpenseOccurrences({
    series: draft.series,
    versions: [draft.version],
    pauses: [],
    startDate: draftStart,
    endDate: addMonths(draftStart, 2),
  });
  assert.ok(forecast.length >= 2, "the pure forecast must calculate future occurrences");
  const futureRead = await storageModule.storage.getBusinessExpenses({
    locationId,
    startDate: draftStart,
    endDate: addMonths(draftStart, 2),
    timeZone: "Europe/Lisbon",
  });
  assert.equal(futureRead.some((expense) => expense.recurringSeriesId === draft.series.id), false);
  assert.equal(Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [draft.series.id],
  )).rows[0].count), draftLedgerBeforeRead, "forecast and future report reads must not persist");
  const futureOnlyMaterialization = await recurring.materializeDueRecurringExpenseOccurrences({
    locationId,
    startDate: draftStart,
    endDate: addMonths(draftStart, 2),
  });
  assert.equal(futureOnlyMaterialization.inserted, 0, "a future-only interval must be a no-op");
  const editedDraftStart = addDays(draftStart, 5);
  const editedDraft = await recurring.updateRecurringExpenseSeries({
    seriesId: draft.series.id,
    locationId,
    startDate: editedDraftStart,
    terms: {
      category: "internet",
      description: "Subscricao futura revista",
      amountCents: 1800,
      recurrence: "monthly",
      notes: "Sem impacto financeiro",
    },
  });
  assert.equal(editedDraft?.series.anchorDate, editedDraftStart);
  assert.equal(editedDraft?.version.amountCents, 1800);
  const draftView = (await recurring.listRecurringExpenseSeries(locationId)).find((item) => item.id === draft.series.id);
  assert.equal(draftView?.hasOccurrences, false);
  assert.equal(draftView?.occurrenceCount, 0);
  assert.ok(await recurring.deleteRecurringExpenseSeries({ seriesId: draft.series.id, locationId }));
  assert.equal(Number((await setupPool.query(
    "SELECT count(*) FROM business_expense_recurring_series WHERE id = $1",
    [draft.series.id],
  )).rows[0].count), 0);

  // Delete and materialization serialize on the same location lock. The result
  // must be either a clean deletion or a protected series with one occurrence.
  const raceStart = today;
  const raceSeries = await recurring.createRecurringExpenseSeries({
    locationId,
    startDate: raceStart,
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    terms: {
      category: "other",
      description: "Concorrencia delete/materializacao",
      amountCents: 900,
      recurrence: "weekly",
      notes: null,
    },
  });
  const [deleteRace, materializeRace] = await Promise.allSettled([
    recurring.deleteRecurringExpenseSeries({ seriesId: raceSeries.series.id, locationId }),
    recurring.materializeDueRecurringExpenseOccurrences({ locationId, startDate: raceStart, endDate: raceStart }),
  ]);
  assert.equal(materializeRace.status, "fulfilled");
  const raceState = await setupPool.query(`
    SELECT
      EXISTS (SELECT 1 FROM business_expense_recurring_series WHERE id = $1) AS series_exists,
      (SELECT count(*)::integer FROM business_expenses WHERE recurring_series_id = $1) AS occurrence_count
  `, [raceSeries.series.id]);
  if (raceState.rows[0].series_exists) {
    assert.equal(raceState.rows[0].occurrence_count, 1);
    assert.equal(deleteRace.status, "rejected");
    assert.match(String((deleteRace as PromiseRejectedResult).reason), /SERIES_HAS_OCCURRENCES/);
  } else {
    assert.equal(raceState.rows[0].occurrence_count, 0);
    assert.equal(deleteRace.status, "fulfilled");
  }

  // Financial history uses ledger occurrences: 300 -> 325 only from the
  // effective future date, while a one-off correction remains isolated.
  const monthlyAnchor = firstDayOfMonth(today);
  const monthlyThrough = addMonths(monthlyAnchor, 2);
  const monthlyDates = recurringExpenseDates({
    anchorDate: monthlyAnchor,
    from: monthlyAnchor,
    through: monthlyThrough,
    schedule: { recurrence: "monthly", weekday: null, monthDay: 1 },
  });
  assert.equal(monthlyDates.length, 3);
  const monthly = await recurring.createRecurringExpenseSeries({
    locationId,
    startDate: monthlyAnchor,
    idempotencyKey: "33333333-3333-4333-8333-333333333333",
    terms: {
      category: "rent",
      description: "Renda mensal",
      amountCents: 30000,
      recurrence: "monthly",
      notes: "Contrato",
    },
  });
  const duplicateMonthly = await recurring.createRecurringExpenseSeries({
    locationId,
    startDate: monthlyAnchor,
    idempotencyKey: "33333333-3333-4333-8333-333333333333",
    terms: {
      category: "rent",
      description: "Renda mensal",
      amountCents: 30000,
      recurrence: "monthly",
      notes: "Contrato",
    },
  });
  assert.equal(duplicateMonthly.series.id, monthly.series.id, "same creation key must be idempotent");
  const [firstDueRun, concurrentDueRun] = await Promise.all([
    recurring.materializeDueRecurringExpenseOccurrences({ locationId, startDate: monthlyAnchor, endDate: monthlyThrough }),
    recurring.materializeDueRecurringExpenseOccurrences({ locationId, startDate: monthlyAnchor, endDate: monthlyThrough }),
  ]);
  assert.equal(firstDueRun.effectiveEndDate, today);
  assert.equal(firstDueRun.inserted + concurrentDueRun.inserted, 1,
    "two instances must materialize one due occurrence");
  await assert.rejects(
    recurring.deleteRecurringExpenseSeries({ seriesId: monthly.series.id, locationId }),
    /SERIES_HAS_OCCURRENCES/,
  );
  await assert.rejects(
    recurring.updateRecurringExpenseSeries({
      seriesId: monthly.series.id,
      locationId,
      startDate: monthlyAnchor,
      terms: { category: "rent", description: "Rewrite forbidden", amountCents: 1, recurrence: "monthly", notes: null },
    }),
    /SERIES_HAS_OCCURRENCES/,
  );

  const newRentDate = monthlyDates[1];
  await recurring.createRecurringExpenseVersion({
    seriesId: monthly.series.id,
    locationId,
    effectiveFrom: newRentDate,
    terms: { category: "rent", description: "Renda mensal", amountCents: 32500, recurrence: "monthly", notes: "Novo valor" },
  });
  const beforeFutureReport = Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [monthly.series.id],
  )).rows[0].count);
  await storageModule.storage.getBusinessExpenses({
    locationId,
    startDate: newRentDate,
    endDate: monthlyThrough,
    timeZone: "Europe/Lisbon",
  });
  assert.equal(Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [monthly.series.id],
  )).rows[0].count), beforeFutureReport, "future report reads must not create the revised rent");
  const monthlyCountBeforeNovember = Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [monthly.series.id],
  )).rows[0].count);
  const novemberRun = await recurring.materializeDueRecurringExpenseOccurrences({
    locationId,
    startDate: monthlyAnchor,
    endDate: monthlyThrough,
    now: businessDayInstant(newRentDate),
  });
  assert.equal(novemberRun.effectiveEndDate, newRentDate);
  assert.equal(Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [monthly.series.id],
  )).rows[0].count), monthlyCountBeforeNovember + 1,
  "the revised rent is materialized exactly on its due business day");
  await Promise.all([
    recurring.materializeAllDueRecurringExpenseOccurrences(businessDayInstant(monthlyDates[2])),
    recurring.materializeAllDueRecurringExpenseOccurrences(businessDayInstant(monthlyDates[2])),
  ]);
  let monthlyRows = (await setupPool.query(`
    SELECT id, scheduled_date::text, amount_cents, is_occurrence_override
    FROM business_expenses
    WHERE recurring_series_id = $1
    ORDER BY scheduled_date
  `, [monthly.series.id])).rows;
  assert.deepEqual(monthlyRows.map((row) => row.amount_cents), [30000, 32500, 32500]);

  await recurring.updateRecurringExpenseOccurrence({
    expenseId: Number(monthlyRows[0].id),
    locationId,
    terms: { category: "rent", description: "Renda mensal corrigida", amountCents: 29000, notes: "Correcao isolada" },
  });
  await recurring.materializeDueRecurringExpenseOccurrences({
    locationId,
    startDate: monthlyAnchor,
    endDate: monthlyThrough,
    now: businessDayInstant(monthlyDates[2]),
  });
  monthlyRows = (await setupPool.query(`
    SELECT scheduled_date::text, amount_cents, is_occurrence_override
    FROM business_expenses
    WHERE recurring_series_id = $1
    ORDER BY scheduled_date
  `, [monthly.series.id])).rows;
  assert.deepEqual(monthlyRows, [
    { scheduled_date: monthlyDates[0], amount_cents: 29000, is_occurrence_override: true },
    { scheduled_date: monthlyDates[1], amount_cents: 32500, is_occurrence_override: false },
    { scheduled_date: monthlyDates[2], amount_cents: 32500, is_occurrence_override: false },
  ]);

  const monthlyReportRows = (await storageModule.storage.getBusinessExpenses({
    locationId,
    startDate: monthlyAnchor,
    endDate: monthlyThrough,
    timeZone: "Europe/Lisbon",
  })).filter((expense) => expense.recurringSeriesId === monthly.series.id);
  assert.equal(monthlyReportRows.length, 3, "Excel/report storage must not duplicate recurring occurrences");
  assert.equal(monthlyReportRows.reduce((sum, expense) => sum + expense.amountCents, 0), 94000);

  const monthlyView = (await recurring.listRecurringExpenseSeries(locationId)).find((item) => item.id === monthly.series.id)!;
  assert.equal(monthlyView.hasOccurrences, true);
  assert.equal(monthlyView.occurrenceCount, 1, "future simulated occurrences do not count as history today");
  assert.equal(monthlyView.occurrences[0].amountCents, 29000);
  assert.equal(monthlyView.occurrences[0].isOccurrenceOverride, true);
  assert.equal(monthlyView.nextOccurrenceDate, monthlyDates[1]);

  const countBeforeRepeatedStartup = Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [monthly.series.id],
  )).rows[0].count);
  await recurring.materializeAllDueRecurringExpenseOccurrences(businessDayInstant(monthlyDates[2]));
  await recurring.materializeAllDueRecurringExpenseOccurrences(businessDayInstant(monthlyDates[2]));
  assert.equal(Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [monthly.series.id],
  )).rows[0].count), countBeforeRepeatedStartup, "repeated startup normalization must be idempotent");

  let workerTicks = 0;
  const stopWorker = recurring.startRecurringExpenseMaterializationWorker(5, {
    materialize: async (now) => {
      workerTicks += 1;
      return recurring.materializeAllDueRecurringExpenseOccurrences(now);
    },
    now: () => businessDayInstant(monthlyDates[2]),
    reportError: (error) => assert.fail(`worker failed: ${String(error)}`),
  });
  await new Promise((resolve) => setTimeout(resolve, 35));
  stopWorker();
  assert.ok(workerTicks >= 2, "the worker must run repeatedly");
  assert.equal(Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [monthly.series.id],
  )).rows[0].count), countBeforeRepeatedStartup, "repeated worker ticks must not duplicate occurrences");

  await setupPool.query(`
    UPDATE business_expenses
    SET is_occurrence_override = true
    WHERE recurring_series_id = $1 AND scheduled_date = $2
  `, [monthly.series.id, monthlyDates[1]]);
  await assert.rejects(
    recurring.setRecurringExpenseSeriesState({
      seriesId: monthly.series.id,
      locationId,
      action: "pause",
      effectiveFrom: monthlyDates[1],
      resumeOn: monthlyDates[2],
    }),
    /FUTURE_OCCURRENCE_OVERRIDE_REQUIRES_REVIEW/,
    "future overrides must require manual review instead of being deleted",
  );
  const futureOverrideAfterRejectedChange = await setupPool.query(`
    SELECT is_occurrence_override
    FROM business_expenses
    WHERE recurring_series_id = $1 AND scheduled_date = $2
  `, [monthly.series.id, monthlyDates[1]]);
  assert.equal(futureOverrideAfterRejectedChange.rows[0]?.is_occurrence_override, true);

  const simultaneousEditDate = addMonths(monthlyAnchor, 3);
  await Promise.all([
    recurring.createRecurringExpenseVersion({
      seriesId: monthly.series.id,
      locationId,
      effectiveFrom: simultaneousEditDate,
      terms: { category: "rent", description: "Edicao concorrente A", amountCents: 40000, recurrence: "monthly", notes: null },
    }),
    recurring.createRecurringExpenseVersion({
      seriesId: monthly.series.id,
      locationId,
      effectiveFrom: simultaneousEditDate,
      terms: { category: "rent", description: "Edicao concorrente B", amountCents: 41000, recurrence: "monthly", notes: null },
    }),
  ]);
  const simultaneousVersions = await setupPool.query(`
    SELECT amount_cents
    FROM business_expense_recurring_versions
    WHERE series_id = $1 AND effective_from = $2
  `, [monthly.series.id, simultaneousEditDate]);
  assert.equal(simultaneousVersions.rowCount, 1, "simultaneous edits must leave one complete version");
  assert.equal([40000, 41000].includes(simultaneousVersions.rows[0].amount_cents), true);

  // Pauses and termination are future-effective and serialize with explicit
  // due materialization. Historical occurrences remain unchanged.
  const weeklyThrough = addDays(today, 70);
  const weeklyDates = recurringExpenseDates({
    anchorDate: today,
    from: today,
    through: weeklyThrough,
    schedule: { recurrence: "weekly", weekday: new Date(`${today}T00:00:00.000Z`).getUTCDay(), monthDay: null },
  });
  const weekly = await recurring.createRecurringExpenseSeries({
    locationId,
    startDate: today,
    idempotencyKey: "44444444-4444-4444-8444-444444444444",
    terms: {
      category: "staff",
      description: "Limpeza semanal",
      amountCents: 5000,
      recurrence: "weekly",
      notes: null,
    },
  });
  await recurring.materializeDueRecurringExpenseOccurrences({ locationId, startDate: today, endDate: weeklyThrough });
  await assert.rejects(
    recurring.setRecurringExpenseSeriesState({
      seriesId: weekly.series.id,
      locationId,
      action: "pause",
      effectiveFrom: today,
    }),
    /FUTURE_EFFECTIVE_DATE_REQUIRED/,
    "pausing must not remove an occurrence that is already applicable today",
  );
  await assert.rejects(
    recurring.setRecurringExpenseSeriesState({
      seriesId: weekly.series.id,
      locationId,
      action: "end",
      effectiveFrom: today,
    }),
    /FUTURE_EFFECTIVE_DATE_REQUIRED/,
    "termination must not remove an occurrence that is already applicable today",
  );
  await Promise.all([
    recurring.setRecurringExpenseSeriesState({
      seriesId: weekly.series.id,
      locationId,
      action: "pause",
      effectiveFrom: weeklyDates[2],
      resumeOn: weeklyDates[4],
    }),
    recurring.materializeDueRecurringExpenseOccurrences({
      locationId,
      startDate: today,
      endDate: weeklyThrough,
      now: businessDayInstant(weeklyThrough),
    }),
  ]);
  await recurring.materializeDueRecurringExpenseOccurrences({
    locationId,
    startDate: today,
    endDate: weeklyThrough,
    now: businessDayInstant(weeklyThrough),
  });
  let weeklyScheduledDates = (await setupPool.query(`
    SELECT scheduled_date::text FROM business_expenses
    WHERE recurring_series_id = $1 ORDER BY scheduled_date
  `, [weekly.series.id])).rows.map((row) => row.scheduled_date);
  assert.equal(weeklyScheduledDates.includes(weeklyDates[0]), true);
  assert.equal(weeklyScheduledDates.includes(weeklyDates[1]), true);
  assert.equal(weeklyScheduledDates.includes(weeklyDates[2]), false);
  assert.equal(weeklyScheduledDates.includes(weeklyDates[3]), false);
  assert.equal(weeklyScheduledDates.includes(weeklyDates[4]), true);

  await recurring.setRecurringExpenseSeriesState({
    seriesId: weekly.series.id,
    locationId,
    action: "pause",
    effectiveFrom: weeklyDates[5],
    resumeOn: null,
  });
  await recurring.setRecurringExpenseSeriesState({
    seriesId: weekly.series.id,
    locationId,
    action: "resume",
    effectiveFrom: weeklyDates[6],
  });
  await recurring.materializeDueRecurringExpenseOccurrences({
    locationId,
    startDate: today,
    endDate: weeklyThrough,
    now: businessDayInstant(weeklyThrough),
  });
  weeklyScheduledDates = (await setupPool.query(`
    SELECT scheduled_date::text FROM business_expenses
    WHERE recurring_series_id = $1 ORDER BY scheduled_date
  `, [weekly.series.id])).rows.map((row) => row.scheduled_date);
  assert.equal(weeklyScheduledDates.includes(weeklyDates[5]), false);
  assert.equal(weeklyScheduledDates.includes(weeklyDates[6]), true);

  const endDate = weeklyDates[8];
  await Promise.all([
    recurring.setRecurringExpenseSeriesState({
      seriesId: weekly.series.id,
      locationId,
      action: "end",
      effectiveFrom: endDate,
    }),
    recurring.materializeDueRecurringExpenseOccurrences({
      locationId,
      startDate: today,
      endDate: weeklyThrough,
      now: businessDayInstant(weeklyThrough),
    }),
  ]);
  await recurring.materializeDueRecurringExpenseOccurrences({
    locationId,
    startDate: today,
    endDate: weeklyThrough,
    now: businessDayInstant(weeklyThrough),
  });
  weeklyScheduledDates = (await setupPool.query(`
    SELECT scheduled_date::text FROM business_expenses
    WHERE recurring_series_id = $1 ORDER BY scheduled_date
  `, [weekly.series.id])).rows.map((row) => row.scheduled_date);
  assert.equal(weeklyScheduledDates.every((date) => date < endDate), true);
  assert.equal(weeklyScheduledDates.includes(weeklyDates[0]), true, "termination preserves prior history");
  assert.deepEqual(weeklyScheduledDates, [weeklyDates[0], weeklyDates[1], weeklyDates[4], weeklyDates[6], weeklyDates[7]]);

  const weeklyReportRows = (await storageModule.storage.getBusinessExpenses({
    locationId,
    startDate: today,
    endDate: weeklyThrough,
    timeZone: "Europe/Lisbon",
  })).filter((expense) => expense.recurringSeriesId === weekly.series.id);
  assert.deepEqual(
    weeklyReportRows.map((expense) => expense.scheduledDate).sort(),
    weeklyScheduledDates,
    "Excel/report output must equal the occurrence ledger after pause and termination",
  );
  assert.equal(weeklyReportRows.reduce((sum, expense) => sum + expense.amountCents, 0), weeklyScheduledDates.length * 5000);

  const legacy = await setupPool.query("SELECT id, recurrence, recurring_series_id, scheduled_date FROM business_expenses WHERE description = 'Legacy weekly label'");
  assert.deepEqual({
    recurrence: legacy.rows[0].recurrence,
    recurring_series_id: legacy.rows[0].recurring_series_id,
    scheduled_date: legacy.rows[0].scheduled_date,
  }, { recurrence: "weekly", recurring_series_id: null, scheduled_date: null });
  const legacyExpenseId = Number(legacy.rows[0].id);

  const secondLocation = await setupPool.query(`
    INSERT INTO locations (name, slug, address, timezone, is_active, is_default)
    VALUES ('Outra loja', 'outra-loja', 'Address', 'Europe/Lisbon', true, false)
    RETURNING id
  `);
  const secondLocationId = Number(secondLocation.rows[0].id);
  assert.deepEqual(await recurring.listRecurringExpenseSeries(secondLocationId), []);
  assert.ok((await recurring.listRecurringExpenseSeries(locationId)).length >= 2);
  assert.equal(await recurring.createRecurringExpenseVersion({
    seriesId: monthly.series.id,
    locationId: secondLocationId,
    effectiveFrom: addMonths(monthlyAnchor, 4),
    terms: { category: "other", description: "Cross-location", amountCents: 1, recurrence: "monthly", notes: null },
  }), null);
  assert.equal(await recurring.setRecurringExpenseSeriesState({
    seriesId: monthly.series.id,
    locationId: secondLocationId,
    action: "pause",
    effectiveFrom: addDays(today, 1),
  }), null);

  const aheadLocation = await setupPool.query(`
    INSERT INTO locations (name, slug, address, timezone, is_active, is_default)
    VALUES ('Ahead timezone', 'ahead-timezone', 'Address', 'Pacific/Kiritimati', true, false)
    RETURNING id
  `);
  const behindLocation = await setupPool.query(`
    INSERT INTO locations (name, slug, address, timezone, is_active, is_default)
    VALUES ('Behind timezone', 'behind-timezone', 'Address', 'America/Adak', true, false)
    RETURNING id
  `);
  const aheadLocationId = Number(aheadLocation.rows[0].id);
  const behindLocationId = Number(behindLocation.rows[0].id);
  const timezoneDueDate = "2030-01-02";
  const createTimezoneSeries = (targetLocationId: number, key: string) => recurring.createRecurringExpenseSeries({
    locationId: targetLocationId,
    startDate: timezoneDueDate,
    idempotencyKey: key,
    terms: {
      category: "other",
      description: "Timezone due expense",
      amountCents: 1000,
      recurrence: "monthly",
      notes: null,
    },
  });
  const aheadSeries = await createTimezoneSeries(aheadLocationId, "55555555-5555-4555-8555-555555555555");
  const behindSeries = await createTimezoneSeries(behindLocationId, "66666666-6666-4666-8666-666666666666");
  const sharedInstant = new Date("2030-01-01T10:30:00.000Z");
  const aheadResult = await recurring.materializeDueRecurringExpenseOccurrences({
    locationId: aheadLocationId,
    endDate: timezoneDueDate,
    now: sharedInstant,
  });
  const behindResult = await recurring.materializeDueRecurringExpenseOccurrences({
    locationId: behindLocationId,
    endDate: timezoneDueDate,
    now: sharedInstant,
  });
  assert.equal(aheadResult.businessToday, "2030-01-02");
  assert.equal(behindResult.businessToday, "2030-01-01");
  assert.equal(aheadResult.inserted, 1);
  assert.equal(behindResult.inserted, 0);
  assert.equal(Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [aheadSeries.series.id],
  )).rows[0].count), 1);
  assert.equal(Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [behindSeries.series.id],
  )).rows[0].count), 0);

  // The real HTTP report and Excel routes are reads: a future range must not
  // materialize its recurring series, while due ledger rows remain exportable.
  const httpFutureStart = addMonths(monthlyAnchor, 12);
  const httpFutureSeries = await recurring.createRecurringExpenseSeries({
    locationId,
    startDate: httpFutureStart,
    idempotencyKey: "77777777-7777-4777-8777-777777777777",
    terms: {
      category: "insurance",
      description: "Future HTTP forecast only",
      amountCents: 8800,
      recurrence: "monthly",
      notes: null,
    },
  });
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  routeServer = createServer(app);
  const { registerRoutes } = await import("../server/routes");
  await registerRoutes(app, routeServer);
  await new Promise<void>((resolve, reject) => routeServer!.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = routeServer.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const loginResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD }),
  });
  await assertResponseOk(loginResponse);
  const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
  assert(cookie);
  const requestHeaders = { cookie };
  const legacyUpdateResponse = await fetch(`${baseUrl}/api/admin/expenses/${legacyExpenseId}`, {
    method: "PATCH",
    headers: { ...requestHeaders, "content-type": "application/json" },
    body: JSON.stringify({ notes: "Updated without changing recurrence" }),
  });
  await assertResponseOk(legacyUpdateResponse);
  const legacyUpdate = await legacyUpdateResponse.json() as { recurrence: string };
  assert.equal(legacyUpdate.recurrence, "weekly", "PATCH omitting recurrence must preserve a legacy value");
  assert.equal((await setupPool.query(
    "SELECT recurrence FROM business_expenses WHERE id = $1",
    [legacyExpenseId],
  )).rows[0].recurrence, "weekly");
  const futureEnd = addMonths(httpFutureStart, 2);
  const futureCountBeforeHttp = Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [httpFutureSeries.series.id],
  )).rows[0].count);
  const futureReportResponse = await fetch(
    `${baseUrl}/api/admin/expenses?startDate=${httpFutureStart}&endDate=${futureEnd}&category=all`,
    { headers: requestHeaders },
  );
  await assertResponseOk(futureReportResponse);
  const futureReport = await futureReportResponse.json() as Array<{ recurringSeriesId?: number | null }>;
  assert.equal(futureReport.some((expense) => expense.recurringSeriesId === httpFutureSeries.series.id), false);
  assert.equal(Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [httpFutureSeries.series.id],
  )).rows[0].count), futureCountBeforeHttp, "GET future must not alter the ledger");

  const futureExportResponse = await fetch(
    `${baseUrl}/api/admin/export?startDate=${httpFutureStart}&endDate=${futureEnd}&barberId=all`,
    { headers: requestHeaders },
  );
  await assertResponseOk(futureExportResponse);
  const futureWorkbook = new ExcelJS.Workbook();
  await futureWorkbook.xlsx.load(Buffer.from(await futureExportResponse.arrayBuffer()));
  const futureWorkbookValues = workbookTextValues(futureWorkbook);
  assert.equal(futureWorkbookValues.includes("Future HTTP forecast only"), false,
    "normal Excel must not contain forecasts");
  assert.equal(Number((await setupPool.query(
    "SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1",
    [httpFutureSeries.series.id],
  )).rows[0].count), futureCountBeforeHttp, "future Excel export must not alter the ledger");

  const dueExportResponse = await fetch(
    `${baseUrl}/api/admin/export?startDate=${monthlyAnchor}&endDate=${today}&barberId=all`,
    { headers: requestHeaders },
  );
  await assertResponseOk(dueExportResponse);
  const dueWorkbook = new ExcelJS.Workbook();
  await dueWorkbook.xlsx.load(Buffer.from(await dueExportResponse.arrayBuffer()));
  const dueWorkbookValues = workbookTextValues(dueWorkbook);
  assert.ok(dueWorkbookValues.includes("Renda mensal corrigida"),
    `a real workbook must contain the due recurring occurrence: sheets=${JSON.stringify(dueWorkbook.worksheets.map((sheet) => sheet.name))}`);
  const futureSeriesView = (await recurring.listRecurringExpenseSeries(locationId))
    .find((item) => item.id === httpFutureSeries.series.id);
  assert.equal(futureSeriesView?.hasOccurrences, false);
  assert.ok(await recurring.updateRecurringExpenseSeries({
    seriesId: httpFutureSeries.series.id,
    locationId,
    startDate: addDays(httpFutureStart, 1),
    terms: {
      category: "insurance",
      description: "Future HTTP forecast edited",
      amountCents: 9000,
      recurrence: "monthly",
      notes: null,
    },
  }), "a future-only series remains editable after GET/export");
  assert.ok(await recurring.deleteRecurringExpenseSeries({
    seriesId: httpFutureSeries.series.id,
    locationId,
  }), "a future-only series remains deletable after GET/export");

  await assert.rejects(
    setupPool.query(`
      INSERT INTO business_expense_recurring_versions
        (series_id, effective_from, category, description, amount_cents, recurrence, weekday, month_day)
      VALUES ($1, $2, 'other', 'Invalid', 100, 'weekly', NULL, NULL)
    `, [monthly.series.id, addMonths(monthlyAnchor, 5)]),
    /business_expense_recurring_versions_terms_check/,
  );

  console.log("Recurring expenses due-only materialization, read-only GET/Excel, worker/startup idempotence, immutable ledger, timezone isolation and legacy regressions: PASS");
  await new Promise<void>((resolve) => routeServer!.close(() => resolve()));
  routeServer = undefined;
  await database.pool.end();
} finally {
  if (routeServer) await new Promise<void>((resolve) => routeServer!.close(() => resolve())).catch(() => undefined);
  await setupPool?.end().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
  await rm(databaseDir, { recursive: true, force: true }).catch(() => undefined);
}
