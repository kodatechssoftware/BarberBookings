CREATE TABLE IF NOT EXISTS {{schema}}.service_categories (
  id serial PRIMARY KEY,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT service_categories_name_not_blank_check CHECK (btrim(name) <> ''),
  CONSTRAINT service_categories_sort_order_check CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS service_categories_name_ci_idx
  ON {{schema}}.service_categories (lower(btrim(name)));
CREATE INDEX IF NOT EXISTS service_categories_active_order_idx
  ON {{schema}}.service_categories (is_active, sort_order, id);

ALTER TABLE {{schema}}.services
  ADD COLUMN IF NOT EXISTS category_id integer;

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.services ADD CONSTRAINT services_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES {{schema}}.service_categories(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

CREATE INDEX IF NOT EXISTS services_category_id_idx
  ON {{schema}}.services (category_id);
