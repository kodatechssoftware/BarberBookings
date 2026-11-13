-- Beauty v2: per-location official Google review links.
-- This migration stores configuration only. It does not call Google APIs, enable
-- billing, publish ratings/reviews, or modify the existing location map fields.

CREATE TABLE {{schema}}.location_google_review_settings (
  location_id integer PRIMARY KEY REFERENCES {{schema}}.locations(id) ON DELETE CASCADE,
  google_place_id text,
  google_maps_url text NOT NULL,
  google_review_request_url text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT location_google_review_settings_place_id_check CHECK (
    google_place_id IS NULL
    OR (
      google_place_id = btrim(google_place_id)
      AND length(google_place_id) BETWEEN 1 AND 512
      AND google_place_id ~ '^[A-Za-z0-9_-]+$'
    )
  ),
  CONSTRAINT location_google_review_settings_maps_url_check CHECK (
    length(google_maps_url) BETWEEN 1 AND 2048
    AND (
      google_maps_url ~ '^https://(www\.)?google\.com/maps(?:[/?#].*)?$'
      OR google_maps_url ~ '^https://maps\.google\.com(?:[/?#].*)?$'
    )
  ),
  CONSTRAINT location_google_review_settings_review_url_check CHECK (
    length(google_review_request_url) BETWEEN 1 AND 2048
    AND (
      google_review_request_url ~ '^https://search\.google\.com/local/writereview\?placeid=[A-Za-z0-9_-]+$'
      OR google_review_request_url ~ '^https://g\.page/r/[A-Za-z0-9_-]+/review$'
    )
  ),
  CONSTRAINT location_google_review_settings_timestamps_check CHECK (updated_at >= created_at)
);
