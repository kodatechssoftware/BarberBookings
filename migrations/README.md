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

`0006_customer_notes_location.sql` associates each legacy customer note with
that existing default location without changing its contents or timestamps.
Migration `0009_customer_notes_contact_identity.sql` keeps those legacy values,
adds a normalized email identity, and allows notes to be identified by phone or
email within the same location and normalized customer name. Conflicting legacy
email identities stop explicitly instead of being merged automatically.
Migration `0010_location_branding.sql` adds an optional logo URL to each
location. Existing locations remain unchanged and continue to use the global
shop logo as their fallback.
Migration `0011_appointment_voucher_payment.sql` extends the existing
appointment payment-method constraint with `voucher`. It does not rewrite
legacy appointments or introduce split payments; a voucher settles the full
nominal appointment value while remaining distinct from cash/card receipts and
from a gifted service.
Migration `0012_service_location_offers.sql` moves the effective visibility of
each service from the legacy global flag to its existing `service_locations`
assignment. It preserves hidden services by marking their current assignments
inactive, then leaves the legacy global flag enabled. Price and duration data,
appointments, and service identities are not rewritten.
Migration `0013_barber_services_location.sql` replaces the global
barber/service permission with explicit per-location rows. Existing explicit
permissions are expanded only to locations shared by the barber and service;
legacy barbers with zero rows receive their currently implied local services.
Inactive location associations are preserved for future reactivation. The
migration stops and rolls back if an explicit legacy permission has no common
location, rather than silently discarding it.

Application startup does not run these migrations. The older `ensure*`
functions remain temporarily available for isolated legacy DEV tooling, but
the server startup no longer invokes the multi-location or notification
foundation functions.
