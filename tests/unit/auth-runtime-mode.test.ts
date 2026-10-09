import assert from "node:assert/strict";
import test from "node:test";
import { parseAuthRuntimeMode } from "../../server/auth-runtime";

test("auth runtime defaults safely to legacy and normalizes explicit modes", () => {
  assert.equal(parseAuthRuntimeMode(undefined), "legacy");
  assert.equal(parseAuthRuntimeMode(""), "legacy");
  assert.equal(parseAuthRuntimeMode("  LEGACY "), "legacy");
  assert.equal(parseAuthRuntimeMode(" Canonical "), "canonical");
});

test("auth runtime rejects unknown values in every environment", () => {
  assert.throws(() => parseAuthRuntimeMode("hybrid"), /legacy or canonical/);
});
