import { useMemo, useState, type DragEvent } from "react";
import { addDays, format, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Plus, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { AppointmentStatus } from "@/hooks/use-appointments";

export type WeeklyAgendaAppointment = {
  id: number;
  barberId: number;
  serviceId: number | null;
  startTime: string;
  durationMinutes: number;
  status: AppointmentStatus;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  depositRequired?: boolean;
  depositReason?: string | null;
};

type AppointmentStatusFilter = AppointmentStatus | "all";

type WeeklyAgendaService = {
  id: number;
  name: string;
  agendaLabel?: string | null;
  duration?: number;
  isVisible?: boolean | null;
};

const appointmentStatusFilterOptions: Array<{ value: AppointmentStatusFilter; label: string }> = [
  { value: "all", label: "Marcadas" },
  { value: "completed", label: "Concluídas" },
  { value: "cancelled", label: "Canceladas" },
  { value: "late_cancelled", label: "Cancelamentos tardios" },
  { value: "no_show", label: "Faltas" },
];

const defaultBarberColor = "#D4AF37";

function normalizeBarberColor(color?: string | null) {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : defaultBarberColor;
}

function colorWithAlpha(color: string | undefined | null, alpha: number) {
  const normalized = normalizeBarberColor(color).replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const weeklyAgendaStartHour = 9;
const weeklyAgendaEndHour = 20;
const weeklyAgendaStartMinutes = weeklyAgendaStartHour * 60;
const weeklyAgendaEndMinutes = weeklyAgendaEndHour * 60;
const weeklyAgendaPixelsPerMinute = 1.12;
const weeklyAgendaBottomPadding = 24;
const weeklyAgendaSlotMinutes = 30;

export type WeeklyAgendaBarber = {
  id: number;
  name: string;
  color?: string | null;
};

function getDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function formatAgendaMinutes(minutesFromDayStart: number) {
  const hours = Math.floor(minutesFromDayStart / 60);
  const minutes = minutesFromDayStart % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function getWeeklyAppointmentDuration(appointment: WeeklyAgendaAppointment) {
  return Math.max(15, appointment.durationMinutes || 30);
}

export function getWeeklyAppointmentEnd(appointment: WeeklyAgendaAppointment) {
  const start = parseISO(appointment.startTime);
  return new Date(start.getTime() + getWeeklyAppointmentDuration(appointment) * 60000);
}

function getAgendaMinutes(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function getAgendaWindowHeight(startMinutes: number, endMinutes: number) {
  return (endMinutes - startMinutes) * weeklyAgendaPixelsPerMinute + weeklyAgendaBottomPadding;
}

function createAgendaHours(startMinutes: number, endMinutes: number) {
  const startHour = Math.floor(startMinutes / 60);
  const endHour = Math.ceil(endMinutes / 60);
  return Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
}

function createAgendaSlots(startMinutes: number, endMinutes: number) {
  const firstSlot = Math.ceil(startMinutes / weeklyAgendaSlotMinutes) * weeklyAgendaSlotMinutes;
  const slotCount = Math.max(0, Math.floor((endMinutes - firstSlot) / weeklyAgendaSlotMinutes));
  return Array.from({ length: slotCount }, (_, index) => firstSlot + index * weeklyAgendaSlotMinutes);
}

function getDayAgendaWindow(appointments: WeeklyAgendaAppointment[]) {
  const activeAppointments = appointments.filter((appointment) => appointment.status === "booked");

  if (activeAppointments.length === 0) {
    return {
      startMinutes: weeklyAgendaStartMinutes,
      endMinutes: weeklyAgendaEndMinutes,
      hasExtraHours: false,
    };
  }

  const appointmentStartMinutes = activeAppointments.map((appointment) => getAgendaMinutes(parseISO(appointment.startTime)));
  const appointmentEndMinutes = activeAppointments.map((appointment) => {
    const start = parseISO(appointment.startTime);
    const end = getWeeklyAppointmentEnd(appointment);
    const endMinutes = getAgendaMinutes(end);
    return format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd") ? endMinutes : 24 * 60;
  });
  const earliestAppointment = Math.min(...appointmentStartMinutes);
  const latestAppointmentEnd = Math.max(...appointmentEndMinutes);
  const startMinutes = Math.max(0, Math.min(weeklyAgendaStartMinutes, Math.floor(earliestAppointment / 60) * 60));
  const endMinutes = Math.min(24 * 60, Math.max(weeklyAgendaEndMinutes, Math.ceil(latestAppointmentEnd / 60) * 60));

  return {
    startMinutes,
    endMinutes,
    hasExtraHours: startMinutes < weeklyAgendaStartMinutes || endMinutes > weeklyAgendaEndMinutes,
  };
}

function isAppointmentVisibleOnGrid(appointment: WeeklyAgendaAppointment, startMinutes: number, endMinutes: number) {
  const start = parseISO(appointment.startTime);
  const end = getWeeklyAppointmentEnd(appointment);
  return getAgendaMinutes(end) > startMinutes && getAgendaMinutes(start) < endMinutes;
}

function getAppointmentStartSlotKey(appointment: WeeklyAgendaAppointment) {
  return format(parseISO(appointment.startTime), "HH:mm");
}

function groupAppointmentsByStart(appointments: WeeklyAgendaAppointment[]) {
  const grouped = new Map<string, WeeklyAgendaAppointment[]>();

  appointments.forEach((appointment) => {
    const key = getAppointmentStartSlotKey(appointment);
    const list = grouped.get(key) || [];
    list.push(appointment);
    grouped.set(key, list);
  });

  return Array.from(grouped.entries())
    .map(([slotKey, items]) => ({
      slotKey,
      appointments: items.sort((a, b) => a.barberId - b.barberId || a.customerName.localeCompare(b.customerName)),
    }))
    .sort((a, b) => a.slotKey.localeCompare(b.slotKey));
}

type WeeklyAgendaAppointmentLayout = {
  laneIndex: number;
  laneCount: number;
};

type WeeklyAgendaCrowdedGroup = {
  id: string;
  appointments: WeeklyAgendaAppointment[];
  startMinutes: number;
  endMinutes: number;
  topPx?: number;
  heightPx?: number;
};

const crowdedGroupThreshold = 4;
const startSummaryHeightPx = 46;
const doubleSummaryHeightPx = 58;
const startSummaryGapPx = 6;
const startSummaryGroupColor = "#94a3b8";

function getClippedAppointmentMinutes(
  appointment: WeeklyAgendaAppointment,
  startMinutes: number,
  endMinutes: number,
) {
  const start = parseISO(appointment.startTime);
  const end = getWeeklyAppointmentEnd(appointment);

  return {
    startMinutes: Math.max(startMinutes, getAgendaMinutes(start)),
    endMinutes: Math.min(endMinutes, getAgendaMinutes(end)),
  };
}

function createAppointmentLayouts(
  appointments: WeeklyAgendaAppointment[],
  startMinutes: number,
  endMinutes: number,
) {
  const layouts = new Map<number, WeeklyAgendaAppointmentLayout>();
  const sortedAppointments = appointments
    .map((appointment) => ({
      appointment,
      ...getClippedAppointmentMinutes(appointment, startMinutes, endMinutes),
    }))
    .filter((item) => item.endMinutes > item.startMinutes)
    .sort((a, b) =>
      a.startMinutes - b.startMinutes ||
      a.endMinutes - b.endMinutes ||
      a.appointment.barberId - b.appointment.barberId ||
      a.appointment.customerName.localeCompare(b.appointment.customerName),
    );

  const commitCluster = (cluster: typeof sortedAppointments) => {
    const laneEndMinutes: number[] = [];
    const clusterLayouts = new Map<number, WeeklyAgendaAppointmentLayout>();

    cluster.forEach((item) => {
      const laneIndex = laneEndMinutes.findIndex((laneEnd) => laneEnd <= item.startMinutes);
      const resolvedLaneIndex = laneIndex === -1 ? laneEndMinutes.length : laneIndex;
      laneEndMinutes[resolvedLaneIndex] = item.endMinutes;
      clusterLayouts.set(item.appointment.id, { laneIndex: resolvedLaneIndex, laneCount: 1 });
    });

    const laneCount = Math.max(1, laneEndMinutes.length);
    clusterLayouts.forEach((layout, appointmentId) => {
      layouts.set(appointmentId, { ...layout, laneCount });
    });
  };

  let currentCluster: typeof sortedAppointments = [];
  let currentClusterEndMinutes = 0;

  sortedAppointments.forEach((item) => {
    if (currentCluster.length === 0) {
      currentCluster = [item];
      currentClusterEndMinutes = item.endMinutes;
      return;
    }

    if (item.startMinutes < currentClusterEndMinutes) {
      currentCluster.push(item);
      currentClusterEndMinutes = Math.max(currentClusterEndMinutes, item.endMinutes);
      return;
    }

    commitCluster(currentCluster);
    currentCluster = [item];
    currentClusterEndMinutes = item.endMinutes;
  });

  if (currentCluster.length > 0) {
    commitCluster(currentCluster);
  }

  return layouts;
}

function createCrowdedAppointmentGroups(
  appointments: WeeklyAgendaAppointment[],
  startMinutes: number,
  endMinutes: number,
) {
  const groups: WeeklyAgendaCrowdedGroup[] = [];
  const sortedAppointments = appointments
    .map((appointment) => ({
      appointment,
      ...getClippedAppointmentMinutes(appointment, startMinutes, endMinutes),
    }))
    .filter((item) => item.endMinutes > item.startMinutes)
    .sort((a, b) =>
      a.startMinutes - b.startMinutes ||
      a.endMinutes - b.endMinutes ||
      a.appointment.barberId - b.appointment.barberId ||
      a.appointment.customerName.localeCompare(b.appointment.customerName),
    );

  const commitCluster = (cluster: typeof sortedAppointments) => {
    if (cluster.length < crowdedGroupThreshold) return;

    groups.push({
      id: cluster.map((item) => item.appointment.id).join("-"),
      appointments: cluster.map((item) => item.appointment),
      startMinutes: Math.min(...cluster.map((item) => item.startMinutes)),
      endMinutes: Math.max(...cluster.map((item) => item.endMinutes)),
    });
  };

  let currentCluster: typeof sortedAppointments = [];
  let currentClusterEndMinutes = 0;

  sortedAppointments.forEach((item) => {
    if (currentCluster.length === 0) {
      currentCluster = [item];
      currentClusterEndMinutes = item.endMinutes;
      return;
    }

    if (item.startMinutes < currentClusterEndMinutes) {
      currentCluster.push(item);
      currentClusterEndMinutes = Math.max(currentClusterEndMinutes, item.endMinutes);
      return;
    }

    commitCluster(currentCluster);
    currentCluster = [item];
    currentClusterEndMinutes = item.endMinutes;
  });

  if (currentCluster.length > 0) {
    commitCluster(currentCluster);
  }

  return groups;
}

function createStartSummaryAppointmentGroups(
  appointments: WeeklyAgendaAppointment[],
  startMinutes: number,
  endMinutes: number,
  globalStartMinutes: number,
) {
  const grouped = new Map<number, WeeklyAgendaAppointment[]>();

  appointments.forEach((appointment) => {
    const clipped = getClippedAppointmentMinutes(appointment, startMinutes, endMinutes);
    if (clipped.endMinutes <= clipped.startMinutes) return;

    const appointmentStartMinutes = getAgendaMinutes(parseISO(appointment.startTime));
    const list = grouped.get(appointmentStartMinutes) || [];
    list.push(appointment);
    grouped.set(appointmentStartMinutes, list);
  });

  let previousBottomPx = -Infinity;

  return Array.from(grouped.entries())
    .sort(([firstStart], [secondStart]) => firstStart - secondStart)
    .map(([groupStartMinutes, groupAppointments]) => {
      const sortedAppointments = groupAppointments.sort(
        (a, b) => a.barberId - b.barberId || a.customerName.localeCompare(b.customerName),
      );
      const clippedEndMinutes = Math.max(
        ...sortedAppointments.map((appointment) =>
          getClippedAppointmentMinutes(appointment, startMinutes, endMinutes).endMinutes,
        ),
      );
      const hasMultipleAppointments = sortedAppointments.length > 1;
      const heightPx =
        sortedAppointments.length === 2
          ? doubleSummaryHeightPx
          : hasMultipleAppointments
            ? startSummaryHeightPx
            : Math.max(34, (clippedEndMinutes - groupStartMinutes) * weeklyAgendaPixelsPerMinute - 6);
      const timeTopPx = (groupStartMinutes - globalStartMinutes) * weeklyAgendaPixelsPerMinute + 3;
      const topPx = Math.max(timeTopPx, previousBottomPx + startSummaryGapPx);
      previousBottomPx = topPx + heightPx;

      return {
        id: `start-${groupStartMinutes}-${sortedAppointments.map((appointment) => appointment.id).join("-")}`,
        appointments: sortedAppointments,
        startMinutes: groupStartMinutes,
        endMinutes: clippedEndMinutes,
        topPx,
        heightPx,
      };
    });
}

function formatAppointmentCount(count: number) {
  return `${count} ${count === 1 ? "marcação" : "marcações"}`;
}

function getDailyAppointmentLabel(count: number) {
  if (count === 0) return "Livre";
  return `${count} no dia`;
}

function normalizeServiceNameForBadge(serviceName?: string | null) {
  return (serviceName || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getServiceBadge(service?: WeeklyAgendaService) {
  const customAgendaLabel = service?.agendaLabel?.trim();
  if (customAgendaLabel) return customAgendaLabel;

  const serviceName = service?.name?.trim();
  const normalizedName = normalizeServiceNameForBadge(serviceName);
  const hasBarba = normalizedName.includes("barba");
  const hasDegrade = normalizedName.includes("degrade");
  const hasSimples = normalizedName.includes("simples");
  const hasHairService =
    normalizedName.includes("corte") || normalizedName.includes("cabelo") || hasDegrade || hasSimples;

  const haircutLabel = hasDegrade ? "Corte degradê" : hasSimples ? "Corte simples" : hasHairService ? "Corte" : "";

  if (haircutLabel && hasBarba) {
    return `${haircutLabel} + barba`;
  }

  if (haircutLabel) {
    return haircutLabel;
  }

  if (hasBarba) {
    return "Barba";
  }

  return serviceName || "Serviço";
}

export function getAppointmentContactLinks(phone: string) {
  const trimmedPhone = phone.trim();
  const digits = trimmedPhone.replace(/\D/g, "");
  const normalizedDigits = digits.length === 9 && digits.startsWith("9") ? `351${digits}` : digits;
  const displayPhone = normalizedDigits ? `+${normalizedDigits}` : trimmedPhone;

  return {
    displayPhone,
    tel: normalizedDigits ? `tel:+${normalizedDigits}` : "",
    whatsapp: normalizedDigits ? `https://wa.me/${normalizedDigits}` : "",
  };
}

export function WeeklyAgenda({
  weekStartDate,
  appointments,
  barbers,
  services,
  isLoading,
  selectedBarberFilter,
  selectedStatusFilter,
  canFilterBarbers,
  onBarberFilterChange,
  onStatusFilterChange,
  onPreviousWeek,
  onNextWeek,
  onToday,
  onException,
  onManualBooking,
  onCreateAtSlot,
  onMoveAppointment,
  onSelectAppointment,
  getStatusLabel,
}: {
  weekStartDate: Date;
  appointments: WeeklyAgendaAppointment[];
  barbers?: WeeklyAgendaBarber[];
  services?: WeeklyAgendaService[];
  isLoading: boolean;
  selectedBarberFilter: string;
  selectedStatusFilter: AppointmentStatusFilter;
  canFilterBarbers: boolean;
  onBarberFilterChange: (value: string) => void;
  onStatusFilterChange: (value: AppointmentStatusFilter) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onException: () => void;
  onManualBooking: () => void;
  onCreateAtSlot: (date: Date, time: string) => void;
  onMoveAppointment: (appointmentId: number, date: Date, time: string) => void;
  onSelectAppointment: (appointment: WeeklyAgendaAppointment) => void;
  getStatusLabel: (status: string) => string;
}) {
  const [selectedCrowdedGroup, setSelectedCrowdedGroup] = useState<WeeklyAgendaCrowdedGroup | null>(null);
  const calendarDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStartDate, index)),
    [weekStartDate],
  );
  const barbersById = useMemo(
    () => new Map((barbers || []).map((barber) => [barber.id, barber])),
    [barbers],
  );
  const servicesById = useMemo(
    () => new Map((services || []).map((service) => [service.id, service])),
    [services],
  );
  const appointmentsByDay = useMemo(() => {
    const grouped = new Map<string, WeeklyAgendaAppointment[]>();
    for (const day of calendarDays) grouped.set(getDateKey(day), []);

    appointments.forEach((appointment) => {
      const key = getDateKey(parseISO(appointment.startTime));
      const list = grouped.get(key);
      if (list) list.push(appointment);
    });

    grouped.forEach((items) => {
      items.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    });

    return grouped;
  }, [appointments, calendarDays]);

  const agendaWindowsByDay = useMemo(() => {
    const windows = new Map<string, ReturnType<typeof getDayAgendaWindow>>();
    calendarDays.forEach((day) => {
      const key = getDateKey(day);
      windows.set(key, getDayAgendaWindow(appointmentsByDay.get(key) || []));
    });
    return windows;
  }, [appointmentsByDay, calendarDays]);
  const globalAgendaStartMinutes = useMemo(
    () => Math.min(...Array.from(agendaWindowsByDay.values()).map((window) => window.startMinutes), weeklyAgendaStartMinutes),
    [agendaWindowsByDay],
  );
  const globalAgendaEndMinutes = useMemo(
    () => Math.max(...Array.from(agendaWindowsByDay.values()).map((window) => window.endMinutes), weeklyAgendaEndMinutes),
    [agendaWindowsByDay],
  );
  const weeklyAgendaHeight = getAgendaWindowHeight(globalAgendaStartMinutes, globalAgendaEndMinutes);
  const weeklyAgendaHours = useMemo(
    () => createAgendaHours(globalAgendaStartMinutes, globalAgendaEndMinutes),
    [globalAgendaStartMinutes, globalAgendaEndMinutes],
  );

  const handleDragStart = (event: DragEvent, appointment: WeeklyAgendaAppointment) => {
    if (appointment.status !== "booked") return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(appointment.id));
  };

  const handleSlotDrop = (event: DragEvent, day: Date, time: string) => {
    event.preventDefault();
    const appointmentId = Number(event.dataTransfer.getData("text/plain"));
    if (Number.isFinite(appointmentId) && appointmentId > 0) {
      onMoveAppointment(appointmentId, day, time);
    }
  };

  const weekLabel = `${format(weekStartDate, "dd MMM", { locale: pt })} - ${format(addDays(weekStartDate, 6), "dd MMM yyyy", { locale: pt })}`;
  const visibleBarbers = (barbers || []).filter((barber) =>
    appointments.some((appointment) => appointment.barberId === barber.id),
  );

  const renderMobileAppointmentRow = (appointment: WeeklyAgendaAppointment) => {
    const start = parseISO(appointment.startTime);
    const end = getWeeklyAppointmentEnd(appointment);
    const barber = barbersById.get(appointment.barberId);
    const service = appointment.serviceId ? servicesById.get(appointment.serviceId) : undefined;
    const color = normalizeBarberColor(barber?.color);
    const serviceBadge = getServiceBadge(service);
    const appointmentLabel = `Abrir detalhes da marcação de ${appointment.customerName}, ${format(start, "HH:mm")} a ${format(end, "HH:mm")}`;

    return (
      <button
        key={appointment.id}
        type="button"
        aria-label={appointmentLabel}
        title={appointmentLabel}
        onClick={() => onSelectAppointment(appointment)}
        className={cn(
          "grid w-full grid-cols-[64px_minmax(0,1fr)] gap-3 rounded-lg border border-white/10 bg-background/70 p-3 text-left transition hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
          appointment.status !== "booked" && "opacity-70",
        )}
      >
        <div>
          <p className="text-sm font-bold text-primary">{format(start, "HH:mm")}</p>
          <p className="text-[11px] text-gray-500">{format(end, "HH:mm")}</p>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <p className="truncate text-sm font-semibold text-white">{appointment.customerName}</p>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.06] px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
              <Scissors className="h-3 w-3 shrink-0" />
              {serviceBadge}
            </span>
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">{getStatusLabel(appointment.status)}</p>
        </div>
      </button>
    );
  };

  const renderCrowdedGroupRow = (appointment: WeeklyAgendaAppointment) => {
    const start = parseISO(appointment.startTime);
    const end = getWeeklyAppointmentEnd(appointment);
    const barber = barbersById.get(appointment.barberId);
    const service = appointment.serviceId ? servicesById.get(appointment.serviceId) : undefined;
    const color = normalizeBarberColor(barber?.color);

    return (
      <button
        key={appointment.id}
        type="button"
        className="grid w-full grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-lg border border-white/10 bg-background/70 p-3 text-left transition hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onClick={() => {
          setSelectedCrowdedGroup(null);
          onSelectAppointment(appointment);
        }}
      >
        <div>
          <p className="text-sm font-bold text-primary">{format(start, "HH:mm")}</p>
          <p className="text-[11px] text-gray-500">{format(end, "HH:mm")}</p>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <p className="truncate text-sm font-semibold text-white">{appointment.customerName}</p>
          </div>
          <p className="mt-1 truncate text-xs text-gray-400">{barber?.name || "Barbeiro"} · {getServiceBadge(service)}</p>
        </div>
      </button>
    );
  };

  return (
    <>
      <Card className="border-white/10 bg-card text-white">
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest text-primary">Agenda principal</p>
              <CardTitle className="mt-1 text-xl font-bold">Agenda semanal</CardTitle>
              <p className="mt-1 text-sm text-gray-400">{weekLabel}</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="grid grid-cols-[44px_1fr_44px] gap-2 sm:flex">
                <Button type="button" variant="outline" size="icon" className="h-10 border-white/10" onClick={onPreviousWeek} aria-label="Semana anterior">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" className="h-10 border-white/10" onClick={onToday}>
                  Hoje
                </Button>
                <Button type="button" variant="outline" size="icon" className="h-10 border-white/10" onClick={onNextWeek} aria-label="Semana seguinte">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button type="button" variant="outline" className="h-10 gap-2 border-white/10" onClick={onException}>
                  <AlertTriangle className="h-4 w-4" /> Ausência
                </Button>
                <Button type="button" variant="gold" className="h-10 gap-2" onClick={() => onManualBooking()}>
                  <Plus className="h-4 w-4" /> Marcação manual
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:max-w-xl">
            {canFilterBarbers ? (
              <Select value={selectedBarberFilter} onValueChange={onBarberFilterChange}>
                <SelectTrigger className="h-10 border-white/10 bg-background/60 text-white">
                  <SelectValue placeholder="Filtrar barbeiro" />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-card text-white">
                  <SelectItem value="all">Todos os barbeiros</SelectItem>
                  {barbers?.map((barber) => (
                    <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-10 items-center rounded-md border border-white/10 bg-background/60 px-3 text-sm font-semibold text-primary">
                {barbers?.[0]?.name || "Barbeiro"}
              </div>
            )}
            <Select value={selectedStatusFilter} onValueChange={(value) => onStatusFilterChange(value as AppointmentStatusFilter)}>
              <SelectTrigger className="h-10 border-white/10 bg-background/60 text-white">
                <SelectValue placeholder="Filtrar estado" />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-card text-white">
                {appointmentStatusFilterOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {visibleBarbers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {visibleBarbers.map((barber) => (
                <span key={barber.id} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: normalizeBarberColor(barber.color) }} />
                  {barber.name}
                </span>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex min-h-[360px] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="grid gap-3 lg:hidden">
                {calendarDays.map((day) => {
                  const key = getDateKey(day);
                  const dayAppointments = appointmentsByDay.get(key) || [];
                  const slotGroups = groupAppointmentsByStart(dayAppointments);

                  return (
                    <div key={key} className="rounded-xl border border-white/10 bg-background/60 p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-bold text-white">{format(day, "EEEE", { locale: pt })}</p>
                          <p className="text-xs text-gray-500">{format(day, "dd/MM/yyyy")}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 border-white/10 px-2 text-xs"
                            onClick={() => onCreateAtSlot(day, "09:00")}
                          >
                            <Plus className="h-3.5 w-3.5" /> Criar
                          </Button>
                          <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-200">
                            {getDailyAppointmentLabel(dayAppointments.length)}
                          </span>
                        </div>
                      </div>
                      {slotGroups.length > 0 ? (
                        <div className="space-y-2">
                          {slotGroups.map((group) => (
                            <div key={group.slotKey} className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                              {group.appointments.length > 1 && (
                                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                                  <p className="text-xs font-bold text-white">
                                    {group.slotKey} · {group.appointments.length} marcações
                                  </p>
                                  <div className="flex -space-x-1">
                                    {group.appointments.slice(0, 4).map((appointment) => {
                                      const barber = barbersById.get(appointment.barberId);
                                      return (
                                        <span
                                          key={appointment.id}
                                          className="h-3 w-3 rounded-full border border-background"
                                          style={{ backgroundColor: normalizeBarberColor(barber?.color) }}
                                        />
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              <div className="space-y-2">
                                {group.appointments.map((appointment) => renderMobileAppointmentRow(appointment))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-sm text-gray-500">
                          Sem marcações neste dia.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="weekly-agenda-horizontal-scroll hidden lg:block">
                <div className="min-w-[1420px]">
                  <div className="grid grid-cols-[64px_repeat(7,minmax(190px,1fr))]">
                    <div />
                    {calendarDays.map((day) => (
                      <div key={getDateKey(day)} className="border-b border-white/10 px-3 pb-3 text-center">
                        <p className="text-sm font-bold text-white">{format(day, "EEE", { locale: pt })}</p>
                        <p className="text-xs text-gray-500">{format(day, "dd/MM")}</p>
                        <span className="mt-2 inline-flex h-6 items-center whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
                          {getDailyAppointmentLabel((appointmentsByDay.get(getDateKey(day)) || []).length)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-[64px_repeat(7,minmax(190px,1fr))] overflow-hidden rounded-xl border border-white/10 bg-background/40">
                    <div className="relative border-r border-white/10 bg-background/80" style={{ height: weeklyAgendaHeight }}>
                      {weeklyAgendaHours.slice(0, -1).map((hour) => (
                        <span
                          key={hour}
                          className="absolute right-3 -translate-y-2 text-xs text-gray-500"
                          style={{ top: (hour * 60 - globalAgendaStartMinutes) * weeklyAgendaPixelsPerMinute }}
                        >
                          {String(hour).padStart(2, "0")}:00
                        </span>
                      ))}
                    </div>

                    {calendarDays.map((day) => {
                      const key = getDateKey(day);
                      const dayWindow = agendaWindowsByDay.get(key) || {
                        startMinutes: weeklyAgendaStartMinutes,
                        endMinutes: weeklyAgendaEndMinutes,
                        hasExtraHours: false,
                      };
                      const dayAppointments = (appointmentsByDay.get(key) || []).filter((appointment) =>
                        isAppointmentVisibleOnGrid(appointment, dayWindow.startMinutes, dayWindow.endMinutes),
                      );
                      const dayTop = (dayWindow.startMinutes - globalAgendaStartMinutes) * weeklyAgendaPixelsPerMinute;
                      const dayHeight = getAgendaWindowHeight(dayWindow.startMinutes, dayWindow.endMinutes);
                      const daySlots = createAgendaSlots(dayWindow.startMinutes, dayWindow.endMinutes);
                      const shouldUseStartSummaries = selectedBarberFilter === "all";
                      const crowdedGroups = shouldUseStartSummaries
                        ? createStartSummaryAppointmentGroups(
                            dayAppointments,
                            dayWindow.startMinutes,
                            dayWindow.endMinutes,
                            globalAgendaStartMinutes,
                          )
                        : createCrowdedAppointmentGroups(
                            dayAppointments,
                            dayWindow.startMinutes,
                            dayWindow.endMinutes,
                          );
                      const crowdedAppointmentIds = new Set(
                        crowdedGroups.flatMap((group) => group.appointments.map((appointment) => appointment.id)),
                      );
                      const standaloneAppointments = dayAppointments.filter((appointment) => !crowdedAppointmentIds.has(appointment.id));
                      const appointmentLayouts = createAppointmentLayouts(
                        standaloneAppointments,
                        dayWindow.startMinutes,
                        dayWindow.endMinutes,
                      );

                      return (
                        <div key={key} className="relative border-r border-white/10 last:border-r-0" style={{ height: weeklyAgendaHeight }}>
                          <div
                            className={cn(
                              "absolute left-0 right-0 rounded-lg",
                              dayWindow.hasExtraHours && "bg-primary/[0.03] ring-1 ring-primary/10",
                            )}
                            style={{ top: dayTop, height: dayHeight }}
                          />
                          {createAgendaHours(dayWindow.startMinutes, dayWindow.endMinutes).map((hour) => (
                            <div
                              key={hour}
                              className="absolute left-0 right-0 border-t border-white/5"
                              style={{ top: (hour * 60 - globalAgendaStartMinutes) * weeklyAgendaPixelsPerMinute }}
                            />
                          ))}
                          {daySlots.map((slotMinutes) => {
                            const time = formatAgendaMinutes(slotMinutes);
                            const top = (slotMinutes - globalAgendaStartMinutes) * weeklyAgendaPixelsPerMinute;
                            const height = weeklyAgendaSlotMinutes * weeklyAgendaPixelsPerMinute;
                            return (
                              <button
                                key={`slot-${key}-${time}`}
                                type="button"
                                aria-label={`Criar marcação em ${format(day, "dd/MM/yyyy")} às ${time}`}
                                className="absolute left-0 right-0 z-0 border-t border-transparent text-left transition hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                                style={{ top, height }}
                                onClick={() => onCreateAtSlot(day, time)}
                                onDragOver={(event) => {
                                  event.preventDefault();
                                  event.dataTransfer.dropEffect = "move";
                                }}
                                onDrop={(event) => handleSlotDrop(event, day, time)}
                              />
                            );
                          })}
                          {crowdedGroups.map((group) => {
                            const top = group.topPx ?? (group.startMinutes - globalAgendaStartMinutes) * weeklyAgendaPixelsPerMinute + 3;
                            const height =
                              group.heightPx ??
                              Math.max(34, (group.endMinutes - group.startMinutes) * weeklyAgendaPixelsPerMinute - 6);
                            const firstAppointment = group.appointments[0];
                            const start = parseISO(firstAppointment.startTime);
                            const hasMultipleAppointments = group.appointments.length > 1;
                            const representativeColor = hasMultipleAppointments
                              ? startSummaryGroupColor
                              : normalizeBarberColor(barbersById.get(firstAppointment.barberId)?.color);
                            const groupLabel = `Ver ${formatAppointmentCount(group.appointments.length)} às ${format(start, "HH:mm")}`;
                            const summaryText =
                              group.appointments.length === 1
                                ? `${format(start, "HH:mm")} · ${firstAppointment.customerName}`
                                : group.appointments.length === 2
                                  ? group.appointments.map((appointment) => appointment.customerName).join(" / ")
                                  : `${format(start, "HH:mm")} · ${formatAppointmentCount(group.appointments.length)}`;
                            const isDoubleSummary = group.appointments.length === 2;

                            return (
                              <button
                                key={group.id}
                                type="button"
                                aria-label={groupLabel}
                                title={groupLabel}
                                onClick={() => setSelectedCrowdedGroup(group)}
                                className={cn(
                                  "absolute left-1 right-1 z-10 overflow-hidden rounded-lg border px-2 text-left shadow-sm transition hover:z-20 hover:brightness-110 focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                                  isDoubleSummary
                                    ? "flex flex-col justify-center gap-0.5"
                                    : "flex items-center justify-between gap-2",
                                )}
                                style={{
                                  top,
                                  height,
                                  borderColor: colorWithAlpha(representativeColor, 0.65),
                                  backgroundColor: colorWithAlpha(representativeColor, 0.15),
                                  boxShadow: `0 12px 24px ${colorWithAlpha(representativeColor, 0.12)}`,
                                }}
                              >
                                {isDoubleSummary ? (
                                  <>
                                    <span className="text-xs font-bold text-white">{format(start, "HH:mm")}</span>
                                    <span className="min-w-0 truncate text-[11px] font-semibold text-gray-100">
                                      {summaryText}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="min-w-0 truncate text-xs font-bold text-white">
                                      {summaryText}
                                    </span>
                                    <span className="flex shrink-0 -space-x-1">
                                      {group.appointments.slice(0, 5).map((appointment) => {
                                        const barber = barbersById.get(appointment.barberId);
                                        return (
                                          <span
                                            key={appointment.id}
                                            className="h-3 w-3 rounded-full border border-background"
                                            style={{ backgroundColor: normalizeBarberColor(barber?.color) }}
                                          />
                                        );
                                      })}
                                    </span>
                                  </>
                                )}
                              </button>
                            );
                          })}
                          {standaloneAppointments.map((appointment) => {
                            const start = parseISO(appointment.startTime);
                            const end = getWeeklyAppointmentEnd(appointment);
                            const { startMinutes, endMinutes } = getClippedAppointmentMinutes(
                              appointment,
                              dayWindow.startMinutes,
                              dayWindow.endMinutes,
                            );
                            const top = (startMinutes - globalAgendaStartMinutes) * weeklyAgendaPixelsPerMinute + 3;
                            const height = Math.max(10, (endMinutes - startMinutes) * weeklyAgendaPixelsPerMinute - 6);
                            const layout = appointmentLayouts.get(appointment.id) || { laneIndex: 0, laneCount: 1 };
                            const laneIndex = layout.laneIndex;
                            const laneWidth = 100 / layout.laneCount;
                            const isCompact = height < 34 || laneWidth < 52;
                            const isTiny = height < 20 || laneWidth < 40;
                            const barber = barbersById.get(appointment.barberId);
                            const service = appointment.serviceId ? servicesById.get(appointment.serviceId) : undefined;
                            const color = normalizeBarberColor(barber?.color);
                            const serviceBadge = getServiceBadge(service);
                            const appointmentLabel = `Abrir detalhes da marcação de ${appointment.customerName}, ${format(start, "HH:mm")} a ${format(end, "HH:mm")}`;

                            return (
                              <button
                                key={appointment.id}
                                type="button"
                                draggable={appointment.status === "booked"}
                                aria-label={appointmentLabel}
                                title={appointmentLabel}
                                onDragStart={(event) => handleDragStart(event, appointment)}
                                onClick={() => onSelectAppointment(appointment)}
                                className={cn(
                                  "absolute z-10 overflow-hidden rounded-lg border text-left shadow-sm transition hover:z-20 hover:brightness-110 focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                                  isCompact
                                    ? "flex items-center gap-1 px-1.5 py-0.5"
                                    : "flex flex-col justify-center gap-0.5 px-1.5 py-1",
                                  appointment.status !== "booked" && "opacity-70",
                                )}
                                style={{
                                  top,
                                  height,
                                  left: `calc(${laneIndex * laneWidth}% + 4px)`,
                                  width: `calc(${laneWidth}% - 8px)`,
                                  borderColor: colorWithAlpha(color, 0.65),
                                  backgroundColor: colorWithAlpha(color, 0.16),
                                  boxShadow: `0 12px 24px ${colorWithAlpha(color, 0.12)}`,
                                }}
                              >
                                <span
                                  className={cn(
                                    "inline-flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-black/15 font-semibold uppercase text-gray-100",
                                    isCompact ? "h-4 shrink-0 px-1 text-[8px]" : "h-5 px-1.5 text-[9px]",
                                  )}
                                >
                                  <Scissors className="h-3 w-3 shrink-0" />
                                  {!isTiny && <span className="truncate">{serviceBadge}</span>}
                                </span>
                                <span
                                  className={cn(
                                    "block truncate font-semibold leading-tight text-white",
                                    isCompact ? "text-[10px]" : "text-[11px]",
                                  )}
                                >
                                  {appointment.customerName}
                                </span>
                              </button>
                            );
                          })}
                          {dayAppointments.length === 0 && (
                            <div className="absolute inset-x-3 top-4 rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-gray-600">
                              Sem marcações neste dia
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Dialog open={!!selectedCrowdedGroup} onOpenChange={(open) => !open && setSelectedCrowdedGroup(null)}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-1rem)] overflow-y-auto border-white/10 bg-card text-white sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {selectedCrowdedGroup
                ? `${format(parseISO(selectedCrowdedGroup.appointments[0].startTime), "HH:mm")} · ${formatAppointmentCount(selectedCrowdedGroup.appointments.length)}`
                : "Marcações"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            {selectedCrowdedGroup?.appointments.map((appointment) => renderCrowdedGroupRow(appointment))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
