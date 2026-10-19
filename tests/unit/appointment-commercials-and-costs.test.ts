import assert from "node:assert/strict";
import test from "node:test";
import { calculateAppointmentFinancials } from "../../server/appointment-finance";
import type { CreateAppointmentStorageRequest } from "../../server/storage";

process.env.USE_MEMORY_STORAGE = "true";
process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:1/unused";
const {
  AppointmentExtrasError,
  AppointmentInternalCostsError,
  MemoryStorage,
} = await import("../../server/storage");

function appointmentInput(overrides: Partial<CreateAppointmentStorageRequest> = {}): CreateAppointmentStorageRequest {
  return {
    locationId: 1,
    barberId: 1,
    serviceId: 10,
    startTime: new Date("2036-03-02T10:00:00.000Z"),
    customerName: "Cliente QA",
    customerEmail: null,
    customerPhone: "910000040",
    durationMinutes: 60,
    serviceNameSnapshot: "Verniz Gel",
    servicePriceCentsSnapshot: 2200,
    cancelToken: "commercials-costs-default",
    ...overrides,
  };
}

test("commercial Extras support quantity, unit overrides, service applicability and immutable snapshots", async () => {
  const storage = new MemoryStorage();
  const nailArt = await storage.createExtraDefinition({
    locationId: 1,
    name: "Nail Art",
    description: "Decoração adicional",
    pricingMode: "fixed",
    amountCents: 200,
    financialRule: "establishment",
    isPubliclyBookable: false,
    serviceIds: [10],
  });
  assert.deepEqual(nailArt.serviceIds, [10]);
  assert.equal(nailArt.isPubliclyBookable, false);

  await assert.rejects(
    storage.createAppointment(appointmentInput({
      serviceId: 11,
      cancelToken: "commercials-costs-wrong-service",
      extras: [{ extraId: nailArt.id }],
    })),
    (error) => error instanceof AppointmentExtrasError && error.code === "APPOINTMENT_EXTRA_UNAVAILABLE",
  );

  const created = await storage.createAppointment(appointmentInput({
    extras: [{ extraId: nailArt.id, amountCents: 250, quantity: 3 }],
  }));
  const [snapshot] = await storage.getAppointmentExtras([created.id]);
  assert.equal(snapshot.amountCentsSnapshot, 250);
  assert.equal(snapshot.quantity, 3);

  await storage.updateExtraDefinition(nailArt.id, 1, { name: "Nail Art nova", amountCents: 500 });
  assert.deepEqual(await storage.getAppointmentExtras([created.id]), [snapshot]);

  const legacy = await storage.createAppointment(appointmentInput({
    startTime: new Date("2036-03-02T12:00:00.000Z"),
    cancelToken: "commercials-costs-legacy-payload",
    extras: [{ extraId: nailArt.id }],
  }));
  assert.equal((await storage.getAppointmentExtras([legacy.id]))[0].quantity, 1);
});

test("internal costs remain separate from customer revenue and completion freezes both ledgers atomically", async () => {
  const storage = new MemoryStorage();
  const extra = await storage.createExtraDefinition({
    locationId: 1,
    name: "Baby Boomer",
    pricingMode: "fixed",
    amountCents: 500,
    financialRule: "follow_compensation",
  });
  const material = await storage.createInternalCostDefinition({
    locationId: 1,
    name: "Gel técnico",
    description: "Consumo interno",
    defaultUnitCostCents: 125,
    unitLabel: "dose",
  });
  const created = await storage.createAppointment(appointmentInput({
    cancelToken: "commercials-costs-completion",
  }));
  const request = {
    appointmentId: created.id,
    expectedRevision: created.notificationRevision,
    paymentMethod: "card" as const,
    extras: [{ extraId: extra.id, amountCents: 450, quantity: 2 }],
    internalCosts: [{ internalCostId: material.id, unitCostCents: 100, quantity: 3 }],
    auditLog: {
      actorType: "admin",
      actorId: 1,
      actorName: "QA",
      actorUserId: null,
      actorProfessionalId: null,
      locationId: 1,
      action: "appointment.completed",
      entityType: "appointment",
      entityId: created.id,
      summary: "QA completion",
      metadata: "{}",
    },
  };
  const [first, concurrent] = await Promise.all([
    storage.completeAppointment(request),
    storage.completeAppointment(request),
  ]);
  assert.equal([first, concurrent].filter(Boolean).length, 1, "only one concurrent completion wins");
  const completed = first ?? concurrent!;
  assert.equal(completed.appointment.status, "completed");
  assert.equal(completed.appointment.paymentMethod, "card");
  assert.equal(completed.extras[0].quantity, 2);
  assert.equal(completed.internalCosts[0].quantity, 3);

  const financial = calculateAppointmentFinancials({
    appointment: completed.appointment,
    appointmentExtras: completed.extras,
    appointmentInternalCosts: completed.internalCosts,
    servicePrices: new Map([[10, 2200]]),
  });
  assert.equal(financial.serviceAmountCents, 2200);
  assert.equal(financial.extrasAmountCents, 900);
  assert.equal(financial.totalAmountCents, 3100, "customer revenue includes commercial Extras");
  assert.equal(financial.directCostAmountCents, 300, "internal consumption affects only direct cost");
  assert.equal(financial.grossMarginCents, 2800);
  assert.equal(financial.receivedAmountCents, 3100, "internal cost is not subtracted from payment or revenue");
  assert.equal(financial.establishmentAmountCents + financial.barberAmountCents, 3100,
    "direct cost is not double-subtracted from compensation allocation");

  await assert.rejects(
    storage.updateAppointmentWithNotification(
      created.id,
      {},
      false,
      undefined,
      [{ extraId: extra.id }],
      [{ internalCostId: material.id }],
    ),
    (error) => error instanceof AppointmentExtrasError || error instanceof AppointmentInternalCostsError,
  );
  assert.equal(await storage.completeAppointment(request), undefined, "completed appointment cannot be closed twice");
});

test("commercial and internal catalogues stay isolated by location", async () => {
  const storage = new MemoryStorage();
  const foreignExtra = await storage.createExtraDefinition({
    locationId: 2,
    name: "Extra da Loja B",
    pricingMode: "fixed",
    amountCents: 300,
    financialRule: "establishment",
  });
  const foreignCost = await storage.createInternalCostDefinition({
    locationId: 2,
    name: "Consumo da Loja B",
    defaultUnitCostCents: 100,
    unitLabel: "dose",
  });
  const appointment = await storage.createAppointment(appointmentInput({
    cancelToken: "commercials-costs-location-isolation",
  }));

  assert.deepEqual(await storage.getExtraDefinitions(1), []);
  assert.deepEqual(await storage.getInternalCostDefinitions(1), []);
  await assert.rejects(
    storage.updateAppointmentWithNotification(
      appointment.id,
      {},
      false,
      "booked",
      [{ extraId: foreignExtra.id }],
      [],
    ),
    (error) => error instanceof AppointmentExtrasError,
  );
  await assert.rejects(
    storage.updateAppointmentWithNotification(
      appointment.id,
      {},
      false,
      "booked",
      [],
      [{ internalCostId: foreignCost.id }],
    ),
    (error) => error instanceof AppointmentInternalCostsError,
  );
});

test("public commercial snapshots contain no internal cost fields", async () => {
  const { readFile } = await import("node:fs/promises");
  const routes = await readFile(new URL("../../server/routes.ts", import.meta.url), "utf8");
  const tokenRoute = routes.slice(
    routes.indexOf('app.get("/api/appointments/token/:token"'),
    routes.indexOf('app.post("/api/appointments/reschedule/:token"'),
  );
  assert.ok(tokenRoute.includes("appointmentExtras"));
  assert.ok(!tokenRoute.includes("appointmentInternalCosts"));
  assert.ok(!tokenRoute.includes("internalCosts"));

  const mutationInventory = routes.slice(
    routes.indexOf("function isLocationSensitiveMutation"),
    routes.indexOf("function sendAppointmentLocationIntegrityError"),
  );
  assert.match(mutationInventory, /admin\\\/internal-costs/);
  assert.match(mutationInventory, /status\|complete/);
});
