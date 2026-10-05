ALTER TABLE {{schema}}.locations
  ADD COLUMN IF NOT EXISTS logo_url text;
