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
