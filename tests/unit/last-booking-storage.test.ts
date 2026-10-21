import assert from "node:assert/strict";
import test from "node:test";
import {
  LAST_BOOKING_RETENTION_DAYS,
  LAST_BOOKING_STORAGE_KEY,
  readLastBookingPreference,
  saveLastBookingPreference,
} from "../../client/src/lib/last-booking-storage";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(LAST_BOOKING_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test("keeps a recent last booking preference", () => {
  const now = new Date("2026-10-21T12:00:00.000Z");
  const storage = memoryStorage();
  saveLastBookingPreference(storage, {
    barberId: 2,
    serviceId: 7,
    customerName: "Cliente Teste",
    customerEmail: "cliente@example.test",
    customerPhone: "+351900000000",
  }, now);

  assert.deepEqual(readLastBookingPreference(storage, now), {
    barberId: 2,
    serviceId: 7,
    customerName: "Cliente Teste",
    customerEmail: "cliente@example.test",
    customerPhone: "+351900000000",
  });
});

test("removes an expired preference containing personal data", () => {
  const updatedAt = new Date("2026-09-01T12:00:00.000Z");
  const now = new Date(updatedAt.getTime() + (LAST_BOOKING_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
  const storage = memoryStorage(JSON.stringify({
    barberId: 2,
    serviceId: 7,
    customerName: "Cliente Antigo",
    customerEmail: "antigo@example.test",
    customerPhone: "+351911111111",
    updatedAt: updatedAt.toISOString(),
  }));

  assert.equal(readLastBookingPreference(storage, now), null);
  assert.equal(storage.getItem(LAST_BOOKING_STORAGE_KEY), null);
});

test("fails closed and removes legacy, malformed or future-dated entries", () => {
  const now = new Date("2026-10-21T12:00:00.000Z");
  for (const value of [
    JSON.stringify({ customerName: "Sem timestamp" }),
    "not-json",
    JSON.stringify({ updatedAt: "2026-10-22T12:00:00.000Z" }),
  ]) {
    const storage = memoryStorage(value);
    assert.equal(readLastBookingPreference(storage, now), null);
    assert.equal(storage.getItem(LAST_BOOKING_STORAGE_KEY), null);
  }
});
