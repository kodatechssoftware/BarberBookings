CREATE TABLE IF NOT EXISTS {{schema}}.business_feature_settings (
  id serial PRIMARY KEY,
  feature_name text NOT NULL,
  location_id integer REFERENCES {{schema}}.locations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT business_feature_settings_name_check CHECK (
    feature_name IN (
      'appointmentRequests',
      'teamProfiles',
      'googleReviews',
      'notificationDeliveryStatus',
      'consultationRole',
      'multiServiceAppointments'
    )
  ),
  CONSTRAINT business_feature_settings_timestamps_check CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS business_feature_settings_global_unique
  ON {{schema}}.business_feature_settings (feature_name)
  WHERE location_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS business_feature_settings_location_unique
  ON {{schema}}.business_feature_settings (feature_name, location_id)
  WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS business_feature_settings_location_idx
  ON {{schema}}.business_feature_settings (location_id)
  WHERE location_id IS NOT NULL;
