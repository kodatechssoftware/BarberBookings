import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAppointmentFinancials,
  calculateAppointmentsFinancials,
  loadAppointmentsFinancials,
} from "../../server/appointment-finance";
import { MemoryStorage } from "../../server/storage";
import type {
  Appointment,
  AppointmentExtra,
  AppointmentPaymentMethod,
  AppointmentStatus,
  BarberCompensationModel,
  BarberCompensationRule,
  ExtraFinancialRule,
} from "../../shared/schema";

let nextAppointmentId = 1;

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  const id = overrides.id ?? nextAppointmentId++;
  return {
    id,
    locationId: 1,
    barberId: 10,
    serviceId: 20,
    startTime: new Date("2035-01-15T10:00:00.000Z"),
    customerName: `Cliente ${id}`,
    customerEmail: null,
    customerPhone: "910000000",
    durationMinutes: 30,
    serviceNameSnapshot: null,
    servicePriceCentsSnapshot: null,
    manualOutsideHours: false,
    status: "completed",
    cancelToken: `finance-${id}`,
    cancelledAt: null,
    paymentMethod: "cash",
    depositRequired: false,
    depositReason: null,
    rescheduleRevision: 0,
    notificationRevision: 0,
    whatsappOptIn: false,
    whatsappOptInAt: null,
    seriesId: null,
    seriesOccurrenceIndex: null,
    createdAt: new Date("2035-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function extra(
  appointmentId: number,
  amountCentsSnapshot: number,
  financialRuleSnapshot: ExtraFinancialRule,
  overrides: Partial<AppointmentExtra> = {},
): AppointmentExtra {
  return {
    appointmentId,
    extraDefinitionId: overrides.extraDefinitionId ?? amountCentsSnapshot,
    nameSnapshot: overrides.nameSnapshot ?? `Extra ${amountCentsSnapshot}`,
    amountCentsSnapshot,
    financialRuleSnapshot,
    position: overrides.position ?? 0,
    createdAt: new Date("2035-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function compensationRule(
  model: BarberCompensationModel,
  overrides: Partial<BarberCompensationRule> = {},
): BarberCompensationRule {
  return {
    id: overrides.id ?? (model === "commission" ? 1 : model === "chair_rent" ? 2 : 3),
    barberId: 10,
    model,
    commissionPercent: model === "commission" ? 40 : null,
    chairRentCents: model === "chair_rent" ? 500 : null,
    chairRentPeriod: model === "chair_rent" ? "month" : null,
    effectiveFrom: new Date("2030-01-01T00:00:00.000Z"),
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const servicePrices = new Map([[20, 1500], [21, 101]]);

function oldServiceOnlyResult(
  status: AppointmentStatus,
  paymentMethod: AppointmentPaymentMethod,
  model: BarberCompensationModel,
  priceCents: number,
  commissionPercent = 40,
) {
  const realized = status === "completed" && paymentMethod !== "gift" ? priceCents : 0;
  const grossBarber = model === "commission"
    ? Math.round(realized * commissionPercent / 100)
    : model === "chair_rent"
      ? realized
      : 0;
  const chairRent = model === "chair_rent" && status === "completed" ? 500 : 0;
  return {
    serviceAmountCents: priceCents,
    extrasAmountCents: 0,
    totalAmountCents: priceCents,
    projectedAmountCents: status === "booked" ? priceCents : 0,
    realizedAmountCents: realized,
    barberAmountCents: grossBarber - chairRent,
    establishmentAmountCents: realized - grossBarber + chairRent,
  };
}

test("legacy appointments without Extras preserve the previous service-only result", () => {
  for (const [status, paymentMethod] of [
    ["booked", "pending"],
    ["completed", "cash"],
    ["completed", "gift"],
    ["cancelled", "pending"],
    ["late_cancelled", "pending"],
    ["no_show", "pending"],
  ] as const) {
    for (const model of ["none", "commission", "chair_rent"] as const) {
      const current = appointment({ status, paymentMethod });
      const actual = calculateAppointmentFinancials({
        appointment: current,
        servicePrices,
        compensationRules: [compensationRule(model)],
      });
      const expected = oldServiceOnlyResult(status, paymentMethod, model, 1500);
      assert.deepEqual({
        serviceAmountCents: actual.serviceAmountCents,
        extrasAmountCents: actual.extrasAmountCents,
        totalAmountCents: actual.totalAmountCents,
        projectedAmountCents: actual.projectedAmountCents,
        realizedAmountCents: actual.realizedAmountCents,
        barberAmountCents: actual.barberAmountCents,
        establishmentAmountCents: actual.establishmentAmountCents,
      }, expected);
    }
  }
});

test("commission splits every line independently and honors all Extra rules", () => {
  const current = appointment();
  const result = calculateAppointmentFinancials({
    appointment: current,
    appointmentExtras: [
      extra(current.id, 1000, "barber", { position: 0 }),
      extra(current.id, 700, "follow_compensation", { position: 1 }),
      extra(current.id, 300, "establishment", { position: 2 }),
    ],
    servicePrices,
    compensationRules: [compensationRule("commission")],
  });

  assert.deepEqual({
    service: result.serviceAmountCents,
    extras: result.extrasAmountCents,
    total: result.totalAmountCents,
    realized: result.realizedAmountCents,
    barber: result.barberAmountCents,
    establishment: result.establishmentAmountCents,
    commission: result.commissionAmountCents,
  }, {
    service: 1500,
    extras: 2000,
    total: 3500,
    realized: 3500,
    barber: 1880,
    establishment: 1620,
    commission: 880,
  });
  assert.deepEqual(result.lines.map((line) => ({
    kind: line.kind,
    rule: line.financialRule,
    amount: line.amountCents,
    barber: line.barberAmountCents,
    establishment: line.establishmentAmountCents,
  })), [
    { kind: "service", rule: "follow_compensation", amount: 1500, barber: 600, establishment: 900 },
    { kind: "extra", rule: "barber", amount: 1000, barber: 1000, establishment: 0 },
    { kind: "extra", rule: "follow_compensation", amount: 700, barber: 280, establishment: 420 },
    { kind: "extra", rule: "establishment", amount: 300, barber: 0, establishment: 300 },
  ]);
});

test("the 25/16/9 reference case is calculated from service and Extra lines", () => {
  const current = appointment();
  const result = calculateAppointmentFinancials({
    appointment: current,
    appointmentExtras: [extra(current.id, 1000, "barber")],
    servicePrices,
    compensationRules: [compensationRule("commission")],
  });
  assert.deepEqual({
    customer: result.realizedAmountCents,
    barber: result.barberAmountCents,
    establishment: result.establishmentAmountCents,
  }, { customer: 2500, barber: 1600, establishment: 900 });
});

test("special and custom service snapshots combine with fixed and variable Extra snapshots", () => {
  const special = appointment({ servicePriceCentsSnapshot: 2500, serviceNameSnapshot: "Corte especial" });
  const custom = appointment({ serviceId: null, servicePriceCentsSnapshot: 3000, serviceNameSnapshot: "Produção custom" });
  const fixedSnapshot = extra(special.id, 500, "establishment", { nameSnapshot: "Extra fixo" });
  const variableSnapshot = extra(custom.id, 1800, "barber", { nameSnapshot: "Extra variável" });
  const result = calculateAppointmentsFinancials({
    appointments: [special, custom],
    appointmentExtras: [fixedSnapshot, variableSnapshot],
    servicePrices,
    compensationRules: [compensationRule("commission")],
  });

  assert.deepEqual({
    service: result.serviceAmountCents,
    extras: result.extrasAmountCents,
    total: result.totalAmountCents,
  }, { service: 5500, extras: 2300, total: 7800 });
  assert.equal(result.byAppointmentId.get(special.id)?.totalAmountCents, 3000);
  assert.equal(result.byAppointmentId.get(custom.id)?.totalAmountCents, 4800);
});

test("booked is projected while cancelled, late-cancelled, no-show and gift realize zero including Extras", () => {
  for (const [status, paymentMethod, projected] of [
    ["booked", "pending", 2500],
    ["cancelled", "pending", 0],
    ["late_cancelled", "pending", 0],
    ["no_show", "pending", 0],
    ["completed", "gift", 0],
  ] as const) {
    const current = appointment({ status, paymentMethod });
    const result = calculateAppointmentFinancials({
      appointment: current,
      appointmentExtras: [extra(current.id, 1000, "barber")],
      servicePrices,
      compensationRules: [compensationRule("commission")],
    });
    assert.equal(result.totalAmountCents, 2500);
    assert.equal(result.projectedAmountCents, projected);
    assert.equal(result.realizedAmountCents, 0);
    assert.equal(result.barberAmountCents, 0);
    assert.equal(result.establishmentAmountCents, 0);
    assert.ok(result.lines.every((line) => line.realizedAmountCents === 0));
  }
});

test("voucher preserves nominal value and remuneration without becoming a cash/card receipt", () => {
  const voucherAppointment = appointment({ paymentMethod: "voucher" });
  const voucherResult = calculateAppointmentFinancials({
    appointment: voucherAppointment,
    appointmentExtras: [extra(voucherAppointment.id, 1000, "follow_compensation")],
    servicePrices,
    compensationRules: [compensationRule("commission")],
  });
  const cashAppointment = appointment({ paymentMethod: "cash" });
  const cashResult = calculateAppointmentFinancials({
    appointment: cashAppointment,
    appointmentExtras: [extra(cashAppointment.id, 1000, "follow_compensation")],
    servicePrices,
    compensationRules: [compensationRule("commission")],
  });

  assert.deepEqual({
    total: voucherResult.totalAmountCents,
    realized: voucherResult.realizedAmountCents,
    received: voucherResult.receivedAmountCents,
    cash: voucherResult.cashAmountCents,
    card: voucherResult.cardAmountCents,
    voucher: voucherResult.voucherAmountCents,
    gift: voucherResult.giftAmountCents,
    barber: voucherResult.barberAmountCents,
    establishment: voucherResult.establishmentAmountCents,
    commission: voucherResult.commissionAmountCents,
  }, {
    total: 2500,
    realized: 2500,
    received: 0,
    cash: 0,
    card: 0,
    voucher: 2500,
    gift: 0,
    barber: 1000,
    establishment: 1500,
    commission: 1000,
  });
  assert.deepEqual(
    [voucherResult.barberAmountCents, voucherResult.establishmentAmountCents, voucherResult.commissionAmountCents],
    [cashResult.barberAmountCents, cashResult.establishmentAmountCents, cashResult.commissionAmountCents],
  );
});

test("voucher keeps chair-rent and Extra financial rules unchanged", () => {
  const current = appointment({ paymentMethod: "voucher" });
  const result = calculateAppointmentFinancials({
    appointment: current,
    appointmentExtras: [
      extra(current.id, 1000, "barber", { position: 0 }),
      extra(current.id, 500, "establishment", { position: 1 }),
    ],
    servicePrices,
    compensationRules: [compensationRule("chair_rent")],
  });

  assert.deepEqual({
    total: result.totalAmountCents,
    voucher: result.voucherAmountCents,
    received: result.receivedAmountCents,
    realized: result.realizedAmountCents,
    barber: result.barberAmountCents,
    establishment: result.establishmentAmountCents,
    chairRent: result.chairRentAmountCents,
  }, {
    total: 3000,
    voucher: 3000,
    received: 0,
    realized: 3000,
    barber: 2000,
    establishment: 1000,
    chairRent: 500,
  });
});

test("integer-cent rounding preserves every cent across multiple percentage lines", () => {
  const current = appointment({ serviceId: 21 });
  const result = calculateAppointmentFinancials({
    appointment: current,
    appointmentExtras: [
      extra(current.id, 102, "follow_compensation", { position: 0 }),
      extra(current.id, 103, "follow_compensation", { position: 1 }),
    ],
    servicePrices,
    compensationRules: [compensationRule("commission", { commissionPercent: 33 })],
  });
  assert.deepEqual(result.lines.map((line) => [line.amountCents, line.barberAmountCents, line.establishmentAmountCents]), [
    [101, 33, 68],
    [102, 34, 68],
    [103, 34, 69],
  ]);
  assert.equal(result.barberAmountCents + result.establishmentAmountCents, result.realizedAmountCents);
  assert.equal(result.realizedAmountCents, 306);
});

test("chair rent is applied once per historical rule period after component-level overrides", () => {
  const first = appointment({ id: 101, startTime: new Date("2035-01-10T10:00:00.000Z") });
  const second = appointment({ id: 102, startTime: new Date("2035-01-20T10:00:00.000Z") });
  const rule = compensationRule("chair_rent", { id: 22, chairRentCents: 500, chairRentPeriod: "month" });
  const result = calculateAppointmentsFinancials({
    appointments: [second, first],
    appointmentExtras: [
      extra(first.id, 1000, "barber"),
      extra(second.id, 1000, "establishment"),
    ],
    servicePrices,
    compensationRules: [rule],
  });

  assert.equal(result.chairRentAmountCents, 500);
  assert.deepEqual({
    realized: result.realizedAmountCents,
    barber: result.barberAmountCents,
    establishment: result.establishmentAmountCents,
  }, { realized: 5000, barber: 3500, establishment: 1500 });
  assert.equal(result.byAppointmentId.get(first.id)?.chairRentAmountCents, 500);
  assert.equal(result.byAppointmentId.get(second.id)?.chairRentAmountCents, 0);

  const follow = appointment({ id: 103, startTime: new Date("2035-02-10T10:00:00.000Z") });
  const followResult = calculateAppointmentFinancials({
    appointment: follow,
    appointmentExtras: [extra(follow.id, 1000, "follow_compensation")],
    servicePrices,
    compensationRules: [rule],
  });
  assert.deepEqual({
    barber: followResult.barberAmountCents,
    establishment: followResult.establishmentAmountCents,
  }, { barber: 2000, establishment: 500 });
});

test("none assigns follow-compensation lines to the establishment but preserves explicit overrides", () => {
  const current = appointment();
  const result = calculateAppointmentFinancials({
    appointment: current,
    appointmentExtras: [
      extra(current.id, 1000, "follow_compensation", { position: 0 }),
      extra(current.id, 200, "barber", { position: 1 }),
    ],
    servicePrices,
    compensationRules: [compensationRule("none")],
  });
  assert.deepEqual({ barber: result.barberAmountCents, establishment: result.establishmentAmountCents }, {
    barber: 200,
    establishment: 2500,
  });
});

test("historical rules, locations and snapshot-only Extras remain isolated", () => {
  const oldAppointment = appointment({ id: 201, locationId: 1, startTime: new Date("2034-06-01T10:00:00.000Z") });
  const newAppointment = appointment({ id: 202, locationId: 2, startTime: new Date("2035-06-01T10:00:00.000Z") });
  const result = calculateAppointmentsFinancials({
    appointments: [oldAppointment, newAppointment],
    appointmentExtras: [
      extra(oldAppointment.id, 1000, "follow_compensation", { nameSnapshot: "Nome histórico A" }),
      extra(newAppointment.id, 2000, "establishment", { nameSnapshot: "Nome histórico B" }),
      extra(999999, 999999, "barber"),
    ],
    servicePrices,
    compensationRules: [
      compensationRule("commission", { id: 31, commissionPercent: 40, effectiveFrom: new Date("2034-01-01T00:00:00.000Z") }),
      compensationRule("commission", { id: 32, commissionPercent: 50, effectiveFrom: new Date("2035-01-01T00:00:00.000Z") }),
    ],
  });
  assert.equal(result.byAppointmentId.get(oldAppointment.id)?.barberAmountCents, 1000);
  assert.equal(result.byAppointmentId.get(newAppointment.id)?.barberAmountCents, 750);
  assert.equal(result.byAppointmentId.get(oldAppointment.id)?.lines[1].nameSnapshot, "Nome histórico A");
  assert.equal(result.byAppointmentId.get(newAppointment.id)?.lines[1].nameSnapshot, "Nome histórico B");
  assert.equal(result.extrasAmountCents, 3000);
});

test("batch loader performs one Extras read and one compensation read for many appointments", async () => {
  const appointments = Array.from({ length: 75 }, (_, index) => appointment({ id: 1000 + index }));
  let extrasReads = 0;
  let compensationReads = 0;
  const result = await loadAppointmentsFinancials({
    async getAppointmentExtras(ids) {
      extrasReads += 1;
      return ids.map((id) => extra(id, 100, "barber"));
    },
    async getBarberCompensationRules() {
      compensationReads += 1;
      return [compensationRule("commission")];
    },
  }, appointments, servicePrices);
  assert.equal(extrasReads, 1);
  assert.equal(compensationReads, 1);
  assert.equal(result.appointments.length, 75);
  assert.equal(result.extrasAmountCents, 7500);
});

test("MemoryStorage batch inputs produce snapshot-based financial results after catalogue changes", async () => {
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
    name: "Produto fixo original",
    pricingMode: "fixed",
    amountCents: 500,
    financialRule: "establishment",
  });
  const created = await storage.createAppointment({
    locationId: 1,
    barberId: 10,
    serviceId: 20,
    startTime: new Date("2035-04-10T10:00:00.000Z"),
    customerName: "Cliente Memory Finance",
    customerEmail: null,
    customerPhone: "910000001",
    durationMinutes: 30,
    cancelToken: "memory-finance",
    extras: [{ extraId: variable.id, amountCents: 1000 }, { extraId: fixed.id }],
  });
  await storage.updateAppointmentStatus(created.id, "completed", "cash");
  await storage.updateExtraDefinition(variable.id, 1, {
    name: "Deslocação alterada",
    financialRule: "establishment",
  });
  await storage.updateExtraDefinition(fixed.id, 1, {
    name: "Produto fixo alterado",
    amountCents: 900,
    financialRule: "barber",
  });
  await storage.createBarberCompensationRule(compensationRule("commission", { barberId: 10 }));
  const [completed] = (await storage.getAppointments()).filter((candidate) => candidate.id === created.id);
  const result = await loadAppointmentsFinancials(storage, [completed], servicePrices);
  assert.deepEqual({
    total: result.totalAmountCents,
    barber: result.barberAmountCents,
    establishment: result.establishmentAmountCents,
    extraName: result.appointments[0].lines[1].nameSnapshot,
    extraRule: result.appointments[0].lines[1].financialRule,
  }, {
    total: 3000,
    barber: 1600,
    establishment: 1400,
    extraName: "Deslocação original",
    extraRule: "barber",
  });
  assert.deepEqual({
    fixedName: result.appointments[0].lines[2].nameSnapshot,
    fixedAmount: result.appointments[0].lines[2].amountCents,
    fixedRule: result.appointments[0].lines[2].financialRule,
  }, {
    fixedName: "Produto fixo original",
    fixedAmount: 500,
    fixedRule: "establishment",
  });
});
