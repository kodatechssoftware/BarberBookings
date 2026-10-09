import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStorage } from "../../server/storage";

const locationA = 10;
const locationB = 20;

test("blacklist entries are listed and matched only inside their location", async () => {
  const storage = new MemoryStorage();
  const entryA = await storage.addToBlacklist({
    locationId: locationA,
    phone: "+351 910 000 001",
    email: "same@example.test",
    reason: "Loja A",
  });
  const entryB = await storage.addToBlacklist({
    locationId: locationB,
    phone: "+351 910 000 002",
    email: "other@example.test",
    reason: "Loja B",
  });

  assert.deepEqual((await storage.getBlacklist(locationA)).map((entry) => entry.id), [entryA.id]);
  assert.deepEqual((await storage.getBlacklist(locationB)).map((entry) => entry.id), [entryB.id]);
  assert.equal(await storage.isBlacklisted(locationA, "same@example.test"), true);
  assert.equal(await storage.isBlacklisted(locationB, "same@example.test"), false);
  assert.equal(await storage.isBlacklisted(locationA, undefined, "+351910000002"), false);
  assert.equal(await storage.isBlacklisted(locationB, undefined, "+351910000002"), true);
});

test("a removal request cannot delete another location's blacklist entry", async () => {
  const storage = new MemoryStorage();
  const entry = await storage.addToBlacklist({
    locationId: locationA,
    phone: "+351 910 000 003",
    email: null,
    reason: "Scoped block",
  });

  await storage.removeFromBlacklist(entry.id, locationB);
  assert.equal((await storage.getBlacklist(locationA)).length, 1);

  await storage.removeFromBlacklist(entry.id, locationA);
  assert.equal((await storage.getBlacklist(locationA)).length, 0);
});
