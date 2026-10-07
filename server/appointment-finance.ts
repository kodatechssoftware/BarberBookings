import {
  getAppointmentPriceCents,
  type AppointmentServiceTermsLike,
} from "@shared/appointment-service-terms";
import { getCalendarDateInTimeZone } from "@shared/public-booking-window";
import type {
  Appointment,
  AppointmentExtra,
  BarberCompensationModel,
  BarberCompensationRule,
  ChairRentPeriod,
  ExtraFinancialRule,
} from "@shared/schema";

export type AppointmentFinancialLine = {
  kind: "service" | "extra";
  referenceId: number | null;
  nameSnapshot: string | null;
  position: number;
  financialRule: ExtraFinancialRule;
  amountCents: number;
  realizedAmountCents: number;
  barberAmountCents: number;
  establishmentAmountCents: number;
  commissionAmountCents: number;
};

export type AppointmentFinancialResult = {
  appointmentId: number;
  locationId: number;
  barberId: number;
  compensationRuleId: number | null;
  compensationModel: BarberCompensationModel;
  commissionPercent: number | null;
  chairRentCents: number | null;
  chairRentPeriod: ChairRentPeriod | null;
  serviceAmountCents: number;
  extrasAmountCents: number;
  totalAmountCents: number;
  receivedAmountCents: number;
  cashAmountCents: number;
  cardAmountCents: number;
  voucherAmountCents: number;
  giftAmountCents: number;
  pendingPaymentAmountCents: number;
  projectedAmountCents: number;
  realizedAmountCents: number;
  barberAmountCents: number;
  establishmentAmountCents: number;
  commissionAmountCents: number;
  chairRentAmountCents: number;
  lines: AppointmentFinancialLine[];
};

export type AppointmentsFinancialResult = {
  appointments: AppointmentFinancialResult[];
  byAppointmentId: ReadonlyMap<number, AppointmentFinancialResult>;
  serviceAmountCents: number;
  extrasAmountCents: number;
  totalAmountCents: number;
  receivedAmountCents: number;
  cashAmountCents: number;
  cardAmountCents: number;
  voucherAmountCents: number;
  giftAmountCents: number;
  pendingPaymentAmountCents: number;
  projectedAmountCents: number;
  realizedAmountCents: number;
  barberAmountCents: number;
  establishmentAmountCents: number;
  commissionAmountCents: number;
  chairRentAmountCents: number;
};

export type AppointmentFinanceDataSource = {
  getAppointmentExtras(appointmentIds: number[]): Promise<AppointmentExtra[]>;
  getBarberCompensationRules(barberId?: number, locationId?: number): Promise<BarberCompensationRule[]>;
  getAppointments?(barberId?: number, date?: string, locationId?: number): Promise<Appointment[]>;
};

type CalculateAppointmentsFinancialsInput = {
  appointments: readonly Appointment[];
  appointmentExtras: readonly AppointmentExtra[];
  servicePrices: ReadonlyMap<number, number>;
  compensationRules: readonly BarberCompensationRule[];
  chairRentAnchorAppointmentIds?: ReadonlySet<number>;
};

type CalculateAppointmentFinancialsInput = {
  appointment: Appointment;
  appointmentExtras?: readonly AppointmentExtra[];
  servicePrices: ReadonlyMap<number, number>;
  compensationRules?: readonly BarberCompensationRule[];
};

export function createDefaultCompensationRule(barberId: number, locationId: number): BarberCompensationRule {
  return {
    id: 0,
    barberId,
    locationId,
    model: "none",
    commissionPercent: null,
    chairRentCents: null,
    chairRentPeriod: null,
    effectiveFrom: new Date(0),
    createdAt: new Date(0),
  };
}

export function getCompensationRuleForDate(
  rules: readonly BarberCompensationRule[],
  barberId: number,
  locationId: number,
  date: Date,
) {
  const timestamp = date.getTime();
  const barberRules = rules
    .filter((candidate) => candidate.barberId === barberId && candidate.locationId === locationId)
    .sort((left, right) => new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime());
  const rule = barberRules.find((candidate) => new Date(candidate.effectiveFrom).getTime() <= timestamp);
  return rule || createDefaultCompensationRule(barberId, locationId);
}

export function getCompensationRuleForAppointment(
  rules: readonly BarberCompensationRule[],
  appointment: Pick<Appointment,
    "barberId" | "locationId" | "startTime" | "compensationRuleIdSnapshot" |
    "compensationModelSnapshot" | "commissionPercentSnapshot" |
    "chairRentCentsSnapshot" | "chairRentPeriodSnapshot">,
): BarberCompensationRule {
  if (appointment.compensationModelSnapshot) {
    return {
      id: appointment.compensationRuleIdSnapshot ?? 0,
      barberId: appointment.barberId,
      locationId: appointment.locationId,
      model: appointment.compensationModelSnapshot,
      commissionPercent: appointment.commissionPercentSnapshot,
      chairRentCents: appointment.chairRentCentsSnapshot,
      chairRentPeriod: appointment.chairRentPeriodSnapshot,
      effectiveFrom: new Date(0),
      createdAt: new Date(0),
    };
  }
  return getCompensationRuleForDate(
    rules,
    appointment.barberId,
    appointment.locationId,
    new Date(appointment.startTime),
  );
}

export function createAppointmentCompensationSnapshot(
  rule: BarberCompensationRule,
): Pick<Appointment,
  "compensationRuleIdSnapshot" | "compensationModelSnapshot" |
  "commissionPercentSnapshot" | "chairRentCentsSnapshot" | "chairRentPeriodSnapshot"> {
  return {
    compensationRuleIdSnapshot: rule.id > 0 ? rule.id : null,
    compensationModelSnapshot: rule.model,
    commissionPercentSnapshot: rule.model === "commission" ? rule.commissionPercent : null,
    chairRentCentsSnapshot: rule.model === "chair_rent" ? rule.chairRentCents : null,
    chairRentPeriodSnapshot: rule.model === "chair_rent" ? rule.chairRentPeriod : null,
  };
}

const SHOP_TIME_ZONE = process.env.SHOP_TIME_ZONE?.trim() || "Europe/Lisbon";

function calendarDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getChairRentUnitKey(
  date: Date,
  period: ChairRentPeriod,
  timeZone = SHOP_TIME_ZONE,
) {
  const calendarDate = getCalendarDateInTimeZone(date, timeZone);
  if (period === "day") {
    return calendarDateKey(calendarDate.year, calendarDate.month, calendarDate.day);
  }
  if (period === "week") {
    const value = new Date(Date.UTC(calendarDate.year, calendarDate.month - 1, calendarDate.day));
    value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
    return calendarDateKey(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  return `${calendarDate.year}-${String(calendarDate.month).padStart(2, "0")}`;
}

function roundPercentageCents(amountCents: number, percent: number) {
  return Math.floor((amountCents * percent + 50) / 100);
}

function splitRealizedAmount(
  realizedAmountCents: number,
  financialRule: ExtraFinancialRule,
  compensationRule: BarberCompensationRule,
) {
  if (financialRule === "barber") {
    return {
      barberAmountCents: realizedAmountCents,
      establishmentAmountCents: 0,
      commissionAmountCents: 0,
    };
  }
  if (financialRule === "establishment") {
    return {
      barberAmountCents: 0,
      establishmentAmountCents: realizedAmountCents,
      commissionAmountCents: 0,
    };
  }
  if (compensationRule.model === "commission") {
    const percent = compensationRule.commissionPercent ?? 0;
    const barberAmountCents = roundPercentageCents(realizedAmountCents, percent);
    return {
      barberAmountCents,
      establishmentAmountCents: realizedAmountCents - barberAmountCents,
      commissionAmountCents: barberAmountCents,
    };
  }
  if (compensationRule.model === "chair_rent") {
    return {
      barberAmountCents: realizedAmountCents,
      establishmentAmountCents: 0,
      commissionAmountCents: 0,
    };
  }
  return {
    barberAmountCents: 0,
    establishmentAmountCents: realizedAmountCents,
    commissionAmountCents: 0,
  };
}

function createFinancialLine(
  line: Omit<AppointmentFinancialLine,
    "realizedAmountCents" | "barberAmountCents" | "establishmentAmountCents" | "commissionAmountCents">,
  isRealized: boolean,
  compensationRule: BarberCompensationRule,
): AppointmentFinancialLine {
  const realizedAmountCents = isRealized ? line.amountCents : 0;
  return {
    ...line,
    realizedAmountCents,
    ...splitRealizedAmount(realizedAmountCents, line.financialRule, compensationRule),
  };
}

function sum<T>(values: readonly T[], select: (value: T) => number) {
  return values.reduce((total, value) => total + select(value), 0);
}

export function getAppointmentPaymentAmounts(
  appointment: Pick<Appointment, "status" | "paymentMethod">,
  totalAmountCents: number,
) {
  const amounts = {
    receivedAmountCents: 0,
    cashAmountCents: 0,
    cardAmountCents: 0,
    voucherAmountCents: 0,
    giftAmountCents: 0,
    pendingPaymentAmountCents: 0,
  };
  if (appointment.status !== "completed") return amounts;

  if (appointment.paymentMethod === "cash") {
    amounts.cashAmountCents = totalAmountCents;
    amounts.receivedAmountCents = totalAmountCents;
  } else if (appointment.paymentMethod === "card") {
    amounts.cardAmountCents = totalAmountCents;
    amounts.receivedAmountCents = totalAmountCents;
  } else if (appointment.paymentMethod === "voucher") {
    amounts.voucherAmountCents = totalAmountCents;
  } else if (appointment.paymentMethod === "gift") {
    amounts.giftAmountCents = totalAmountCents;
  } else {
    amounts.pendingPaymentAmountCents = totalAmountCents;
  }
  return amounts;
}

function calculateBaseAppointmentFinancials(
  appointment: Appointment,
  extras: readonly AppointmentExtra[],
  servicePrices: ReadonlyMap<number, number>,
  compensationRule: BarberCompensationRule,
): AppointmentFinancialResult {
  const serviceAmountCents = getAppointmentPriceCents(
    appointment as AppointmentServiceTermsLike,
    servicePrices,
  );
  const isRealized = appointment.status === "completed" && appointment.paymentMethod !== "gift";
  const orderedExtras = [...extras].sort((left, right) => left.position - right.position);
  const lines: AppointmentFinancialLine[] = [
    createFinancialLine({
      kind: "service",
      referenceId: appointment.serviceId,
      nameSnapshot: appointment.serviceNameSnapshot,
      position: 0,
      financialRule: "follow_compensation",
      amountCents: serviceAmountCents,
    }, isRealized, compensationRule),
    ...orderedExtras.map((extra) => createFinancialLine({
      kind: "extra" as const,
      referenceId: extra.extraDefinitionId,
      nameSnapshot: extra.nameSnapshot,
      position: extra.position + 1,
      financialRule: extra.financialRuleSnapshot,
      amountCents: extra.amountCentsSnapshot,
    }, isRealized, compensationRule)),
  ];
  const extrasAmountCents = sum(orderedExtras, (extra) => extra.amountCentsSnapshot);
  const totalAmountCents = serviceAmountCents + extrasAmountCents;
  const paymentAmounts = getAppointmentPaymentAmounts(appointment, totalAmountCents);

  return {
    appointmentId: appointment.id,
    locationId: appointment.locationId,
    barberId: appointment.barberId,
    compensationRuleId: compensationRule.id > 0 ? compensationRule.id : null,
    compensationModel: compensationRule.model,
    commissionPercent: compensationRule.commissionPercent,
    chairRentCents: compensationRule.chairRentCents,
    chairRentPeriod: compensationRule.chairRentPeriod,
    serviceAmountCents,
    extrasAmountCents,
    totalAmountCents,
    ...paymentAmounts,
    projectedAmountCents: appointment.status === "booked" ? totalAmountCents : 0,
    realizedAmountCents: sum(lines, (line) => line.realizedAmountCents),
    barberAmountCents: sum(lines, (line) => line.barberAmountCents),
    establishmentAmountCents: sum(lines, (line) => line.establishmentAmountCents),
    commissionAmountCents: sum(lines, (line) => line.commissionAmountCents),
    chairRentAmountCents: 0,
    lines,
  };
}

export function calculateAppointmentsFinancials({
  appointments,
  appointmentExtras,
  servicePrices,
  compensationRules,
  chairRentAnchorAppointmentIds,
}: CalculateAppointmentsFinancialsInput): AppointmentsFinancialResult {
  const appointmentIds = new Set(appointments.map((appointment) => appointment.id));
  const extrasByAppointment = new Map<number, AppointmentExtra[]>();
  for (const extra of appointmentExtras) {
    if (!appointmentIds.has(extra.appointmentId)) continue;
    const selected = extrasByAppointment.get(extra.appointmentId) ?? [];
    selected.push(extra);
    extrasByAppointment.set(extra.appointmentId, selected);
  }

  const rulesByAppointment = new Map<number, BarberCompensationRule>();
  const results = appointments.map((appointment) => {
    const rule = getCompensationRuleForAppointment(compensationRules, appointment);
    rulesByAppointment.set(appointment.id, rule);
    return calculateBaseAppointmentFinancials(
      appointment,
      extrasByAppointment.get(appointment.id) ?? [],
      servicePrices,
      rule,
    );
  });

  const chairRentKeys = new Set<string>();
  const resultById = new Map(results.map((result) => [result.appointmentId, result]));
  const chronologicalAppointments = [...appointments].sort((left, right) =>
    new Date(left.startTime).getTime() - new Date(right.startTime).getTime() || left.id - right.id);
  for (const appointment of chronologicalAppointments) {
    const result = resultById.get(appointment.id)!;
    const rule = rulesByAppointment.get(appointment.id)!;
    if (appointment.status !== "completed" || rule.model !== "chair_rent") continue;
    const rentPeriod = rule.chairRentPeriod || "month";
    if (chairRentAnchorAppointmentIds && !chairRentAnchorAppointmentIds.has(appointment.id)) continue;
    const rentKey = `${appointment.barberId}:${appointment.locationId}:${rentPeriod}:${getChairRentUnitKey(new Date(appointment.startTime), rentPeriod)}`;
    if (chairRentKeys.has(rentKey)) continue;
    chairRentKeys.add(rentKey);
    const chairRentAmountCents = rule.chairRentCents || 0;
    result.chairRentAmountCents = chairRentAmountCents;
    result.barberAmountCents -= chairRentAmountCents;
    result.establishmentAmountCents += chairRentAmountCents;
  }

  return {
    appointments: results,
    byAppointmentId: resultById,
    serviceAmountCents: sum(results, (result) => result.serviceAmountCents),
    extrasAmountCents: sum(results, (result) => result.extrasAmountCents),
    totalAmountCents: sum(results, (result) => result.totalAmountCents),
    receivedAmountCents: sum(results, (result) => result.receivedAmountCents),
    cashAmountCents: sum(results, (result) => result.cashAmountCents),
    cardAmountCents: sum(results, (result) => result.cardAmountCents),
    voucherAmountCents: sum(results, (result) => result.voucherAmountCents),
    giftAmountCents: sum(results, (result) => result.giftAmountCents),
    pendingPaymentAmountCents: sum(results, (result) => result.pendingPaymentAmountCents),
    projectedAmountCents: sum(results, (result) => result.projectedAmountCents),
    realizedAmountCents: sum(results, (result) => result.realizedAmountCents),
    barberAmountCents: sum(results, (result) => result.barberAmountCents),
    establishmentAmountCents: sum(results, (result) => result.establishmentAmountCents),
    commissionAmountCents: sum(results, (result) => result.commissionAmountCents),
    chairRentAmountCents: sum(results, (result) => result.chairRentAmountCents),
  };
}

export function getChairRentAnchorAppointmentIds(
  appointments: readonly Appointment[],
  compensationRules: readonly BarberCompensationRule[],
) {
  const keys = new Set<string>();
  const anchors = new Set<number>();
  const chronological = [...appointments].sort((left, right) =>
    new Date(left.startTime).getTime() - new Date(right.startTime).getTime() || left.id - right.id);
  for (const appointment of chronological) {
    if (appointment.status !== "completed") continue;
    const rule = getCompensationRuleForAppointment(compensationRules, appointment);
    if (rule.model !== "chair_rent") continue;
    const period = rule.chairRentPeriod || "month";
    const key = `${appointment.barberId}:${appointment.locationId}:${period}:${getChairRentUnitKey(new Date(appointment.startTime), period)}`;
    if (keys.has(key)) continue;
    keys.add(key);
    anchors.add(appointment.id);
  }
  return anchors;
}

export function calculateAppointmentFinancials({
  appointment,
  appointmentExtras = [],
  servicePrices,
  compensationRules = [],
}: CalculateAppointmentFinancialsInput) {
  return calculateAppointmentsFinancials({
    appointments: [appointment],
    appointmentExtras,
    servicePrices,
    compensationRules,
  }).appointments[0];
}

export async function loadAppointmentsFinancials(
  source: AppointmentFinanceDataSource,
  appointments: readonly Appointment[],
  servicePrices: ReadonlyMap<number, number>,
) {
  if (appointments.length === 0) {
    return calculateAppointmentsFinancials({
      appointments,
      appointmentExtras: [],
      servicePrices,
      compensationRules: [],
    });
  }
  const appointmentIds = appointments.map((appointment) => appointment.id);
  const [appointmentExtras, compensationRules] = await Promise.all([
    source.getAppointmentExtras(appointmentIds),
    source.getBarberCompensationRules(),
  ]);
  let chairRentAnchorAppointmentIds: ReadonlySet<number> | undefined;
  if (source.getAppointments) {
    const locationIds = Array.from(new Set(appointments.map((appointment) => appointment.locationId)));
    const relevantBarberIds = new Set(appointments.map((appointment) => appointment.barberId));
    const locationAppointments = (await Promise.all(
      locationIds.map((locationId) => source.getAppointments!(undefined, undefined, locationId)),
    )).flat().filter((appointment) => relevantBarberIds.has(appointment.barberId));
    chairRentAnchorAppointmentIds = getChairRentAnchorAppointmentIds(locationAppointments, compensationRules);
  }
  return calculateAppointmentsFinancials({
    appointments,
    appointmentExtras,
    servicePrices,
    compensationRules,
    chairRentAnchorAppointmentIds,
  });
}
