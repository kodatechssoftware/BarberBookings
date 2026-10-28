import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Instagram,
  Loader2,
  RefreshCw,
  Share2,
} from "lucide-react";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { Button } from "@/components/ui/button-custom";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePublicAppointments } from "@/hooks/use-appointments";
import { usePublicBookingWindow } from "@/hooks/use-public-booking-window";
import { getAvailableTimeSlots, type AvailabilityRow, type ShopAvailabilityRow } from "@/lib/availability";
import {
  AVAILABILITY_SOCIAL_FORMATS,
  AVAILABILITY_SOCIAL_TEMPLATES,
  availabilityCanvasToPng,
  formatAvailabilitySocialServiceLine,
  renderAvailabilitySocialImage,
  sanitizeAvailabilitySocialFileName,
  type AvailabilitySocialFormat,
  type AvailabilitySocialImageInput,
  type AvailabilitySocialTemplate,
} from "@/lib/availability-social-image";
import { resolveLocationLogoUrl, shopBranding } from "@/lib/branding";
import { resolvePublicBookingUrl } from "@/lib/public-booking-link";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { ShopLocation } from "@shared/locations";
import type { BookingSlotIntervalMinutes } from "@shared/booking-slot-interval";

type PromotionBarber = {
  id: number;
  name: string;
  isVisible?: boolean | null;
  serviceIds?: number[] | null;
};

type PromotionService = {
  id: number;
  name: string;
  duration?: number;
  isVisible?: boolean | null;
  isActive?: boolean;
};

type AvailabilityPromotionTabProps = {
  location?: ShopLocation;
  publicBaseUrl?: string;
  barbers?: PromotionBarber[];
  services?: PromotionService[];
  availabilityRows: AvailabilityRow[];
  shopAvailabilityRows: ShopAvailabilityRow[];
  bookingSlotIntervalMinutes: BookingSlotIntervalMinutes;
};

const MAX_SELECTED_SLOTS = 8;

function dateKeyToCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addCalendarDays(value: string, days: number) {
  const date = dateKeyToCalendarDate(value);
  if (!date) return value;
  date.setDate(date.getDate() + days);
  return format(date, "yyyy-MM-dd");
}

function capitalize(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function formatPromotionDate(value: string, timeZone: string) {
  const date = dateKeyToCalendarDate(value);
  if (!date) return value;
  return capitalize(new Intl.DateTimeFormat("pt-PT", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date));
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyTextWithFallback(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the selection-based browser fallback.
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export default function AvailabilityPromotionTab({
  location,
  publicBaseUrl,
  barbers,
  services,
  availabilityRows,
  shopAvailabilityRows,
  bookingSlotIntervalMinutes,
}: AvailabilityPromotionTabProps) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bookingLinkRef = useRef<HTMLInputElement>(null);
  const hasInitializedSlots = useRef(false);
  const [selectedDateKey, setSelectedDateKey] = useState("");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [visibleCalendarMonth, setVisibleCalendarMonth] = useState<Date>();
  const [validatedAvailabilitySelectionKey, setValidatedAvailabilitySelectionKey] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [selectedBarberId, setSelectedBarberId] = useState("all");
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [title, setTitle] = useState("Vagas disponíveis");
  const [template, setTemplate] = useState<AvailabilitySocialTemplate>("classic");
  const [imageFormat, setImageFormat] = useState<AvailabilitySocialFormat>("story");
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState("");
  const [isInstagramPreparationOpen, setIsInstagramPreparationOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [storyDownloaded, setStoryDownloaded] = useState(false);

  const {
    data: bookingWindow,
    isLoading: isLoadingBookingWindow,
    isError: isBookingWindowError,
  } = usePublicBookingWindow();
  const tomorrowDateKey = bookingWindow ? addCalendarDays(bookingWindow.today, 1) : "";
  const canSelectTomorrow = Boolean(bookingWindow && tomorrowDateKey <= bookingWindow.maxDate);

  const visibleBarbers = useMemo(
    () => (barbers ?? []).filter((barber) => barber.isVisible !== false),
    [barbers],
  );
  const visibleServices = useMemo(
    () => (services ?? []).filter((service) => service.isVisible !== false && service.isActive !== false && Number(service.duration) > 0),
    [services],
  );

  useEffect(() => {
    if (!bookingWindow || selectedDateKey) return;
    setSelectedDateKey(bookingWindow.today);
    setVisibleCalendarMonth(dateKeyToCalendarDate(bookingWindow.today) ?? undefined);
    setTitle("Vagas de hoje");
  }, [bookingWindow, selectedDateKey]);

  useEffect(() => {
    if (selectedServiceId && visibleServices.some((service) => String(service.id) === selectedServiceId)) return;
    setSelectedServiceId(visibleServices[0] ? String(visibleServices[0].id) : "");
  }, [selectedServiceId, visibleServices]);

  useEffect(() => {
    if (selectedBarberId === "all" || visibleBarbers.some((barber) => String(barber.id) === selectedBarberId)) return;
    setSelectedBarberId("all");
  }, [selectedBarberId, visibleBarbers]);

  const selectedService = visibleServices.find((service) => String(service.id) === selectedServiceId);
  const selectedBarber = visibleBarbers.find((barber) => String(barber.id) === selectedBarberId);
  const selectedDate = useMemo(() => dateKeyToCalendarDate(selectedDateKey), [selectedDateKey]);
  const timeZone = location?.timezone || "Europe/Lisbon";
  const locationId = location?.id;
  const canQueryAvailability = Boolean(selectedDateKey && selectedService && locationId);
  const {
    data: appointments,
    isLoading: isLoadingAppointments,
    isFetching: isFetchingAppointments,
    isError: isAppointmentsError,
    dataUpdatedAt,
    refetch: refetchAppointments,
  } = usePublicAppointments({
    locationId,
    barberId: selectedBarberId === "all" ? undefined : selectedBarberId,
    date: selectedDateKey || undefined,
    enabled: canQueryAvailability,
    refetchInterval: 30_000,
  });

  const availableSlots = useMemo(() => {
    if (!selectedService || !selectedDate || appointments === undefined) return [];
    return getAvailableTimeSlots({
      selectedService: { id: selectedService.id, duration: Number(selectedService.duration) },
      selectedDate,
      selectedBarberId: selectedBarberId === "all" ? 0 : Number(selectedBarberId),
      visibleBarbers,
      availabilityRows,
      shopAvailabilityRows,
      existingAppointments: appointments,
      timeZone,
      slotIntervalMinutes: bookingSlotIntervalMinutes,
    }).filter((slot) => slot.available).map((slot) => slot.time);
  }, [appointments, availabilityRows, bookingSlotIntervalMinutes, selectedBarberId, selectedDate, selectedService, shopAvailabilityRows, timeZone, visibleBarbers]);

  const availabilitySelectionKey = [locationId, selectedDateKey, selectedServiceId, selectedBarberId].join(":");
  const availableSlotsKey = availableSlots.join(",");
  useEffect(() => {
    if (!canQueryAvailability || appointments === undefined) return;
    setSelectedSlots((current) => {
      if (!hasInitializedSlots.current && availableSlots.length > 0) {
        hasInitializedSlots.current = true;
        return availableSlots.slice(0, Math.min(6, MAX_SELECTED_SLOTS));
      }
      const valid = current.filter((slot) => availableSlots.includes(slot));
      return valid.length === current.length && valid.every((slot, index) => slot === current[index]) ? current : valid;
    });
    setValidatedAvailabilitySelectionKey(availabilitySelectionKey);
  }, [appointments, availabilitySelectionKey, availableSlotsKey, canQueryAvailability]);

  const isAvailabilitySelectionPending = canQueryAvailability
    && (appointments === undefined || validatedAvailabilitySelectionKey !== availabilitySelectionKey);

  const dateLabel = formatPromotionDate(selectedDateKey, timeZone);
  const businessName = location?.name?.trim() || shopBranding.name;
  const logoUrl = resolveLocationLogoUrl(location?.logoUrl);
  const publicBookingUrl = useMemo(
    () => resolvePublicBookingUrl(publicBaseUrl, typeof window === "undefined" ? "" : window.location.origin),
    [publicBaseUrl],
  );
  const imageInput = useMemo<AvailabilitySocialImageInput>(() => ({
    format: imageFormat,
    template,
    businessName,
    logoUrl,
    title: title.trim() || "Vagas disponíveis",
    dateLabel,
    serviceName: selectedService?.name || "Serviço",
    professionalName: selectedBarber?.name || "",
    slots: selectedSlots,
  }), [businessName, dateLabel, imageFormat, logoUrl, selectedBarber?.name, selectedService?.name, selectedSlots, template, title]);

  useEffect(() => setLinkCopied(false), [publicBookingUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    setIsRendering(true);
    setRenderError("");
    void renderAvailabilitySocialImage(canvas, imageInput)
      .catch((error) => {
        if (!cancelled) setRenderError(error instanceof Error ? error.message : "Não foi possível gerar a pré-visualização.");
      })
      .finally(() => {
        if (!cancelled) setIsRendering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [imageInput]);

  const setQuickDate = (kind: "today" | "tomorrow") => {
    if (!bookingWindow) return;
    if (kind === "today") {
      setSelectedDateKey(bookingWindow.today);
      setVisibleCalendarMonth(dateKeyToCalendarDate(bookingWindow.today) ?? undefined);
      setTitle("Vagas de hoje");
      return;
    }
    if (!canSelectTomorrow) return;
    setSelectedDateKey(tomorrowDateKey);
    setVisibleCalendarMonth(dateKeyToCalendarDate(tomorrowDateKey) ?? undefined);
    setTitle("Vagas de amanhã");
  };

  const selectCalendarDate = (date: Date | undefined) => {
    if (!date) return;
    setSelectedDateKey(format(date, "yyyy-MM-dd"));
    setVisibleCalendarMonth(date);
    setTitle("Vagas disponíveis");
    setIsCalendarOpen(false);
  };

  const toggleSlot = (slot: string) => {
    setSelectedSlots((current) => {
      if (current.includes(slot)) return current.filter((value) => value !== slot);
      if (current.length >= MAX_SELECTED_SLOTS) {
        toast({ title: "Limite de horários", description: `Pode divulgar até ${MAX_SELECTED_SLOTS} horários por imagem.` });
        return current;
      }
      return [...current, slot].sort((left, right) => left.localeCompare(right));
    });
  };

  const refreshAvailability = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/barbers"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/services"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/barbers/availability"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/shop/availability"] }),
      refetchAppointments(),
    ]);
    toast({ title: "Vagas atualizadas", description: "A disponibilidade foi consultada novamente." });
  };

  const getPng = async () => {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("A pré-visualização ainda não está pronta.");
    await renderAvailabilitySocialImage(canvas, imageInput);
    return availabilityCanvasToPng(canvas);
  };

  const fileName = `${sanitizeAvailabilitySocialFileName(businessName)}-vagas-${selectedDateKey || "data"}-${imageFormat}.png`;
  const downloadImage = async () => {
    try {
      downloadBlob(await getPng(), fileName);
      toast({ title: "Imagem descarregada", description: "O PNG está pronto para publicar." });
      return true;
    } catch (error) {
      toast({ title: "Não foi possível descarregar", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" });
      return false;
    }
  };

  const copyBookingLink = async () => {
    const copied = Boolean(publicBookingUrl) && await copyTextWithFallback(publicBookingUrl);
    setLinkCopied(copied);
    if (copied) {
      toast({ title: "Link copiado", description: "Cole-o no sticker «Ligação» do Instagram." });
      return;
    }
    bookingLinkRef.current?.focus();
    bookingLinkRef.current?.select();
    toast({
      title: "Copie o link manualmente",
      description: "O navegador bloqueou a cópia automática. O link ficou selecionado.",
      variant: "destructive",
    });
  };

  const prepareInstagramStory = () => {
    setImageFormat("story");
    setLinkCopied(false);
    setStoryDownloaded(false);
    setIsInstagramPreparationOpen(true);
  };

  const downloadInstagramStory = async () => {
    setStoryDownloaded(await downloadImage());
  };

  const shareImage = async () => {
    try {
      const blob = await getPng();
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: imageInput.title, text: `${dateLabel} · ${businessName}` });
        return;
      }
      downloadBlob(blob, fileName);
      toast({ title: "Partilha não disponível", description: "A imagem foi descarregada para poder partilhá-la manualmente." });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast({ title: "Não foi possível partilhar", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" });
    }
  };

  const noAvailability = canQueryAvailability && !isLoadingAppointments && appointments !== undefined && availableSlots.length === 0;
  const updatedAtLabel = dataUpdatedAt
    ? new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }).format(new Date(dataUpdatedAt))
    : null;

  return (
    <div className="space-y-6" data-testid="availability-promotion">
      <div>
        <h2 className="text-xl font-bold text-white">Divulgar vagas</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-400">
          Escolha vagas reais, personalize a imagem e descarregue-a para Instagram, Facebook ou WhatsApp.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.78fr)]">
        <div className="space-y-6">
          <Card className="border-white/10 bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg text-white"><CalendarDays className="h-5 w-5 text-primary" /> 1. Escolher vagas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Data</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[auto_auto_minmax(190px,1fr)]">
                  <Button type="button" variant={selectedDateKey === bookingWindow?.today ? "gold" : "outline"} onClick={() => setQuickDate("today")} disabled={!bookingWindow}>Hoje</Button>
                  <Button type="button" variant={selectedDateKey === tomorrowDateKey ? "gold" : "outline"} onClick={() => setQuickDate("tomorrow")} disabled={!canSelectTomorrow}>Amanhã</Button>
                  <Popover open={isCalendarOpen} onOpenChange={(open) => {
                    setIsCalendarOpen(open);
                    if (open && selectedDate) setVisibleCalendarMonth(selectedDate);
                  }}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="col-span-2 justify-start sm:col-span-1"
                        disabled={isLoadingBookingWindow || !bookingWindow}
                        aria-label="Escolher data"
                      >
                        <CalendarDays className="mr-2 h-4 w-4 text-primary" /> Escolher data
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] p-0">
                      <Calendar
                        mode="single"
                        selected={selectedDate ?? undefined}
                        month={visibleCalendarMonth}
                        onMonthChange={setVisibleCalendarMonth}
                        onSelect={selectCalendarDate}
                        fromMonth={bookingWindow ? dateKeyToCalendarDate(bookingWindow.today) ?? undefined : undefined}
                        toMonth={bookingWindow ? dateKeyToCalendarDate(bookingWindow.maxDate) ?? undefined : undefined}
                        disabled={(date) => {
                          if (!bookingWindow) return true;
                          const key = format(date, "yyyy-MM-dd");
                          return key < bookingWindow.today || key > bookingWindow.maxDate;
                        }}
                        initialFocus
                        locale={pt}
                        className="w-full rounded-md p-3"
                        classNames={{
                          day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                          day_today: "border border-primary/60 text-primary",
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                {selectedDate && (
                  <p className="text-sm text-gray-300" aria-live="polite" data-testid="promotion-selected-date">
                    Data selecionada: <span className="font-semibold text-primary">{capitalize(format(selectedDate, "EEEE, d 'de' MMMM 'de' yyyy", { locale: pt }))}</span>
                  </p>
                )}
                {isBookingWindowError && <p className="text-sm text-red-300">Não foi possível consultar as datas disponíveis para marcação.</p>}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="promotion-service">Serviço</Label>
                  <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
                    <SelectTrigger id="promotion-service"><SelectValue placeholder="Escolher serviço" /></SelectTrigger>
                    <SelectContent>
                      {visibleServices.map((service) => <SelectItem key={service.id} value={String(service.id)}>{service.name} · {service.duration} min</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500">A duração do serviço determina se cada horário cabe integralmente.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="promotion-barber">Profissional</Label>
                  <Select value={selectedBarberId} onValueChange={setSelectedBarberId}>
                    <SelectTrigger id="promotion-barber"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os barbeiros</SelectItem>
                      {visibleBarbers.map((barber) => <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-background/40 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-white">Horários disponíveis</p>
                    <p className="text-xs text-gray-500">
                      {updatedAtLabel ? `Consulta atualizada às ${updatedAtLabel}.` : "A consultar disponibilidade atual…"} Selecione até {MAX_SELECTED_SLOTS}.
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={refreshAvailability} disabled={!canQueryAvailability || isFetchingAppointments}>
                    <RefreshCw className={cn("mr-2 h-4 w-4", isFetchingAppointments && "animate-spin")} /> Atualizar vagas
                  </Button>
                </div>

                {(isLoadingAppointments || isLoadingBookingWindow) && <div className="mt-4 flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> A consultar horários…</div>}
                {(isAppointmentsError || isBookingWindowError) && <div className="mt-4 flex items-center gap-2 text-sm text-red-300"><AlertCircle className="h-4 w-4" /> Não foi possível consultar as vagas. Tente atualizar.</div>}
                {noAvailability && <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">Não existem vagas para esta combinação de data, serviço e profissional.</div>}
                {!isLoadingAppointments && availableSlots.length > 0 && (
                  <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5" aria-label="Vagas disponíveis">
                    {availableSlots.map((slot) => {
                      const checked = selectedSlots.includes(slot);
                      return (
                        <label key={slot} className={cn("flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm font-semibold transition-colors", checked ? "border-primary bg-primary/15 text-primary" : "border-white/10 bg-background text-gray-300 hover:border-white/30")}>
                          <Checkbox checked={checked} onCheckedChange={() => toggleSlot(slot)} aria-label={`Selecionar ${slot}`} />
                          {slot}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card">
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg text-white"><ImageIcon className="h-5 w-5 text-primary" /> 2. Personalizar</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="promotion-title">Título</Label>
                <Input id="promotion-title" value={title} maxLength={70} onChange={(event) => setTitle(event.target.value)} placeholder="Vagas disponíveis" />
                <p className="text-right text-xs text-gray-500">{title.length}/70</p>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-gray-200">Modelo visual</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {(Object.keys(AVAILABILITY_SOCIAL_TEMPLATES) as AvailabilitySocialTemplate[]).map((value) => {
                    const option = AVAILABILITY_SOCIAL_TEMPLATES[value];
                    const active = template === value;
                    return (
                      <button key={value} type="button" aria-pressed={active} onClick={() => setTemplate(value)} className={cn("relative min-h-24 rounded-xl border p-3 text-left transition-all", active ? "border-primary bg-primary/10" : "border-white/10 bg-background/50 hover:border-white/30")}>
                        {active && <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />}
                        <span className="block font-semibold text-white">{option.label}</span>
                        <span className="mt-1 block text-xs text-gray-400">{option.description}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-gray-200">Formato</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(Object.keys(AVAILABILITY_SOCIAL_FORMATS) as AvailabilitySocialFormat[]).map((value) => {
                    const option = AVAILABILITY_SOCIAL_FORMATS[value];
                    const active = imageFormat === value;
                    return (
                      <button key={value} type="button" aria-pressed={active} onClick={() => setImageFormat(value)} className={cn("rounded-xl border p-3 text-left transition-all", active ? "border-primary bg-primary/10" : "border-white/10 bg-background/50 hover:border-white/30")}>
                        <span className="font-semibold text-white">{option.label}</span>
                        <span className="ml-2 text-xs text-gray-400">{option.detail}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit border-white/10 bg-card xl:sticky xl:top-4">
          <CardHeader>
            <CardTitle className="text-lg text-white">3. Pré-visualizar e partilhar</CardTitle>
            <p className="text-xs text-gray-400">A pré-visualização usa exatamente os mesmos píxeis do PNG final.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={cn("relative mx-auto overflow-hidden rounded-xl border border-white/10 bg-black shadow-2xl", imageFormat === "story" ? "max-w-[360px]" : "max-w-[480px]")}>
              <canvas
                ref={canvasRef}
                aria-label={`Pré-visualização ${AVAILABILITY_SOCIAL_FORMATS[imageFormat].label}`}
                data-format={imageFormat}
                data-template={template}
                data-slot-count={selectedSlots.length}
                className="block h-auto w-full"
              />
              {(isRendering || isAvailabilitySelectionPending) && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 text-sm font-medium text-white">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  {isAvailabilitySelectionPending ? "A validar vagas…" : null}
                </div>
              )}
            </div>
            {renderError && <p className="text-sm text-red-300">{renderError}</p>}
            <div className="sr-only" aria-live="polite">
              {imageInput.title}. {imageInput.dateLabel}. {formatAvailabilitySocialServiceLine(imageInput.serviceName, imageInput.professionalName)}. Horários: {selectedSlots.join(", ") || "nenhum selecionado"}.
            </div>
            <Button
              type="button"
              variant="gold"
              size="lg"
              className="w-full"
              onClick={prepareInstagramStory}
              disabled={selectedSlots.length === 0 || isAvailabilitySelectionPending || Boolean(renderError)}
            >
              <Instagram className="mr-2 h-5 w-5" /> Preparar Story para Instagram
            </Button>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <Button type="button" variant="gold" onClick={downloadImage} disabled={selectedSlots.length === 0 || isRendering || isAvailabilitySelectionPending || Boolean(renderError)}>
                <Download className="mr-2 h-4 w-4" /> Descarregar PNG
              </Button>
              <Button type="button" variant="outline" onClick={shareImage} disabled={selectedSlots.length === 0 || isRendering || isAvailabilitySelectionPending || Boolean(renderError)}>
                <Share2 className="mr-2 h-4 w-4" /> Partilhar
              </Button>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={() => void copyBookingLink()} disabled={!publicBookingUrl}>
              {linkCopied ? <Check className="mr-2 h-4 w-4 text-emerald-400" /> : <Copy className="mr-2 h-4 w-4" />}
              {linkCopied ? "Link copiado" : "Copiar link de marcação"}
            </Button>
            <p className="text-xs leading-relaxed text-gray-500">
              A partilha nativa depende do dispositivo. Quando não estiver disponível, a imagem é descarregada. A publicação nas redes sociais continua a ser manual.
            </p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isInstagramPreparationOpen} onOpenChange={setIsInstagramPreparationOpen}>
        <DialogContent mobileViewportAware className="max-w-xl overflow-y-auto border-white/10 bg-card text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl"><Instagram className="h-5 w-5 text-primary" /> Preparar Story para Instagram</DialogTitle>
            <DialogDescription className="text-left text-gray-400">
              Faça cada passo separadamente. O Instagram não permite adicionar automaticamente o link ao PNG.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <section className="rounded-xl border border-white/10 bg-background/50 p-4">
              <p className="font-semibold text-white">1. Descarregar a imagem</p>
              <p className="mt-1 text-sm text-gray-400">O formato Story 1080 × 1920 está pronto para personalizar no Instagram.</p>
              <Button className="mt-3 w-full" variant="gold" onClick={() => void downloadInstagramStory()} disabled={isRendering || isAvailabilitySelectionPending || selectedSlots.length === 0}>
                {storyDownloaded ? <Check className="mr-2 h-4 w-4" /> : <Download className="mr-2 h-4 w-4" />}
                {storyDownloaded ? "Story descarregado" : "Descarregar Story PNG"}
              </Button>
            </section>

            <section className="rounded-xl border border-white/10 bg-background/50 p-4">
              <p className="font-semibold text-white">2. Copiar o link de marcação</p>
              <p className="mt-1 text-sm text-gray-400">Este é o endereço público que os clientes devem abrir.</p>
              <Input
                ref={bookingLinkRef}
                aria-label="Link público de marcação"
                className="mt-3 text-sm"
                readOnly
                value={publicBookingUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button className="mt-3 w-full" variant="outline" onClick={() => void copyBookingLink()} disabled={!publicBookingUrl}>
                {linkCopied ? <Check className="mr-2 h-4 w-4 text-emerald-400" /> : <Copy className="mr-2 h-4 w-4" />}
                {linkCopied ? "Link copiado" : "Copiar link de marcação"}
              </Button>
            </section>

            <section className="rounded-xl border border-primary/25 bg-primary/5 p-4">
              <p className="font-semibold text-white">3. Publicar no Instagram</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-gray-300">
                <li>Abra o Instagram e crie um novo Story.</li>
                <li>Escolha o PNG que acabou de descarregar.</li>
                <li>Adicione o sticker «Ligação» e cole o link copiado.</li>
                <li>Posicione o sticker onde preferir e publique.</li>
              </ol>
              <Button asChild className="mt-3 w-full" variant="outline">
                <a href="https://www.instagram.com/" target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" /> Abrir Instagram
                </a>
              </Button>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
