import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import {
  clearAuthenticatedSessionIdentity,
  destroyAuthenticatedSession,
  establishCanonicalSession,
  establishLegacySession,
} from "../../server/auth-session";

function requestFixture(initial: Record<string, unknown> = {}) {
  let regenerateCalls = 0;
  let saveCalls = 0;
  let destroyCalls = 0;
  const request = { session: undefined } as unknown as Request;
  const makeSession = (values: Record<string, unknown>) => ({
    ...values,
    regenerate(callback: (error?: Error) => void) {
      regenerateCalls += 1;
      request.session = makeSession({}) as Request["session"];
      callback();
    },
    save(callback: (error?: Error) => void) {
      saveCalls += 1;
      callback();
    },
    destroy(callback: (error?: Error) => void) { destroyCalls += 1; callback(); },
    reload() {}, touch() {}, resetMaxAge() {},
    id: `session-${regenerateCalls}`,
    cookie: {},
  });
  request.session = makeSession(initial) as Request["session"];
  return { request, calls: () => ({ regenerateCalls, saveCalls, destroyCalls }) };
}

test("canonical login regenerates first and persists only canonical identity fields", async () => {
  const fixture = requestFixture({ role: "admin", adminId: 99, arbitrary: "old" });
  const oldSession = fixture.request.session;
  await establishCanonicalSession(fixture.request, { userId: 7, authVersion: 3 });
  assert.notEqual(fixture.request.session, oldSession);
  assert.deepEqual(fixture.calls(), { regenerateCalls: 1, saveCalls: 1, destroyCalls: 0 });
  assert.equal((fixture.request.session as any).userId, 7);
  assert.equal((fixture.request.session as any).authVersion, 3);
  assert.equal((fixture.request.session as any).role, undefined);
  assert.equal((fixture.request.session as any).adminId, undefined);
  assert.equal((fixture.request.session as any).barberId, undefined);
  assert.equal((fixture.request.session as any).arbitrary, undefined);
});

test("legacy login also regenerates and never retains canonical identity fields", async () => {
  const fixture = requestFixture({ userId: 7, authVersion: 3 });
  await establishLegacySession(fixture.request, { role: "barber", barberId: 12 });
  assert.deepEqual(fixture.calls(), { regenerateCalls: 1, saveCalls: 1, destroyCalls: 0 });
  assert.equal((fixture.request.session as any).role, "barber");
  assert.equal((fixture.request.session as any).barberId, 12);
  assert.equal((fixture.request.session as any).userId, undefined);
  assert.equal((fixture.request.session as any).authVersion, undefined);
});

test("stale canonical identity is cleared without making the request unusable for a new login", async () => {
  const fixture = requestFixture({ userId: 7, authVersion: 2, role: "admin", adminId: 9 });
  const currentSession = fixture.request.session;
  await clearAuthenticatedSessionIdentity(fixture.request);
  assert.equal(fixture.request.session, currentSession);
  assert.deepEqual(fixture.calls(), { regenerateCalls: 0, saveCalls: 1, destroyCalls: 0 });
  assert.equal((fixture.request.session as any).userId, undefined);
  assert.equal((fixture.request.session as any).authVersion, undefined);
  await establishCanonicalSession(fixture.request, { userId: 7, authVersion: 3 });
  assert.deepEqual(fixture.calls(), { regenerateCalls: 1, saveCalls: 2, destroyCalls: 0 });
});

test("logout delegates to session-store destruction", async () => {
  const fixture = requestFixture({ userId: 7, authVersion: 3 });
  await destroyAuthenticatedSession(fixture.request);
  assert.deepEqual(fixture.calls(), { regenerateCalls: 0, saveCalls: 0, destroyCalls: 1 });
});
