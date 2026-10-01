import assert from "node:assert/strict";
import test from "node:test";
import type {
  CreateAppointmentStorageRequest,
  CreateRecurringAppointmentSeriesRequest,
} from "../../server/storage";

process.env.USE_MEMORY_STORAGE = "true";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://unused:unused@127.0.0.1:1/unused";
const { MemoryStorage } = await import("../../server/storage");

function appointmentInput(
  overrides: Partial<CreateAppointmentStorageRequest> = {},
): CreateAppointmentStorageRequest {
  return {
    locationId: 1,
    barberId: 1,
    serviceId: 1,
    startTime: new Date("2036-01-02T10:00:00.000Z"),
    customerName: "Cliente Extra",
    customerEmail: null,
    customerPhone: "910000030",
    durationMinutes: 30,
    cancelToken: "extra-memory-default",
    ...overrides,
  };
}

test("memory storage preserves Extra snapshots and enforces transactional selection rules", async () => {
  const storage = new MemoryStorage();
  const travel = await storage.createExtraDefinition({
    locationId: 1,
    name: "Deslocação",
    amountCents: 1000,
    financialRule: "barber",
  });
  const product = await storage.createExtraDefinition({
    locationId: 1,
    name: "Produto",
    amountCents: 750,
    financialRule: "establishment",
  });
  const otherLocation = await storage.createExtraDefinition({
    locationId: 2,
    name: "Deslocação",
    amountCents: 1200,
    financialRule: "follow_compensation",
  });

  assert.deepEqual((await storage.getExtraDefinitions(1)).map((extra) => extra.id), [travel.id, product.id]);
  assert.equal(await storage.getExtraDefinition(otherLocation.id, 1), undefined);
  await assert.rejects(
    storage.createExtraDefinition({
      locationId: 1,
      name: "Inválido",
      amountCents: 0,
      financialRule: "barber",
    }),
  );

  const legacy = await storage.createAppointment(appointmentInput({
    startTime: new Date("2036-01-02T09:00:00.000Z"),
    cancelToken: "extra-memory-legacy",
  }));
  assert.deepEqual(await storage.getAppointmentExtras([legacy.id]), []);

  const appointment = await storage.createAppointment(appointmentInput({
    extraDefinitionIds: [travel.id],
  }));
  const originalSnapshot = (await storage.getAppointmentExtras([appointment.id]))[0];
  assert.deepEqual({
    name: originalSnapshot.nameSnapshot,
    amount: originalSnapshot.amountCentsSnapshot,
    rule: originalSnapshot.financialRuleSnapshot,
  }, { name: "Deslocação", amount: 1000, rule: "barber" });

  await storage.updateExtraDefinition(travel.id, 1, {
    name: "Deslocação atualizada",
    amountCents: 1500,
    financialRule: "follow_compensation",
  });
  assert.deepEqual(await storage.getAppointmentExtras([appointment.id]), [originalSnapshot]);

  const result = await storage.updateAppointmentWithNotification(
    appointment.id,
    {},
    true,
    "booked",
    [travel.id, product.id],
  );
  assert.equal(result?.notificationEvent, null);
  assert.equal(result?.appointment.notificationRevision, appointment.notificationRevision);
  assert.deepEqual(
    (await storage.getAppointmentExtras([appointment.id])).map((extra) => ({
      definitionId: extra.extraDefinitionId,
      name: extra.nameSnapshot,
      amount: extra.amountCentsSnapshot,
      position: extra.position,
    })),
    [
      { definitionId: travel.id, name: "Deslocação", amount: 1000, position: 0 },
      { definitionId: product.id, name: "Produto", amount: 750, position: 1 },
    ],
  );

  await storage.updateExtraDefinition(product.id, 1, { isActive: false });
  await storage.updateAppointmentWithNotification(
    appointment.id, {}, false, "booked", [travel.id, product.id],
  );
  assert.equal((await storage.getAppointmentExtras([appointment.id])).length, 2);

  const appointmentCount = (await storage.getAppointments()).length;
  await assert.rejects(storage.createAppointments([
    appointmentInput({
      startTime: new Date("2036-01-03T10:00:00.000Z"),
      cancelToken: "extra-memory-rollback-a",
      extraDefinitionIds: [travel.id],
    }),
    appointmentInput({
      startTime: new Date("2036-01-03T11:00:00.000Z"),
      cancelToken: "extra-memory-rollback-b",
      extraDefinitionIds: [otherLocation.id],
    }),
  ]), (error: any) => error?.code === "APPOINTMENT_EXTRA_UNAVAILABLE");
  assert.equal((await storage.getAppointments()).length, appointmentCount);

  await storage.updateAppointmentStatus(appointment.id, "completed", "cash");
  await assert.rejects(
    storage.updateAppointmentWithNotification(appointment.id, {}, false, "completed", [travel.id]),
    (error: any) => error?.code === "APPOINTMENT_EXTRAS_NOT_EDITABLE",
  );
});

test("recurring storage rejects Extras before persisting the series", async () => {
  const storage = new MemoryStorage();
  const extra = await storage.createExtraDefinition({
    locationId: 1,
    name: "Recorrência proibida",
    amountCents: 500,
    financialRule: "follow_compensation",
  });
  const firstStartTime = new Date("2036-02-01T10:00:00.000Z");
  const request: CreateRecurringAppointmentSeriesRequest = {
    series: {
      id: "memory-extra-series",
      locationId: 1,
      barberId: 1,
      serviceId: 1,
      customerName: "Cliente recorrente",
      customerEmail: null,
      customerPhone: "910000031",
      whatsappOptIn: false,
      whatsappOptInAt: null,
      intervalWeeks: 1,
      durationMonths: 1,
      occurrenceCount: 2,
      firstStartTime,
    },
    appointments: [firstStartTime, new Date("2036-02-08T10:00:00.000Z")].map((startTime, index) =>
      appointmentInput({
        startTime,
        customerName: "Cliente recorrente",
        customerPhone: "910000031",
        cancelToken: `memory-extra-series-${index}`,
        extraDefinitionIds: [extra.id],
      })),
    notificationSnapshot: {
      schemaVersion: 1 as const,
      customerName: "Cliente recorrente",
      customerEmail: null,
      customerPhone: "910000031",
      whatsappOptIn: false,
      location: { id: 1, name: "Principal", address: "Morada", timezone: "Europe/Lisbon" },
      service: { id: 1, name: "Corte" },
      barber: { id: 1, name: "Barbeiro" },
      recurrence: { intervalWeeks: 1, durationMonths: 1, occurrenceCount: 2 },
    },
  };

  await assert.rejects(
    storage.createRecurringAppointmentSeries(request),
    (error: any) => error?.code === "APPOINTMENT_EXTRAS_NOT_ALLOWED_FOR_RECURRING",
  );
  assert.equal(await storage.getAppointmentSeries(request.series.id), undefined);
  assert.equal((await storage.getAppointments()).length, 0);
});
