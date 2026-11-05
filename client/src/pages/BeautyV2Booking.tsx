import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, startOfToday } from "date-fns";
import { pt } from "date-fns/locale";
import { CalendarDays, Check, ChevronLeft, Clock, Loader2, Plus, Scissors, Trash2 } from "lucide-react";
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

  if (loadingLocations) return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (submitted) return <main className="flex min-h-screen items-center justify-center bg-background p-5 text-white"><Card className="max-w-lg border-primary/20 bg-card text-white"><CardContent className="space-y-5 p-8 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10"><Check className="h-7 w-7 text-primary" /></div><h1 className="font-display text-2xl font-bold">Pedido recebido</h1><p className="text-gray-300">O estabelecimento vai analisar a disponibilidade. Este pedido <strong>ainda não é uma marcação confirmada</strong>.</p><p className="text-sm text-gray-400">Receberá uma atualização quando o pedido for aprovado, recusado ou tiver uma proposta de outro horário.</p><Button asChild variant="outline"><Link href="/">Voltar ao início</Link></Button></CardContent></Card></main>;

  return <div className="min-h-screen bg-background pb-12 text-white" data-testid="beauty-v2-booking">
    <header className="border-b border-white/10 bg-card/80"><div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4"><Button asChild variant="ghost" size="sm"><Link href="/"><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Link></Button><div><h1 className="font-display text-xl font-bold">Pedido de marcação</h1><p className="text-xs text-gray-400">Escolha os serviços e envie o pedido para aprovação.</p></div></div></header>
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-7">
      {locations.length > 1 && <section className="space-y-3"><h2 className="text-lg font-bold">Estabelecimento</h2><div className="grid gap-3 sm:grid-cols-2">{locations.map((location) => <button key={location.id} onClick={() => { setLocationId(location.id); setActiveLocationId(location.id); setSelections([]); }} className={cn("rounded-xl border p-4 text-left", locationId === location.id ? "border-primary bg-primary/5" : "border-white/10 bg-card")}>{location.name}<small className="block text-gray-400">{location.address}</small></button>)}</div></section>}

      {!effectiveFeatures.appointmentRequests ? <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-amber-100">Os pedidos de marcação não estão ativos neste estabelecimento.</p> : null}
      <section className={cn("space-y-4", !effectiveFeatures.appointmentRequests && "pointer-events-none opacity-50")}><div><h2 className="text-lg font-bold">1. Serviços</h2><p className="text-sm text-gray-400">{effectiveFeatures.multiServiceAppointments ? "Pode combinar vários serviços; serão realizados pela ordem escolhida." : "Escolha o serviço pretendido."}</p></div>
        <div className="grid gap-3 md:grid-cols-2">{selections.map((selection, index) => {
          const service = visibleServices.find((item) => item.id === selection.serviceId);
          const professionals = visibleBarbers.filter((barber) => canBarberPerformService(barber, selection.serviceId));
          return <Card key={`${selection.serviceId}-${index}`} className="border-primary/20 bg-card text-white"><CardContent className="space-y-3 p-4"><div className="flex justify-between gap-3"><div><strong>{index + 1}. {service?.name}</strong><small className="block text-gray-400">{service?.duration} min · {service ? money(service.price) : ""}</small></div><Button size="icon" variant="ghost" aria-label="Remover serviço" onClick={() => setSelections((current) => current.filter((_, position) => position !== index))}><Trash2 className="h-4 w-4" /></Button></div><Select value={selection.barberId ? String(selection.barberId) : ""} onValueChange={(value) => setSelections((current) => current.map((item, position) => position === index ? { ...item, barberId: Number(value) } : item))}><SelectTrigger><SelectValue placeholder="Escolher profissional" /></SelectTrigger><SelectContent>{professionals.map((barber) => <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>)}</SelectContent></Select></CardContent></Card>;
        })}</div>
        {(loadingServices || loadingBarbers) ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{visibleServices.filter((service) => !selectedIds.has(service.id)).map((service) => <button key={service.id} disabled={!canAddService && selections.length > 0} onClick={() => addService(service.id)} className="flex items-center justify-between rounded-xl border border-white/10 bg-card p-4 text-left transition hover:border-primary/40 disabled:opacity-40"><span><strong className="block">{service.name}</strong><small className="text-gray-400">{service.duration} min · {money(service.price)}</small></span><Plus className="h-4 w-4 text-primary" /></button>)}</div>}
      </section>

      <section className="grid gap-6 lg:grid-cols-[360px_1fr]"><div className="space-y-3"><h2 className="flex items-center gap-2 text-lg font-bold"><CalendarDays className="h-5 w-5 text-primary" />2. Data</h2><div className="rounded-xl border border-white/10 bg-card p-3"><Calendar mode="single" selected={date} onSelect={setDate} disabled={(candidate) => !isDateAllowed(candidate)} fromMonth={startOfToday()} locale={pt} className="w-full" /></div></div>
        <div className="space-y-3"><h2 className="flex items-center gap-2 text-lg font-bold"><Clock className="h-5 w-5 text-primary" />Horários disponíveis</h2><div className="min-h-52 rounded-xl border border-white/10 bg-card p-4">{selections.length === 0 ? <p className="text-gray-400">Escolha primeiro pelo menos um serviço.</p> : completeSelections.length !== selections.length ? <p className="text-gray-400">Escolha o profissional de cada serviço.</p> : loadingPreview ? <Loader2 className="mx-auto mt-16 h-6 w-6 animate-spin text-primary" /> : previewError ? <p className="text-red-300">Não foi possível calcular a disponibilidade conjunta.</p> : preview?.starts.length === 0 ? <p className="text-gray-400">Não existem horários que acomodem todos os serviços neste dia.</p> : <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{preview?.starts.map((instant) => <button key={instant} onClick={() => setStartTime(instant)} className={cn("rounded-lg border px-2 py-3 text-sm", startTime === instant ? "border-primary bg-primary text-background" : "border-white/10 hover:border-primary/40")}>{new Intl.DateTimeFormat("pt-PT", { timeZone: preview.timeZone, hour: "2-digit", minute: "2-digit" }).format(parseISO(instant))}</button>)}</div>}</div>{preview && <p className="text-sm text-gray-400">Duração total: {preview.durationMinutes} min · Total: <strong className="text-primary">{money(preview.totalPriceCents)}</strong></p>}</div></section>

      <section className="space-y-4"><div><h2 className="text-lg font-bold">3. Os seus dados</h2><p className="text-sm text-gray-400">O pedido só fica confirmado depois da aprovação do estabelecimento.</p></div><div className="grid gap-4 rounded-xl border border-white/10 bg-card p-5 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="request-name">Nome *</Label><Input id="request-name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="request-email">Email (opcional)</Label><Input id="request-email" type="email" maxLength={120} value={email} onChange={(event) => setEmail(event.target.value)} /></div><div className="space-y-2 md:col-span-2"><Label htmlFor="request-phone">Telemóvel *</Label><InternationalPhoneInput id="request-phone" value={phone} countryCode={phoneCountry} onValueChange={(value, country) => { setPhone(value); setPhoneCountry(country); }} /></div></div></section>
      <div className="flex justify-end"><Button variant="gold" className="w-full sm:w-auto" disabled={submitting || !selectedStart} onClick={submit}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Scissors className="mr-2 h-4 w-4" />Enviar pedido</>}</Button></div>
    </main>
  </div>;
}
