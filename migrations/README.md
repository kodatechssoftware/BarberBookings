# Database migrations

Run the versioned migrations as a separate release step before starting code that uses the new schema:

```sh
npm run db:migrate
```

The runner uses `DATABASE_URL` and `DATABASE_SCHEMA`, records checksums in
`schema_migrations`, applies each file in its own transaction, and serializes
concurrent runners with a PostgreSQL advisory lock. Applied files must never be
edited; add a new numbered migration instead.

For a Production migration, explicitly review and set:

```ini
MIGRATION_DEFAULT_LOCATION_NAME=
MIGRATION_DEFAULT_LOCATION_ADDRESS=
MIGRATION_DEFAULT_LOCATION_TIME_ZONE=Europe/Lisbon
MIGRATION_DEFAULT_LOCATION_MAP_URL=
MIGRATION_DEFAULT_LOCATION_MAP_EMBED_URL=
```

The first migration refuses to run in Production without a non-empty name and
address or with an invalid timezone/URL. These values are only used when the
database has no location yet. Existing appointments, availability, expenses,
barbers, and services are associated with the resulting default location.

Application startup does not run these migrations. The older `ensure*`
functions remain temporarily available for isolated legacy DEV tooling, but
the server startup no longer invokes the multi-location or notification
foundation functions.
