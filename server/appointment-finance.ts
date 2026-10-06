import { format, startOfDay } from "date-fns";
import {
  getAppointmentPriceCents,
  type AppointmentServiceTermsLike,
} from "@shared/appointment-service-terms";
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
  compensationRuleId: number;
  compensationModel: BarberCompensationModel;
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
  getBarberCompensationRules(barberId?: number): Promise<BarberCompensationRule[]>;
};

type CalculateAppointmentsFinancialsInput = {
  appointments: readonly Appointment[];
  appointmentExtras: readonly AppointmentExtra[];
  servicePrices: ReadonlyMap<number, number>;
  compensationRules: readonly BarberCompensationRule[];
};

type CalculateAppointmentFinancialsInput = {
  appointment: Appointment;
  appointmentExtras?: readonly AppointmentExtra[];
  servicePrices: ReadonlyMap<number, number>;
  compensationRules?: readonly BarberCompensationRule[];
};

export function createDefaultCompensationRule(barberId: number): BarberCompensationRule {
  return {
    id: 0,
    barberId,
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
  date: Date,
) {
  const timestamp = date.getTime();
  const barberRules = rules
    .filter((candidate) => candidate.barberId === barberId)
    .sort((left, right) => new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime());
  const rule = barberRules.find((candidate) => new Date(candidate.effectiveFrom).getTime() <= timestamp);
  return rule || barberRules[barberRules.length - 1] || createDefaultCompensationRule(barberId);
}

export function getChairRentUnitKey(date: Date, period: ChairRentPeriod) {
  if (period === "day") return format(date, "yyyy-MM-dd");
  if (period === "week") {
    const weekStart = startOfDay(date);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    return format(weekStart, "yyyy-MM-dd");
  }
  return format(date, "yyyy-MM");
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
    compensationRuleId: compensationRule.id,
    compensationModel: compensationRule.model,
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
    const rule = getCompensationRuleForDate(
      compensationRules,
      appointment.barberId,
      new Date(appointment.startTime),
    );
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
    const rentKey = `${rule.id}:${rentPeriod}:${getChairRentUnitKey(new Date(appointment.startTime), rentPeriod)}`;
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
  return calculateAppointmentsFinancials({
    appointments,
    appointmentExtras,
    servicePrices,
    compensationRules,
  });
}
