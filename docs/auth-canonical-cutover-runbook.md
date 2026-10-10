# Canonical authentication cutover runbook

This runbook changes an existing installation from `AUTH_RUNTIME_MODE=legacy`
to `canonical`. It does not remove legacy tables or credentials. Perform every
database command against the intended environment and replace `public` when
`DATABASE_SCHEMA` uses another schema.

## Change window and rollback boundary

Schedule a maintenance window. Until canonical smoke tests are accepted, do
not create users, accept canonical invitations, edit identity/email/password,
link or unlink Professionals, disable users, revoke sessions, or change access.
Those canonical-only mutations make a later legacy rollback operationally
incoherent because legacy credentials and roles are not updated by them.

The additive migrations and backfill alone are rollback-compatible. Never
delete `users`, links, scopes or migration records during rollback.

## 1. Backup and immutable evidence

1. Record the deployed Git SHA, `AUTH_RUNTIME_MODE` and `DATABASE_SCHEMA`.
2. Create a recoverable database snapshot immediately before the change.
3. Validate the backup with `pg_restore --list` or the provider equivalent.
4. Keep the application in `AUTH_RUNTIME_MODE=legacy` throughout migrations,
   preflight, review and backfill.

## 2. Apply the additive schema

Deploy/run the normal migration mechanism while still in legacy mode:

```sh
npm run db:migrate
```

Confirm read-only that these migrations are registered:

```sql
SELECT name, checksum, applied_at
FROM public.schema_migrations
WHERE name IN (
  '0015_auth_users_foundation.sql',
  '0016_blacklist_location_scope.sql'
)
ORDER BY name;
```

Both rows must exist. Do not continue on a checksum error or partial migration.

## 3. Legacy preflight and manual resolution

Capture the read-only report:

```sh
npm run auth:preflight > auth-preflight.json
```

Continue only when `classificationTotals.BLOCKER` and
`classificationTotals.MANUAL_REVIEW` are both zero. Different bcrypt strings
do not prove different passwords. Resolve each ambiguous identity explicitly,
then rerun the preflight. Never merge identities solely by display name.

## 4. Backfill dry run and apply

```sh
npm run auth:backfill -- --dry-run > auth-backfill-dry-run.json
npm run auth:backfill -- --apply > auth-backfill-applied.json
```

The apply report must have `FAILED = 0`. Rerun the preflight and the readiness
check after the apply:

```sh
npm run auth:preflight > auth-preflight-after.json
npm run auth:cutover-check > auth-cutover-check.json
```

`auth:cutover-check` is read-only, exits zero only for `READY`, and verifies:

- migrations 0015/0016;
- zero legacy `BLOCKER`/`MANUAL_REVIEW` cases;
- every legacy login is linked to a matching canonical identity;
- canonical login keys are unambiguous;
- active users have coherent scopes;
- at least one active global Administrator exists;
- Professional links remain one-to-one;
- presets/capabilities respect the code-owned registry and scope rules;
- bootstrap is closed because at least one canonical user exists.

Warnings do not change `READY`. Resolve or explicitly acknowledge them. Remove
`BOOTSTRAP_ADMIN_TOKEN` after confirming bootstrap is closed.

## 5. Invalidate sessions and activate canonical mode

Legacy session rows are ignored in canonical mode, but deleting them prevents
their resurrection during a quick rollback and guarantees reauthentication.
After confirming the backup, clear only the configured session table:

```sql
BEGIN;
SELECT count(*) AS sessions_to_invalidate FROM public.session;
DELETE FROM public.session;
COMMIT;
```

Then set, through the environment manager:

```ini
AUTH_RUNTIME_MODE=canonical
```

Do not change any other variable. Restart the application once. Startup must
pass `canonical-auth-foundation`; do not retry migrations or backfill blindly.

## 6. Smoke tests

Use controlled accounts and verify:

1. Legacy Administrator credentials authenticate as the linked canonical user.
2. Admin without Professional can open Admin and User & Access Management.
3. Admin + Professional appears as one user and retains both functions.
4. Professional can access only the approved own/team/location operations.
5. Another location is denied without a matching scope.
6. Disabled/invited users cannot authenticate.
7. Agenda, manual booking, customers, services, Extras, Dashboard and export
   follow their capability guards.
8. Password change or session revoke invalidates the old canonical session.
9. Audit records use `actor_user_id` and expose no password, hash or token.
10. `/api/auth/bootstrap/status` reports `available: false`.

Monitor authentication 401/403/409 rates, startup logs, session-store errors
and canonical audit events during the acceptance window.

## 7. Rollback

Rollback is safe during the frozen acceptance window:

```ini
AUTH_RUNTIME_MODE=legacy
```

Restart once and require all users to log in again. Leave migrations 0015/0016,
canonical users, links and scopes in place; they are additive and legacy mode
does not use them as authorization authority.

Rollback stops being semantically safe after canonical-only identity/access
operations, including:

- creating or inviting a canonical-only user;
- accepting a canonical invitation;
- changing canonical email, password or active/disabled state;
- linking/unlinking a Professional;
- changing presets, scopes or explicit capabilities;
- revoking canonical sessions or relying on a canonical-only account for work.

At that point, switching to legacy can restore stale passwords/roles, omit new
users, or grant broader legacy access than the canonical scopes. Treat recovery
as a separately planned data reconciliation, not a simple ENV rollback.
