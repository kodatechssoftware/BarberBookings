export const MIN_MULTI_SERVICE_SEGMENTS = 2;
export const MAX_MULTI_SERVICE_SEGMENTS = 12;
export const MAX_MULTI_SERVICE_DURATION_MINUTES = 24 * 60;
export const MAX_MULTI_SERVICE_BUFFER_MINUTES = 12 * 60;
export const MAX_MULTI_SERVICE_PRICE_CENTS = 1_000_000;

export type MultiServiceSegmentTerms = {
  serviceId: number;
  barberId: number;
  serviceName: string;
  priceCents: number;
  durationMinutes: number;
  bufferBeforeMinutes?: number | null;
  bufferAfterMinutes?: number | null;
  executionStage?: number | null;
};

export type PlannedMultiServiceSegment = {
  position: number;
  executionStage: number;
  serviceId: number;
  barberId: number;
  serviceNameSnapshot: string;
  servicePriceCentsSnapshot: number;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  bufferBeforeMinutesSnapshot: number;
  bufferAfterMinutesSnapshot: number;
  operationalStart: Date;
  operationalEnd: Date;
};

export type MultiServiceOccupancyPeriod = {
  barberId: number;
  startTime: Date;
  endTime: Date;
};

export type MultiServiceAppointmentPlan = {
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  totalPriceCents: number;
  summaryServiceName: string;
  primaryServiceId: number;
  primaryBarberId: number;
  bufferBeforeMinutesSnapshot: number;
  bufferAfterMinutesSnapshot: number;
  segments: PlannedMultiServiceSegment[];
  occupancyPeriods: MultiServiceOccupancyPeriod[];
};

export type MultiServiceWorkingPeriod = {
  start: number;
  end: number;
};

export class MultiServiceAppointmentValidationError extends Error {
  status = 409;

  constructor(
    public code:
      | "MULTI_SERVICE_SEGMENTS_INVALID"
      | "MULTI_SERVICE_TERMS_INVALID"
      | "MULTI_SERVICE_OUTSIDE_AVAILABILITY"
      | "MULTI_SERVICE_PARALLEL_BARBER_CONFLICT"
      | "MULTI_SERVICE_PARALLEL_COMPATIBILITY_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "MultiServiceAppointmentValidationError";
  }
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function dateTimeParts(date: Date, timeZone: string) {
  let formatter = dateTimeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    dateTimeFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function integerInRange(value: unknown, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function summaryName(names: readonly string[]) {
  const joined = names.join(" + ");
  if (joined.length <= 100) return joined;
  return `${joined.slice(0, 97).trimEnd()}...`;
}

export function mergeMultiServiceOccupancyPeriods(
  segments: readonly Pick<PlannedMultiServiceSegment, "barberId" | "operationalStart" | "operationalEnd">[],
) {
  const byBarber = new Map<number, MultiServiceOccupancyPeriod[]>();
  for (const segment of segments) {
    const periods = byBarber.get(segment.barberId) ?? [];
    periods.push({
      barberId: segment.barberId,
      startTime: new Date(segment.operationalStart),
      endTime: new Date(segment.operationalEnd),
    });
    byBarber.set(segment.barberId, periods);
  }

  const merged: MultiServiceOccupancyPeriod[] = [];
  for (const [barberId, periods] of Array.from(byBarber.entries()).sort(([left], [right]) => left - right)) {
    periods.sort((left, right) => left.startTime.getTime() - right.startTime.getTime()
      || left.endTime.getTime() - right.endTime.getTime());
    for (const period of periods) {
      const previous = merged.at(-1);
      if (previous && previous.barberId === barberId && period.startTime <= previous.endTime) {
        if (period.endTime > previous.endTime) previous.endTime = new Date(period.endTime);
      } else {
        merged.push({ ...period });
      }
    }
  }
  return merged.sort((left, right) => left.startTime.getTime() - right.startTime.getTime()
    || left.endTime.getTime() - right.endTime.getTime()
    || left.barberId - right.barberId);
}

export function serviceCompatibilityKey(leftServiceId: number, rightServiceId: number) {
  return leftServiceId < rightServiceId
    ? `${leftServiceId}:${rightServiceId}`
    : `${rightServiceId}:${leftServiceId}`;
}

export function assignParallelExecutionStages(
  terms: readonly MultiServiceSegmentTerms[],
  compatibleServicePairs: ReadonlySet<string>,
) {
  const stages: MultiServiceSegmentTerms[][] = [];
  return terms.map((term) => {
    let executionStage = stages.findIndex((stage) => stage.every((candidate) =>
      candidate.barberId !== term.barberId
      && compatibleServicePairs.has(serviceCompatibilityKey(candidate.serviceId, term.serviceId))));
    if (executionStage < 0) {
      executionStage = stages.length;
      stages.push([]);
    }
    stages[executionStage].push(term);
    return { ...term, executionStage };
  });
}

export function assertParallelServiceCompatibility(
  terms: readonly MultiServiceSegmentTerms[],
  compatibleServicePairs: ReadonlySet<string>,
) {
  const byStage = new Map<number, MultiServiceSegmentTerms[]>();
  terms.forEach((term, position) => {
    const stage = term.executionStage ?? position;
    const entries = byStage.get(stage) ?? [];
    entries.push(term);
    byStage.set(stage, entries);
  });
  for (const entries of Array.from(byStage.values())) {
    for (let left = 0; left < entries.length; left += 1) {
      for (let right = left + 1; right < entries.length; right += 1) {
        if (entries[left].barberId === entries[right].barberId) {
          throw new MultiServiceAppointmentValidationError(
            "MULTI_SERVICE_PARALLEL_BARBER_CONFLICT",
            "O mesmo profissional não pode realizar dois serviços em simultâneo.",
          );
        }
        if (!compatibleServicePairs.has(serviceCompatibilityKey(entries[left].serviceId, entries[right].serviceId))) {
          throw new MultiServiceAppointmentValidationError(
            "MULTI_SERVICE_PARALLEL_COMPATIBILITY_INVALID",
            "Os serviços selecionados não estão configurados para decorrer em simultâneo.",
          );
        }
      }
    }
  }
}

export function planAppointmentServices(
  startTimeInput: Date | string,
  terms: readonly MultiServiceSegmentTerms[],
  minimumSegments = 1,
): MultiServiceAppointmentPlan {
  const startTime = startTimeInput instanceof Date ? new Date(startTimeInput) : new Date(startTimeInput);
  if (Number.isNaN(startTime.getTime())
    || !Number.isInteger(minimumSegments)
    || minimumSegments < 1
    || terms.length < minimumSegments
    || terms.length > MAX_MULTI_SERVICE_SEGMENTS) {
    throw new MultiServiceAppointmentValidationError(
      "MULTI_SERVICE_SEGMENTS_INVALID",
      `A marcação deve incluir entre ${minimumSegments} e ${MAX_MULTI_SERVICE_SEGMENTS} serviços.`,
    );
  }

  const stages = terms.map((segment, position) => segment.executionStage ?? position);
  const orderedStages = Array.from(new Set(stages)).sort((left, right) => left - right);
  if (orderedStages.some((stage, index) => stage !== index)
    || stages.some((stage) => !integerInRange(stage, 0, MAX_MULTI_SERVICE_SEGMENTS - 1))) {
    throw new MultiServiceAppointmentValidationError(
      "MULTI_SERVICE_TERMS_INVALID",
      "As etapas de execução dos serviços são inválidas.",
    );
  }
  for (const stage of orderedStages) {
    const professionals = terms
      .filter((_segment, position) => stages[position] === stage)
      .map((segment) => segment.barberId);
    if (new Set(professionals).size !== professionals.length) {
      throw new MultiServiceAppointmentValidationError(
        "MULTI_SERVICE_PARALLEL_BARBER_CONFLICT",
        "O mesmo profissional não pode realizar dois serviços em simultâneo.",
      );
    }
  }

  const stageStarts = new Map<number, number>();
  let cursor = startTime.getTime();
  for (const stage of orderedStages) {
    stageStarts.set(stage, cursor);
    const stageDuration = Math.max(...terms
      .filter((_segment, position) => stages[position] === stage)
      .map((segment) => segment.durationMinutes));
    cursor += stageDuration * 60_000;
  }
  let totalPriceCents = 0;
  const segments = terms.map((segment, position): PlannedMultiServiceSegment => {
    const name = segment.serviceName.trim();
    const before = segment.bufferBeforeMinutes ?? 0;
    const after = segment.bufferAfterMinutes ?? 0;
    if (!integerInRange(segment.serviceId, 1, Number.MAX_SAFE_INTEGER)
      || !integerInRange(segment.barberId, 1, Number.MAX_SAFE_INTEGER)
      || !name || name.length > 100
      || !integerInRange(segment.priceCents, 0, MAX_MULTI_SERVICE_PRICE_CENTS)
      || !integerInRange(segment.durationMinutes, 1, MAX_MULTI_SERVICE_DURATION_MINUTES)
      || !integerInRange(before, 0, MAX_MULTI_SERVICE_BUFFER_MINUTES)
      || !integerInRange(after, 0, MAX_MULTI_SERVICE_BUFFER_MINUTES)) {
      throw new MultiServiceAppointmentValidationError(
        "MULTI_SERVICE_TERMS_INVALID",
        `Os dados do serviço na posição ${position + 1} são inválidos.`,
      );
    }

    const executionStage = stages[position];
    const segmentStart = new Date(stageStarts.get(executionStage)!);
    const segmentEnd = new Date(segmentStart.getTime() + segment.durationMinutes * 60_000);
    totalPriceCents += segment.priceCents;
    if (totalPriceCents > MAX_MULTI_SERVICE_PRICE_CENTS) {
      throw new MultiServiceAppointmentValidationError(
        "MULTI_SERVICE_TERMS_INVALID",
        "O preço total dos serviços excede o limite permitido.",
      );
    }
    return {
      position,
      executionStage,
      serviceId: segment.serviceId,
      barberId: segment.barberId,
      serviceNameSnapshot: name,
      servicePriceCentsSnapshot: segment.priceCents,
      startTime: segmentStart,
      endTime: segmentEnd,
      durationMinutes: segment.durationMinutes,
      bufferBeforeMinutesSnapshot: before,
      bufferAfterMinutesSnapshot: after,
      operationalStart: new Date(segmentStart.getTime() - before * 60_000),
      operationalEnd: new Date(segmentEnd.getTime() + after * 60_000),
    };
  });

  const first = segments[0];
  const last = segments.reduce((latest, segment) => segment.endTime > latest.endTime ? segment : latest);
  const durationMinutes = Math.round((cursor - startTime.getTime()) / 60_000);
  if (durationMinutes > MAX_MULTI_SERVICE_DURATION_MINUTES) {
    throw new MultiServiceAppointmentValidationError(
      "MULTI_SERVICE_TERMS_INVALID",
      "A duração total dos serviços excede o limite permitido.",
    );
  }
  return {
    startTime,
    endTime: last.endTime,
    durationMinutes,
    totalPriceCents,
    summaryServiceName: summaryName(segments.map((segment) => segment.serviceNameSnapshot)),
    primaryServiceId: first.serviceId,
    primaryBarberId: first.barberId,
    bufferBeforeMinutesSnapshot: first.bufferBeforeMinutesSnapshot,
    bufferAfterMinutesSnapshot: last.bufferAfterMinutesSnapshot,
    segments,
    occupancyPeriods: mergeMultiServiceOccupancyPeriods(segments),
  };
}

export function planSequentialAppointmentServices(
  startTimeInput: Date | string,
  terms: readonly MultiServiceSegmentTerms[],
  minimumSegments = 1,
) {
  return planAppointmentServices(
    startTimeInput,
    terms.map((term, position) => ({ ...term, executionStage: position })),
    minimumSegments,
  );
}

export function planParallelAppointmentServices(
  startTimeInput: Date | string,
  terms: readonly MultiServiceSegmentTerms[],
  compatibleServicePairs: ReadonlySet<string>,
  minimumSegments = 1,
) {
  const staged = assignParallelExecutionStages(terms, compatibleServicePairs);
  assertParallelServiceCompatibility(staged, compatibleServicePairs);
  return planAppointmentServices(startTimeInput, staged, minimumSegments);
}

export function planMultiServiceAppointment(
  startTimeInput: Date | string,
  terms: readonly MultiServiceSegmentTerms[],
): MultiServiceAppointmentPlan {
  return planSequentialAppointmentServices(startTimeInput, terms, MIN_MULTI_SERVICE_SEGMENTS);
}

export function assertMultiServicePlanFitsWorkingPeriods(
  plan: MultiServiceAppointmentPlan,
  timeZone: string,
  periodsByBarberAndWeekday: ReadonlyMap<string, readonly MultiServiceWorkingPeriod[]>,
) {
  for (const segment of plan.segments) {
    const start = dateTimeParts(segment.operationalStart, timeZone);
    const end = dateTimeParts(segment.operationalEnd, timeZone);
    const startDate = `${start.year}-${start.month}-${start.day}`;
    const endDate = `${end.year}-${end.month}-${end.day}`;
    const weekday = new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay();
    const periods = periodsByBarberAndWeekday.get(`${segment.barberId}:${weekday}`) ?? [];
    const startMinutes = start.hour * 60 + start.minute;
    const endMinutes = end.hour * 60 + end.minute;
    const fits = startDate === endDate && periods.some((period) =>
      startMinutes >= period.start && endMinutes <= period.end);
    if (!fits) {
      throw new MultiServiceAppointmentValidationError(
        "MULTI_SERVICE_OUTSIDE_AVAILABILITY",
        `O serviço na posição ${segment.position + 1} não cabe integralmente na disponibilidade do profissional.`,
      );
    }
  }
}
