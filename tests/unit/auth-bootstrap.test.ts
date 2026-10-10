import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isBootstrapTokenConfigured,
  isValidBootstrapToken,
  MIN_BOOTSTRAP_TOKEN_LENGTH,
  validateBootstrapTokenConfiguration,
} from "../../server/auth-bootstrap";
import { canonicalBootstrapInputSchema } from "../../shared/auth";

const strongToken = "a".repeat(MIN_BOOTSTRAP_TOKEN_LENGTH);

test("bootstrap token configuration is fail-closed and compared without exposing it", () => {
  assert.equal(isBootstrapTokenConfigured({}), false);
  assert.equal(isBootstrapTokenConfigured({ BOOTSTRAP_ADMIN_TOKEN: "short" }), false);
  assert.equal(isBootstrapTokenConfigured({ BOOTSTRAP_ADMIN_TOKEN: strongToken }), true);
  assert.equal(isValidBootstrapToken(undefined, { BOOTSTRAP_ADMIN_TOKEN: strongToken }), false);
  assert.equal(isValidBootstrapToken("wrong", { BOOTSTRAP_ADMIN_TOKEN: strongToken }), false);
  assert.equal(isValidBootstrapToken(strongToken, { BOOTSTRAP_ADMIN_TOKEN: strongToken }), true);
  assert.throws(() => validateBootstrapTokenConfiguration({ BOOTSTRAP_ADMIN_TOKEN: "short" }));
  validateBootstrapTokenConfiguration({});
  validateBootstrapTokenConfiguration({ BOOTSTRAP_ADMIN_TOKEN: strongToken });
});

test("bootstrap input requires a valid identity and password", () => {
  const parsed = canonicalBootstrapInputSchema.parse({
    token: strongToken,
    displayName: "  Root Admin  ",
    email: "ROOT@EXAMPLE.TEST",
    password: "Secure-password-2026",
  });
  assert.equal(parsed.displayName, "Root Admin");
  assert.equal(parsed.email, "ROOT@EXAMPLE.TEST");
  assert.throws(() => canonicalBootstrapInputSchema.parse({
    token: strongToken,
    displayName: "",
    email: "invalid",
    password: "short",
  }));
});

test("bootstrap routes are canonical-only, rate-limited and precede location resolution", () => {
  const routes = readFileSync("server/routes.ts", "utf8");
  const service = readFileSync("server/auth-bootstrap.ts", "utf8");
  const statusRoute = routes.indexOf('app.get("/api/auth/bootstrap/status"');
  const createRoute = routes.indexOf('app.post("/api/auth/bootstrap"');
  const locationMiddleware = routes.indexOf('app.use("/api", async');
  assert(statusRoute > 0 && createRoute > statusRoute && locationMiddleware > createRoute);
  assert.match(routes, /canonicalBootstrapRateLimiter/);
  assert.match(routes, /authRuntimeMode !== "canonical"/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /preset_key[\s\S]*'administrator'/);
  assert.doesNotMatch(service, /INSERT INTO[^\n]*(admins|barbers)/);
  assert.doesNotMatch(service, /BOOTSTRAP_ADMIN_TOKEN[^\n]*(console|metadata)/);
});
