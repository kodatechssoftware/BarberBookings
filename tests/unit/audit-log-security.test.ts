import assert from "node:assert/strict";
import test from "node:test";
import {
  redactStoredAuditMetadata,
  serializeSafeAuditMetadata,
} from "../../server/audit-log-security";
import { MemoryStorage } from "../../server/storage";

test("audit metadata redacts nested credentials without removing safe context", () => {
  assert.deepEqual(JSON.parse(serializeSafeAuditMetadata({
    locationId: 10,
    changes: {
      passwordHash: "never-log-this",
      inviteToken: "never-log-this-either",
      displayName: "Safe value",
    },
  })!), {
    locationId: 10,
    changes: {
      passwordHash: "[REDACTED]",
      inviteToken: "[REDACTED]",
      displayName: "Safe value",
    },
  });
  assert.equal(redactStoredAuditMetadata("reset token: secret"), "[REDACTED]");
});

test("location-scoped audit reads exclude other locations and global rows", async () => {
  const storage = new MemoryStorage();
  const common = {
    actorType: "user",
    actorId: 1,
    actorName: "Auditor",
    action: "entity.updated",
    entityType: "entity",
    summary: "Updated",
  } as const;
  await storage.createAuditLog({ ...common, locationId: 10 });
  await storage.createAuditLog({ ...common, locationId: 20 });
  await storage.createAuditLog({ ...common, locationId: null });

  assert.deepEqual((await storage.getAuditLogs(10, 10)).map((entry) => entry.locationId), [10]);
  assert.deepEqual((await storage.getAuditLogs(10, 20)).map((entry) => entry.locationId), [20]);
  assert.equal((await storage.getAuditLogs(10)).length, 3);
});
