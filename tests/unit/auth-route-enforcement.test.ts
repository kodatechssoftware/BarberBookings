import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { resolveEffectiveAccess, type AccessScope } from "@shared/auth";
import type { CanonicalAuthContext } from "../../server/auth-runtime";
import {
  enforceCanonicalAllCapabilities,
  enforceCanonicalAnyOwnOrTeamCapability,
  enforceCanonicalCapability,
  enforceCanonicalOwnOrTeamCapability,
  setCanonicalRequestAuthContext,
} from "../../server/auth-authorization";

const locationA = 10;
const locationB = 20;
const professionalA = 101;
const professionalB = 202;

function context(scopes: AccessScope[], professionalId: number | null): CanonicalAuthContext {
  return {
    user: {
      id: 1,
      email: "professional-a@example.test",
      displayName: "Professional A",
      isActive: true,
    },
    username: null,
    status: "active",
    authVersion: 1,
    lastLoginAt: null,
    legacyAdminId: null,
    professionalId,
    access: resolveEffectiveAccess(scopes),
    isGlobalAdministrator: false,
    hasProfessionalAccessPreset: scopes.some((scope) => scope.preset === "professional"),
  };
}

function responseRecorder() {
  const state: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      state.status = code;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
  } as unknown as Response;
  return { response, state };
}

function canonicalRequest(authContext?: CanonicalAuthContext) {
  const request = {} as Request;
  if (authContext) setCanonicalRequestAuthContext(request, authContext);
  return request;
}

const professional = context([
  { kind: "location", locationId: locationA, preset: "professional" },
], professionalA);

test("canonical enforcement returns 401 without an authenticated context", () => {
  const { response, state } = responseRecorder();
  assert.equal(enforceCanonicalCapability(
    canonicalRequest(),
    response,
    "agenda.view_team",
    locationA,
  ), false);
  assert.equal(state.status, 401);
});

test("canonical ownership enforcement returns 403 for a colleague resource", () => {
  const { response, state } = responseRecorder();
  assert.equal(enforceCanonicalOwnOrTeamCapability(
    canonicalRequest(professional),
    response,
    {
      ownCapability: "appointments.manage_own",
      teamCapability: "appointments.manage_team",
      ownerProfessionalId: professionalB,
      locationId: locationA,
    },
  ), false);
  assert.equal(state.status, 403);
});

test("canonical ownership enforcement accepts the professional's own resource", () => {
  const { response, state } = responseRecorder();
  assert.equal(enforceCanonicalOwnOrTeamCapability(
    canonicalRequest(professional),
    response,
    {
      ownCapability: "appointments.manage_own",
      teamCapability: "appointments.manage_team",
      ownerProfessionalId: professionalA,
      locationId: locationA,
    },
  ), true);
  assert.equal(state.status, undefined);
});

test("canonical location enforcement fails closed outside the granted location", () => {
  const { response, state } = responseRecorder();
  assert.equal(enforceCanonicalCapability(
    canonicalRequest(professional),
    response,
    "appointments.create_manual",
    locationB,
  ), false);
  assert.equal(state.status, 403);
});

test("canonical location settings require the global locations.manage capability", () => {
  const denied = responseRecorder();
  assert.equal(enforceCanonicalCapability(
    canonicalRequest(professional),
    denied.response,
    "locations.manage",
  ), false);
  assert.equal(denied.state.status, 403);

  const administrator = context([{ kind: "global", preset: "administrator" }], null);
  const allowed = responseRecorder();
  assert.equal(enforceCanonicalCapability(
    canonicalRequest(administrator),
    allowed.response,
    "locations.manage",
  ), true);
  assert.equal(allowed.state.status, undefined);
});

test("canonical administrator preset authorizes team ownership everywhere", () => {
  const administrator = context([
    { kind: "global", preset: "administrator" },
  ], professionalA);
  const { response, state } = responseRecorder();
  assert.equal(enforceCanonicalOwnOrTeamCapability(
    canonicalRequest(administrator),
    response,
    {
      ownCapability: "appointments.manage_own",
      teamCapability: "appointments.manage_team",
      ownerProfessionalId: professionalB,
      locationId: locationB,
    },
  ), true);
  assert.equal(state.status, undefined);
});

test("manage_own authorizes own cancellation without authorizing other status changes", () => {
  const manageOnly = context([{
    kind: "location",
    locationId: locationA,
    capabilities: ["appointments.manage_own"],
  }], professionalA);
  const cancellation = responseRecorder();
  assert.equal(enforceCanonicalAnyOwnOrTeamCapability(
    canonicalRequest(manageOnly),
    cancellation.response,
    [
      {
        ownCapability: "appointments.change_status_own",
        teamCapability: "appointments.change_status_team",
        ownerProfessionalId: professionalA,
        locationId: locationA,
      },
      {
        ownCapability: "appointments.manage_own",
        teamCapability: "appointments.manage_team",
        ownerProfessionalId: professionalA,
        locationId: locationA,
      },
    ],
  ), true);

  const completion = responseRecorder();
  assert.equal(enforceCanonicalOwnOrTeamCapability(
    canonicalRequest(manageOnly),
    completion.response,
    {
      ownCapability: "appointments.change_status_own",
      teamCapability: "appointments.change_status_team",
      ownerProfessionalId: professionalA,
      locationId: locationA,
    },
  ), false);
  assert.equal(completion.state.status, 403);
});

test("canonical mixed mutations require every independent capability", () => {
  const identityOnly = context([{
    kind: "global",
    capabilities: ["team.manage_global"],
  }], null);
  const compensationOnly = context([{
    kind: "location",
    locationId: locationA,
    capabilities: ["finance.manage_compensation"],
  }], null);
  const both = context([
    { kind: "global", capabilities: ["team.manage_global"] },
    {
      kind: "location",
      locationId: locationA,
      capabilities: ["finance.manage_compensation"],
    },
  ], null);

  for (const denied of [identityOnly, compensationOnly]) {
    const { response, state } = responseRecorder();
    assert.equal(enforceCanonicalAllCapabilities(
      canonicalRequest(denied),
      response,
      ["team.manage_global", "finance.manage_compensation"],
      locationA,
    ), false);
    assert.equal(state.status, 403);
  }

  const allowed = responseRecorder();
  assert.equal(enforceCanonicalAllCapabilities(
    canonicalRequest(both),
    allowed.response,
    ["team.manage_global", "finance.manage_compensation"],
    locationA,
  ), true);
  assert.equal(allowed.state.status, undefined);
});

test("local compensation authorization is denied outside the granted location", () => {
  const compensationManager = context([{
    kind: "location",
    locationId: locationA,
    capabilities: ["finance.manage_compensation"],
  }], null);
  const atA = responseRecorder();
  assert.equal(enforceCanonicalCapability(
    canonicalRequest(compensationManager),
    atA.response,
    "finance.manage_compensation",
    locationA,
  ), true);

  const atB = responseRecorder();
  assert.equal(enforceCanonicalCapability(
    canonicalRequest(compensationManager),
    atB.response,
    "finance.manage_compensation",
    locationB,
  ), false);
  assert.equal(atB.state.status, 403);
});
