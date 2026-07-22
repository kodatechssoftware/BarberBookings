import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import { type AppointmentStatus, useAppointments, useUpdateAppointmentStatus } from "@/hooks/use-appointments";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, startOfToday, subDays } from "date-fns";
import { pt } from "date-fns/locale";
import { Loader2, CheckCircle, XCircle, Plus, Calendar as CalendarIcon, Clock, User, LogOut, Scissors, Users, FileDown, Copy, TrendingUp, Euro, AlertTriangle, Upload, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { useBarbers, useShopAvailability } from "@/hooks/use-barbers";
import { useServices } from "@/hooks/use-services";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import { AppointmentsTab, blockTimeOptions, outsideHoursBlockTimeOptions, type AppointmentBlockData, type AppointmentStatusFilter, type AppointmentViewMode } from "@/components/admin/AppointmentsTab";
import { AppointmentBlockDialog } from "@/components/admin/AppointmentBlockDialog";
import { AppointmentDetailsDialog } from "@/components/admin/AppointmentDetailsDialog";
import { getAppointmentContactLinks, WeeklyAgenda } from "@/components/admin/WeeklyAgenda";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { API_UNAUTHORIZED_EVENT, apiFetch } from "@/lib/api";
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
  normalizeEmail,
} from "@shared/customer-validation";
import {
  PHONE_COUNTRIES,
  formatPhoneForDisplay,
  formatPhoneInput,
  getPhoneCountry,
  normalizeSupportedPhone,
  splitStoredPhone,
  supportedPhoneValidationMessage,
  supportedPhonesMatch,
  toStoredPhone,
  type PhoneCountryCode,
} from "@shared/phone-countries";
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

function normalizeManualBookingPhoneForSubmit(phone: string) {
  return normalizeSupportedPhone(phone) || phone.trim() || "900000000";
}

type FutureBlacklistAppointment = {
  id: number;
  barberId: number;
  barberName: string;
  serviceId: number | null;
  serviceName: string;
  startTime: string;
  durationMinutes: number;
  customerName: string;
  customerPhone: string;
};
type PendingBlacklistAction = {
  phone: string;
  email?: string;
  reason: string;
  futureAppointments: FutureBlacklistAppointment[];
};
type PendingManualBookingBlacklistWarning = {
  entryId: number;
  phone: string;
};
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

type AuditLogItem = {
  id: number;
  actorType: string;
  actorId?: number | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  summary: string;
  metadata?: string | null;
  createdAt: string;
};

const currencyFormatter = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
});

function formatCents(value: number) {
  return currencyFormatter.format((value || 0) / 100);
}

function isOperationalAdminAppointment(appointment: AdminAppointment) {
  const name = appointment.customerName.trim().toUpperCase();
  return ![
    "BLOQUEIO MANUAL",
    "AUSÊNCIA",
    "AUSENCIA",
    "FÉRIAS",
    "FERIAS",
  ].some((marker) => name.includes(marker)) && !name.startsWith("RECORRENTE:");
}

function getAdminAppointmentEnd(appointment: AdminAppointment) {
  const start = parseISO(appointment.startTime);
  return new Date(start.getTime() + Math.max(15, appointment.durationMinutes || 30) * 60000);
}

function getAdminAppointmentDurationMinutes(
  appointment: Pick<AdminAppointment, "serviceId" | "durationMinutes">,
  services?: Array<{ id: number; duration?: number | null }>,
) {
  const serviceDuration = appointment.serviceId
    ? services?.find((service) => service.id === appointment.serviceId)?.duration
    : undefined;
  const storedDuration = appointment.durationMinutes;

  if (typeof storedDuration !== "number" || !Number.isFinite(storedDuration) || storedDuration <= 0) {
    return serviceDuration || 30;
  }

  if (appointment.serviceId && storedDuration === 30 && serviceDuration && serviceDuration !== 30) {
    return serviceDuration;
  }

  return storedDuration;
}

function hasAdminAppointmentConflict({
  appointments,
  barberId,
  date,
  time,
  duration,
  services,
}: {
  appointments: AdminAppointment[];
  barberId: number;
  date: Date;
  time: string;
  duration: number;
  services?: Array<{ id: number; duration?: number | null }>;
}) {
  const [hours, minutes] = time.split(":").map(Number);
  const start = new Date(date);
  start.setHours(hours, minutes, 0, 0);
  const end = new Date(start.getTime() + duration * 60000);

  return appointments.some((appointment) => {
    if (appointment.barberId !== barberId || appointment.status !== "booked") return false;

    const appointmentStart = parseISO(appointment.startTime);
    const appointmentDuration = getAdminAppointmentDurationMinutes(appointment, services);
    const appointmentEnd = new Date(appointmentStart.getTime() + appointmentDuration * 60000);

    return start < appointmentEnd && end > appointmentStart;
  });
}

function getAppointmentServicePriceCents(
  appointment: AdminAppointment,
  services?: Array<{ id: number; price?: number | null }>,
) {
  if (!appointment.serviceId) return 0;
  return services?.find((service) => service.id === appointment.serviceId)?.price || 0;
}

function formatAuditTimestamp(value: string) {
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "dd/MM HH:mm", { locale: pt });
}

const auditActionLabels: Record<string, string> = {
  "appointment.created_online": "Marcação criada pelo site",
  "appointment.created_manual": "Marcação manual criada",
  "appointment.absence_created": "Ausência criada na agenda",
  "appointment.updated": "Marcação alterada",
  "appointment.status_changed": "Estado da marcação alterado",
  "barber.created": "Barbeiro criado",
  "barber.updated": "Barbeiro atualizado",
  "barber.services_updated": "Serviços do barbeiro atualizados",
  "barber.deleted": "Barbeiro removido",
  "barber.password_reset": "Acesso do barbeiro reposto",
  "barber.invite_created": "Convite enviado ao barbeiro",
  "service.created": "Serviço criado",
  "service.updated": "Serviço atualizado",
  "service.deleted": "Serviço removido",
  "shop_availability.updated": "Horário da barbearia atualizado",
  "barber_availability.updated": "Horário do barbeiro atualizado",
  "customer.blocked": "Cliente bloqueado",
  "customer.unblocked": "Cliente desbloqueado",
  "customer_note.updated": "Notas do cliente atualizadas",
};

function getAuditActionLabel(action: string) {
  return auditActionLabels[action] || "Atividade registada";
}

function getAuditActorLabel(log: AuditLogItem) {
  if (log.actorType === "admin") return log.actorName || "Administrador";
  if (log.actorType === "barber") return log.actorName ? `Barbeiro: ${log.actorName}` : "Barbeiro";
  if (log.actorType === "customer") return log.actorName ? `Cliente: ${log.actorName}` : "Cliente";
  return log.actorName || "Sistema";
}

const adminTabTriggerClass = "h-10 shrink-0 gap-2 whitespace-nowrap px-3 text-white data-[state=active]:text-primary";

function AuditLogPanel({
  logs,
  isLoading,
}: {
  logs?: AuditLogItem[];
  isLoading: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const latestLogs = (logs || []).slice(0, 6);
  const toggleLabel = isExpanded ? "Ocultar atividade recente" : "Mostrar atividade recente";

  return (
    <Card className="border-white/10 bg-card text-white">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base font-bold">Atividade recente</CardTitle>
            <p className="mt-1 text-sm text-gray-400">
              Histórico interno das alterações. Abra apenas quando precisar de confirmar o que aconteceu.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-2 border-white/10 sm:w-auto"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((current) => !current)}
          >
            <Clock className="h-4 w-4" />
            {toggleLabel}
          </Button>
        </div>
      </CardHeader>
      {isExpanded && (
        <CardContent>
          {isLoading ? (
            <div className="flex min-h-[120px] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : latestLogs.length > 0 ? (
            <div className="space-y-2">
              {latestLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex flex-col gap-2 rounded-lg border border-white/10 bg-background/60 p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{log.summary}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {getAuditActorLabel(log)} · {getAuditActionLabel(log.action)}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-gray-500">
                    {formatAuditTimestamp(log.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center">
              <Clock className="mx-auto h-5 w-5 text-gray-600" />
              <p className="mt-3 text-sm font-semibold text-white">Ainda sem atividade registada</p>
              <p className="mt-1 text-sm text-gray-500">
                As próximas alterações feitas na gestão aparecem aqui automaticamente.
              </p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

type TodaySummary = {
  total: number;
  delayed: number;
  probableNoShows: number;
  projectedRevenueCents: number;
  nextAppointment: AdminAppointment | null;
};

function TodayOverviewPanel({
  summary,
  getBarberName,
  getServiceName,
}: {
  summary: TodaySummary;
  getBarberName: (id: number) => string;
  getServiceName: (id?: number | null) => string;
}) {
  const next = summary.nextAppointment;
  const nextStart = next ? parseISO(next.startTime) : null;

  return (
    <Card className="border-white/10 bg-card text-white">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-primary">Hoje</p>
            <CardTitle className="text-xl font-bold">Resumo do dia</CardTitle>
          </div>
          <p className="text-sm text-gray-400">{format(startOfToday(), "dd 'de' MMMM", { locale: pt })}</p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
        <div className="rounded-xl border border-white/10 bg-background/60 p-3">
          <p className="text-xs uppercase tracking-widest text-gray-500">Próxima marcação</p>
          {next && nextStart ? (
            <div className="mt-2 min-w-0">
              <p className="truncate text-lg font-bold text-white">{next.customerName}</p>
              <p className="mt-1 text-sm text-primary">{format(nextStart, "HH:mm")} · {getServiceName(next.serviceId)}</p>
              <p className="mt-1 truncate text-xs text-gray-400">{getBarberName(next.barberId)}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm font-semibold text-gray-400">Sem próximas marcações hoje</p>
          )}
        </div>
        {[
          { label: "Total do dia", value: String(summary.total), tone: "text-white" },
          { label: "Atrasadas", value: String(summary.delayed), tone: summary.delayed ? "text-orange-300" : "text-gray-300" },
          { label: "Faltas prováveis", value: String(summary.probableNoShows), tone: summary.probableNoShows ? "text-rose-300" : "text-gray-300" },
          { label: "Receita prevista", value: formatCents(summary.projectedRevenueCents), tone: "text-primary" },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-white/10 bg-background/60 p-3">
            <p className="text-xs uppercase tracking-widest text-gray-500">{item.label}</p>
            <p className={cn("mt-2 text-xl font-bold", item.tone)}>{item.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SimpleBusinessDashboard({ data }: { data: DashboardData }) {
  const busiestBarber = [...data.barbers].sort((a, b) => b.booked - a.booked)[0];
  const topServices = data.services.slice(0, 5);
  const noShowsByMonth = Array.from(
    data.daily.reduce((map, day) => {
      const monthKey = day.date.slice(0, 7);
      const current = map.get(monthKey) || 0;
      map.set(monthKey, current + day.noShows);
      return map;
    }, new Map<string, number>()),
  ).map(([month, noShows]) => ({
    month,
    label: format(parseISO(`${month}-01`), "MMM yyyy", { locale: pt }),
    noShows,
  }));

  return (
    <Card className="border-white/10 bg-card text-white">
      <CardHeader>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-xl font-bold">Dashboard simples</CardTitle>
            <p className="mt-1 text-sm text-gray-400">Receita, procura e faltas sem ruído.</p>
          </div>
          <span className="w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300">
            Últimos {data.range.days} dias
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-background/60 p-4">
            <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-gray-500">
              <Euro className="h-4 w-4 text-green-300" /> Receita concluída
            </p>
            <p className="mt-2 text-2xl font-bold text-white">{formatCents(data.summary.revenueCents)}</p>
            <p className="mt-1 text-xs text-gray-400">{data.summary.completed} serviços concluídos</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-background/60 p-4">
            <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-gray-500">
              <TrendingUp className="h-4 w-4 text-primary" /> Receita prevista
            </p>
            <p className="mt-2 text-2xl font-bold text-primary">{formatCents(data.summary.projectedRevenueCents)}</p>
            <p className="mt-1 text-xs text-gray-400">{data.summary.booked} marcações ativas</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-background/60 p-4">
            <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-gray-500">
              <Users className="h-4 w-4 text-blue-300" /> Barbeiro mais ocupado
            </p>
            <p className="mt-2 truncate text-xl font-bold text-white">{busiestBarber?.name || "Sem dados"}</p>
            <p className="mt-1 text-xs text-gray-400">{busiestBarber ? `${busiestBarber.booked} marca\u00e7\u00f5es ativas` : "Ainda sem marca\u00e7\u00f5es"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-background/60 p-4">
            <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-gray-500">
              <AlertTriangle className="h-4 w-4 text-rose-300" /> Faltas no período
            </p>
            <p className="mt-2 text-2xl font-bold text-rose-300">{data.summary.noShows}</p>
            <p className="mt-1 text-xs text-gray-400">{data.summary.noShowRate}% de risco registado</p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="rounded-xl border border-white/10 bg-background/60 p-4">
            <div className="mb-4 flex items-center gap-2">
              <Scissors className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-white">Serviços mais pedidos</h3>
            </div>
            {topServices.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">Sem dados neste período.</p>
            ) : (
              <div className="space-y-3">
                {topServices.map((service) => {
                  const maxCount = Math.max(...topServices.map((item) => item.count), 1);
                  return (
                    <div key={service.id} className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-medium text-white">{service.name}</span>
                        <span className="shrink-0 text-gray-400">{service.count} marcações</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(8, (service.count / maxCount) * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-background/60 p-4">
            <div className="mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-300" />
              <h3 className="font-semibold text-white">Faltas por mês</h3>
            </div>
            {noShowsByMonth.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">Sem dados neste período.</p>
            ) : (
              <div className="space-y-2">
                {noShowsByMonth.map((item) => (
                  <div key={item.month} className="flex items-center justify-between rounded-lg border border-white/10 bg-card px-3 py-2">
                    <span className="text-sm text-gray-300">{item.label}</span>
                    <span className={cn("text-sm font-bold", item.noShows ? "text-rose-300" : "text-gray-500")}>
                      {item.noShows}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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

const MAX_BARBER_PHOTO_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_BARBER_PHOTO_OUTPUT_BYTES = 900 * 1024;
const BARBER_PHOTO_MAX_SIDE = 1200;
const BARBER_PHOTO_MIN_SIDE = 360;
const BARBER_PHOTO_RESIZE_FACTOR = 0.82;
const BARBER_PHOTO_QUALITIES = [0.82, 0.74, 0.66, 0.58, 0.5, 0.42];
const SUPPORTED_BARBER_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SUPPORTED_BARBER_PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

function isSupportedBarberPhoto(file: File) {
  const type = file.type.toLowerCase();
  if (SUPPORTED_BARBER_PHOTO_TYPES.has(type)) return true;

  const name = file.name.toLowerCase();
  return SUPPORTED_BARBER_PHOTO_EXTENSIONS.some((extension) => name.endsWith(extension));
}

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

function getDataUrlByteSize(dataUrl: string) {
  const marker = ";base64,";
  const markerIndex = dataUrl.indexOf(marker);
  if (markerIndex === -1) return dataUrl.length;

  const base64 = dataUrl.slice(markerIndex + marker.length);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.ceil((base64.length * 3) / 4) - padding;
}

function renderBarberPhoto(image: HTMLImageElement, maxSide: number, quality: number) {
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, maxSide / originalWidth, maxSide / originalHeight);
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível otimizar a imagem.");

  context.fillStyle = "#111111";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function fileToBarberAvatar(file: File) {
  if (!isSupportedBarberPhoto(file)) {
    throw new Error("Escolha uma imagem JPG, PNG ou WebP.");
  }

  if (file.size > MAX_BARBER_PHOTO_INPUT_BYTES) {
    throw new Error("A imagem deve ter no máximo 25 MB antes de otimizar.");
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);

  for (
    let maxSide = BARBER_PHOTO_MAX_SIDE;
    maxSide >= BARBER_PHOTO_MIN_SIDE;
    maxSide = Math.floor(maxSide * BARBER_PHOTO_RESIZE_FACTOR)
  ) {
    for (const quality of BARBER_PHOTO_QUALITIES) {
      const avatar = renderBarberPhoto(image, maxSide, quality);
      if (getDataUrlByteSize(avatar) <= MAX_BARBER_PHOTO_OUTPUT_BYTES) {
        return avatar;
      }
    }
  }

  throw new Error("Não foi possível reduzir a imagem. Experimente uma foto com menos resolução.");
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
  const inputRef = useRef<HTMLInputElement>(null);

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
            ref={inputRef}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
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
            onClick={() => inputRef.current?.click()}
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
          <p className="w-full text-xs text-gray-400">JPG, PNG ou WebP até 25 MB. A foto é reduzida automaticamente.</p>
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
  agendaLabel?: string | null;
  duration?: number;
  isVisible?: boolean | null;
};

type BarberListItem = {
  id: number;
  name: string;
  specialty?: string | null;
  avatar?: string | null;
  color?: string | null;
  isVisible?: boolean | null;
  serviceIds?: number[] | null;
};

type ServiceMutationResponse = {
  id?: number;
  agendaLabel?: string | null;
} | null;

type ServiceFormData = {
  name: string;
  description: string;
  agendaLabel: string;
  price: number;
  duration: number;
};

const emptyServiceFormData: ServiceFormData = {
  name: "",
  description: "",
  agendaLabel: "",
  price: 0,
  duration: 30,
};

function getAgendaLabelPayload(value?: string | null) {
  const trimmed = (value || "").trim();
  return trimmed ? trimmed : null;
}

async function assertServiceAgendaLabelPersisted(response: Response, expectedAgendaLabel: string | null) {
  const service = await response.json().catch(() => null);
  if (expectedAgendaLabel && service?.agendaLabel !== expectedAgendaLabel) {
    throw new Error("A etiqueta da agenda não ficou gravada. O servidor/API ainda não tem esta alteração ativa.");
  }

  return service;
}

async function rollbackServiceIfAgendaLabelFailed(service: ServiceMutationResponse, expectedAgendaLabel: string | null) {
  if (!expectedAgendaLabel || service?.agendaLabel === expectedAgendaLabel) return;

  if (service?.id) {
    await apiRequest("DELETE", `/api/services/${service.id}`).catch(() => null);
  }

  throw new Error("A etiqueta da agenda não ficou gravada. Reinicie ou atualize o backend e tente novamente.");
}

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

function refreshBarbersCache(updatedBarber?: BarberListCacheItem) {
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

  void queryClient.invalidateQueries({
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

function getFilenameFromContentDisposition(header: string | null) {
  if (!header) return null;

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const fallbackMatch = header.match(/filename="?([^";]+)"?/i);
  return fallbackMatch?.[1] || null;
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
  const sessionExpiryHandledRef = useRef(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isAddingBarber, setIsAddingBarber] = useState(false);
  const [isAddingService, setIsAddingService] = useState(false);
  const [barberFormData, setBarberFormData] = useState({ name: "", specialty: "", bio: "", avatar: "", email: "", color: defaultBarberColor, serviceIds: [] as number[] });
  const [barberAvatarDrafts, setBarberAvatarDrafts] = useState<Record<number, string | null>>({});
  const [barberServiceDrafts, setBarberServiceDrafts] = useState<Record<number, number[]>>({});
  const [savingBarberId, setSavingBarberId] = useState<number | null>(null);
  const [showArchivedBarbers, setShowArchivedBarbers] = useState(false);
  const [barberRemovalCandidate, setBarberRemovalCandidate] = useState<BarberListItem | null>(null);
  const [futureRemovalAppointments, setFutureRemovalAppointments] = useState<AdminAppointment[]>([]);
  const [barberReassignments, setBarberReassignments] = useState<Record<number, string>>({});
  const [isReassigningBarber, setIsReassigningBarber] = useState(false);
  const [serviceFormData, setServiceFormData] = useState<ServiceFormData>(emptyServiceFormData);

  const [selectedDateFilter, setSelectedDateFilter] = useState<Date>(startOfToday());
  const [selectedBarberFilter, setSelectedBarberFilter] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<AppointmentStatusFilter>("all");
  const [selectedAgendaStatusFilter, setSelectedAgendaStatusFilter] = useState<AppointmentStatusFilter>("all");
  const [appointmentViewMode, setAppointmentViewMode] = useState<AppointmentViewMode>("day");
  const [dashboardDays, setDashboardDays] = useState("30");
  const [dashboardBarberFilter, setDashboardBarberFilter] = useState("all");
  const businessDashboardRef = useRef<HTMLDivElement>(null);
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
  const {
    data: barbers,
    isLoading: isLoadingBarbers,
    isFetching: isFetchingBarbers,
    isError: isBarbersError,
  } = useBarbers({ enabled: user?.authorized === true, includeHidden: true });
  const activeBarbers = useMemo(
    () => (barbers || []).filter((barber) => barber.isVisible !== false),
    [barbers],
  );
  const archivedBarbers = useMemo(
    () => (barbers || []).filter((barber) => barber.isVisible === false),
    [barbers],
  );
  const {
    data: services,
    isLoading: isLoadingServices,
    isFetching: isFetchingServices,
    isError: isServicesError,
  } = useServices({ enabled: user?.authorized === true, includeHidden: true });
  const { data: blacklistEntries } = useQuery<any[]>({ 
    queryKey: ["/api/admin/blacklist"],
    enabled: user?.role === "admin"
  });
  const { data: auditLogs, isLoading: isLoadingAuditLogs } = useQuery<AuditLogItem[]>({
    queryKey: ["/api/admin/audit-logs"],
    enabled: user?.role === "admin",
    refetchInterval: 15000,
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
  const keepBusinessDashboardInView = () => {
    window.requestAnimationFrame(() => {
      businessDashboardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const handleDashboardDaysChange = (value: string) => {
    setDashboardDays(value);
    keepBusinessDashboardInView();
  };
  const handleDashboardBarberChange = (value: string) => {
    setDashboardBarberFilter(value);
    keepBusinessDashboardInView();
  };
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
  const agendaAppointmentList = useMemo(() => {
    const list = Array.isArray(weeklyAppointments) ? (weeklyAppointments as AdminAppointment[]) : [];
    return [...list].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [weeklyAppointments]);
  const filteredAgendaAppointmentList = useMemo(() => {
    return agendaAppointmentList.filter((appointment) => {
      const matchesBarber = user?.role === "barber" || selectedBarberFilter === "all" || String(appointment.barberId) === selectedBarberFilter;
      const matchesStatus = selectedAgendaStatusFilter === "all"
        ? appointment.status === "booked"
        : appointment.status === selectedAgendaStatusFilter;
      return matchesBarber && matchesStatus;
    });
  }, [agendaAppointmentList, selectedAgendaStatusFilter, selectedBarberFilter, user?.role]);
  const todaySummary = useMemo<TodaySummary>(() => {
    const now = new Date();
    const todayKey = format(startOfToday(), "yyyy-MM-dd");
    const todayAppointments = agendaAppointmentList.filter((appointment) => {
      const matchesDay = format(parseISO(appointment.startTime), "yyyy-MM-dd") === todayKey;
      const matchesBarber = user?.role === "barber" || selectedBarberFilter === "all" || String(appointment.barberId) === selectedBarberFilter;
      return matchesDay && matchesBarber && isOperationalAdminAppointment(appointment);
    });
    const bookedToday = todayAppointments.filter((appointment) => appointment.status === "booked");
    const nextAppointment = bookedToday.find((appointment) => parseISO(appointment.startTime).getTime() >= now.getTime()) || null;

    return {
      total: todayAppointments.length,
      delayed: bookedToday.filter((appointment) => {
        const start = parseISO(appointment.startTime);
        const end = getAdminAppointmentEnd(appointment);
        return start < now && end >= now;
      }).length,
      probableNoShows: bookedToday.filter((appointment) => getAdminAppointmentEnd(appointment) < now).length,
      projectedRevenueCents: todayAppointments
        .filter((appointment) => appointment.status === "booked" || appointment.status === "completed")
        .reduce((total, appointment) => total + getAppointmentServicePriceCents(appointment, services), 0),
      nextAppointment,
    };
  }, [agendaAppointmentList, selectedBarberFilter, services, user?.role]);
  const selectedAppointmentDetails = useMemo(() => {
    if (!selectedAppointment) return null;
    const candidates = [...agendaAppointmentList, ...appointmentList];
    return candidates.find((appointment) => appointment.id === selectedAppointment.id) || selectedAppointment;
  }, [agendaAppointmentList, appointmentList, selectedAppointment]);
  const updateStatus = useUpdateAppointmentStatus();
  const { toast } = useToast();

  const [isBlocking, setIsBlocking] = useState(false);
  const [blockData, setBlockData] = useState<AppointmentBlockData>({
    barberId: "",
    serviceId: "",
    times: [],
    name: "",
    phone: "900000000",
    date: startOfToday(),
    endDate: startOfToday(),
    isMultiDay: false,
    isManualBooking: false,
    allowOutsideHours: false,
    isRecurring: false,
    recurringWeeks: "2",
    recurringMonths: "6",
  });
  const blockAppointmentDate = format(blockData.date, "yyyy-MM-dd");
  const {
    data: blockAppointments,
  } = useAppointments({
    enabled: user?.authorized === true && Boolean(blockData.barberId),
    date: blockAppointmentDate,
    barberId: blockData.barberId || undefined,
    refetchInterval: 10000,
  });
  const blockAppointmentList = useMemo(
    () => Array.isArray(blockAppointments) ? (blockAppointments as AdminAppointment[]) : [],
    [blockAppointments],
  );
  const hasLoadedBlockAppointments = !blockData.barberId || Array.isArray(blockAppointments);

  const [loginData, setLoginData] = useState({ username: "", password: "" });
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [exportDates, setExportDates] = useState({ 
    start: subDays(startOfToday(), 30), 
    end: startOfToday(),
    barberId: "all"
  });
  const [blacklistForm, setBlacklistForm] = useState({ phone: "", email: "" });
  const blacklistPhoneParts = splitStoredPhone(blacklistForm.phone);
  const blacklistPhoneCountry = getPhoneCountry(blacklistPhoneParts.countryCode);
  const [pendingBlacklistAction, setPendingBlacklistAction] = useState<PendingBlacklistAction | null>(null);
  const [pendingManualBookingBlacklistWarning, setPendingManualBookingBlacklistWarning] = useState<PendingManualBookingBlacklistWarning | null>(null);
  const [isSubmittingBlacklist, setIsSubmittingBlacklist] = useState(false);
  const [isResolvingManualBookingBlacklistWarning, setIsResolvingManualBookingBlacklistWarning] = useState(false);
  const [shopAvailabilityForm, setShopAvailabilityForm] = useState<AvailabilityForm>(() => createDefaultAvailabilityForm());
  const [isSavingShopAvailability, setIsSavingShopAvailability] = useState(false);
  const [customerHistory, setCustomerHistory] = useState<any | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [customerNotes, setCustomerNotes] = useState("");
  const [isSavingCustomerNotes, setIsSavingCustomerNotes] = useState(false);

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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
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
      const payload = {
        ...serviceFormData,
        agendaLabel: getAgendaLabelPayload(serviceFormData.agendaLabel),
      };
      const response = await apiRequest("POST", "/api/services", payload);
      const createdService = await response.json().catch(() => null);
      await rollbackServiceIfAgendaLabelFailed(createdService, payload.agendaLabel);
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
      setIsAddingService(false);
      setServiceFormData(emptyServiceFormData);
      toast({ title: "Sucesso", description: "Serviço adicionado com sucesso." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Erro ao adicionar serviço.", variant: "destructive" });
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      if (exportDates.start > exportDates.end) {
        toast({
          title: "Datas invalidas",
          description: "A data de inicio nao pode ser posterior a data de fim.",
          variant: "destructive",
        });
        return;
      }

      const url = `/api/admin/export?startDate=${format(exportDates.start, 'yyyy-MM-dd')}&endDate=${format(exportDates.end, 'yyyy-MM-dd')}&barberId=${exportDates.barberId}`;
      const response = await apiFetch(url);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.message || "Falha ao gerar o relatorio.");
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = getFilenameFromContentDisposition(response.headers.get("Content-Disposition")) || "Relatorio.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
      toast({ title: "Sucesso", description: "O relatorio foi descarregado." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Falha ao gerar o relatorio.", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const checkAuth = async () => {
    try {
      const res = await apiFetch("/api/admin/me");
      if (res.ok) {
        const data = await res.json();
        sessionExpiryHandledRef.current = false;
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
        sessionExpiryHandledRef.current = false;
        setUser({
          authorized: true,
          role: data.role,
          id: data.id,
          name: data.name,
          email: data.email,
        });
        queryClient.invalidateQueries();
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
    try {
      await apiFetch("/api/admin/logout", { method: "POST" });
    } finally {
      queryClient.clear();
      setSelectedAppointment(null);
      setUser({ authorized: false, role: "" });
    }
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
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

  const openScheduleBlockDialog = (
    mode: "exception" | "manual",
    barberId?: string,
    date?: Date,
    time?: string,
  ) => {
    setBlockData((current) => ({
      ...current,
      barberId: barberId || current.barberId,
      serviceId: "",
      times: time ? [time] : [],
      name: "",
      phone: mode === "manual" ? "" : "900000000",
      date: date || current.date,
      endDate: date || current.endDate,
      isMultiDay: false,
      isManualBooking: mode === "manual",
      allowOutsideHours: false,
      isRecurring: false,
    }));
    setIsBlocking(true);
  };

  const openExceptionDialog = (barberId?: string, date?: Date, time?: string) => {
    openScheduleBlockDialog("exception", barberId, date, time);
  };

  const getAgendaSelectedBarberId = () => {
    if (user?.role === "barber" && user.id) return String(user.id);
    return selectedBarberFilter !== "all" ? selectedBarberFilter : undefined;
  };

  const openAgendaExceptionDialog = (date?: Date) => {
    openExceptionDialog(getAgendaSelectedBarberId(), date);
  };

  const openManualBookingDialog = (date?: Date, time?: string) => {
    openScheduleBlockDialog("manual", getAgendaSelectedBarberId(), date, time);
  };

  const openManualBookingAtSlot = (date: Date, time: string, barberId?: number) => {
    openScheduleBlockDialog("manual", barberId ? String(barberId) : getAgendaSelectedBarberId(), date, time);
  };

  const handleMoveAppointment = async (appointmentId: number, date: Date, time: string, barberId?: number) => {
    const [hours, minutes] = time.split(":").map(Number);
    const startTime = new Date(date);
    startTime.setHours(hours, minutes, 0, 0);

    try {
      await apiRequest("PATCH", `/api/appointments/${appointmentId}`, {
        startTime,
        ...(barberId ? { barberId } : {}),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/public"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
      toast({ title: "Marcação movida", description: `Nova hora: ${format(startTime, "dd/MM HH:mm")}.` });
    } catch (err: any) {
      toast({
        title: "Não foi possível mover",
        description: err.message || "Verifique se o horário está livre.",
        variant: "destructive",
      });
    }
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
      toast({ title: "Notas guardadas", description: "As preferências do cliente foram atualizadas." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Não foi possível guardar as notas.", variant: "destructive" });
    } finally {
      setIsSavingCustomerNotes(false);
    }
  };

  const getBarberName = (id: number) => {
    if (!barbers && isLoadingBarbers) return "A carregar...";
    return barbers?.find(b => b.id === id)?.name || "Desconhecido";
  };
  const getServiceName = (id?: number | null) => {
    if (!id) return "Serviço indisponível";
    if (!services && isLoadingServices) return "A carregar...";
    return services?.find(s => s.id === id)?.name || "Serviço indisponível";
  };
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

  const removeBarber = async (barber: BarberListItem) => {
    const response = await apiRequest("DELETE", `/api/barbers/${barber.id}`);
    const result = await response.json().catch(() => null);
    await refreshBarbersCache();
    queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/appointments/public"] });
    if (selectedBarberFilter === String(barber.id)) setSelectedBarberFilter("all");
    if (dashboardBarberFilter === String(barber.id)) setDashboardBarberFilter("all");
    toast({ title: "Sucesso", description: result?.message || "Barbeiro removido." });
  };

  const updateBarberVisibility = async (barber: BarberListItem, isVisible: boolean) => {
    const response = await apiRequest("PATCH", `/api/barbers/${barber.id}`, { isVisible });
    const updatedBarber = await response.json();
    await refreshBarbersCache(updatedBarber);
    queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/appointments/public"] });
    if (!isVisible && selectedBarberFilter === String(barber.id)) setSelectedBarberFilter("all");
    if (!isVisible && dashboardBarberFilter === String(barber.id)) setDashboardBarberFilter("all");
    toast({
      title: "Sucesso",
      description: isVisible
        ? "Barbeiro reativado e visível na operação."
        : "Barbeiro arquivado. Não aparece no site nem recebe novas reservas.",
    });
  };

  const openBarberRemovalFlow = async (barber: BarberListItem) => {
    const response = await apiRequest("GET", `/api/barbers/${barber.id}/future-appointments`);
    const futureAppointments = (await response.json()) as AdminAppointment[];
    if (futureAppointments.length === 0) {
      await removeBarber(barber);
      return;
    }

    setBarberRemovalCandidate(barber);
    setFutureRemovalAppointments(futureAppointments);
    setBarberReassignments({});
  };

  const getCompatibleReplacementBarbers = (appointment: AdminAppointment) => {
    return (barbers || []).filter((barber) =>
      barber.id !== barberRemovalCandidate?.id &&
      barber.isVisible !== false &&
      canBarberPerformService(barber, appointment.serviceId)
    );
  };

  const handleBulkReassignmentChange = (barberId: string) => {
    const replacement = barbers?.find((barber) => String(barber.id) === barberId);
    if (!replacement) return;

    setBarberReassignments((current) => {
      const next = { ...current };
      futureRemovalAppointments.forEach((appointment) => {
        if (canBarberPerformService(replacement, appointment.serviceId)) {
          next[appointment.id] = barberId;
        }
      });
      return next;
    });
  };

  const closeBarberRemovalFlow = () => {
    setBarberRemovalCandidate(null);
    setFutureRemovalAppointments([]);
    setBarberReassignments({});
    setIsReassigningBarber(false);
  };

  const handleReassignFutureAppointmentsAndRemoveBarber = async () => {
    if (!barberRemovalCandidate) return;

    const missingAppointment = futureRemovalAppointments.find((appointment) => !barberReassignments[appointment.id]);
    if (missingAppointment) {
      toast({
        title: "Falta escolher barbeiro",
        description: `Escolha um novo barbeiro para ${missingAppointment.customerName}.`,
        variant: "destructive",
      });
      return;
    }

    setIsReassigningBarber(true);
    try {
      for (const appointment of futureRemovalAppointments) {
        const newBarberId = Number(barberReassignments[appointment.id]);
        await apiRequest("PATCH", `/api/appointments/${appointment.id}`, { barberId: newBarberId });
      }

      await removeBarber(barberRemovalCandidate);
      closeBarberRemovalFlow();
      toast({
        title: "Marcações reatribuídas",
        description: "As marcações futuras foram passadas para outro barbeiro.",
      });
    } catch (err: any) {
      toast({
        title: "Não foi possível reatribuir",
        description: err.message || "Confirme os horários e tente novamente.",
        variant: "destructive",
      });
      setIsReassigningBarber(false);
    }
  };

  const handleStatusChange = (appointmentId: number, status: AppointmentStatus) => {
    updateStatus.mutate(
      { id: appointmentId, status, expectedStatus: "booked" },
      {
        onSuccess: () => {
          toast({ title: "Atualizado", description: `Estado alterado para ${getStatusLabel(status).toLowerCase()}.` });
          queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
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
    queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
  };

  const handleAddBlacklistEntry = async () => {
    const phone = blacklistForm.phone;
    const email = blacklistForm.email;
    const normalizedPhone = normalizeSupportedPhone(phone);
    const normalizedEmail = normalizeEmail(email);

    if (!phone.trim()) {
      toast({ title: "Erro", description: "O telemóvel é obrigatório.", variant: "destructive" });
      return;
    }

    if (!normalizedPhone) {
      toast({ title: "Telemóvel inválido", description: supportedPhoneValidationMessage, variant: "destructive" });
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
    queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
    setBlacklistForm({ phone: "", email: "" });
    toast({ title: "Sucesso", description: "Cliente adicionado à lista de bloqueio." });
  };

  const refreshBlacklistData = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/blacklist"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
  };

  const submitBlacklistEntryWithFutureCheck = async (
    payload: { phone: string; email?: string; reason: string },
    options?: { cancelFutureAppointments?: boolean; clearForm?: boolean },
  ) => {
    setIsSubmittingBlacklist(true);
    try {
      const response = await apiFetch("/api/admin/blacklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          cancelFutureAppointments: options?.cancelFutureAppointments,
        }),
      });
      const responseBody = await response.json().catch(() => ({}));

      if (response.status === 409 && responseBody?.code === "CUSTOMER_HAS_FUTURE_APPOINTMENTS") {
        setPendingBlacklistAction({
          ...payload,
          futureAppointments: responseBody.futureAppointments || [],
        });
        return;
      }

      if (!response.ok) {
        throw new Error(responseBody?.message || "Não foi possível bloquear o cliente.");
      }

      const cancelledCount = Array.isArray(responseBody?.cancelledAppointments)
        ? responseBody.cancelledAppointments.length
        : 0;

      refreshBlacklistData();
      setPendingBlacklistAction(null);
      if (options?.clearForm) {
        setBlacklistForm({ phone: "", email: "" });
      }

      toast({
        title: responseBody?.alreadyBlacklisted ? "Cliente já bloqueado" : "Cliente bloqueado",
        description: responseBody?.alreadyBlacklisted
          ? "Este contacto já se encontrava na lista de bloqueio. Não foi criado um duplicado."
          : cancelledCount > 0
          ? `${cancelledCount} marcação(ões) futura(s) foram cancelada(s).`
          : "Cliente adicionado à lista de bloqueio.",
      });
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message || "Não foi possível bloquear o cliente.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingBlacklist(false);
    }
  };

  const handleBlockCustomerWithFutureCheck = async (appointment: AdminAppointment) => {
    await submitBlacklistEntryWithFutureCheck({
      phone: appointment.customerPhone,
      email: appointment.customerEmail || undefined,
      reason: `Faltou à marcação de ${format(parseISO(appointment.startTime), "dd/MM/yyyy HH:mm")}`,
    });
  };

  const handleAddBlacklistEntryWithFutureCheck = async () => {
    const phone = blacklistForm.phone;
    const email = blacklistForm.email;
    const normalizedPhone = normalizeSupportedPhone(phone);
    const normalizedEmail = normalizeEmail(email);

    if (!phone.trim()) {
      toast({ title: "Erro", description: "O telemóvel é obrigatório.", variant: "destructive" });
      return;
    }

    if (!normalizedPhone) {
      toast({ title: "Telemóvel inválido", description: supportedPhoneValidationMessage, variant: "destructive" });
      return;
    }

    if (!isValidOptionalEmail(email)) {
      toast({ title: "Email inválido", description: emailValidationMessage, variant: "destructive" });
      return;
    }

    await submitBlacklistEntryWithFutureCheck({
      phone: normalizedPhone,
      email: normalizedEmail || undefined,
      reason: "Bloqueio manual pelo administrador",
    }, { clearForm: true });
  };

  const activeBarberColumns = useMemo(() => {
    const allBarbers = user?.role === "barber" ? (barbers || []) : activeBarbers;
    if (user?.role === "barber") {
      return allBarbers.filter((barber) => barber.id === user.id);
    }
    if (selectedBarberFilter !== "all") {
      return allBarbers.filter((barber) => String(barber.id) === selectedBarberFilter);
    }
    return allBarbers;
  }, [activeBarbers, barbers, selectedBarberFilter, user]);
  const weeklyAgendaBarberOptions = user?.role === "barber"
    ? activeBarberColumns
    : activeBarbers;

  const dayAppointmentSummary = useMemo(() => ({
    total: appointmentList.length,
    booked: appointmentList.filter((appointment) => appointment.status === "booked").length,
    completed: appointmentList.filter((appointment) => appointment.status === "completed").length,
    risk: appointmentList.filter((appointment) => appointment.status === "no_show" || appointment.status === "late_cancelled").length,
  }), [appointmentList]);

  useEffect(() => {
    const handleUnauthorized = () => {
      if (sessionExpiryHandledRef.current) return;

      sessionExpiryHandledRef.current = true;
      queryClient.clear();
      setSelectedAppointment(null);
      setUser({ authorized: false, role: "" });
      toast({
        title: "Sessão terminada",
        description: "Inicie sessão novamente para continuar.",
        variant: "destructive",
      });
    };

    window.addEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
    checkAuth();

    return () => {
      window.removeEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
    };
  }, []);

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
    const serviceList = (services || []).filter((service) => service.isVisible !== false);
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

  const createBlockStartTime = (date: Date, timeStr: string) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const startTime = new Date(date);
    startTime.setHours(hours, minutes, 0, 0);
    return startTime;
  };

  const isPastBlockStart = (date: Date, timeStr: string) => (
    createBlockStartTime(date, timeStr).getTime() < Date.now()
  );

  const availableBlockTimes = useMemo(() => {
    if (!blockData.barberId || !hasLoadedBlockAppointments) return [];
    const barberId = Number(blockData.barberId);

    const timeOptions = blockData.isManualBooking && blockData.allowOutsideHours
      ? outsideHoursBlockTimeOptions
      : blockTimeOptions;

    return timeOptions.filter((time) => {
      if (blockData.isManualBooking && isPastBlockStart(blockData.date, time)) {
        return false;
      }

      if (!blockData.allowOutsideHours && !isTimeAvailableForDay(blockData.date, time, selectedBlockDuration, blockData.barberId)) {
        return false;
      }

      return !hasAdminAppointmentConflict({
        appointments: blockAppointmentList,
        barberId,
        date: blockData.date,
        time,
        duration: selectedBlockDuration,
        services,
      });
    });
  }, [
    allAvailabilityRows,
    blockAppointmentList,
    blockData.barberId,
    blockData.date,
    blockData.allowOutsideHours,
    blockData.isManualBooking,
    hasLoadedBlockAppointments,
    selectedBlockDuration,
    services,
    shopAvailabilityRows,
  ]);
  const availableBlockTimesKey = availableBlockTimes.join("|");
  const selectedBlockTimesKey = blockData.times.join("|");

  useEffect(() => {
    if (blockData.isManualBooking && blockData.allowOutsideHours) return;

    setBlockData((current) => {
      const availableTimes = new Set(availableBlockTimes);
      const validTimes = current.times.filter((time) => availableTimes.has(time));
      const nextTimes = current.isRecurring ? validTimes.slice(0, 1) : validTimes;
      if (
        nextTimes.length === current.times.length &&
        nextTimes.every((time, index) => time === current.times[index])
      ) {
        return current;
      }
      return { ...current, times: nextTimes };
    });
  }, [availableBlockTimesKey, selectedBlockTimesKey]);

  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const findManualBookingBlacklistEntry = () => {
    if (!blockData.isManualBooking) return null;

    const phone = normalizeSupportedPhone(blockData.phone);
    if (!phone) return null;

    return blacklistEntries?.find((entry: any) =>
      supportedPhonesMatch(entry.phone, phone),
    ) || null;
  };

  const handleBlockTime = async (options?: { skipBlacklistCheck?: boolean }) => {
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
    if (blockData.isRecurring && blockData.times.length !== 1) {
      toast({ title: "Erro", description: "Escolha apenas uma hora para a marcação recorrente.", variant: "destructive" });
      return;
    }

    if (blockData.isRecurring && format(blockData.date, "yyyy-MM-dd") < format(startOfToday(), "yyyy-MM-dd")) {
      toast({ title: "Erro", description: "A recorrência deve começar hoje ou numa data futura.", variant: "destructive" });
      return;
    }

    const hasPastOutsideHoursTime = blockData.isManualBooking
      && blockData.allowOutsideHours
      && blockData.times.some((timeStr) => isPastBlockStart(blockData.date, timeStr));
    if (hasPastOutsideHoursTime) {
      toast({ title: "Erro", description: "Escolha uma hora futura para marcações fora do horário.", variant: "destructive" });
      return;
    }

    if (!options?.skipBlacklistCheck) {
      const blacklistEntry = findManualBookingBlacklistEntry();
      if (blacklistEntry) {
        setPendingManualBookingBlacklistWarning({
          entryId: blacklistEntry.id,
          phone: normalizeManualBookingPhoneForSubmit(blockData.phone),
        });
        return;
      }
    }

    try {
      if (blockData.isRecurring) {
        const timeStr = blockData.times[0];
        const startTime = createBlockStartTime(blockData.date, timeStr);

        if (startTime.getTime() < Date.now()) {
          toast({ title: "Erro", description: "A recorrência deve começar numa data e hora futuras.", variant: "destructive" });
          return;
        }

        await apiRequest("POST", "/api/appointments/block", {
          barberId: Number(blockData.barberId),
          serviceId: Number(blockData.serviceId),
          startTime: startTime,
          name: blockData.name || "Cliente Manual",
          phone: normalizeManualBookingPhoneForSubmit(blockData.phone),
          isManualBooking: true,
          isRecurring: true,
          recurringWeeks: Number(blockData.recurringWeeks),
          recurringMonths: Number(blockData.recurringMonths),
          allowOutsideHours: blockData.allowOutsideHours,
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
        
        const startTimes = datesToBlock.flatMap((date) =>
          blockData.times.map((timeStr) => createBlockStartTime(date, timeStr)),
        );
        if (startTimes.length === 0) {
          toast({ title: "Erro", description: "Não existem dias abertos no período selecionado.", variant: "destructive" });
          return;
        }

        await apiRequest("POST", "/api/appointments/block", {
          barberId: Number(blockData.barberId),
          serviceId: blockData.isManualBooking ? Number(blockData.serviceId) : null,
          startTime: startTimes[0],
          startTimes,
          name: blockData.isManualBooking ? (blockData.name || "Cliente Manual") : (blockData.name || "BLOQUEIO MANUAL"),
          phone: blockData.isManualBooking ? normalizeManualBookingPhoneForSubmit(blockData.phone) : (blockData.phone || "900000000"),
          isManualBooking: blockData.isManualBooking,
          allowOutsideHours: blockData.allowOutsideHours,
        });
      }
      
      toast({ title: "Sucesso", description: "Registo(s) processado(s) com sucesso." });
      setIsBlocking(false);
      setBlockData({ ...blockData, times: [], name: "", phone: "900000000", serviceId: "", isMultiDay: false, isManualBooking: false, allowOutsideHours: false, isRecurring: false });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const handleCreateManualBookingWithBlacklistedCustomer = async (options?: { removeFromBlacklist?: boolean }) => {
    const pendingWarning = pendingManualBookingBlacklistWarning;
    if (!pendingWarning) return;

    setIsResolvingManualBookingBlacklistWarning(true);
    try {
      if (options?.removeFromBlacklist) {
        await apiRequest("DELETE", `/api/admin/blacklist/${pendingWarning.entryId}`);
        refreshBlacklistData();
      }

      setPendingManualBookingBlacklistWarning(null);
      await handleBlockTime({ skipBlacklistCheck: true });
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message || "Nao foi possivel continuar com a marcacao.",
        variant: "destructive",
      });
    } finally {
      setIsResolvingManualBookingBlacklistWarning(false);
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

        <Dialog open={!!barberRemovalCandidate} onOpenChange={(open) => {
          if (!open) closeBarberRemovalFlow();
        }}>
          <DialogContent className="bg-card border-white/10 text-white w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Reatribuir marcações de {barberRemovalCandidate?.name}</DialogTitle>
            </DialogHeader>

            <div className="space-y-5 pt-2">
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4">
                <p className="text-sm text-amber-100">
                  Este barbeiro ainda tem {futureRemovalAppointments.length} marcação(ões) futura(s). Escolha outro barbeiro para cada uma antes de remover.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Atribuir todas as compatíveis a</Label>
                <Select onValueChange={handleBulkReassignmentChange}>
                  <SelectTrigger className="bg-background border-white/10">
                    <SelectValue placeholder="Escolher barbeiro" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10 text-white">
                    {(barbers || [])
                      .filter((barber) => barber.id !== barberRemovalCandidate?.id && barber.isVisible !== false)
                      .map((barber) => (
                        <SelectItem key={barber.id} value={String(barber.id)}>
                          {barber.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">
                  Se algum barbeiro não fizer o serviço de uma marcação, essa linha fica por escolher manualmente.
                </p>
              </div>

              <div className="space-y-3">
                {futureRemovalAppointments.map((appointment) => {
                  const compatibleBarbers = getCompatibleReplacementBarbers(appointment);
                  return (
                    <div key={appointment.id} className="grid gap-3 rounded-lg border border-white/10 bg-background/50 p-4 md:grid-cols-[1fr_260px] md:items-center">
                      <div>
                        <p className="font-semibold text-white">{appointment.customerName}</p>
                        <p className="mt-1 text-sm text-gray-300">
                          {format(parseISO(appointment.startTime), "dd/MM/yyyy 'às' HH:mm")} · {getServiceName(appointment.serviceId)}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">{getAppointmentContactLinks(appointment.customerPhone).displayPhone}</p>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs text-gray-400">Novo barbeiro</Label>
                        <Select
                          value={barberReassignments[appointment.id]}
                          onValueChange={(value) => setBarberReassignments((current) => ({
                            ...current,
                            [appointment.id]: value,
                          }))}
                          disabled={compatibleBarbers.length === 0 || isReassigningBarber}
                        >
                          <SelectTrigger className="bg-background border-white/10">
                            <SelectValue placeholder={compatibleBarbers.length === 0 ? "Sem opção compatível" : "Escolher"} />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-white/10 text-white">
                            {compatibleBarbers.map((barber) => (
                              <SelectItem key={barber.id} value={String(barber.id)}>
                                {barber.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={closeBarberRemovalFlow}
                  disabled={isReassigningBarber}
                >
                  Cancelar
                </Button>
                <Button
                  variant="gold"
                  onClick={handleReassignFutureAppointmentsAndRemoveBarber}
                  disabled={
                    isReassigningBarber ||
                    futureRemovalAppointments.length === 0 ||
                    futureRemovalAppointments.some((appointment) => !barberReassignments[appointment.id])
                  }
                >
                  {isReassigningBarber ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isReassigningBarber ? "A reatribuir..." : "Reatribuir e remover"}
                </Button>
              </div>
            </div>
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
          onBlockCustomer={handleBlockCustomerWithFutureCheck}
          canManageSchedule={user.role === "admin"}
        />

        <Dialog
          open={!!pendingBlacklistAction}
          onOpenChange={(open) => {
            if (!open && !isSubmittingBlacklist) setPendingBlacklistAction(null);
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-card text-white sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Cliente com marcações futuras</DialogTitle>
              <p className="text-sm text-gray-400">
                Este cliente ainda tem marcações futuras. Escolha se pretende manter ou cancelar essas marcações ao bloquear o cliente.
              </p>
            </DialogHeader>

            <div className="space-y-3">
              {pendingBlacklistAction?.futureAppointments.map((appointment) => (
                <div key={appointment.id} className="rounded-xl border border-white/10 bg-background/60 p-3">
                  <p className="font-semibold text-white">
                    {format(parseISO(appointment.startTime), "dd/MM/yyyy 'as' HH:mm", { locale: pt })}
                  </p>
                  <p className="mt-1 text-sm text-gray-300">
                    {appointment.barberName} · {appointment.serviceName}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {appointment.customerName} · {getAppointmentContactLinks(appointment.customerPhone).displayPhone}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                disabled={isSubmittingBlacklist}
                onClick={() => setPendingBlacklistAction(null)}
              >
                Voltar
              </Button>
              <Button
                variant="ghost"
                disabled={isSubmittingBlacklist || !pendingBlacklistAction}
                onClick={() => pendingBlacklistAction && submitBlacklistEntryWithFutureCheck(
                  {
                    phone: pendingBlacklistAction.phone,
                    email: pendingBlacklistAction.email,
                    reason: pendingBlacklistAction.reason,
                  },
                  { cancelFutureAppointments: false, clearForm: true },
                )}
              >
                Bloquear e manter marcações
              </Button>
              <Button
                variant="destructive"
                disabled={isSubmittingBlacklist || !pendingBlacklistAction}
                onClick={() => pendingBlacklistAction && submitBlacklistEntryWithFutureCheck(
                  {
                    phone: pendingBlacklistAction.phone,
                    email: pendingBlacklistAction.email,
                    reason: pendingBlacklistAction.reason,
                  },
                  { cancelFutureAppointments: true, clearForm: true },
                )}
              >
                {isSubmittingBlacklist ? "A bloquear..." : "Bloquear e cancelar marcações"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={!!pendingManualBookingBlacklistWarning}
          onOpenChange={(open) => {
            if (!open && !isResolvingManualBookingBlacklistWarning) {
              setPendingManualBookingBlacklistWarning(null);
            }
          }}
        >
          <AlertDialogContent className="border-white/10 bg-card text-white">
            <AlertDialogHeader>
              <AlertDialogTitle>Cliente na blacklist</AlertDialogTitle>
              <AlertDialogDescription className="text-gray-400">
                Este numero ({pendingManualBookingBlacklistWarning
                  ? getAppointmentContactLinks(pendingManualBookingBlacklistWarning.phone).displayPhone
                  : ""}) esta na blacklist. Para criar esta marcacao, remova primeiro o cliente da blacklist.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:gap-2">
              <AlertDialogCancel
                className="border-white/10 bg-background text-white hover:bg-white/10"
                disabled={isResolvingManualBookingBlacklistWarning}
              >
                Voltar
              </AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={isResolvingManualBookingBlacklistWarning}
                onClick={() => handleCreateManualBookingWithBlacklistedCustomer({ removeFromBlacklist: true })}
              >
                {isResolvingManualBookingBlacklistWarning ? "A processar..." : "Remover da blacklist e criar"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AppointmentBlockDialog
          open={isBlocking}
          onOpenChange={setIsBlocking}
          barbers={activeBarbers}
          manualBookingServices={manualBookingServices}
          blockData={blockData}
          onBlockDataChange={setBlockData}
          isCalendarOpen={isCalendarOpen}
          onCalendarOpenChange={setIsCalendarOpen}
          availableBlockTimes={availableBlockTimes}
          isCheckingAvailability={Boolean(blockData.barberId) && !hasLoadedBlockAppointments}
          onSubmit={handleBlockTime}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="admin-tabs-horizontal-scroll scrollbar-none sticky top-2 z-30 w-full justify-start rounded-xl border border-white/10 bg-card/95 p-1 shadow-lg shadow-black/20 backdrop-blur supports-[backdrop-filter]:bg-card/85 md:static md:shadow-none">
            <TabsTrigger value="dashboard" className={adminTabTriggerClass}><CalendarIcon className="w-4 h-4" /> Agenda</TabsTrigger>
            <TabsTrigger value="appointments" className={adminTabTriggerClass}><Clock className="w-4 h-4" /> Marcações</TabsTrigger>
            {user.role === "admin" && (
              <>
                <TabsTrigger value="barbers" className={adminTabTriggerClass}><Users className="w-4 h-4" /> Equipa</TabsTrigger>
                <TabsTrigger value="services" className={adminTabTriggerClass}><Scissors className="w-4 h-4" /> Serviços</TabsTrigger>
                <TabsTrigger value="settings" className={adminTabTriggerClass}><CalendarIcon className="w-4 h-4" /> Horário</TabsTrigger>
                <TabsTrigger value="blacklist" className={adminTabTriggerClass}><User className="w-4 h-4 text-red-400" /> Bloqueados</TabsTrigger>
                <TabsTrigger value="reports" className={adminTabTriggerClass}><FileDown className="w-4 h-4" /> Relatórios</TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6 outline-none">
            <TodayOverviewPanel
              summary={todaySummary}
              getBarberName={getBarberName}
              getServiceName={getServiceName}
            />

            <WeeklyAgenda
              appointments={filteredAgendaAppointmentList}
              barbers={weeklyAgendaBarberOptions}
              services={services}
              isLoading={isLoadingWeeklyAppointments || isLoadingBarbers || isLoadingServices}
              selectedBarberFilter={selectedBarberFilter}
              selectedStatusFilter={selectedAgendaStatusFilter}
              canFilterBarbers={user.role === "admin"}
              canManageSchedule={user.role === "admin"}
              onBarberFilterChange={setSelectedBarberFilter}
              onStatusFilterChange={setSelectedAgendaStatusFilter}
              onException={openAgendaExceptionDialog}
              onManualBooking={openManualBookingDialog}
              onCreateAtSlot={openManualBookingAtSlot}
              onMoveAppointment={handleMoveAppointment}
              onSelectAppointment={setSelectedAppointment}
              getStatusLabel={getStatusLabel}
            />

            {user.role === "admin" && (
              <AuditLogPanel logs={auditLogs} isLoading={isLoadingAuditLogs} />
            )}

            <div ref={businessDashboardRef} className="scroll-mt-24 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Dashboard de negócio</h2>
                <p className="text-sm text-gray-400">
                  Receita, procura, faltas e clientes a recuperar num só lugar.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select value={dashboardDays} onValueChange={handleDashboardDaysChange}>
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
                  <Select value={dashboardBarberFilter} onValueChange={handleDashboardBarberChange}>
                    <SelectTrigger className="h-11 border-white/10 bg-card text-white sm:w-[190px]">
                      <SelectValue placeholder="Barbeiro" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-white/10 text-white">
                      <SelectItem value="all">Todos os barbeiros</SelectItem>
                      {activeBarbers.map((barber) => (
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
                <CardContent className="flex min-h-[260px] items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </CardContent>
              </Card>
            ) : (
              <SimpleBusinessDashboard data={dashboardData} />
            )}
          </TabsContent>

          <TabsContent value="appointments" className="space-y-6 outline-none">
            <AppointmentsTab
              user={user}
              barbers={activeBarbers}
              appointmentList={appointmentList}
              filteredAppointmentList={filteredAppointmentList}
              appointmentViewMode={appointmentViewMode}
              onAppointmentViewModeChange={setAppointmentViewMode}
              selectedDateFilter={selectedDateFilter}
              onSelectedDateFilterChange={setSelectedDateFilter}
              selectedBarberFilter={selectedBarberFilter}
              onSelectedBarberFilterChange={setSelectedBarberFilter}
              selectedStatusFilter={selectedStatusFilter}
              onSelectedStatusFilterChange={setSelectedStatusFilter}
              isLoadingAppointments={isLoadingAppointments || isLoadingBarbers || isLoadingServices}
              dayAppointmentSummary={dayAppointmentSummary}
              onOpenManualBooking={() => openManualBookingDialog()}
              onSelectAppointment={(appointment) => setSelectedAppointment(appointment)}
              getBarberName={getBarberName}
              getServiceName={getServiceName}
              getStatusLabel={getStatusLabel}
              getStatusClass={getStatusClass}
            />
          </TabsContent>

          <TabsContent value="barbers" className="outline-none">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Equipa de Barbeiros</h2>
                <p className="text-sm text-gray-400">
                  Barbeiros ativos aparecem no site, na agenda e nas reservas.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {archivedBarbers.length > 0 ? (
                  <Button
                    variant="outline"
                    className="border-white/10 text-sm"
                    onClick={() => setShowArchivedBarbers((current) => !current)}
                  >
                    {showArchivedBarbers ? "Ocultar arquivados" : `Mostrar arquivados (${archivedBarbers.length})`}
                  </Button>
                ) : null}
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
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {activeBarbers.map(barber => (
                <Card
                  key={barber.id}
                  data-testid="team-barber-card"
                  data-barber-id={barber.id}
                  className="bg-card border-white/10 overflow-hidden text-white"
                >
                  <div className="aspect-square bg-muted relative">
                    <img src={getBarberAvatar(barber)} className="w-full h-full object-cover" />
                    <ConfirmAction
                      title={`Remover ${barber.name}?`}
                      description="Se tiver marcações futuras, reatribua-as primeiro. Se tiver apenas histórico, será ocultado para preservar relatórios."
                      confirmLabel="Remover"
                      confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onConfirm={async () => {
                        try {
                          await openBarberRemovalFlow(barber);
                        } catch (err: any) {
                          toast({ title: "Erro", description: err.message || "Não foi possível remover o barbeiro.", variant: "destructive" });
                        }
                      }}
                    >
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-2 right-2 h-8 w-8"
                        aria-label={`Remover ${barber.name}`}
                      >
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
                          <div className="space-y-4 pt-4" data-edit-barber-form>
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
                            <Button
                              variant="gold"
                              className="w-full"
                              disabled={savingBarberId === barber.id}
                              onClick={async (event) => {
                                setSavingBarberId(barber.id);
                                try {
                                  const formRoot = event.currentTarget.closest("[data-edit-barber-form]");
                                  const name = formRoot?.querySelector<HTMLInputElement>(`#edit-barber-name-${barber.id}`)?.value || "";
                                  const specialty = formRoot?.querySelector<HTMLInputElement>(`#edit-barber-spec-${barber.id}`)?.value || "";
                                  const color = formRoot?.querySelector<HTMLInputElement>(`#edit-barber-color-${barber.id}`)?.value || defaultBarberColor;
                                  const avatar = getEditedBarberAvatar(barberAvatarDrafts, barber);
                                  const hasServiceDraft = Object.prototype.hasOwnProperty.call(barberServiceDrafts, barber.id);
                                  const selectedServiceIds = getEffectiveServiceSelection(
                                    hasServiceDraft ? barberServiceDrafts[barber.id] : barber.serviceIds,
                                    services,
                                  );
                                  const payload: Record<string, unknown> = {
                                    name,
                                    specialty,
                                    color: normalizeBarberColor(color),
                                    avatar: avatar || null,
                                  };
                                  if (hasServiceDraft) {
                                    payload.serviceIds = normalizeServiceSelection(selectedServiceIds, getAllServiceIds(services));
                                  }

                                  const response = await apiRequest("PATCH", `/api/barbers/${barber.id}`, payload);
                                  const updatedBarber = await response.json();
                                  refreshBarbersCache(updatedBarber);
                                  void queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
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
                                } catch (err: any) {
                                  toast({
                                    title: "Erro",
                                    description: err.message || "Não foi possível atualizar o barbeiro.",
                                    variant: "destructive",
                                  });
                                } finally {
                                  setSavingBarberId(null);
                                }
                              }}
                            >
                              {savingBarberId === barber.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              {savingBarberId === barber.id ? "A guardar..." : "Guardar"}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                      <ConfirmAction
                        title={`Criar convite para ${barber.name}?`}
                        description="Se já existir outro convite, esse link deixa de funcionar. A palavra-passe atual mantém-se válida até o novo convite ser aceite."
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
                            queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
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
            {activeBarbers.length === 0 && (isLoadingBarbers || isFetchingBarbers) ? (
              <div className="mt-6 flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-card p-6 text-center text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                A carregar barbeiros...
              </div>
            ) : null}
            {activeBarbers.length === 0 && isBarbersError ? (
              <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-100">
                Não foi possível carregar a equipa. Atualize a página e tente novamente.
              </div>
            ) : null}
            {activeBarbers.length === 0 && !isLoadingBarbers && !isFetchingBarbers && !isBarbersError ? (
              <div className="mt-6 rounded-lg border border-white/10 bg-card p-6 text-center text-sm text-gray-400">
                Não há barbeiros ativos neste momento.
              </div>
            ) : null}
            {showArchivedBarbers && archivedBarbers.length > 0 ? (
              <div className="mt-8 space-y-3">
                <div>
                  <h3 className="text-base font-semibold text-white">Barbeiros arquivados</h3>
                  <p className="text-sm text-gray-400">
                    Ficam guardados para histórico e relatórios, mas não aparecem no site, na agenda nem nas novas reservas.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {archivedBarbers.map((barber) => (
                    <div key={barber.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-card p-3 text-white">
                      <img
                        src={getBarberAvatar(barber)}
                        className="h-14 w-14 rounded-md object-cover"
                        alt=""
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{barber.name}</p>
                        <p className="truncate text-sm text-gray-400">{barber.specialty}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-white/10"
                        onClick={async () => {
                          try {
                            await updateBarberVisibility(barber, true);
                          } catch (err: any) {
                            toast({
                              title: "Erro",
                              description: err.message || "Não foi possível reativar o barbeiro.",
                              variant: "destructive",
                            });
                          }
                        }}
                      >
                        Reativar
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
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
                      <Label htmlFor="bl-phone" className="text-xs">Telemóvel (obrigatório)</Label>
                      <div className="flex h-10 overflow-hidden rounded-md border border-white/10 bg-background focus-within:border-red-400/60 focus-within:ring-1 focus-within:ring-red-400/30">
                        <div className="relative shrink-0 border-r border-white/10 bg-white/5">
                          <select
                            aria-label="País do telemóvel da blacklist"
                            className="h-full w-[116px] appearance-none bg-transparent px-3 pr-6 text-sm font-semibold text-white outline-none"
                            value={blacklistPhoneParts.countryCode}
                            onChange={(event) => {
                              const country = getPhoneCountry(event.target.value as PhoneCountryCode);
                              setBlacklistForm((current) => ({ ...current, phone: country.dialCode }));
                            }}
                          >
                            {PHONE_COUNTRIES.map((country) => (
                              <option key={country.code} value={country.code} className="bg-card text-white">
                                {country.flag} {country.dialCode}
                              </option>
                            ))}
                          </select>
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">▾</span>
                        </div>
                        <Input
                          id="bl-phone"
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel-national"
                          maxLength={blacklistPhoneCountry.maxDigits}
                          value={blacklistPhoneParts.localPhone}
                          onChange={(event) => setBlacklistForm((current) => ({
                            ...current,
                            phone: toStoredPhone(
                              formatPhoneInput(event.target.value, blacklistPhoneCountry.maxDigits),
                              blacklistPhoneParts.countryCode,
                            ),
                          }))}
                          className="h-full min-w-0 rounded-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                          placeholder={blacklistPhoneCountry.placeholder}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Email (opcional)</Label>
                      <Input
                        id="bl-email"
                        type="email"
                        autoComplete="email"
                        value={blacklistForm.email}
                        onChange={(event) => setBlacklistForm((current) => ({ ...current, email: event.target.value }))}
                        className="bg-background border-white/10"
                        placeholder="cliente@email.com"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button variant="destructive" className="w-full" disabled={isSubmittingBlacklist} onClick={handleAddBlacklistEntryWithFutureCheck}>Bloquear Cliente</Button>
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
                            <td className="px-6 py-4 font-mono whitespace-nowrap">{formatPhoneForDisplay(entry.phone)}</td>
                            <td className="px-6 py-4">{entry.email || "-"}</td>
                            <td className="px-6 py-4 text-gray-400">{format(parseISO(entry.createdAt), "dd/MM/yyyy")}</td>
                            <td className="px-6 py-4 text-right">
                              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white" onClick={async () => {
                                try {
                                  await apiRequest("DELETE", `/api/admin/blacklist/${entry.id}`);
                                  queryClient.invalidateQueries({ queryKey: ["/api/admin/blacklist"] });
                                  queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
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
                      <Label>Nome curto na agenda (opcional)</Label>
                      <Input
                        value={serviceFormData.agendaLabel}
                        onChange={e => setServiceFormData({...serviceFormData, agendaLabel: e.target.value})}
                        className="bg-background border-white/10 text-white"
                        maxLength={40}
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
                  <CardContent>
                    <div className="mb-4 space-y-1 text-sm text-gray-400">
                      <p>{service.duration} min</p>
                      <p className="text-xs text-gray-500">Agenda: {service.agendaLabel || "etiqueta automática"}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="flex-1 h-8 text-xs">Editar</Button>
                        </DialogTrigger>
                        <DialogContent className="bg-card border-white/10 text-white">
                          <DialogHeader><DialogTitle>Editar Serviço</DialogTitle></DialogHeader>
                          <div className="space-y-4 pt-4" data-edit-service-form>
                            <div><Label>Nome</Label><Input defaultValue={service.name} id={`edit-service-name-${service.id}`} className="bg-background border-white/10" /></div>
                            <div><Label>Descrição</Label><Textarea defaultValue={service.description || ""} id={`edit-service-desc-${service.id}`} className="bg-background border-white/10" /></div>
                            <div>
                              <Label>Nome curto na agenda (opcional)</Label>
                              <Input
                                defaultValue={service.agendaLabel || ""}
                                id={`edit-service-agenda-label-${service.id}`}
                                className="bg-background border-white/10"
                                maxLength={40}
                              />
                            </div>
                            <div><Label>Preço (€)</Label><Input type="number" step="0.01" defaultValue={service.price / 100} id={`edit-service-price-${service.id}`} className="bg-background border-white/10" /></div>
                            <div><Label>Duração (Min)</Label><Input type="number" defaultValue={service.duration} id={`edit-service-dur-${service.id}`} className="bg-background border-white/10" /></div>
                            <Button variant="gold" className="w-full" onClick={async (event) => {
                              try {
                                const formRoot = event.currentTarget.closest("[data-edit-service-form]");
                                const name = formRoot?.querySelector<HTMLInputElement>(`#edit-service-name-${service.id}`)?.value || "";
                                const description = formRoot?.querySelector<HTMLTextAreaElement>(`#edit-service-desc-${service.id}`)?.value || "";
                                const agendaLabel = getAgendaLabelPayload(formRoot?.querySelector<HTMLInputElement>(`#edit-service-agenda-label-${service.id}`)?.value);
                                const price = Math.round(Number(formRoot?.querySelector<HTMLInputElement>(`#edit-service-price-${service.id}`)?.value || 0) * 100);
                                const duration = Number(formRoot?.querySelector<HTMLInputElement>(`#edit-service-dur-${service.id}`)?.value || 0);
                                const response = await apiRequest("PATCH", `/api/services/${service.id}`, { name, description, agendaLabel, price, duration });
                                await assertServiceAgendaLabelPersisted(response, agendaLabel);
                                queryClient.invalidateQueries({ queryKey: ["/api/services"] });
                                queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
                                toast({ title: "Sucesso", description: "Serviço atualizado." });
                              } catch (err: any) {
                                toast({ title: "Erro", description: err.message || "Erro ao atualizar serviço.", variant: "destructive" });
                              }
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
                            queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
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
                            queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
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
            {(!services || services.length === 0) && (isLoadingServices || isFetchingServices) ? (
              <div className="mt-6 flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-card p-6 text-center text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                A carregar serviços...
              </div>
            ) : null}
            {(!services || services.length === 0) && isServicesError ? (
              <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-100">
                Não foi possível carregar os serviços. Atualize a página e tente novamente.
              </div>
            ) : null}
            {services && services.length === 0 && !isLoadingServices && !isFetchingServices && !isServicesError ? (
              <div className="mt-6 rounded-lg border border-white/10 bg-card p-6 text-center text-sm text-gray-400">
                Não há serviços ativos neste momento.
              </div>
            ) : null}
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
                      Este horário define quando a loja aceita marcações. Ausências, férias e ajustes pontuais são geridos na Agenda.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
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
                <p className="text-gray-400 text-sm">Gere um ficheiro .xlsx com resumo financeiro, estados e detalhe das marcações do período.</p>
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
