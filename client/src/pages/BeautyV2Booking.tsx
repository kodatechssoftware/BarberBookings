import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, startOfToday } from "date-fns";
import { pt } from "date-fns/locale";
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  Clock,
  Loader2,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button-custom";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InternationalPhoneInput } from "@/components/InternationalPhoneInput";
import { useLocations } from "@/hooks/use-locations";
import { useServices } from "@/hooks/use-services";
import { useBarbers } from "@/hooks/use-barbers";
import { usePublicBookingWindow } from "@/hooks/use-public-booking-window";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { locationHeaders, setActiveLocationId } from "@/lib/location-context";
import { canBarberPerformService } from "@/lib/availability";
import { cn } from "@/lib/utils";
import { DEFAULT_PHONE_COUNTRY, isValidPhoneForCountry, toStoredPhone, type PhoneCountryCode } from "@shared/phone-countries";
import { useBeautyV2Features, type BeautyV2PublicFeatures } from "@/hooks/use-beauty-v2";

type Selection = { serviceId: number; barberId: number | null };
type AvailabilityPreview = {
  date: string;
  timeZone: string;
  starts: string[];
  durationMinutes: number;
  totalPriceCents: number;
  segments: Array<{ position: number; serviceId: number; barberId: number; durationMinutes: number; serviceName: string; priceCents: number }>;
};

function money(cents: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function StepHeading({
  number,
  title,
  description,
  icon,
}: {
  number: number;
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return <div className="flex items-start gap-3">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground shadow-sm">
      {number}
    </span>
    <div className="min-w-0">
      <h2 className="flex items-center gap-2 text-lg font-bold leading-tight text-foreground sm:text-xl">
        <span className="text-primary" aria-hidden="true">{icon}</span>
        {title}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  </div>;
}

function PanelMessage({
  icon,
  title,
  description,
  tone = "neutral",
}: {
  icon: ReactNode;
  title: string;
  description: string;
  tone?: "neutral" | "error";
}) {
  return <div
    className={cn(
      "flex min-h-32 flex-col items-center justify-center rounded-2xl border px-5 py-6 text-center",
      tone === "error"
        ? "border-destructive/30 bg-destructive/5"
        : "border-dashed border-border bg-secondary/35",
    )}
    role={tone === "error" ? "alert" : "status"}
  >
    <span className={cn("mb-2", tone === "error" ? "text-destructive" : "text-primary")} aria-hidden="true">{icon}</span>
    <p className="font-semibold text-foreground">{title}</p>
    <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
  </div>;
}

export default function BeautyV2Booking({ features }: { features: BeautyV2PublicFeatures }) {
  const { toast } = useToast();
  const [locationId, setLocationId] = useState<number | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [date, setDate] = useState<Date | undefined>(startOfToday());
  const [startTime, setStartTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<PhoneCountryCode>(DEFAULT_PHONE_COUNTRY.code);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ id: number } | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const { data: locations = [], isLoading: loadingLocations } = useLocations({ purpose: "booking" });
  const activeLocation = locations.find((location) => location.id === locationId);
  const { data: locationFeatures } = useBeautyV2Features({ enabled: locationId !== null, locationId });
  const effectiveFeatures = locationFeatures ?? features;

  useEffect(() => {
    if (locations.length === 1 && locationId !== locations[0].id) {
      setLocationId(locations[0].id);
      setActiveLocationId(locations[0].id);
    }
  }, [locationId, locations]);

  const { data: services = [], isLoading: loadingServices } = useServices({ enabled: Boolean(locationId), locationId: locationId ?? undefined });
  const { data: barbers = [], isLoading: loadingBarbers } = useBarbers({ enabled: Boolean(locationId), locationId: locationId ?? undefined });
  const { data: bookingWindow } = usePublicBookingWindow();
  const visibleServices = services.filter((service) => service.isVisible);
  const visibleBarbers = barbers.filter((barber) => barber.isVisible);
  const completeSelections = selections.filter((selection): selection is { serviceId: number; barberId: number } => selection.barberId !== null);
  const dateKey = date ? format(date, "yyyy-MM-dd") : null;
  const selectionKey = completeSelections.map((item) => `${item.serviceId}:${item.barberId}`).join(",");
  const previewEnabled = Boolean(locationId && dateKey && selections.length > 0 && completeSelections.length === selections.length);
  const { data: preview, isFetching: loadingPreview, isError: previewError } = useQuery<AvailabilityPreview>({
    queryKey: ["/api/appointment-requests/availability", dateKey, selectionKey, { locationId }],
    enabled: previewEnabled,
    queryFn: async () => {
      const response = await apiFetch("/api/appointment-requests/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...locationHeaders(locationId) },
        body: JSON.stringify({ date: dateKey, services: completeSelections }),
      });
      if (!response.ok) throw new Error("Não foi possível consultar a disponibilidade conjunta.");
      return response.json();
    },
  });

  useEffect(() => setStartTime(null), [dateKey, selectionKey, locationId]);
  const selectedStart = preview?.starts.find((candidate) => candidate === startTime) ?? null;
  const canAddService = effectiveFeatures.multiServiceAppointments && selections.length < 12;
  const selectedIds = new Set(selections.map((selection) => selection.serviceId));
  const isDateAllowed = (candidate: Date) => Boolean(bookingWindow
    && format(candidate, "yyyy-MM-dd") >= bookingWindow.today
    && format(candidate, "yyyy-MM-dd") <= bookingWindow.maxDate);

  const addService = (serviceId: number) => {
    if (!effectiveFeatures.multiServiceAppointments) {
      setSelections([{ serviceId, barberId: null }]);
    } else if (!selectedIds.has(serviceId)) {
      setSelections((current) => [...current, { serviceId, barberId: null }]);
    }
  };

  const submit = async () => {
    if (!locationId || !selectedStart || completeSelections.length !== selections.length || !name.trim() || !isValidPhoneForCountry(phone, phoneCountry)) {
      toast({ title: "Confirme os dados", description: "Escolha os serviços, profissionais, horário e indique um contacto válido.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiRequest("POST", "/api/appointment-requests", {
        startTime: selectedStart,
        customerName: name.trim(),
        customerEmail: email.trim() || null,
        customerPhone: toStoredPhone(phone, phoneCountry),
        whatsappOptIn: true,
        idempotencyKey: idempotencyKey.current,
        services: completeSelections,
      }, { headers: locationHeaders(locationId) });
      const result = await response.json();
      setSubmitted({ id: result.request.id });
    } catch (error) {
      toast({ title: "Não foi possível enviar o pedido", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingLocations) return <div className="booking-shell flex min-h-screen items-center justify-center bg-background text-foreground">
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm" role="status">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      <span className="font-medium">A preparar o pedido...</span>
    </div>
  </div>;

  if (submitted) return <main className="booking-shell flex min-h-screen items-center justify-center bg-background p-5 text-foreground">
    <Card className="w-full max-w-lg border-primary/30 bg-card shadow-xl shadow-primary/10">
      <CardContent className="space-y-5 p-7 text-center sm:p-9">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Check className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">Pedido recebido</h1>
          <p className="mt-3 leading-relaxed text-foreground">
            O estabelecimento vai analisar a disponibilidade. Este pedido <strong>ainda não é uma marcação confirmada</strong>.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Receberá uma atualização quando o pedido for aprovado, recusado ou tiver uma proposta de outro horário.
          </p>
        </div>
        <Button asChild variant="outline"><Link href="/">Voltar ao início</Link></Button>
      </CardContent>
    </Card>
  </main>;

  return <div className="booking-shell beauty-v2-booking min-h-screen bg-background pb-10 text-foreground" data-testid="beauty-v2-booking">
    <header className="border-b border-border/80 bg-card/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:py-4">
        <Button asChild variant="ghost" size="sm"><Link href="/"><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Link></Button>
        <div className="min-w-0 border-l border-border pl-3">
          <h1 className="truncate font-display text-xl font-bold text-foreground sm:text-2xl">Pedido de marcação</h1>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">Escolha os serviços e envie o pedido para aprovação.</p>
        </div>
      </div>
    </header>

    <main className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:space-y-6 sm:py-7">
      {locations.length > 1 && <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <h2 className="font-semibold text-foreground">Estabelecimento</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{locations.map((location) => <button
          key={location.id}
          type="button"
          aria-pressed={locationId === location.id}
          onClick={() => { setLocationId(location.id); setActiveLocationId(location.id); setSelections([]); }}
          className={cn(
            "rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            locationId === location.id
              ? "border-primary bg-primary/10 shadow-sm"
              : "border-border bg-background hover:border-primary/60 hover:bg-secondary/35",
          )}
        >
          <strong className="block text-foreground">{location.name}</strong>
          <small className="mt-1 block text-muted-foreground">{location.address}</small>
        </button>)}</div>
      </section>}

      {!effectiveFeatures.appointmentRequests ? <div className="rounded-2xl border border-amber-600/30 bg-amber-50 p-4 text-sm font-medium text-amber-900" role="status">
        Os pedidos de marcação não estão ativos neste estabelecimento.
      </div> : null}

      <section className={cn(
        "rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-6",
        !effectiveFeatures.appointmentRequests && "pointer-events-none opacity-60",
      )}>
        <StepHeading
          number={1}
          title="Serviços"
          description={effectiveFeatures.multiServiceAppointments
            ? "Combine os serviços pretendidos e escolha o profissional para cada um."
            : "Escolha o serviço e o profissional pretendidos."}
          icon={<Sparkles className="h-5 w-5" />}
        />

        {selections.length > 0 && <div className="mt-5 grid gap-3 md:grid-cols-2">{selections.map((selection, index) => {
          const service = visibleServices.find((item) => item.id === selection.serviceId);
          const professionals = visibleBarbers.filter((barber) => canBarberPerformService(barber, selection.serviceId));
          return <Card key={`${selection.serviceId}-${index}`} className="border-primary/45 bg-primary/5 shadow-none">
            <CardContent className="space-y-4 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <strong className="block text-base leading-tight text-foreground">{service?.name}</strong>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium text-muted-foreground">
                    <span className="rounded-full border border-border bg-card px-2.5 py-1">{service?.duration} min</span>
                    <span className="rounded-full border border-border bg-card px-2.5 py-1">{service ? money(service.price) : ""}</span>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Remover ${service?.name ?? "serviço"}`}
                  onClick={() => setSelections((current) => current.filter((_, position) => position !== index))}
                ><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <UserRound className="h-4 w-4 text-primary" /> Profissional
                </Label>
                <Select
                  value={selection.barberId ? String(selection.barberId) : ""}
                  onValueChange={(value) => setSelections((current) => current.map((item, position) => position === index ? { ...item, barberId: Number(value) } : item))}
                >
                  <SelectTrigger className="h-11 border-border bg-card text-foreground" aria-label={`Profissional para ${service?.name ?? "serviço"}`}>
                    <SelectValue placeholder="Escolher profissional" />
                  </SelectTrigger>
                  <SelectContent>{professionals.map((barber) => <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>;
        })}</div>}

        <div className="mt-5 border-t border-border pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">{selections.length > 0 ? "Adicionar outro serviço" : "Escolha um serviço"}</p>
            {effectiveFeatures.multiServiceAppointments && <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">{selections.length}/12 selecionados</span>}
          </div>
          {(loadingServices || loadingBarbers) ? <div className="flex min-h-28 items-center justify-center gap-2 text-muted-foreground" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-primary" /> A carregar serviços...
          </div> : visibleServices.filter((service) => !selectedIds.has(service.id)).length === 0 ? <PanelMessage
            icon={<Check className="h-5 w-5" />}
            title="Serviços selecionados"
            description="Pode continuar para escolher a data e o horário."
          /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleServices.filter((service) => !selectedIds.has(service.id)).map((service) => <button
            key={service.id}
            type="button"
            disabled={!canAddService && selections.length > 0}
            onClick={() => addService(service.id)}
            className="group flex min-h-28 items-start justify-between gap-3 rounded-2xl border border-border bg-background p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/70 hover:bg-primary/5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
          >
            <span className="min-w-0">
              <strong className="block text-base leading-tight text-foreground">{service.name}</strong>
              {service.description && <small className="mt-1 line-clamp-2 block text-sm leading-snug text-muted-foreground">{service.description}</small>}
              <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-foreground">
                <span>{service.duration} min</span><span>{money(service.price)}</span>
              </span>
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground" aria-hidden="true">
              <Plus className="h-4 w-4" />
            </span>
          </button>)}</div>}
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <StepHeading
          number={2}
          title="Data e horário"
          description="Escolha um dia e consulte os horários que acomodam todos os serviços."
          icon={<CalendarDays className="h-5 w-5" />}
        />
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(290px,340px)_1fr] lg:items-start">
          <div className="booking-calendar-card overflow-hidden rounded-2xl border bg-card p-2 sm:p-3">
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              disabled={(candidate) => !isDateAllowed(candidate)}
              fromMonth={startOfToday()}
              locale={pt}
              className="w-full p-1 sm:p-2"
              classNames={{
                months: "w-full",
                month: "w-full space-y-3",
                caption: "relative flex items-center justify-center px-10 py-1",
                caption_label: "beauty-v2-calendar-caption text-base font-bold capitalize text-foreground",
                nav: "flex items-center",
                nav_button: "h-9 w-9 rounded-full border border-border bg-background p-0 text-foreground opacity-100 transition hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                nav_button_previous: "absolute left-0",
                nav_button_next: "absolute right-0",
                table: "w-full border-collapse",
                head_row: "grid grid-cols-7",
                row: "mt-1 grid w-full grid-cols-7",
                head_cell: "w-auto rounded-md py-1 text-center text-xs font-semibold uppercase text-muted-foreground",
                cell: "relative h-10 w-full p-0 text-center text-sm",
                day: "booking-calendar-day mx-auto h-9 w-9 rounded-lg p-0 font-medium aria-selected:opacity-100",
                day_selected: "booking-calendar-day-selected",
                day_today: "booking-calendar-day-today",
                day_outside: "booking-calendar-day-outside day-outside",
                day_disabled: "booking-calendar-day-disabled",
              }}
            />
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-bold text-foreground"><Clock className="h-5 w-5 text-primary" />Horários disponíveis</h3>
              <div className="flex gap-3 text-xs font-medium text-muted-foreground" aria-label="Legenda dos horários">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-primary bg-card" />Disponível</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" />Selecionado</span>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-background p-3 sm:p-4" aria-live="polite">
              {selections.length === 0 ? <PanelMessage
                icon={<Sparkles className="h-5 w-5" />}
                title="Escolha um serviço"
                description="Os horários serão apresentados depois de escolher os serviços e profissionais."
              /> : completeSelections.length !== selections.length ? <PanelMessage
                icon={<UserRound className="h-5 w-5" />}
                title="Escolha os profissionais"
                description="Indique quem realizará cada serviço para calcularmos a disponibilidade conjunta."
              /> : loadingPreview ? <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-6 w-6 animate-spin text-primary" /> A calcular horários...
              </div> : previewError ? <PanelMessage
                icon={<AlertCircle className="h-5 w-5" />}
                title="Não foi possível consultar os horários"
                description="Tente novamente dentro de alguns instantes."
                tone="error"
              /> : preview?.starts.length === 0 ? <PanelMessage
                icon={<Clock className="h-5 w-5" />}
                title="Sem horários disponíveis"
                description="Não existem horários que acomodem todos os serviços neste dia. Experimente outra data."
              /> : <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">{preview?.starts.map((instant) => {
                const isSelected = startTime === instant;
                return <button
                  key={instant}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setStartTime(instant)}
                  className={cn(
                    "booking-time-slot rounded-xl border px-2 py-3 text-sm font-bold",
                    isSelected ? "booking-time-slot-selected" : "booking-time-slot-available",
                  )}
                >{new Intl.DateTimeFormat("pt-PT", { timeZone: preview.timeZone, hour: "2-digit", minute: "2-digit" }).format(parseISO(instant))}</button>;
              })}</div>}
            </div>
            {preview && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/55 px-4 py-3 text-sm text-secondary-foreground">
              <span>Duração total: <strong>{preview.durationMinutes} min</strong></span>
              <span>Total: <strong className="text-primary">{money(preview.totalPriceCents)}</strong></span>
            </div>}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <StepHeading
          number={3}
          title="Os seus dados"
          description="O pedido só fica confirmado depois da aprovação do estabelecimento."
          icon={<UserRound className="h-5 w-5" />}
        />
        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="request-name" className="text-sm font-semibold text-foreground">Nome <span aria-hidden="true">*</span></Label>
            <Input id="request-name" className="h-11 border-border bg-background text-foreground shadow-sm" autoComplete="name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="request-email" className="text-sm font-semibold text-foreground">Email <span className="font-normal text-muted-foreground">(opcional)</span></Label>
            <Input id="request-email" className="h-11 border-border bg-background text-foreground shadow-sm" type="email" autoComplete="email" maxLength={120} value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2 lg:col-span-1">
            <Label htmlFor="request-phone" className="text-sm font-semibold text-foreground">Telemóvel <span aria-hidden="true">*</span></Label>
            <InternationalPhoneInput id="request-phone" value={phone} countryCode={phoneCountry} onValueChange={(value, country) => { setPhone(value); setPhoneCountry(country); }} />
          </div>
        </div>
      </section>

      <div className="flex flex-col items-stretch justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center">
        <p className="text-sm leading-relaxed text-muted-foreground">Revise os serviços, o profissional e o horário antes de enviar.</p>
        <Button
          variant="gold"
          className="h-11 w-full px-6 disabled:cursor-not-allowed disabled:border disabled:border-border disabled:bg-secondary disabled:text-foreground disabled:opacity-100 sm:w-auto"
          disabled={submitting || !selectedStart}
          onClick={submit}
        >
          {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />A enviar...</> : <><Scissors className="mr-2 h-4 w-4" />Enviar pedido</>}
        </Button>
      </div>
    </main>
  </div>;
}
