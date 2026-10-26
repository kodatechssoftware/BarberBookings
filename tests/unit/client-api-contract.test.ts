import assert from "node:assert/strict";
import test from "node:test";
import { api, buildUrl } from "../../client/src/lib/client-api-contract";

test("client API metadata preserves the public route contract", () => {
  assert.equal(api.barbers.list.path, "/api/barbers");
  assert.equal(api.services.list.path, "/api/services");
  assert.equal(api.appointments.create.method, "POST");
  assert.equal(
    buildUrl(api.appointments.updateStatus.path, { id: 42 }),
    "/api/appointments/42/status",
  );
});

test("list response guards reject malformed non-array payloads", () => {
  assert.deepEqual(api.barbers.list.responses[200].parse([]), []);
  assert.throws(
    () => api.services.list.responses[200].parse({}),
    /Expected an array response/,
  );
});
