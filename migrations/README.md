# Database migrations

For a brand-new, physically empty PostgreSQL schema, run:

```sh
npm run db:bootstrap
```

The bootstrap command installs the immutable DDL-only legacy baseline from
`database/baseline/0000_legacy_baseline.sql`, records its checksum, and then
applies migrations `0001` onward. It also safely resumes a partial versioned
installation and is a no-op when every migration is already present. Unknown,
mixed or non-contiguous schemas fail closed without being rebuilt. Do not edit
the baseline after it has been published, and do not use `drizzle-kit push` to
initialize a persistent deployment.

Existing installations that already have their legacy foundation can continue
to run the versioned migrations directly as a separate release step before
starting code that uses the new schema:

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
Migration `0014_barber_location_compensation.sql` converts the effective-dated
barber compensation history from a global barber rule into explicit rules per
barber and location. It copies `none` and commission histories to every known
location, including inactive historical associations, but stops and rolls back
for ambiguous shared chair-rent histories. It also adds database constraints
and immutable compensation snapshots for newly completed appointments.

Migration `0015_auth_users_foundation.sql` adds the canonical `users` identity,
location/global access scopes, explicit capability grants, digest-only user
invites, nullable legacy links from `admins` and `barbers`, and additive audit
actor references. It intentionally creates no users, changes no legacy login or
session path, and performs no identity backfill; that remains a separately
approved operation after the read-only legacy preflight. The explicit
`auth:backfill` command remains dry-run by default and is not part of startup or
the migration runner.

Migration `0016_blacklist_location_scope.sql` assigns every customer block to
an explicit location and adds the `finance.manage_compensation` capability to
the database constraint. A legacy block is retained at the canonical default
location and copied to every other location that already exists, preserving
the former global behaviour without choosing an arbitrary shop. New reads,
booking checks, removals and future-appointment cancellations are then scoped
to that location. The migration is additive and does not alter appointments or
customer contact data.

Migration `0017_service_buffers.sql` adds location-specific preparation and
cleanup buffers to service offers and immutable buffer snapshots to new
appointments. Existing offers and appointments receive zero-minute defaults.
The booked-appointment exclusion constraint uses the resulting operational
interval while commercial duration and price remain unchanged.

Migration `0018_recurring_expense_management.sql` adds location-scoped expense
series, effective-dated commercial versions, pause intervals, and immutable
occurrence references. `business_expenses` remains the occurrence ledger used
by financial summaries and Excel exports. Existing `once`, `weekly`, and
`monthly` rows are preserved byte-for-byte as legacy historical entries and
are never promoted automatically to active series because the previous model
did not store sufficient schedule intent.

Migration `0020_commercial_extras_internal_costs.sql` keeps the existing Extra
catalogue as customer-facing commercial additions, adds optional descriptions,
service applicability and per-appointment quantities, and introduces a wholly
separate internal cost/consumption catalogue with immutable appointment
snapshots. Existing Extra snapshots keep quantity one, no internal cost is
inferred from historical Extras or business expenses, and public-booking
availability remains disabled by default. Number `0019` is deliberately not
reused because it is reserved by the shared notification/reminder migration.

Application startup does not run these migrations. The older `ensure*`
functions remain temporarily available for isolated legacy DEV tooling, but
the server startup no longer invokes the multi-location or notification
foundation functions.
