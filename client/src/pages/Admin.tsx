import { lazy, Suspense, useState, useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import { type AppointmentStatus, useAppointments, useUpdateAppointmentStatus } from "@/hooks/use-appointments";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO, startOfToday, startOfWeek, subDays } from "date-fns";
import { pt } from "date-fns/locale";
import { Loader2, CheckCircle, XCircle, Plus, Calendar as CalendarIcon, Clock, User, LogOut, Scissors, Users, FileDown, Copy, TrendingUp, Euro, AlertTriangle, UserCheck, Upload, Trash2 } from "lucide-react";
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
import { AppointmentsTab, blockTimeOptions, type AppointmentBlockData, type AppointmentStatusFilter, type AppointmentViewMode } from "@/components/admin/AppointmentsTab";
import { AppointmentDetailsDialog } from "@/components/admin/AppointmentDetailsDialog";
import { WeeklyAgenda } from "@/components/admin/WeeklyAgenda";
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

const DashboardChartCard = lazy(() => import("@/components/admin/DashboardChartCard"));
const adminTabTriggerClass = "h-10 shrink-0 gap-2 whitespace-nowrap px-3 text-white data-[state=active]:text-primary";

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
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isAddingBarber, setIsAddingBarber] = useState(false);
  const [isAddingService, setIsAddingService] = useState(false);
  const [barberFormData, setBarberFormData] = useState({ name: "", specialty: "", bio: "", avatar: "", email: "", color: defaultBarberColor, serviceIds: [] as number[] });
  const [barberAvatarDrafts, setBarberAvatarDrafts] = useState<Record<number, string | null>>({});
  const [barberServiceDrafts, setBarberServiceDrafts] = useState<Record<number, number[]>>({});
  const [savingBarberId, setSavingBarberId] = useState<number | null>(null);
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
  const filteredWeeklyAppointmentList = useMemo(() => {
    return weeklyAppointmentList.filter((appointment) => {
      const matchesBarber = user?.role === "barber" || selectedBarberFilter === "all" || String(appointment.barberId) === selectedBarberFilter;
      const matchesStatus = selectedStatusFilter === "all" || appointment.status === selectedStatusFilter;
      return matchesBarber && matchesStatus;
    });
  }, [selectedBarberFilter, selectedStatusFilter, user?.role, weeklyAppointmentList]);
  const selectedAppointmentDetails = useMemo(() => {
    if (!selectedAppointment) return null;
    const candidates = [...weeklyAppointmentList, ...appointmentList];
    return candidates.find((appointment) => appointment.id === selectedAppointment.id) || selectedAppointment;
  }, [appointmentList, selectedAppointment, weeklyAppointmentList]);
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
  const [blacklistForm, setBlacklistForm] = useState({ phone: "", email: "" });
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
      await apiRequest("POST", "/api/services", serviceFormData);
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
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

  const openAgendaExceptionDialog = () => {
    openExceptionDialog(getAgendaSelectedBarberId());
  };

  const openManualBookingDialog = (date?: Date, time?: string) => {
    openScheduleBlockDialog("manual", getAgendaSelectedBarberId(), date, time);
  };

  const openManualBookingAtSlot = (date: Date, time: string) => {
    openManualBookingDialog(date, time);
  };

  const handleMoveAppointment = async (appointmentId: number, date: Date, time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    const startTime = new Date(date);
    startTime.setHours(hours, minutes, 0, 0);

    try {
      await apiRequest("PATCH", `/api/appointments/${appointmentId}`, { startTime });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/public"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
      toast({ title: "MarcaÃ§Ã£o movida", description: `Nova hora: ${format(startTime, "dd/MM HH:mm")}.` });
    } catch (err: any) {
      toast({
        title: "NÃ£o foi possÃ­vel mover",
        description: err.message || "Verifique se o horÃ¡rio estÃ¡ livre.",
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
    queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
    setBlacklistForm({ phone: "", email: "" });
    toast({ title: "Sucesso", description: "Cliente adicionado à lista de bloqueio." });
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

  const dayAppointmentSummary = useMemo(() => ({
    total: appointmentList.length,
    booked: appointmentList.filter((appointment) => appointment.status === "booked").length,
    completed: appointmentList.filter((appointment) => appointment.status === "completed").length,
    risk: appointmentList.filter((appointment) => appointment.status === "no_show" || appointment.status === "late_cancelled").length,
  }), [appointmentList]);

  useEffect(() => {
    checkAuth();
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
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
          <TabsList className="scrollbar-none sticky top-2 z-30 w-full justify-start overflow-x-auto rounded-xl border border-white/10 bg-card/95 p-1 shadow-lg shadow-black/20 backdrop-blur supports-[backdrop-filter]:bg-card/85 md:static md:shadow-none">
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
            <WeeklyAgenda
              weekStartDate={weeklyStartDate}
              appointments={filteredWeeklyAppointmentList}
              barbers={activeBarberColumns}
              services={services}
              isLoading={isLoadingWeeklyAppointments}
              selectedBarberFilter={selectedBarberFilter}
              selectedStatusFilter={selectedStatusFilter}
              canFilterBarbers={user.role === "admin"}
              onBarberFilterChange={setSelectedBarberFilter}
              onStatusFilterChange={setSelectedStatusFilter}
              onPreviousWeek={() => setWeeklyStartDate((current) => addDays(current, -7))}
              onNextWeek={() => setWeeklyStartDate((current) => addDays(current, 7))}
              onToday={() => setWeeklyStartDate(startOfWeek(startOfToday(), { weekStartsOn: 1 }))}
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
            <AppointmentsTab
              user={user}
              barbers={barbers}
              manualBookingServices={manualBookingServices}
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
              isLoadingAppointments={isLoadingAppointments}
              isBlocking={isBlocking}
              onBlockingChange={setIsBlocking}
              blockData={blockData}
              onBlockDataChange={setBlockData}
              isCalendarOpen={isCalendarOpen}
              onCalendarOpenChange={setIsCalendarOpen}
              availableBlockTimes={availableBlockTimes}
              dayAppointmentSummary={dayAppointmentSummary}
              onOpenAgendaException={openAgendaExceptionDialog}
              onOpenManualBooking={() => openManualBookingDialog()}
              onBlockTime={handleBlockTime}
              onSelectAppointment={(appointment) => setSelectedAppointment(appointment)}
              getBarberName={getBarberName}
              getServiceName={getServiceName}
              getStatusLabel={getStatusLabel}
              getStatusClass={getStatusClass}
            />
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
                          queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
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
                        value={blacklistForm.phone}
                        onChange={(event) => setBlacklistForm((current) => ({ ...current, phone: event.target.value }))}
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
                        value={blacklistForm.email}
                        onChange={(event) => setBlacklistForm((current) => ({ ...current, email: event.target.value }))}
                        className="bg-background border-white/10"
                        placeholder="cliente@email.com"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button variant="destructive" className="w-full" onClick={async () => {
                        const phone = blacklistForm.phone;
                        const email = blacklistForm.email;
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
                        queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
                        setBlacklistForm({ phone: "", email: "" });
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
                          <div className="space-y-4 pt-4" data-edit-service-form>
                            <div><Label>Nome</Label><Input defaultValue={service.name} id={`edit-service-name-${service.id}`} className="bg-background border-white/10" /></div>
                            <div><Label>Descrição</Label><Textarea defaultValue={service.description || ""} id={`edit-service-desc-${service.id}`} className="bg-background border-white/10" /></div>
                            <div><Label>Preço (€)</Label><Input type="number" step="0.01" defaultValue={service.price / 100} id={`edit-service-price-${service.id}`} className="bg-background border-white/10" /></div>
                            <div><Label>Duração (Min)</Label><Input type="number" defaultValue={service.duration} id={`edit-service-dur-${service.id}`} className="bg-background border-white/10" /></div>
                            <Button variant="gold" className="w-full" onClick={async (event) => {
                              const formRoot = event.currentTarget.closest("[data-edit-service-form]");
                              const name = formRoot?.querySelector<HTMLInputElement>(`#edit-service-name-${service.id}`)?.value || "";
                              const description = formRoot?.querySelector<HTMLTextAreaElement>(`#edit-service-desc-${service.id}`)?.value || "";
                              const price = Math.round(Number(formRoot?.querySelector<HTMLInputElement>(`#edit-service-price-${service.id}`)?.value || 0) * 100);
                              const duration = Number(formRoot?.querySelector<HTMLInputElement>(`#edit-service-dur-${service.id}`)?.value || 0);
                              await apiRequest("PATCH", `/api/services/${service.id}`, { name, description, price, duration });
                              queryClient.invalidateQueries({ queryKey: ["/api/services"] });
                              queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
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
