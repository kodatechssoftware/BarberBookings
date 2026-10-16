CREATE TABLE IF NOT EXISTS {{schema}}.business_expense_recurring_series (
  id serial PRIMARY KEY,
  location_id integer NOT NULL REFERENCES {{schema}}.locations(id) ON DELETE RESTRICT,
  creation_key text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  anchor_date date NOT NULL,
  ended_on date,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT business_expense_recurring_series_status_check
    CHECK (status IN ('active', 'paused', 'ended')),
  CONSTRAINT business_expense_recurring_series_ended_state_check
    CHECK (((status = 'ended' AND ended_on IS NOT NULL)
      OR (status <> 'ended' AND ended_on IS NULL)) IS TRUE)
);

CREATE INDEX IF NOT EXISTS business_expense_recurring_series_location_status_idx
  ON {{schema}}.business_expense_recurring_series (location_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS business_expense_recurring_series_location_creation_uidx
  ON {{schema}}.business_expense_recurring_series (location_id, creation_key);

CREATE TABLE IF NOT EXISTS {{schema}}.business_expense_recurring_versions (
  id serial PRIMARY KEY,
  series_id integer NOT NULL REFERENCES {{schema}}.business_expense_recurring_series(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  amount_cents integer NOT NULL,
  recurrence text NOT NULL,
  weekday integer,
  month_day integer,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT business_expense_recurring_versions_terms_check
    CHECK ((amount_cents BETWEEN 0 AND 10000000
      AND btrim(description) <> ''
      AND ((recurrence = 'weekly' AND weekday BETWEEN 0 AND 6 AND month_day IS NULL)
        OR (recurrence = 'monthly' AND month_day BETWEEN 1 AND 31 AND weekday IS NULL))) IS TRUE)
);

CREATE UNIQUE INDEX IF NOT EXISTS business_expense_recurring_versions_series_effective_uidx
  ON {{schema}}.business_expense_recurring_versions (series_id, effective_from);

CREATE TABLE IF NOT EXISTS {{schema}}.business_expense_recurring_pauses (
  id serial PRIMARY KEY,
  series_id integer NOT NULL REFERENCES {{schema}}.business_expense_recurring_series(id) ON DELETE CASCADE,
  paused_from date NOT NULL,
  resumed_on date,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT business_expense_recurring_pauses_range_check
    CHECK ((resumed_on IS NULL OR resumed_on >= paused_from) IS TRUE)
);

CREATE UNIQUE INDEX IF NOT EXISTS business_expense_recurring_pauses_open_uidx
  ON {{schema}}.business_expense_recurring_pauses (series_id)
  WHERE resumed_on IS NULL;

ALTER TABLE {{schema}}.business_expenses
  ADD COLUMN IF NOT EXISTS recurring_series_id integer,
  ADD COLUMN IF NOT EXISTS recurring_version_id integer,
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS is_occurrence_override boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.business_expenses'::regclass
      AND conname = 'business_expenses_recurring_series_fkey'
  ) THEN
    ALTER TABLE {{schema}}.business_expenses
      ADD CONSTRAINT business_expenses_recurring_series_fkey
      FOREIGN KEY (recurring_series_id)
      REFERENCES {{schema}}.business_expense_recurring_series(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.business_expenses'::regclass
      AND conname = 'business_expenses_recurring_version_fkey'
  ) THEN
    ALTER TABLE {{schema}}.business_expenses
      ADD CONSTRAINT business_expenses_recurring_version_fkey
      FOREIGN KEY (recurring_version_id)
      REFERENCES {{schema}}.business_expense_recurring_versions(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.business_expenses'::regclass
      AND conname = 'business_expenses_recurring_occurrence_check'
  ) THEN
    ALTER TABLE {{schema}}.business_expenses
      ADD CONSTRAINT business_expenses_recurring_occurrence_check
      CHECK (((recurring_series_id IS NULL AND recurring_version_id IS NULL AND scheduled_date IS NULL
          AND is_occurrence_override = false)
        OR (recurring_series_id IS NOT NULL AND recurring_version_id IS NOT NULL AND scheduled_date IS NOT NULL
          AND recurrence IN ('weekly', 'monthly'))) IS TRUE);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS business_expenses_recurring_occurrence_uidx
  ON {{schema}}.business_expenses (recurring_series_id, scheduled_date)
  WHERE recurring_series_id IS NOT NULL;

-- Existing rows, including rows historically labelled weekly/monthly, remain
-- immutable legacy occurrences. They are intentionally not promoted to active
-- series because the old model did not record schedule intent or an end date.
