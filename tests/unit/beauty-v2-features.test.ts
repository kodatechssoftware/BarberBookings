import assert from "node:assert/strict";
import test from "node:test";
import {
  beautyV2FeatureNames,
  parseBeautyV2MasterSwitch,
  resolveBeautyV2Features,
} from "../../shared/business/v2-features";

test("Beauty v2 features are disabled by default and by the master kill switch", () => {
  assert.equal(parseBeautyV2MasterSwitch(undefined), false);
  const resolved = resolveBeautyV2Features({
    masterEnabled: false,
    settings: beautyV2FeatureNames.map((featureName) => ({ featureName, locationId: null, enabled: true })),
  });
  assert.deepEqual(resolved, Object.fromEntries(beautyV2FeatureNames.map((name) => [name, false])));
});

test("location settings override installation settings only when the master switch is enabled", () => {
  const effective = resolveBeautyV2Features({
    masterEnabled: true,
    locationId: 2,
    settings: [
      { featureName: "appointmentRequests", locationId: null, enabled: true },
      { featureName: "appointmentRequests", locationId: 2, enabled: false },
      { featureName: "teamProfiles", locationId: 2, enabled: true },
      { featureName: "googleReviews", locationId: 3, enabled: true },
    ],
  });
  assert.equal(effective.appointmentRequests, false);
  assert.equal(effective.teamProfiles, true);
  assert.equal(effective.googleReviews, false);
  assert.equal(effective.multiServiceAppointments, false);
  assert.equal(effective.parallelServiceScheduling, false);
});

test("the master switch rejects ambiguous configuration", () => {
  assert.throws(() => parseBeautyV2MasterSwitch("yes"), /must be true or false/);
});
