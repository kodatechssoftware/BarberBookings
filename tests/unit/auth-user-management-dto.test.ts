import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalAccessReplaceSchema,
  canonicalUserCreateSchema,
} from "../../shared/auth";

test("canonical user creation requires an initial valid access scope", () => {
  assert.equal(canonicalUserCreateSchema.safeParse({
    displayName: "Utilizador",
    email: "user@example.test",
    access: [],
  }).success, false);
  assert.equal(canonicalUserCreateSchema.safeParse({
    displayName: "Utilizador",
    email: "user@example.test",
    access: [{ kind: "location", locationId: 1, preset: "professional" }],
  }).success, true);
});

test("location access rejects administrator and installation-wide capabilities", () => {
  for (const access of [
    [{ kind: "location", locationId: 1, preset: "administrator" }],
    [{ kind: "location", locationId: 1, capabilities: ["users.manage"] }],
    [{ kind: "location", locationId: 1, capabilities: ["locations.manage"] }],
  ]) {
    assert.equal(canonicalAccessReplaceSchema.safeParse({
      mode: "replace_location",
      locationId: 1,
      scopes: access,
    }).success, false);
  }
});

test("access replacement supports removal but rejects duplicate or mismatched scopes", () => {
  assert.equal(canonicalAccessReplaceSchema.safeParse({
    mode: "replace_all",
    scopes: [],
  }).success, true);
  assert.equal(canonicalAccessReplaceSchema.safeParse({
    mode: "replace_all",
    scopes: [
      { kind: "location", locationId: 1, capabilities: ["catalog.view"] },
      { kind: "location", locationId: 1, capabilities: ["agenda.view_team"] },
    ],
  }).success, false);
  assert.equal(canonicalAccessReplaceSchema.safeParse({
    mode: "replace_location",
    locationId: 1,
    scopes: [{ kind: "location", locationId: 2, capabilities: ["catalog.view"] }],
  }).success, false);
});

test("unknown presets and capabilities fail closed", () => {
  assert.equal(canonicalAccessReplaceSchema.safeParse({
    mode: "replace_all",
    scopes: [{ kind: "global", preset: "manager" }],
  }).success, false);
  assert.equal(canonicalAccessReplaceSchema.safeParse({
    mode: "replace_all",
    scopes: [{ kind: "global", capabilities: ["users.superuser"] }],
  }).success, false);
});
