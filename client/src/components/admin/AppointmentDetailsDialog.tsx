import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import { AlertTriangle, CheckCircle, ChevronDown, Pencil, Phone, Plus, User, XCircle } from "lucide-react";
import {
  type AppointmentExtraSnapshot,
  type AppointmentInternalCostSnapshot,
  type AppointmentPaymentMethod,
  type AppointmentStatus,
} from "@/hooks/use-appointments";
import { useExtras } from "@/hooks/use-extras";
import { useInternalCosts } from "@/hooks/use-internal-costs";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button-custom";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  canBarberPerformService,
  getEffectivePeriodsForBarber,
  hasAppointmentIntervalConflict,
  timeToMinutes,
  type AvailabilityRow,
  type ShopAvailabilityRow,
} from "@/lib/availability";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { locationHeaders } from "@/lib/location-context";
import {
  centsToMoneyInput,
  formatMoneyInputOnBlur,
  moneyInputToCents,
  normalizeMoneyInput,
} from "@/lib/money-input";
import { createAppointmentTimeOptions } from "@/lib/appointment-time-options";
import { getAppointmentContactLinks, getWeeklyAppointmentEnd } from "@/components/admin/WeeklyAgenda";
import { AppointmentPaymentOptions } from "@/components/admin/AppointmentPaymentOptions";
import { MutationPendingOverlay } from "@/components/ui/mutation-pending-overlay";
import {
  isClockTimeAligned,
  type BookingSlotIntervalMinutes,
} from "@shared/booking-slot-interval";
import { getAppointmentCompletionTimingError } from "@shared/appointment-completion";
import { useBusinessCopy } from "@/business/use-business-copy";
import { useBusinessConfig } from "@/business/use-business-config";

type AdminAppointment = {
  id: number;
  locationId?: number;
  barberId: number;
  serviceId: number | null;
  startTime: string;
  durationMinutes: number;
  bufferBeforeMinutesSnapshot?: number;
  bufferAfterMinutesSnapshot?: number;
  serviceNameSnapshot?: string | null;
  servicePriceCentsSnapshot?: number | null;
  manualOutsideHours?: boolean;
  status: AppointmentStatus;
  paymentMethod?: AppointmentPaymentMethod;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  depositRequired?: boolean;
  depositReason?: string | null;
  canManage?: boolean;
  extras?: AppointmentExtraSnapshot[];
  internalCosts?: AppointmentInternalCostSnapshot[];
  availabilityWindows?: Array<{ startTime: string; endTime: string }>;
  notificationRevision?: number;
  seriesId?: string | null;
};

export type AppointmentMutationPendingAction = {
  appointmentId: number;
  status: AppointmentStatus;
  paymentMethod?: AppointmentPaymentMethod;
};

export type AppointmentCompletionPayload = {
  expectedRevision: number;
  paymentMethod: Exclude<AppointmentPaymentMethod, "pending">;
  extras: Array<{ extraId: number; amountCents?: number; quantity?: number }>;
  internalCosts: Array<{ internalCostId: number; unitCostCents?: number; quantity?: number }>;
};

type ServiceListItem = {
  id: number;
  name: string;
  duration?: number;
  price?: number;
  isVisible?: boolean | null;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
};

function parseAppointmentPriceInput(value: string) {
  return moneyInputToCents(value, { maxCents: 1_000_000 });
}

function parseAppointmentExtraPriceInput(value: string) {
  const cents = parseAppointmentPriceInput(value);
  return cents !== null && cents > 0 ? cents : null;
}

function formatAppointmentPrice(amountCents: number) {
  return `${centsToMoneyInput(amountCents)} €`;
}

function addAppointmentClockMinutes(time: string, minutes: number) {
  const [hours, minute] = time.split(":").map(Number);
  const total = Math.max(0, Math.min(24 * 60 - 1, hours * 60 + minute + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

type AppointmentExtraSelection = {
  extraId: number;
  amountEuros: string;
  quantity: number;
};

type AppointmentInternalCostSelection = {
  internalCostId: number;
  amountEuros: string;
  quantity: number;
};

function appointmentExtraSelections(appointment: AdminAppointment): AppointmentExtraSelection[] {
  return [...(appointment.extras ?? [])]
    .sort((left, right) => left.position - right.position)
    .map((extra) => ({
      extraId: extra.extraDefinitionId,
      amountEuros: centsToMoneyInput(extra.amountCentsSnapshot),
      quantity: extra.quantity,
    }));
}

function appointmentInternalCostSelections(appointment: AdminAppointment): AppointmentInternalCostSelection[] {
  return [...(appointment.internalCosts ?? [])]
    .sort((left, right) => left.position - right.position)
    .map((cost) => ({
      internalCostId: cost.internalCostDefinitionId,
      amountEuros: centsToMoneyInput(cost.unitCostCentsSnapshot),
      quantity: cost.quantity,
    }));
}

function EditAppointmentDialog({
  appointment,
  barbers,
  services,
  appointments,
  availabilityRows,
  shopAvailabilityRows,
  bookingSlotIntervalMinutes,
  toast,
  disabled = false,
  locationLogoUrl,
}: {
  appointment: AdminAppointment;
  barbers?: Array<{ id: number; name: string; serviceIds?: number[] | null; isVisible?: boolean | null }>;
  services?: ServiceListItem[];
  appointments?: AdminAppointment[];
  availabilityRows?: AvailabilityRow[];
  shopAvailabilityRows?: ShopAvailabilityRow[];
  bookingSlotIntervalMinutes: BookingSlotIntervalMinutes;
  toast: ReturnType<typeof useToast>["toast"];
  disabled?: boolean;
  locationLogoUrl?: string | null;
}) {
  const agendaCopy = useBusinessCopy().agenda;
  const businessConfig = useBusinessConfig();
  const isCustomAppointment = appointment.serviceId === null
    && appointment.serviceNameSnapshot != null
    && appointment.servicePriceCentsSnapshot != null;
  const [open, setOpen] = useState(false);
  const [dateValue, setDateValue] = useState(format(parseISO(appointment.startTime), "yyyy-MM-dd"));
  const [timeValue, setTimeValue] = useState(format(parseISO(appointment.startTime), "HH:mm"));
  const [barberId, setBarberId] = useState(String(appointment.barberId));
  const [serviceId, setServiceId] = useState(
    isCustomAppointment ? "custom" : appointment.serviceId ? String(appointment.serviceId) : "none",
  );
  const [customServiceName, setCustomServiceName] = useState(appointment.serviceNameSnapshot || "");
  const [customDuration, setCustomDuration] = useState(String(appointment.durationMinutes || 30));
  const [priceValue, setPriceValue] = useState(
    centsToMoneyInput(appointment.servicePriceCentsSnapshot ?? 0),
  );
  const [selectedExtras, setSelectedExtras] = useState<AppointmentExtraSelection[]>(
    () => appointmentExtraSelections(appointment),
  );
  const [selectedInternalCosts, setSelectedInternalCosts] = useState<AppointmentInternalCostSelection[]>(
    () => appointmentInternalCostSelections(appointment),
  );
  const [selectedAvailabilityWindows, setSelectedAvailabilityWindows] = useState(
    () => (appointment.availabilityWindows ?? []).map((window) => ({
      startTime: format(parseISO(window.startTime), "HH:mm"),
      endTime: format(parseISO(window.endTime), "HH:mm"),
    })),
  );
  const [isExtrasOpen, setIsExtrasOpen] = useState(() => (appointment.extras ?? []).length > 0);
  const [areInternalCostsOpen, setAreInternalCostsOpen] = useState(() => (appointment.internalCosts ?? []).length > 0);
  const [allowOutsideHours, setAllowOutsideHours] = useState(Boolean(appointment.manualOutsideHours));
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const { data: extraDefinitions = [], isLoading: isLoadingExtras } = useExtras({
    enabled: open,
    locationId: appointment.locationId,
  });
  const { data: internalCostDefinitions = [], isLoading: isLoadingInternalCosts } = useInternalCosts({
    enabled: open,
    locationId: appointment.locationId,
  });
  const originalTime = format(parseISO(appointment.startTime), "HH:mm");
  const timeOptions = useMemo(() => createAppointmentTimeOptions({
    currentTime: originalTime,
    intervalMinutes: bookingSlotIntervalMinutes,
  }), [bookingSlotIntervalMinutes, originalTime]);
  const serviceList = (services || []).filter((service) =>
    service.isVisible !== false || service.id === appointment.serviceId,
  );
  const activeBarbers = (barbers || []).filter((barber) =>
    barber.isVisible !== false || barber.id === appointment.barberId,
  );
  const selectedService = serviceId === "none" || serviceId === "custom"
    ? null
    : serviceList.find((service) => String(service.id) === serviceId) || null;
  const parsedCustomDuration = Number(customDuration);
  const selectedDuration = serviceId === "custom"
    ? Number.isInteger(parsedCustomDuration) && parsedCustomDuration > 0 ? parsedCustomDuration : 30
    : selectedService?.duration || appointment.durationMinutes || 30;
  const keepsAppointmentService = selectedService?.id === appointment.serviceId;
  const selectedBufferBefore = serviceId === "custom" || serviceId === "none"
    ? 0
    : keepsAppointmentService
      ? appointment.bufferBeforeMinutesSnapshot ?? 0
      : selectedService?.bufferBeforeMinutes ?? 0;
  const selectedBufferAfter = serviceId === "custom" || serviceId === "none"
    ? 0
    : keepsAppointmentService
      ? appointment.bufferAfterMinutesSnapshot ?? 0
      : selectedService?.bufferAfterMinutes ?? 0;
  const requestedStartTime = useMemo(() => new Date(`${dateValue}T${timeValue}`), [dateValue, timeValue]);
  const requestedAvailabilityWindows = useMemo(() => selectedAvailabilityWindows.map((window) => ({
    startTime: new Date(`${dateValue}T${window.startTime}`),
    endTime: new Date(`${dateValue}T${window.endTime}`),
  })), [dateValue, selectedAvailabilityWindows]);
  const availableBarbers = useMemo(() => {
    if (Number.isNaN(requestedStartTime.getTime())) return [];

    const appointmentList = appointments ?? [];

    return activeBarbers.filter((barber) => {
      if (!canBarberPerformService(barber, selectedService?.id ?? null)) return false;

      const startMinutes = timeToMinutes(timeValue);
      const fitsSchedule = getEffectivePeriodsForBarber({
        barberId: barber.id,
        dayOfWeek: requestedStartTime.getDay(),
        shopAvailabilityRows: shopAvailabilityRows ?? [],
        availabilityRows: availabilityRows ?? [],
      }).some((period) => startMinutes - selectedBufferBefore >= period.start
        && startMinutes + selectedDuration + selectedBufferAfter <= period.end);
      if (!fitsSchedule && !allowOutsideHours) return false;

      return !hasAppointmentIntervalConflict({
        appointments: appointmentList.filter((candidate) => candidate.id !== appointment.id),
        barberId: barber.id,
        startTime: requestedStartTime,
        durationMinutes: selectedDuration,
        bufferBeforeMinutes: selectedBufferBefore,
        bufferAfterMinutes: selectedBufferAfter,
        availabilityWindows: requestedAvailabilityWindows,
      });
    });
  }, [
    activeBarbers,
    allowOutsideHours,
    appointment.id,
    appointments,
    availabilityRows,
    requestedStartTime,
    requestedAvailabilityWindows,
    selectedDuration,
    selectedBufferAfter,
    selectedBufferBefore,
    selectedService?.id,
    shopAvailabilityRows,
    timeValue,
  ]);
  const selectedBarber = activeBarbers.find((barber) => String(barber.id) === barberId);
  const compatibleServices = useMemo(
    () => serviceList.filter((service) => canBarberPerformService(selectedBarber, service.id)),
    [selectedBarber, serviceList],
  );
  const canUseNoService = appointment.serviceId === null && !isCustomAppointment;
  const hasCompatibleService = serviceId !== "none" || canUseNoService;
  const selectedStartMinutes = timeToMinutes(timeValue);
  const selectedFitsSchedule = selectedBarber ? getEffectivePeriodsForBarber({
    barberId: selectedBarber.id,
    dayOfWeek: requestedStartTime.getDay(),
    shopAvailabilityRows: shopAvailabilityRows ?? [],
    availabilityRows: availabilityRows ?? [],
  }).some((period) =>
    selectedStartMinutes - selectedBufferBefore >= period.start
      && selectedStartMinutes + selectedDuration + selectedBufferAfter <= period.end,
  ) : false;
  const selectedIsOutsideHours = Boolean(selectedBarber && !selectedFitsSchedule);
  const hasExistingSpecificPrice = serviceId !== "custom"
    && serviceId !== "none"
    && appointment.serviceId === Number(serviceId)
    && appointment.servicePriceCentsSnapshot != null
    && selectedService?.price != null
    && appointment.servicePriceCentsSnapshot !== selectedService.price;
  const showExistingPriceTerms = serviceId !== "custom"
    && serviceId !== "none"
    && (selectedIsOutsideHours || hasExistingSpecificPrice);
  const existingExtrasByDefinitionId = useMemo(
    () => new Map((appointment.extras ?? []).map((extra) => [extra.extraDefinitionId, extra])),
    [appointment.extras],
  );
  const extraDefinitionsById = useMemo(
    () => new Map(extraDefinitions.map((extra) => [extra.id, extra])),
    [extraDefinitions],
  );
  const visibleExtraDefinitions = useMemo(() => {
    const applicableServiceId = serviceId === "custom" || serviceId === "none" ? null : Number(serviceId);
    const activeDefinitions = extraDefinitions.filter((extra) => extra.isActive
      && (extra.serviceIds.length === 0
        || (applicableServiceId !== null && extra.serviceIds.includes(applicableServiceId))));
    const inactiveSelectedDefinitions = extraDefinitions.filter((extra) =>
      !extra.isActive && selectedExtras.some((selection) => selection.extraId === extra.id));
    return [...activeDefinitions, ...inactiveSelectedDefinitions]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
  }, [extraDefinitions, selectedExtras, serviceId]);
  const missingSelectedExtras = useMemo(() => selectedExtras
    .filter((selection) => !extraDefinitionsById.has(selection.extraId))
    .map((selection) => existingExtrasByDefinitionId.get(selection.extraId))
    .filter((extra): extra is AppointmentExtraSnapshot => Boolean(extra)), [
      existingExtrasByDefinitionId,
      extraDefinitionsById,
      selectedExtras,
    ]);
  const proposedServicePriceCents = serviceId === "custom" || showExistingPriceTerms
    ? parseAppointmentPriceInput(priceValue)
    : selectedService?.price ?? (serviceId === "none" ? 0 : null);
  const proposedExtrasTotalCents = selectedExtras.reduce((total, selection) => {
    const definition = extraDefinitionsById.get(selection.extraId);
    const existing = existingExtrasByDefinitionId.get(selection.extraId);
    const amount = parseAppointmentExtraPriceInput(selection.amountEuros)
      ?? existing?.amountCentsSnapshot
      ?? definition?.amountCents;
    return total + (amount ?? 0) * selection.quantity;
  }, 0);
  const incompleteVariableExtra = selectedExtras.find((selection) => {
    const definition = extraDefinitionsById.get(selection.extraId);
    return definition?.isActive && parseAppointmentExtraPriceInput(selection.amountEuros) === null;
  });
  const selectedExtrasCount = selectedExtras.length;
  const extrasHeading = selectedExtrasCount === 0
    ? "Extras (opcional)"
    : `Extras (${selectedExtrasCount} ${selectedExtrasCount === 1 ? "selecionado" : "selecionados"})`;
  const existingInternalCostsByDefinitionId = useMemo(
    () => new Map((appointment.internalCosts ?? []).map((cost) => [cost.internalCostDefinitionId, cost])),
    [appointment.internalCosts],
  );
  const visibleInternalCostDefinitions = useMemo(() => {
    const active = internalCostDefinitions.filter((cost) => cost.isActive);
    const selectedInactive = internalCostDefinitions.filter((cost) => !cost.isActive
      && selectedInternalCosts.some((selected) => selected.internalCostId === cost.id));
    return [...active, ...selectedInactive]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
  }, [internalCostDefinitions, selectedInternalCosts]);
  const internalCostsTotalCents = selectedInternalCosts.reduce((total, selection) => {
    const existing = existingInternalCostsByDefinitionId.get(selection.internalCostId);
    const definition = internalCostDefinitions.find((cost) => cost.id === selection.internalCostId);
    const unitCost = moneyInputToCents(selection.amountEuros, { minCents: 0, maxCents: 1_000_000 })
      ?? existing?.unitCostCentsSnapshot
      ?? definition?.defaultUnitCostCents
      ?? 0;
    return total + unitCost * selection.quantity;
  }, 0);

  useEffect(() => {
    if (!open) return;
    if (availableBarbers.length > 0 && !availableBarbers.some((barber) => String(barber.id) === barberId)) {
      setBarberId(String(availableBarbers[0].id));
      return;
    }

    if (serviceId === "none" || serviceId === "custom") {
      if (!canUseNoService && compatibleServices.length > 0) {
        if (serviceId !== "custom") setServiceId(String(compatibleServices[0].id));
      }
      return;
    }

    if (!compatibleServices.some((service) => String(service.id) === serviceId)) {
      setServiceId(compatibleServices[0] ? String(compatibleServices[0].id) : "none");
    }
  }, [availableBarbers, barberId, canUseNoService, compatibleServices, open, serviceId]);

  useEffect(() => {
    if (!open || extraDefinitions.length === 0) return;
    const applicableServiceId = serviceId === "custom" || serviceId === "none" ? null : Number(serviceId);
    setSelectedExtras((current) => {
      const next = current.filter((selection) => {
        const definition = extraDefinitionsById.get(selection.extraId);
        if (!definition) return true;
        return definition.serviceIds.length === 0
          || (applicableServiceId !== null && definition.serviceIds.includes(applicableServiceId));
      });
      return next.length === current.length ? current : next;
    });
  }, [extraDefinitions.length, extraDefinitionsById, open, serviceId]);

  const resetForm = () => {
    setDateValue(format(parseISO(appointment.startTime), "yyyy-MM-dd"));
    setTimeValue(format(parseISO(appointment.startTime), "HH:mm"));
    setBarberId(String(appointment.barberId));
    setServiceId(isCustomAppointment ? "custom" : appointment.serviceId ? String(appointment.serviceId) : "none");
    setCustomServiceName(appointment.serviceNameSnapshot || "");
    setCustomDuration(String(appointment.durationMinutes || 30));
    setPriceValue(centsToMoneyInput(appointment.servicePriceCentsSnapshot ?? 0));
    setSelectedExtras(appointmentExtraSelections(appointment));
    setSelectedInternalCosts(appointmentInternalCostSelections(appointment));
    setSelectedAvailabilityWindows((appointment.availabilityWindows ?? []).map((window) => ({
      startTime: format(parseISO(window.startTime), "HH:mm"),
      endTime: format(parseISO(window.endTime), "HH:mm"),
    })));
    setIsExtrasOpen((appointment.extras ?? []).length > 0);
    setAreInternalCostsOpen((appointment.internalCosts ?? []).length > 0);
    setAllowOutsideHours(Boolean(appointment.manualOutsideHours));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSavingRef.current) return;
    if (nextOpen) resetForm();
    setOpen(nextOpen);
  };

  const handleSave = async () => {
    if (isSavingRef.current) return;
    const newStartTime = new Date(`${dateValue}T${timeValue}`);
    const parsedBarberId = Number(barberId);
    const parsedServiceId = serviceId === "none" || serviceId === "custom" ? null : Number(serviceId);
    const priceCents = parseAppointmentPriceInput(priceValue);

    if (Number.isNaN(newStartTime.getTime()) || !Number.isFinite(parsedBarberId)) {
      toast({ title: "Erro", description: agendaCopy.professional.invalidAppointment, variant: "destructive" });
      return;
    }

    const originalDate = format(parseISO(appointment.startTime), "yyyy-MM-dd");
    const startTimeChanged = dateValue !== originalDate || timeValue !== originalTime;
    if (startTimeChanged && !isClockTimeAligned(timeValue, bookingSlotIntervalMinutes)) {
      toast({
        title: "Hora não permitida",
        description: bookingSlotIntervalMinutes === 60
          ? "Escolha uma hora certa para reagendar."
          : `Escolha uma hora alinhada em intervalos de ${bookingSlotIntervalMinutes} minutos.`,
        variant: "destructive",
      });
      return;
    }

    if (!hasCompatibleService) {
      toast({ title: "Serviço inválido", description: agendaCopy.professional.incompatibleService, variant: "destructive" });
      return;
    }
    if (serviceId === "custom") {
      if (!customServiceName.trim() || customServiceName.trim().length > 100) {
        toast({ title: "Serviço inválido", description: "Indique uma descrição até 100 caracteres.", variant: "destructive" });
        return;
      }
      if (!Number.isInteger(parsedCustomDuration) || parsedCustomDuration < 1 || parsedCustomDuration > 720) {
        toast({ title: "Duração inválida", description: "Indique uma duração entre 1 e 720 minutos.", variant: "destructive" });
        return;
      }
    }
    if ((serviceId === "custom" || showExistingPriceTerms) && priceCents === null) {
      toast({ title: "Preço inválido", description: "Indique o preço final desta marcação.", variant: "destructive" });
      return;
    }
    if (businessConfig.features.appointmentAvailabilityWindows && selectedAvailabilityWindows.length > 0) {
      const commercialEnd = new Date(newStartTime.getTime() + selectedDuration * 60_000);
      const windows = [...requestedAvailabilityWindows]
        .sort((left, right) => left.startTime.getTime() - right.startTime.getTime());
      const invalidWindow = windows.some((window, index) => (
        Number.isNaN(window.startTime.getTime()) || Number.isNaN(window.endTime.getTime())
        || window.startTime >= window.endTime
        || window.startTime < newStartTime
        || window.endTime > commercialEnd
        || (index > 0 && window.startTime < windows[index - 1].endTime)
      ));
      if (invalidWindow) {
        toast({
          title: "Janela de disponibilidade inválida",
          description: "As janelas devem ficar dentro do serviço e não podem sobrepor-se.",
          variant: "destructive",
        });
        return;
      }
    }
    const extrasPayload = selectedExtras.map((selection) => {
      const definition = extraDefinitionsById.get(selection.extraId);
      const existing = existingExtrasByDefinitionId.get(selection.extraId);
      if (!definition || !definition.isActive) {
        return {
          extraId: selection.extraId,
          amountCents: existing?.amountCentsSnapshot,
          quantity: selection.quantity,
        };
      }
      return {
        extraId: selection.extraId,
        amountCents: parseAppointmentExtraPriceInput(selection.amountEuros) ?? undefined,
        quantity: selection.quantity,
      };
    });
    const internalCostsPayload = selectedInternalCosts.map((selection) => ({
      internalCostId: selection.internalCostId,
      unitCostCents: moneyInputToCents(selection.amountEuros, { minCents: 0, maxCents: 1_000_000 }) ?? undefined,
      quantity: selection.quantity,
    }));
    if (incompleteVariableExtra) {
      setIsExtrasOpen(true);
      window.setTimeout(() => {
        document.getElementById(`edit-appointment-extra-amount-${incompleteVariableExtra.extraId}`)?.focus();
      }, 0);
      toast({
        title: "Valor de Extra inválido",
        description: "Indique um valor superior a zero para cada Extra variável.",
        variant: "destructive",
      });
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    try {
      await apiRequest("PATCH", `/api/appointments/${appointment.id}`, {
        startTime: newStartTime,
        barberId: parsedBarberId,
        serviceId: parsedServiceId,
        serviceMode: serviceId === "custom" ? "custom" : "existing",
        allowOutsideHours: allowOutsideHours && selectedIsOutsideHours,
        extras: extrasPayload,
        internalCosts: internalCostsPayload,
        ...(businessConfig.features.appointmentAvailabilityWindows ? {
          availabilityWindows: requestedAvailabilityWindows,
        } : {}),
        ...(serviceId === "custom" ? {
          customServiceName: customServiceName.trim(),
          customDurationMinutes: parsedCustomDuration,
          servicePriceCents: priceCents,
        } : showExistingPriceTerms ? {
          servicePriceCents: priceCents,
        } : {}),
      }, appointment.locationId ? { headers: locationHeaders(appointment.locationId) } : undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/appointments"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/appointments/public"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] }),
      ]);
      toast({ title: "Sucesso", description: "Marcação atualizada." });
      setOpen(false);
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message || "Não foi possível atualizar a marcação.",
        variant: "destructive",
      });
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button data-testid="appointment-action-edit" disabled={disabled} size="sm" variant="ghost" className="h-8 text-xs text-primary hover:text-primary/80">
          <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
        </Button>
      </DialogTrigger>
      <DialogContent
        mobileViewportAware
        aria-busy={isSaving}
        className="w-[calc(100vw-1rem)] overflow-y-auto border-white/10 bg-card text-white sm:max-w-lg"
      >
        <DialogHeader><DialogTitle>Editar marcação</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input type="date" value={dateValue} onChange={(event) => setDateValue(event.target.value)} className="bg-background border-white/10 text-white" />
            </div>
            <div className="space-y-2">
              <Label>Hora</Label>
              <Select value={timeValue} onValueChange={setTimeValue}>
                <SelectTrigger
                  aria-label="Hora"
                  className="border-white/10 bg-background text-white focus:ring-primary"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[70] max-h-[min(20rem,70dvh)] border-white/10 bg-card text-white">
                  {timeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-background/50 px-3 py-3">
            <div>
              <Label htmlFor="edit-outside-hours" className="cursor-pointer text-sm font-medium">Permitir horários fora do horário normal</Label>
              <p className="text-xs text-gray-500">{agendaCopy.outsideHoursEditHelp}</p>
            </div>
            <Switch id="edit-outside-hours" checked={allowOutsideHours} onCheckedChange={setAllowOutsideHours} />
          </div>
          <div className="space-y-2">
            <Label>{agendaCopy.professional.label}</Label>
            <Select value={barberId} onValueChange={setBarberId}>
              <SelectTrigger aria-label={agendaCopy.professional.label} className="bg-background border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-white/10 text-white">
                {availableBarbers.map((barber) => <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {availableBarbers.length === 0 && (
              <p className="text-xs text-red-300">{agendaCopy.professional.unavailableForEdit}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Serviço</Label>
            <Select
              value={serviceId}
              onValueChange={(value) => {
                setServiceId(value);
                if (value === "custom") {
                  setPriceValue(centsToMoneyInput(appointment.servicePriceCentsSnapshot ?? 0));
                  return;
                }
                const service = serviceList.find((candidate) => String(candidate.id) === value);
                if (service?.price != null) setPriceValue(centsToMoneyInput(service.price));
              }}
            >
              <SelectTrigger className="bg-background border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-white/10 text-white">
                {canUseNoService && <SelectItem value="none">Sem serviço</SelectItem>}
                {isCustomAppointment && <SelectItem value="custom">{appointment.serviceNameSnapshot || "Serviço personalizado"}</SelectItem>}
                {compatibleServices.map((service) => (
                  <SelectItem key={service.id} value={String(service.id)}>
                    {service.name}{service.duration ? ` · ${service.duration} min` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {compatibleServices.length === 0 && !canUseNoService && (
              <p className="text-xs text-red-300">{agendaCopy.professional.noCompatibleServices}</p>
            )}
          </div>
          {serviceId === "custom" && (
            <div className="grid gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit-custom-service-name">Descrição do serviço</Label>
                <Input
                  id="edit-custom-service-name"
                  value={customServiceName}
                  maxLength={100}
                  onChange={(event) => setCustomServiceName(event.target.value)}
                  className="border-white/10 bg-background text-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-custom-duration">Duração (min)</Label>
                <Input
                  id="edit-custom-duration"
                  type="number"
                  min="1"
                  max="720"
                  value={customDuration}
                  onChange={(event) => setCustomDuration(event.target.value)}
                  className="border-white/10 bg-background text-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-custom-price">Preço (€)</Label>
                <Input
                  id="edit-custom-price"
                  inputMode="decimal"
                  value={priceValue}
                  onChange={(event) => setPriceValue((current) => normalizeMoneyInput(event.target.value, current))}
                  onBlur={() => setPriceValue((current) => formatMoneyInputOnBlur(current, { maxCents: 1_000_000 }))}
                  className="border-white/10 bg-background text-white"
                />
              </div>
            </div>
          )}
          {showExistingPriceTerms && (
            <div className="space-y-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
              <div>
                <p className="font-semibold text-amber-100">Preço específico desta marcação</p>
                <p className="text-xs text-amber-100/75">
                  {selectedIsOutsideHours
                    ? "O servidor voltará a validar o horário, o preço e os conflitos ao guardar."
                    : "Este valor é próprio da marcação e não altera o preço do serviço no catálogo."}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-background/40 p-3 text-sm">
                  <p className="text-xs text-gray-400">Preço habitual</p>
                  <p className="mt-1 font-semibold">{selectedService?.price != null ? `${(selectedService.price / 100).toFixed(2).replace(".", ",")} €` : "—"}</p>
                </div>
                <div className="space-y-2">
                  <Label>Preço desta marcação (€)</Label>
                  <Input
                    inputMode="decimal"
                    value={priceValue}
                    onChange={(event) => setPriceValue((current) => normalizeMoneyInput(event.target.value, current))}
                    onBlur={() => setPriceValue((current) => formatMoneyInputOnBlur(current, { maxCents: 1_000_000 }))}
                    className="border-white/10 bg-background text-white"
                  />
                </div>
              </div>
            </div>
          )}
          {businessConfig.features.appointmentAvailabilityWindows && !appointment.seriesId && (
            <div className="space-y-3 rounded-xl border border-white/10 bg-background/30 p-3" data-testid="appointment-availability-windows-editor">
              <div className="flex min-h-10 items-center justify-between gap-3">
                <span>
                  <span className="block text-sm font-semibold text-white">Disponibilidade durante o serviço</span>
                  <span className="mt-1 block text-xs text-gray-400">Só estas janelas ficam livres para outra marcação.</span>
                </span>
                <Switch
                  checked={selectedAvailabilityWindows.length > 0}
                  onCheckedChange={(checked) => setSelectedAvailabilityWindows(checked ? [{
                    startTime: addAppointmentClockMinutes(timeValue, Math.max(1, Math.floor(selectedDuration / 3))),
                    endTime: addAppointmentClockMinutes(timeValue, Math.max(2, Math.floor(selectedDuration * 2 / 3))),
                  }] : [])}
                  aria-label="Disponibilidade durante o serviço"
                />
              </div>
              {selectedAvailabilityWindows.map((window, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`edit-availability-start-${index}`} className="text-xs">Início</Label>
                    <Input
                      id={`edit-availability-start-${index}`}
                      type="time"
                      value={window.startTime}
                      onChange={(event) => setSelectedAvailabilityWindows((current) => current.map((value, position) => position === index
                        ? { ...value, startTime: event.target.value }
                        : value))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`edit-availability-end-${index}`} className="text-xs">Fim</Label>
                    <Input
                      id={`edit-availability-end-${index}`}
                      type="time"
                      value={window.endTime}
                      onChange={(event) => setSelectedAvailabilityWindows((current) => current.map((value, position) => position === index
                        ? { ...value, endTime: event.target.value }
                        : value))}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setSelectedAvailabilityWindows((current) => current.filter((_, position) => position !== index))}
                    aria-label={`Remover janela ${index + 1}`}
                  >
                    Remover
                  </Button>
                </div>
              ))}
              {selectedAvailabilityWindows.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedAvailabilityWindows((current) => [...current, {
                    startTime: addAppointmentClockMinutes(timeValue, Math.max(1, Math.floor(selectedDuration / 2))),
                    endTime: addAppointmentClockMinutes(timeValue, Math.max(2, Math.floor(selectedDuration * 3 / 4))),
                  }])}
                >
                  Adicionar janela
                </Button>
              )}
            </div>
          )}
          <Collapsible
            open={isExtrasOpen}
            onOpenChange={setIsExtrasOpen}
            className={cn(
              "overflow-hidden rounded-xl border bg-background/30",
              incompleteVariableExtra ? "border-amber-400/40" : "border-white/10",
            )}
            data-testid="appointment-extras-editor"
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                data-testid="appointment-extras-editor-trigger"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-white">{extrasHeading}</span>
                  {incompleteVariableExtra && (
                    <span className="mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Valor por completar
                    </span>
                  )}
                </span>
                <ChevronDown className={cn("h-5 w-5 shrink-0 text-gray-400 transition-transform", isExtrasOpen && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 border-t border-white/10 p-3" data-testid="appointment-extras-editor-content">
              <p className="text-xs text-gray-400">Os valores guardados só mudam quando altera explicitamente a seleção.</p>
              {isLoadingExtras ? (
                <p className="text-xs text-gray-500">A carregar Extras...</p>
              ) : visibleExtraDefinitions.length === 0 && missingSelectedExtras.length === 0 ? (
                <p className="text-xs text-gray-500">Não existem Extras disponíveis nesta localização.</p>
              ) : (
                <div className="space-y-2">
                {visibleExtraDefinitions.map((extra) => {
                  const selection = selectedExtras.find((candidate) => candidate.extraId === extra.id);
                  const existing = existingExtrasByDefinitionId.get(extra.id);
                  const selected = Boolean(selection);
                  const displayedFixedAmount = existing?.amountCentsSnapshot ?? extra.amountCents;
                  return (
                    <div key={extra.id} className="space-y-2 rounded-lg border border-white/10 bg-card/60 p-3">
                      <label htmlFor={`edit-appointment-extra-${extra.id}`} className="flex min-h-6 cursor-pointer items-start gap-3">
                        <Checkbox
                          id={`edit-appointment-extra-${extra.id}`}
                          checked={selected}
                          onCheckedChange={(checked) => setSelectedExtras((current) => checked
                            ? current.some((candidate) => candidate.extraId === extra.id)
                              ? current
                              : [...current, {
                                  extraId: extra.id,
                                  amountEuros: centsToMoneyInput(extra.amountCents),
                                  quantity: 1,
                                }]
                            : current.filter((candidate) => candidate.extraId !== extra.id))}
                          aria-label={`Selecionar Extra ${extra.name}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-sm text-gray-200">{existing?.nameSnapshot ?? extra.name}</span>
                          {!extra.isActive && (
                            <span className="mt-0.5 block text-[11px] text-amber-300">Inativo · pode remover, mas não voltar a adicionar</span>
                          )}
                        </span>
                        <span className="shrink-0 text-sm font-semibold text-primary">
                          {extra.pricingMode === "fixed" && displayedFixedAmount
                            ? formatAppointmentPrice(displayedFixedAmount)
                            : "Variável"}
                        </span>
                      </label>
                      {selected && (
                        <div className="grid gap-2 pl-7 sm:grid-cols-2">
                          <div className="space-y-1.5">
                          <Label htmlFor={`edit-appointment-extra-amount-${extra.id}`} className="text-xs text-gray-300">
                            Valor (€)
                          </Label>
                          <Input
                            id={`edit-appointment-extra-amount-${extra.id}`}
                            inputMode="decimal"
                            value={selection?.amountEuros ?? ""}
                            disabled={!extra.isActive}
                            onChange={(event) => setSelectedExtras((current) => current.map((candidate) =>
                              candidate.extraId === extra.id
                                ? {
                                    ...candidate,
                                    amountEuros: normalizeMoneyInput(event.target.value, candidate.amountEuros),
                                  }
                                : candidate))}
                            onBlur={() => setSelectedExtras((current) => current.map((candidate) =>
                              candidate.extraId === extra.id
                                ? {
                                    ...candidate,
                                    amountEuros: formatMoneyInputOnBlur(candidate.amountEuros, {
                                      minCents: 1,
                                      maxCents: 1_000_000,
                                    }),
                                  }
                                : candidate))}
                            aria-label={`Valor do Extra ${extra.name}`}
                            className="h-10 border-white/10 bg-background text-white"
                          />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`edit-appointment-extra-quantity-${extra.id}`} className="text-xs text-gray-300">Quantidade</Label>
                            <Input
                              id={`edit-appointment-extra-quantity-${extra.id}`}
                              type="number"
                              min={1}
                              max={99}
                              step={1}
                              value={selection?.quantity ?? 1}
                              disabled={!extra.isActive}
                              onChange={(event) => setSelectedExtras((current) => current.map((candidate) =>
                                candidate.extraId === extra.id
                                  ? { ...candidate, quantity: Math.max(1, Math.min(99, Number(event.target.value) || 1)) }
                                  : candidate))}
                              aria-label={`Quantidade do Extra ${extra.name}`}
                              className="h-10 border-white/10 bg-background text-white"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {missingSelectedExtras.map((extra) => (
                  <div key={extra.extraDefinitionId} className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
                    <label htmlFor={`edit-appointment-extra-missing-${extra.extraDefinitionId}`} className="flex cursor-pointer items-start gap-3">
                      <Checkbox
                        id={`edit-appointment-extra-missing-${extra.extraDefinitionId}`}
                        checked
                        onCheckedChange={(checked) => {
                          if (!checked) setSelectedExtras((current) => current.filter((candidate) => candidate.extraId !== extra.extraDefinitionId));
                        }}
                        aria-label={`Remover Extra ${extra.nameSnapshot}`}
                      />
                      <span className="min-w-0 flex-1 text-sm text-gray-200">
                        {extra.nameSnapshot}
                        <span className="mt-0.5 block text-[11px] text-amber-300">Indisponível no catálogo · apenas pode remover</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-primary">{formatAppointmentPrice(extra.amountCentsSnapshot)}</span>
                    </label>
                  </div>
                ))}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
          <Collapsible
            open={areInternalCostsOpen}
            onOpenChange={setAreInternalCostsOpen}
            className="overflow-hidden rounded-xl border border-white/10 bg-background/30"
            data-testid="appointment-internal-costs-editor"
          >
            <CollapsibleTrigger asChild>
              <button type="button" className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-white/5">
                <span>
                  <span className="block font-semibold text-white">Custos / Consumos internos</span>
                  <span className="mt-1 block text-xs text-gray-400">Não alteram o total cobrado à cliente.</span>
                </span>
                <ChevronDown className={cn("h-5 w-5 text-gray-400 transition-transform", areInternalCostsOpen && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 border-t border-white/10 p-3">
              {isLoadingInternalCosts ? <p className="text-xs text-gray-500">A carregar custos e consumos...</p>
                : visibleInternalCostDefinitions.length === 0 ? <p className="text-xs text-gray-500">Não existem custos ou consumos ativos nesta localização.</p>
                : visibleInternalCostDefinitions.map((cost) => {
                  const selected = selectedInternalCosts.find((item) => item.internalCostId === cost.id);
                  const existing = existingInternalCostsByDefinitionId.get(cost.id);
                  return <div key={cost.id} className="space-y-2 rounded-lg border border-white/10 bg-card/60 p-3">
                    <label className="flex items-start gap-3">
                      <Checkbox
                        checked={Boolean(selected)}
                        aria-label={`Selecionar custo interno ${cost.name}`}
                        onCheckedChange={(checked) => setSelectedInternalCosts((current) => checked
                          ? current.some((item) => item.internalCostId === cost.id) ? current : [...current, {
                              internalCostId: cost.id,
                              amountEuros: centsToMoneyInput(cost.defaultUnitCostCents),
                              quantity: 1,
                            }]
                          : current.filter((item) => item.internalCostId !== cost.id))}
                      />
                      <span className="min-w-0 flex-1 text-sm text-gray-200">{existing?.nameSnapshot ?? cost.name}{!cost.isActive && <span className="block text-[11px] text-amber-300">Inativo · apenas pode remover</span>}</span>
                      <span className="shrink-0 text-xs text-gray-400">/{existing?.unitLabelSnapshot ?? cost.unitLabel}</span>
                    </label>
                    {selected && <div className="grid gap-2 pl-7 sm:grid-cols-2">
                      <div className="space-y-1"><Label className="text-xs">Custo unitário (€)</Label><Input
                        inputMode="decimal"
                        value={selected.amountEuros}
                        disabled={!cost.isActive}
                        onChange={(event) => setSelectedInternalCosts((current) => current.map((item) => item.internalCostId === cost.id
                          ? { ...item, amountEuros: normalizeMoneyInput(event.target.value, item.amountEuros) }
                          : item))}
                        onBlur={() => setSelectedInternalCosts((current) => current.map((item) => item.internalCostId === cost.id
                          ? { ...item, amountEuros: formatMoneyInputOnBlur(item.amountEuros, { minCents: 0, maxCents: 1_000_000 }) }
                          : item))}
                      /></div>
                      <div className="space-y-1"><Label className="text-xs">Quantidade</Label><Input
                        type="number" min={1} max={9999} step={1}
                        value={selected.quantity}
                        disabled={!cost.isActive}
                        onChange={(event) => setSelectedInternalCosts((current) => current.map((item) => item.internalCostId === cost.id
                          ? { ...item, quantity: Math.max(1, Math.min(9999, Number(event.target.value) || 1)) }
                          : item))}
                      /></div>
                    </div>}
                  </div>;
                })}
              {selectedInternalCosts.length > 0 && <div className="flex justify-between border-t border-white/10 pt-2 text-sm"><span className="text-gray-400">Custo direto estimado</span><strong className="text-white">{formatAppointmentPrice(internalCostsTotalCents)}</strong></div>}
            </CollapsibleContent>
          </Collapsible>
          {proposedServicePriceCents !== null && (
            <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm" data-testid="appointment-edit-total">
              <div className="flex justify-between gap-4 text-gray-300">
                <span>Serviço</span>
                <span className="shrink-0">{formatAppointmentPrice(proposedServicePriceCents)}</span>
              </div>
              <div className="flex justify-between gap-4 border-t border-white/10 pt-2 font-bold text-white">
                <span>Total</span>
                <span className="shrink-0 text-primary">{formatAppointmentPrice(proposedServicePriceCents + proposedExtrasTotalCents)}</span>
              </div>
            </div>
          )}
          <Button
            data-testid="edit-appointment-save"
            variant="gold"
            className="w-full"
            disabled={isSaving || !hasCompatibleService || availableBarbers.length === 0}
            onClick={handleSave}
          >
            {isSaving ? "A guardar..." : "Guardar alterações"}
          </Button>
        </div>
        <MutationPendingOverlay active={isSaving} label="A guardar marcação..." logoUrl={locationLogoUrl} />
      </DialogContent>
    </Dialog>
  );
}

function getPaymentMethodLabel(paymentMethod?: AppointmentPaymentMethod | null) {
  if (paymentMethod === "cash") return "Dinheiro";
  if (paymentMethod === "card") return "Multibanco";
  if (paymentMethod === "voucher") return "Vale/Cupão";
  if (paymentMethod === "gift") return "Oferta";
  return "Por confirmar";
}

function getStatusTimingMessage(appointment: AdminAppointment, status: AppointmentStatus) {
  const now = new Date();
  const start = parseISO(appointment.startTime);

  if (status === "completed") {
    return getAppointmentCompletionTimingError({
      startTime: start,
      durationMinutes: appointment.durationMinutes,
    }, now) ?? "";
  }

  if (status === "no_show" && start.getTime() > now.getTime()) {
    return "Só pode marcar falta depois da hora da marcação.";
  }

  return "";
}

function ConfirmAction({
  children,
  title,
  description,
  confirmLabel = "Confirmar",
  confirmClassName = "",
  onConfirm,
}: {
  children: ReactNode;
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

export function AppointmentDetailsDialog({
  appointment,
  open,
  onOpenChange,
  barbers,
  services,
  appointments,
  availabilityRows,
  shopAvailabilityRows,
  bookingSlotIntervalMinutes,
  toast,
  getBarberName,
  getServiceName,
  getStatusLabel,
  getStatusClass,
  onOpenHistory,
  onStatusChange,
  onComplete,
  onBlockCustomer,
  canManageSchedule,
  canEditAppointment = canManageSchedule,
  canBlockCustomer = canManageSchedule,
  canManageAppointment,
  canViewCustomer = canManageAppointment,
  canManageCustomerNotes = canManageAppointment,
  canChangeStatus = canManageAppointment,
  canCancelAppointment = canManageAppointment,
  pendingAction = null,
  locationLogoUrl,
}: {
  appointment: AdminAppointment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barbers?: Array<{ id: number; name: string; serviceIds?: number[] | null; isVisible?: boolean | null }>;
  services?: ServiceListItem[];
  appointments?: AdminAppointment[];
  availabilityRows?: AvailabilityRow[];
  shopAvailabilityRows?: ShopAvailabilityRow[];
  bookingSlotIntervalMinutes: BookingSlotIntervalMinutes;
  toast: ReturnType<typeof useToast>["toast"];
  getBarberName: (id: number) => string;
  getServiceName: (id?: number | null) => string;
  getStatusLabel: (status: string) => string;
  getStatusClass: (status: string) => string;
  onOpenHistory: (appointment: AdminAppointment) => void;
  onStatusChange: (
    appointmentId: number,
    status: AppointmentStatus,
    options?: { onSuccess?: () => void; paymentMethod?: AppointmentPaymentMethod },
  ) => void;
  onComplete: (
    appointmentId: number,
    payload: AppointmentCompletionPayload,
    options?: { onSuccess?: () => void },
  ) => void;
  onBlockCustomer: (appointment: AdminAppointment) => Promise<boolean | void>;
  canManageSchedule: boolean;
  canEditAppointment?: boolean;
  canBlockCustomer?: boolean;
  canManageAppointment: boolean;
  canViewCustomer?: boolean;
  canManageCustomerNotes?: boolean;
  canChangeStatus?: boolean;
  canCancelAppointment?: boolean;
  pendingAction?: AppointmentMutationPendingAction | null;
  locationLogoUrl?: string | null;
}) {
  const agendaCopy = useBusinessCopy().agenda;
  const businessConfig = useBusinessConfig();
  const [customerNotes, setCustomerNotes] = useState("");
  const [customerNotesUpdatedAt, setCustomerNotesUpdatedAt] = useState<string | null>(null);
  const [isLoadingCustomerNotes, setIsLoadingCustomerNotes] = useState(false);
  const [isSavingCustomerNotes, setIsSavingCustomerNotes] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [completionPaymentMethod, setCompletionPaymentMethod] = useState<Exclude<AppointmentPaymentMethod, "pending"> | null>(null);
  const [completionExtras, setCompletionExtras] = useState<AppointmentExtraSelection[]>([]);
  const [isCompletionExtrasOpen, setIsCompletionExtrasOpen] = useState(false);
  const isBeautyCompletion = businessConfig.vertical === "beauty";
  const { data: completionExtraDefinitions = [], isLoading: isLoadingCompletionExtras } = useExtras({
    enabled: Boolean(open && isPaymentDialogOpen && isBeautyCompletion),
    locationId: appointment?.locationId,
  });
  const isAppointmentMutationPending = Boolean(
    pendingAction && appointment && pendingAction.appointmentId === appointment.id,
  );

  const completionExtraDefinitionsById = useMemo(
    () => new Map(completionExtraDefinitions.map((extra) => [extra.id, extra])),
    [completionExtraDefinitions],
  );
  const completionExistingExtrasById = useMemo(
    () => new Map((appointment?.extras ?? []).map((extra) => [extra.extraDefinitionId, extra])),
    [appointment?.extras],
  );
  const completionVisibleExtraDefinitions = useMemo(() => {
    const serviceId = appointment?.serviceId ?? null;
    const active = completionExtraDefinitions.filter((extra) => extra.isActive
      && (extra.serviceIds.length === 0
        || (serviceId !== null && extra.serviceIds.includes(serviceId))
        || completionExtras.some((selection) => selection.extraId === extra.id)));
    const selectedInactive = completionExtraDefinitions.filter((extra) => !extra.isActive
      && completionExtras.some((selection) => selection.extraId === extra.id));
    return [...active, ...selectedInactive]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
  }, [appointment?.serviceId, completionExtraDefinitions, completionExtras]);
  const completionMissingExtras = useMemo(() => completionExtras
    .filter((selection) => !completionExtraDefinitionsById.has(selection.extraId))
    .map((selection) => completionExistingExtrasById.get(selection.extraId))
    .filter((extra): extra is AppointmentExtraSnapshot => Boolean(extra)), [
      completionExistingExtrasById,
      completionExtraDefinitionsById,
      completionExtras,
    ]);
  const completionExtrasTotalCents = completionExtras.reduce((total, selection) => {
    const existing = completionExistingExtrasById.get(selection.extraId);
    const definition = completionExtraDefinitionsById.get(selection.extraId);
    const amount = parseAppointmentExtraPriceInput(selection.amountEuros)
      ?? existing?.amountCentsSnapshot
      ?? definition?.amountCents
      ?? 0;
    return total + amount * selection.quantity;
  }, 0);
  const incompleteCompletionExtra = completionExtras.find((selection) => {
    const definition = completionExtraDefinitionsById.get(selection.extraId);
    return definition?.isActive && parseAppointmentExtraPriceInput(selection.amountEuros) === null;
  });

  useEffect(() => {
    if (!open || !canViewCustomer || (!appointment?.customerPhone && !appointment?.customerEmail)) {
      setCustomerNotes("");
      setCustomerNotesUpdatedAt(null);
      return;
    }

    let isMounted = true;
    const loadCustomerNotes = async () => {
      setIsLoadingCustomerNotes(true);
      try {
        const res = await apiFetch(
          `/api/admin/customers/history?appointmentId=${appointment.id}`,
          appointment.locationId ? { headers: locationHeaders(appointment.locationId) } : undefined,
        );
        if (!res.ok) throw new Error("Não foi possível carregar as notas.");
        const data = await res.json();
        if (!isMounted) return;
        setCustomerNotes(data.notes?.notes || "");
        setCustomerNotesUpdatedAt(data.notes?.updatedAt || null);
      } catch {
        if (!isMounted) return;
        setCustomerNotes("");
        setCustomerNotesUpdatedAt(null);
      } finally {
        if (isMounted) setIsLoadingCustomerNotes(false);
      }
    };

    loadCustomerNotes();
    return () => {
      isMounted = false;
    };
  }, [appointment?.customerEmail, appointment?.customerPhone, appointment?.id, appointment?.locationId, canViewCustomer, open]);

  const handleSaveCustomerNotes = async () => {
    if (!appointment || (!appointment.customerPhone && !appointment.customerEmail)) return;
    setIsSavingCustomerNotes(true);
    try {
      const res = await apiRequest("PATCH", "/api/admin/customers/notes", {
        appointmentId: appointment.id,
        notes: customerNotes,
      }, appointment.locationId ? { headers: locationHeaders(appointment.locationId) } : undefined);
      const savedNote = await res.json();
      setCustomerNotes(savedNote.notes || "");
      setCustomerNotesUpdatedAt(savedNote.updatedAt || null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
      toast({ title: "Notas guardadas", description: "As notas internas do cliente foram atualizadas." });
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message || "Não foi possível guardar as notas.",
        variant: "destructive",
      });
    } finally {
      setIsSavingCustomerNotes(false);
    }
  };

  if (!appointment) {
    return <Dialog open={open} onOpenChange={onOpenChange} />;
  }

  const start = parseISO(appointment.startTime);
  const end = getWeeklyAppointmentEnd(appointment);
  const contactLinks = getAppointmentContactLinks(appointment.customerPhone);
  const serviceName = appointment.serviceNameSnapshot?.trim() || getServiceName(appointment.serviceId);
  const finalPrice = appointment.servicePriceCentsSnapshot
    ?? services?.find((service) => service.id === appointment.serviceId)?.price
    ?? 0;
  const appointmentExtras = [...(appointment.extras ?? [])]
    .sort((left, right) => left.position - right.position);
  const appointmentInternalCosts = [...(appointment.internalCosts ?? [])]
    .sort((left, right) => left.position - right.position);
  const appointmentTotal = finalPrice + appointmentExtras.reduce(
    (total, extra) => total + extra.amountCentsSnapshot * (extra.quantity ?? 1),
    0,
  );
  const directCostsTotal = appointmentInternalCosts.reduce(
    (total, cost) => total + cost.unitCostCentsSnapshot * cost.quantity,
    0,
  );
  const completeDisabledMessage = getStatusTimingMessage(appointment, "completed");
  const noShowDisabledMessage = getStatusTimingMessage(appointment, "no_show");

  const handleOpenHistory = () => {
    onOpenChange(false);
    onOpenHistory(appointment);
  };

  const handleStatusChange = (status: AppointmentStatus) => {
    onStatusChange(appointment.id, status, { onSuccess: () => onOpenChange(false) });
  };

  const handleOpenCompletion = () => {
    setCompletionExtras(appointmentExtraSelections(appointment));
    setCompletionPaymentMethod(null);
    setIsCompletionExtrasOpen((appointment.extras ?? []).length > 0);
    setIsPaymentDialogOpen(true);
  };

  const handleCompleteWithPayment = (paymentMethod: AppointmentPaymentMethod) => {
    onStatusChange(appointment.id, "completed", {
      paymentMethod,
      onSuccess: () => {
        setIsPaymentDialogOpen(false);
        onOpenChange(false);
      },
    });
  };

  const handleConfirmBeautyCompletion = () => {
    if (!completionPaymentMethod || incompleteCompletionExtra) return;
    const extras = completionExtras.map((selection) => {
      const definition = completionExtraDefinitionsById.get(selection.extraId);
      const existing = completionExistingExtrasById.get(selection.extraId);
      if (!definition || !definition.isActive) {
        return {
          extraId: selection.extraId,
          amountCents: existing?.amountCentsSnapshot,
          quantity: selection.quantity,
        };
      }
      return {
        extraId: selection.extraId,
        amountCents: parseAppointmentExtraPriceInput(selection.amountEuros) ?? undefined,
        quantity: selection.quantity,
      };
    });
    const internalCosts = (appointment.internalCosts ?? []).map((cost) => ({
      internalCostId: cost.internalCostDefinitionId,
      unitCostCents: cost.unitCostCentsSnapshot,
      quantity: cost.quantity,
    }));

    onComplete(appointment.id, {
      expectedRevision: appointment.notificationRevision ?? 0,
      paymentMethod: completionPaymentMethod,
      extras,
      internalCosts,
    }, {
      onSuccess: () => {
        setIsPaymentDialogOpen(false);
        onOpenChange(false);
      },
    });
  };

  const handleBlockCustomer = async () => {
    const completed = await onBlockCustomer(appointment);
    if (completed !== false) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isAppointmentMutationPending) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        mobileViewportAware
        aria-busy={isAppointmentMutationPending}
        className="w-[calc(100vw-1rem)] overflow-y-auto border-white/10 bg-card text-white sm:max-w-xl"
      >
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
                {canViewCustomer && (
                  <p className="text-sm text-gray-400">
                    {contactLinks.displayPhone || appointment.customerPhone || appointment.customerEmail}
                  </p>
                )}
              </div>
              <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide", getStatusClass(appointment.status))}>
                {getStatusLabel(appointment.status)}
              </span>
            </div>

            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-card px-3 py-2">
                <p className="text-xs uppercase tracking-widest text-gray-500">{agendaCopy.professional.label}</p>
                <p className="mt-1 font-semibold text-white">{getBarberName(appointment.barberId)}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-card px-3 py-2">
                <p className="text-xs uppercase tracking-widest text-gray-500">Serviço</p>
                <p className="mt-1 font-semibold text-white">{serviceName}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {appointmentExtras.length > 0 ? "Preço do serviço" : "Preço final"}: {formatAppointmentPrice(finalPrice)}
                </p>
                {appointment.manualOutsideHours && (
                  <span className="mt-2 inline-flex rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">
                    Marcação fora do horário
                  </span>
                )}
              </div>
              {canViewCustomer && appointment.status === "completed" && (
                <div className="rounded-xl border border-white/10 bg-card px-3 py-2 sm:col-span-2">
                  <p className="text-xs uppercase tracking-widest text-gray-500">Pagamento</p>
                  <p className="mt-1 font-semibold text-white">{getPaymentMethodLabel(appointment.paymentMethod)}</p>
                </div>
              )}
            </div>
            {(appointment.availabilityWindows?.length ?? 0) > 0 && (
              <div
                className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 text-sm"
                data-testid="appointment-availability-window-history"
              >
                <p className="text-xs uppercase tracking-widest text-primary">Disponibilidade durante o serviço</p>
                <p className="mt-1 text-xs text-gray-400">
                  Períodos em que foi possível encaixar outra marcação. Permanecem no histórico após o fecho.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[...(appointment.availabilityWindows ?? [])]
                    .sort((left, right) => left.startTime.localeCompare(right.startTime))
                    .map((window, index) => (
                      <span
                        key={`${window.startTime}-${window.endTime}-${index}`}
                        className="rounded-full border border-primary/25 bg-background/50 px-2.5 py-1 font-semibold text-white"
                      >
                        {format(parseISO(window.startTime), "HH:mm")}–{format(parseISO(window.endTime), "HH:mm")}
                      </span>
                    ))}
                </div>
              </div>
            )}
            <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-card px-3 py-3 text-sm" data-testid="appointment-price-breakdown">
              <div className="flex items-start justify-between gap-4">
                <span className="min-w-0 break-words text-gray-300">Serviço</span>
                <span className="shrink-0 font-medium text-white">{formatAppointmentPrice(finalPrice)}</span>
              </div>
              {appointmentExtras.length > 0 && (
                <>
                  <p className="pt-1 text-xs uppercase tracking-widest text-gray-500">Extras</p>
                  {appointmentExtras.map((extra) => (
                    <div key={`${extra.extraDefinitionId}-${extra.position}`} className="flex items-start justify-between gap-4">
                      <span className="min-w-0 break-words text-gray-300">{extra.nameSnapshot}{extra.quantity > 1 ? ` × ${extra.quantity}` : ""}</span>
                      <span className="shrink-0 font-medium text-white">{formatAppointmentPrice(extra.amountCentsSnapshot * (extra.quantity ?? 1))}</span>
                    </div>
                  ))}
                </>
              )}
              <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-2 font-bold">
                <span className="text-white">Total</span>
                <span className="shrink-0 text-primary">{formatAppointmentPrice(appointmentTotal)}</span>
              </div>
            </div>
            {appointmentInternalCosts.length > 0 && (
              <div className="mt-3 space-y-2 rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-3 text-sm" data-testid="appointment-internal-costs-breakdown">
                <p className="text-xs uppercase tracking-widest text-amber-200">Custos / Consumos internos</p>
                {appointmentInternalCosts.map((cost) => <div key={cost.id} className="flex justify-between gap-4">
                  <span className="min-w-0 text-gray-300">{cost.nameSnapshot}{cost.quantity > 1 ? ` × ${cost.quantity}` : ""}</span>
                  <span className="shrink-0 text-white">{formatAppointmentPrice(cost.unitCostCentsSnapshot * cost.quantity)}</span>
                </div>)}
                <div className="flex justify-between border-t border-white/10 pt-2"><span className="text-gray-300">Custo direto</span><strong>{formatAppointmentPrice(directCostsTotal)}</strong></div>
                <div className="flex justify-between"><span className="text-gray-300">Margem bruta</span><strong className="text-primary">{formatAppointmentPrice(appointmentTotal - directCostsTotal)}</strong></div>
              </div>
            )}
          </div>

          {canViewCustomer ? (
          <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Label className="text-sm font-semibold text-white">Notas internas</Label>
                <p className="mt-1 text-xs text-gray-400">
                  Preferências, atrasos habituais, alergias ou detalhes importantes do cliente.
                </p>
              </div>
              {customerNotesUpdatedAt && (
                <span className="text-[11px] text-gray-500">
                  {format(parseISO(customerNotesUpdatedAt), "dd/MM HH:mm")}
                </span>
              )}
            </div>
            {appointment.customerPhone || appointment.customerEmail ? (
              <>
                <Textarea
                  value={customerNotes}
                  onChange={(event) => setCustomerNotes(event.target.value)}
                  maxLength={1200}
                  disabled={!canManageCustomerNotes || isLoadingCustomerNotes || isAppointmentMutationPending}
                  placeholder={agendaCopy.appointmentNotesPlaceholder}
                  className="mt-3 min-h-[96px] scroll-mb-24 resize-y border-white/10 bg-card text-white placeholder:text-gray-600"
                />
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs text-gray-500">
                    {isLoadingCustomerNotes ? "A carregar notas..." : `${customerNotes.length}/1200`}
                  </span>
                  {canManageCustomerNotes && (
                    <Button
                      type="button"
                      variant="gold"
                      size="sm"
                      onClick={handleSaveCustomerNotes}
                      disabled={isLoadingCustomerNotes || isSavingCustomerNotes || isAppointmentMutationPending}
                      className="w-full sm:w-auto"
                    >
                      {isSavingCustomerNotes ? "A guardar..." : "Guardar notas"}
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-3 rounded-xl border border-white/10 bg-card px-3 py-2 text-sm text-gray-400">
                Adicione um telemóvel ou email à marcação para utilizar notas internas.
              </p>
            )}
          </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-gray-400">
              {agendaCopy.professional.otherOwnerNotice}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {canViewCustomer && contactLinks.tel && (
              <Button asChild size="sm" variant="outline" className="h-9 border-white/10 text-xs">
                <a href={contactLinks.tel}>
                  <Phone className="mr-1 h-3.5 w-3.5" /> Ligar
                </a>
              </Button>
            )}
            {canViewCustomer && <Button size="sm" variant="outline" onClick={handleOpenHistory} className="h-9 border-white/10 text-xs">
              <User className="mr-1 h-3.5 w-3.5" /> Histórico
            </Button>}

            {appointment.status === "booked" && (
              <>
                {canChangeStatus && (
                  <>
                    <Button
                      data-testid="appointment-action-complete"
                      size="sm"
                      variant="ghost"
                      onClick={handleOpenCompletion}
                      disabled={Boolean(completeDisabledMessage) || isAppointmentMutationPending}
                      title={completeDisabledMessage || "Marcar como feita"}
                      className="h-9 text-xs text-green-300 hover:text-green-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CheckCircle className="mr-1 h-3.5 w-3.5" /> {isBeautyCompletion ? "Concluir marcação" : "Feita"}
                    </Button>
                    <Button
                      data-testid="appointment-action-no-show"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleStatusChange("no_show")}
                      disabled={Boolean(noShowDisabledMessage) || isAppointmentMutationPending}
                      title={noShowDisabledMessage || "Marcar falta"}
                      className="h-9 text-xs text-rose-300 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Falta
                    </Button>
                  </>
                )}
                {canCancelAppointment && (
                  <Button data-testid="appointment-action-cancel" disabled={isAppointmentMutationPending} size="sm" variant="ghost" onClick={() => handleStatusChange("cancelled")} className="h-9 text-xs text-red-300 hover:text-red-200">
                    <XCircle className="mr-1 h-3.5 w-3.5" /> Cancelar
                  </Button>
                )}
                {canBlockCustomer && (
                    <ConfirmAction
                      title="Bloquear cliente?"
                      description={`${appointment.customerName} (${contactLinks.displayPhone || appointment.customerPhone}) deixa de conseguir fazer marcações online.`}
                      confirmLabel="Bloquear"
                      confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onConfirm={handleBlockCustomer}
                    >
                      <Button data-testid="appointment-action-block-customer" disabled={isAppointmentMutationPending} size="sm" variant="ghost" className="h-9 text-xs text-destructive hover:text-red-300">
                        Bloquear
                      </Button>
                    </ConfirmAction>
                )}
                {canEditAppointment && (
                    <EditAppointmentDialog
                      appointment={appointment}
                      barbers={barbers}
                      services={services}
                      appointments={appointments}
                      availabilityRows={availabilityRows}
                      shopAvailabilityRows={shopAvailabilityRows}
                      bookingSlotIntervalMinutes={bookingSlotIntervalMinutes}
                      toast={toast}
                      disabled={isAppointmentMutationPending}
                      locationLogoUrl={locationLogoUrl}
                    />
                )}
              </>
            )}
          </div>
        </div>
        <MutationPendingOverlay
          active={isAppointmentMutationPending && !isPaymentDialogOpen}
          logoUrl={locationLogoUrl}
          label={pendingAction?.status === "no_show"
            ? "A marcar falta..."
            : pendingAction?.status === "cancelled"
              ? "A cancelar marcação..."
              : "A atualizar marcação..."}
        />
      </DialogContent>
      <AlertDialog
        open={isPaymentDialogOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && isAppointmentMutationPending) return;
          setIsPaymentDialogOpen(nextOpen);
        }}
      >
        <AlertDialogContent
          aria-busy={isAppointmentMutationPending}
          className={cn(
            "border-white/10 bg-card text-white",
            isBeautyCompletion ? "max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-lg" : "overflow-hidden",
          )}
        >
          {isBeautyCompletion ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Concluir marcação</AlertDialogTitle>
                <AlertDialogDescription className="text-gray-400">
                  Confirme o serviço, acrescente Extras pedidos durante o atendimento e escolha o pagamento.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-4" data-testid="beauty-completion-summary">
                <div className="rounded-xl border border-white/10 bg-background/60 p-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Serviço</p>
                  <div className="mt-2 flex items-start justify-between gap-4 text-sm">
                    <span className="min-w-0 break-words font-medium text-white">{serviceName}</span>
                    <span className="shrink-0 font-semibold text-white">{formatAppointmentPrice(finalPrice)}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-background/60 p-3" data-testid="beauty-completion-extras">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Extras</p>
                      {completionExtras.length === 0 && <p className="mt-1 text-sm text-gray-300">Nenhum</p>}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setIsCompletionExtrasOpen((current) => !current)}
                      disabled={isAppointmentMutationPending}
                      aria-expanded={isCompletionExtrasOpen}
                      data-testid="beauty-completion-add-extra"
                      className="shrink-0"
                    >
                      <Plus className="mr-1 h-4 w-4" /> Adicionar extra
                    </Button>
                  </div>

                  {completionExtras.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {completionExtras.map((selection) => {
                        const definition = completionExtraDefinitionsById.get(selection.extraId);
                        const existing = completionExistingExtrasById.get(selection.extraId);
                        const amount = parseAppointmentExtraPriceInput(selection.amountEuros)
                          ?? existing?.amountCentsSnapshot
                          ?? definition?.amountCents
                          ?? 0;
                        return (
                          <div key={selection.extraId} className="flex items-start justify-between gap-4 text-sm">
                            <span className="min-w-0 break-words text-gray-200">
                              {existing?.nameSnapshot ?? definition?.name ?? "Extra indisponível"}
                              {selection.quantity > 1 ? ` × ${selection.quantity}` : ""}
                            </span>
                            <span className="shrink-0 font-semibold text-primary">
                              +{formatAppointmentPrice(amount * selection.quantity)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {isCompletionExtrasOpen && (
                    <div className="mt-3 space-y-2 border-t border-white/10 pt-3" data-testid="beauty-completion-extra-catalogue">
                      {isLoadingCompletionExtras ? (
                        <p className="text-sm text-gray-400">A carregar Extras...</p>
                      ) : completionVisibleExtraDefinitions.length === 0 && completionMissingExtras.length === 0 ? (
                        <p className="text-sm text-gray-400">Não existem Extras disponíveis para este serviço.</p>
                      ) : (
                        <>
                          {completionVisibleExtraDefinitions.map((extra) => {
                            const selection = completionExtras.find((candidate) => candidate.extraId === extra.id);
                            const existing = completionExistingExtrasById.get(extra.id);
                            const selected = Boolean(selection);
                            return (
                              <div key={extra.id} className="space-y-2 rounded-lg border border-white/10 bg-card/70 p-3">
                                <label htmlFor={`complete-appointment-extra-${extra.id}`} className="flex cursor-pointer items-start gap-3">
                                  <Checkbox
                                    id={`complete-appointment-extra-${extra.id}`}
                                    checked={selected}
                                    disabled={isAppointmentMutationPending}
                                    onCheckedChange={(checked) => setCompletionExtras((current) => checked
                                      ? current.some((candidate) => candidate.extraId === extra.id)
                                        ? current
                                        : [...current, {
                                            extraId: extra.id,
                                            amountEuros: centsToMoneyInput(extra.amountCents ?? 0),
                                            quantity: 1,
                                          }]
                                      : current.filter((candidate) => candidate.extraId !== extra.id))}
                                    aria-label={`Selecionar Extra ${extra.name}`}
                                  />
                                  <span className="min-w-0 flex-1 text-sm text-gray-200">
                                    {existing?.nameSnapshot ?? extra.name}
                                    {!extra.isActive && <span className="block text-[11px] text-amber-300">Inativo · apenas pode remover</span>}
                                  </span>
                                  <span className="shrink-0 text-sm font-semibold text-primary">
                                    {extra.pricingMode === "fixed" && (existing?.amountCentsSnapshot ?? extra.amountCents)
                                      ? formatAppointmentPrice(existing?.amountCentsSnapshot ?? extra.amountCents ?? 0)
                                      : "Variável"}
                                  </span>
                                </label>
                                {selected && (
                                  <div className="grid gap-2 pl-7 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                      <Label htmlFor={`complete-appointment-extra-amount-${extra.id}`} className="text-xs">Valor (€)</Label>
                                      <Input
                                        id={`complete-appointment-extra-amount-${extra.id}`}
                                        inputMode="decimal"
                                        value={selection?.amountEuros ?? ""}
                                        disabled={!extra.isActive || isAppointmentMutationPending}
                                        onChange={(event) => setCompletionExtras((current) => current.map((candidate) => candidate.extraId === extra.id
                                          ? { ...candidate, amountEuros: normalizeMoneyInput(event.target.value, candidate.amountEuros) }
                                          : candidate))}
                                        onBlur={() => setCompletionExtras((current) => current.map((candidate) => candidate.extraId === extra.id
                                          ? {
                                              ...candidate,
                                              amountEuros: formatMoneyInputOnBlur(candidate.amountEuros, {
                                                minCents: 1,
                                                maxCents: 1_000_000,
                                              }),
                                            }
                                          : candidate))}
                                        aria-label={`Valor do Extra ${extra.name}`}
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label htmlFor={`complete-appointment-extra-quantity-${extra.id}`} className="text-xs">Quantidade</Label>
                                      <Input
                                        id={`complete-appointment-extra-quantity-${extra.id}`}
                                        type="number"
                                        min={1}
                                        max={99}
                                        value={selection?.quantity ?? 1}
                                        disabled={!extra.isActive || isAppointmentMutationPending}
                                        onChange={(event) => setCompletionExtras((current) => current.map((candidate) => candidate.extraId === extra.id
                                          ? { ...candidate, quantity: Math.max(1, Math.min(99, Number(event.target.value) || 1)) }
                                          : candidate))}
                                        aria-label={`Quantidade do Extra ${extra.name}`}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {completionMissingExtras.map((extra) => (
                            <div key={extra.extraDefinitionId} className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
                              <label className="flex cursor-pointer items-start gap-3">
                                <Checkbox
                                  checked
                                  disabled={isAppointmentMutationPending}
                                  onCheckedChange={(checked) => {
                                    if (!checked) setCompletionExtras((current) => current.filter((candidate) => candidate.extraId !== extra.extraDefinitionId));
                                  }}
                                  aria-label={`Remover Extra ${extra.nameSnapshot}`}
                                />
                                <span className="min-w-0 flex-1 text-sm text-gray-200">{extra.nameSnapshot}</span>
                                <span className="shrink-0 text-sm font-semibold text-primary">{formatAppointmentPrice(extra.amountCentsSnapshot)}</span>
                              </label>
                            </div>
                          ))}
                        </>
                      )}
                      {incompleteCompletionExtra && (
                        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-300" role="alert">
                          <AlertTriangle className="h-3.5 w-3.5" /> Indique um valor superior a zero para cada Extra selecionado.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 p-3 text-base font-bold" data-testid="beauty-completion-total">
                  <span>Total</span>
                  <span className="text-primary">{formatAppointmentPrice(finalPrice + completionExtrasTotalCents)}</span>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Método de pagamento</p>
                  <AppointmentPaymentOptions
                    value={completionPaymentMethod ?? undefined}
                    onSelect={setCompletionPaymentMethod}
                    disabled={isAppointmentMutationPending}
                    pendingValue={pendingAction?.status === "completed" ? pendingAction.paymentMethod : null}
                  />
                </div>
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel disabled={isAppointmentMutationPending} className="border-white/10 bg-background text-white hover:bg-white/10">
                  Voltar
                </AlertDialogCancel>
                <Button
                  type="button"
                  variant="gold"
                  onClick={handleConfirmBeautyCompletion}
                  disabled={!completionPaymentMethod || Boolean(incompleteCompletionExtra) || isAppointmentMutationPending}
                  data-testid="beauty-completion-confirm"
                >
                  Concluir marcação
                </Button>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Como foi pago?</AlertDialogTitle>
                <AlertDialogDescription className="text-gray-400">
                  Esta escolha fica registada no relatório Excel e permite distinguir os pagamentos em dinheiro, Multibanco, vale/cupão e oferta.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AppointmentPaymentOptions
                onSelect={handleCompleteWithPayment}
                disabled={isAppointmentMutationPending}
                pendingValue={pendingAction?.status === "completed" ? pendingAction.paymentMethod : null}
              />
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isAppointmentMutationPending} className="border-white/10 bg-background text-white hover:bg-white/10">
                  Voltar
                </AlertDialogCancel>
              </AlertDialogFooter>
            </>
          )}
          <MutationPendingOverlay
            active={isAppointmentMutationPending}
            label={isBeautyCompletion ? "A concluir marcação..." : "A processar pagamento..."}
            logoUrl={locationLogoUrl}
          />
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
