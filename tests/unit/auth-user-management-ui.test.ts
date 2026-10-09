import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { capabilityCodes, professionalCapabilityCodes, type AccessScope, type EffectiveAccess } from "../../shared/auth";
import {
  canActorGrantScope,
  isGlobalAdministrator,
} from "../../client/src/components/admin/UserAccessManager";

const globalAdministratorAccess: EffectiveAccess = {
  globalCapabilities: capabilityCodes,
  locationCapabilities: [],
  presetLabels: ["Administrador"],
};

test("canonical UI recognizes Administrator separately from Professional linkage", () => {
  const administrator: AccessScope[] = [{ kind: "global", preset: "administrator", capabilities: [] }];
  const professional: AccessScope[] = [{ kind: "location", locationId: 7, preset: "professional", capabilities: [] }];

  assert.equal(isGlobalAdministrator(administrator), true);
  assert.equal(isGlobalAdministrator(professional), false);
  assert.equal(isGlobalAdministrator([]), false);
});

test("grant ceiling accepts global Administrator only for a full global Administrator", () => {
  assert.equal(canActorGrantScope(globalAdministratorAccess, {
    kind: "global",
    locationId: null,
    preset: "administrator",
    capabilities: [],
  }), true);

  const limited: EffectiveAccess = {
    globalCapabilities: ["users.manage", "access.manage"],
    locationCapabilities: [],
    presetLabels: [],
  };
  assert.equal(canActorGrantScope(limited, {
    kind: "global",
    locationId: null,
    preset: "administrator",
    capabilities: [],
  }), false);
  assert.equal(canActorGrantScope(limited, {
    kind: "global",
    locationId: null,
    preset: "custom",
    capabilities: ["users.manage"],
  }), true);
  assert.equal(canActorGrantScope(limited, {
    kind: "global",
    locationId: null,
    preset: "custom",
    capabilities: ["locations.manage"],
  }), false);
});

test("location access only grants supported capabilities inside the actor's location ceiling", () => {
  const localAccess: EffectiveAccess = {
    globalCapabilities: ["users.manage"],
    locationCapabilities: [{
      locationId: 7,
      capabilities: ["access.manage", ...professionalCapabilityCodes],
    }],
    presetLabels: [],
  };

  assert.equal(canActorGrantScope(localAccess, {
    kind: "location",
    locationId: 7,
    preset: "professional",
    capabilities: [],
  }), true);
  assert.equal(canActorGrantScope(localAccess, {
    kind: "location",
    locationId: 8,
    preset: "professional",
    capabilities: [],
  }), false);
  assert.equal(canActorGrantScope(localAccess, {
    kind: "location",
    locationId: 7,
    preset: "custom",
    capabilities: ["locations.manage"],
  }), false);
});

test("Admin exposes the canonical area only behind a canonical session and users.manage", () => {
  const source = readFileSync("client/src/pages/Admin.tsx", "utf8");
  assert.match(source, /const usesCanonicalAuth = Boolean\(user\?\.access && user\.userId\)/);
  assert.match(source, /usesCanonicalAuth && canManageUsers/);
  assert.match(source, /<UserAccessManager/);
  assert.match(source, /"access\.manage"/);
});
