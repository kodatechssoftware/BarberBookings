import { lazy, Suspense, useState, useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import { type AppointmentStatus, useAppointments, useUpdateAppointmentStatus } from "@/hooks/use-appointments";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO, startOfToday, startOfWeek, subDays } from "date-fns";
import { pt } from "date-fns/locale";
import { Loader2, CheckCircle, XCircle, Plus, Calendar as CalendarIcon, Clock, User, LogOut, Scissors, Users, FileDown, Bell, Copy, TrendingUp, Euro, AlertTriangle, UserCheck, Upload, Trash2, Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { useBarbers, useShopAvailability } from "@/hooks/use-barbers";
import { useServices } from "@/hooks/use-services";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiFetch, buildApiUrl } from "@/lib/api";
import {
  canBarberPerformService,
  getEffectivePeriodsForBarber,
  periodsForShop,
  type AvailabilityRow,
  type ShopAvailabilityRow,
} from "@/lib/availability";
import {
  emailValidationMessage,
  isValidOptionalEmail,
  isValidPortugueseMobile,
  normalizeEmail,
  normalizePortuguesePhone,
  phoneValidationMessage,
} from "@shared/customer-validation";
import fabioAvatar from "@assets/fabio-baptista-avatar.jpg";
import brunoAvatar from "@assets/bruno-santos-avatar.jpg";

type AvailabilityPeriod = { startTime: string; endTime: string };
type AvailabilityForm = Record<number, { isWorking: boolean; periods: AvailabilityPeriod[] }>;
type AdminUser = {
  authorized: boolean;
  role: "" | "admin" | "barber";
  id?: number;
  name?: string;
  email?: string;
};
type AdminAppointment = {
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
type AppointmentViewMode = "day" | "upcoming";
type DashboardData = {
  range: {
    startDate: string;
    endDate: string;
    days: number;
    barberId: number | "all";
  };
  summary: {
    appointments: number;
    completed: number;
    booked: number;
    cancellations: number;
    noShows: number;
    revenueCents: number;
    projectedRevenueCents: number;
    averageTicketCents: number;
    completionRate: number;
    noShowRate: number;
    upcomingWeek: number;
    inactiveCustomers: number;
    busiestHour: string | null;
  };
  daily: Array<{
    date: string;
    label: string;
    appointments: number;
    completed: number;
    booked: number;
    cancelled: number;
    noShows: number;
    revenueCents: number;
  }>;
  barbers: Array<{
    id: number;
    name: string;
    appointments: number;
    completed: number;
    booked: number;
    noShows: number;
    revenueCents: number;
  }>;
  services: Array<{
    id: number;
    name: string;
    count: number;
    revenueCents: number;
  }>;
  inactiveCustomers: Array<{
    name: string;
    phone: string;
    email: string;
    lastVisit: string;
    totalVisits: number;
    daysSinceLastVisit: number;
  }>;
};

const currencyFormatter = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
});

function formatCents(value: number) {
  return currencyFormatter.format((value || 0) / 100);
}

const DashboardChartCard = lazy(() => import("@/components/admin/DashboardChartCard"));

const appointmentStatusFilterOptions: Array<{ value: AppointmentStatusFilter; label: string }> = [
  { value: "all", label: "Todos os estados" },
  { value: "booked", label: "Marcadas" },
  { value: "completed", label: "Concluídas" },
  { value: "cancelled", label: "Canceladas" },
  { value: "late_cancelled", label: "Cancelamentos tardios" },
  { value: "no_show", label: "Faltas" },
];

function DashboardChartFallback({
  title,
  heightClassName,
  description,
}: {
  title: string;
  heightClassName: string;
  description?: string;
}) {
  return (
    <Card className="border-white/10 bg-card text-white">
      <CardHeader>
        <CardTitle className="text-base font-bold">{title}</CardTitle>
        {description && <p className="text-sm text-gray-400">{description}</p>}
      </CardHeader>
      <CardContent>
        <div className={`${heightClassName} w-full animate-pulse rounded-lg bg-white/5`} />
      </CardContent>
    </Card>
  );
}

function getBarberAvatar(barber: { name: string; avatar?: string | null }) {
  if (barber.avatar) return barber.avatar;
  const name = barber.name.toLowerCase();
  if (name.includes("baptista")) return fabioAvatar;
  if (name.includes("bruno")) return brunoAvatar;
  return "/images/logo.jpg";
}

const MAX_BARBER_PHOTO_INPUT_BYTES = 10 * 1024 * 1024;
const BARBER_PHOTO_MAX_SIDE = 1200;
const BARBER_PHOTO_QUALITY = 0.82;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível preparar a imagem."));
    image.src = src;
  });
}

async function fileToBarberAvatar(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Escolha um ficheiro de imagem.");
  }

  if (file.size > MAX_BARBER_PHOTO_INPUT_BYTES) {
    throw new Error("A imagem deve ter no máximo 10 MB.");
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, BARBER_PHOTO_MAX_SIDE / image.width, BARBER_PHOTO_MAX_SIDE / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return dataUrl;

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", BARBER_PHOTO_QUALITY);
}

type ToastFn = ReturnType<typeof useToast>["toast"];

async function handleBarberPhotoFile(file: File | undefined, onChange: (avatar: string) => void, toast: ToastFn) {
  if (!file) return;

  try {
    onChange(await fileToBarberAvatar(file));
  } catch (err: any) {
    toast({
      title: "Erro",
      description: err.message || "Não foi possível carregar a foto.",
      variant: "destructive",
    });
  }
}

function BarberPhotoPicker({
  inputId,
  value,
  fallbackSrc,
  onChange,
  onRemove,
  toast,
}: {
  inputId: string;
  value: string;
  fallbackSrc: string;
  onChange: (avatar: string) => void;
  onRemove: () => void;
  toast: ToastFn;
}) {
  return (
    <div className="space-y-2">
      <Label>Foto</Label>
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-background/60 p-3">
        <img
          src={value || fallbackSrc}
          alt=""
          className="h-20 w-20 shrink-0 rounded-md object-cover"
        />
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          <Input
            id={inputId}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (event) => {
              await handleBarberPhotoFile(event.target.files?.[0], onChange, toast);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => document.getElementById(inputId)?.click()}
          >
            <Upload className="h-4 w-4" /> Carregar foto
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-2 text-red-400 hover:text-red-300"
              onClick={onRemove}
            >
              <Trash2 className="h-4 w-4" /> Remover foto
            </Button>
          )}
          <p className="w-full text-xs text-gray-400">JPG, PNG ou WebP. A imagem é otimizada automaticamente.</p>
        </div>
      </div>
    </div>
  );
}

function getEditedBarberAvatar(
  drafts: Record<number, string | null>,
  barber: { id: number; avatar?: string | null },
) {
  return Object.prototype.hasOwnProperty.call(drafts, barber.id)
    ? drafts[barber.id] || ""
    : barber.avatar || "";
}

type ServiceListItem = {
  id: number;
  name: string;
  duration?: number;
  isVisible?: boolean | null;
};

type BarberListCacheItem = {
  id: number;
  [key: string]: unknown;
};

const barberColorPalette = ["#38BDF8", "#22C55E", "#F97316", "#D4AF37", "#A78BFA", "#F43F5E", "#14B8A6", "#EAB308"];
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

function isBarbersQuery(queryKey: readonly unknown[]) {
  return queryKey[0] === "/api/barbers";
}

async function refreshBarbersCache(updatedBarber?: BarberListCacheItem) {
  if (updatedBarber) {
    queryClient.setQueriesData<BarberListCacheItem[]>(
      { predicate: (query) => isBarbersQuery(query.queryKey) },
      (current) => {
        if (!Array.isArray(current)) return current;
        return current.map((barber) =>
          barber.id === updatedBarber.id ? { ...barber, ...updatedBarber } : barber,
        );
      },
    );
  }

  await queryClient.invalidateQueries({
    predicate: (query) => isBarbersQuery(query.queryKey),
  });
}

function getAllServiceIds(services?: ServiceListItem[]) {
  return (services || []).map((service) => service.id);
}

function normalizeServiceSelection(selectedServiceIds: number[], allServiceIds: number[]) {
  const uniqueSelectedIds = Array.from(new Set(selectedServiceIds));
  return uniqueSelectedIds.length >= allServiceIds.length ? [] : uniqueSelectedIds;
}

function getEffectiveServiceSelection(
  explicitServiceIds: number[] | undefined,
  services?: ServiceListItem[],
) {
  const allServiceIds = getAllServiceIds(services);
  if (!explicitServiceIds || explicitServiceIds.length === 0) return allServiceIds;
  return explicitServiceIds.filter((serviceId) => allServiceIds.includes(serviceId));
}

function formatBarberServicesSummary(
  barber: { serviceIds?: number[] | null },
  services?: ServiceListItem[],
) {
  const allServices = services || [];
  const serviceIds = barber.serviceIds || [];
  if (allServices.length === 0 || serviceIds.length === 0 || serviceIds.length >= allServices.length) {
    return "Todos os serviços";
  }

  const names = allServices
    .filter((service) => serviceIds.includes(service.id))
    .map((service) => service.name);

  return names.length > 0 ? names.join(", ") : "Sem serviços ativos";
}

function BarberServicesPicker({
  services,
  selectedServiceIds,
  onChange,
}: {
  services?: ServiceListItem[];
  selectedServiceIds: number[];
  onChange: (serviceIds: number[]) => void;
}) {
  const allServices = services || [];

  if (allServices.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-sm text-gray-500">
        Crie serviços antes de limitar a equipa.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <Label>Serviços que executa</Label>
        <p className="text-xs text-gray-500">Deixe todos ativos quando não há restrição.</p>
      </div>
      <div className="grid gap-2 rounded-lg border border-white/10 bg-background/50 p-3 sm:grid-cols-2">
        {allServices.map((service) => {
          const checked = selectedServiceIds.includes(service.id);
          const isOnlySelected = checked && selectedServiceIds.length <= 1;

          return (
            <label
              key={service.id}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-md border border-white/10 bg-white/[0.03] p-2 text-sm text-white transition-colors hover:bg-white/[0.06]",
                checked && "border-primary/40 bg-primary/10",
                isOnlySelected && "cursor-not-allowed opacity-70",
              )}
            >
              <Checkbox
                checked={checked}
                disabled={isOnlySelected}
                onCheckedChange={(value) => {
                  const next = value
                    ? Array.from(new Set([...selectedServiceIds, service.id]))
                    : selectedServiceIds.filter((serviceId) => serviceId !== service.id);
                  onChange(next);
                }}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block truncate font-medium">{service.name}</span>
                {service.isVisible === false && <span className="block text-[11px] text-gray-500">Oculto no site</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function BarberColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const selectedColor = normalizeBarberColor(value);

  return (
    <div className="space-y-2">
      <Label>Cor na agenda</Label>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-background/50 p-3">
        {barberColorPalette.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Escolher ${color}`}
            className={cn(
              "h-8 w-8 rounded-full border-2 transition-transform hover:scale-105",
              selectedColor === color ? "border-white" : "border-white/15",
            )}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
          />
        ))}
        <Input
          type="color"
          value={selectedColor}
          onChange={(event) => onChange(normalizeBarberColor(event.target.value))}
          className="h-8 w-12 cursor-pointer border-white/10 bg-transparent p-1"
        />
        <span className="text-xs text-gray-400">{selectedColor}</span>
      </div>
    </div>
  );
}

const weeklyAgendaStartHour = 9;
const weeklyAgendaEndHour = 20;
const weeklyAgendaPixelsPerMinute = 1.12;
const weeklyAgendaHeight = (weeklyAgendaEndHour - weeklyAgendaStartHour) * 60 * weeklyAgendaPixelsPerMinute;
const weeklyAgendaHours = Array.from(
  { length: weeklyAgendaEndHour - weeklyAgendaStartHour + 1 },
  (_, index) => weeklyAgendaStartHour + index,
);

type WeeklyAgendaBarber = {
  id: number;
  name: string;
  color?: string | null;
};

function getDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function getWeeklyAppointmentDuration(appointment: AdminAppointment) {
  return Math.max(15, appointment.durationMinutes || 30);
}

function getWeeklyAppointmentEnd(appointment: AdminAppointment) {
  const start = parseISO(appointment.startTime);
  return new Date(start.getTime() + getWeeklyAppointmentDuration(appointment) * 60000);
}

function getAgendaMinutes(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function isAppointmentVisibleOnGrid(appointment: AdminAppointment) {
  const start = parseISO(appointment.startTime);
  const end = getWeeklyAppointmentEnd(appointment);
  return getAgendaMinutes(end) > weeklyAgendaStartHour * 60 && getAgendaMinutes(start) < weeklyAgendaEndHour * 60;
}

function WeeklyAgenda({
  weekStartDate,
  appointments,
  barbers,
  services,
  isLoading,
  onPreviousWeek,
  onNextWeek,
  onToday,
  onException,
  onManualBooking,
  onSelectAppointment,
  getStatusLabel,
}: {
  weekStartDate: Date;
  appointments: AdminAppointment[];
  barbers?: WeeklyAgendaBarber[];
  services?: ServiceListItem[];
  isLoading: boolean;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onException: () => void;
  onManualBooking: () => void;
  onSelectAppointment: (appointment: AdminAppointment) => void;
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
    const grouped = new Map<string, AdminAppointment[]>();
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

  const weekLabel = `${format(weekStartDate, "dd MMM", { locale: pt })} - ${format(addDays(weekStartDate, 6), "dd MMM yyyy", { locale: pt })}`;
  const visibleBarbers = (barbers || []).filter((barber) =>
    appointments.some((appointment) => appointment.barberId === barber.id),
  );

  const renderAppointmentSummary = (appointment: AdminAppointment, compact = false) => {
    const start = parseISO(appointment.startTime);
    const end = getWeeklyAppointmentEnd(appointment);
    const barber = barbersById.get(appointment.barberId);
    const service = appointment.serviceId ? servicesById.get(appointment.serviceId) : undefined;
    const color = normalizeBarberColor(barber?.color);

    return (
      <button
        key={appointment.id}
        type="button"
        onClick={() => onSelectAppointment(appointment)}
        className={cn(
          "w-full rounded-lg border px-3 py-2 text-left transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
          appointment.status !== "booked" && "opacity-70",
        )}
        style={{
          borderColor: colorWithAlpha(color, 0.55),
          backgroundColor: colorWithAlpha(color, 0.13),
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-white">
              {format(start, "HH:mm")} - {format(end, "HH:mm")}
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-white">{appointment.customerName}</p>
          </div>
          <span className="shrink-0 rounded-full bg-background/60 px-2 py-0.5 text-[10px] uppercase text-gray-300">
            {getStatusLabel(appointment.status)}
          </span>
        </div>
        {!compact && (
          <div className="mt-1 min-w-0 text-xs text-gray-300">
            <p className="truncate">{service?.name || "Sem serviço"}</p>
            <p className="truncate" style={{ color }}>{barber?.name || "Barbeiro"}</p>
          </div>
        )}
      </button>
    );
  };

  return (
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
              <Button type="button" variant="gold" className="h-10 gap-2" onClick={onManualBooking}>
                <Plus className="h-4 w-4" /> Marcação manual
              </Button>
            </div>
          </div>
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

                return (
                  <div key={key} className="rounded-xl border border-white/10 bg-background/60 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-bold text-white">{format(day, "EEEE", { locale: pt })}</p>
                        <p className="text-xs text-gray-500">{format(day, "dd/MM/yyyy")}</p>
                      </div>
                      <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-gray-300">
                        {dayAppointments.length}
                      </span>
                    </div>
                    {dayAppointments.length > 0 ? (
                      <div className="space-y-2">
                        {dayAppointments.map((appointment) => renderAppointmentSummary(appointment))}
                      </div>
                    ) : (
                      <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-sm text-gray-500">
                        Sem marcações.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <div className="min-w-[1040px]">
                <div className="grid grid-cols-[64px_repeat(7,minmax(130px,1fr))]">
                  <div />
                  {calendarDays.map((day) => (
                    <div key={getDateKey(day)} className="border-b border-white/10 px-3 pb-3 text-center">
                      <p className="text-sm font-bold text-white">{format(day, "EEE", { locale: pt })}</p>
                      <p className="text-xs text-gray-500">{format(day, "dd/MM")}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-[64px_repeat(7,minmax(130px,1fr))] overflow-hidden rounded-xl border border-white/10 bg-background/40">
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
                          const slotKey = format(start, "HH:mm");
                          const sameSlot = dayAppointments.filter((item) => format(parseISO(item.startTime), "HH:mm") === slotKey);
                          const laneIndex = Math.max(0, sameSlot.findIndex((item) => item.id === appointment.id));
                          const laneWidth = 100 / Math.max(1, sameSlot.length);
                          const barber = barbersById.get(appointment.barberId);
                          const service = appointment.serviceId ? servicesById.get(appointment.serviceId) : undefined;
                          const color = normalizeBarberColor(barber?.color);

                          return (
                            <button
                              key={appointment.id}
                              type="button"
                              onClick={() => onSelectAppointment(appointment)}
                              className={cn(
                                "absolute overflow-hidden rounded-lg border px-2 py-1.5 text-left shadow-sm transition hover:z-20 hover:brightness-110 focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
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
                              <span className="block text-[11px] font-bold text-white">
                                {format(start, "HH:mm")} - {format(end, "HH:mm")}
                              </span>
                              <span className="block truncate text-xs font-semibold text-white">{appointment.customerName}</span>
                              <span className="block truncate text-[11px] text-gray-300">{service?.name || "Sem serviço"}</span>
                              <span className="block truncate text-[11px]" style={{ color }}>{barber?.name || "Barbeiro"}</span>
                            </button>
                          );
                        })}
                        {dayAppointments.length === 0 && (
                          <div className="absolute inset-x-3 top-4 rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-gray-600">
                            Sem marcações
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
  );
}

function EditAppointmentDialog({
  appointment,
  barbers,
  services,
  toast,
}: {
  appointment: AdminAppointment;
  barbers?: Array<{ id: number; name: string; serviceIds?: number[] | null }>;
  services?: ServiceListItem[];
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [open, setOpen] = useState(false);
  const [dateValue, setDateValue] = useState(format(parseISO(appointment.startTime), "yyyy-MM-dd"));
  const [timeValue, setTimeValue] = useState(format(parseISO(appointment.startTime), "HH:mm"));
  const [barberId, setBarberId] = useState(String(appointment.barberId));
  const [serviceId, setServiceId] = useState(appointment.serviceId ? String(appointment.serviceId) : "none");
  const [isSaving, setIsSaving] = useState(false);
  const serviceList = services || [];
  const selectedBarber = barbers?.find((barber) => String(barber.id) === barberId);
  const compatibleServices = useMemo(
    () => serviceList.filter((service) => canBarberPerformService(selectedBarber, service.id)),
    [selectedBarber, serviceList],
  );
  const canUseNoService = appointment.serviceId === null;
  const hasCompatibleService = serviceId !== "none" || canUseNoService;

  useEffect(() => {
    if (!open) return;
    if (serviceId === "none") {
      if (!canUseNoService && compatibleServices.length > 0) {
        setServiceId(String(compatibleServices[0].id));
      }
      return;
    }

    if (!compatibleServices.some((service) => String(service.id) === serviceId)) {
      setServiceId(compatibleServices[0] ? String(compatibleServices[0].id) : "none");
    }
  }, [canUseNoService, compatibleServices, open, serviceId]);

  const resetForm = () => {
    setDateValue(format(parseISO(appointment.startTime), "yyyy-MM-dd"));
    setTimeValue(format(parseISO(appointment.startTime), "HH:mm"));
    setBarberId(String(appointment.barberId));
    setServiceId(appointment.serviceId ? String(appointment.serviceId) : "none");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) resetForm();
    setOpen(nextOpen);
  };

  const handleSave = async () => {
    const newStartTime = new Date(`${dateValue}T${timeValue}`);
    const parsedBarberId = Number(barberId);
    const parsedServiceId = serviceId === "none" ? null : Number(serviceId);

    if (Number.isNaN(newStartTime.getTime()) || !Number.isFinite(parsedBarberId)) {
      toast({ title: "Erro", description: "Verifique a data, hora e barbeiro.", variant: "destructive" });
      return;
    }

    if (!hasCompatibleService) {
      toast({ title: "Serviço inválido", description: "Escolha um serviço compatível com o barbeiro.", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      await apiRequest("PATCH", `/api/appointments/${appointment.id}`, {
        startTime: newStartTime,
        barberId: parsedBarberId,
        serviceId: parsedServiceId,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/public"] });
      toast({ title: "Sucesso", description: "Marcação atualizada." });
      setOpen(false);
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message || "Não foi possível atualizar a marcação.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 text-xs text-primary hover:text-primary/80">
          <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-white/10 text-white">
        <DialogHeader><DialogTitle>Editar marcação</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input type="date" value={dateValue} onChange={(event) => setDateValue(event.target.value)} className="bg-background border-white/10 text-white" />
            </div>
            <div className="space-y-2">
              <Label>Hora</Label>
              <Input type="time" value={timeValue} onChange={(event) => setTimeValue(event.target.value)} className="bg-background border-white/10 text-white" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Barbeiro</Label>
            <Select value={barberId} onValueChange={setBarberId}>
              <SelectTrigger className="bg-background border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-white/10 text-white">
                {barbers?.map((barber) => <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Serviço</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger className="bg-background border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-white/10 text-white">
                {canUseNoService && <SelectItem value="none">Sem serviço</SelectItem>}
                {compatibleServices.map((service) => (
                  <SelectItem key={service.id} value={String(service.id)}>
                    {service.name}{service.duration ? ` · ${service.duration} min` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {compatibleServices.length === 0 && !canUseNoService && (
              <p className="text-xs text-red-300">Este barbeiro não tem serviços compatíveis.</p>
            )}
          </div>
          <Button
            variant="gold"
            className="w-full"
            disabled={isSaving || !hasCompatibleService}
            onClick={handleSave}
          >
            {isSaving ? "A guardar..." : "Guardar alterações"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const weekDays = [
  { id: 1, label: "Segunda", short: "Seg" },
  { id: 2, label: "Terça", short: "Ter" },
  { id: 3, label: "Quarta", short: "Qua" },
  { id: 4, label: "Quinta", short: "Qui" },
  { id: 5, label: "Sexta", short: "Sex" },
  { id: 6, label: "Sábado", short: "Sáb" },
  { id: 0, label: "Domingo", short: "Dom" },
];

function ConfirmAction({
  children,
  title,
  description,
  confirmLabel = "Confirmar",
  confirmClassName = "",
  onConfirm,
}: {
  children: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmClassName?: string;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent className="border-white/10 bg-card text-white">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-400">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-white/10 bg-background text-white hover:bg-white/10">
            Voltar
          </AlertDialogCancel>
          <AlertDialogAction className={confirmClassName} onClick={() => void onConfirm()}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AppointmentDetailsDialog({
  appointment,
  open,
  onOpenChange,
  barbers,
  services,
  toast,
  getBarberName,
  getServiceName,
  getStatusLabel,
  getStatusClass,
  onOpenHistory,
  onStatusChange,
  onBlockCustomer,
}: {
  appointment: AdminAppointment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barbers?: Array<{ id: number; name: string; serviceIds?: number[] | null }>;
  services?: ServiceListItem[];
  toast: ReturnType<typeof useToast>["toast"];
  getBarberName: (id: number) => string;
  getServiceName: (id?: number | null) => string;
  getStatusLabel: (status: string) => string;
  getStatusClass: (status: string) => string;
  onOpenHistory: (appointment: AdminAppointment) => void;
  onStatusChange: (appointmentId: number, status: AppointmentStatus) => void;
  onBlockCustomer: (appointment: AdminAppointment) => Promise<void>;
}) {
  if (!appointment) {
    return <Dialog open={open} onOpenChange={onOpenChange} />;
  }

  const start = parseISO(appointment.startTime);
  const end = getWeeklyAppointmentEnd(appointment);

  const handleOpenHistory = () => {
    onOpenChange(false);
    onOpenHistory(appointment);
  };

  const handleStatusChange = (status: AppointmentStatus) => {
    onStatusChange(appointment.id, status);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1rem)] overflow-y-auto border-white/10 bg-card text-white sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Detalhes da marcação</DialogTitle>
          <DialogDescription className="text-gray-400">
            {format(start, "dd/MM/yyyy", { locale: pt })} · {format(start, "HH:mm")} - {format(end, "HH:mm")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-2xl border border-white/10 bg-background/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xl font-display font-bold text-primary">{format(start, "HH:mm")}</p>
                <h3 className="mt-1 truncate text-lg font-bold text-white">{appointment.customerName}</h3>
                <p className="text-sm text-gray-400">{appointment.customerPhone}</p>
              </div>
              <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide", getStatusClass(appointment.status))}>
                {getStatusLabel(appointment.status)}
              </span>
            </div>

            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-card px-3 py-2">
                <p className="text-xs uppercase tracking-widest text-gray-500">Barbeiro</p>
                <p className="mt-1 font-semibold text-white">{getBarberName(appointment.barberId)}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-card px-3 py-2">
                <p className="text-xs uppercase tracking-widest text-gray-500">Serviço</p>
                <p className="mt-1 font-semibold text-white">{getServiceName(appointment.serviceId)}</p>
              </div>
            </div>

            {appointment.depositRequired && (
              <p className="mt-3 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
                Depósito recomendado: {appointment.depositReason || "regra operacional"}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button size="sm" variant="outline" onClick={handleOpenHistory} className="h-9 border-white/10 text-xs">
              <User className="mr-1 h-3.5 w-3.5" /> Histórico
            </Button>

            {appointment.status === "booked" && (
              <>
                <Button size="sm" variant="ghost" onClick={() => handleStatusChange("completed")} className="h-9 text-xs text-green-300 hover:text-green-200">
                  <CheckCircle className="mr-1 h-3.5 w-3.5" /> Feita
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleStatusChange("no_show")} className="h-9 text-xs text-rose-300 hover:text-rose-200">
                  Falta
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleStatusChange("cancelled")} className="h-9 text-xs text-red-300 hover:text-red-200">
                  <XCircle className="mr-1 h-3.5 w-3.5" /> Cancelar
                </Button>
                <ConfirmAction
                  title="Bloquear cliente?"
                  description={`${appointment.customerName} (${appointment.customerPhone}) deixa de conseguir fazer marcações online.`}
                  confirmLabel="Bloquear"
                  confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onConfirm={() => onBlockCustomer(appointment)}
                >
                  <Button size="sm" variant="ghost" className="h-9 text-xs text-destructive hover:text-red-300">
                    Bloquear
                  </Button>
                </ConfirmAction>
                <EditAppointmentDialog
                  appointment={appointment}
                  barbers={barbers}
                  services={services}
                  toast={toast}
                />
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function createDefaultAvailabilityForm(): AvailabilityForm {
  return {
    0: { isWorking: false, periods: [{ startTime: "09:00", endTime: "13:00" }] },
    1: { isWorking: true, periods: [{ startTime: "14:00", endTime: "20:00" }] },
    2: { isWorking: true, periods: [{ startTime: "09:00", endTime: "13:00" }, { startTime: "14:00", endTime: "20:00" }] },
    3: { isWorking: true, periods: [{ startTime: "09:00", endTime: "13:00" }, { startTime: "14:00", endTime: "20:00" }] },
    4: { isWorking: true, periods: [{ startTime: "09:00", endTime: "13:00" }, { startTime: "14:00", endTime: "20:00" }] },
    5: { isWorking: true, periods: [{ startTime: "09:00", endTime: "13:00" }, { startTime: "14:00", endTime: "20:00" }] },
    6: { isWorking: true, periods: [{ startTime: "09:00", endTime: "13:00" }, { startTime: "14:00", endTime: "19:00" }] },
  };
}

function createBlankAvailabilityForm(): AvailabilityForm {
  return weekDays.reduce((acc, day) => {
    acc[day.id] = { isWorking: false, periods: [{ startTime: "09:00", endTime: "13:00" }] };
    return acc;
  }, {} as AvailabilityForm);
}

const blockTimeOptions = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30",
  "18:00", "18:30", "19:00", "19:30",
];

const morningBlockTimes = blockTimeOptions.filter((time) => time < "13:00");
const afternoonBlockTimes = blockTimeOptions.filter((time) => time >= "14:00");

function formatAvailabilitySummary(dayConfig?: { isWorking: boolean; periods: AvailabilityPeriod[] }) {
  if (!dayConfig?.isWorking) return "Fechada";
  return dayConfig.periods.map((period) => `${period.startTime}-${period.endTime}`).join(" / ");
}

function validateAvailabilityForm(form: AvailabilityForm) {
  const issues: string[] = [];

  for (const day of weekDays) {
    const dayConfig = form[day.id];
    if (!dayConfig?.isWorking) continue;

    const sortedPeriods = [...dayConfig.periods].sort((a, b) => a.startTime.localeCompare(b.startTime));

    sortedPeriods.forEach((period) => {
      if (!period.startTime || !period.endTime || period.endTime <= period.startTime) {
        issues.push(`${day.label}: verifique a hora de abertura e fecho.`);
      }
    });

    for (let index = 1; index < sortedPeriods.length; index += 1) {
      if (sortedPeriods[index].startTime < sortedPeriods[index - 1].endTime) {
        issues.push(`${day.label}: existem períodos sobrepostos.`);
        break;
      }
    }
  }

  return issues;
}

export default function Admin() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isAddingBarber, setIsAddingBarber] = useState(false);
  const [isAddingService, setIsAddingService] = useState(false);
  const [barberFormData, setBarberFormData] = useState({ name: "", specialty: "", bio: "", avatar: "", email: "", color: defaultBarberColor, serviceIds: [] as number[] });
  const [barberAvatarDrafts, setBarberAvatarDrafts] = useState<Record<number, string | null>>({});
  const [barberServiceDrafts, setBarberServiceDrafts] = useState<Record<number, number[]>>({});
  const [serviceFormData, setServiceFormData] = useState({ name: "", description: "", price: 0, duration: 30 });

  const [selectedDateFilter, setSelectedDateFilter] = useState<Date>(startOfToday());
  const [selectedBarberFilter, setSelectedBarberFilter] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<AppointmentStatusFilter>("all");
  const [appointmentViewMode, setAppointmentViewMode] = useState<AppointmentViewMode>("day");
  const [dashboardDays, setDashboardDays] = useState("30");
  const [dashboardBarberFilter, setDashboardBarberFilter] = useState("all");
  const [weeklyStartDate, setWeeklyStartDate] = useState<Date>(() =>
    startOfWeek(startOfToday(), { weekStartsOn: 1 }),
  );
  const [selectedAppointment, setSelectedAppointment] = useState<AdminAppointment | null>(null);
  const appointmentQueryDate = appointmentViewMode === "day" ? format(selectedDateFilter, 'yyyy-MM-dd') : undefined;
  const { data: appointments, isLoading: isLoadingAppointments, refetch } = useAppointments({ 
    enabled: user?.authorized === true,
    date: appointmentQueryDate,
    barberId: user?.role === "barber" ? (user.id ? String(user.id) : undefined) : (selectedBarberFilter === "all" ? undefined : selectedBarberFilter),
    refetchInterval: 10000,
  });
  const { data: weeklyAppointments, isLoading: isLoadingWeeklyAppointments } = useAppointments({
    enabled: user?.authorized === true,
    barberId: user?.role === "barber" ? (user.id ? String(user.id) : undefined) : undefined,
    refetchInterval: 10000,
  });
  const { data: barbers } = useBarbers({ enabled: user?.authorized === true, includeHidden: true });
  const { data: services } = useServices({ enabled: user?.authorized === true, includeHidden: true });
  const { data: blacklistEntries } = useQuery<any[]>({ 
    queryKey: ["/api/admin/blacklist"],
    enabled: user?.role === "admin"
  });
  const { data: allAvailabilityRows } = useQuery<any[]>({
    queryKey: ["/api/barbers/availability"],
    enabled: user?.authorized === true,
  });
  const { data: shopAvailabilityRows } = useShopAvailability();
  const { data: dashboardData, isLoading: isLoadingDashboard } = useQuery<DashboardData>({
    queryKey: ["/api/admin/dashboard", dashboardDays, dashboardBarberFilter, user?.role, user?.id],
    enabled: user?.authorized === true,
    queryFn: async () => {
      const params = new URLSearchParams({ days: dashboardDays });
      if (user?.role === "barber" && user.id) {
        params.set("barberId", String(user.id));
      } else if (dashboardBarberFilter !== "all") {
        params.set("barberId", dashboardBarberFilter);
      }

      const res = await apiFetch(`/api/admin/dashboard?${params.toString()}`);
      if (!res.ok) throw new Error("Não foi possível carregar o dashboard.");
      return res.json();
    },
  });
  const appointmentList = useMemo(() => {
    const list = Array.isArray(appointments) ? (appointments as AdminAppointment[]) : [];
    const visibleAppointments = appointmentViewMode === "upcoming"
      ? list.filter((appointment) => new Date(appointment.startTime).getTime() >= startOfToday().getTime())
      : list;

    return [...visibleAppointments].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
  }, [appointments, appointmentViewMode]);
  const filteredAppointmentList = useMemo(
    () => selectedStatusFilter === "all"
      ? appointmentList
      : appointmentList.filter((appointment) => appointment.status === selectedStatusFilter),
    [appointmentList, selectedStatusFilter],
  );
  const weeklyAppointmentList = useMemo(() => {
    const list = Array.isArray(weeklyAppointments) ? (weeklyAppointments as AdminAppointment[]) : [];
    const weekEnd = addDays(weeklyStartDate, 7);

    return list
      .filter((appointment) => {
        const appointmentDate = parseISO(appointment.startTime);
        return appointmentDate >= weeklyStartDate && appointmentDate < weekEnd;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [weeklyAppointments, weeklyStartDate]);
  const selectedAppointmentDetails = useMemo(() => {
    if (!selectedAppointment) return null;
    const candidates = [...weeklyAppointmentList, ...appointmentList];
    return candidates.find((appointment) => appointment.id === selectedAppointment.id) || selectedAppointment;
  }, [appointmentList, selectedAppointment, weeklyAppointmentList]);
  const updateStatus = useUpdateAppointmentStatus();
  const { toast } = useToast();

  const [isBlocking, setIsBlocking] = useState(false);
  const [blockData, setBlockData] = useState<{
    barberId: string;
    serviceId: string;
    times: string[];
    name: string;
    phone: string;
    date: Date;
    endDate: Date;
    isMultiDay: boolean;
    isManualBooking: boolean;
    isRecurring: boolean;
    recurringWeeks: string;
    recurringMonths: string;
  }>({
    barberId: "",
    serviceId: "",
    times: [],
    name: "",
    phone: "900000000",
    date: startOfToday(),
    endDate: startOfToday(),
    isMultiDay: false,
    isManualBooking: false,
    isRecurring: false,
    recurringWeeks: "2",
    recurringMonths: "6",
  });

  const [loginData, setLoginData] = useState({ username: "", password: "" });
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [exportDates, setExportDates] = useState({ 
    start: subDays(startOfToday(), 30), 
    end: startOfToday(),
    barberId: "all"
  });
  const [shopAvailabilityForm, setShopAvailabilityForm] = useState<AvailabilityForm>(() => createDefaultAvailabilityForm());
  const [isSavingShopAvailability, setIsSavingShopAvailability] = useState(false);
  const [customerHistory, setCustomerHistory] = useState<any | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [customerNotes, setCustomerNotes] = useState("");
  const [isSavingCustomerNotes, setIsSavingCustomerNotes] = useState(false);
  const appointmentSignaturesRef = useRef<Set<string>>(new Set());
  const hasHydratedAppointmentsRef = useRef(false);

  const handleAddBarber = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const allServiceIds = getAllServiceIds(services);
      await apiRequest("POST", "/api/barbers", {
        ...barberFormData,
        avatar: barberFormData.avatar || null,
        color: normalizeBarberColor(barberFormData.color),
        serviceIds: normalizeServiceSelection(barberFormData.serviceIds, allServiceIds),
      });
      await refreshBarbersCache();
      setIsAddingBarber(false);
      setBarberFormData({ name: "", specialty: "", bio: "", avatar: "", email: "", color: defaultBarberColor, serviceIds: [] });
      toast({ title: "Sucesso", description: "Barbeiro adicionado com sucesso." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Erro ao adicionar barbeiro.", variant: "destructive" });
    }
  };

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest("POST", "/api/services", serviceFormData);
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setIsAddingService(false);
      setServiceFormData({ name: "", description: "", price: 0, duration: 30 });
      toast({ title: "Sucesso", description: "Serviço adicionado com sucesso." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Erro ao adicionar serviço.", variant: "destructive" });
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const url = `/api/admin/export?startDate=${format(exportDates.start, 'yyyy-MM-dd')}&endDate=${format(exportDates.end, 'yyyy-MM-dd')}&barberId=${exportDates.barberId}`;
      window.open(buildApiUrl(url), '_blank');
      toast({ title: "Sucesso", description: "O relatório está a ser gerado." });
    } catch (err) {
      toast({ title: "Erro", description: "Falha ao gerar o relatório.", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const checkAuth = async () => {
    try {
      const res = await apiFetch("/api/admin/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        setUser({ authorized: false, role: "" });
      }
    } catch {
      setUser({ authorized: false, role: "" });
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const res = await apiFetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginData),
      });
      if (res.ok) {
        const data = await res.json();
        await checkAuth();
        toast({ title: "Bem-vindo", description: data.message });
      } else {
        const data = await res.json().catch(() => null);
        toast({ title: "Erro", description: data?.message || "Utilizador ou palavra-passe incorretos.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro", description: "Erro ao tentar fazer login.", variant: "destructive" });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await apiFetch("/api/admin/logout", { method: "POST" });
    setUser({ authorized: false, role: "" });
  };

  const availabilityRowsToForm = (rows: any[], openField: "isWorking" | "isOpen" = "isWorking") => {
    if (!rows || rows.length === 0) return createDefaultAvailabilityForm();

    const form = createBlankAvailabilityForm();
    weekDays.forEach((day) => {
      const dayRows = rows.filter((row) => row.dayOfWeek === day.id);
      if (dayRows.length === 0) return;

      const openRows = dayRows.filter((row) => row[openField] !== false);
      if (openRows.length === 0) {
        form[day.id].isWorking = false;
        form[day.id].periods = [{
          startTime: dayRows[0]?.startTime || "09:00",
          endTime: dayRows[0]?.endTime || "13:00",
        }];
        return;
      }

      form[day.id].isWorking = true;
      form[day.id].periods = openRows.map((row) => ({
        startTime: row.startTime || "09:00",
        endTime: row.endTime || "13:00",
      }));
    });

    return form;
  };

  const buildAvailabilityRows = (form: AvailabilityForm) => {
    const rows = [];

    for (const day of weekDays) {
      const dayConfig = form[day.id] || {
        isWorking: false,
        periods: [{ startTime: "09:00", endTime: "13:00" }],
      };

      if (!dayConfig.isWorking) {
        rows.push({
          dayOfWeek: day.id,
          startTime: "09:00",
          endTime: "13:00",
          isWorking: false,
        });
        continue;
      }

      const validPeriods = dayConfig.periods.filter(
        (period) => period.startTime && period.endTime && period.endTime > period.startTime,
      );

      if (validPeriods.length !== dayConfig.periods.length || validPeriods.length === 0) {
        throw new Error(`Verifique os horários de ${day.label}.`);
      }

      rows.push(...validPeriods.map((period) => ({
        dayOfWeek: day.id,
        startTime: period.startTime,
        endTime: period.endTime,
        isWorking: true,
      })));
    }

    return rows;
  };

  useEffect(() => {
    if (shopAvailabilityRows) {
      setShopAvailabilityForm(availabilityRowsToForm(shopAvailabilityRows, "isOpen"));
    }
  }, [shopAvailabilityRows]);

  const handleSaveShopAvailability = async () => {
    setIsSavingShopAvailability(true);
    try {
      const issues = validateAvailabilityForm(shopAvailabilityForm);
      if (issues.length > 0) {
        throw new Error(issues[0]);
      }

      const rows = buildAvailabilityRows(shopAvailabilityForm).map((row) => ({
        dayOfWeek: row.dayOfWeek,
        startTime: row.startTime,
        endTime: row.endTime,
        isOpen: row.isWorking,
      }));

      await apiRequest("PATCH", "/api/shop/availability", rows);
      queryClient.invalidateQueries({ queryKey: ["/api/shop/availability"] });
      toast({ title: "Sucesso", description: "Horário da barbearia atualizado." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Não foi possível guardar o horário da barbearia.", variant: "destructive" });
    } finally {
      setIsSavingShopAvailability(false);
    }
  };

  const updateShopDay = (
    dayId: number,
    updater: (dayConfig: { isWorking: boolean; periods: AvailabilityPeriod[] }) => { isWorking: boolean; periods: AvailabilityPeriod[] },
  ) => {
    const dayConfig = shopAvailabilityForm[dayId] || {
      isWorking: false,
      periods: [{ startTime: "09:00", endTime: "13:00" }],
    };
    setShopAvailabilityForm({
      ...shopAvailabilityForm,
      [dayId]: updater(dayConfig),
    });
  };

  const updateShopPeriod = (dayId: number, periodIndex: number, patch: Partial<AvailabilityPeriod>) => {
    updateShopDay(dayId, (dayConfig) => {
      const periods = [...dayConfig.periods];
      periods[periodIndex] = { ...periods[periodIndex], ...patch };
      return { ...dayConfig, periods };
    });
  };

  const shopAvailabilityIssues = useMemo(
    () => validateAvailabilityForm(shopAvailabilityForm),
    [shopAvailabilityForm],
  );

  const openScheduleBlockDialog = (mode: "exception" | "manual", barberId?: string) => {
    setBlockData((current) => ({
      ...current,
      barberId: barberId || current.barberId,
      serviceId: "",
      times: [],
      name: "",
      phone: mode === "manual" ? "" : "900000000",
      isMultiDay: false,
      isManualBooking: mode === "manual",
      isRecurring: false,
    }));
    setIsBlocking(true);
  };

  const openExceptionDialog = (barberId?: string) => {
    openScheduleBlockDialog("exception", barberId);
  };

  const getAgendaSelectedBarberId = () => {
    if (user?.role === "barber" && user.id) return String(user.id);
    return selectedBarberFilter !== "all" ? selectedBarberFilter : undefined;
  };

  const openAgendaExceptionDialog = () => {
    openExceptionDialog(getAgendaSelectedBarberId());
  };

  const openManualBookingDialog = () => {
    openScheduleBlockDialog("manual", getAgendaSelectedBarberId());
  };

  const handleCreateBarberInvite = async (barber: any) => {
    try {
      const res = await apiRequest("POST", `/api/barbers/${barber.id}/invite`, {});
      const data = await res.json();

      try {
        await navigator.clipboard?.writeText(data.inviteUrl);
      } catch {
        // Clipboard can fail on non-HTTPS local previews; the link is still shown in the toast.
      }

      toast({
        title: "Convite criado",
        description: `Link copiado para enviar a ${barber.name}: ${data.inviteUrl}`,
      });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Não foi possível criar o convite.", variant: "destructive" });
    }
  };

  const openCustomerHistory = async (appointment: any) => {
    setIsHistoryOpen(true);
    setIsLoadingHistory(true);
    setCustomerHistory(null);
    setCustomerNotes("");
    try {
      const params = new URLSearchParams();
      if (appointment.customerEmail) params.set("email", appointment.customerEmail);
      if (appointment.customerName) params.set("name", appointment.customerName);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await apiFetch(`/api/admin/customers/${encodeURIComponent(appointment.customerPhone)}/history${query}`);
      if (!res.ok) throw new Error("Não foi possível carregar o histórico do cliente.");
      const data = await res.json();
      setCustomerHistory(data);
      setCustomerNotes(data.notes?.notes || "");
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
      setIsHistoryOpen(false);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleSaveCustomerNotes = async () => {
    if (!customerHistory?.customer?.phone) return;
    setIsSavingCustomerNotes(true);
    try {
      const res = await apiRequest("PATCH", `/api/admin/customers/${encodeURIComponent(customerHistory.customer.phone)}/notes`, {
        customerName: customerHistory.customer.name || "",
        email: customerHistory.customer.email || "",
        notes: customerNotes,
      });
      const savedNote = await res.json();
      setCustomerHistory({
        ...customerHistory,
        notes: {
          notes: savedNote.notes,
          updatedAt: savedNote.updatedAt,
        },
      });
      setCustomerNotes(savedNote.notes || "");
      toast({ title: "Notas guardadas", description: "As preferências do cliente foram atualizadas." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Não foi possível guardar as notas.", variant: "destructive" });
    } finally {
      setIsSavingCustomerNotes(false);
    }
  };

  const getBarberName = (id: number) => barbers?.find(b => b.id === id)?.name || "Desconhecido";
  const getServiceName = (id?: number | null) => services?.find(s => s.id === id)?.name || "Serviço indisponível";
  const getStatusLabel = (status: string) => ({
    booked: "Marcada",
    completed: "Concluída",
    cancelled: "Cancelada",
    late_cancelled: "Cancelamento tardio",
    no_show: "Falta",
  }[status] || status);
  const getStatusClass = (status: string) => ({
    booked: "text-blue-300 border-blue-400/20 bg-blue-500/10",
    completed: "text-green-300 border-green-400/20 bg-green-500/10",
    cancelled: "text-red-300 border-red-400/20 bg-red-500/10",
    late_cancelled: "text-orange-300 border-orange-400/20 bg-orange-500/10",
    no_show: "text-rose-300 border-rose-400/20 bg-rose-500/10",
  }[status] || "text-gray-300 border-white/10 bg-white/5");

  const handleStatusChange = (appointmentId: number, status: AppointmentStatus) => {
    updateStatus.mutate(
      { id: appointmentId, status },
      {
        onSuccess: () => {
          toast({ title: "Atualizado", description: `Estado alterado para ${getStatusLabel(status).toLowerCase()}.` });
        },
        onError: (error: any) => {
          toast({ title: "Erro", description: error.message || "Não foi possível atualizar a marcação.", variant: "destructive" });
        },
      },
    );
  };

  const handleBlockCustomer = async (appointment: AdminAppointment) => {
    await apiRequest("POST", "/api/admin/blacklist", {
      phone: appointment.customerPhone,
      email: appointment.customerEmail,
      reason: `Faltou à marcação de ${format(parseISO(appointment.startTime), "dd/MM/yyyy HH:mm")}`,
    });
    toast({ title: "Sucesso", description: "Cliente adicionado à lista de bloqueio." });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/blacklist"] });
  };

  const activeBarberColumns = useMemo(() => {
    const allBarbers = barbers || [];
    if (user?.role === "barber") {
      return allBarbers.filter((barber) => barber.id === user.id);
    }
    if (selectedBarberFilter !== "all") {
      return allBarbers.filter((barber) => String(barber.id) === selectedBarberFilter);
    }
    return allBarbers;
  }, [barbers, selectedBarberFilter, user]);

  const appointmentsByBarber = useMemo(() => {
    return activeBarberColumns.map((barber) => ({
      barber,
      appointments: filteredAppointmentList
        .filter((appointment) => appointment.barberId === barber.id)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    }));
  }, [activeBarberColumns, filteredAppointmentList]);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    appointmentSignaturesRef.current = new Set();
    hasHydratedAppointmentsRef.current = false;
  }, [appointmentViewMode, selectedDateFilter, selectedBarberFilter, user?.role, user?.id]);

  useEffect(() => {
    if (!user?.authorized) return;

    const list = appointmentList.filter((appointment) =>
      ["booked", "cancelled", "late_cancelled"].includes(appointment.status),
    );
    const signatures = new Set(
      list.map((appointment) => `${appointment.id}:${appointment.status}:${appointment.startTime}`),
    );

    if (hasHydratedAppointmentsRef.current) {
      const changedItems = list.filter(
        (appointment) => !appointmentSignaturesRef.current.has(`${appointment.id}:${appointment.status}:${appointment.startTime}`),
      );
      if (changedItems.length > 0) {
        const appointment = changedItems[0];
        toast({
          title: "Painel atualizado",
          description: `${getStatusLabel(appointment.status)}: ${appointment.customerName} às ${format(parseISO(appointment.startTime), "HH:mm")}.`,
        });
      }
    }

    appointmentSignaturesRef.current = signatures;
    hasHydratedAppointmentsRef.current = true;
  }, [appointmentList, toast, user?.authorized]);

  const isDayClosed = (date: Date) => {
    const day = date.getDay();
    return periodsForShop({
      dayOfWeek: day,
      shopAvailabilityRows: (shopAvailabilityRows as ShopAvailabilityRow[] | undefined) ?? [],
    }).length === 0;
  };

  const isTimeAvailableForDay = (date: Date, timeStr: string, duration = 30, barberId?: string) => {
    const day = date.getDay();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const startMinutes = hours * 60 + minutes;
    const endMinutes = startMinutes + duration;

    const periods = barberId
      ? getEffectivePeriodsForBarber({
          barberId: Number(barberId),
          dayOfWeek: day,
          shopAvailabilityRows: (shopAvailabilityRows as ShopAvailabilityRow[] | undefined) ?? [],
          availabilityRows: (allAvailabilityRows as AvailabilityRow[] | undefined) ?? [],
        })
      : periodsForShop({
          dayOfWeek: day,
          shopAvailabilityRows: (shopAvailabilityRows as ShopAvailabilityRow[] | undefined) ?? [],
        });

    return periods.some((period: any) => startMinutes >= period.start && endMinutes <= period.end);
  };

  const selectedBlockBarber = barbers?.find((barber) => String(barber.id) === blockData.barberId);
  const manualBookingServices = useMemo(() => {
    const serviceList = services || [];
    if (!blockData.barberId) return serviceList;
    return serviceList.filter((service) => canBarberPerformService(selectedBlockBarber, service.id));
  }, [blockData.barberId, selectedBlockBarber, services]);

  useEffect(() => {
    if (!blockData.isManualBooking || !blockData.serviceId) return;
    if (manualBookingServices.some((service) => String(service.id) === blockData.serviceId)) return;

    setBlockData((current) => ({
      ...current,
      serviceId: "",
      times: [],
    }));
  }, [blockData.isManualBooking, blockData.serviceId, manualBookingServices]);

  const selectedBlockDuration = blockData.isManualBooking && blockData.serviceId
    ? services?.find((service) => String(service.id) === blockData.serviceId)?.duration ?? 30
    : 30;
  const availableBlockTimes = blockTimeOptions.filter((time) =>
    isTimeAvailableForDay(blockData.date, time, selectedBlockDuration, blockData.barberId),
  );
  const setQuickBlockTimes = (times: string[]) => {
    const available = times.filter((time) => availableBlockTimes.includes(time));
    setBlockData({ ...blockData, times: available });
  };

  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const handleBlockTime = async () => {
    if (!blockData.barberId) {
      toast({ title: "Erro", description: "Selecione um barbeiro.", variant: "destructive" });
      return;
    }
    if (blockData.times.length === 0) {
      toast({ title: "Erro", description: "Selecione pelo menos um horário.", variant: "destructive" });
      return;
    }
    if (blockData.isManualBooking && !blockData.serviceId) {
      toast({ title: "Erro", description: "Selecione um serviço.", variant: "destructive" });
      return;
    }

    try {
      const promises: any[] = [];
      
      if (blockData.isRecurring) {
        const timeStr = blockData.times[0];
        const [hours, minutes] = timeStr.split(':').map(Number);
        const startTime = new Date(blockData.date);
        startTime.setHours(hours, minutes, 0, 0);

        await apiRequest("POST", "/api/appointments/block", {
          barberId: Number(blockData.barberId),
          serviceId: Number(blockData.serviceId),
          startTime: startTime,
          name: blockData.name || "Cliente Manual",
          phone: blockData.phone || "900000000",
          isManualBooking: true,
          isRecurring: true,
          recurringWeeks: Number(blockData.recurringWeeks),
          recurringMonths: Number(blockData.recurringMonths)
        });
      } else {
        let datesToBlock = [blockData.date];
        if (blockData.isMultiDay && blockData.endDate > blockData.date) {
          datesToBlock = [];
          let current = new Date(blockData.date);
          while (current <= blockData.endDate) {
            if (!isDayClosed(current)) datesToBlock.push(new Date(current));
            current.setDate(current.getDate() + 1);
          }
        }
        
        for (const date of datesToBlock) {
          for (const timeStr of blockData.times) {
            const [hours, minutes] = timeStr.split(':').map(Number);
            const startTime = new Date(date);
            startTime.setHours(hours, minutes, 0, 0);
            
            const payload = {
              barberId: Number(blockData.barberId),
              serviceId: blockData.isManualBooking ? Number(blockData.serviceId) : null,
              startTime: startTime,
              name: blockData.isManualBooking ? (blockData.name || "Cliente Manual") : (blockData.name || "BLOQUEIO MANUAL"),
              phone: blockData.phone || "900000000",
              isManualBooking: blockData.isManualBooking,
            };

            promises.push(apiRequest("POST", "/api/appointments/block", payload));
          }
        }
        await Promise.all(promises);
      }
      
      toast({ title: "Sucesso", description: "Registo(s) processado(s) com sucesso." });
      setIsBlocking(false);
      setBlockData({ ...blockData, times: [], name: "", phone: "900000000", serviceId: "", isMultiDay: false, isManualBooking: false, isRecurring: false });
      refetch();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  if (user === null) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!user.authorized) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-card border-white/10">
          <CardHeader>
            <CardTitle className="text-2xl font-display font-bold text-center text-white">Baptista Barber Shop</CardTitle>
            <p className="text-center text-gray-400 text-sm mt-2">Acesso para Administradores e Barbeiros</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-white">Email ou nome de utilizador</Label>
                <Input value={loginData.username} onChange={(e) => setLoginData({...loginData, username: e.target.value})} className="bg-background border-white/10 text-white" placeholder="Introduza o email ou nome de utilizador" autoComplete="username" required />
              </div>
              <div className="space-y-2">
                <Label className="text-white">Palavra-passe</Label>
                <Input type="password" value={loginData.password} onChange={(e) => setLoginData({...loginData, password: e.target.value})} className="bg-background border-white/10 text-white" autoComplete="current-password" required />
              </div>
              <Button type="submit" variant="gold" className="w-full" disabled={isLoggingIn}>{isLoggingIn ? "A entrar..." : "Entrar"}</Button>
              <p className="text-[10px] text-gray-500 text-center">Barbeiros devem definir a palavra-passe através do convite enviado pelo administrador.</p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-body p-4 md:p-8">
      <div className="container mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8 text-white">
          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-2">
              <h1 className="text-2xl md:text-3xl font-display font-bold">Painel Administrativo</h1>
              <div className="flex items-center gap-2">
                <Link href="/"><Button variant="outline" size="sm" className="text-primary border-primary/20 hover:bg-primary/10 h-8">Ver Site</Button></Link>
                <Button variant="ghost" size="sm" onClick={handleLogout} className="text-gray-500 hover:text-white w-fit px-0 sm:px-3"><LogOut className="w-4 h-4 mr-2" /> Sair</Button>
              </div>
            </div>
            <p className="text-gray-400 text-sm">Faça a gestão das marcações, da equipa e dos serviços.</p>
          </div>
        </div>

        <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
          <DialogContent className="bg-card border-white/10 text-white w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Histórico do cliente</DialogTitle>
            </DialogHeader>
            {isLoadingHistory ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : customerHistory ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-bold">{customerHistory.customer.name || "Cliente"}</h3>
                  <p className="text-sm text-gray-400">{customerHistory.customer.phone} {customerHistory.customer.email ? `· ${customerHistory.customer.email}` : ""}</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-gray-400">Total</p><p className="text-xl font-bold">{customerHistory.stats.total}</p></div>
                  <div className="rounded-xl bg-blue-500/10 p-3"><p className="text-xs text-gray-400">Marcadas</p><p className="text-xl font-bold text-blue-300">{customerHistory.stats.booked}</p></div>
                  <div className="rounded-xl bg-green-500/10 p-3"><p className="text-xs text-gray-400">Concluídas</p><p className="text-xl font-bold text-green-300">{customerHistory.stats.completed}</p></div>
                  <div className="rounded-xl bg-red-500/10 p-3"><p className="text-xs text-gray-400">Canceladas</p><p className="text-xl font-bold text-red-300">{customerHistory.stats.cancelled}</p></div>
                  <div className="rounded-xl bg-orange-500/10 p-3"><p className="text-xs text-gray-400">Tardios</p><p className="text-xl font-bold text-orange-300">{customerHistory.stats.lateCancelled}</p></div>
                  <div className="rounded-xl bg-rose-500/10 p-3"><p className="text-xs text-gray-400">Faltas</p><p className="text-xl font-bold text-rose-300">{customerHistory.stats.noShows}</p></div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-gray-300">
                  Última presença: {customerHistory.stats.lastPresence ? format(parseISO(customerHistory.stats.lastPresence), "dd/MM/yyyy HH:mm") : "sem presença registada"}
                  {customerHistory.stats.depositRecommended && (
                    <span className="ml-2 text-primary">Depósito recomendado nas próximas marcações.</span>
                  )}
                </div>
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <Label className="text-sm font-semibold text-white">Notas do cliente</Label>
                      <p className="text-xs text-gray-400">
                        Preferências de corte, hábitos de visita, barbeiro preferido ou cuidados a lembrar.
                      </p>
                    </div>
                    {customerHistory.notes?.updatedAt && (
                      <span className="text-[11px] text-gray-500">
                        Atualizado em {format(parseISO(customerHistory.notes.updatedAt), "dd/MM/yyyy HH:mm")}
                      </span>
                    )}
                  </div>
                  <Textarea
                    value={customerNotes}
                    onChange={(e) => setCustomerNotes(e.target.value)}
                    maxLength={1200}
                    placeholder="Ex.: Degradê médio, máquina 0.5 dos lados, prefere Bruno, costuma vir a cada 3 semanas."
                    className="min-h-[110px] resize-y border-white/10 bg-background text-white placeholder:text-gray-600"
                  />
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-xs text-gray-500">{customerNotes.length}/1200</span>
                    <Button
                      variant="gold"
                      size="sm"
                      onClick={handleSaveCustomerNotes}
                      disabled={isSavingCustomerNotes}
                      className="w-full sm:w-auto"
                    >
                      {isSavingCustomerNotes ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Guardar notas
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {customerHistory.appointments.map((appointment: any) => (
                    <div key={appointment.id} className="rounded-xl border border-white/10 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{appointment.serviceName}</p>
                        <p className="text-xs text-gray-400">{appointment.barberName} · {format(parseISO(appointment.startTime), "dd/MM/yyyy HH:mm")}</p>
                      </div>
                      <span className="text-xs uppercase tracking-widest text-gray-400">{getStatusLabel(appointment.status)}</span>
                    </div>
                  ))}
                  {customerHistory.appointments.length === 0 && (
                    <p className="text-center text-gray-500 py-6">Sem histórico para este cliente.</p>
                  )}
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <AppointmentDetailsDialog
          appointment={selectedAppointmentDetails}
          open={!!selectedAppointmentDetails}
          onOpenChange={(open) => {
            if (!open) setSelectedAppointment(null);
          }}
          barbers={barbers}
          services={services}
          toast={toast}
          getBarberName={getBarberName}
          getServiceName={getServiceName}
          getStatusLabel={getStatusLabel}
          getStatusClass={getStatusClass}
          onOpenHistory={openCustomerHistory}
          onStatusChange={handleStatusChange}
          onBlockCustomer={handleBlockCustomer}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="scrollbar-none w-full justify-start overflow-x-auto bg-card border border-white/10 p-1">
            <TabsTrigger value="dashboard" className="gap-2 whitespace-nowrap text-white data-[state=active]:text-primary"><CalendarIcon className="w-4 h-4" /> Agenda</TabsTrigger>
            <TabsTrigger value="appointments" className="gap-2 whitespace-nowrap text-white data-[state=active]:text-primary"><Clock className="w-4 h-4" /> Marcações</TabsTrigger>
            {user.role === "admin" && (
              <>
                <TabsTrigger value="barbers" className="gap-2 whitespace-nowrap text-white data-[state=active]:text-primary"><Users className="w-4 h-4" /> Equipa</TabsTrigger>
                <TabsTrigger value="services" className="gap-2 whitespace-nowrap text-white data-[state=active]:text-primary"><Scissors className="w-4 h-4" /> Serviços</TabsTrigger>
                <TabsTrigger value="settings" className="gap-2 whitespace-nowrap text-white data-[state=active]:text-primary"><CalendarIcon className="w-4 h-4" /> Horário</TabsTrigger>
                <TabsTrigger value="blacklist" className="gap-2 whitespace-nowrap text-white data-[state=active]:text-primary"><User className="w-4 h-4 text-red-400" /> Bloqueados</TabsTrigger>
                <TabsTrigger value="reports" className="gap-2 whitespace-nowrap text-white data-[state=active]:text-primary"><FileDown className="w-4 h-4" /> Relatórios</TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6 outline-none">
            <WeeklyAgenda
              weekStartDate={weeklyStartDate}
              appointments={weeklyAppointmentList}
              barbers={barbers}
              services={services}
              isLoading={isLoadingWeeklyAppointments}
              onPreviousWeek={() => setWeeklyStartDate((current) => addDays(current, -7))}
              onNextWeek={() => setWeeklyStartDate((current) => addDays(current, 7))}
              onToday={() => setWeeklyStartDate(startOfWeek(startOfToday(), { weekStartsOn: 1 }))}
              onException={openAgendaExceptionDialog}
              onManualBooking={openManualBookingDialog}
              onSelectAppointment={setSelectedAppointment}
              getStatusLabel={getStatusLabel}
            />

            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Dashboard de negócio</h2>
                <p className="text-sm text-gray-400">
                  Receita, procura, faltas e clientes a recuperar num só lugar.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select value={dashboardDays} onValueChange={setDashboardDays}>
                  <SelectTrigger className="h-11 border-white/10 bg-card text-white sm:w-[170px]">
                    <SelectValue placeholder="Período" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10 text-white">
                    <SelectItem value="7">Últimos 7 dias</SelectItem>
                    <SelectItem value="30">Últimos 30 dias</SelectItem>
                    <SelectItem value="90">Últimos 90 dias</SelectItem>
                  </SelectContent>
                </Select>
                {user.role === "admin" ? (
                  <Select value={dashboardBarberFilter} onValueChange={setDashboardBarberFilter}>
                    <SelectTrigger className="h-11 border-white/10 bg-card text-white sm:w-[190px]">
                      <SelectValue placeholder="Barbeiro" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-white/10 text-white">
                      <SelectItem value="all">Todos os barbeiros</SelectItem>
                      {barbers?.map((barber) => (
                        <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex h-11 items-center rounded-md border border-white/10 bg-card px-3 text-sm font-semibold text-primary">
                    {user.name}
                  </div>
                )}
              </div>
            </div>

            {isLoadingDashboard || !dashboardData ? (
              <Card className="border-white/10 bg-card text-white">
                <CardContent className="flex min-h-[320px] items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    {
                      label: "Receita concluída",
                      value: formatCents(dashboardData.summary.revenueCents),
                      detail: `${dashboardData.summary.completed} serviços concluídos`,
                      icon: Euro,
                      tone: "text-green-300",
                    },
                    {
                      label: "Receita em agenda",
                      value: formatCents(dashboardData.summary.projectedRevenueCents),
                      detail: `${dashboardData.summary.booked} marcações ativas`,
                      icon: TrendingUp,
                      tone: "text-primary",
                    },
                    {
                      label: "Taxa de conclusão",
                      value: `${dashboardData.summary.completionRate}%`,
                      detail: `${dashboardData.summary.appointments} marcações no período`,
                      icon: UserCheck,
                      tone: "text-blue-300",
                    },
                    {
                      label: "Risco operacional",
                      value: `${dashboardData.summary.noShowRate}%`,
                      detail: `${dashboardData.summary.noShows} faltas · ${dashboardData.summary.cancellations} cancelamentos`,
                      icon: AlertTriangle,
                      tone: "text-rose-300",
                    },
                  ].map((metric) => (
                    <Card key={metric.label} className="border-white/10 bg-card text-white">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-widest text-gray-500">{metric.label}</p>
                            <p className="mt-2 text-2xl font-bold">{metric.value}</p>
                          </div>
                          <metric.icon className={cn("mt-1 h-5 w-5", metric.tone)} />
                        </div>
                        <p className="mt-3 text-xs text-gray-400">{metric.detail}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
                  <Suspense
                    fallback={
                      <DashboardChartFallback
                        title="Evolução diária"
                        description="Marcações, serviços concluídos e receita por dia."
                        heightClassName="h-[280px]"
                      />
                    }
                  >
                    <DashboardChartCard variant="daily" daily={dashboardData.daily} formatCents={formatCents} />
                  </Suspense>

                  <Card className="border-white/10 bg-card text-white">
                    <CardHeader>
                      <CardTitle className="text-base font-bold">Sinais rápidos</CardTitle>
                      <p className="text-sm text-gray-400">Pontos que merecem ação nos próximos dias.</p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="rounded-lg border border-white/10 bg-background/60 p-3">
                        <p className="text-xs text-gray-500">Próximos 7 dias</p>
                        <p className="mt-1 text-xl font-bold">{dashboardData.summary.upcomingWeek} marcações</p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-background/60 p-3">
                        <p className="text-xs text-gray-500">Ticket médio concluído</p>
                        <p className="mt-1 text-xl font-bold">{formatCents(dashboardData.summary.averageTicketCents)}</p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-background/60 p-3">
                        <p className="text-xs text-gray-500">Hora com mais procura</p>
                        <p className="mt-1 text-xl font-bold">{dashboardData.summary.busiestHour || "Sem dados"}</p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-background/60 p-3">
                        <p className="text-xs text-gray-500">Clientes a recuperar</p>
                        <p className="mt-1 text-xl font-bold">{dashboardData.summary.inactiveCustomers}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                  <Suspense fallback={<DashboardChartFallback title="Desempenho por barbeiro" heightClassName="h-[260px]" />}>
                    <DashboardChartCard variant="barbers" barbers={dashboardData.barbers} formatCents={formatCents} />
                  </Suspense>

                  <Card className="border-white/10 bg-card text-white">
                    <CardHeader>
                      <CardTitle className="text-base font-bold">Serviços com mais procura</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {dashboardData.services.length === 0 ? (
                        <p className="py-8 text-center text-sm text-gray-500">Sem dados neste período.</p>
                      ) : (
                        dashboardData.services.map((service) => {
                          const maxCount = Math.max(...dashboardData.services.map((item) => item.count), 1);
                          return (
                            <div key={service.id} className="space-y-2">
                              <div className="flex items-center justify-between gap-3 text-sm">
                                <span className="font-medium text-white">{service.name}</span>
                                <span className="text-gray-400">{service.count} marcações · {formatCents(service.revenueCents)}</span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full rounded-full bg-primary"
                                  style={{ width: `${Math.max(8, (service.count / maxCount) * 100)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-white/10 bg-card text-white">
                  <CardHeader>
                    <CardTitle className="text-base font-bold">Clientes que podem voltar</CardTitle>
                    <p className="text-sm text-gray-400">Clientes concluídos sem nova marcação há mais de 45 dias.</p>
                  </CardHeader>
                  <CardContent>
                    {dashboardData.inactiveCustomers.length === 0 ? (
                      <p className="py-6 text-center text-sm text-gray-500">Sem clientes inativos para este filtro.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {dashboardData.inactiveCustomers.map((customer) => (
                          <div key={`${customer.phone}-${customer.email}`} className="rounded-lg border border-white/10 bg-background/60 p-3">
                            <p className="font-semibold text-white">{customer.name || "Cliente"}</p>
                            <p className="mt-1 text-xs text-gray-400">{customer.phone || customer.email}</p>
                            <p className="mt-3 text-xs text-gray-500">
                              Última visita há {customer.daysSinceLastVisit} dias · {customer.totalVisits} visitas
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="appointments" className="space-y-6 outline-none">
            <div className="flex flex-col sm:flex-row items-stretch gap-3 shrink-0 mb-6">
              {user.role === "admin" ? (
                <Select value={selectedBarberFilter} onValueChange={setSelectedBarberFilter}>
                  <SelectTrigger className="border-white/10 h-11 sm:h-9 bg-card w-full sm:w-[180px] text-white">
                    <SelectValue placeholder="Filtrar por Barbeiro" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10 text-white">
                    <SelectItem value="all">Todos os Barbeiros</SelectItem>
                    {barbers?.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center px-4 bg-card border border-white/10 rounded-md text-primary font-bold text-sm h-11 sm:h-9">
                  {user.name}
                </div>
              )}

              <div className="grid h-11 grid-cols-2 gap-1 rounded-md border border-white/10 bg-card p-1 sm:h-9 sm:w-[178px]">
                <Button
                  type="button"
                  variant={appointmentViewMode === "day" ? "gold" : "ghost"}
                  className="h-full px-3 text-xs"
                  onClick={() => setAppointmentViewMode("day")}
                >
                  Dia
                </Button>
                <Button
                  type="button"
                  variant={appointmentViewMode === "upcoming" ? "gold" : "ghost"}
                  className="h-full px-3 text-xs"
                  onClick={() => setAppointmentViewMode("upcoming")}
                >
                  Próximas
                </Button>
              </div>

              {appointmentViewMode === "day" ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="border-white/10 gap-2 justify-start h-11 sm:h-9 text-white">
                      <CalendarIcon className="w-4 h-4" /> {format(selectedDateFilter, "dd 'de' MMMM", { locale: pt })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 bg-card border-white/10" align="end">
                    <Calendar mode="single" selected={selectedDateFilter} onSelect={(d) => d && setSelectedDateFilter(d)} locale={pt} initialFocus />
                  </PopoverContent>
                </Popover>
              ) : (
                <Button variant="outline" className="pointer-events-none border-white/10 gap-2 justify-start h-11 sm:h-9 text-white/80">
                  <CalendarIcon className="w-4 h-4" /> Hoje em diante
                </Button>
              )}

              <Select value={selectedStatusFilter} onValueChange={(value) => setSelectedStatusFilter(value as AppointmentStatusFilter)}>
                <SelectTrigger className="border-white/10 h-11 sm:h-9 bg-card w-full sm:w-[210px] text-white">
                  <SelectValue placeholder="Filtrar por estado" />
                </SelectTrigger>
                <SelectContent className="bg-card border-white/10 text-white">
                  {appointmentStatusFilterOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex">
                <Button
                  variant="outline"
                  className="min-w-0 gap-2 h-11 sm:h-9 border-white/10 whitespace-normal"
                  onClick={openAgendaExceptionDialog}
                >
                  <AlertTriangle className="h-4 w-4" /> Ausência
                </Button>
                <Button
                  variant="gold"
                  className="min-w-0 gap-2 h-11 sm:h-9 whitespace-normal"
                  onClick={openManualBookingDialog}
                >
                  <Plus className="w-4 h-4" /> Marcação manual
                </Button>
              </div>

              <Dialog open={isBlocking} onOpenChange={setIsBlocking}>
                <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-card border-white/10 text-white w-[calc(100vw-1rem)] max-w-2xl sm:w-[94vw] max-h-[calc(100dvh-1.5rem)] rounded-2xl p-0 shadow-2xl backdrop-blur-md">
                  <DialogHeader className="border-b border-white/10 px-5 py-5 pr-12 sm:px-6">
                    <DialogTitle className="text-xl font-display font-bold text-primary">
                      {blockData.isManualBooking ? "Marcação manual" : "Ausência na agenda"}
                    </DialogTitle>
                    <DialogDescription className="text-sm text-gray-400">
                      {blockData.isManualBooking
                        ? "Crie uma marcação que chegou por chamada ou mensagem diretamente na agenda."
                        : "Bloqueie horas, férias ou ausências sem alterar o horário base da barbearia."}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
                    <div className="space-y-5">
                      <div className="rounded-xl border border-primary/10 bg-primary/5 p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                            {blockData.isManualBooking ? <User className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-white">
                              {blockData.isManualBooking ? "Marcação adicionada à agenda" : "Ausência / bloqueio"}
                            </p>
                            <p className="mt-1 whitespace-normal break-words text-xs text-gray-400">
                              {blockData.isManualBooking
                                ? "Para clientes que entraram por contacto direto e precisam de ficar registados."
                                : "Pausas, férias, almoço maior ou fecho excecional para um barbeiro."}
                            </p>
                          </div>
                        </div>
                        {!blockData.isManualBooking && (
                          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-background/50 px-3 py-2">
                            <div>
                              <Label htmlFor="multiDay" className="text-sm font-medium cursor-pointer">Bloquear vários dias</Label>
                              <p className="text-xs text-gray-500">Ideal para férias ou ausências completas.</p>
                            </div>
                            <Switch
                              id="multiDay"
                              checked={blockData.isMultiDay}
                              onCheckedChange={(checked) => setBlockData({ ...blockData, isMultiDay: checked, isManualBooking: false, isRecurring: false })}
                            />
                          </div>
                        )}
                        {blockData.isManualBooking && (
                          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-background/50 px-3 py-2">
                            <div>
                              <Label htmlFor="recurring" className="text-sm font-medium cursor-pointer">Repetir marcação</Label>
                              <p className="text-xs text-gray-500">Reserva automática para clientes fixos.</p>
                            </div>
                            <Switch
                              id="recurring"
                              checked={blockData.isRecurring}
                              onCheckedChange={(checked) => setBlockData({ ...blockData, isRecurring: checked, isMultiDay: false })}
                            />
                          </div>
                        )}
                      </div>

                      {blockData.isRecurring && (
                        <div className="grid grid-cols-2 gap-4 p-4 bg-primary/5 rounded-xl border border-primary/10">
                          <div className="space-y-2">
                            <Label className="text-xs text-gray-400">Repetir a cada (semanas)</Label>
                            <Select value={blockData.recurringWeeks} onValueChange={(v) => setBlockData({...blockData, recurringWeeks: v})}>
                              <SelectTrigger className="bg-background/50 border-white/10 h-10"><SelectValue /></SelectTrigger>
                              <SelectContent className="bg-card border-white/10 text-white">
                                <SelectItem value="1">1 semana</SelectItem>
                                <SelectItem value="2">2 semanas</SelectItem>
                                <SelectItem value="3">3 semanas</SelectItem>
                                <SelectItem value="4">4 semanas</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs text-gray-400">Durante (meses)</Label>
                            <Select value={blockData.recurringMonths} onValueChange={(v) => setBlockData({...blockData, recurringMonths: v})}>
                              <SelectTrigger className="bg-background/50 border-white/10 h-10"><SelectValue /></SelectTrigger>
                              <SelectContent className="bg-card border-white/10 text-white">
                                <SelectItem value="1">1 mês</SelectItem>
                                <SelectItem value="3">3 meses</SelectItem>
                                <SelectItem value="6">6 meses</SelectItem>
                                <SelectItem value="12">1 ano</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <Label className="text-sm font-medium text-gray-300">{blockData.isMultiDay ? "Início" : "Data"}</Label>
                        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                          <PopoverTrigger asChild><Button variant="outline" className="w-full bg-background/50 border-white/10 h-12 rounded-xl justify-start gap-2 text-white"><CalendarIcon className="w-4 h-4" />{format(blockData.date, "dd/MM/yyyy")}</Button></PopoverTrigger>
                          <PopoverContent className="w-auto p-0 bg-card border-white/10"><Calendar mode="single" selected={blockData.date} onSelect={(d) => { if (d) { setBlockData({ ...blockData, date: d }); setIsCalendarOpen(false); } }} locale={pt} initialFocus /></PopoverContent>
                        </Popover>
                      </div>
                      {blockData.isMultiDay && (
                        <div className="space-y-3">
                          <Label className="text-sm font-medium text-gray-300">Fim</Label>
                          <Popover>
                            <PopoverTrigger asChild><Button variant="outline" className="w-full bg-background/50 border-white/10 h-12 rounded-xl justify-start gap-2 text-white"><CalendarIcon className="w-4 h-4" />{format(blockData.endDate, "dd/MM/yyyy")}</Button></PopoverTrigger>
                            <PopoverContent className="w-auto p-0 bg-card border-white/10"><Calendar mode="single" selected={blockData.endDate} onSelect={(d) => d && setBlockData({ ...blockData, endDate: d })} disabled={(d) => d < blockData.date} locale={pt} initialFocus /></PopoverContent>
                          </Popover>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <Label className="text-sm font-medium text-gray-300">Barbeiro</Label>
                        <Select value={blockData.barberId} onValueChange={(v) => setBlockData({...blockData, barberId: v})}>
                          <SelectTrigger className="bg-background/50 border-white/10 h-12 rounded-xl text-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent className="bg-card border-white/10 text-white">{barbers?.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      {blockData.isManualBooking && (
                        <div className="space-y-3">
                          <Label className="text-sm font-medium text-gray-300">Serviço</Label>
                          <Select value={blockData.serviceId} onValueChange={(v) => setBlockData({...blockData, serviceId: v})}>
                            <SelectTrigger className="bg-background/50 border-white/10 h-12 rounded-xl text-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                            <SelectContent className="bg-card border-white/10 text-white">
                              {manualBookingServices.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {blockData.barberId && manualBookingServices.length === 0 && (
                            <p className="text-xs text-red-300">Este barbeiro não tem serviços associados.</p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <Label className="text-sm font-medium text-gray-300">Horas afetadas</Label>
                          <p className="text-xs text-gray-500">
                            {blockData.times.length > 0 ? `${blockData.times.length} horário${blockData.times.length === 1 ? "" : "s"} selecionado${blockData.times.length === 1 ? "" : "s"}` : "Escolha uma ou mais horas."}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:flex">
                          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setQuickBlockTimes(morningBlockTimes)}>
                            Manhã
                          </Button>
                          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setQuickBlockTimes(afternoonBlockTimes)}>
                            Tarde
                          </Button>
                          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setQuickBlockTimes(blockTimeOptions)}>
                            Dia inteiro
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-gray-400" onClick={() => setBlockData({ ...blockData, times: [] })}>
                            Limpar
                          </Button>
                        </div>
                      </div>
                      {!blockData.barberId && (
                        <div className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
                          Escolha primeiro o barbeiro para ver apenas horas livres.
                        </div>
                      )}
                      <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1 scrollbar-thin sm:grid-cols-5">
                        {blockTimeOptions.map((time) => {
                          const isAvailable = availableBlockTimes.includes(time);

                          return (
                            <Button
                              key={time}
                              type="button"
                              variant={blockData.times.includes(time) ? "gold" : "outline"}
                              size="sm"
                              className="h-10 text-xs rounded-lg disabled:opacity-30"
                              disabled={!isAvailable}
                              onClick={() => setBlockData({
                                ...blockData,
                                times: blockData.times.includes(time)
                                  ? blockData.times.filter(t => t !== time)
                                  : [...blockData.times, time],
                              })}
                            >
                              {time}
                            </Button>
                          );
                        })}
                      </div>
                      {availableBlockTimes.length === 0 && blockData.barberId && (
                        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                          Não há horas disponíveis para este dia e barbeiro.
                        </div>
                      )}
                    </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-3">
                          <Label className="text-sm font-medium text-gray-300">Nome do Cliente / Nota</Label>
                          <Input value={blockData.name} onChange={(e) => setBlockData({...blockData, name: e.target.value})} className="bg-background/50 border-white/10 h-12 rounded-xl text-white" placeholder="João" />
                        </div>
                        {blockData.isManualBooking && (
                          <div className="space-y-3">
                            <Label className="text-sm font-medium text-gray-300">Telemóvel</Label>
                            <Input value={blockData.phone} onChange={(e) => setBlockData({...blockData, phone: e.target.value})} className="bg-background/50 border-white/10 h-12 rounded-xl text-white" placeholder="912..." />
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                  <div className="border-t border-white/10 bg-card/95 px-5 py-4 sm:px-6">
                    <Button
                      type="button"
                      variant="gold"
                      className="w-full h-12 text-base font-bold rounded-xl"
                      disabled={!blockData.barberId || blockData.times.length === 0 || (blockData.isManualBooking && !blockData.serviceId)}
                      onClick={handleBlockTime}
                    >
                      {blockData.isManualBooking ? "Criar marcação" : "Guardar ausência"}
                    </Button>
                  </div>
                  </DialogContent>
              </Dialog>
            </div>
            
            <div className="rounded-xl border border-white/10 bg-card p-4 md:p-5">
              {isLoadingAppointments ? (
                <div className="flex p-12 justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-xl font-display font-bold text-white">Lista de marcações</h2>
                      <p className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                        <Bell className="h-3.5 w-3.5 text-primary" />
                        {appointmentViewMode === "day"
                          ? "Marcações do dia selecionado, com filtros e ações no detalhe."
                          : "Marcações futuras, com filtros e ações no detalhe."}
                      </p>
                    </div>
                    <span className="w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300">
                      {selectedStatusFilter === "all"
                        ? `${appointmentList.length} registos`
                        : `${filteredAppointmentList.length} de ${appointmentList.length} registos`}
                    </span>
                  </div>

                  {filteredAppointmentList.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-gray-500">
                      {selectedStatusFilter === "all"
                        ? appointmentViewMode === "day" ? "Sem marcações neste dia." : "Sem marcações futuras."
                        : "Sem marcações para este estado."}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-white/10">
                      <div className="hidden grid-cols-[120px_1.2fr_1fr_1fr_130px] gap-4 border-b border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-bold uppercase tracking-widest text-gray-500 md:grid">
                        <span>Quando</span>
                        <span>Cliente</span>
                        <span>Barbeiro</span>
                        <span>Serviço</span>
                        <span className="text-right">Estado</span>
                      </div>
                      <div className="divide-y divide-white/10">
                        {filteredAppointmentList.map((app) => (
                          <button
                            key={app.id}
                            type="button"
                            onClick={() => setSelectedAppointment(app)}
                            className={cn(
                              "grid w-full gap-3 px-4 py-4 text-left transition hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary md:grid-cols-[120px_1.2fr_1fr_1fr_130px] md:items-center md:gap-4",
                              app.status !== "booked" && "opacity-70",
                            )}
                          >
                            <div>
                              <p className="font-display text-xl font-bold text-primary">{format(parseISO(app.startTime), "HH:mm")}</p>
                              <p className="text-xs text-gray-500">{format(parseISO(app.startTime), "dd/MM/yyyy")}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-white">{app.customerName}</p>
                              <p className="truncate text-xs text-gray-400">{app.customerPhone || "Sem telefone"}</p>
                            </div>
                            <p className="truncate text-sm text-gray-300">{getBarberName(app.barberId)}</p>
                            <p className="truncate text-sm text-gray-300">{getServiceName(app.serviceId)}</p>
                            <div className="flex md:justify-end">
                              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", getStatusClass(app.status))}>
                                {getStatusLabel(app.status)}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </TabsContent>

          <TabsContent value="barbers" className="outline-none">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white">Equipa de Barbeiros</h2>
              <Dialog open={isAddingBarber} onOpenChange={setIsAddingBarber}>
                <DialogTrigger asChild>
                  <Button variant="gold" className="gap-2">
                    <Plus className="w-4 h-4" /> Adicionar Barbeiro
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-card border-white/10 text-white w-[95vw] max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Adicionar Membro à Equipa</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div>
                      <Label>Nome *</Label>
                      <Input 
                        value={barberFormData.name} 
                        onChange={e => setBarberFormData({...barberFormData, name: e.target.value})} 
                        className="bg-background border-white/10 text-white" 
                        required
                      />
                    </div>
                    <div>
                      <Label>Especialidade *</Label>
                      <Input 
                        value={barberFormData.specialty} 
                        onChange={e => setBarberFormData({...barberFormData, specialty: e.target.value})} 
                        className="bg-background border-white/10 text-white" 
                        required
                      />
                    </div>
                    <div>
                      <Label>Email (para login)</Label>
                      <Input 
                        type="email"
                        value={barberFormData.email} 
                        onChange={e => setBarberFormData({...barberFormData, email: e.target.value})} 
                        className="bg-background border-white/10 text-white" 
                      />
                    </div>
                    <div>
                      <Label>Bio</Label>
                      <Input 
                        value={barberFormData.bio} 
                        onChange={e => setBarberFormData({...barberFormData, bio: e.target.value})} 
                        className="bg-background border-white/10 text-white" 
                      />
                    </div>
                    <BarberColorField
                      value={barberFormData.color}
                      onChange={(color) => setBarberFormData({ ...barberFormData, color })}
                    />
                    <BarberPhotoPicker
                      inputId="new-barber-photo"
                      value={barberFormData.avatar}
                      fallbackSrc={getBarberAvatar({ name: barberFormData.name, avatar: null })}
                      onChange={(avatar) => setBarberFormData({ ...barberFormData, avatar })}
                      onRemove={() => setBarberFormData({ ...barberFormData, avatar: "" })}
                      toast={toast}
                    />
                    <BarberServicesPicker
                      services={services}
                      selectedServiceIds={getEffectiveServiceSelection(barberFormData.serviceIds, services)}
                      onChange={(serviceIds) => setBarberFormData({
                        ...barberFormData,
                        serviceIds: normalizeServiceSelection(serviceIds, getAllServiceIds(services)),
                      })}
                    />
                    <Button 
                      variant="gold" 
                      className="w-full" 
                      onClick={handleAddBarber}
                    >
                      Criar Barbeiro
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {barbers?.map(barber => (
                <Card key={barber.id} className="bg-card border-white/10 overflow-hidden text-white">
                  <div className="aspect-square bg-muted relative">
                    <img src={getBarberAvatar(barber)} className="w-full h-full object-cover" />
                    <ConfirmAction
                      title={`Remover ${barber.name}?`}
                      description="O barbeiro só será removido se não tiver marcações associadas."
                      confirmLabel="Remover"
                      confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onConfirm={async () => {
                        try {
                          await apiRequest("DELETE", `/api/barbers/${barber.id}`);
                          await refreshBarbersCache();
                          toast({ title: "Sucesso", description: "Barbeiro removido." });
                        } catch (err: any) {
                          toast({ title: "Erro", description: err.message || "Não foi possível remover o barbeiro.", variant: "destructive" });
                        }
                      }}
                    >
                      <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-8 w-8">
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </ConfirmAction>
                  </div>
                  <CardContent className="p-4">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: normalizeBarberColor(barber.color) }} />
                      <h3 className="font-bold text-lg">{barber.name}</h3>
                    </div>
                    <p className="text-sm text-primary mb-2">{barber.specialty}</p>
                    <p className="mb-3 line-clamp-2 text-xs text-gray-400">
                      {formatBarberServicesSummary(barber, services)}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="flex-1 h-8 text-xs">Editar</Button>
                        </DialogTrigger>
                        <DialogContent className="bg-card border-white/10 text-white w-[95vw] max-h-[90vh] overflow-y-auto">
                          <DialogHeader><DialogTitle>Editar Barbeiro</DialogTitle></DialogHeader>
                          <div className="space-y-4 pt-4">
                            <div><Label>Nome</Label><Input defaultValue={barber.name} id={`edit-barber-name-${barber.id}`} className="bg-background border-white/10" /></div>
                            <div><Label>Especialidade</Label><Input defaultValue={barber.specialty} id={`edit-barber-spec-${barber.id}`} className="bg-background border-white/10" /></div>
                            <div className="space-y-2">
                              <Label>Cor na agenda</Label>
                              <Input type="color" defaultValue={normalizeBarberColor(barber.color)} id={`edit-barber-color-${barber.id}`} className="h-10 w-20 bg-background border-white/10 p-1" />
                            </div>
                            <BarberPhotoPicker
                              inputId={`edit-barber-photo-${barber.id}`}
                              value={getEditedBarberAvatar(barberAvatarDrafts, barber)}
                              fallbackSrc={getBarberAvatar({ ...barber, avatar: null })}
                              onChange={(avatar) => setBarberAvatarDrafts((current) => ({ ...current, [barber.id]: avatar }))}
                              onRemove={() => setBarberAvatarDrafts((current) => ({ ...current, [barber.id]: null }))}
                              toast={toast}
                            />
                            <BarberServicesPicker
                              services={services}
                              selectedServiceIds={getEffectiveServiceSelection(
                                Object.prototype.hasOwnProperty.call(barberServiceDrafts, barber.id)
                                  ? barberServiceDrafts[barber.id]
                                  : barber.serviceIds,
                                services,
                              )}
                              onChange={(serviceIds) => setBarberServiceDrafts((current) => ({
                                ...current,
                                [barber.id]: normalizeServiceSelection(serviceIds, getAllServiceIds(services)),
                              }))}
                            />
                            <Button variant="gold" className="w-full" onClick={async () => {
                              const name = (document.getElementById(`edit-barber-name-${barber.id}`) as HTMLInputElement).value;
                              const specialty = (document.getElementById(`edit-barber-spec-${barber.id}`) as HTMLInputElement).value;
                              const color = (document.getElementById(`edit-barber-color-${barber.id}`) as HTMLInputElement).value;
                              const avatar = getEditedBarberAvatar(barberAvatarDrafts, barber);
                              const selectedServiceIds = getEffectiveServiceSelection(
                                Object.prototype.hasOwnProperty.call(barberServiceDrafts, barber.id)
                                  ? barberServiceDrafts[barber.id]
                                  : barber.serviceIds,
                                services,
                              );
                              const response = await apiRequest("PATCH", `/api/barbers/${barber.id}`, {
                                name,
                                specialty,
                                color: normalizeBarberColor(color),
                                avatar: avatar || null,
                                serviceIds: normalizeServiceSelection(selectedServiceIds, getAllServiceIds(services)),
                              });
                              const updatedBarber = await response.json();
                              await refreshBarbersCache(updatedBarber);
                              setBarberAvatarDrafts((current) => {
                                const next = { ...current };
                                delete next[barber.id];
                                return next;
                              });
                              setBarberServiceDrafts((current) => {
                                const next = { ...current };
                                delete next[barber.id];
                                return next;
                              });
                              toast({ title: "Sucesso", description: "Barbeiro atualizado." });
                            }}>Guardar</Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-xs"
                        onClick={() => openExceptionDialog(String(barber.id))}
                      >
                        Ausências
                      </Button>
                      <ConfirmAction
                        title={`Criar convite para ${barber.name}?`}
                        description="A palavra-passe atual deixa de funcionar até o barbeiro aceitar o novo convite."
                        confirmLabel="Criar convite"
                        confirmClassName="bg-primary text-primary-foreground hover:bg-primary/90"
                        onConfirm={() => handleCreateBarberInvite(barber)}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 h-8 text-[10px] border-red-500/20 text-red-400 hover:bg-red-500/10"
                        >
                          <Copy className="mr-1 h-3 w-3" /> Convite
                        </Button>
                      </ConfirmAction>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-[10px] text-gray-400 border-white/5"
                        onClick={async () => {
                          try {
                            const response = await apiRequest("PATCH", `/api/barbers/${barber.id}`, { isVisible: !barber.isVisible });
                            const updatedBarber = await response.json();
                            await refreshBarbersCache(updatedBarber);
                            toast({
                              title: "Sucesso",
                              description: barber.isVisible ? "Barbeiro ocultado." : "Barbeiro visível no site.",
                            });
                          } catch (err: any) {
                            toast({
                              title: "Erro",
                              description: err.message || "Não foi possível atualizar a visibilidade do barbeiro.",
                              variant: "destructive",
                            });
                          }
                        }}
                      >
                        {barber.isVisible ? "Visível" : "Oculto"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="blacklist" className="outline-none">
            <Card className="bg-card border-white/10 text-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-400">
                  <User className="w-5 h-5" /> Clientes Bloqueados
                </CardTitle>
                <p className="text-sm text-gray-400">Clientes nesta lista não conseguirão fazer marcações online através do site.</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-white/5 rounded-xl border border-white/10">
                    <div className="space-y-2">
                      <Label className="text-xs">Telemóvel (obrigatório)</Label>
                      <Input
                        id="bl-phone"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        maxLength={18}
                        className="bg-background border-white/10"
                        placeholder="912345678"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Email (opcional)</Label>
                      <Input
                        id="bl-email"
                        type="email"
                        autoComplete="email"
                        className="bg-background border-white/10"
                        placeholder="cliente@email.com"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button variant="destructive" className="w-full" onClick={async () => {
                        const phoneInput = document.getElementById("bl-phone") as HTMLInputElement;
                        const emailInput = document.getElementById("bl-email") as HTMLInputElement;
                        const phone = phoneInput.value;
                        const email = emailInput.value;
                        const normalizedPhone = normalizePortuguesePhone(phone);
                        const normalizedEmail = normalizeEmail(email);

                        if (!phone.trim()) {
                          toast({ title: "Erro", description: "O telemóvel é obrigatório.", variant: "destructive" });
                          return;
                        }

                        if (!isValidPortugueseMobile(phone)) {
                          toast({ title: "Telemóvel inválido", description: phoneValidationMessage, variant: "destructive" });
                          return;
                        }

                        if (!isValidOptionalEmail(email)) {
                          toast({ title: "Email inválido", description: emailValidationMessage, variant: "destructive" });
                          return;
                        }

                        await apiRequest("POST", "/api/admin/blacklist", {
                          phone: normalizedPhone,
                          email: normalizedEmail || undefined,
                          reason: "Bloqueio manual pelo administrador",
                        });
                        queryClient.invalidateQueries({ queryKey: ["/api/admin/blacklist"] });
                        phoneInput.value = "";
                        emailInput.value = "";
                        toast({ title: "Sucesso", description: "Cliente adicionado à lista de bloqueio." });
                      }}>Bloquear Cliente</Button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-white/5 uppercase text-xs font-bold text-gray-400">
                        <tr>
                          <th className="px-6 py-4">Telemóvel</th>
                          <th className="px-6 py-4">Email</th>
                          <th className="px-6 py-4">Data do bloqueio</th>
                          <th className="px-6 py-4 text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {blacklistEntries?.map((entry: any) => (
                          <tr key={entry.id} className="hover:bg-white/5">
                            <td className="px-6 py-4 font-mono">{entry.phone}</td>
                            <td className="px-6 py-4">{entry.email || "-"}</td>
                            <td className="px-6 py-4 text-gray-400">{format(parseISO(entry.createdAt), "dd/MM/yyyy")}</td>
                            <td className="px-6 py-4 text-right">
                              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white" onClick={async () => {
                                try {
                                  await apiRequest("DELETE", `/api/admin/blacklist/${entry.id}`);
                                  queryClient.invalidateQueries({ queryKey: ["/api/admin/blacklist"] });
                                  toast({ title: "Sucesso", description: "Cliente removido da lista de bloqueio." });
                                } catch (err: any) {
                                  toast({ title: "Erro", description: err.message || "Não foi possível remover o cliente da lista de bloqueio.", variant: "destructive" });
                                }
                              }}>Remover</Button>
                            </td>
                          </tr>
                        ))}
                        {(!blacklistEntries || blacklistEntries.length === 0) && (
                          <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-500 italic">Nenhum cliente bloqueado.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="services" className="outline-none">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <h2 className="text-xl font-bold text-white">Serviços Disponíveis</h2>
              <Dialog open={isAddingService} onOpenChange={setIsAddingService}>
                <DialogTrigger asChild>
                  <Button variant="gold" className="gap-2">
                    <Plus className="w-4 h-4" /> Adicionar Serviço
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-card border-white/10 text-white">
                  <DialogHeader>
                    <DialogTitle>Novo Serviço</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div>
                      <Label>Nome *</Label>
                      <Input 
                        value={serviceFormData.name} 
                        onChange={e => setServiceFormData({...serviceFormData, name: e.target.value})} 
                        className="bg-background border-white/10 text-white" 
                        required
                      />
                    </div>
                    <div>
                      <Label>Descrição</Label>
                      <Input 
                        value={serviceFormData.description} 
                        onChange={e => setServiceFormData({...serviceFormData, description: e.target.value})} 
                        className="bg-background border-white/10 text-white" 
                      />
                    </div>
                    <div>
                      <Label>Preço (€) *</Label>
                      <Input 
                        type="number" 
                        step="0.01" 
                        value={serviceFormData.price / 100} 
                        onChange={e => setServiceFormData({...serviceFormData, price: Math.round(Number(e.target.value) * 100)})} 
                        className="bg-background border-white/10 text-white" 
                        required
                      />
                    </div>
                    <div>
                      <Label>Duração (Min) *</Label>
                      <Input 
                        type="number" 
                        value={serviceFormData.duration} 
                        onChange={e => setServiceFormData({...serviceFormData, duration: Number(e.target.value)})} 
                        className="bg-background border-white/10 text-white" 
                        required
                      />
                    </div>
                    <Button 
                      variant="gold" 
                      className="w-full" 
                      onClick={handleAddService}
                    >
                      Criar Serviço
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services?.map(service => (
                <Card key={service.id} className="bg-card border-white/10 text-white">
                  <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-lg font-bold">{service.name}</CardTitle><span className="text-primary font-bold">{(service.price / 100).toFixed(2)}€</span></CardHeader>
                  <CardContent><p className="text-sm text-gray-400 mb-4">{service.duration} min</p>
                    <div className="flex flex-wrap gap-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="flex-1 h-8 text-xs">Editar</Button>
                        </DialogTrigger>
                        <DialogContent className="bg-card border-white/10 text-white">
                          <DialogHeader><DialogTitle>Editar Serviço</DialogTitle></DialogHeader>
                          <div className="space-y-4 pt-4">
                            <div><Label>Nome</Label><Input defaultValue={service.name} id={`edit-service-name-${service.id}`} className="bg-background border-white/10" /></div>
                            <div><Label>Descrição</Label><Textarea defaultValue={service.description || ""} id={`edit-service-desc-${service.id}`} className="bg-background border-white/10" /></div>
                            <div><Label>Preço (€)</Label><Input type="number" step="0.01" defaultValue={service.price / 100} id={`edit-service-price-${service.id}`} className="bg-background border-white/10" /></div>
                            <div><Label>Duração (Min)</Label><Input type="number" defaultValue={service.duration} id={`edit-service-dur-${service.id}`} className="bg-background border-white/10" /></div>
                            <Button variant="gold" className="w-full" onClick={async () => {
                              const name = (document.getElementById(`edit-service-name-${service.id}`) as HTMLInputElement).value;
                              const description = (document.getElementById(`edit-service-desc-${service.id}`) as HTMLTextAreaElement).value;
                              const price = Math.round(Number((document.getElementById(`edit-service-price-${service.id}`) as HTMLInputElement).value) * 100);
                              const duration = Number((document.getElementById(`edit-service-dur-${service.id}`) as HTMLInputElement).value);
                              await apiRequest("PATCH", `/api/services/${service.id}`, { name, description, price, duration });
                              queryClient.invalidateQueries({ queryKey: ["/api/services"] });
                              toast({ title: "Sucesso", description: "Serviço atualizado." });
                            }}>Guardar</Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                      <ConfirmAction
                        title={`Remover ${service.name}?`}
                        description="As marcações antigas ficam guardadas, mas este serviço deixa de estar disponível."
                        confirmLabel="Remover"
                        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onConfirm={async () => {
                          try {
                            await apiRequest("DELETE", `/api/services/${service.id}`);
                            queryClient.invalidateQueries({ queryKey: ["/api/services"] });
                            toast({ title: "Sucesso", description: "Serviço removido." });
                          } catch {
                            toast({ title: "Erro", description: "Não foi possível remover o serviço. Verifique se existem marcações associadas.", variant: "destructive" });
                          }
                        }}
                      >
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-400">
                          Remover
                        </Button>
                      </ConfirmAction>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-[10px] text-gray-400 border-white/5"
                        onClick={async () => {
                          try {
                            await apiRequest("PATCH", `/api/services/${service.id}`, { isVisible: !service.isVisible });
                            queryClient.invalidateQueries({ queryKey: ["/api/services"] });
                            toast({
                              title: "Sucesso",
                              description: service.isVisible ? "Serviço ocultado." : "Serviço visível no site.",
                            });
                          } catch (err: any) {
                            toast({
                              title: "Erro",
                              description: err.message || "Não foi possível atualizar a visibilidade do serviço.",
                              variant: "destructive",
                            });
                          }
                        }}
                      >
                        {service.isVisible ? "Visível" : "Oculto"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="settings" className="outline-none">
            <Card className="bg-card border-white/10 text-white">
              <CardHeader className="border-b border-white/10 pb-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-xl font-bold">
                      <CalendarIcon className="h-5 w-5 text-primary" /> Horário base da barbearia
                    </CardTitle>
                    <p className="mt-2 max-w-2xl text-sm text-gray-400">
                      Este horário define quando a loja aceita marcações. Ausências, férias e ajustes pontuais continuam nas ausências de cada barbeiro.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      variant="outline"
                      className="gap-2 border-white/10"
                      onClick={() => openExceptionDialog()}
                    >
                      <Plus className="h-4 w-4" /> Criar ausência
                    </Button>
                    <Button
                      variant="gold"
                      className="gap-2"
                      disabled={isSavingShopAvailability || shopAvailabilityIssues.length > 0}
                      onClick={handleSaveShopAvailability}
                    >
                      {isSavingShopAvailability ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                      {isSavingShopAvailability ? "A guardar..." : "Guardar horário"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4 md:p-5">
                <div className="rounded-xl border border-white/10 bg-background/40 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    <h3 className="font-bold text-white">Resumo semanal</h3>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {weekDays.map((day) => (
                      <div key={day.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
                        <span className="text-sm font-medium text-white">{day.short}</span>
                        <span className={cn("text-right text-xs", shopAvailabilityForm[day.id]?.isWorking ? "text-gray-300" : "text-gray-500")}>
                          {formatAvailabilitySummary(shopAvailabilityForm[day.id])}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {shopAvailabilityIssues.length > 0 && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                    <div className="mb-2 flex items-center gap-2 font-bold">
                      <AlertTriangle className="h-4 w-4" /> Verifique o horário antes de guardar
                    </div>
                    <ul className="space-y-1">
                      {shopAvailabilityIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid gap-3 xl:grid-cols-2">
                  {weekDays.map((day) => {
                    const dayConfig = shopAvailabilityForm[day.id];
                    const isWorking = dayConfig?.isWorking || false;
                    return (
                      <div
                        key={day.id}
                        className={cn(
                          "rounded-xl border border-white/10 p-4 transition-colors",
                          isWorking ? "bg-card hover:bg-white/[0.03]" : "bg-background/30",
                        )}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-sm font-bold",
                              isWorking ? "border-primary/30 bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-gray-500",
                            )}>
                              {day.short}
                            </div>
                            <div>
                              <Label className="font-bold text-white">{day.label}</Label>
                              <p className={cn("mt-1 text-xs", isWorking ? "text-gray-400" : "text-gray-500")}>
                                {formatAvailabilitySummary(dayConfig)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-3 md:justify-end">
                            <span className="text-sm text-gray-400">{isWorking ? "Aberta" : "Fechada"}</span>
                            <Switch
                              checked={isWorking}
                              onCheckedChange={(checked) => updateShopDay(day.id, (current) => ({
                                ...current,
                                isWorking: checked,
                              }))}
                            />
                          </div>
                        </div>

                        {isWorking ? (
                          <div className="mt-4 space-y-2">
                            {dayConfig.periods.map((period, index) => (
                              <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] items-end gap-2 sm:max-w-xl">
                                <div className="min-w-0">
                                  <Label className="text-[11px] text-gray-400">Abre</Label>
                                  <Input
                                    type="time"
                                    value={period.startTime}
                                    onChange={(e) => updateShopPeriod(day.id, index, { startTime: e.target.value })}
                                    className="h-10 w-full bg-background border-white/10 px-2 text-white"
                                  />
                                </div>
                                <div className="min-w-0">
                                  <Label className="text-[11px] text-gray-400">Fecha</Label>
                                  <Input
                                    type="time"
                                    value={period.endTime}
                                    onChange={(e) => updateShopPeriod(day.id, index, { endTime: e.target.value })}
                                    className="h-10 w-full bg-background border-white/10 px-2 text-white"
                                  />
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-10 w-10 text-red-400 hover:text-red-300"
                                  disabled={dayConfig.periods.length === 1}
                                  aria-label={`Remover período de ${day.label}`}
                                  onClick={() => updateShopDay(day.id, (current) => ({
                                    ...current,
                                    periods: current.periods.filter((_, periodIndex) => periodIndex !== index),
                                  }))}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-9 gap-2 border-white/10 text-xs"
                              onClick={() => updateShopDay(day.id, (current) => ({
                                ...current,
                                periods: [...current.periods, { startTime: "14:00", endTime: "18:00" }],
                              }))}
                            >
                              <Plus className="h-3.5 w-3.5" /> Adicionar período
                            </Button>
                          </div>
                        ) : (
                          <div className="mt-4 rounded-lg border border-dashed border-white/10 px-3 py-3 text-sm text-gray-500">
                            Loja fechada neste dia.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <Button
                  variant="gold"
                  className="w-full gap-2 md:hidden"
                  disabled={isSavingShopAvailability || shopAvailabilityIssues.length > 0}
                  onClick={handleSaveShopAvailability}
                >
                  {isSavingShopAvailability ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  {isSavingShopAvailability ? "A guardar..." : "Guardar horário"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports" className="outline-none">
            <Card className="bg-card border-white/10 max-w-2xl mx-auto">
              <CardHeader>
                <CardTitle className="text-xl font-display font-bold text-primary">Exportar Relatório Excel</CardTitle>
                <p className="text-gray-400 text-sm">Gere um ficheiro .xlsx com o resumo e detalhes das marcações concluídas.</p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-white">Data Início</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start border-white/10 bg-background text-white h-11">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {format(exportDates.start, "dd/MM/yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 bg-card border-white/10">
                        <Calendar mode="single" selected={exportDates.start} onSelect={(d) => d && setExportDates({...exportDates, start: d})} locale={pt} initialFocus />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white">Data Fim</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start border-white/10 bg-background text-white h-11">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {format(exportDates.end, "dd/MM/yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 bg-card border-white/10">
                        <Calendar mode="single" selected={exportDates.end} onSelect={(d) => d && setExportDates({...exportDates, end: d})} locale={pt} initialFocus />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-white">Barbeiro</Label>
                  <Select value={exportDates.barberId} onValueChange={(v) => setExportDates({...exportDates, barberId: v})}>
                    <SelectTrigger className="border-white/10 bg-background text-white h-11">
                      <SelectValue placeholder="Selecione o barbeiro" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-white/10 text-white">
                      <SelectItem value="all">Todos os Barbeiros</SelectItem>
                      {barbers?.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <Button variant="gold" className="w-full h-12 text-base font-bold gap-2" onClick={handleExport} disabled={isExporting}>
                  {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileDown className="w-5 h-5" />}
                  Gerar Relatório Excel
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
