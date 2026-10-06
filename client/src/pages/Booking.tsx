import { useEffect, useState, useMemo, useRef, type ChangeEvent, type ClipboardEvent, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useBarberAvailability, useBarbers, useShopAvailability } from "@/hooks/use-barbers";
import { useServices } from "@/hooks/use-services";
import { type AppointmentRecord, useCreateAppointment, usePublicAppointments } from "@/hooks/use-appointments";
import { Button } from "@/components/ui/button-custom";
import { ChevronLeft, Check, Calendar as CalendarIcon, Clock, User, Scissors, Loader2, MapPin } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { eachDayOfInterval, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfToday, startOfWeek } from "date-fns";
import { pt } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calendarTimeInTimeZone, type AvailabilityRow, type ShopAvailabilityRow, canBarberPerformService, dateKeyInTimeZone, findFirstAvailableDate, getAvailableTimeSlots, periodsForShop } from "@/lib/availability";
import fabioAvatar from "@assets/fabio-baptista-avatar.jpg";
import { shopBranding } from "@/lib/branding";
import brunoAvatar from "@assets/bruno-santos-avatar.jpg";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  formatPhoneInput,
  getPhoneCountry,
  isDigitsOnly,
  isValidPhoneForCountry,
  splitStoredPhone,
  toStoredPhone,
  type PhoneCountryCode,
} from "@shared/phone-countries";
import { usePublicBookingWindow } from "@/hooks/use-public-booking-window";
import { useRuntimeConfig } from "@/hooks/use-runtime-config";
import {
  DEFAULT_BOOKING_SLOT_INTERVAL_MINUTES,
  isClockTimeAligned,
} from "@shared/booking-slot-interval";
import { useLocations } from "@/hooks/use-locations";
import { setActiveLocationId } from "@/lib/location-context";
import {
  formatPublicBookingMonthOpeningNotice,
  getPublicBookingMonthOpeningNotice,
} from "@shared/public-booking-window";
import type { ServiceCatalogueItem } from "@shared/schema";
import { groupServicesForDisplay } from "@/lib/service-groups";

type BookingPreference = {
  step: number;
  barberId: number | null;
  serviceId: number | null;
  selectedDate: Date;
  selectedTime: string | null;
  phoneCountryCode: PhoneCountryCode;
  customerDetails: {
    name: string;
    email: string;
    phone: string;
  };
};

const lastBookingStorageKey = "baptista:lastBooking";
const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 120;
type CustomerField = keyof BookingPreference["customerDetails"];

const isValidOptionalEmail = (value: string) => {
  if (!value.trim()) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
};

const parseNumericParam = (value: string | null) => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const parseDateParam = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

const parseTimeParam = (value: string | null) => {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return value;
};

const readLastBookingPreference = () => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(lastBookingStorageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<{
      barberId: number;
      serviceId: number;
      customerName: string;
      customerEmail: string;
      customerPhone: string;
    }>;

    return {
      barberId: typeof parsed.barberId === "number" ? parsed.barberId : null,
      serviceId: typeof parsed.serviceId === "number" ? parsed.serviceId : null,
      customerName: parsed.customerName || "",
      customerEmail: parsed.customerEmail || "",
      customerPhone: parsed.customerPhone || "",
    };
  } catch {
    return null;
  }
};

const getInitialBookingPreference = (): BookingPreference => {
  const emptyPreference = {
    step: 1,
    barberId: null,
    serviceId: null,
    selectedDate: startOfToday(),
    selectedTime: null,
    phoneCountryCode: DEFAULT_PHONE_COUNTRY.code,
    customerDetails: { name: "", email: "", phone: "" },
  };

  if (typeof window === "undefined") return emptyPreference;

  const params = new URLSearchParams(window.location.search);
  const lastBooking = params.get("repeat") === "last" ? readLastBookingPreference() : null;
  const barberId = parseNumericParam(params.get("barberId")) ?? lastBooking?.barberId ?? null;
  const serviceId = parseNumericParam(params.get("serviceId")) ?? lastBooking?.serviceId ?? null;
  const today = startOfToday();
  const parsedDate = parseDateParam(params.get("date"));
  const validRequestedDate = parsedDate && parsedDate.getTime() >= today.getTime() ? parsedDate : null;
  const selectedDate = validRequestedDate ?? today;
  const selectedTime = validRequestedDate ? parseTimeParam(params.get("time")) : null;
  const phonePreference = splitStoredPhone(lastBooking?.customerPhone || "");

  return {
    step: barberId !== null && serviceId !== null && selectedTime ? 4 : barberId !== null && serviceId !== null ? 3 : barberId !== null ? 2 : 1,
    barberId,
    serviceId,
    selectedDate,
    selectedTime,
    phoneCountryCode: phonePreference.countryCode,
    customerDetails: {
      name: lastBooking?.customerName || "",
      email: lastBooking?.customerEmail || "",
      phone: phonePreference.localPhone,
    },
  };
};

const saveLastBookingPreference = ({
  barberId,
  serviceId,
  customerName,
  customerEmail,
  customerPhone,
}: {
  barberId: number;
  serviceId: number;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
}) => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      lastBookingStorageKey,
      JSON.stringify({
        barberId,
        serviceId,
        customerName,
        customerEmail: customerEmail || "",
        customerPhone,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Falhas de localStorage não devem impedir uma marcação confirmada.
  }
};

function getBarberAvatar(barber: { name: string; avatar?: string | null }, locationLogoUrl: string) {
  const customAvatar = barber.avatar?.trim();
  if (customAvatar) return customAvatar;

  const name = barber.name.toLowerCase();
  if (shopBranding.useLegacyBarberAvatars && name.includes("baptista")) return fabioAvatar;
  if (shopBranding.useLegacyBarberAvatars && name.includes("bruno")) return brunoAvatar;
  return locationLogoUrl;
}

function getBarberAvatarFallback(barber: { name: string }) {
  const name = barber.name.toLowerCase();
  if (shopBranding.useLegacyBarberAvatars && name.includes("baptista")) return fabioAvatar;
  if (shopBranding.useLegacyBarberAvatars && name.includes("bruno")) return brunoAvatar;
  return shopBranding.logoUrl;
}

const BarberCardSkeleton = () => (
  <div className="overflow-hidden rounded-xl border border-white/5 bg-card">
    <div className="aspect-[4/3] sm:aspect-[4/5] lg:aspect-[4/3] animate-pulse bg-white/5" />
    <div className="space-y-3 p-4">
      <div className="h-4 w-2/3 animate-pulse rounded bg-white/10" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-white/5" />
    </div>
  </div>
);

const ServiceCardSkeleton = () => (
  <div className="flex min-h-[112px] items-center gap-4 rounded-xl border border-white/5 bg-card p-4 md:p-6">
    <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-white/10" />
    <div className="min-w-0 flex-1 space-y-3">
      <div className="h-4 w-2/3 animate-pulse rounded bg-white/10" />
      <div className="h-3 w-full animate-pulse rounded bg-white/5" />
      <div className="h-3 w-20 animate-pulse rounded bg-white/5" />
    </div>
    <div className="h-5 w-16 animate-pulse rounded bg-white/10" />
  </div>
);

const BookingStepContent = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div data-testid="booking-step-content" className={cn("mx-auto w-full max-w-5xl", className)}>
    {children}
  </div>
);

const BookingStepHeading = ({ title, description }: { title: string; description: string }) => (
  <div className="mx-auto max-w-2xl text-center">
    <h2 className="font-display text-2xl font-bold sm:text-3xl">{title}</h2>
    <p className="mt-2 text-sm leading-relaxed text-gray-400 sm:text-base">{description}</p>
  </div>
);

const BookingEmptyState = ({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "error" }) => (
  <div
    data-testid="booking-empty-state"
    className={cn(
      "flex min-h-36 w-full items-center justify-center rounded-2xl border px-6 py-8 text-center text-sm leading-relaxed sm:min-h-40 sm:px-10 sm:text-base",
      tone === "error"
        ? "border-red-500/20 bg-red-500/10 text-red-200"
        : "border-dashed border-white/10 bg-white/[0.02] text-gray-400",
    )}
  >
    <p className="max-w-2xl">{children}</p>
  </div>
);

// Step components
const StepIndicator = ({ currentStep }: { currentStep: number }) => {
  const steps = ["Barbeiro", "Serviço", "Data e hora", "Detalhes"];
  return (
    <div data-testid="booking-stepper" className="mx-auto mb-7 w-full max-w-3xl py-3 sm:mb-9 sm:py-4">
      <div className="relative z-10 flex items-start justify-between">
        <div className="absolute left-[12.5%] right-[12.5%] top-3.5 -z-10 h-0.5 overflow-hidden bg-white/10 sm:top-4">
          <div
            className="h-full bg-primary transition-[width] duration-300"
            style={{ width: `${((currentStep - 1) / 3) * 100}%` }}
          />
        </div>
        {steps.map((step, i) => (
          <div key={step} className="flex w-1/4 min-w-0 flex-col items-center gap-1.5 sm:gap-2">
            <div 
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border-2 bg-background text-xs font-bold transition-colors duration-300 sm:h-8 sm:w-8 sm:text-sm",
                currentStep > i + 1 ? "border-primary bg-primary text-background" : 
                currentStep === i + 1 ? "border-primary text-primary" : "border-white/20 text-gray-500"
              )}
              aria-current={currentStep === i + 1 ? "step" : undefined}
            >
              {currentStep > i + 1 ? <Check className="h-3 w-3 sm:h-4 sm:w-4" /> : i + 1}
            </div>
            <span className={cn(
              "px-0.5 text-center text-[10px] font-medium leading-tight transition-colors duration-300 sm:px-1 sm:text-xs",
              currentStep >= i + 1 ? "text-white" : "text-gray-600"
            )}>
              {step}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function Booking() {
  const [initialPreference] = useState(getInitialBookingPreference);
  const [step, setStep] = useState(initialPreference.step);
  const [selectedBarberId, setSelectedBarberId] = useState<number | null>(initialPreference.barberId);
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(initialPreference.serviceId);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(initialPreference.selectedDate);
  const [visibleCalendarMonth, setVisibleCalendarMonth] = useState<Date>(initialPreference.selectedDate);
  const [selectedTime, setSelectedTime] = useState<string | null>(initialPreference.selectedTime);
  const [selectedPhoneCountry, setSelectedPhoneCountry] = useState<PhoneCountryCode>(initialPreference.phoneCountryCode);
  const [showTimeError, setShowTimeError] = useState(false);
  const [customerDetails, setCustomerDetails] = useState(initialPreference.customerDetails);
  const [customerTouched, setCustomerTouched] = useState<Record<CustomerField, boolean>>({
    name: false,
    phone: false,
    email: false,
  });
  const [createdAppointment, setCreatedAppointment] = useState<AppointmentRecord | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: locations = [], isLoading: loadingLocations, isError: locationsError } = useLocations({ purpose: "booking" });
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const activeLocation = locations.find((location) => location.id === selectedLocationId);
  const hasMultipleLocations = locations.length > 1;

  useEffect(() => {
    if (locations.length === 1) {
      const [onlyLocation] = locations;
      if (selectedLocationId !== onlyLocation.id) {
        setSelectedLocationId(onlyLocation.id);
        setActiveLocationId(onlyLocation.id);
      }
      return;
    }
    if (selectedLocationId === null || locations.some((location) => location.id === selectedLocationId)) return;
    setSelectedLocationId(null);
    setActiveLocationId(null);
    setSelectedBarberId(null);
    setSelectedServiceId(null);
    setSelectedTime(null);
    setStep(1);
  }, [locations, selectedLocationId]);

  const selectBookingLocation = (locationId: number | null) => {
    setSelectedBarberId(null);
    setSelectedServiceId(null);
    setSelectedTime(null);
    setShowTimeError(false);
    setStep(1);
    setSelectedLocationId(locationId);
    setActiveLocationId(locationId);
  };
  const canLoadLocationData = Boolean(activeLocation);
  const {
    data: barbers,
    isLoading: loadingBarbers,
    isFetching: fetchingBarbers,
    isError: barbersError,
  } = useBarbers({ enabled: canLoadLocationData, locationId: activeLocation?.id });
  const {
    data: services,
    isLoading: loadingServices,
    isFetching: fetchingServices,
    isError: servicesError,
  } = useServices({ enabled: canLoadLocationData, locationId: activeLocation?.id });
  const {
    data: availabilityRows,
    isLoading: loadingAvailability,
    isError: availabilityError,
  } = useBarberAvailability({ locationId: activeLocation?.id, enabled: canLoadLocationData });
  const {
    data: shopAvailabilityRows,
    isLoading: loadingShopAvailability,
    isError: shopAvailabilityError,
  } = useShopAvailability({ locationId: activeLocation?.id ?? null, enabled: canLoadLocationData });
  const { data: publicBookingWindow, isLoading: loadingPublicBookingWindow } = usePublicBookingWindow();
  const {
    data: runtimeConfig,
    isLoading: loadingRuntimeConfig,
    isError: runtimeConfigError,
  } = useRuntimeConfig();
  const bookingSlotIntervalMinutes = runtimeConfig?.bookingSlotIntervalMinutes
    ?? DEFAULT_BOOKING_SLOT_INTERVAL_MINUTES;
  useEffect(() => {
    if (!runtimeConfig || !selectedTime || isClockTimeAligned(selectedTime, bookingSlotIntervalMinutes)) return;
    setSelectedTime(null);
    setStep((currentStep) => Math.min(currentStep, 3));
  }, [bookingSlotIntervalMinutes, runtimeConfig, selectedTime]);
  const createAppointment = useCreateAppointment({ locationId: activeLocation?.id });
  const maxPublicBookingDate = useMemo(
    () => parseDateParam(publicBookingWindow?.maxDate ?? null),
    [publicBookingWindow?.maxDate],
  );
  const isPublicDateAllowed = (date: Date) =>
    Boolean(publicBookingWindow && format(date, "yyyy-MM-dd") >= publicBookingWindow.today && format(date, "yyyy-MM-dd") <= publicBookingWindow.maxDate);
  const visibleBarbers = useMemo(() => barbers?.filter((barber) => barber.isVisible) ?? [], [barbers]);
  const visibleServices = useMemo(() => services?.filter((service) => service.isVisible) ?? [], [services]);
  const selectedBarber = visibleBarbers.find((barber) => barber.id === selectedBarberId);
  const locationTimeZone = activeLocation?.timezone || "Europe/Lisbon";
  useEffect(() => {
    if (!activeLocation || !barbers || selectedBarberId === null || selectedBarberId === 0) return;
    if (visibleBarbers.some((barber) => barber.id === selectedBarberId)) return;
    setSelectedBarberId(null);
    setSelectedServiceId(null);
    setSelectedTime(null);
    setStep(1);
  }, [activeLocation, barbers, selectedBarberId, visibleBarbers]);
  const availableServices = useMemo(() => {
    if (selectedBarberId && selectedBarberId !== 0) {
      return visibleServices.filter((service) => canBarberPerformService(selectedBarber, service.id));
    }

    return visibleServices.filter((service) =>
      visibleBarbers.some((barber) => canBarberPerformService(barber, service.id)),
    );
  }, [selectedBarber, selectedBarberId, visibleBarbers, visibleServices]);
  const availableServiceGroups = useMemo(
    () => groupServicesForDisplay(availableServices),
    [availableServices],
  );
  const hasVisibleServiceCategories = availableServiceGroups.some((group) => group.label !== null);
  const renderServiceCard = (service: ServiceCatalogueItem) => (
    <div
      key={service.id}
      onClick={() => setSelectedServiceId(service.id)}
      className={cn(
        "flex min-h-[112px] items-stretch justify-between p-4 md:p-6 rounded-xl border bg-card cursor-pointer transition-all duration-200",
        selectedServiceId === service.id
          ? "border-primary bg-primary/5"
          : "border-white/5 hover:border-white/20 hover:bg-white/5"
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 md:gap-4">
        <div className={cn(
          "w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center border shrink-0",
          selectedServiceId === service.id ? "border-primary text-primary" : "border-white/20 text-gray-400"
        )}>
          <Scissors className="w-4 h-4 md:w-5 md:h-5" />
        </div>
        <div className="flex min-h-full min-w-0 flex-col justify-between">
          <h3 className="font-bold text-sm md:text-lg text-white leading-tight">{service.name}</h3>
          <p className="mt-1 text-xs md:text-sm text-gray-400 line-clamp-2">{service.description}</p>
          <p className="mt-3 text-[10px] md:text-xs text-gray-500">{service.duration} min</p>
        </div>
      </div>
      <div className="self-center text-right pl-2">
        <span className="block text-base md:text-xl font-bold text-primary font-display whitespace-nowrap">
          {(service.price / 100).toFixed(2)}€
        </span>
      </div>
    </div>
  );

  const bookingWindowStart = useMemo(
    () => parseDateParam(publicBookingWindow?.today ?? null),
    [publicBookingWindow?.today],
  );
  const {
    data: bookingWindowAppointments,
    isLoading: loadingBookingWindowAppointments,
    isError: bookingWindowAppointmentsError,
  } = usePublicAppointments({
    locationId: activeLocation?.id,
    barberId: selectedBarberId === 0 ? undefined : selectedBarberId?.toString(),
    startDate: publicBookingWindow?.today,
    endDate: publicBookingWindow?.maxDate,
    enabled: step === 3 && selectedBarberId !== null && Boolean(selectedServiceId && publicBookingWindow),
  });

  // Keep the small daily request as the fast path until the complete booking
  // window is available. Afterwards, every selected day is derived locally.
  const {
    data: selectedDateAppointments,
    isLoading: loadingSelectedDateAppointments,
    isError: selectedDateAppointmentsError,
  } = usePublicAppointments({
    locationId: activeLocation?.id,
    barberId: selectedBarberId === 0 ? undefined : selectedBarberId?.toString(),
    date: selectedDate && isPublicDateAllowed(selectedDate) ? format(selectedDate, "yyyy-MM-dd") : undefined,
    enabled: step === 3
      && bookingWindowAppointments === undefined
      && selectedBarberId !== null
      && Boolean(selectedServiceId && selectedDate && isPublicDateAllowed(selectedDate)),
  });
  const existingAppointments = useMemo(() => {
    if (bookingWindowAppointments === undefined || !selectedDate) return selectedDateAppointments;
    const selectedDateKey = format(selectedDate, "yyyy-MM-dd");
    return bookingWindowAppointments.filter((appointment) =>
      dateKeyInTimeZone(new Date(appointment.startTime), locationTimeZone) === selectedDateKey,
    );
  }, [bookingWindowAppointments, locationTimeZone, selectedDate, selectedDateAppointments]);
  const loadingAppointments = bookingWindowAppointments === undefined && loadingSelectedDateAppointments;
  const appointmentsError = bookingWindowAppointments === undefined && selectedDateAppointmentsError;

  useEffect(() => {
    if (!publicBookingWindow || !selectedDate || isPublicDateAllowed(selectedDate)) return;
    const today = parseDateParam(publicBookingWindow.today) ?? startOfToday();
    setSelectedDate(today);
    setVisibleCalendarMonth(today);
    setSelectedTime(null);
    setStep((currentStep) => Math.min(currentStep, 3));
  }, [publicBookingWindow, selectedDate]);

  const monthStart = startOfMonth(visibleCalendarMonth);
  const monthEnd = endOfMonth(visibleCalendarMonth);
  const bookingMonthOpeningNotice = useMemo(
    () => getPublicBookingMonthOpeningNotice(
      publicBookingWindow,
      format(visibleCalendarMonth, "yyyy-MM-dd"),
    ),
    [publicBookingWindow, visibleCalendarMonth],
  );
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const selectedService = availableServices.find((service) => service.id === selectedServiceId);
  const selectedBarberLabel = selectedBarberId === 0 ? "Sem preferência" : selectedBarber?.name;
  const selectedPhoneCountryData = getPhoneCountry(selectedPhoneCountry);
  const customerFieldErrors = useMemo(() => {
    const digits = customerDetails.phone.replace(/\D/g, "");
    const phoneLengthLabel = selectedPhoneCountryData.minDigits === selectedPhoneCountryData.maxDigits
      ? `${selectedPhoneCountryData.minDigits} dígitos`
      : `entre ${selectedPhoneCountryData.minDigits} e ${selectedPhoneCountryData.maxDigits} dígitos`;

    return {
      name: customerDetails.name.trim() ? "" : "Indique o nome para a marcação.",
      phone: !digits
        ? "Indique o telemóvel para confirmarmos a marcação."
        : isValidPhoneForCountry(customerDetails.phone, selectedPhoneCountry)
          ? ""
          : `Confirme que o número tem ${phoneLengthLabel} para ${selectedPhoneCountryData.label}.`,
      email: isValidOptionalEmail(customerDetails.email)
        ? ""
        : "Indique um email válido ou deixe o campo vazio.",
    };
  }, [customerDetails.email, customerDetails.name, customerDetails.phone, selectedPhoneCountry, selectedPhoneCountryData]);
  const showCustomerError = (field: CustomerField) => customerTouched[field] && Boolean(customerFieldErrors[field]);
  const markCustomerTouched = (field: CustomerField) => {
    setCustomerTouched((current) => ({ ...current, [field]: true }));
  };
  const handleCustomerPhoneBeforeInput = (event: FormEvent<HTMLInputElement>) => {
    const inputEvent = event.nativeEvent as InputEvent;
    if (inputEvent.data && !isDigitsOnly(inputEvent.data)) {
      event.preventDefault();
    }
  };
  const handleCustomerPhonePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (!isDigitsOnly(event.clipboardData.getData("text"))) {
      event.preventDefault();
    }
  };
  const handleCustomerPhoneChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawPhone = event.currentTarget.value;
    if (!isDigitsOnly(rawPhone)) {
      event.currentTarget.value = customerDetails.phone;
      return;
    }

    const phone = rawPhone.slice(0, selectedPhoneCountryData.maxDigits);
    event.currentTarget.value = phone;
    setCustomerDetails((prev) => ({ ...prev, phone }));
  };

  useEffect(() => {
    if (!selectedServiceId) return;
    if (!barbers || !services) return;
    if (availableServices.some((service) => service.id === selectedServiceId)) return;

    setSelectedServiceId(null);
    setSelectedTime(null);
    if (step > 2) setStep(2);
  }, [availableServices, barbers, selectedServiceId, services, step]);

  // Generate Time Slots
  const timeSlots = useMemo(() => {
    if (!runtimeConfig) return [];
    return getAvailableTimeSlots({
      selectedService,
      selectedDate,
      selectedBarberId,
      visibleBarbers,
      availabilityRows: (availabilityRows as AvailabilityRow[] | undefined) ?? [],
      shopAvailabilityRows: (shopAvailabilityRows as ShopAvailabilityRow[] | undefined) ?? [],
      existingAppointments,
      timeZone: locationTimeZone,
      slotIntervalMinutes: bookingSlotIntervalMinutes,
    });
  }, [availabilityRows, bookingSlotIntervalMinutes, existingAppointments, locationTimeZone, runtimeConfig, selectedBarberId, selectedDate, selectedService, shopAvailabilityRows, visibleBarbers]);
  const shopAvailabilityForCalendar = useMemo(
    () => (shopAvailabilityRows as ShopAvailabilityRow[] | undefined) ?? [],
    [shopAvailabilityRows],
  );
  const isShopClosedDate = (date: Date) => periodsForShop({
    dayOfWeek: date.getDay(),
    shopAvailabilityRows: shopAvailabilityForCalendar,
  }).length === 0;
  const selectedDateIsShopClosed = selectedDate ? isShopClosedDate(selectedDate) : false;

  const availableDateKeys = useMemo(() => {
    if (!runtimeConfig || !selectedService || selectedBarberId === null) return new Set<string>();
    if (loadingBookingWindowAppointments || bookingWindowAppointmentsError || !bookingWindowAppointments) return new Set<string>();

    const today = startOfToday();
    const appointments = bookingWindowAppointments;
    const availability = (availabilityRows as AvailabilityRow[] | undefined) ?? [];
    const availableKeys = new Set<string>();

    eachDayOfInterval({ start: calendarStart, end: calendarEnd }).forEach((date) => {
      if (date < today || !isPublicDateAllowed(date)) return;
      if (periodsForShop({ dayOfWeek: date.getDay(), shopAvailabilityRows: shopAvailabilityForCalendar }).length === 0) return;

      const slots = getAvailableTimeSlots({
        selectedService,
        selectedDate: date,
        selectedBarberId,
        visibleBarbers,
        availabilityRows: availability,
        shopAvailabilityRows: shopAvailabilityForCalendar,
        existingAppointments: appointments,
        timeZone: locationTimeZone,
        slotIntervalMinutes: bookingSlotIntervalMinutes,
      });

      if (slots.some((slot) => slot.available)) {
        availableKeys.add(format(date, "yyyy-MM-dd"));
      }
    });

    return availableKeys;
  }, [
    availabilityRows,
    bookingSlotIntervalMinutes,
    bookingWindowAppointments,
    bookingWindowAppointmentsError,
    calendarEnd,
    calendarStart,
    loadingBookingWindowAppointments,
    selectedBarberId,
    selectedService,
    shopAvailabilityForCalendar,
    visibleBarbers,
    locationTimeZone,
    runtimeConfig,
  ]);

  const initialAvailabilitySelectionKey = [
    activeLocation?.id,
    selectedBarberId,
    selectedServiceId,
    publicBookingWindow?.today,
    publicBookingWindow?.maxDate,
  ].join(":");
  const completedInitialAvailabilityKey = useRef<string | null>(null);
  const failedInitialAvailabilityKey = useRef<string | null>(null);
  const loadingInitialAvailability = loadingBarbers || fetchingBarbers || loadingServices || fetchingServices || loadingAvailability
    || loadingShopAvailability || loadingPublicBookingWindow || loadingRuntimeConfig || loadingBookingWindowAppointments;
  const initialAvailabilityHasError = barbersError || servicesError || availabilityError || shopAvailabilityError
    || runtimeConfigError || bookingWindowAppointmentsError;
  const firstAvailableDate = useMemo(() => {
    if (!bookingWindowStart || !maxPublicBookingDate || !selectedService || selectedBarberId === null
      || !runtimeConfig || !bookingWindowAppointments || initialAvailabilityHasError) return undefined;
    return findFirstAvailableDate({
      startDate: bookingWindowStart,
      endDate: maxPublicBookingDate,
      selectedService,
      selectedBarberId,
      visibleBarbers,
      availabilityRows: (availabilityRows as AvailabilityRow[] | undefined) ?? [],
      shopAvailabilityRows: shopAvailabilityForCalendar,
      existingAppointments: bookingWindowAppointments,
      timeZone: locationTimeZone,
      slotIntervalMinutes: bookingSlotIntervalMinutes,
    });
  }, [availabilityRows, bookingSlotIntervalMinutes, bookingWindowAppointments, bookingWindowStart, initialAvailabilityHasError,
    locationTimeZone, maxPublicBookingDate, runtimeConfig, selectedBarberId, selectedService, shopAvailabilityForCalendar, visibleBarbers]);

  useEffect(() => {
    if (step !== 3 || loadingInitialAvailability
      || completedInitialAvailabilityKey.current === initialAvailabilitySelectionKey) return;
    if (initialAvailabilityHasError) {
      completedInitialAvailabilityKey.current = initialAvailabilitySelectionKey;
      failedInitialAvailabilityKey.current = initialAvailabilitySelectionKey;
      setSelectedDate(undefined);
      setSelectedTime(null);
      return;
    }
    if (firstAvailableDate === undefined) return;
    completedInitialAvailabilityKey.current = initialAvailabilitySelectionKey;
    failedInitialAvailabilityKey.current = null;
    setSelectedDate(firstAvailableDate ?? undefined);
    if (firstAvailableDate) setVisibleCalendarMonth(firstAvailableDate);
    else if (bookingWindowStart) setVisibleCalendarMonth(bookingWindowStart);
    setSelectedTime(null);
    setShowTimeError(false);
  }, [bookingWindowStart, firstAvailableDate, initialAvailabilityHasError, initialAvailabilitySelectionKey,
    loadingInitialAvailability, step]);
  const loadingSelectedDateAvailability = loadingBarbers || loadingServices || loadingAvailability
    || loadingShopAvailability || loadingPublicBookingWindow || loadingRuntimeConfig || loadingAppointments;
  const initialAvailabilityError = step === 3
    && failedInitialAvailabilityKey.current === initialAvailabilitySelectionKey;
  const noAvailabilityInBookingWindow = step === 3
    && completedInitialAvailabilityKey.current === initialAvailabilitySelectionKey
    && firstAvailableDate === null;

  const handleNext = () => {
    if (step === 3 && !selectedTime) {
      setShowTimeError(true);
      toast({
        title: "Seleção necessária",
        description: "Escolha uma hora para a sua marcação.",
        variant: "destructive"
      });
      // Force scroll to time section if needed
      return;
    }
    setShowTimeError(false);
    setStep(prev => prev + 1);
    window.scrollTo(0, 0);
  };
  const handleBack = () => setStep(prev => prev - 1);

  const handleSubmit = async () => {
    if (!activeLocation || selectedBarberId === null || !selectedServiceId || !selectedDate || !selectedTime) {
      toast({ title: "Erro", description: "Confirme barbeiro, serviço, data e hora.", variant: "destructive" });
      return;
    }
    if (!publicBookingWindow || !isPublicDateAllowed(selectedDate)) {
      toast({
        title: "Data ainda indisponível",
        description: publicBookingWindow
          ? `O próximo mês abre para marcações no dia ${publicBookingWindow.openDay}.`
          : "Não foi possível confirmar o período disponível. Tente novamente.",
        variant: "destructive",
      });
      return;
    }

    setCustomerTouched({ name: true, phone: true, email: true });
    if (customerFieldErrors.name || customerFieldErrors.phone || customerFieldErrors.email) {
      toast({
        title: "Corrija os dados",
        description: "Veja os campos assinalados antes de confirmar.",
        variant: "destructive",
      });
      return;
    }

    const customerName = customerDetails.name.trim();
    const normalizedPhone = toStoredPhone(customerDetails.phone, selectedPhoneCountry);

    const appointmentDate = calendarTimeInTimeZone(selectedDate, selectedTime, locationTimeZone);
    const customerEmail = customerDetails.email.trim();

    try {
      const result = await createAppointment.mutateAsync({
        barberId: selectedBarberId,
        serviceId: selectedServiceId,
        startTime: appointmentDate,
        customerName,
        customerEmail: customerEmail || undefined,
        customerPhone: normalizedPhone,
        whatsappOptIn: true,
      });
      saveLastBookingPreference({
        barberId: selectedBarberId,
        serviceId: selectedServiceId,
        customerName,
        customerEmail,
        customerPhone: normalizedPhone,
      });
      setCreatedAppointment(result);
      setStep(5);
    } catch (error: any) {
      toast({ 
        title: "Erro na marcação", 
        description: error.message || "Tente novamente mais tarde.", 
        variant: "destructive" 
      });
    }
  };


  if (loadingLocations || (locations.length === 1 && !activeLocation)) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (locationsError || locations.length === 0) {
    return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-white">
      <h1 className="text-2xl font-display">Marcações indisponíveis</h1>
      <p>{locationsError ? "Não foi possível carregar as lojas. Tente novamente dentro de instantes." : "Ainda não existem lojas disponíveis para marcação online."}</p>
      <Button variant="outline" onClick={() => navigate("/")}>Voltar ao início</Button>
    </div>;
  }

  if (hasMultipleLocations && !activeLocation) {
    return (
      <div data-testid="booking-location-choice" className="relative min-h-screen overflow-x-hidden bg-background text-white">
        <div className="absolute inset-x-0 top-0 z-10 mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8">
          <Button variant="ghost" onClick={() => navigate("/")}>
            <ChevronLeft className="mr-2 h-4 w-4" /> Voltar
          </Button>
        </div>
        <main className="flex min-h-screen items-center px-4 py-24 sm:px-6 sm:py-28 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">
            <div className="mx-auto mb-8 max-w-2xl text-center sm:mb-10">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Nova marcação</p>
              <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl lg:text-5xl">Onde quer marcar?</h1>
              <p className="mt-4 text-sm leading-relaxed text-gray-400 sm:text-base">
                Escolha a localização para consultar os barbeiros, serviços e horários dessa loja.
              </p>
            </div>
            <div
              data-testid="booking-location-grid"
              className={cn(
                "mx-auto grid w-full grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5",
                locations.length === 2 && "max-w-3xl",
                locations.length === 3 && "max-w-5xl lg:grid-cols-3",
                locations.length >= 4 && "max-w-6xl lg:grid-cols-4",
              )}
            >
              {locations.map((location) => (
                <button
                  key={location.id}
                  type="button"
                  className="group flex min-h-44 w-full flex-col rounded-2xl border border-white/10 bg-card p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-48 sm:p-6"
                  onClick={() => {
                    selectBookingLocation(location.id);
                  }}
                >
                  <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition group-hover:bg-primary/15">
                    <MapPin className="h-5 w-5" />
                  </span>
                  <span className="block text-lg font-bold leading-snug sm:text-xl">{location.name}</span>
                  <span className="mt-2 block text-sm leading-relaxed text-gray-400">{location.address}</span>
                </button>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (step === 5) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="brand-selection-glow w-24 h-24 bg-primary rounded-full flex items-center justify-center mx-auto mb-6"
          >
            <Check className="w-12 h-12 text-background" />
          </motion.div>
          <h2 className="text-3xl font-display font-bold mb-4 text-white">Marcação Confirmada!</h2>
          <p className="text-gray-400 mb-3">
            Obrigado, {customerDetails.name}. O seu horário está reservado para {format(selectedDate!, "dd 'de' MMMM", { locale: pt })} às {selectedTime}h.
          </p>
          {customerDetails.email.trim() ? (
            <>
              <p className="mb-3 text-sm text-gray-500">
                A confirmação e os detalhes da sua marcação serão enviados para o contacto indicado.
              </p>
              <p className="mb-8 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-gray-500">
                Se não receber a confirmação por WhatsApp nos próximos minutos, verifique o seu email. Se ainda assim não receber, contacte diretamente a barbearia.
              </p>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-gray-500">
                A confirmação e os detalhes da sua marcação serão enviados para o contacto indicado.
              </p>
              <p className="mb-8 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-gray-400">
                Se não receber a confirmação nos próximos minutos, contacte diretamente a barbearia.
              </p>
            </>
          )}
          
          <div className="space-y-4">
            <Link href="/">
              <Button variant="gold" className="w-full">Voltar ao Início</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background font-body text-foreground">
      <nav data-testid="public-booking-header" className="sticky top-0 z-50 border-b border-white/10 bg-background/95 py-3 backdrop-blur sm:py-4">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
          <Button 
            variant="ghost" 
            size="icon" 
            className="shrink-0 hover:bg-white/10"
            aria-label={step > 1 ? "Voltar ao passo anterior" : "Voltar ao início"}
            onClick={() => {
              if (step > 1) setStep(prev => prev - 1);
              else navigate("/");
            }}
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <img
            src={activeLocation?.logoUrl?.trim() || shopBranding.logoUrl}
            alt=""
            aria-hidden="true"
            className="h-8 w-8 shrink-0 rounded-full object-contain sm:h-9 sm:w-9"
            onError={(event) => {
              const image = event.currentTarget;
              if (!image.dataset.fallbackApplied) {
                image.dataset.fallbackApplied = "true";
                image.src = shopBranding.logoUrl;
              }
            }}
          />
          <div className="min-w-0 flex-1">
            <span className="block truncate font-display text-base font-bold sm:text-lg">Nova Marcação</span>
            {hasMultipleLocations && activeLocation && (
              <span className="block truncate text-xs text-gray-400" title={activeLocation.name}>
                {activeLocation.name}
              </span>
            )}
          </div>
          {hasMultipleLocations && (
            <Button className="h-9 shrink-0 px-2 text-xs sm:px-3 sm:text-sm" variant="ghost" size="sm" onClick={() => selectBookingLocation(null)}>
              Mudar loja
            </Button>
          )}
        </div>
      </nav>

      <main data-testid="booking-flow" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:px-6 sm:pt-7 md:pb-8 lg:px-8">
        <StepIndicator currentStep={step} />

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="w-full"
          >
            {/* STEP 1: SELECT BARBER */}
            {step === 1 && (
              <BookingStepContent className="space-y-7 sm:space-y-8">
                <BookingStepHeading title="Seleciona o barbeiro" description="Escolhe com quem queres marcar." />

                {loadingBarbers || fetchingBarbers ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
                    {Array.from({ length: 4 }, (_, i) => <BarberCardSkeleton key={i} />)}
                  </div>
                ) : barbersError ? (
                  <BookingEmptyState tone="error">
                    Não foi possível carregar os barbeiros desta localização. Tente novamente dentro de instantes.
                  </BookingEmptyState>
                ) : visibleBarbers.length === 0 ? (
                  <BookingEmptyState>
                    Esta localização ainda não tem barbeiros disponíveis para marcação online.
                  </BookingEmptyState>
                ) : (
                  <div className={cn(
                    "mx-auto grid w-full grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5",
                    visibleBarbers.length === 1 && "max-w-2xl",
                    visibleBarbers.length === 2 && "md:max-w-4xl md:grid-cols-3",
                    visibleBarbers.length >= 3 && "md:grid-cols-3 lg:grid-cols-4",
                  )}>
                    <motion.div 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedBarberId(0)}
                      className={cn(
                        "min-h-44 cursor-pointer group relative overflow-hidden rounded-xl bg-card border transition-all duration-300 flex flex-col justify-center items-center text-center p-4 md:min-h-0 md:p-6",
                        selectedBarberId === 0 
                          ? "brand-selection-glow border-primary bg-primary/5"
                          : "border-white/5 hover:border-primary/50"
                      )}
                    >
                      <div className={cn(
                        "w-12 h-12 md:w-16 md:h-16 rounded-full bg-white/5 flex items-center justify-center mb-2 md:mb-3 transition-all duration-300 group-hover:bg-primary/10",
                        selectedBarberId === 0 && "bg-primary/20 text-primary"
                      )}>
                        <User className={cn(
                          "w-6 h-6 md:w-8 md:h-8 transition-colors duration-300",
                          selectedBarberId === 0 ? "text-primary" : "text-gray-500 group-hover:text-primary"
                        )} />
                      </div>
                      <h3 className={cn(
                        "font-bold text-sm md:text-lg transition-colors duration-300 leading-tight",
                        selectedBarberId === 0 ? "text-primary" : "text-white group-hover:text-primary"
                      )}>Sem preferência</h3>
                      <p className="text-[10px] md:text-sm text-gray-500">Qualquer barbeiro livre</p>
                      {selectedBarberId === 0 && (
                        <motion.div 
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className="absolute top-3 right-3 bg-primary text-background rounded-full p-1.5 shadow-lg"
                        >
                          <Check className="w-4 h-4 font-bold" />
                        </motion.div>
                      )}
                    </motion.div>

                    {visibleBarbers.map((barber) => {
                      const avatarSrc = getBarberAvatar(
                        barber,
                        activeLocation?.logoUrl?.trim() || shopBranding.logoUrl,
                      );
                      const fallbackAvatarSrc = getBarberAvatarFallback(barber);
                      return (
                        <motion.div 
                          key={barber.id}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setSelectedBarberId(barber.id)}
                          className={cn(
                            "cursor-pointer group relative overflow-hidden rounded-xl bg-card border transition-all duration-300",
                            selectedBarberId === barber.id 
                              ? "brand-selection-glow border-primary"
                              : "border-white/5 hover:border-primary/50"
                          )}
                        >
                          <div className="aspect-[4/3] sm:aspect-[4/5] lg:aspect-[4/3] bg-muted relative overflow-hidden">
                             <img 
                               src={avatarSrc}
                               alt={barber.name} 
                               className={cn(
                                 "w-full h-full object-cover transition-all duration-700 ease-in-out",
                                 selectedBarberId === barber.id ? "scale-110 grayscale-0" : "grayscale group-hover:grayscale-0 group-hover:scale-105"
                               )}
                               onError={(e) => {
                                 const target = e.target as HTMLImageElement;
                                 if (target.dataset.fallbackApplied !== "true") {
                                   target.dataset.fallbackApplied = "true";
                                   target.src = fallbackAvatarSrc;
                                 }
                               }}
                             />
                           <div className={cn(
                             "absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 transition-opacity duration-300",
                             selectedBarberId === barber.id ? "opacity-90" : "group-hover:opacity-80"
                           )} />
                           {selectedBarberId === barber.id && (
                             <motion.div 
                               initial={{ scale: 0, opacity: 0 }}
                               animate={{ scale: 1, opacity: 1 }}
                               className="absolute top-3 right-3 bg-primary text-background rounded-full p-1.5 shadow-lg z-10"
                             >
                               <Check className="w-4 h-4 font-bold" />
                             </motion.div>
                           )}
                        </div>
                        <div className="p-3 md:p-4 relative bg-card">
                          <h3 className={cn(
                            "font-bold text-sm md:text-lg transition-colors duration-300 leading-tight",
                            selectedBarberId === barber.id ? "text-primary" : "text-white group-hover:text-primary"
                          )}>{barber.name}</h3>
                          <p className="text-[10px] md:text-sm text-gray-400">{barber.specialty}</p>
                        </div>
                      </motion.div>
                    )})}
                  </div>
                )}
              </BookingStepContent>
            )}

            {/* STEP 2: SELECT SERVICE */}
            {step === 2 && (
              <BookingStepContent className="space-y-7 sm:space-y-8">
                <BookingStepHeading title="Selecione o Serviço" description="O que vamos fazer hoje?" />

                {loadingServices || fetchingServices ? (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    {Array.from({ length: 3 }, (_, i) => <ServiceCardSkeleton key={i} />)}
                  </div>
                ) : servicesError ? (
                  <BookingEmptyState tone="error">
                    Não foi possível carregar os serviços desta localização. Tente novamente dentro de instantes.
                  </BookingEmptyState>
                ) : availableServices.length === 0 ? (
                  <BookingEmptyState>
                    {visibleServices.length === 0
                      ? "Esta localização ainda não tem serviços disponíveis para marcação online."
                      : "Este barbeiro não tem serviços disponíveis para marcação online."}
                  </BookingEmptyState>
                ) : (
                  <div className={hasVisibleServiceCategories
                    ? "space-y-7"
                    : "grid grid-cols-1 gap-4 lg:grid-cols-3"}
                  >
                    {hasVisibleServiceCategories
                      ? availableServiceGroups.map((group) => (
                          <section key={group.key}>
                            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-gray-300 md:text-sm">
                              {group.label}
                            </h3>
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                              {group.services.map(renderServiceCard)}
                            </div>
                          </section>
                        ))
                      : availableServices.map(renderServiceCard)}
                  </div>
                )}
              </BookingStepContent>
            )}

            {/* STEP 3: DATE & TIME */}
            {step === 3 && (
              <BookingStepContent className="grid grid-cols-1 gap-7 sm:gap-8 lg:grid-cols-[minmax(300px,380px)_1fr] lg:items-start">
                <div className="w-full">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <CalendarIcon className="w-5 h-5 text-primary" /> Selecione a Data
                  </h3>
                  <div className="bg-card border border-white/5 rounded-xl p-2 md:p-4 overflow-x-auto">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      month={visibleCalendarMonth}
                      onMonthChange={setVisibleCalendarMonth}
                      onSelect={(date) => {
                        setSelectedDate(date);
                        if (date) setVisibleCalendarMonth(date);
                        setSelectedTime(null);
                        setShowTimeError(false);
                      }}
                      toMonth={maxPublicBookingDate ?? startOfToday()}
                      disabled={(date) => !isPublicDateAllowed(date) || isShopClosedDate(date)}
                      initialFocus
                      className="w-full rounded-md px-1 py-2 md:px-3 md:py-3"
                      locale={pt}
                      modifiers={{
                        hasAvailability: (date) => availableDateKeys.has(format(date, "yyyy-MM-dd")),
                      }}
                      modifiersClassNames={{
                        hasAvailability: "booking-day-available",
                      }}
                      classNames={{
                        day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                        day_today: "bg-white/10 text-white",
                        months: "w-full",
                        month: "w-full space-y-4",
                        table: "w-full border-collapse",
                        head_row: "grid grid-cols-7",
                        row: "grid grid-cols-7 w-full mt-2",
                        head_cell: "text-muted-foreground rounded-md w-auto font-normal text-[0.8rem]",
                        cell: "h-11 w-full text-center text-sm p-0 relative",
                        day: cn(
                          "relative mx-auto h-10 w-10 p-0 pb-1 font-normal aria-selected:opacity-100 hover:bg-white/5 rounded-md transition-colors"
                        ),
                      }}
                    />
                    {(loadingPublicBookingWindow || bookingMonthOpeningNotice) && publicBookingWindow?.enabled !== false && (
                      <p className="mt-3 text-center text-xs leading-relaxed text-gray-400">
                        {loadingPublicBookingWindow
                          ? "A carregar o período disponível..."
                          : formatPublicBookingMonthOpeningNotice(bookingMonthOpeningNotice!)}
                      </p>
                    )}
                    <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-gray-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_0.45rem_hsl(var(--primary)/0.45)]" />
                      <span>Dias com horários disponíveis</span>
                    </div>
                  </div>
                </div>

                <div className="w-full">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-primary" /> Horários disponíveis
                  </h3>
                  <div className={cn(
                    "bg-card border rounded-xl p-4 md:p-6 min-h-[200px] transition-all duration-300",
                    showTimeError ? "border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]" : "border-white/5"
                  )}>
                    {loadingSelectedDateAvailability ? (
                      <div className="flex justify-center mt-10">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      </div>
                    ) : initialAvailabilityError ? (
                      <p className="text-red-400 text-center mt-10">
                        Não foi possível carregar os horários disponíveis. Tente novamente dentro de instantes.
                      </p>
                    ) : noAvailabilityInBookingWindow ? (
                      <p className="text-gray-500 text-center mt-10">
                        Não existem horários disponíveis dentro do período de marcações atual.
                      </p>
                    ) : !selectedDate ? (
                      <p className="text-gray-500 text-center mt-10">Selecione uma data primeiro.</p>
                    ) : loadingAppointments ? (
                      <div className="flex justify-center mt-10">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      </div>
                    ) : appointmentsError ? (
                      <p className="text-gray-500 text-center mt-10">
                        Não foi possível carregar os horários desta data. Atualize a página ou tente novamente.
                      </p>
                    ) : selectedDateIsShopClosed ? (
                      <p className="text-gray-500 text-center mt-10">
                        A barbearia está fechada neste dia. Escolha outro dia com horários disponíveis.
                      </p>
                    ) : timeSlots.length === 0 ? (
                      <p className="text-gray-500 text-center mt-10">
                        Não existem horários disponíveis para esta data. Escolha outro dia.
                      </p>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 md:gap-3">
                          {timeSlots.map(({ time, available }) => (
                            <button
                              key={time}
                              disabled={!available}
                              onClick={() => {
                                setSelectedTime(prev => prev === time ? null : time);
                                setShowTimeError(false);
                              }}
                              className={cn(
                                "py-3 md:py-2 px-1 rounded-lg text-sm font-medium transition-all duration-200 border",
                                !available 
                                  ? "bg-white/5 text-gray-600 border-transparent cursor-not-allowed" 
                                  : selectedTime === time 
                                    ? "bg-primary text-background border-primary shadow-lg scale-105" 
                                    : "bg-transparent text-gray-300 border-white/10 hover:border-primary/50 hover:bg-white/5"
                              )}
                            >
                              {time}h
                            </button>
                          ))}
                        </div>
                        {showTimeError && (
                          <motion.p 
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-red-500 text-xs mt-4 text-center font-medium"
                          >
                            É necessário selecionar uma hora para continuar.
                          </motion.p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </BookingStepContent>
            )}

            {/* STEP 4: CUSTOMER DETAILS */}
            {step === 4 && (
              <BookingStepContent className="space-y-7 lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-7 lg:space-y-0">
                <div className="bg-card border border-white/10 rounded-xl p-6 space-y-4">
                  <h3 className="font-bold text-lg mb-4 border-b border-white/10 pb-2">Resumo da Marcação</h3>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Profissional:</span>
                    <span className="font-medium">{selectedBarberLabel}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Serviço:</span>
                    <span className="font-medium">{selectedService?.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Data e hora:</span>
                    <span className="font-medium">
                      {selectedDate && format(selectedDate, "dd/MM/yyyy")} às {selectedTime}h
                    </span>
                  </div>
                  <div className="flex justify-between text-lg font-bold text-primary pt-2 border-t border-white/10">
                    <span>Total:</span>
                    <span>{selectedService && (selectedService.price / 100).toFixed(2)}€</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome Completo *</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 h-4 w-4 text-gray-500" />
                      <Input 
                        id="name" 
                        placeholder="O seu nome" 
                        className={cn(
                          "pl-10 bg-background focus:border-primary",
                          showCustomerError("name") ? "border-red-500 focus:border-red-500" : "border-white/10",
                        )}
                        maxLength={MAX_NAME_LENGTH}
                        autoComplete="name"
                        aria-invalid={showCustomerError("name")}
                        aria-describedby={showCustomerError("name") ? "name-error" : undefined}
                        value={customerDetails.name}
                        onChange={(e) => setCustomerDetails(prev => ({ ...prev, name: e.target.value }))}
                        onBlur={() => markCustomerTouched("name")}
                      />
                    </div>
                    {showCustomerError("name") && (
                      <p id="name-error" className="text-xs font-medium text-red-400">
                        {customerFieldErrors.name}
                      </p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telemóvel *</Label>
                    <div className={cn(
                      "flex rounded-md border bg-background focus-within:ring-1",
                      showCustomerError("phone")
                        ? "border-red-500 focus-within:border-red-500 focus-within:ring-red-500"
                        : "border-white/10 focus-within:border-primary focus-within:ring-primary",
                    )}>
                      <div className="relative shrink-0 border-r border-white/10">
                        <select
                          aria-label="País do telemóvel"
                          className="h-12 w-[116px] appearance-none rounded-l-md bg-transparent px-3 pr-6 text-sm font-medium text-white outline-none"
                          value={selectedPhoneCountry}
                          onChange={(e) => {
                            setSelectedPhoneCountry(e.target.value as PhoneCountryCode);
                            setCustomerDetails(prev => ({ ...prev, phone: "" }));
                            markCustomerTouched("phone");
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
                        id="phone" 
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        placeholder={selectedPhoneCountryData.placeholder}
                        className="h-12 flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                        aria-invalid={showCustomerError("phone")}
                        aria-describedby={`${showCustomerError("phone") ? "phone-error " : ""}phone-whatsapp-notice`}
                        value={customerDetails.phone}
                        onBeforeInput={handleCustomerPhoneBeforeInput}
                        onPaste={handleCustomerPhonePaste}
                        onChange={handleCustomerPhoneChange}
                        onBlur={() => markCustomerTouched("phone")}
                      />
                    </div>
                    <p id="phone-whatsapp-notice" className="text-xs leading-relaxed text-gray-400">
                      Este número será utilizado para enviar confirmações e atualizações da marcação via WhatsApp.
                    </p>
                    {showCustomerError("phone") && (
                      <p id="phone-error" className="text-xs font-medium text-red-400">
                        {customerFieldErrors.phone}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email (opcional)</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      autoComplete="email"
                      placeholder="exemplo@email.com" 
                      className={cn(
                        "bg-background focus:border-primary",
                        showCustomerError("email") ? "border-red-500 focus:border-red-500" : "border-white/10",
                      )}
                      maxLength={MAX_EMAIL_LENGTH}
                      aria-invalid={showCustomerError("email")}
                      aria-describedby={showCustomerError("email") ? "email-error" : "email-help"}
                      value={customerDetails.email}
                      onChange={(e) => setCustomerDetails(prev => ({ ...prev, email: e.target.value }))}
                      onBlur={() => markCustomerTouched("email")}
                    />
                    {showCustomerError("email") ? (
                      <p id="email-error" className="text-xs font-medium text-red-400">
                        {customerFieldErrors.email}
                      </p>
                    ) : (
                      <p id="email-help" className="text-xs leading-relaxed text-gray-400">
                        Este email será utilizado como alternativa para receber confirmações e atualizações da marcação caso o envio por WhatsApp não seja possível.
                      </p>
                    )}
                  </div>
                </div>
              </BookingStepContent>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Footer Actions */}
        <div data-testid="booking-actions" className="fixed bottom-0 left-0 z-40 w-full border-t border-white/10 bg-card/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_30px_rgba(0,0,0,0.18)] backdrop-blur sm:px-6 md:static md:mt-8 md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none">
          <div className="mx-auto flex w-full max-w-5xl justify-end">
            {step < 4 ? (
              <Button 
                variant="gold" 
                onClick={handleNext}
                className="w-full disabled:opacity-40 sm:w-auto sm:min-w-32"
                disabled={
                  (step === 1 && selectedBarberId === null) ||
                  (step === 2 && !selectedServiceId) ||
                  (step === 3 && (!selectedDate || !selectedTime || !isPublicDateAllowed(selectedDate)))
                }
              >
                Seguinte
              </Button>
            ) : (
              <Button 
                variant="gold" 
                onClick={handleSubmit}
                disabled={createAppointment.isPending}
                className="w-full disabled:opacity-40 sm:w-32"
              >
                {createAppointment.isPending ? "A marcar..." : "Confirmar"}
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
