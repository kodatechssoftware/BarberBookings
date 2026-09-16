import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Clock, ExternalLink, MapPin, Scissors } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button-custom";
import { cn } from "@/lib/utils";
import { periodsForShop } from "@/lib/availability";
import { preloadAdminPage, preloadBookingPage } from "@/lib/page-preloads";
import { useBarbers, useShopAvailability } from "@/hooks/use-barbers";
import { useServices } from "@/hooks/use-services";
import { shopBranding } from "@/lib/branding";
import { useLocations } from "@/hooks/use-locations";
import { setActiveLocationId, useActiveLocationId } from "@/lib/location-context";
import { resolveLocationMapLinks } from "@shared/location-maps";

import fabioAvatar from "@assets/fabio-baptista-avatar.jpg";
import brunoAvatar from "@assets/bruno-santos-avatar.jpg";

const instagramUrl = shopBranding.instagramUrl;
const adminUrl = import.meta.env.VITE_ADMIN_URL || "/admin";
const shouldPreloadAdminPage = !/^https?:\/\//i.test(adminUrl);

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

function getTodayOpeningStatus(rows: Array<{ dayOfWeek: number; startTime: string; endTime: string; isOpen: boolean }> | undefined, timeZone: string) {
  if (!rows) return { title: "Consulte os horários", detail: "Atendimento por hora marcada." };
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
  const asTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const periods = periodsForShop({ dayOfWeek: weekday, shopAvailabilityRows: rows })
    .map((period) => ({ start: asTime(period.start), end: asTime(period.end) }))
    .sort((a, b) => a.start.localeCompare(b.start));

  if (periods.length === 0) {
    return {
      title: "Fechado hoje",
      detail: "Atendimento por hora marcada nos restantes dias.",
    };
  }

  const currentMinutes = Number(part("hour")) * 60 + Number(part("minute"));
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
  if (shopBranding.useLegacyBarberAvatars && name.includes("baptista")) return fabioAvatar;
  if (shopBranding.useLegacyBarberAvatars && name.includes("bruno")) return brunoAvatar;
  return shopBranding.logoUrl;
}

export default function Home() {
  const [activeSection, setActiveSection] = useState("");
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [mapFrame, setMapFrame] = useState({ key: "", src: "", loaded: false });
  const {
    data: services,
    isLoading: isLoadingServices,
    isFetching: isFetchingServices,
    isError: isServicesError,
  } = useServices();
  const { data: barbers, isLoading: isLoadingBarbers } = useBarbers();
  const { data: locations } = useLocations();
  const activeLocationId = useActiveLocationId();
  const publicLocations = useMemo(() => {
    const available = locations?.filter((location) => location.isActive) ?? [];
    if (available.length > 0) {
      return available.map((location) => location.isDefault ? {
        ...location,
        address: location.address || shopBranding.address,
        // Legacy branding only fills records without their own address. Empty links
        // on a configured location mean automatic maps, not old environment URLs.
        mapUrl: location.mapUrl || (!location.address.trim() ? shopBranding.mapUrl : ""),
        mapEmbedUrl: location.mapEmbedUrl || (!location.address.trim() ? shopBranding.mapEmbedUrl : ""),
      } : location);
    }
    return [{
      id: 0,
      name: shopBranding.name,
      slug: "principal",
      address: shopBranding.address,
      mapUrl: shopBranding.mapUrl,
      mapEmbedUrl: shopBranding.mapEmbedUrl,
      phone: null,
      email: null,
      timezone: "Europe/Lisbon",
      isActive: true,
      isDefault: true,
      sortOrder: 0,
      createdAt: "",
      updatedAt: "",
    }];
  }, [locations]);
  const selectedLocationId = activeLocationId;
  const selectedLocation = publicLocations.find((location) => location.id === selectedLocationId)
    ?? publicLocations.find((location) => location.isDefault)
    ?? publicLocations[0];
  const selectedMapLinks = resolveLocationMapLinks(selectedLocation);
  const selectedMapKey = `${selectedLocation.id}:${selectedMapLinks.mapEmbedUrl}`;

  useEffect(() => {
    const container = mapContainerRef.current;
    const mapSrc = selectedMapLinks.mapEmbedUrl;
    setMapFrame({ key: selectedMapKey, src: "", loaded: false });
    if (!container || !mapSrc) return;

    if (!("IntersectionObserver" in window)) {
      setMapFrame({ key: selectedMapKey, src: mapSrc, loaded: false });
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setMapFrame({ key: selectedMapKey, src: mapSrc, loaded: false });
      observer.disconnect();
    }, { rootMargin: "400px 0px" });

    observer.observe(container);
    return () => observer.disconnect();
  }, [selectedMapKey, selectedMapLinks.mapEmbedUrl]);

  useEffect(() => {
    if (!locations?.length || selectedLocationId === null) return;
    if (!publicLocations.some((location) => location.id === selectedLocationId)) {
      setActiveLocationId(null);
    }
  }, [locations, publicLocations, selectedLocationId]);

  const visibleServices = useMemo(() => services?.filter((service) => service.isVisible) ?? [], [services]);
  // [] is a valid response. Keep usable services visible during background refetches.
  const showServicesSkeleton = services === undefined && (isLoadingServices || isFetchingServices);
  const showServicesFallback = services === undefined && isServicesError;
  const visibleBarbers = useMemo(() => barbers?.filter((barber) => barber.isVisible) ?? [], [barbers]);
  const {
    data: shopHours,
    isLoading: isLoadingShopHours,
    isFetching: isFetchingShopHours,
    isError: isShopHoursError,
  } = useShopAvailability({ locationId: activeLocationId });
  // [] is valid availability data. A background refetch must not hide a known status.
  const showOpeningSkeleton = shopHours === undefined && (isLoadingShopHours || isFetchingShopHours);
  const showOpeningFallback = shopHours === undefined && isShopHoursError;
  const openingStatus = getTodayOpeningStatus(shopHours, selectedLocation.timezone);
  const warmBookingFlow = useCallback(() => {
    void preloadBookingPage();
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
              src={shopBranding.logoUrl}
              alt={shopBranding.name}
              className="h-10 w-10 rounded-full border border-primary/20 object-contain md:h-12 md:w-12"
            />
            <span className="hidden font-display text-lg font-bold text-white sm:inline">{shopBranding.shortName}</span>
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
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-primary">{shopBranding.name}</p>
            <h1 className="font-display text-3xl font-bold leading-[0.98] text-white sm:text-5xl md:text-7xl">
              Corte e barba com hora marcada
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-gray-300 md:text-lg">
              Cortes, barba e acabamentos cuidados, com atenção ao detalhe.
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

            <div
              data-testid="home-opening-card"
              aria-busy={showOpeningSkeleton}
              className="mt-6 w-full rounded-lg border border-white/10 bg-black/30 p-4 backdrop-blur-sm sm:max-w-sm"
            >
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 min-h-[4.25rem] flex-1">
                  {showOpeningSkeleton ? (
                    <div data-testid="home-opening-skeleton" role="status" aria-label="A carregar horários" className="space-y-2 pt-0.5">
                      <span className="block h-5 w-4/5 animate-pulse rounded bg-white/15" aria-hidden="true" />
                      <span className="block h-4 w-11/12 animate-pulse rounded bg-white/10" aria-hidden="true" />
                    </div>
                  ) : (
                    <>
                      <p className="font-bold text-white">{showOpeningFallback ? "Consulte os horários" : openingStatus.title}</p>
                      <p className="mt-1 text-sm text-gray-400">{showOpeningFallback ? "Atendimento por hora marcada." : openingStatus.detail}</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="services" aria-busy={showServicesSkeleton} className="scroll-mt-20 border-b border-white/5 bg-white/[0.02] py-14 md:py-20">
        <div className="container mx-auto px-4">
          <div className="mb-8 max-w-2xl">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Serviços</p>
              <h2 className="mt-2 text-3xl font-bold text-white md:text-5xl">Serviços e preços</h2>
            </div>
          </div>

          {showServicesSkeleton ? (
            <div data-testid="home-services-skeleton" role="status" aria-label="A carregar serviços" className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} data-testid="home-service-skeleton-card" aria-hidden="true" className="flex h-56 animate-pulse flex-col rounded-lg border border-white/10 bg-card p-5 md:h-36">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <span className="h-10 w-10 shrink-0 rounded-md bg-white/10" />
                      <div className="space-y-2 pt-1">
                        <span className="block h-4 w-24 rounded bg-white/15" />
                        <span className="block h-3 w-32 rounded bg-white/10" />
                        <span className="block h-3 w-24 rounded bg-white/10 md:hidden" />
                      </div>
                    </div>
                    <span className="h-6 w-12 shrink-0 rounded bg-white/15" />
                  </div>
                  <span className="mt-auto h-3 w-14 rounded bg-white/10" />
                </div>
              ))}
            </div>
          ) : showServicesFallback ? (
            <p className="text-sm text-gray-400">Não foi possível carregar os serviços neste momento.</p>
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
                Diferentes estilos, o mesmo cuidado nos detalhes e no acabamento final.
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
                      loading="lazy"
                      decoding="async"
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
              {publicLocations.length > 1
                ? "Escolhe a localização mais conveniente e consulta a respetiva morada e mapa."
                : `${selectedLocation.address}${shopBranding.showMap ? ", com acesso direto ao mapa para chegares sem voltas." : "."}`}
            </p>
            {publicLocations.length > 1 && (
              <div className="mx-auto mt-7 grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {publicLocations.map((location) => {
                  const selected = location.id === selectedLocation.id;
                  return (
                    <button
                      key={location.id}
                      type="button"
                      onClick={() => {
                        setActiveLocationId(location.id);
                      }}
                      aria-pressed={selected}
                      className={cn(
                        "min-h-28 rounded-xl border p-4 text-left transition-colors",
                        selected
                          ? "border-primary bg-primary/10"
                          : "border-white/10 bg-card hover:border-primary/40",
                      )}
                    >
                      <span className="flex items-center gap-2 font-bold text-white">
                        <MapPin className="h-4 w-4 shrink-0 text-primary" /> {location.name}
                      </span>
                      <span className="mt-2 block text-xs leading-relaxed text-gray-400">{location.address}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {publicLocations.length > 1 && (
              <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-gray-300">
                <strong className="text-white">{selectedLocation.name}</strong><br />{selectedLocation.address}
              </p>
            )}
            {shopBranding.showMap && <div className="mt-5 flex flex-wrap justify-center gap-2">
              {["Estacionamento nas proximidades", "Fácil acesso"].map((item) => (
                <span key={item} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-semibold text-gray-300">
                  {item}
                </span>
              ))}
            </div>}
            {shopBranding.showMap && selectedMapLinks.mapUrl && <a href={selectedMapLinks.mapUrl} target="_blank" rel="noreferrer" className="mt-6 inline-flex">
              <Button variant="outline" className="border-white/15 bg-card text-white hover:bg-white/10">
                <MapPin className="mr-2 h-4 w-4" />
                Abrir no Google Maps
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </a>}
          </div>

          {shopBranding.showMap && selectedMapLinks.mapEmbedUrl && <div
            ref={mapContainerRef}
            data-testid="location-map-container"
            className="relative mx-auto aspect-[4/3] max-w-5xl overflow-hidden rounded-lg border border-white/10 bg-card md:aspect-[21/9]"
          >
            {(!mapFrame.loaded || mapFrame.key !== selectedMapKey) && (
              <div
                data-testid="location-map-placeholder"
                aria-hidden="true"
                className="absolute inset-0 animate-pulse bg-white/[0.04]"
              />
            )}
            {mapFrame.key === selectedMapKey && mapFrame.src && (
              <iframe
                key={selectedMapKey}
                title={`Mapa de ${selectedLocation.name}`}
                src={mapFrame.src}
                width="100%"
                height="100%"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                onLoad={() => setMapFrame((current) => current.key === selectedMapKey
                  ? { ...current, loaded: true }
                  : current)}
                className="relative h-full w-full grayscale contrast-[1.1]"
              />
            )}
          </div>}
        </div>
      </section>

      <footer className="mt-auto border-t border-white/10 bg-black/50 py-10">
        <div className="container mx-auto flex flex-col items-center gap-5 px-4 text-center">
          <img src={shopBranding.logoUrl} alt={shopBranding.name} className="h-10 w-10 rounded-full object-contain" />
          <p className="text-sm text-gray-500">© 2026 {shopBranding.name}. {shopBranding.address}.</p>
          <div className="flex flex-wrap justify-center gap-5 text-sm">
            {instagramUrl && (
              <a href={instagramUrl} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-primary">
                Instagram
              </a>
            )}
            <a
              href={adminUrl}
              className="text-gray-500 hover:text-primary"
              onFocus={() => {
                if (shouldPreloadAdminPage) void preloadAdminPage();
              }}
              onMouseEnter={() => {
                if (shouldPreloadAdminPage) void preloadAdminPage();
              }}
              onTouchStart={() => {
                if (shouldPreloadAdminPage) void preloadAdminPage();
              }}
            >
              Acesso administrativo
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
