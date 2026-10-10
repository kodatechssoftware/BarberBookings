# Authorization contract

Identity, professional profile and access are separate concepts:

- `AuthUser` is the login identity.
- `professionalId` links that identity to an operational professional profile.
- `AccessScope` grants capabilities explicitly. Linking a professional never grants access.

A global scope is valid across the installation. A location scope is valid only
for its `locationId`; receiving a location in a header or request does not grant
anything. Capabilities ending in `_own` apply only after the caller is verified
as the owner of the resource. `_team` is a separate grant and does not imply a
global scope. Global object identity and local configuration also remain separate:
local scopes cannot receive capabilities such as `team.manage_global` or
`catalog.manage_global`.

`administrator` and `professional` are the only functional presets in P1. A
future manager preset is intentionally not declared yet. Custom access is
represented by explicit capabilities on a scope rather than by a fake preset.

P1 is a pure shared contract. P2A adds dormant persistence for canonical users,
global/location scopes and explicit grants, while presets remain code-owned by
this module. Neither layer is connected to the legacy `admin`/`barber` login,
session, route guards or invite flow yet. The `auth:preflight` command only
classifies legacy identities inside a repeatable-read, read-only transaction;
it never creates users or links legacy records.

P2B keeps that runtime boundary. `auth:backfill` defaults to a dry run and only
applies `SAFE_AUTO` identities when explicitly invoked with `--apply`. Each
identity uses its own serializable transaction under one PostgreSQL advisory
lock. Legacy Admin identities receive a global `administrator` scope;
professional-only identities receive a local `professional` scope for every
active professional/location association. A linked professional profile still
grants no access by itself.

P3 introduces an explicit runtime cutover. `AUTH_RUNTIME_MODE=legacy` remains
the default and preserves the existing credential/session flow.
`AUTH_RUNTIME_MODE=canonical` starts only after migration `0015` is registered
and its tables/links are structurally present. In canonical mode login reads
only `users`; there is no fallback to legacy credential columns. Sessions store
only `userId` and `authVersion`, and every authenticated request reloads the
active identity, optional professional link and access scopes from PostgreSQL.
Changing/resetting a canonical password increments `authVersion`, invalidating
all older sessions. The legacy invite token transport remains temporarily
compatible, but accepting it writes the password only to `users.password_hash`.

Until P4 converts each route to its exact capability guard, only a global
administrator scope or a linked professional with an explicit `professional`
preset is projected into the legacy route shape. Other active canonical users
can authenticate and inspect `/api/admin/me`, but fail closed on legacy
`requireAuth`/`requireAdmin` routes rather than inheriting access from a profile
link.

P4A authorizes operational appointment, customer, finance and report paths by
ownership or explicit team capability. P4B applies the same fail-closed model
to management surfaces. Global professional/service identity remains protected
by global capabilities, while location membership, local catalogue terms,
schedules, Extras, expenses, compensation, customer blocking and local audit
access are evaluated against the selected location. Compensation uses its own
`finance.manage_compensation` capability; team management or finance read
access never substitutes for it. In legacy mode the existing Admin/Professional
guards remain the compatibility authority until the separately approved
cutover removes them.

P5A adds canonical backend lifecycle management without changing the legacy
runtime. New identities are invited through `users` and `user_invites`; tokens
are stored only as digests and canonical passwords are written only to
`users.password_hash`. Professional links remain optional identity links and
grant no access. Presets and explicit capabilities are persisted as a union of
grants, subject to the caller's grant ceiling. User/access mutations increment
`auth_version` where they affect an authenticated identity, and an advisory
transaction lock prevents concurrent mutations from removing the final active
global Administrator. These endpoints fail closed while
`AUTH_RUNTIME_MODE=legacy`; `admins`, `barbers.password` and `barber_invites`
remain compatibility-only until the separately approved cutover.

P6 provides a one-time bootstrap for a new canonical installation. It is
available only while `users` is empty and requires a high-entropy
`BOOTSTRAP_ADMIN_TOKEN` supplied through the environment and the `/setup`
form. A PostgreSQL transaction-scoped advisory lock serializes concurrent
attempts. The winning transaction creates one active canonical user and one
global `administrator` scope, without creating a legacy admin or professional.
The token is never stored or included in audit metadata; after any canonical
user exists, bootstrap remains closed regardless of user status.

P7 adds no runtime mode switch or schema. The read-only
`auth:cutover-check` command validates migrations, unresolved legacy cases,
identity links, login collisions, active-user access, the global Administrator
invariant, Professional one-to-one links, scope/capability coherence and closed
bootstrap state. The operational runbook keeps legacy mode authoritative until
all checks report `READY`, defines forced reauthentication at cutover, and
limits simple ENV rollback to a frozen window before canonical-only identity or
access mutations occur.
