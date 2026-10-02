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
    pricingMode: "variable",
    amountCents: 999,
    financialRule: "barber",
  });
  assert.equal(travel.amountCents, null);
  const product = await storage.createExtraDefinition({
    locationId: 1,
    name: "Produto",
    pricingMode: "fixed",
    amountCents: 750,
    financialRule: "establishment",
  });
  const otherLocation = await storage.createExtraDefinition({
    locationId: 2,
    name: "Deslocação",
    pricingMode: "fixed",
    amountCents: 1200,
    financialRule: "follow_compensation",
  });

  assert.deepEqual((await storage.getExtraDefinitions(1)).map((extra) => extra.id), [travel.id, product.id]);
  assert.equal(await storage.getExtraDefinition(otherLocation.id, 1), undefined);
  await assert.rejects(
    storage.createExtraDefinition({
      locationId: 1,
      name: "Inválido",
      pricingMode: "fixed",
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
    extras: [{ extraId: travel.id, amountCents: 1000 }],
  }));
  const originalSnapshot = (await storage.getAppointmentExtras([appointment.id]))[0];
  assert.deepEqual({
    name: originalSnapshot.nameSnapshot,
    amount: originalSnapshot.amountCentsSnapshot,
    rule: originalSnapshot.financialRuleSnapshot,
  }, { name: "Deslocação", amount: 1000, rule: "barber" });

  await storage.updateExtraDefinition(travel.id, 1, {
    name: "Deslocação atualizada",
    financialRule: "follow_compensation",
  });
  assert.deepEqual(await storage.getAppointmentExtras([appointment.id]), [originalSnapshot]);

  const result = await storage.updateAppointmentWithNotification(
    appointment.id,
    {},
    true,
    "booked",
    [{ extraId: travel.id }, { extraId: product.id }],
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

  const fixedOverride = await storage.createAppointment(appointmentInput({
    startTime: new Date("2036-01-02T11:00:00.000Z"),
    cancelToken: "extra-memory-fixed-authoritative",
    extras: [{ extraId: product.id, amountCents: 9999 }],
  }));
  assert.equal((await storage.getAppointmentExtras([fixedOverride.id]))[0].amountCentsSnapshot, 750);

  await storage.updateExtraDefinition(product.id, 1, { isActive: false });
  await storage.updateAppointmentWithNotification(
    appointment.id, {}, false, "booked", [{ extraId: travel.id }, { extraId: product.id }],
  );
  assert.equal((await storage.getAppointmentExtras([appointment.id])).length, 2);

  const appointmentCount = (await storage.getAppointments()).length;
  await assert.rejects(storage.createAppointments([
    appointmentInput({
      startTime: new Date("2036-01-03T10:00:00.000Z"),
      cancelToken: "extra-memory-rollback-a",
      extras: [{ extraId: travel.id, amountCents: 1250 }],
    }),
    appointmentInput({
      startTime: new Date("2036-01-03T11:00:00.000Z"),
      cancelToken: "extra-memory-rollback-b",
      extras: [{ extraId: otherLocation.id }],
    }),
  ]), (error: any) => error?.code === "APPOINTMENT_EXTRA_UNAVAILABLE");
  assert.equal((await storage.getAppointments()).length, appointmentCount);

  await assert.rejects(storage.createAppointment(appointmentInput({
    startTime: new Date("2036-01-04T10:00:00.000Z"),
    cancelToken: "extra-memory-variable-missing",
    extras: [{ extraId: travel.id }],
  })), (error: any) => error?.code === "APPOINTMENT_EXTRA_AMOUNT_INVALID");
  await assert.rejects(storage.createAppointment(appointmentInput({
    startTime: new Date("2036-01-04T11:00:00.000Z"),
    cancelToken: "extra-memory-variable-zero",
    extras: [{ extraId: travel.id, amountCents: 0 }],
  })), (error: any) => error?.code === "APPOINTMENT_EXTRA_AMOUNT_INVALID");
  await storage.updateAppointmentStatus(appointment.id, "completed", "cash");
  await assert.rejects(
    storage.updateAppointmentWithNotification(appointment.id, {}, false, "completed", [{ extraId: travel.id }]),
    (error: any) => error?.code === "APPOINTMENT_EXTRAS_NOT_EDITABLE",
  );
});

test("catalogue changes affect only new fixed Extras and preserve variable snapshots", async () => {
  const storage = new MemoryStorage();
  const fixed = await storage.createExtraDefinition({
    locationId: 1,
    name: "Produto snapshot",
    pricingMode: "fixed",
    amountCents: 1000,
    financialRule: "establishment",
  });
  const variable = await storage.createExtraDefinition({
    locationId: 1,
    name: "Deslocação snapshot",
    pricingMode: "variable",
    amountCents: null,
    financialRule: "barber",
  });
  const oldAppointment = await storage.createAppointment(appointmentInput({
    startTime: new Date("2036-01-05T10:00:00.000Z"),
    cancelToken: "extra-memory-snapshot-old",
    extras: [
      { extraId: fixed.id },
      { extraId: variable.id, amountCents: 1800 },
    ],
  }));

  await storage.updateExtraDefinition(fixed.id, 1, { amountCents: 1500 });
  await storage.updateExtraDefinition(variable.id, 1, {
    name: "Deslocação atualizada",
    financialRule: "follow_compensation",
  });
  const newAppointment = await storage.createAppointment(appointmentInput({
    startTime: new Date("2036-01-05T11:00:00.000Z"),
    cancelToken: "extra-memory-snapshot-new",
    extras: [{ extraId: fixed.id }],
  }));

  const snapshots = await storage.getAppointmentExtras([oldAppointment.id, newAppointment.id]);
  const oldSnapshots = snapshots.filter((extra) => extra.appointmentId === oldAppointment.id);
  const newSnapshots = snapshots.filter((extra) => extra.appointmentId === newAppointment.id);
  assert.deepEqual(oldSnapshots.map((extra) => ({
    name: extra.nameSnapshot,
    amount: extra.amountCentsSnapshot,
    rule: extra.financialRuleSnapshot,
  })), [
    { name: "Produto snapshot", amount: 1000, rule: "establishment" },
    { name: "Deslocação snapshot", amount: 1800, rule: "barber" },
  ]);
  assert.deepEqual(newSnapshots.map((extra) => ({
    name: extra.nameSnapshot,
    amount: extra.amountCentsSnapshot,
    rule: extra.financialRuleSnapshot,
  })), [
    { name: "Produto snapshot", amount: 1500, rule: "establishment" },
  ]);
});

test("recurring storage rejects Extras before persisting the series", async () => {
  const storage = new MemoryStorage();
  const extra = await storage.createExtraDefinition({
    locationId: 1,
    name: "Recorrência proibida",
    pricingMode: "fixed",
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
        extras: [{ extraId: extra.id }],
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

test("appointment Extra replacement preserves untouched snapshots and edits booked variable values", async () => {
  const storage = new MemoryStorage();
  const variable = await storage.createExtraDefinition({
    locationId: 1,
    name: "Deslocação original",
    pricingMode: "variable",
    amountCents: null,
    financialRule: "barber",
  });
  const fixed = await storage.createExtraDefinition({
    locationId: 1,
    name: "Produto original",
    pricingMode: "fixed",
    amountCents: 500,
    financialRule: "establishment",
  });
  const appointment = await storage.createAppointment(appointmentInput({
    startTime: new Date("2036-03-01T10:00:00.000Z"),
    cancelToken: "extra-memory-edit",
    serviceNameSnapshot: "Corte acordado",
    servicePriceCentsSnapshot: 1500,
    extras: [
      { extraId: variable.id, amountCents: 1000 },
      { extraId: fixed.id },
    ],
  }));
  const original = await storage.getAppointmentExtras([appointment.id]);

  await storage.updateExtraDefinition(variable.id, 1, {
    name: "Deslocação atual",
    financialRule: "follow_compensation",
  });
  await storage.updateExtraDefinition(fixed.id, 1, {
    name: "Produto atual",
    amountCents: 750,
  });
  await storage.updateAppointmentWithNotification(appointment.id, {
    servicePriceCentsSnapshot: 2000,
  }, false);
  assert.deepEqual(await storage.getAppointmentExtras([appointment.id]), original, "an absent extras field must preserve snapshots");

  await storage.updateAppointmentWithNotification(appointment.id, {}, false, undefined, [
    { extraId: variable.id, amountCents: 1000 },
    { extraId: fixed.id },
  ]);
  assert.deepEqual(await storage.getAppointmentExtras([appointment.id]), original, "an unchanged selection must preserve old catalogue snapshots");

  await storage.updateAppointmentWithNotification(appointment.id, {}, false, undefined, [
    { extraId: variable.id, amountCents: 1800 },
    { extraId: fixed.id },
  ]);
  const edited = await storage.getAppointmentExtras([appointment.id]);
  assert.deepEqual({
    name: edited[0].nameSnapshot,
    amount: edited[0].amountCentsSnapshot,
    rule: edited[0].financialRuleSnapshot,
  }, {
    name: "Deslocação atual",
    amount: 1800,
    rule: "follow_compensation",
  });
  assert.deepEqual({
    name: edited[1].nameSnapshot,
    amount: edited[1].amountCentsSnapshot,
  }, {
    name: "Produto original",
    amount: 500,
  });

  await storage.updateExtraDefinition(fixed.id, 1, { isActive: false });
  await storage.updateAppointmentWithNotification(appointment.id, {}, false, undefined, [
    { extraId: fixed.id },
  ]);
  assert.equal((await storage.getAppointmentExtras([appointment.id]))[0].amountCentsSnapshot, 500);
  await storage.updateAppointmentWithNotification(appointment.id, {}, false, undefined, []);
  assert.deepEqual(await storage.getAppointmentExtras([appointment.id]), []);
  await assert.rejects(
    storage.updateAppointmentWithNotification(appointment.id, {}, false, undefined, [{ extraId: fixed.id }]),
    (error: any) => error?.code === "APPOINTMENT_EXTRA_UNAVAILABLE",
  );
  assert.deepEqual(await storage.getAppointmentExtras([appointment.id]), []);
});

test("historical appointment states reject Extra replacement", async () => {
  for (const status of ["completed", "cancelled", "late_cancelled", "no_show"] as const) {
    const storage = new MemoryStorage();
    const extra = await storage.createExtraDefinition({
      locationId: 1,
      name: `Extra ${status}`,
      pricingMode: "fixed",
      amountCents: 500,
      financialRule: "follow_compensation",
    });
    const appointment = await storage.createAppointment(appointmentInput({
      startTime: new Date(`2036-04-${status === "completed" ? "01" : status === "cancelled" ? "02" : status === "late_cancelled" ? "03" : "04"}T10:00:00.000Z`),
      cancelToken: `extra-memory-${status}`,
      extras: [{ extraId: extra.id }],
    }));
    await storage.updateAppointmentStatus(appointment.id, status, status === "completed" ? "cash" : undefined);
    await assert.rejects(
      storage.updateAppointmentWithNotification(appointment.id, {}, false, undefined, []),
      (error: any) => error?.code === "APPOINTMENT_EXTRAS_NOT_EDITABLE",
    );
    assert.equal((await storage.getAppointmentExtras([appointment.id]))[0].amountCentsSnapshot, 500);
  }
});
