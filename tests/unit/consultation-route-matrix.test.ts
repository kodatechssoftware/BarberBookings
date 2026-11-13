import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { resolveEffectiveAccess } from "../../shared/auth";
import type { CanonicalAuthContext } from "../../server/auth-runtime";
import {
  consultationTechnicalMutationExceptions,
  enforceConsultationReadOnly,
  setCanonicalRequestAuthContext,
} from "../../server/auth-authorization";

const routeSource = readFileSync("server/routes.ts", "utf8");
const contractPaths: Record<string, string> = {
  "api.serviceCategories.create.path": "/api/service-categories",
  "api.serviceCategories.reorder.path": "/api/service-categories/order",
  "api.serviceCategories.update.path": "/api/service-categories/:id",
  "api.serviceCategories.remove.path": "/api/service-categories/:id",
  "api.appointments.create.path": "/api/appointments",
  "api.appointments.updateStatus.path": "/api/appointments/:id/status",
};

function mutableRoutes() {
  return Array.from(routeSource.matchAll(/\bapp\.(post|put|patch|delete)\s*\(/g)).map((match) => {
    const rest = routeSource.slice((match.index ?? 0) + match[0].length);
    const firstArgument = rest.match(/^\s*(?:"([^"]+)"|'([^']+)'|(api\.[A-Za-z0-9_.]+\.path))/);
    assert(firstArgument, `Unable to parse mutation registration at ${match.index}`);
    const expression = firstArgument[3];
    const path = firstArgument[1] ?? firstArgument[2] ?? contractPaths[expression];
    assert(path, `Unknown API contract path ${expression}`);
    return { method: match[1].toUpperCase(), path };
  });
}

function consultationContext(): CanonicalAuthContext {
  return {
    user: { id: 77, email: "consulta@example.test", displayName: "Consulta", isActive: true },
    username: null,
    status: "active",
    authVersion: 1,
    lastLoginAt: null,
    professionalId: null,
    legacyAdminId: null,
    access: resolveEffectiveAccess([{
      kind: "location",
      locationId: 1,
      preset: "consultation",
      capabilities: [],
    }]),
    isGlobalAdministrator: false,
    hasProfessionalAccessPreset: false,
    hasConsultationAccessPreset: true,
    consultationLocationIds: [1],
  };
}

test("all 83 mutable routes are stopped before business handlers for consultation sessions", () => {
  const routes = mutableRoutes();
  assert.equal(routes.length, 83, "the reviewed mutation matrix changed and requires a security review");
  assert.deepEqual(Array.from(consultationTechnicalMutationExceptions).sort(), [
    "/api/account/password",
    "/api/admin/login",
    "/api/admin/logout",
    "/api/auth/bootstrap",
    "/api/user-invites/accept",
    "/api/user-invites/validate",
  ]);

  for (const route of routes) {
    const request = { method: route.method, path: route.path } as Request;
    setCanonicalRequestAuthContext(request, consultationContext());
    let nextCalled = false;
    const state: { status?: number; body?: any } = {};
    const response = {
      status(code: number) { state.status = code; return response; },
      json(body: unknown) { state.body = body; return response; },
    } as unknown as Response;
    enforceConsultationReadOnly(request, response, (() => { nextCalled = true; }) as NextFunction);

    if (consultationTechnicalMutationExceptions.has(route.path)) {
      assert.equal(nextCalled, true, `${route.method} ${route.path} should remain available for authentication/account security`);
      assert.equal(state.status, undefined);
    } else {
      assert.equal(nextCalled, false, `${route.method} ${route.path} reached a business handler`);
      assert.equal(state.status, 403, `${route.method} ${route.path}`);
      assert.equal(state.body?.code, "CONSULTATION_READ_ONLY");
    }
  }
});

test("the read-only guard also remains active after a feature-flag revocation", () => {
  const context = { ...consultationContext(), access: resolveEffectiveAccess([]), consultationLocationIds: [] };
  const request = { method: "PATCH", path: "/api/appointments/1" } as Request;
  setCanonicalRequestAuthContext(request, context);
  let nextCalled = false;
  const state: { status?: number } = {};
  const response = {
    status(code: number) { state.status = code; return response; },
    json() { return response; },
  } as unknown as Response;
  enforceConsultationReadOnly(request, response, (() => { nextCalled = true; }) as NextFunction);
  assert.equal(nextCalled, false);
  assert.equal(state.status, 403);
});
