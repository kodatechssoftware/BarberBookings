import { useMemo, useState, type DragEvent } from "react";
import {
  addDays,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfToday,
  startOfWeek,
} from "date-fns";
import { pt } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Loader2,
  Plus,
  Scissors,
} from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
type AgendaViewMode = "day" | "week" | "month";

type WeeklyAgendaService = {
  id: number;
  name: string;
  agendaLabel?: string | null;
  duration?: number;
  price?: number;
  isVisible?: boolean | null;
};

export type WeeklyAgendaBarber = {
  id: number;
  name: string;
  avatar?: string | null;
  color?: string | null;
};

type AppointmentLayout = {
  laneIndex: number;
  laneCount: number;
};

const appointmentStatusFilterOptions: Array<{ value: AppointmentStatusFilter; label: string }> = [
  { value: "all", label: "Marcadas" },
  { value: "completed", label: "Concluídas" },
  { value: "cancelled", label: "Canceladas" },
  { value: "late_cancelled", label: "Cancelamentos tardios" },
  { value: "no_show", label: "Faltas" },
];

const agendaStartMinutes = 9 * 60;
const agendaEndMinutes = 20 * 60;
const agendaSlotMinutes = 30;
const agendaPixelsPerMinute = 1.8;
const agendaBottomPadding = 18;
const defaultBarberColor = "#D4AF37";

function normalizeBarberColor(color?: string | null) {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : defaultBarberColor;
}

function colorWithAlpha(color: string | undefined | null, alpha: number) {
  const normalized = normalizeBarberColor(color).replace("#", "");
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function getAgendaMinutes(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatAgendaMinutes(minutesFromDayStart: number) {
  const hours = Math.floor(minutesFromDayStart / 60);
  const minutes = minutesFromDayStart % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getAgendaTopPx(minutesFromDayStart: number, gridStartMinutes: number) {
  return (minutesFromDayStart - gridStartMinutes) * agendaPixelsPerMinute;
}

function getAgendaHeightPx(startMinutes: number, endMinutes: number) {
  return Math.max(0, (endMinutes - startMinutes) * agendaPixelsPerMinute);
}

function createAgendaSlots(startMinutes: number, endMinutes: number) {
  const firstSlot = Math.ceil(startMinutes / agendaSlotMinutes) * agendaSlotMinutes;
  const slotCount = Math.max(0, Math.floor((endMinutes - firstSlot) / agendaSlotMinutes));
  return Array.from({ length: slotCount }, (_, index) => firstSlot + index * agendaSlotMinutes);
}

export function getWeeklyAppointmentDuration(appointment: WeeklyAgendaAppointment) {
  return Math.max(15, appointment.durationMinutes || 30);
}

export function getWeeklyAppointmentEnd(appointment: WeeklyAgendaAppointment) {
  const start = parseISO(appointment.startTime);
  return new Date(start.getTime() + getWeeklyAppointmentDuration(appointment) * 60000);
}

function getAgendaWindow(appointments: WeeklyAgendaAppointment[]) {
  if (appointments.length === 0) {
    return { startMinutes: agendaStartMinutes, endMinutes: agendaEndMinutes };
  }

  const earliestStart = Math.min(...appointments.map((appointment) => getAgendaMinutes(parseISO(appointment.startTime))));
  const latestEnd = Math.max(...appointments.map((appointment) => {
    const start = parseISO(appointment.startTime);
    const end = getWeeklyAppointmentEnd(appointment);
    return getDateKey(start) === getDateKey(end) ? getAgendaMinutes(end) : 24 * 60;
  }));

  return {
    startMinutes: Math.max(0, Math.min(agendaStartMinutes, Math.floor(earliestStart / 60) * 60)),
    endMinutes: Math.min(24 * 60, Math.max(agendaEndMinutes, Math.ceil(latestEnd / 60) * 60)),
  };
}

function createAppointmentLayouts(
  appointments: WeeklyAgendaAppointment[],
  startMinutes: number,
  endMinutes: number,
) {
  const layouts = new Map<number, AppointmentLayout>();
  const sorted = appointments
    .map((appointment) => ({
      appointment,
      startMinutes: Math.max(startMinutes, getAgendaMinutes(parseISO(appointment.startTime))),
      endMinutes: Math.min(endMinutes, getAgendaMinutes(getWeeklyAppointmentEnd(appointment))),
    }))
    .filter((item) => item.endMinutes > item.startMinutes)
    .sort((first, second) =>
      first.startMinutes - second.startMinutes ||
      first.endMinutes - second.endMinutes ||
      first.appointment.id - second.appointment.id,
    );

  const commitCluster = (cluster: typeof sorted) => {
    const laneEndMinutes: number[] = [];
    const clusterLayouts = new Map<number, AppointmentLayout>();

    cluster.forEach((item) => {
      const openLane = laneEndMinutes.findIndex((laneEnd) => laneEnd <= item.startMinutes);
      const laneIndex = openLane === -1 ? laneEndMinutes.length : openLane;
      laneEndMinutes[laneIndex] = item.endMinutes;
      clusterLayouts.set(item.appointment.id, { laneIndex, laneCount: 1 });
    });

    const laneCount = Math.max(1, laneEndMinutes.length);
    clusterLayouts.forEach((layout, appointmentId) => {
      layouts.set(appointmentId, { ...layout, laneCount });
    });
  };

  let cluster: typeof sorted = [];
  let clusterEnd = 0;

  sorted.forEach((item) => {
    if (cluster.length === 0 || item.startMinutes < clusterEnd) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMinutes);
      return;
    }

    commitCluster(cluster);
    cluster = [item];
    clusterEnd = item.endMinutes;
  });

  if (cluster.length > 0) commitCluster(cluster);
  return layouts;
}

function normalizeServiceNameForBadge(serviceName?: string | null) {
  return (serviceName || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getServiceBadge(service?: WeeklyAgendaService) {
  const customLabel = service?.agendaLabel?.trim();
  if (customLabel) return customLabel;

  const serviceName = service?.name?.trim();
  const normalizedName = normalizeServiceNameForBadge(serviceName);
  const hasBarba = normalizedName.includes("barba");
  const hasDegrade = normalizedName.includes("degrade");
  const hasSimples = normalizedName.includes("simples");
  const hasHairService = normalizedName.includes("corte") || normalizedName.includes("cabelo") || hasDegrade || hasSimples;
  const haircutLabel = hasDegrade ? "Corte degradê" : hasSimples ? "Corte simples" : hasHairService ? "Corte" : "";

  if (haircutLabel && hasBarba) return `${haircutLabel} + barba`;
  if (haircutLabel) return haircutLabel;
  if (hasBarba) return "Barba";
  return serviceName || "Serviço";
}

function formatServicePrice(price?: number) {
  if (!Number.isFinite(price)) return "";
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format((price || 0) / 100);
}

function getBarberInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "B";
}

function formatAppointmentCount(count: number) {
  return `${count} ${count === 1 ? "marcação" : "marcações"}`;
}

function getViewTitle(viewMode: AgendaViewMode) {
  if (viewMode === "day") return "Agenda diária";
  if (viewMode === "week") return "Resumo semanal";
  return "Agenda mensal";
}

function getNavigationLabel(viewMode: AgendaViewMode, direction: "previous" | "next") {
  const period = viewMode === "day" ? "Dia" : viewMode === "week" ? "Semana" : "Mês";
  return `${period} ${direction === "previous" ? "anterior" : "seguinte"}`;
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
  appointments,
  barbers,
  services,
  isLoading,
  selectedBarberFilter,
  selectedStatusFilter,
  canFilterBarbers,
  onBarberFilterChange,
  onStatusFilterChange,
  onException,
  onManualBooking,
  onCreateAtSlot,
  onMoveAppointment,
  onSelectAppointment,
  getStatusLabel,
}: {
  appointments: WeeklyAgendaAppointment[];
  barbers?: WeeklyAgendaBarber[];
  services?: WeeklyAgendaService[];
  isLoading: boolean;
  selectedBarberFilter: string;
  selectedStatusFilter: AppointmentStatusFilter;
  canFilterBarbers: boolean;
  onBarberFilterChange: (value: string) => void;
  onStatusFilterChange: (value: AppointmentStatusFilter) => void;
  onException: (date?: Date) => void;
  onManualBooking: (date?: Date) => void;
  onCreateAtSlot: (date: Date, time: string, barberId?: number) => void;
  onMoveAppointment: (appointmentId: number, date: Date, time: string, barberId?: number) => void;
  onSelectAppointment: (appointment: WeeklyAgendaAppointment) => void;
  getStatusLabel: (status: string) => string;
}) {
  const [viewMode, setViewMode] = useState<AgendaViewMode>("day");
  const [agendaDate, setAgendaDate] = useState<Date>(() => startOfToday());

  const barbersById = useMemo(
    () => new Map((barbers || []).map((barber) => [barber.id, barber])),
    [barbers],
  );
  const servicesById = useMemo(
    () => new Map((services || []).map((service) => [service.id, service])),
    [services],
  );
  const displayedBarbers = useMemo(() => {
    const barberList = barbers || [];
    if (selectedBarberFilter === "all") return barberList;
    return barberList.filter((barber) => String(barber.id) === selectedBarberFilter);
  }, [barbers, selectedBarberFilter]);
  const currentWeekStart = useMemo(
    () => startOfWeek(agendaDate, { weekStartsOn: 1 }),
    [agendaDate],
  );
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(currentWeekStart, index)),
    [currentWeekStart],
  );
  const monthGridDays = useMemo(() => {
    const firstGridDay = startOfWeek(startOfMonth(agendaDate), { weekStartsOn: 1 });
    return Array.from({ length: 42 }, (_, index) => addDays(firstGridDay, index));
  }, [agendaDate]);
  const appointmentsByDate = useMemo(() => {
    const grouped = new Map<string, WeeklyAgendaAppointment[]>();
    appointments.forEach((appointment) => {
      const key = getDateKey(parseISO(appointment.startTime));
      const existing = grouped.get(key) || [];
      existing.push(appointment);
      grouped.set(key, existing);
    });
    grouped.forEach((items) => items.sort((first, second) =>
      parseISO(first.startTime).getTime() - parseISO(second.startTime).getTime(),
    ));
    return grouped;
  }, [appointments]);
  const selectedDayAppointments = appointmentsByDate.get(getDateKey(agendaDate)) || [];
  const dayWindow = useMemo(() => getAgendaWindow(selectedDayAppointments), [selectedDayAppointments]);
  const daySlots = useMemo(
    () => createAgendaSlots(dayWindow.startMinutes, dayWindow.endMinutes),
    [dayWindow],
  );
  const dayAgendaHeight = getAgendaHeightPx(dayWindow.startMinutes, dayWindow.endMinutes) + agendaBottomPadding;

  const navigate = (direction: -1 | 1) => {
    setAgendaDate((current) => {
      if (viewMode === "day") return addDays(current, direction);
      if (viewMode === "week") return addDays(current, direction * 7);
      return addMonths(current, direction);
    });
  };

  const selectDay = (day: Date) => {
    setAgendaDate(day);
    setViewMode("day");
  };

  const handleDragStart = (event: DragEvent, appointment: WeeklyAgendaAppointment) => {
    if (appointment.status !== "booked") return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(appointment.id));
  };

  const handleSlotDrop = (event: DragEvent, day: Date, time: string, barberId?: number) => {
    event.preventDefault();
    const appointmentId = Number(event.dataTransfer.getData("text/plain"));
    if (Number.isFinite(appointmentId) && appointmentId > 0) {
      onMoveAppointment(appointmentId, day, time, barberId);
    }
  };

  const renderAppointmentCard = (
    appointment: WeeklyAgendaAppointment,
    layout: AppointmentLayout,
    gridStartMinutes: number,
    gridEndMinutes: number,
  ) => {
    const start = parseISO(appointment.startTime);
    const end = getWeeklyAppointmentEnd(appointment);
    const clippedStart = Math.max(gridStartMinutes, getAgendaMinutes(start));
    const clippedEnd = Math.min(gridEndMinutes, getAgendaMinutes(end));
    const top = getAgendaTopPx(clippedStart, gridStartMinutes);
    const height = getAgendaHeightPx(clippedStart, clippedEnd);
    const laneWidth = 100 / layout.laneCount;
    const barber = barbersById.get(appointment.barberId);
    const service = appointment.serviceId ? servicesById.get(appointment.serviceId) : undefined;
    const color = normalizeBarberColor(barber?.color);
    const serviceLabel = getServiceBadge(service);
    const isSingleLine = height < 40;
    const isCompact = height < 84 || laneWidth < 55;
    const timeRangeLabel = `${format(start, "HH:mm")}–${format(end, "HH:mm")}`;
    const appointmentLabel = `Abrir detalhes da marcação de ${appointment.customerName}, ${serviceLabel}, ${format(start, "HH:mm")} a ${format(end, "HH:mm")}`;

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
          "absolute z-10 flex min-h-0 overflow-hidden rounded-lg border text-left leading-tight shadow-lg transition hover:z-20 hover:brightness-110 focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
          isSingleLine ? "items-center px-2 py-0.5" : isCompact ? "flex-col px-2 py-1" : "flex-col px-3 py-2",
          appointment.status !== "booked" && "opacity-65",
        )}
        style={{
          top,
          height,
          left: `calc(${layout.laneIndex * laneWidth}% + 5px)`,
          width: `calc(${laneWidth}% - 10px)`,
          borderColor: colorWithAlpha(color, 0.72),
          background: `linear-gradient(145deg, ${colorWithAlpha(color, 0.3)}, ${colorWithAlpha(color, 0.13)})`,
          boxShadow: `0 12px 26px ${colorWithAlpha(color, 0.12)}`,
        }}
      >
        {isSingleLine ? (
          <span className="flex w-full min-w-0 items-center gap-1.5 text-[10px]">
            <span className="max-w-[46%] truncate font-bold text-white">{appointment.customerName}</span>
            <span className="shrink-0 text-white/35" aria-hidden="true">·</span>
            <span className="min-w-0 flex-1 truncate font-medium text-white/80">{serviceLabel}</span>
            <span className="shrink-0 font-semibold text-white/60">{timeRangeLabel}</span>
          </span>
        ) : (
          <>
            <span className={cn("w-full truncate font-bold text-white", isCompact ? "text-[11px]" : "text-sm")}>{appointment.customerName}</span>
            <span className={cn("mt-0.5 flex w-full min-w-0 items-center gap-1.5 text-white/80", isCompact ? "text-[9px]" : "text-xs")}>
              <Scissors className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{serviceLabel}</span>
            </span>
            <span className="mt-auto flex w-full items-center justify-between gap-2 pt-1 text-[10px] text-white/60">
              <span>{timeRangeLabel}</span>
              {!isCompact && <span>{formatServicePrice(service?.price)}</span>}
            </span>
          </>
        )}
      </button>
    );
  };

  const renderDayView = () => {
    if (displayedBarbers.length === 0) {
      return <div className="rounded-xl border border-dashed border-white/10 py-16 text-center text-sm text-gray-500">Sem barbeiros ativos para mostrar.</div>;
    }

    const isSingleBarberView = displayedBarbers.length === 1;
    const singleBarberColumnWidth = 520;
    const gridTemplateColumns = isSingleBarberView
      ? `72px ${singleBarberColumnWidth}px`
      : `72px repeat(${displayedBarbers.length}, minmax(230px, 1fr))`;
    const minWidth = 72 + displayedBarbers.length * (isSingleBarberView ? singleBarberColumnWidth : 230);

    return (
      <>
        <div className="grid gap-3 md:hidden" data-testid="day-agenda-mobile">
          {displayedBarbers.map((barber) => {
            const barberAppointments = selectedDayAppointments.filter((appointment) => appointment.barberId === barber.id);
            const color = normalizeBarberColor(barber.color);
            return (
              <section
                key={barber.id}
                data-testid="day-agenda-mobile-barber"
                data-barber-id={barber.id}
                className="overflow-hidden rounded-xl border border-white/10 bg-background/55"
              >
                <div className="flex items-center justify-between gap-3 border-b border-white/10 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <BarberAvatar barber={barber} />
                    <div className="min-w-0">
                      <p className="truncate font-bold text-white">{barber.name}</p>
                      <p className="text-xs text-gray-500">{formatAppointmentCount(barberAppointments.length)}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 border-white/10 px-2 text-xs"
                    onClick={() => onCreateAtSlot(agendaDate, "09:00", barber.id)}
                  >
                    <Plus className="h-3.5 w-3.5" /> Criar
                  </Button>
                </div>
                <div className="grid gap-2 p-3">
                  {barberAppointments.length > 0 ? barberAppointments.map((appointment) => {
                    const start = parseISO(appointment.startTime);
                    const end = getWeeklyAppointmentEnd(appointment);
                    const service = appointment.serviceId ? servicesById.get(appointment.serviceId) : undefined;
                    return (
                      <button
                        key={appointment.id}
                        type="button"
                        aria-label={`Abrir detalhes da marcação de ${appointment.customerName}, ${format(start, "HH:mm")} a ${format(end, "HH:mm")}`}
                        onClick={() => onSelectAppointment(appointment)}
                        className="grid grid-cols-[62px_minmax(0,1fr)] gap-3 rounded-lg border p-3 text-left"
                        style={{ borderColor: colorWithAlpha(color, 0.55), backgroundColor: colorWithAlpha(color, 0.12) }}
                      >
                        <span>
                          <span className="block text-sm font-bold text-primary">{format(start, "HH:mm")}</span>
                          <span className="block text-[11px] text-gray-500">{format(end, "HH:mm")}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white">{appointment.customerName}</span>
                          <span className="mt-1 flex items-center gap-1 truncate text-xs text-gray-400"><Scissors className="h-3 w-3" /> {getServiceBadge(service)}</span>
                          <span className="mt-1 block text-[10px] uppercase tracking-wide text-gray-500">{getStatusLabel(appointment.status)}</span>
                        </span>
                      </button>
                    );
                  }) : (
                    <p className="rounded-lg border border-dashed border-white/10 py-6 text-center text-sm text-gray-500">Sem marcações</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <div className="day-agenda-horizontal-scroll hidden md:block" data-testid="day-agenda-grid">
          <div style={{ minWidth, width: isSingleBarberView ? minWidth : undefined }}>
            <div className="grid" style={{ gridTemplateColumns }}>
              <div className="border-b border-r border-white/10 bg-background/75" />
              {displayedBarbers.map((barber) => {
                const barberAppointments = selectedDayAppointments.filter((appointment) => appointment.barberId === barber.id);
                const bookedMinutes = barberAppointments
                  .filter((appointment) => appointment.status === "booked")
                  .reduce((total, appointment) => total + getWeeklyAppointmentDuration(appointment), 0);
                return (
                  <div
                    key={barber.id}
                    data-testid="day-agenda-barber-header"
                    data-barber-id={barber.id}
                    className="flex min-w-0 items-center gap-3 border-b border-r border-white/10 bg-background/65 px-4 py-3 last:border-r-0"
                  >
                    <BarberAvatar barber={barber} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{barber.name}</p>
                      <p className="truncate text-[11px] text-gray-500">{formatAppointmentCount(barberAppointments.length)} · {Math.round(bookedMinutes / 60 * 10) / 10} h ocupadas</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="grid overflow-hidden rounded-b-xl border-x border-b border-white/10 bg-background/35" style={{ gridTemplateColumns }}>
              <div className="relative border-r border-white/10 bg-background/75" style={{ height: dayAgendaHeight }}>
                {daySlots.map((slotMinutes) => (
                  <span
                    key={slotMinutes}
                    className="absolute right-3 -translate-y-2 text-[11px] text-gray-500"
                    style={{ top: getAgendaTopPx(slotMinutes, dayWindow.startMinutes) }}
                  >
                    {formatAgendaMinutes(slotMinutes)}
                  </span>
                ))}
              </div>
              {displayedBarbers.map((barber) => {
                const barberAppointments = selectedDayAppointments.filter((appointment) => appointment.barberId === barber.id);
                const layouts = createAppointmentLayouts(barberAppointments, dayWindow.startMinutes, dayWindow.endMinutes);
                return (
                  <div
                    key={barber.id}
                    data-testid="day-agenda-barber-column"
                    data-barber-id={barber.id}
                    className="relative border-r border-white/10 last:border-r-0"
                    style={{ height: dayAgendaHeight }}
                  >
                    {daySlots.map((slotMinutes) => {
                      const time = formatAgendaMinutes(slotMinutes);
                      const top = getAgendaTopPx(slotMinutes, dayWindow.startMinutes);
                      const height = getAgendaHeightPx(slotMinutes, slotMinutes + agendaSlotMinutes);
                      return (
                        <button
                          key={`${barber.id}-${time}`}
                          type="button"
                          aria-label={`Criar marcação para ${barber.name} em ${format(agendaDate, "dd/MM/yyyy")} às ${time}`}
                          className="absolute inset-x-0 z-0 border-t border-white/[0.06] text-left transition hover:bg-primary/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                          style={{ top, height }}
                          onClick={() => onCreateAtSlot(agendaDate, time, barber.id)}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(event) => handleSlotDrop(event, agendaDate, time, barber.id)}
                        />
                      );
                    })}
                    {barberAppointments.map((appointment) => renderAppointmentCard(
                      appointment,
                      layouts.get(appointment.id) || { laneIndex: 0, laneCount: 1 },
                      dayWindow.startMinutes,
                      dayWindow.endMinutes,
                    ))}
                    {barberAppointments.length === 0 && (
                      <div className="pointer-events-none absolute inset-x-4 top-5 rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-gray-600">Livre</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderWeekView = () => (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7" data-testid="week-agenda-summary">
      {weekDays.map((day) => {
        const dayAppointments = appointmentsByDate.get(getDateKey(day)) || [];
        const countsByBarber = displayedBarbers
          .map((barber) => ({ barber, count: dayAppointments.filter((appointment) => appointment.barberId === barber.id).length }))
          .filter((item) => item.count > 0);
        return (
          <button
            key={getDateKey(day)}
            type="button"
            onClick={() => selectDay(day)}
            className={cn(
              "min-h-44 rounded-xl border border-white/10 bg-background/55 p-4 text-left transition hover:border-primary/40 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
              isSameDay(day, startOfToday()) && "border-primary/35 bg-primary/[0.05]",
            )}
          >
            <span className="flex items-start justify-between gap-2">
              <span>
                <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500">{format(day, "EEE", { locale: pt })}</span>
                <span className="mt-1 block text-2xl font-bold text-white">{format(day, "d")}</span>
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold text-gray-300">{dayAppointments.length}</span>
            </span>
            <span className="mt-4 grid gap-2">
              {countsByBarber.length > 0 ? countsByBarber.map(({ barber, count }) => (
                <span key={barber.id} className="flex min-w-0 items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2 text-gray-300">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: normalizeBarberColor(barber.color) }} />
                    <span className="truncate">{barber.name.split(" ")[0]}</span>
                  </span>
                  <span className="font-semibold text-white">{count}</span>
                </span>
              )) : <span className="text-xs text-gray-600">Sem marcações</span>}
            </span>
            <span className="mt-4 block text-xs font-semibold text-primary">Abrir dia →</span>
          </button>
        );
      })}
    </div>
  );

  const renderMonthView = () => (
    <div data-testid="month-agenda-calendar">
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-500 sm:gap-2 sm:text-xs">
        {Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(new Date(2026, 0, 5), { weekStartsOn: 1 }), index)).map((day) => (
          <span key={day.getDay()}>{format(day, "EEE", { locale: pt })}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {monthGridDays.map((day) => {
          const dayAppointments = appointmentsByDate.get(getDateKey(day)) || [];
          const barberColors = Array.from(new Set(dayAppointments.map((appointment) => normalizeBarberColor(barbersById.get(appointment.barberId)?.color))));
          return (
            <button
              key={getDateKey(day)}
              type="button"
              aria-label={`Abrir agenda de ${format(day, "d 'de' MMMM yyyy", { locale: pt })}`}
              onClick={() => selectDay(day)}
              className={cn(
                "min-h-20 rounded-lg border border-white/[0.07] bg-background/45 p-2 text-left transition hover:border-primary/40 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:min-h-28 sm:p-3",
                !isSameMonth(day, agendaDate) && "opacity-35",
                isSameDay(day, startOfToday()) && "border-primary/45 bg-primary/[0.06]",
              )}
            >
              <span className="flex items-start justify-between gap-1">
                <span className="text-xs font-bold text-white sm:text-sm">{format(day, "d")}</span>
                {dayAppointments.length > 0 && <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-gray-300 sm:text-[10px]">{dayAppointments.length}</span>}
              </span>
              <span className="mt-3 flex flex-wrap gap-1">
                {barberColors.slice(0, 6).map((color) => <span key={color} className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />)}
              </span>
              <span className="mt-2 hidden text-[10px] text-gray-500 sm:block">{dayAppointments.length > 0 ? formatAppointmentCount(dayAppointments.length) : "Livre"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const headerPeriodLabel = viewMode === "day"
    ? format(agendaDate, "EEEE, d 'de' MMMM yyyy", { locale: pt })
    : viewMode === "week"
      ? `${format(currentWeekStart, "d MMM", { locale: pt })} – ${format(addDays(currentWeekStart, 6), "d MMM yyyy", { locale: pt })}`
      : format(agendaDate, "MMMM yyyy", { locale: pt });

  return (
    <Card data-testid="agenda-calendar" className="overflow-hidden border-white/10 bg-card text-white">
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-primary">Agenda principal</p>
            <CardTitle className="mt-1 text-xl font-bold">{getViewTitle(viewMode)}</CardTitle>
            <p className="mt-1 capitalize text-sm text-gray-400">{headerPeriodLabel}</p>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="grid grid-cols-[44px_1fr_44px] gap-2 sm:flex">
              <Button type="button" variant="outline" size="icon" className="h-10 border-white/10" onClick={() => navigate(-1)} aria-label={getNavigationLabel(viewMode, "previous")}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" className="h-10 gap-2 border-white/10" onClick={() => setAgendaDate(startOfToday())}>
                <CalendarDays className="h-4 w-4" /> Hoje
              </Button>
              <Button type="button" variant="outline" size="icon" className="h-10 border-white/10" onClick={() => navigate(1)} aria-label={getNavigationLabel(viewMode, "next")}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button type="button" variant="outline" className="h-10 gap-2 border-white/10" onClick={() => onException(agendaDate)}>
                <AlertTriangle className="h-4 w-4" /> Ausência
              </Button>
              <Button type="button" variant="gold" className="h-10 gap-2" onClick={() => onManualBooking(agendaDate)}>
                <Plus className="h-4 w-4" /> Marcação manual
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-2 sm:grid-cols-2 lg:w-[580px]">
            {canFilterBarbers ? (
              <Select value={selectedBarberFilter} onValueChange={onBarberFilterChange}>
                <SelectTrigger className="h-10 border-white/10 bg-background/60 text-white"><SelectValue placeholder="Filtrar barbeiro" /></SelectTrigger>
                <SelectContent className="border-white/10 bg-card text-white">
                  <SelectItem value="all">Todos os barbeiros</SelectItem>
                  {barbers?.map((barber) => <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-10 items-center rounded-md border border-white/10 bg-background/60 px-3 text-sm font-semibold text-primary">{barbers?.[0]?.name || "Barbeiro"}</div>
            )}
            <Select value={selectedStatusFilter} onValueChange={(value) => onStatusFilterChange(value as AppointmentStatusFilter)}>
              <SelectTrigger className="h-10 border-white/10 bg-background/60 text-white"><SelectValue placeholder="Filtrar estado" /></SelectTrigger>
              <SelectContent className="border-white/10 bg-card text-white">
                {appointmentStatusFilterOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 rounded-lg border border-white/10 bg-background/65 p-1" role="group" aria-label="Vista da agenda">
            <AgendaViewButton active={viewMode === "day"} onClick={() => setViewMode("day")} icon={LayoutGrid}>Dia</AgendaViewButton>
            <AgendaViewButton active={viewMode === "week"} onClick={() => setViewMode("week")} icon={CalendarRange}>Semana</AgendaViewButton>
            <AgendaViewButton active={viewMode === "month"} onClick={() => setViewMode("month")} icon={CalendarDays}>Mês</AgendaViewButton>
          </div>
        </div>

        {(viewMode === "day" || viewMode === "week") && (
          <div className="agenda-date-strip scrollbar-none flex gap-2 overflow-x-auto pb-1" aria-label="Dias da semana">
            {weekDays.map((day) => {
              const count = (appointmentsByDate.get(getDateKey(day)) || []).length;
              const active = isSameDay(day, agendaDate);
              return (
                <button
                  key={getDateKey(day)}
                  type="button"
                  aria-label={`Escolher ${format(day, "EEEE, d 'de' MMMM yyyy", { locale: pt })}`}
                  aria-pressed={active}
                  onClick={() => setAgendaDate(day)}
                  className={cn(
                    "min-w-[74px] flex-1 rounded-xl border px-3 py-2 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                    active ? "border-primary bg-primary text-black shadow-lg shadow-primary/15" : "border-white/10 bg-background/50 hover:border-white/20 hover:bg-white/[0.04]",
                  )}
                >
                  <span className={cn("block text-[10px] font-bold uppercase tracking-wider", active ? "text-black/65" : "text-gray-500")}>{format(day, "EEE", { locale: pt })}</span>
                  <span className="mt-0.5 block text-lg font-bold">{format(day, "d")}</span>
                  <span className={cn("mt-0.5 block text-[9px] font-semibold", active ? "text-black/65" : "text-gray-600")}>{count || "livre"}</span>
                </button>
              );
            })}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex min-h-[360px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : viewMode === "day" ? renderDayView() : viewMode === "week" ? renderWeekView() : renderMonthView()}
      </CardContent>
    </Card>
  );
}

function BarberAvatar({ barber }: { barber: WeeklyAgendaBarber }) {
  const color = normalizeBarberColor(barber.color);
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border text-xs font-bold text-white"
      style={{ borderColor: colorWithAlpha(color, 0.7), backgroundColor: colorWithAlpha(color, 0.18) }}
    >
      {barber.avatar ? <img src={barber.avatar} alt="" className="h-full w-full object-cover" /> : getBarberInitials(barber.name)}
    </span>
  );
}

function AgendaViewButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof LayoutGrid;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
        active ? "bg-primary text-black shadow-sm shadow-primary/15" : "text-gray-500 hover:bg-white/[0.04] hover:text-gray-200",
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
  );
}
