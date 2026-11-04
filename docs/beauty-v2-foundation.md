# Beauty v2 - foundation and compatibility contract

This document freezes the technical rules for Beauty v2. It does not enable or
implement any of the six product features. Beauty v1 remains available at the
immutable `beauty-v1-stable-2026-11-04` tag.

## Feature flag contract

The six Beauty v2 capabilities have persisted settings in
`business_feature_settings`. Missing rows and new rows default to `false`.
Settings may be installation-wide (`location_id IS NULL`) or location-specific;
a location-specific row takes precedence.

`BEAUTY_V2_FEATURES_ENABLED` is the global master switch and defaults to
`false`. When it is false, every effective Beauty v2 feature is false regardless
of persisted settings. This is the emergency kill switch and the safe rollout
default. The protected admin API is:

- `GET /api/admin/beauty-v2/features[?locationId=...]`
- `PUT /api/admin/beauty-v2/features/:featureName`

Both routes require the global `settings.manage` capability in canonical auth,
and administrator access in legacy auth. Persisting `enabled: true` does not
bypass the master switch. No Beauty v1 behaviour reads these flags yet.

## Backwards-compatibility contract

- Existing routes, request fields, response fields and status semantics remain
  authoritative while a v2 flag is off.
- New response fields are additive and optional. Old clients must be able to
  ignore them safely.
- Existing appointment fields remain authoritative until an explicit dual-read
  migration has completed.
- Notification delivery telemetry must not change the appointment state machine.
- Barber and Beauty wording stays in the presentation layer, not domain data.

## Additive migration strategy

Use expand -> migrate -> contract:

1. **Expand:** add nullable columns, new tables, indexes and constraints that do
   not rewrite or reinterpret existing rows. New booleans default off.
2. **Migrate:** backfill separately, in bounded idempotent batches, while old and
   new application versions can run concurrently.
3. **Contract:** remove old structures only in a later release, after telemetry
   confirms no old reader remains and explicit approval is given.

Migrations are forward-only, checksum-controlled and rerunnable through the
bootstrap runner. Rollback during rollout uses the global switch, not a
destructive down migration. Remote migrations always require separate approval.

Migration `0023_beauty_v2_feature_settings.sql` is additive: it creates an empty
configuration table, changes no existing row and enables no feature.

## Regression matrix

| Profile | Command | Principal contract |
| --- | --- | --- |
| Barber/default | `npm run test:e2e:barber` | Barber UI, booking, monthly window and multi-location |
| Beauty core | `npm run test:e2e:beauty` | Theme, contrast, buffers, expenses, branding and reminders |
| Beauty canonical multi-location | `npm run test:beauty-canonical-multilocation` | Canonical permissions and location isolation on PostgreSQL |
| Full cross-product matrix | `npm run test:e2e:matrix` | All profiles above, sequentially with isolated servers |
| Feature flag resolver | `npm run test:beauty-v2-features` | Default-off, precedence and global kill switch |
| Database evolution | `npm run test:migrations` and `npm run test:database-bootstrap` | Real PostgreSQL migration and bootstrap compatibility |

Configuration-specific specs run only in their dedicated Playwright projects.
The default Barber project no longer reports Beauty-only skips or failures; the
same assertions still run under the Beauty profile.

## Scheduling invariants for the next phases

- Only confirmed appointments reserve time.
- Final approval or acceptance rechecks availability in the write transaction.
- Service segments use half-open intervals `[start, end)` plus buffers.
- Every professional and resource segment is locked and checked atomically.
- A proposed alternative remains a request until the client accepts it.
- Retries use idempotency keys and cannot create a second appointment.
- Concurrent approval and public booking yield one winner and one explicit
  conflict, never overlapping confirmed rows.

## Dependency vulnerability review - 2026-11-04

`npm audit` reports 11 moderate findings, with no high or critical findings. No
dependency was changed in this foundation phase.

| Chain | Exposure | Decision |
| --- | --- | --- |
| `@tailwindcss/typography` -> `postcss-selector-parser` | Build-time CSS parsing; no untrusted selector input at runtime | Keep pending Tailwind build regression tests. Audit proposes `0.5.4`, a backwards move marked semver-major. |
| `exceljs` -> `archiver`, `archiver-utils`, `readdir-glob`, `glob`, `minimatch`, `zip-stream` | Server-generated workbooks; no user-controlled glob patterns | Keep `exceljs@4.4.0`; audit proposes the major downgrade `3.4.0`, risking accounting exports. Evaluate upstream fixes or alternatives separately. |
| `exceljs` -> `uuid` | Transitive workbook dependency; this application does not call vulnerable buffer APIs | Retain with the same Excel export review; do not force a transitive override without workbook compatibility tests. |
| `rimraf` -> `glob` | Transitive tooling path, not a public application endpoint | Review with the owning dependency; no blind override. |

Before any dependency change: run CSS generation, Excel content assertions,
TypeScript, build and the full regression matrix.
