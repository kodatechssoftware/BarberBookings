import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
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
  const recurring = await import("../server/recurring-expenses");
  const database = await import("../server/db");
  const created = await recurring.createRecurringExpenseSeries({
    locationId,
    startDate: today,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    terms: {
      category: "utilities",
      description: "Energia semanal",
      amountCents: 2500,
      recurrence: "weekly",
      notes: "Contrato",
    },
  });
  const duplicateCreate = await recurring.createRecurringExpenseSeries({
    locationId,
    startDate: today,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    terms: {
      category: "utilities",
      description: "Energia semanal",
      amountCents: 2500,
      recurrence: "weekly",
      notes: "Contrato",
    },
  });
  assert.equal(duplicateCreate.series.id, created.series.id, "same creation key must be idempotent");

  const through = addDays(today, 42);
  await Promise.all([
    recurring.materializeRecurringExpenseOccurrences({ locationId, startDate: today, endDate: through }),
    recurring.materializeRecurringExpenseOccurrences({ locationId, startDate: today, endDate: through }),
  ]);
  const expectedDates = recurringExpenseDates({
    anchorDate: today,
    from: today,
    through,
    schedule: { recurrence: "weekly", weekday: new Date(`${today}T00:00:00.000Z`).getUTCDay(), monthDay: null },
  });
  const occurrences = await setupPool.query(`
    SELECT id, scheduled_date::text, amount_cents, recurring_version_id
    FROM business_expenses
    WHERE recurring_series_id = $1
    ORDER BY scheduled_date
  `, [created.series.id]);
  assert.equal(occurrences.rowCount, expectedDates.length, "concurrent materialization must be idempotent");
  assert.equal(new Set(occurrences.rows.map((row) => row.scheduled_date)).size, expectedDates.length);

  const concurrentVersionDate = expectedDates[1];
  await Promise.all([
    recurring.materializeRecurringExpenseOccurrences({ locationId, startDate: today, endDate: through }),
    recurring.createRecurringExpenseVersion({
      seriesId: created.series.id,
      locationId,
      effectiveFrom: concurrentVersionDate,
      terms: { category: "utilities", description: "Energia revista", amountCents: 3000, recurrence: "weekly", notes: null },
    }),
  ]);
  await recurring.materializeRecurringExpenseOccurrences({ locationId, startDate: today, endDate: through });
  const concurrentVersionRows = await setupPool.query(`
    SELECT scheduled_date::text, amount_cents
    FROM business_expenses
    WHERE recurring_series_id = $1 AND scheduled_date >= $2
    ORDER BY scheduled_date
  `, [created.series.id, concurrentVersionDate]);
  assert.equal(concurrentVersionRows.rowCount, expectedDates.length - 1);
  assert.equal(concurrentVersionRows.rows.every((row) => row.amount_cents === 3000), true,
    "materialization and a concurrent version change must serialize on the location");

  const firstOccurrence = occurrences.rows[0];
  await recurring.updateRecurringExpenseOccurrence({
    expenseId: Number(firstOccurrence.id),
    locationId,
    terms: { category: "utilities", description: "Energia corrigida", amountCents: 2600, notes: "Correção isolada" },
  });
  await recurring.createRecurringExpenseVersion({
    seriesId: created.series.id,
    locationId,
    effectiveFrom: expectedDates[1],
    terms: { category: "utilities", description: "Energia revista", amountCents: 3000, recurrence: "weekly", notes: null },
  });
  await recurring.materializeRecurringExpenseOccurrences({ locationId, startDate: today, endDate: through });
  const afterVersion = await setupPool.query(`
    SELECT scheduled_date::text, amount_cents, is_occurrence_override
    FROM business_expenses WHERE recurring_series_id = $1 ORDER BY scheduled_date
  `, [created.series.id]);
  assert.deepEqual(afterVersion.rows.slice(0, 2), [
    { scheduled_date: expectedDates[0], amount_cents: 2600, is_occurrence_override: true },
    { scheduled_date: expectedDates[1], amount_cents: 3000, is_occurrence_override: false },
  ]);
  assert.equal(
    Number((await setupPool.query(`
      SELECT coalesce(sum(amount_cents), 0) AS total
      FROM business_expenses WHERE recurring_series_id = $1
    `, [created.series.id])).rows[0].total),
    2600 + (expectedDates.length - 1) * 3000,
    "financial summaries and Excel read the same immutable occurrence values",
  );
  const storageModule = await import("../server/storage");
  const reportRows = await storageModule.storage.getBusinessExpenses({
    locationId,
    startDate: today,
    endDate: through,
    timeZone: "Europe/Lisbon",
  });
  assert.equal(reportRows.filter((expense) => expense.recurringSeriesId === created.series.id).length, expectedDates.length);
  assert.equal(
    reportRows.filter((expense) => expense.recurringSeriesId === created.series.id)
      .reduce((sum, expense) => sum + expense.amountCents, 0),
    2600 + (expectedDates.length - 1) * 3000,
    "the shared report/Excel storage path must not duplicate recurring occurrences",
  );
  const [seriesView] = await recurring.listRecurringExpenseSeries(locationId);
  assert.equal(seriesView.occurrences.length, 1, "series history exposes financial occurrences through today");
  assert.equal(seriesView.occurrences[0].amountCents, 2600);
  assert.equal(seriesView.occurrences[0].isOccurrenceOverride, true);
  assert.equal(seriesView.nextOccurrenceDate, expectedDates[1], "next occurrence skips today's materialized entry");

  const simultaneousEditDate = addDays(through, 7);
  await Promise.all([
    recurring.createRecurringExpenseVersion({
      seriesId: created.series.id,
      locationId,
      effectiveFrom: simultaneousEditDate,
      terms: { category: "utilities", description: "Edição concorrente A", amountCents: 4000, recurrence: "weekly", notes: null },
    }),
    recurring.createRecurringExpenseVersion({
      seriesId: created.series.id,
      locationId,
      effectiveFrom: simultaneousEditDate,
      terms: { category: "utilities", description: "Edição concorrente B", amountCents: 4100, recurrence: "weekly", notes: null },
    }),
  ]);
  const simultaneousVersions = await setupPool.query(`
    SELECT amount_cents
    FROM business_expense_recurring_versions
    WHERE series_id = $1 AND effective_from = $2
  `, [created.series.id, simultaneousEditDate]);
  assert.equal(simultaneousVersions.rowCount, 1, "simultaneous edits must leave one complete version");
  assert.equal([4000, 4100].includes(simultaneousVersions.rows[0].amount_cents), true);

  await Promise.all([
    recurring.setRecurringExpenseSeriesState({ seriesId: created.series.id, locationId, action: "pause" }),
    recurring.materializeRecurringExpenseOccurrences({ locationId, startDate: today, endDate: through }),
  ]);
  assert.equal(Number((await setupPool.query(`
    SELECT count(*) FROM business_expenses WHERE recurring_series_id = $1
  `, [created.series.id])).rows[0].count), 0, "a paused series must not rematerialize occurrences");
  await recurring.setRecurringExpenseSeriesState({ seriesId: created.series.id, locationId, action: "resume" });
  await recurring.materializeRecurringExpenseOccurrences({ locationId, startDate: today, endDate: through });
  let scheduledDates = (await setupPool.query(`
    SELECT scheduled_date::text FROM business_expenses WHERE recurring_series_id = $1 ORDER BY scheduled_date
  `, [created.series.id])).rows.map((row) => row.scheduled_date);
  assert.equal(scheduledDates.includes(expectedDates[0]), true);
  assert.equal(scheduledDates.includes(expectedDates[4]), true);

  await Promise.all([
    recurring.setRecurringExpenseSeriesState({ seriesId: created.series.id, locationId, action: "end" }),
    recurring.materializeRecurringExpenseOccurrences({ locationId, startDate: today, endDate: through }),
  ]);
  scheduledDates = (await setupPool.query(`
    SELECT scheduled_date::text FROM business_expenses WHERE recurring_series_id = $1 ORDER BY scheduled_date
  `, [created.series.id])).rows.map((row) => row.scheduled_date);
  assert.equal(scheduledDates.length, 0);

  const legacy = await setupPool.query("SELECT recurring_series_id, scheduled_date FROM business_expenses WHERE description = 'Legacy weekly label'");
  assert.deepEqual(legacy.rows[0], { recurring_series_id: null, scheduled_date: null });

  const secondLocation = await setupPool.query(`
    INSERT INTO locations (name, slug, address, timezone, is_active, is_default)
    VALUES ('Outra loja', 'outra-loja', 'Address', 'Europe/Lisbon', true, false)
    RETURNING id
  `);
  const secondLocationId = Number(secondLocation.rows[0].id);
  assert.deepEqual(await recurring.listRecurringExpenseSeries(secondLocationId), []);
  assert.equal((await recurring.listRecurringExpenseSeries(locationId)).length, 1);
  assert.equal(await recurring.createRecurringExpenseVersion({
    seriesId: created.series.id,
    locationId: secondLocationId,
    effectiveFrom: addDays(through, 7),
    terms: { category: "other", description: "Cross-location", amountCents: 1, recurrence: "weekly", notes: null },
  }), null);
  assert.equal(await recurring.setRecurringExpenseSeriesState({
    seriesId: created.series.id,
    locationId: secondLocationId,
    action: "pause",
  }), null);

  await assert.rejects(
    setupPool.query(`
      INSERT INTO business_expense_recurring_versions
        (series_id, effective_from, category, description, amount_cents, recurrence, weekday, month_day)
      VALUES ($1, $2, 'other', 'Invalid', 100, 'weekly', NULL, NULL)
    `, [created.series.id, addDays(through, 14)]),
    /business_expense_recurring_versions_terms_check/,
  );

  const aggregate = await setupPool.query(`
    SELECT count(*)::integer AS count, coalesce(sum(amount_cents), 0)::integer AS total
    FROM business_expenses WHERE recurring_series_id = $1
  `, [created.series.id]);
  assert.equal(aggregate.rows[0].count, scheduledDates.length);
  assert.equal(aggregate.rows[0].total, 0);
  console.log("Recurring expense migration, materialization, history, pause/resume/end, isolation and totals: PASS");
  await database.pool.end();
} finally {
  await setupPool?.end().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
  await rm(databaseDir, { recursive: true, force: true }).catch(() => undefined);
}
