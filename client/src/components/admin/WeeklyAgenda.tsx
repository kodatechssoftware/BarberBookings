import { useMemo, type DragEvent } from "react";
import { addDays, format, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Plus, Scissors } from "lucide-react";
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

type WeeklyAgendaService = {
  id: number;
  name: string;
  duration?: number;
  isVisible?: boolean | null;
};

const appointmentStatusFilterOptions: Array<{ value: AppointmentStatusFilter; label: string }> = [
  { value: "all", label: "Todos os estados" },
  { value: "booked", label: "Marcadas" },
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
const weeklyAgendaPixelsPerMinute = 1.12;
const weeklyAgendaHeight = (weeklyAgendaEndHour - weeklyAgendaStartHour) * 60 * weeklyAgendaPixelsPerMinute;
const weeklyAgendaHours = Array.from(
  { length: weeklyAgendaEndHour - weeklyAgendaStartHour + 1 },
  (_, index) => weeklyAgendaStartHour + index,
);
const weeklyAgendaSlotMinutes = 30;
const weeklyAgendaSlots = Array.from(
  { length: ((weeklyAgendaEndHour - weeklyAgendaStartHour) * 60) / weeklyAgendaSlotMinutes },
  (_, index) => weeklyAgendaStartHour * 60 + index * weeklyAgendaSlotMinutes,
);

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

function isAppointmentVisibleOnGrid(appointment: WeeklyAgendaAppointment) {
  const start = parseISO(appointment.startTime);
  const end = getWeeklyAppointmentEnd(appointment);
  return getAgendaMinutes(end) > weeklyAgendaStartHour * 60 && getAgendaMinutes(start) < weeklyAgendaEndHour * 60;
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

function getServiceBadge(serviceName?: string | null) {
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

  return "Serviço";
}

export function getAppointmentContactLinks(phone: string) {
  const trimmedPhone = phone.trim();
  const digits = trimmedPhone.replace(/\D/g, "");
  const whatsappDigits = digits.length === 9 && digits.startsWith("9") ? `351${digits}` : digits;

  return {
    tel: trimmedPhone ? `tel:${trimmedPhone}` : "",
    whatsapp: whatsappDigits ? `https://wa.me/${whatsappDigits}` : "",
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
    const serviceBadge = getServiceBadge(service?.name);
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

              <div className="hidden overflow-x-auto lg:block">
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
                          style={{ top: (hour - weeklyAgendaStartHour) * 60 * weeklyAgendaPixelsPerMinute }}
                        >
                          {String(hour).padStart(2, "0")}:00
                        </span>
                      ))}
                    </div>

                    {calendarDays.map((day) => {
                      const key = getDateKey(day);
                      const dayAppointments = (appointmentsByDay.get(key) || []).filter(isAppointmentVisibleOnGrid);

                      return (
                        <div key={key} className="relative border-r border-white/10 last:border-r-0" style={{ height: weeklyAgendaHeight }}>
                          {weeklyAgendaHours.map((hour) => (
                            <div
                              key={hour}
                              className="absolute left-0 right-0 border-t border-white/5"
                              style={{ top: (hour - weeklyAgendaStartHour) * 60 * weeklyAgendaPixelsPerMinute }}
                            />
                          ))}
                          {weeklyAgendaSlots.map((slotMinutes) => {
                            const time = formatAgendaMinutes(slotMinutes);
                            const top = (slotMinutes - weeklyAgendaStartHour * 60) * weeklyAgendaPixelsPerMinute;
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
                          {dayAppointments.map((appointment) => {
                            const start = parseISO(appointment.startTime);
                            const end = getWeeklyAppointmentEnd(appointment);
                            const startMinutes = Math.max(
                              weeklyAgendaStartHour * 60,
                              getAgendaMinutes(start),
                            );
                            const endMinutes = Math.min(
                              weeklyAgendaEndHour * 60,
                              getAgendaMinutes(end),
                            );
                            const top = (startMinutes - weeklyAgendaStartHour * 60) * weeklyAgendaPixelsPerMinute + 4;
                            const height = Math.max(44, (endMinutes - startMinutes) * weeklyAgendaPixelsPerMinute - 8);
                            const slotKey = getAppointmentStartSlotKey(appointment);
                            const sameSlot = dayAppointments.filter((item) => getAppointmentStartSlotKey(item) === slotKey);
                            const laneIndex = Math.max(0, sameSlot.findIndex((item) => item.id === appointment.id));
                            const laneWidth = 100 / Math.max(1, sameSlot.length);
                            const barber = barbersById.get(appointment.barberId);
                            const service = appointment.serviceId ? servicesById.get(appointment.serviceId) : undefined;
                            const color = normalizeBarberColor(barber?.color);
                            const serviceBadge = getServiceBadge(service?.name);
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
                                  "flex flex-col justify-center gap-0.5 px-1.5 py-1",
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
                                  className="inline-flex h-5 max-w-full items-center gap-1 rounded-full border border-white/10 bg-black/15 px-1.5 font-semibold uppercase text-[9px] text-gray-100"
                                >
                                  <Scissors className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{serviceBadge}</span>
                                </span>
                                <span
                                  className="block truncate text-[11px] font-semibold leading-tight text-white"
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
    </>
  );
}
