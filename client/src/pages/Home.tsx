import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Clock, ExternalLink, MapPin, Scissors } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button-custom";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { preloadAdminPage, preloadBookingPage } from "@/lib/page-preloads";
import { queryClient } from "@/lib/queryClient";
import { useBarbers } from "@/hooks/use-barbers";
import { useServices } from "@/hooks/use-services";

import fabioAvatar from "@assets/fabio-baptista-avatar.jpg";
import brunoAvatar from "@assets/bruno-santos-avatar.jpg";

const instagramUrl = import.meta.env.VITE_INSTAGRAM_URL || "";
const googleMapsUrl = "https://www.google.com/maps/search/?api=1&query=Rua%20Comandante%20Agat%C3%A3o%20Lan%C3%A7a%20N%C2%BA28";

const weeklySchedule = [
  { day: 0, periods: [] },
  { day: 1, periods: [{ start: "14:00", end: "20:00" }] },
  { day: 2, periods: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "20:00" }] },
  { day: 3, periods: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "20:00" }] },
  { day: 4, periods: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "20:00" }] },
  { day: 5, periods: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "20:00" }] },
  { day: 6, periods: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "19:00" }] },
];

const navItems = [
  { id: "services", label: "Serviços" },
  { id: "team", label: "Equipa" },
  { id: "location", label: "Morada" },
];

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatScheduleHour(time: string) {
  const [hours, minutes] = time.split(":");
  const hour = String(Number(hours));
  return minutes === "00" ? `${hour}h` : `${hour}h${minutes}`;
}

function getTodayOpeningStatus() {
  const now = new Date();
  const today = weeklySchedule.find((day) => day.day === now.getDay());
  const periods = today?.periods ?? [];

  if (periods.length === 0) {
    return {
      title: "Fechado hoje",
      detail: "Atendimento por hora marcada nos restantes dias.",
    };
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const activePeriod = periods.find((period) => {
    const start = timeToMinutes(period.start);
    const end = timeToMinutes(period.end);
    return currentMinutes >= start && currentMinutes < end;
  });

  if (activePeriod) {
    return {
      title: `Aberto hoje até às ${formatScheduleHour(activePeriod.end)}`,
      detail: "Atendimento em curso na barbearia.",
    };
  }

  const nextPeriod = periods.find((period) => timeToMinutes(period.start) > currentMinutes);
  if (nextPeriod) {
    return {
      title: `${currentMinutes > timeToMinutes(periods[0].end) ? "Reabre" : "Abre"} hoje às ${formatScheduleHour(nextPeriod.start)}`,
      detail: "Atendimento por hora marcada.",
    };
  }

  return {
    title: "Fechado agora",
    detail: "Atendimento por hora marcada no próximo horário.",
  };
}

function getBarberAvatar(barber: { name: string; avatar?: string | null }) {
  if (barber.avatar) return barber.avatar;
  const name = barber.name.toLowerCase();
  if (name.includes("baptista")) return fabioAvatar;
  if (name.includes("bruno")) return brunoAvatar;
  return "/images/logo.jpg";
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function prefetchJsonQuery(queryKey: unknown[], path: string) {
  void queryClient.prefetchQuery({
    queryKey,
    queryFn: async () => {
      const response = await apiFetch(path);
      if (!response.ok) throw new Error(`Failed to prefetch ${path}`);
      return response.json();
    },
  });
}

export default function Home() {
  const [activeSection, setActiveSection] = useState("");
  const { data: services, isLoading: isLoadingServices } = useServices();
  const { data: barbers, isLoading: isLoadingBarbers } = useBarbers();

  const visibleServices = useMemo(() => services?.filter((service) => service.isVisible) ?? [], [services]);
  const visibleBarbers = useMemo(() => barbers?.filter((barber) => barber.isVisible) ?? [], [barbers]);
  const openingStatus = useMemo(() => getTodayOpeningStatus(), []);
  const warmBookingFlow = useCallback(() => {
    void preloadBookingPage();

    const today = getLocalDateKey();
    prefetchJsonQuery(["/api/shop/availability"], "/api/shop/availability");
    prefetchJsonQuery(["/api/barbers/availability"], "/api/barbers/availability");
    prefetchJsonQuery(
      ["/api/appointments/public", { barberId: undefined, date: today }],
      `/api/appointments/public?date=${today}`,
    );
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const current = navItems.find((section) => {
        const element = document.getElementById(section.id);
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.top <= 120 && rect.bottom >= 120;
      });
      setActiveSection(current?.id || "");
    };

    window.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (win.requestIdleCallback) {
      const idleHandle = win.requestIdleCallback(warmBookingFlow, { timeout: 2000 });
      return () => win.cancelIdleCallback?.(idleHandle);
    }

    const timeout = window.setTimeout(warmBookingFlow, 1200);
    return () => window.clearTimeout(timeout);
  }, [warmBookingFlow]);

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground font-body">
      <nav className="fixed top-0 z-50 w-full border-b border-white/5 bg-background/85 backdrop-blur-xl">
        <div className="container mx-auto flex min-w-0 items-center justify-between px-4 py-3 md:px-6 md:py-4">
          <a href="#top" className="flex items-center gap-3">
            <img
              src="/images/logo.jpg"
              alt="Baptista Barber Shop"
              className="h-10 w-10 rounded-full border border-primary/20 object-contain md:h-12 md:w-12"
            />
            <span className="hidden font-display text-lg font-bold text-white sm:inline">Baptista</span>
          </a>

          <div className="hidden gap-7 text-xs font-semibold uppercase tracking-widest md:flex">
            {navItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={cn(
                  "transition-colors",
                  activeSection === item.id ? "text-primary" : "text-gray-400 hover:text-primary",
                )}
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
      </nav>

      <section id="top" className="relative min-h-[68vh] overflow-hidden pt-20 md:min-h-[72vh]">
        <div className="absolute inset-0">
          <img
            src="https://images.unsplash.com/photo-1585747860715-2ba37e788b70?q=80&w=2074&auto=format&fit=crop"
            alt="Interior de barbearia"
            loading="eager"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-black/55" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-background to-transparent" />
        </div>

        <div className="container relative z-10 mx-auto flex min-h-[calc(68vh-5rem)] items-center px-4 pb-10 md:min-h-[calc(72vh-5rem)] md:pb-12">
          <div className="w-full min-w-0 sm:max-w-xl md:max-w-3xl">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-primary">Baptista Barber Shop</p>
            <h1 className="font-display text-3xl font-bold leading-[0.98] text-white sm:text-5xl md:text-7xl">
              Corte e barba com hora marcada
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-gray-300 md:text-lg">
              Serviços essenciais, acabamentos cuidados e atendimento sem pressa no centro da Charneca da Caparica.
            </p>

            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Button
                asChild
                variant="gold"
                size="lg"
                className="h-12 w-full px-8 text-base sm:w-auto"
                onFocus={warmBookingFlow}
                onMouseEnter={warmBookingFlow}
                onTouchStart={warmBookingFlow}
              >
                <Link href="/book">Marcar agora</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-12 w-full border-white/15 bg-black/30 px-8 text-base text-white hover:bg-white/10 hover:text-white sm:w-auto">
                <a href="#services">Ver serviços</a>
              </Button>
            </div>

            <div className="mt-6 w-full rounded-lg border border-white/10 bg-black/30 p-4 backdrop-blur-sm sm:max-w-sm">
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="font-bold text-white">{openingStatus.title}</p>
                  <p className="mt-1 text-sm text-gray-400">{openingStatus.detail}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="services" className="scroll-mt-20 border-b border-white/5 bg-white/[0.02] py-14 md:py-20">
        <div className="container mx-auto px-4">
          <div className="mb-8 max-w-2xl">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Serviços</p>
              <h2 className="mt-2 text-3xl font-bold text-white md:text-5xl">Serviços e preços</h2>
            </div>
          </div>

          {isLoadingServices ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="h-36 animate-pulse rounded-lg border border-white/10 bg-card" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {visibleServices.map((service) => (
                <article key={service.id} className="flex h-full flex-col rounded-lg border border-white/10 bg-card p-5">
                  <div className="flex flex-1 items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Scissors className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-white">{service.name}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-gray-400">{service.description}</p>
                      </div>
                    </div>
                    <p className="shrink-0 font-display text-2xl font-bold text-primary">
                      {(service.price / 100).toFixed(0)}€
                    </p>
                  </div>
                  <p className="mt-auto pt-5 text-xs font-semibold uppercase tracking-widest text-gray-500">{service.duration} min</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section id="team" className="scroll-mt-20 bg-white/[0.03] py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-10 max-w-2xl">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Equipa</p>
              <h2 className="mt-2 text-3xl font-bold text-white md:text-5xl">Conhece a equipa</h2>
              <p className="mt-4 text-sm leading-relaxed text-gray-400 md:text-base">
                Dois estilos, o mesmo cuidado nos detalhes e no acabamento final.
              </p>
            </div>
          </div>

          {isLoadingBarbers ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {visibleBarbers.map((barber) => (
                <motion.article
                  key={barber.id}
                  whileHover={{ y: -4 }}
                  className="overflow-hidden rounded-lg border border-white/10 bg-card"
                >
                  <div className="grid grid-cols-[112px_1fr] gap-0 sm:grid-cols-[160px_1fr]">
                    <img
                      src={getBarberAvatar(barber)}
                      alt={barber.name}
                      className="h-full min-h-44 w-full bg-background object-cover object-top"
                    />
                    <div className="flex min-w-0 flex-col justify-center p-4 sm:p-5">
                      <div className="min-w-0">
                        <h3 className="truncate text-2xl font-bold text-white">{barber.name}</h3>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-primary">{barber.specialty}</p>
                        {barber.bio && <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-gray-400">{barber.bio}</p>}
                      </div>
                    </div>
                  </div>
                </motion.article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section id="location" className="scroll-mt-20 py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-10 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Morada</p>
            <h2 className="mt-2 text-3xl font-bold text-white md:text-5xl">Estamos à tua espera</h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-gray-400">
              Rua Comandante Agatão Lança Nº28, com acesso direto ao mapa para chegares sem voltas.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {["Estacionamento nas proximidades", "Fácil acesso"].map((item) => (
                <span key={item} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-semibold text-gray-300">
                  {item}
                </span>
              ))}
            </div>
            <a href={googleMapsUrl} target="_blank" rel="noreferrer" className="mt-6 inline-flex">
              <Button variant="outline" className="border-white/15 bg-card text-white hover:bg-white/10">
                <MapPin className="mr-2 h-4 w-4" />
                Abrir no Google Maps
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </div>

          <div className="mx-auto aspect-[4/3] max-w-5xl overflow-hidden rounded-lg border border-white/10 bg-card md:aspect-[21/9]">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3118.067464013444!2d-9.0658763!3d38.5901374!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0xd1939638c4c340d%3A0x6734c26a6a2a6b2!2sRua%20Comandante%20Agat%C3%A3o%20Lan%C3%A7a%2028!5e0!3m2!1spt-PT!2spt!4v1700000000000!5m2!1spt-PT!2spt"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="grayscale contrast-[1.1]"
            />
          </div>
        </div>
      </section>

      <footer className="mt-auto border-t border-white/10 bg-black/50 py-10">
        <div className="container mx-auto flex flex-col items-center gap-5 px-4 text-center">
          <img src="/images/logo.jpg" alt="Baptista Barber Shop" className="h-10 w-10 rounded-full object-contain" />
          <p className="text-sm text-gray-500">© 2026 Baptista Barber Shop. Rua Comandante Agatão Lança Nº28.</p>
          <div className="flex flex-wrap justify-center gap-5 text-sm">
            {instagramUrl && (
              <a href={instagramUrl} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-primary">
                Instagram
              </a>
            )}
            <Link
              href="/admin"
              className="text-gray-500 hover:text-primary"
              onFocus={() => void preloadAdminPage()}
              onMouseEnter={() => void preloadAdminPage()}
              onTouchStart={() => void preloadAdminPage()}
            >
              Acesso administrativo
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
