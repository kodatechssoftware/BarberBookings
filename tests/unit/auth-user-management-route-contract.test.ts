import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync("server/routes.ts", "utf8");
const management = readFileSync("server/auth-user-management.ts", "utf8");

test("P5A exposes canonical lifecycle endpoints behind explicit capability checks", () => {
  for (const expected of [
    'app.get("/api/admin/users", requireCanonicalUsersManage',
    'app.get("/api/admin/users/:id", requireCanonicalUsersManage',
    'app.post("/api/admin/users", requireCanonicalUsersManage',
    'app.patch("/api/admin/users/:id", requireCanonicalUsersManage',
    'app.put("/api/admin/users/:id/status", requireCanonicalUsersManage',
    'app.put("/api/admin/users/:id/professional", requireCanonicalUsersManage',
    'app.get("/api/admin/users/:id/access", requireAuth',
    'app.put("/api/admin/users/:id/access", requireAuth',
    'app.post("/api/admin/users/:id/invites", requireCanonicalUsersManage',
    'app.delete("/api/admin/users/:id/invites", requireCanonicalUsersManage',
    'app.post("/api/admin/users/:id/revoke-sessions", requireCanonicalUsersManage',
    'app.post("/api/user-invites/accept"',
    'app.post("/api/user-invites/validate"',
    'app.post("/api/account/password", requireAuth',
  ]) assert.ok(routes.includes(expected), expected);

  assert.match(routes, /authRuntimeMode !== "canonical"[\s\S]*Endpoint indisponível/);
  assert.match(routes, /enforceCanonicalCapability\(req, res, "users\.manage"\)/);
  assert.match(management, /hasCapabilityAtLocation\(actor\.access, "access\.manage"/);
  assert.match(routes, /createOrReplaceCanonicalProfessionalInvite/);
});

test("canonical management persists credentials only in users and never creates legacy admins", () => {
  assert.match(management, /UPDATE \$\{table\(schema, "users"\)}[\s\S]*password_hash/);
  assert.doesNotMatch(management, /INSERT INTO \$\{table\(schema, "admins"\)\}/);
  assert.doesNotMatch(management, /UPDATE \$\{table\(schema, "barbers"\)} SET password/);
});

test("last administrator and self-lockout checks are transaction-scoped", () => {
  assert.match(management, /pg_advisory_xact_lock/);
  assert.match(management, /assertGlobalAdministratorRemains/);
  assert.match(management, /SELF_LOCKOUT/);
  assert.match(management, /auth_version = auth_version \+ 1/);
});
