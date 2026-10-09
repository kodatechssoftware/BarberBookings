import assert from "node:assert/strict";
import test from "node:test";
import { resolveEffectiveAccess, type AccessScope } from "@shared/auth";
import type { CanonicalAuthContext } from "../../server/auth-runtime";
import {
  getCanonicalAccessibleLocationIds,
  hasAnyCanonicalAccessAtLocation,
  hasCanonicalCapability,
  hasCanonicalOwnCapability,
  hasCanonicalOwnOrTeamCapability,
  redactTeamAgendaAppointment,
} from "../../server/auth-authorization";
import { canUseRuntimeCapability } from "../../client/src/lib/auth-capabilities";

const locationA = 10;
const locationB = 20;
const professionalA = 101;
const professionalB = 202;

function context(
  scopes: AccessScope[],
  professionalId: number | null,
  overrides: Partial<CanonicalAuthContext> = {},
): CanonicalAuthContext {
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
    ...overrides,
  };
}

const professional = context([
  { kind: "location", locationId: locationA, preset: "professional" },
], professionalA);

test("professional preset grants team agenda and manual creation at its location", () => {
  assert.equal(hasCanonicalCapability(professional, "agenda.view_team", locationA), true);
  assert.equal(hasCanonicalCapability(professional, "appointments.create_manual", locationA), true);
  assert.equal(
    hasCanonicalOwnOrTeamCapability(professional, {
      ownCapability: "appointments.manage_own",
      teamCapability: "appointments.manage_team",
      ownerProfessionalId: professionalB,
      locationId: locationA,
    }),
    false,
    "creating for B must not grant later management of B",
  );
});

function ownOrTeamDecision(
  ownCapability: "appointments.manage_own" | "appointments.change_status_own" | "customers.notes_own",
  teamCapability: "appointments.manage_team" | "appointments.change_status_team" | "customers.notes_team",
  ownerProfessionalId = professionalB,
) {
  return hasCanonicalOwnOrTeamCapability(professional, {
    ownCapability,
    teamCapability,
    ownerProfessionalId,
    locationId: locationA,
  }) ? 200 : 403;
}

test("IDOR: professional A cannot edit professional B appointment", () => {
  assert.equal(ownOrTeamDecision("appointments.manage_own", "appointments.manage_team"), 403);
});

test("IDOR: professional A cannot cancel professional B appointment", () => {
  assert.equal(ownOrTeamDecision("appointments.manage_own", "appointments.manage_team"), 403);
});

test("IDOR: professional A cannot change professional B appointment status", () => {
  assert.equal(ownOrTeamDecision(
    "appointments.change_status_own",
    "appointments.change_status_team",
  ), 403);
});

test("IDOR: professional A cannot read or mutate professional B customer notes", () => {
  assert.equal(ownOrTeamDecision("customers.notes_own", "customers.notes_team"), 403);
});

test("IDOR: professional A cannot read professional B finance", () => {
  assert.equal(
    hasCanonicalOwnCapability(professional, "finance.view_own", professionalB, locationA)
      ? 200
      : 403,
    403,
  );
});

test("IDOR: professional A cannot export professional B or global data", () => {
  assert.equal(
    hasCanonicalOwnCapability(professional, "reports.export_own", professionalB, locationA)
      ? 200
      : 403,
    403,
  );
  assert.equal(
    hasCanonicalCapability(professional, "reports.export_team", locationA) ? 200 : 403,
    403,
  );
});

test("professional A may create a manual appointment for B but cannot later manage it", () => {
  assert.equal(
    hasCanonicalCapability(professional, "appointments.create_manual", locationA),
    true,
  );
  assert.equal(ownOrTeamDecision("appointments.manage_own", "appointments.manage_team"), 403);
});

test("professional own operations remain authorized while block time stays separate", () => {
  assert.equal(hasCanonicalOwnCapability(
    professional,
    "appointments.manage_own",
    professionalA,
    locationA,
  ), true);
  assert.equal(hasCanonicalOwnCapability(
    professional,
    "appointments.change_status_own",
    professionalA,
    locationA,
  ), true);
  assert.equal(hasCanonicalOwnCapability(
    professional,
    "customers.notes_own",
    professionalA,
    locationA,
  ), true);
  assert.equal(hasCanonicalCapability(professional, "appointments.block_time", locationA), false);
});

test("customer history and customer notes remain independent grants", () => {
  const historyOnly = context([{
    kind: "location",
    locationId: locationA,
    capabilities: ["customers.view_own"],
  }], professionalA);
  assert.equal(hasCanonicalOwnCapability(
    historyOnly,
    "customers.view_own",
    professionalA,
    locationA,
  ), true);
  assert.equal(hasCanonicalOwnCapability(
    historyOnly,
    "customers.notes_own",
    professionalA,
    locationA,
  ), false);
});

test("team appointment management does not imply access to private customer data", () => {
  const managerWithoutCustomerAccess = context([{
    kind: "location",
    locationId: locationA,
    capabilities: ["agenda.view_team", "appointments.manage_team"],
  }], null);
  assert.equal(hasCanonicalOwnOrTeamCapability(managerWithoutCustomerAccess, {
    ownCapability: "appointments.manage_own",
    teamCapability: "appointments.manage_team",
    ownerProfessionalId: professionalB,
    locationId: locationA,
  }), true);
  assert.equal(hasCanonicalCapability(
    managerWithoutCustomerAccess,
    "customers.view_team",
    locationA,
  ), false);
});

test("location scope fails closed for an arbitrary second location", () => {
  assert.equal(hasAnyCanonicalAccessAtLocation(professional, locationA), true);
  assert.equal(hasAnyCanonicalAccessAtLocation(professional, locationB), false);
  assert.equal(hasCanonicalCapability(professional, "agenda.view_team", locationB), false);
  assert.deepEqual(Array.from(getCanonicalAccessibleLocationIds(professional) ?? []), [locationA]);
});

test("professionalId by itself grants no operational access", () => {
  const linkedOnly = context([], professionalA);
  assert.equal(hasCanonicalCapability(linkedOnly, "agenda.view_own", locationA), false);
  assert.equal(hasCanonicalOwnCapability(
    linkedOnly,
    "appointments.manage_own",
    professionalA,
    locationA,
  ), false);
});

test("Bruno can be administrator and professional through one canonical identity", () => {
  const bruno = context(
    [{ kind: "global", preset: "administrator" }],
    professionalA,
    { isGlobalAdministrator: true },
  );
  assert.equal(hasCanonicalCapability(bruno, "users.manage"), true);
  assert.equal(hasCanonicalCapability(bruno, "appointments.manage_team", locationB), true);
  assert.equal(hasCanonicalCapability(bruno, "finance.view_team", locationB), true);
  assert.equal(getCanonicalAccessibleLocationIds(bruno), null);
});

test("Bruno with only the professional preset receives only operational capabilities", () => {
  const brunoProfessionalOnly = context([
    { kind: "location", locationId: locationA, preset: "professional" },
  ], professionalA, {
    user: {
      id: 88,
      email: "bs881366@gmail.com",
      displayName: "Bruno Santos",
      isActive: true,
    },
  });
  assert.equal(hasCanonicalCapability(
    brunoProfessionalOnly,
    "appointments.create_manual",
    locationA,
  ), true);
  assert.equal(hasCanonicalCapability(brunoProfessionalOnly, "users.manage"), false);
  assert.equal(hasCanonicalCapability(
    brunoProfessionalOnly,
    "appointments.manage_team",
    locationA,
  ), false);
  assert.equal(hasCanonicalCapability(
    brunoProfessionalOnly,
    "finance.view_team",
    locationA,
  ), false);
});

test("the Professional preset cannot access any P4B management surface", () => {
  for (const capability of [
    "customers.block",
    "team.view",
    "team.manage_global",
    "team.assign_location",
    "catalog.manage_global",
    "catalog.manage_location",
    "hours.manage_own",
    "hours.manage_team",
    "hours.manage_establishment",
    "extras.manage",
    "finance.view_team",
    "finance.manage_expenses",
    "finance.manage_compensation",
    "reports.export_team",
    "locations.manage",
    "users.manage",
    "access.manage",
    "settings.manage",
    "audit.view",
    "system.diagnostics",
  ] as const) {
    assert.equal(
      hasCanonicalCapability(professional, capability, locationA),
      false,
      capability,
    );
  }
});

test("location-scoped management grants are isolated between locations", () => {
  const locationManager = context([{
    kind: "location",
    locationId: locationA,
    capabilities: [
      "customers.block",
      "team.assign_location",
      "catalog.manage_location",
      "hours.manage_team",
      "hours.manage_establishment",
      "extras.manage",
      "finance.manage_expenses",
      "finance.manage_compensation",
      "reports.export_team",
      "audit.view",
    ],
  }], null);

  for (const capability of [
    "customers.block",
    "team.assign_location",
    "catalog.manage_location",
    "hours.manage_team",
    "hours.manage_establishment",
    "extras.manage",
    "finance.manage_expenses",
    "finance.manage_compensation",
    "reports.export_team",
    "audit.view",
  ] as const) {
    assert.equal(hasCanonicalCapability(locationManager, capability, locationA), true, capability);
    assert.equal(hasCanonicalCapability(locationManager, capability, locationB), false, capability);
  }
});

test("global professional identity and local compensation grants remain independent", () => {
  const identityOnly = context([{
    kind: "global",
    capabilities: ["team.manage_global"],
  }], null);
  const compensationOnly = context([{
    kind: "location",
    locationId: locationA,
    capabilities: ["finance.manage_compensation"],
  }], null);

  assert.equal(hasCanonicalCapability(identityOnly, "team.manage_global"), true);
  assert.equal(hasCanonicalCapability(identityOnly, "finance.manage_compensation", locationA), false);
  assert.equal(hasCanonicalCapability(compensationOnly, "finance.manage_compensation", locationA), true);
  assert.equal(hasCanonicalCapability(compensationOnly, "finance.manage_compensation", locationB), false);
  assert.equal(hasCanonicalCapability(compensationOnly, "team.manage_global"), false);
});

test("team agenda redaction excludes private customer and commercial fields", () => {
  const redacted = redactTeamAgendaAppointment({
    id: 77,
    customerName: "Visible operational name",
    customerEmail: "private@example.test",
    customerPhone: "+351910000000",
    cancelToken: "secret-token",
    paymentMethod: "cash",
    depositRequired: true,
    depositReason: "private-risk-data",
    createdAt: new Date(),
    extras: [{ nameSnapshot: "Private commercial detail" }],
    startTime: new Date("2026-10-09T09:00:00Z"),
    barberId: professionalB,
    serviceId: 1,
  });
  assert.equal(redacted.customerName, "Visible operational name");
  assert.equal(redacted.customerEmail, null);
  assert.equal(redacted.customerPhone, "");
  assert.equal(redacted.cancelToken, "");
  assert.equal(redacted.paymentMethod, "pending");
  assert.equal(redacted.depositRequired, false);
  assert.equal(redacted.depositReason, null);
  assert.equal(redacted.createdAt, null);
  assert.equal(redacted.extras, undefined);
  assert.equal(redacted.canManage, false);
});

test("frontend capability checks prefer canonical access and preserve legacy fallbacks", () => {
  assert.equal(canUseRuntimeCapability(
    { role: "barber", access: professional.access },
    "appointments.create_manual",
    locationA,
    () => false,
  ), true);
  assert.equal(canUseRuntimeCapability(
    { role: "barber", access: professional.access },
    "appointments.block_time",
    locationA,
    () => true,
  ), false, "canonical mode must not fall back to the displayed role");
  assert.equal(canUseRuntimeCapability(
    { role: "admin" },
    "appointments.block_time",
    locationA,
    (role) => role === "admin",
  ), true, "legacy UI behaviour remains unchanged without canonical access DTO");
});

