import assert from "node:assert/strict";
import test from "node:test";
import { getSafeBuildSha } from "../../server/build-identity";

test("health build identity exposes only a validated commit SHA", () => {
  assert.equal(getSafeBuildSha({ RENDER_GIT_COMMIT: "ABCDEF1234567" }), "abcdef1234567");
  assert.equal(getSafeBuildSha({ APP_BUILD_SHA: "a".repeat(40) }), "a".repeat(40));
  assert.equal(getSafeBuildSha({ RENDER_GIT_COMMIT: "secret=value" }), null);
  assert.equal(getSafeBuildSha({ RENDER_GIT_COMMIT: "abc123" }), null);
  assert.equal(getSafeBuildSha({}), null);
});
