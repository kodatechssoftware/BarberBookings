import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { format, startOfToday } from "date-fns";
import { pt } from "date-fns/locale";
import { AlertTriangle, Calendar as CalendarIcon, ChevronDown, User } from "lucide-react";
import { blockTimeOptions, outsideHoursBlockTimeOptions, type AppointmentBlockData } from "@/components/admin/AppointmentsTab";
import { AppointmentPaymentOptions } from "@/components/admin/AppointmentPaymentOptions";
import { MutationPendingOverlay } from "@/components/ui/mutation-pending-overlay";
import { Button } from "@/components/ui/button-custom";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  centsToMoneyInput,
  formatMoneyInputOnBlur,
  moneyInputToCents,
  normalizeMoneyInput,
} from "@/lib/money-input";
import { cn } from "@/lib/utils";
import { emailValidationMessage, isValidOptionalEmail } from "@shared/customer-validation";
import {
  createClockAlignedTimeOptions,
  type BookingSlotIntervalMinutes,
} from "@shared/booking-slot-interval";
import {
  PHONE_COUNTRIES,
  formatPhoneInput,
  getPhoneCountry,
  splitStoredPhone,
  toStoredPhone,
  type PhoneCountryCode,
} from "@shared/phone-countries";
import type { ExtraDefinition } from "@shared/schema";

type AppointmentBlockBarberOption = {
  id: number;
  name: string;
};

type AppointmentBlockServiceOption = {
  id: number;
  name: string;
  duration: number;
  price: number;
};

type AppointmentBlockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barbers?: AppointmentBlockBarberOption[];
  manualBookingServices: AppointmentBlockServiceOption[];
  extras: ExtraDefinition[];
  isLoadingExtras?: boolean;
  blockData: AppointmentBlockData;
  onBlockDataChange: Dispatch<SetStateAction<AppointmentBlockData>>;
  isCalendarOpen: boolean;
  onCalendarOpenChange: (open: boolean) => void;
  availableBlockTimes: string[];
  bookingSlotIntervalMinutes: BookingSlotIntervalMinutes;
  isCheckingAvailability?: boolean;
  canCreateAsCompleted: boolean;
  onSubmit: () => void;
  isSubmitting?: boolean;
  locationLogoUrl?: string | null;
};

export function AppointmentBlockDialog({
  open,
  onOpenChange,
  barbers,
  manualBookingServices,
  extras,
  isLoadingExtras = false,
  blockData,
  onBlockDataChange,
  isCalendarOpen,
  onCalendarOpenChange,
  availableBlockTimes,
  bookingSlotIntervalMinutes,
  isCheckingAvailability = false,
  canCreateAsCompleted,
  onSubmit,
  isSubmitting = false,
  locationLogoUrl,
}: AppointmentBlockDialogProps) {
  const [isEmailTouched, setIsEmailTouched] = useState(false);
  const [isExtrasOpen, setIsExtrasOpen] = useState(false);
  const isSingleTimeMode = blockData.isManualBooking;
  const manualBookingTimeOptions = [
    ...createClockAlignedTimeOptions({
      startMinute: 9 * 60,
      endMinuteExclusive: 13 * 60,
      intervalMinutes: bookingSlotIntervalMinutes,
    }),
    ...createClockAlignedTimeOptions({
      startMinute: 14 * 60,
      endMinuteExclusive: 20 * 60,
      intervalMinutes: bookingSlotIntervalMinutes,
    }),
  ];
  const manualBookingOutsideHoursTimeOptions = createClockAlignedTimeOptions({
    startMinute: 6 * 60,
    endMinuteExclusive: 23 * 60,
    intervalMinutes: bookingSlotIntervalMinutes,
  });
  const visibleBlockTimeOptions = blockData.isManualBooking
    ? blockData.allowOutsideHours ? manualBookingOutsideHoursTimeOptions : manualBookingTimeOptions
    : blockData.allowOutsideHours ? outsideHoursBlockTimeOptions : blockTimeOptions;
  const morningBlockTimes = visibleBlockTimeOptions.filter((time) => time < "13:00");
  const afternoonBlockTimes = visibleBlockTimeOptions.filter((time) => time >= "14:00");
  const today = startOfToday();
  const recurringStartsInPast = blockData.isRecurring && blockData.date < today;
  const manualPhoneParts = splitStoredPhone(blockData.phone);
  const manualPhoneCountry = getPhoneCountry(manualPhoneParts.countryCode);
  const showEmailError = blockData.isManualBooking && isEmailTouched && !isValidOptionalEmail(blockData.email);
  const selectedService = manualBookingServices.find((service) => String(service.id) === blockData.serviceId);
  const showSpecialTerms = blockData.isManualBooking && blockData.hasSpecialTerms && !blockData.isRecurring;
  const selectedExtras = extras.filter((extra) => blockData.extras.some((selection) => selection.extraId === extra.id));

  const formatPrice = (priceCents: number) => `${centsToMoneyInput(priceCents)} €`;
  const activeServicePrice = blockData.serviceMode === "custom"
    ? blockData.customServicePrice
    : blockData.existingServicePrice;
  const effectiveServicePriceCents = showSpecialTerms
    ? moneyInputToCents(activeServicePrice, { maxCents: 1_000_000 })
    : selectedService?.price ?? null;
  const effectiveServiceName = showSpecialTerms && blockData.serviceMode === "custom"
    ? blockData.customServiceName.trim()
    : selectedService?.name ?? "";
  const selectedExtraRows = selectedExtras.map((extra) => {
    const selection = blockData.extras.find((candidate) => candidate.extraId === extra.id);
    return {
      ...extra,
      effectiveAmountCents: extra.pricingMode === "fixed"
        ? extra.amountCents
        : moneyInputToCents(selection?.amountEuros ?? "", { minCents: 1, maxCents: 1_000_000 }),
    };
  });
  const extrasTotalCents = selectedExtraRows.reduce(
    (total, extra) => total + (extra.effectiveAmountCents ?? 0),
    0,
  );
  const incompleteVariableExtra = selectedExtraRows.find((extra) =>
    extra.pricingMode === "variable" && extra.effectiveAmountCents === null);
  const selectedExtrasCount = blockData.extras.length;
  const extrasHeading = selectedExtrasCount === 0
    ? "Extras (opcional)"
    : `Extras (${selectedExtrasCount} ${selectedExtrasCount === 1 ? "selecionado" : "selecionados"})`;

  useEffect(() => {
    if (!open) {
      setIsEmailTouched(false);
      setIsExtrasOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!blockData.isManualBooking || blockData.isRecurring) setIsExtrasOpen(false);
  }, [blockData.isManualBooking, blockData.isRecurring]);

  useEffect(() => {
    onBlockDataChange((current) => {
      let changed = false;
      const normalizedExtras = current.extras.map((selection) => {
        const definition = extras.find((extra) => extra.id === selection.extraId);
        if (definition?.pricingMode === "fixed" && selection.amountEuros) {
          changed = true;
          return { ...selection, amountEuros: "" };
        }
        return selection;
      });
      return changed ? { ...current, extras: normalizedExtras } : current;
    });
  }, [extras, onBlockDataChange]);

  const setQuickBlockTimes = (times: string[]) => {
    const available = times.filter((time) => availableBlockTimes.includes(time));
    onBlockDataChange({ ...blockData, times: available });
  };

  const handleTimeClick = (time: string) => {
    if (isSingleTimeMode) {
      onBlockDataChange({
        ...blockData,
        times: blockData.times.includes(time) ? [] : [time],
      });
      return;
    }

    onBlockDataChange({
      ...blockData,
      times: blockData.times.includes(time)
        ? blockData.times.filter((selectedTime) => selectedTime !== time)
        : [...blockData.times, time],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-busy={isSubmitting}
        className="grid max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-2xl border-white/10 bg-card p-0 text-white shadow-2xl backdrop-blur-md sm:w-[94vw] sm:max-w-2xl"
      >
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
                <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-background/50 px-3 py-3">
                  <div>
                    <Label htmlFor="multiDay" className="cursor-pointer text-sm font-medium">Bloquear vários dias</Label>
                    <p className="text-xs text-gray-500">Ideal para férias ou ausências completas.</p>
                  </div>
                  <Switch
                    id="multiDay"
                    checked={blockData.isMultiDay}
                    onCheckedChange={(checked) => onBlockDataChange({ ...blockData, isMultiDay: checked, isManualBooking: false, isRecurring: false })}
                  />
                </div>
              )}

              {blockData.isManualBooking && (
                <div className="mt-4 grid gap-3">
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-background/50 px-3 py-3">
                    <div>
                      <Label htmlFor="outsideHours" className="cursor-pointer text-sm font-medium">Permitir horários fora do horário normal</Label>
                      <p className="text-xs text-gray-500">Ative apenas quando precisar de registar uma marcação num horário em que o barbeiro normalmente não trabalha.</p>
                    </div>
                    <Switch
                      id="outsideHours"
                      checked={blockData.allowOutsideHours}
                      onCheckedChange={(checked) => onBlockDataChange({
                        ...blockData,
                        allowOutsideHours: checked,
                        times: [],
                      })}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-background/50 px-3 py-3">
                    <div>
                      <Label htmlFor="specialTerms" className="cursor-pointer text-sm font-medium">Condições especiais desta marcação</Label>
                      <p className="text-xs text-gray-500">
                        {blockData.isRecurring
                          ? "Não disponível em marcações recorrentes."
                          : "Ajuste o serviço, a duração ou o preço apenas para esta marcação."}
                      </p>
                    </div>
                    <Switch
                      id="specialTerms"
                      checked={blockData.hasSpecialTerms}
                      disabled={blockData.isRecurring}
                      onCheckedChange={(checked) => onBlockDataChange({
                        ...blockData,
                        hasSpecialTerms: checked,
                        serviceMode: "existing",
                        customServiceName: "",
                        customDurationMinutes: "30",
                        existingServicePrice: checked && selectedService
                          ? centsToMoneyInput(selectedService.price)
                          : "",
                        customServicePrice: "",
                      })}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-background/50 px-3 py-3">
                    <div>
                      <Label htmlFor="recurring" className="cursor-pointer text-sm font-medium">Repetir marcação</Label>
                      <p className="text-xs text-gray-500">Reserva automática para clientes fixos.</p>
                    </div>
                    <Switch
                      id="recurring"
                      checked={blockData.isRecurring}
                      onCheckedChange={(checked) => onBlockDataChange({
                        ...blockData,
                        date: checked && blockData.date < today ? today : blockData.date,
                        endDate: checked && blockData.endDate < today ? today : blockData.endDate,
                        isRecurring: checked,
                        isMultiDay: false,
                        hasSpecialTerms: false,
                        isAlreadyCompleted: false,
                        paymentMethod: "pending",
                        serviceMode: "existing",
                        customServiceName: "",
                        customDurationMinutes: "30",
                        existingServicePrice: "",
                        customServicePrice: "",
                        extras: [],
                        times: checked ? blockData.times.slice(0, 1) : blockData.times,
                      })}
                    />
                  </div>
                </div>
              )}
            </div>

            {blockData.isRecurring && (
              <div className="grid grid-cols-1 gap-4 rounded-xl border border-primary/10 bg-primary/5 p-4 min-[420px]:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">Repetir a cada (semanas)</Label>
                  <Select value={blockData.recurringWeeks} onValueChange={(value) => onBlockDataChange({ ...blockData, recurringWeeks: value })}>
                    <SelectTrigger className="h-11 border-white/10 bg-background/50"><SelectValue /></SelectTrigger>
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
                  <Select value={blockData.recurringMonths} onValueChange={(value) => onBlockDataChange({ ...blockData, recurringMonths: value })}>
                    <SelectTrigger className="h-11 border-white/10 bg-background/50"><SelectValue /></SelectTrigger>
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <Label className="text-sm font-medium text-gray-300">{blockData.isMultiDay ? "Início" : "Data"}</Label>
                <Popover open={isCalendarOpen} onOpenChange={onCalendarOpenChange}>
                  <PopoverTrigger asChild>
                    <Button data-testid="manual-booking-date-trigger" variant="outline" className="h-12 w-full justify-start gap-2 rounded-xl border-white/10 bg-background/50 text-white">
                      <CalendarIcon className="h-4 w-4" />{format(blockData.date, "dd/MM/yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 bg-card border-white/10">
                    <Calendar
                      mode="single"
                      selected={blockData.date}
                      onSelect={(date) => {
                        if (!date) return;
                        onBlockDataChange({ ...blockData, date });
                        onCalendarOpenChange(false);
                      }}
                      disabled={blockData.isRecurring ? (date) => date < today : undefined}
                      locale={pt}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                {recurringStartsInPast && (
                  <p className="text-xs text-red-300">A recorrência deve começar hoje ou numa data futura.</p>
                )}
              </div>

              {blockData.isMultiDay && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium text-gray-300">Fim</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="h-12 w-full justify-start gap-2 rounded-xl border-white/10 bg-background/50 text-white">
                        <CalendarIcon className="h-4 w-4" />{format(blockData.endDate, "dd/MM/yyyy")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 bg-card border-white/10">
                      <Calendar
                        mode="single"
                        selected={blockData.endDate}
                        onSelect={(date) => date && onBlockDataChange({ ...blockData, endDate: date })}
                        disabled={(date) => date < blockData.date}
                        locale={pt}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <Label className="text-sm font-medium text-gray-300">Barbeiro</Label>
                <Select value={blockData.barberId} onValueChange={(value) => onBlockDataChange({ ...blockData, barberId: value })}>
                  <SelectTrigger className="h-12 rounded-xl border-white/10 bg-background/50 text-white">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10 text-white">
                    {barbers?.map((barber) => (
                      <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {blockData.isManualBooking && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium text-gray-300">Serviço</Label>
                  {blockData.serviceMode === "existing" ? (
                    <Select
                      value={blockData.serviceId}
                      onValueChange={(value) => {
                        const service = manualBookingServices.find((candidate) => String(candidate.id) === value);
                        onBlockDataChange({
                          ...blockData,
                          serviceId: value,
                          existingServicePrice: blockData.hasSpecialTerms && service
                            ? centsToMoneyInput(service.price)
                            : "",
                        });
                      }}
                    >
                      <SelectTrigger className="h-12 rounded-xl border-white/10 bg-background/50 text-white">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-white/10 text-white">
                        {manualBookingServices.map((service) => (
                          <SelectItem key={service.id} value={String(service.id)}>{service.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex h-12 items-center rounded-xl border border-primary/20 bg-primary/5 px-4 text-sm font-semibold text-primary">
                      Serviço personalizado desta marcação
                    </div>
                  )}
                  {blockData.barberId && manualBookingServices.length === 0 && (
                    <p className="text-xs text-red-300">Este barbeiro não tem serviços associados.</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <Label className="text-sm font-medium text-gray-300">{blockData.isManualBooking ? "Hora da marcação" : "Horas afetadas"}</Label>
                  <p className="text-xs text-gray-500">
                    {blockData.times.length > 0
                      ? `${blockData.times.length} horário${blockData.times.length === 1 ? "" : "s"} selecionado${blockData.times.length === 1 ? "" : "s"}`
                      : blockData.isManualBooking
                        ? blockData.isRecurring ? "Escolha a hora que se repete." : "Escolha a hora de início."
                        : "Escolha uma ou mais horas."}
                  </p>
                </div>
                {!isSingleTimeMode && (
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    <Button type="button" variant="outline" size="sm" className="h-10 text-xs sm:h-8" onClick={() => setQuickBlockTimes(morningBlockTimes)}>
                      Manhã
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-10 text-xs sm:h-8" onClick={() => setQuickBlockTimes(afternoonBlockTimes)}>
                      Tarde
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-10 text-xs sm:h-8" onClick={() => setQuickBlockTimes(visibleBlockTimeOptions)}>
                      Dia inteiro
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-10 text-xs text-gray-400 sm:h-8" onClick={() => onBlockDataChange({ ...blockData, times: [] })}>
                      Limpar
                    </Button>
                  </div>
                )}
              </div>

              {!blockData.barberId && (
                <div className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
                  Escolha primeiro o barbeiro para ver apenas horas livres.
                </div>
              )}

              <div className="grid max-h-[34dvh] grid-cols-3 gap-2 overflow-y-auto p-1 scrollbar-thin min-[380px]:grid-cols-4 sm:max-h-48 sm:grid-cols-5">
                {visibleBlockTimeOptions.map((time) => {
                  const isAvailable = availableBlockTimes.includes(time);

                  return (
                    <Button
                      key={time}
                      type="button"
                      variant={blockData.times.includes(time) ? "gold" : "outline"}
                      size="sm"
                      className="h-11 rounded-lg text-xs disabled:border-white/5 disabled:bg-black/20 disabled:text-gray-600 disabled:opacity-100 sm:h-10"
                      disabled={!isAvailable}
                      aria-pressed={blockData.times.includes(time)}
                      data-availability={isAvailable ? "available" : "unavailable"}
                      title={isAvailable ? undefined : "Indisponível"}
                      onClick={() => handleTimeClick(time)}
                    >
                      {time}
                    </Button>
                  );
                })}
              </div>

              {isCheckingAvailability && blockData.barberId && (
                <div className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
                  A atualizar disponibilidade deste dia...
                </div>
              )}

              {!isCheckingAvailability && availableBlockTimes.length === 0 && blockData.barberId && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  Não há horas disponíveis para este dia e barbeiro.
                </div>
              )}
            </div>

            {blockData.isManualBooking && !blockData.isRecurring && canCreateAsCompleted && (
              <div
                className="space-y-4 rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-4"
                data-testid="manual-booking-completion"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label htmlFor="manual-booking-already-completed" className="cursor-pointer font-bold text-emerald-100">
                      Marcação já realizada
                    </Label>
                    <p className="mt-1 text-xs text-emerald-100/75">
                      O período desta marcação já terminou. Ative para a registar diretamente como concluída.
                    </p>
                  </div>
                  <Switch
                    id="manual-booking-already-completed"
                    checked={blockData.isAlreadyCompleted}
                    onCheckedChange={(checked) => onBlockDataChange({
                      ...blockData,
                      isAlreadyCompleted: checked,
                      paymentMethod: checked ? blockData.paymentMethod : "pending",
                    })}
                  />
                </div>

                {blockData.isAlreadyCompleted && (
                  <div className="space-y-3 border-t border-emerald-100/15 pt-4">
                    <div>
                      <p className="text-sm font-semibold text-white">Como foi pago?</p>
                      <p className="mt-1 text-xs text-gray-400">
                        A escolha fica guardada no Dashboard, no financeiro e no relatório Excel.
                      </p>
                    </div>
                    <AppointmentPaymentOptions
                      value={blockData.paymentMethod}
                      onSelect={(paymentMethod) => onBlockDataChange({ ...blockData, paymentMethod })}
                      disabled={isSubmitting}
                    />
                  </div>
                )}
              </div>
            )}

            {showSpecialTerms && (
              <div className="space-y-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4" data-testid="manual-booking-special-terms">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div>
                    <p className="font-bold text-amber-100">Condições especiais desta marcação</p>
                    <p className="mt-1 text-xs text-amber-100/75">Estas alterações aplicam-se apenas a esta marcação e não modificam o catálogo.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-background/40 p-1">
                  <Button
                    type="button"
                    variant={blockData.serviceMode === "existing" ? "gold" : "ghost"}
                    className="h-10 text-xs"
                    onClick={() => onBlockDataChange({
                      ...blockData,
                      serviceMode: "existing",
                    })}
                  >
                    Serviço existente
                  </Button>
                  <Button
                    type="button"
                    variant={blockData.serviceMode === "custom" ? "gold" : "ghost"}
                    className="h-10 text-xs"
                    onClick={() => onBlockDataChange({
                      ...blockData,
                      serviceMode: "custom",
                    })}
                  >
                    Serviço personalizado
                  </Button>
                </div>

                {blockData.serviceMode === "existing" ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-white/10 bg-background/40 p-3">
                      <p className="text-xs text-gray-400">Duração habitual</p>
                      <p className="mt-1 font-semibold text-white">{selectedService ? `${selectedService.duration} min` : "—"}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-background/40 p-3">
                      <p className="text-xs text-gray-400">Preço habitual</p>
                      <p className="mt-1 font-semibold text-white">{selectedService ? formatPrice(selectedService.price) : "—"}</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manual-booking-special-price" className="text-xs text-gray-300">Preço desta marcação (€)</Label>
                      <Input
                        id="manual-booking-special-price"
                        inputMode="decimal"
                        value={blockData.existingServicePrice}
                        onChange={(event) => onBlockDataChange((current) => ({
                          ...current,
                          existingServicePrice: normalizeMoneyInput(
                            event.target.value,
                            current.existingServicePrice,
                          ),
                        }))}
                        onBlur={() => onBlockDataChange((current) => ({
                          ...current,
                          existingServicePrice: formatMoneyInputOnBlur(
                            current.existingServicePrice,
                            { maxCents: 1_000_000 },
                          ),
                        }))}
                        className="h-11 border-white/10 bg-background/50 text-white"
                        placeholder="Ex.: 25,00"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-2 sm:col-span-3">
                      <Label htmlFor="manual-booking-custom-service" className="text-xs text-gray-300">Descrição do serviço</Label>
                      <Input
                        id="manual-booking-custom-service"
                        value={blockData.customServiceName}
                        maxLength={100}
                        onChange={(event) => onBlockDataChange({ ...blockData, customServiceName: event.target.value })}
                        className="h-11 border-white/10 bg-background/50 text-white"
                        placeholder="Ex.: Lavar e pentear – casamento"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manual-booking-custom-duration" className="text-xs text-gray-300">Duração (min)</Label>
                      <Input
                        id="manual-booking-custom-duration"
                        type="number"
                        min="1"
                        max="720"
                        step="1"
                        value={blockData.customDurationMinutes}
                        onChange={(event) => onBlockDataChange({ ...blockData, customDurationMinutes: event.target.value })}
                        className="h-11 border-white/10 bg-background/50 text-white"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="manual-booking-custom-price" className="text-xs text-gray-300">Preço (€)</Label>
                      <Input
                        id="manual-booking-custom-price"
                        inputMode="decimal"
                        value={blockData.customServicePrice}
                        onChange={(event) => onBlockDataChange((current) => ({
                          ...current,
                          customServicePrice: normalizeMoneyInput(
                            event.target.value,
                            current.customServicePrice,
                          ),
                        }))}
                        onBlur={() => onBlockDataChange((current) => ({
                          ...current,
                          customServicePrice: formatMoneyInputOnBlur(
                            current.customServicePrice,
                            { maxCents: 1_000_000 },
                          ),
                        }))}
                        className="h-11 border-white/10 bg-background/50 text-white"
                        placeholder="Ex.: 30,00"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {blockData.isManualBooking && !blockData.isRecurring && (isLoadingExtras || extras.length > 0) && (
              <Collapsible
                open={isExtrasOpen}
                onOpenChange={setIsExtrasOpen}
                className={cn(
                  "overflow-hidden rounded-xl border bg-background/30",
                  incompleteVariableExtra ? "border-amber-400/40" : "border-white/10",
                )}
                data-testid="manual-booking-extras"
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    data-testid="manual-booking-extras-trigger"
                  >
                    <span className="min-w-0">
                      <span className="block font-bold text-white">{extrasHeading}</span>
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
                <CollapsibleContent className="space-y-3 border-t border-white/10 p-4" data-testid="manual-booking-extras-content">
                  <p className="text-xs text-gray-400">Selecione um ou vários Extras para esta marcação.</p>
                  {isLoadingExtras ? (
                    <p className="text-xs text-gray-500">A carregar Extras...</p>
                  ) : (
                    <div className="space-y-2">
                    {extras.map((extra) => {
                      const checkboxId = `manual-booking-extra-${extra.id}`;
                      const amountId = `manual-booking-extra-amount-${extra.id}`;
                      const selection = blockData.extras.find((candidate) => candidate.extraId === extra.id);
                      const isSelected = Boolean(selection);
                      return (
                        <div
                          key={extra.id}
                          className="space-y-3 rounded-lg border border-white/10 bg-card/60 px-3 py-2.5"
                        >
                          <label htmlFor={checkboxId} className="flex min-h-6 cursor-pointer items-center gap-3">
                            <Checkbox
                              id={checkboxId}
                              checked={isSelected}
                              onCheckedChange={(checked) => onBlockDataChange((current) => ({
                                ...current,
                                extras: checked
                                  ? current.extras.some((candidate) => candidate.extraId === extra.id)
                                    ? current.extras
                                    : [...current.extras, { extraId: extra.id, amountEuros: "" }]
                                  : current.extras.filter((candidate) => candidate.extraId !== extra.id),
                              }))}
                              aria-label={`Selecionar Extra ${extra.name}`}
                            />
                            <span className="min-w-0 flex-1 break-words text-sm text-gray-200">{extra.name}</span>
                            <span className="shrink-0 text-sm font-semibold text-primary">
                              {extra.pricingMode === "fixed"
                                ? `+${formatPrice(extra.amountCents!)}`
                                : "Valor variável"}
                            </span>
                          </label>
                          {isSelected && extra.pricingMode === "variable" && (
                            <div className="space-y-2 pl-7">
                              <Label htmlFor={amountId} className="text-xs text-gray-300">Valor (€)</Label>
                              <Input
                                id={amountId}
                                inputMode="decimal"
                                value={selection?.amountEuros ?? ""}
                                onChange={(event) => onBlockDataChange((current) => ({
                                  ...current,
                                  extras: current.extras.map((candidate) => candidate.extraId === extra.id
                                    ? {
                                        ...candidate,
                                        amountEuros: normalizeMoneyInput(event.target.value, candidate.amountEuros),
                                      }
                                    : candidate),
                                }))}
                                onBlur={() => onBlockDataChange((current) => ({
                                  ...current,
                                  extras: current.extras.map((candidate) => candidate.extraId === extra.id
                                    ? {
                                        ...candidate,
                                        amountEuros: formatMoneyInputOnBlur(candidate.amountEuros, {
                                          minCents: 1,
                                          maxCents: 1_000_000,
                                        }),
                                      }
                                    : candidate),
                                }))}
                                placeholder="Ex.: 18,00"
                                aria-label={`Valor do Extra ${extra.name}`}
                                className="h-11 border-white/10 bg-background text-white"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}

            {blockData.isManualBooking && effectiveServicePriceCents !== null && effectiveServiceName && (
              <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4" data-testid="manual-booking-summary">
                <div>
                  <p className="font-bold text-white">Resumo da marcação</p>
                  {showSpecialTerms && <p className="mt-1 text-xs text-gray-400">{effectiveServiceName}</p>}
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <span className="min-w-0 break-words text-gray-300">
                      {showSpecialTerms ? "Preço especial" : "Serviço"}
                    </span>
                    <span className="shrink-0 font-medium text-white">{formatPrice(effectiveServicePriceCents)}</span>
                  </div>
                  {selectedExtraRows.map((extra) => (
                    <div key={extra.id} className="flex items-start justify-between gap-4">
                      <span className="min-w-0 break-words text-gray-300">{extra.name}</span>
                      <span className="shrink-0 font-medium text-white">
                        {extra.effectiveAmountCents === null
                          ? "Por definir"
                          : formatPrice(extra.effectiveAmountCents)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-3 font-bold">
                    <span className="text-white">Total</span>
                    <span className="shrink-0 text-primary">{formatPrice(effectiveServicePriceCents + extrasTotalCents)}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <Label htmlFor="manual-booking-name" className="text-sm font-medium text-gray-300">
                  {blockData.isManualBooking ? "Nome do cliente" : "Motivo / nota"}
                </Label>
                <Input
                  id="manual-booking-name"
                  value={blockData.name}
                  onChange={(event) => onBlockDataChange({ ...blockData, name: event.target.value })}
                  className="h-12 rounded-xl border-white/10 bg-background/50 text-white"
                  placeholder={blockData.isManualBooking ? "Ex.: João Silva" : "Ex.: Férias ou assunto pessoal"}
                  autoComplete={blockData.isManualBooking ? "name" : "off"}
                  maxLength={80}
                />
              </div>

              {blockData.isManualBooking && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium text-gray-300">Telemóvel (opcional)</Label>
                  <div className="flex h-12 overflow-hidden rounded-xl border border-white/10 bg-background/50 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/40">
                    <div className="relative shrink-0 border-r border-white/10">
                      <select
                        aria-label="País do telemóvel da marcação manual"
                        className="h-full w-[116px] appearance-none bg-transparent px-3 pr-6 text-sm font-semibold text-primary outline-none"
                        value={manualPhoneParts.countryCode}
                        onChange={(event) => {
                          const country = getPhoneCountry(event.target.value as PhoneCountryCode);
                          onBlockDataChange({ ...blockData, phone: country.dialCode });
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
                      id="manual-booking-phone"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      maxLength={manualPhoneCountry.maxDigits}
                      value={manualPhoneParts.localPhone}
                      onChange={(event) => onBlockDataChange({
                        ...blockData,
                        phone: toStoredPhone(
                          formatPhoneInput(event.target.value, manualPhoneCountry.maxDigits),
                          manualPhoneParts.countryCode,
                        ),
                      })}
                      className="h-full min-w-0 rounded-none border-0 bg-transparent text-white focus-visible:ring-0 focus-visible:ring-offset-0"
                      placeholder={manualPhoneCountry.placeholder}
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-gray-400">
                    Com um número válido, a confirmação e as atualizações serão enviadas por WhatsApp.
                  </p>
                </div>
              )}
            </div>

            {blockData.isManualBooking && (
              <div className="space-y-3">
                <Label htmlFor="manual-booking-email" className="text-sm font-medium text-gray-300">
                  Email (opcional)
                </Label>
                <Input
                  id="manual-booking-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={120}
                  value={blockData.email}
                  onChange={(event) => onBlockDataChange({ ...blockData, email: event.target.value })}
                  onBlur={() => setIsEmailTouched(true)}
                  className={cn(
                    "h-12 rounded-xl bg-background/50 text-white focus:border-primary",
                    showEmailError ? "border-red-500 focus:border-red-500" : "border-white/10",
                  )}
                  placeholder="exemplo@email.com"
                  aria-invalid={showEmailError}
                  aria-describedby={showEmailError ? "manual-booking-email-error" : "manual-booking-email-help"}
                />
                {showEmailError ? (
                  <p id="manual-booking-email-error" className="text-xs font-medium text-red-400">
                    {emailValidationMessage}
                  </p>
                ) : (
                  <p id="manual-booking-email-help" className="text-xs leading-relaxed text-gray-400">
                    Este email será utilizado como alternativa para receber confirmações e atualizações da marcação caso o envio por WhatsApp não seja possível.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-white/10 bg-card/95 px-5 py-4 sm:px-6">
          <Button
            data-testid="appointment-block-submit"
            type="button"
            variant="gold"
            className="h-12 w-full rounded-xl text-base font-bold"
            disabled={
              isSubmitting ||
              isCheckingAvailability ||
              !blockData.barberId ||
              blockData.times.length === 0 ||
              (blockData.isManualBooking && blockData.times.length !== 1) ||
              (blockData.isAlreadyCompleted && blockData.paymentMethod === "pending") ||
              (blockData.isManualBooking && (!blockData.hasSpecialTerms || blockData.serviceMode === "existing") && !blockData.serviceId) ||
              (blockData.isManualBooking && blockData.hasSpecialTerms && blockData.serviceMode === "custom" && !blockData.customServiceName.trim())
            }
            onClick={() => {
              if (blockData.isManualBooking) setIsEmailTouched(true);
              if (incompleteVariableExtra) {
                setIsExtrasOpen(true);
                window.setTimeout(() => {
                  document.getElementById(`manual-booking-extra-amount-${incompleteVariableExtra.id}`)?.focus();
                }, 0);
              }
              onSubmit();
            }}
          >
            {isSubmitting
              ? blockData.isManualBooking ? "A criar marcação..." : "A guardar ausência..."
              : blockData.isManualBooking ? "Criar marcação" : "Guardar ausência"}
          </Button>
        </div>
        <MutationPendingOverlay
          active={isSubmitting}
          label={blockData.isManualBooking ? "A criar marcação..." : "A guardar ausência..."}
          logoUrl={locationLogoUrl}
        />
      </DialogContent>
    </Dialog>
  );
}
