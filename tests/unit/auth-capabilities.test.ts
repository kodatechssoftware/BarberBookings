import assert from "node:assert/strict";
import test from "node:test";
import {
  accessPresets,
  capabilityCodes,
  capabilityRegistry,
  hasCapability,
  hasCapabilityAtLocation,
  hasOwnCapability,
  professionalCapabilityCodes,
  resolveEffectiveAccess,
  type AuthContext,
  type CapabilityCode,
} from "../../shared/auth";

const expectedCapabilityCodes = [
  "agenda.view_own",
  "agenda.view_team",
  "appointments.create_manual",
  "appointments.block_time",
  "appointments.manage_own",
  "appointments.manage_team",
  "appointments.change_status_own",
  "appointments.change_status_team",
  "customers.view_own",
  "customers.view_team",
  "customers.notes_own",
  "customers.notes_team",
  "customers.block",
  "team.view",
  "team.manage_global",
  "team.assign_location",
  "catalog.view",
  "catalog.manage_global",
  "catalog.manage_location",
  "hours.manage_own",
  "hours.manage_team",
  "hours.manage_establishment",
  "extras.manage",
  "finance.view_own",
  "finance.view_team",
  "finance.manage_expenses",
  "finance.manage_compensation",
  "reports.export_own",
  "reports.export_team",
  "locations.manage",
  "users.manage",
  "access.manage",
  "settings.manage",
  "audit.view",
  "system.diagnostics",
] as const satisfies readonly CapabilityCode[];

test("the central capability registry exposes the approved granular contract", () => {
  assert.deepEqual(capabilityCodes, expectedCapabilityCodes);
  assert.equal(new Set(capabilityCodes).size, capabilityCodes.length);
  assert.deepEqual(Object.keys(capabilityRegistry), capabilityCodes);
  assert.equal(capabilityRegistry["appointments.block_time"].area, "appointments");
  assert.equal(capabilityRegistry["team.manage_global"].locationGrantAllowed, false);
  assert.equal(capabilityRegistry["team.assign_location"].locationGrantAllowed, true);
  assert.equal(capabilityRegistry["catalog.manage_location"].locationGrantAllowed, true);
});

test("the Administrator preset always contains every registered capability", () => {
  assert.equal(accessPresets.administrator.reserved, true);
  assert.deepEqual(accessPresets.administrator.capabilities, capabilityCodes);
  assert.deepEqual(
    new Set(accessPresets.administrator.capabilities),
    new Set(Object.keys(capabilityRegistry) as CapabilityCode[]),
  );
});

test("the Professional preset contains exactly the approved defaults", () => {
  const expected = [
    "agenda.view_own",
    "agenda.view_team",
    "appointments.create_manual",
    "appointments.manage_own",
    "appointments.change_status_own",
    "customers.view_own",
    "customers.notes_own",
    "catalog.view",
    "finance.view_own",
    "reports.export_own",
  ] as const satisfies readonly CapabilityCode[];

  assert.deepEqual(professionalCapabilityCodes, expected);
  assert.deepEqual(accessPresets.professional.capabilities, expected);

  for (const excluded of [
    "appointments.block_time",
    "appointments.manage_team",
    "appointments.change_status_team",
    "customers.view_team",
    "customers.notes_team",
    "team.manage_global",
    "team.assign_location",
    "catalog.manage_global",
    "catalog.manage_location",
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
  ] as const satisfies readonly CapabilityCode[]) {
    assert.equal(professionalCapabilityCodes.includes(excluded as never), false, excluded);
  }
});

test("global grants apply everywhere while local grants stay in their location", () => {
  const access = resolveEffectiveAccess([
    { kind: "global", capabilities: ["catalog.view"] },
    {
      kind: "location",
      locationId: 10,
      capabilities: ["appointments.manage_team"],
    },
  ]);

  assert.equal(hasCapability(access, "catalog.view"), true);
  assert.equal(hasCapabilityAtLocation(access, "catalog.view", 10), true);
  assert.equal(hasCapabilityAtLocation(access, "catalog.view", 20), true);
  assert.equal(hasCapability(access, "appointments.manage_team"), false);
  assert.equal(hasCapabilityAtLocation(access, "appointments.manage_team", 10), true);
  assert.equal(hasCapabilityAtLocation(access, "appointments.manage_team", 20), false);
  assert.deepEqual(access.presetLabels, []);
});

test("location context never grants access and global identity grants fail closed locally", () => {
  const emptyAccess = resolveEffectiveAccess([]);

  assert.equal(hasCapabilityAtLocation(emptyAccess, "agenda.view_team", 10), false);
  assert.throws(
    () => resolveEffectiveAccess([{
      kind: "location",
      locationId: 10,
      capabilities: ["team.manage_global"],
    }]),
    /cannot be granted at location scope/,
  );
  assert.throws(
    () => resolveEffectiveAccess([{
      kind: "location",
      locationId: 0,
      capabilities: ["agenda.view_team"],
    }]),
    /positive integer locationId/,
  );
});

test("own and team capabilities have no implicit hierarchy", () => {
  const ownOnly = resolveEffectiveAccess([{
    kind: "location",
    locationId: 10,
    capabilities: ["appointments.manage_own", "customers.notes_own"],
  }]);
  const teamOnly = resolveEffectiveAccess([{
    kind: "location",
    locationId: 10,
    capabilities: ["appointments.manage_team", "customers.notes_team"],
  }]);

  assert.equal(hasOwnCapability(ownOnly, "appointments.manage_own", 10), true);
  assert.equal(hasCapabilityAtLocation(ownOnly, "appointments.manage_team", 10), false);
  assert.equal(hasCapabilityAtLocation(ownOnly, "customers.notes_team", 10), false);
  assert.equal(hasOwnCapability(teamOnly, "appointments.manage_own", 10), false);
  assert.equal(hasCapabilityAtLocation(teamOnly, "appointments.manage_team", 10), true);
});

test("a professional identity link never grants capabilities by itself", () => {
  const authContext: AuthContext = {
    user: {
      id: 7,
      email: "professional@example.test",
      displayName: "Professional",
      isActive: true,
    },
    professionalId: 42,
    access: resolveEffectiveAccess([]),
  };

  assert.equal(authContext.professionalId, 42);
  assert.equal(hasCapability(authContext.access, "agenda.view_own"), false);
  assert.equal(hasCapabilityAtLocation(authContext.access, "agenda.view_own", 10), false);
});

test("preset and explicit capabilities resolve together without duplicates", () => {
  const access = resolveEffectiveAccess([{
    kind: "location",
    locationId: 10,
    preset: "professional",
    capabilities: ["agenda.view_own"],
  }]);
  const location = access.locationCapabilities[0];

  assert.equal(location.locationId, 10);
  assert.equal(
    location.capabilities.filter((capability) => capability === "agenda.view_own").length,
    1,
  );
  assert.deepEqual(access.presetLabels, ["Profissional"]);
});
