import assert from "node:assert/strict";
import test from "node:test";
import {
  runInitialSeedPolicy,
  shouldSkipLegacyInitialSeed,
} from "../../server/initial-seed-policy";

test("empty canonical installation prepares structure without invoking the legacy seed", async () => {
  const calls: string[] = [];
  const result = await runInitialSeedPolicy({
    authRuntimeMode: "canonical",
    hasLegacyProfessionalData: false,
    hasCanonicalUsers: false,
    prepareCanonicalInstallation: async () => { calls.push("canonical"); },
    runLegacySeed: async () => { calls.push("legacy"); },
  });

  assert.equal(result, "canonical");
  assert.deepEqual(calls, ["canonical"]);
});

test("canonical installation stays seed-free after bootstrap and later professional creation", async () => {
  for (const hasLegacyProfessionalData of [false, true]) {
    const calls: string[] = [];
    const result = await runInitialSeedPolicy({
      authRuntimeMode: "canonical",
      hasLegacyProfessionalData,
      hasCanonicalUsers: true,
      prepareCanonicalInstallation: async () => { calls.push("canonical"); },
      runLegacySeed: async () => { calls.push("legacy"); },
    });

    assert.equal(result, "canonical");
    assert.deepEqual(calls, ["canonical"]);
  }
});

test("pre-cutover legacy data without canonical users keeps the existing seed maintenance path", () => {
  assert.equal(shouldSkipLegacyInitialSeed({
    authRuntimeMode: "canonical",
    hasLegacyProfessionalData: true,
    hasCanonicalUsers: false,
  }), false);
});

test("legacy mode preserves both empty-install and existing-data seed behaviour", async () => {
  for (const hasLegacyProfessionalData of [false, true]) {
    const calls: string[] = [];
    const result = await runInitialSeedPolicy({
      authRuntimeMode: "legacy",
      hasLegacyProfessionalData,
      hasCanonicalUsers: false,
      prepareCanonicalInstallation: async () => { calls.push("canonical"); },
      runLegacySeed: async () => { calls.push("legacy"); },
    });

    assert.equal(result, "legacy");
    assert.deepEqual(calls, ["legacy"]);
  }
});
