-- Beauty v2: public professional profiles, qualifications and authorised testimonials.
-- Existing professionals and public pages remain unchanged until a location enables
-- teamProfiles and an administrator explicitly authorises and publishes a profile.

CREATE TABLE {{schema}}.barber_public_profiles (
  barber_id integer NOT NULL,
  location_id integer NOT NULL,
  slug text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  publication_authorized_at timestamp,
  publication_authorized_by_user_id integer REFERENCES {{schema}}.users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT barber_public_profiles_pkey PRIMARY KEY (barber_id, location_id),
  CONSTRAINT barber_public_profiles_barber_location_fkey
    FOREIGN KEY (barber_id, location_id)
    REFERENCES {{schema}}.barber_locations(barber_id, location_id)
    ON DELETE CASCADE,
  CONSTRAINT barber_public_profiles_slug_check
    CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) BETWEEN 1 AND 80),
  CONSTRAINT barber_public_profiles_display_order_check CHECK (display_order >= 0),
  CONSTRAINT barber_public_profiles_publication_check
    CHECK (is_published = false OR publication_authorized_at IS NOT NULL),
  CONSTRAINT barber_public_profiles_timestamps_check CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX barber_public_profiles_location_slug_idx
  ON {{schema}}.barber_public_profiles(location_id, slug);
CREATE INDEX barber_public_profiles_public_listing_idx
  ON {{schema}}.barber_public_profiles(location_id, display_order, barber_id)
  WHERE is_published = true;

CREATE TABLE {{schema}}.barber_qualifications (
  id serial PRIMARY KEY,
  barber_id integer NOT NULL,
  location_id integer NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  issuer text,
  completed_year integer,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  publication_authorized_at timestamp,
  publication_authorized_by_user_id integer REFERENCES {{schema}}.users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT barber_qualifications_barber_location_fkey
    FOREIGN KEY (barber_id, location_id)
    REFERENCES {{schema}}.barber_locations(barber_id, location_id)
    ON DELETE CASCADE,
  CONSTRAINT barber_qualifications_kind_check
    CHECK (kind IN ('course', 'training', 'diploma', 'certification')),
  CONSTRAINT barber_qualifications_title_check CHECK (btrim(title) <> '' AND length(title) <= 160),
  CONSTRAINT barber_qualifications_issuer_check CHECK (issuer IS NULL OR (btrim(issuer) <> '' AND length(issuer) <= 160)),
  CONSTRAINT barber_qualifications_year_check CHECK (completed_year IS NULL OR completed_year BETWEEN 1900 AND 2200),
  CONSTRAINT barber_qualifications_description_check CHECK (description IS NULL OR length(description) <= 1000),
  CONSTRAINT barber_qualifications_display_order_check CHECK (display_order >= 0),
  CONSTRAINT barber_qualifications_publication_check
    CHECK (is_published = false OR publication_authorized_at IS NOT NULL),
  CONSTRAINT barber_qualifications_timestamps_check CHECK (updated_at >= created_at)
);

CREATE INDEX barber_qualifications_profile_idx
  ON {{schema}}.barber_qualifications(location_id, barber_id, display_order, id);

CREATE TABLE {{schema}}.barber_testimonials (
  id serial PRIMARY KEY,
  barber_id integer NOT NULL,
  location_id integer NOT NULL,
  author_display_name text NOT NULL,
  quote text NOT NULL,
  source_label text,
  display_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  publication_authorized_at timestamp,
  publication_authorized_by_user_id integer REFERENCES {{schema}}.users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT barber_testimonials_barber_location_fkey
    FOREIGN KEY (barber_id, location_id)
    REFERENCES {{schema}}.barber_locations(barber_id, location_id)
    ON DELETE CASCADE,
  CONSTRAINT barber_testimonials_author_check
    CHECK (btrim(author_display_name) <> '' AND length(author_display_name) <= 100),
  CONSTRAINT barber_testimonials_quote_check CHECK (btrim(quote) <> '' AND length(quote) <= 1200),
  CONSTRAINT barber_testimonials_source_check CHECK (source_label IS NULL OR (btrim(source_label) <> '' AND length(source_label) <= 120)),
  CONSTRAINT barber_testimonials_display_order_check CHECK (display_order >= 0),
  CONSTRAINT barber_testimonials_publication_check
    CHECK (is_published = false OR publication_authorized_at IS NOT NULL),
  CONSTRAINT barber_testimonials_timestamps_check CHECK (updated_at >= created_at)
);

CREATE INDEX barber_testimonials_profile_idx
  ON {{schema}}.barber_testimonials(location_id, barber_id, display_order, id);
