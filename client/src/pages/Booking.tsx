import { useEffect, useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useBarberAvailability, useBarbers, useShopAvailability } from "@/hooks/use-barbers";
import { useServices } from "@/hooks/use-services";
import { type AppointmentRecord, useCreateAppointment, usePublicAppointments } from "@/hooks/use-appointments";
import { Button } from "@/components/ui/button-custom";
import { ChevronLeft, Check, Calendar as CalendarIcon, Clock, User, Scissors, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { eachDayOfInterval, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfToday, startOfWeek } from "date-fns";
import { pt } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AvailabilityRow, type ShopAvailabilityRow, canBarberPerformService, getAvailableTimeSlots } from "@/lib/availability";
import fabioAvatar from "@assets/fabio-baptista-avatar.jpg";
import brunoAvatar from "@assets/bruno-santos-avatar.jpg";

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
const MAX_PHONE_LENGTH = 16;
const MAX_EMAIL_LENGTH = 120;
const PHONE_COUNTRIES = [
  { code: "PT", label: "Portugal", flag: "🇵🇹", dialCode: "+351", minDigits: 9, maxDigits: 9, placeholder: "912 345 678" },
  { code: "ES", label: "Espanha", flag: "🇪🇸", dialCode: "+34", minDigits: 9, maxDigits: 9, placeholder: "612 345 678" },
  { code: "DE", label: "Alemanha", flag: "🇩🇪", dialCode: "+49", minDigits: 7, maxDigits: 13, placeholder: "151 23456789" },
  { code: "FR", label: "Franca", flag: "🇫🇷", dialCode: "+33", minDigits: 9, maxDigits: 9, placeholder: "6 12 34 56 78" },
  { code: "GB", label: "Reino Unido", flag: "🇬🇧", dialCode: "+44", minDigits: 10, maxDigits: 10, placeholder: "7700 900123" },
  { code: "BR", label: "Brasil", flag: "🇧🇷", dialCode: "+55", minDigits: 10, maxDigits: 11, placeholder: "11 91234 5678" },
  { code: "AO", label: "Angola", flag: "🇦🇴", dialCode: "+244", minDigits: 9, maxDigits: 9, placeholder: "923 456 789" },
  { code: "NL", label: "Holanda", flag: "🇳🇱", dialCode: "+31", minDigits: 9, maxDigits: 9, placeholder: "6 12345678" },
  { code: "IT", label: "Italia", flag: "🇮🇹", dialCode: "+39", minDigits: 9, maxDigits: 11, placeholder: "312 345 6789" },
] as const;

type PhoneCountryCode = typeof PHONE_COUNTRIES[number]["code"];
type CustomerField = keyof BookingPreference["customerDetails"];

const DEFAULT_PHONE_COUNTRY = PHONE_COUNTRIES[0];

const formatPhoneInput = (value: string, maxLength = MAX_PHONE_LENGTH) => {
  return value.replace(/\D/g, "").slice(0, maxLength);
};

const getPhoneCountry = (countryCode: PhoneCountryCode) => (
  PHONE_COUNTRIES.find((country) => country.code === countryCode) ?? DEFAULT_PHONE_COUNTRY
);

const splitStoredPhone = (value: string) => {
  const trimmed = value.trim();
  const internationalValue = trimmed.startsWith("00")
    ? `+${trimmed.replace(/\D/g, "").slice(2)}`
    : trimmed.startsWith("+")
      ? `+${trimmed.replace(/\D/g, "")}`
      : trimmed;

  const matchedCountry = PHONE_COUNTRIES.find((country) => internationalValue.startsWith(country.dialCode));
  if (!matchedCountry) {
    return {
      countryCode: DEFAULT_PHONE_COUNTRY.code,
      localPhone: formatPhoneInput(trimmed, DEFAULT_PHONE_COUNTRY.maxDigits),
    };
  }

  return {
    countryCode: matchedCountry.code,
    localPhone: formatPhoneInput(internationalValue.slice(matchedCountry.dialCode.length), matchedCountry.maxDigits),
  };
};

const isValidBookingPhone = (value: string, countryCode: PhoneCountryCode) => {
  const country = getPhoneCountry(countryCode);
  const digits = value.replace(/\D/g, "");
  if (digits !== value.trim()) return false;
  if (countryCode === "PT") return /^9\d{8}$/.test(digits);
  return digits.length >= country.minDigits && digits.length <= country.maxDigits;
};

const toStoredPhone = (value: string, countryCode: PhoneCountryCode) => {
  const country = getPhoneCountry(countryCode);
  return `${country.dialCode}${value.replace(/\D/g, "")}`;
};

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
  return Number.isNaN(date.getTime()) ? null : date;
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
  const selectedDate = parseDateParam(params.get("date")) ?? startOfToday();
  const selectedTime = parseTimeParam(params.get("time"));
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

function getBarberAvatar(barber: { name: string; avatar?: string | null }) {
  const customAvatar = barber.avatar?.trim();
  if (customAvatar) return customAvatar;

  const name = barber.name.toLowerCase();
  if (name.includes("baptista")) return fabioAvatar;
  if (name.includes("bruno")) return brunoAvatar;
  return "/images/logo.jpg";
}

function getBarberAvatarFallback(barber: { name: string }) {
  const name = barber.name.toLowerCase();
  if (name.includes("baptista")) return fabioAvatar;
  if (name.includes("bruno")) return brunoAvatar;
  return "/images/logo.jpg";
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

// Step components
const StepIndicator = ({ currentStep }: { currentStep: number }) => {
  const steps = ["Barbeiro", "Serviço", "Data e hora", "Detalhes"];
  return (
    <div className="w-full py-4 md:py-6 mb-4 md:mb-8 lg:py-4 lg:mb-6">
      <div className="flex justify-between items-center relative z-10">
        {steps.map((step, i) => (
          <div key={i} className="flex flex-col items-center gap-1 md:gap-2 w-1/4">
            <div 
              className={cn(
                "w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center text-xs md:text-sm font-bold border-2 transition-colors duration-300 bg-background",
                currentStep > i + 1 ? "border-primary bg-primary text-background" : 
                currentStep === i + 1 ? "border-primary text-primary" : "border-white/20 text-gray-500"
              )}
            >
              {currentStep > i + 1 ? <Check className="w-3 h-3 md:w-4 md:h-4" /> : i + 1}
            </div>
            <span className={cn(
              "text-[10px] md:text-xs font-medium transition-colors duration-300 text-center px-1",
              currentStep >= i + 1 ? "text-white" : "text-gray-600"
            )}>
              {step}
            </span>
          </div>
        ))}
        {/* Progress bar background */}
        <div className="absolute top-3.5 md:top-4 left-0 w-full h-[2px] bg-white/10 -z-10" />
        {/* Progress bar active */}
        <div 
          className="absolute top-3.5 md:top-4 left-0 h-[2px] bg-primary transition-all duration-300 -z-10" 
          style={{ width: `${((currentStep - 1) / 3) * 100}%` }} 
        />
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

  const { data: barbers, isLoading: loadingBarbers } = useBarbers();
  const { data: services, isLoading: loadingServices } = useServices();
  const { data: availabilityRows } = useBarberAvailability();
  const { data: shopAvailabilityRows } = useShopAvailability();
  const createAppointment = useCreateAppointment();
  const visibleBarbers = useMemo(() => barbers?.filter((barber) => barber.isVisible) ?? [], [barbers]);
  const visibleServices = useMemo(() => services?.filter((service) => service.isVisible) ?? [], [services]);
  const selectedBarber = visibleBarbers.find((barber) => barber.id === selectedBarberId);
  const availableServices = useMemo(() => {
    if (selectedBarberId && selectedBarberId !== 0) {
      return visibleServices.filter((service) => canBarberPerformService(selectedBarber, service.id));
    }

    return visibleServices.filter((service) =>
      visibleBarbers.some((barber) => canBarberPerformService(barber, service.id)),
    );
  }, [selectedBarber, selectedBarberId, visibleBarbers, visibleServices]);

  // Fetch appointments for selected date/barber to block slots
  const { data: existingAppointments, isLoading: loadingAppointments } = usePublicAppointments({
    barberId: selectedBarberId === 0 ? undefined : (selectedBarberId?.toString()), 
    date: selectedDate ? format(selectedDate, 'yyyy-MM-dd') : undefined,
  });

  const { data: calendarAppointments } = usePublicAppointments({
    barberId: selectedBarberId === 0 ? undefined : (selectedBarberId?.toString()),
    enabled: step === 3 && selectedBarberId !== null && Boolean(selectedServiceId),
  });

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
        : isValidBookingPhone(customerDetails.phone, selectedPhoneCountry)
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
    return getAvailableTimeSlots({
      selectedService,
      selectedDate,
      selectedBarberId,
      visibleBarbers,
      availabilityRows: (availabilityRows as AvailabilityRow[] | undefined) ?? [],
      shopAvailabilityRows: (shopAvailabilityRows as ShopAvailabilityRow[] | undefined) ?? [],
      existingAppointments,
    });
  }, [availabilityRows, existingAppointments, selectedBarberId, selectedDate, selectedService, shopAvailabilityRows, visibleBarbers]);

  const availableDateKeys = useMemo(() => {
    if (!selectedService || selectedBarberId === null) return new Set<string>();

    const today = startOfToday();
    const monthStart = startOfMonth(visibleCalendarMonth);
    const monthEnd = endOfMonth(visibleCalendarMonth);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const appointments = calendarAppointments ?? [];
    const availability = (availabilityRows as AvailabilityRow[] | undefined) ?? [];
    const shopAvailability = (shopAvailabilityRows as ShopAvailabilityRow[] | undefined) ?? [];
    const availableKeys = new Set<string>();

    eachDayOfInterval({ start: calendarStart, end: calendarEnd }).forEach((date) => {
      if (date < today) return;

      const slots = getAvailableTimeSlots({
        selectedService,
        selectedDate: date,
        selectedBarberId,
        visibleBarbers,
        availabilityRows: availability,
        shopAvailabilityRows: shopAvailability,
        existingAppointments: appointments,
      });

      if (slots.some((slot) => slot.available)) {
        availableKeys.add(format(date, "yyyy-MM-dd"));
      }
    });

    return availableKeys;
  }, [
    availabilityRows,
    calendarAppointments,
    selectedBarberId,
    selectedService,
    shopAvailabilityRows,
    visibleBarbers,
    visibleCalendarMonth,
  ]);

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
    if (selectedBarberId === null || !selectedServiceId || !selectedDate || !selectedTime) {
      toast({ title: "Erro", description: "Confirme barbeiro, serviço, data e hora.", variant: "destructive" });
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

    const [hours, minutes] = selectedTime.split(':').map(Number);
    const appointmentDate = new Date(selectedDate);
    appointmentDate.setHours(hours, minutes, 0, 0);
    const customerEmail = customerDetails.email.trim();

    try {
      const result = await createAppointment.mutateAsync({
        barberId: selectedBarberId,
        serviceId: selectedServiceId,
        startTime: appointmentDate,
        customerName,
        customerEmail: customerEmail || undefined,
        customerPhone: normalizedPhone,
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


  if (step === 5) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-24 h-24 bg-primary rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(212,175,55,0.4)]"
          >
            <Check className="w-12 h-12 text-background" />
          </motion.div>
          <h2 className="text-3xl font-display font-bold mb-4 text-white">Marcação Confirmada!</h2>
          <p className="text-gray-400 mb-3">
            Obrigado, {customerDetails.name}. O seu horário está reservado para {format(selectedDate!, "dd 'de' MMMM", { locale: pt })} às {selectedTime}.
          </p>
          <p className="mb-8 text-sm text-gray-500">
            Vai receber a confirmação por WhatsApp com os detalhes da marcação e o link de cancelamento.
          </p>
          <p className="mb-8 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-gray-500">
            Se não receber a mensagem em poucos minutos, contacte diretamente a barbearia para alterar ou cancelar a marcação.
          </p>
          
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
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground flex flex-col font-body">
      <nav className="border-b border-white/10 py-4 bg-background sticky top-0 z-50">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-4 px-4 lg:max-w-[calc(100vw-4rem)] xl:max-w-7xl">
          <Button 
            variant="ghost" 
            size="icon" 
            className="hover:bg-white/10"
            onClick={() => {
              if (step > 1) setStep(prev => prev - 1);
              else navigate("/");
            }}
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="font-display font-bold text-lg">Nova Marcação</span>
        </div>
      </nav>

      <div className="mx-auto flex-1 w-full max-w-4xl px-4 pt-8 pb-28 md:pt-8 md:pb-0 lg:max-w-[calc(100vw-4rem)] xl:max-w-7xl">
        <StepIndicator currentStep={step} />

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="min-h-[400px] lg:min-h-0"
          >
            {/* STEP 1: SELECT BARBER */}
            {step === 1 && (
              <div className="space-y-6 lg:space-y-4">
                <div className="text-center mb-8 lg:mb-6">
                  <h2 className="text-2xl font-display font-bold mb-2">Seleciona o barbeiro</h2>
                  <p className="text-gray-400">Escolhe com quem queres marcar.</p>
                </div>
                
                {loadingBarbers ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
                    {Array.from({ length: 4 }, (_, i) => <BarberCardSkeleton key={i} />)}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6">
                    <motion.div 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedBarberId(0)}
                      className={cn(
                        "min-h-44 cursor-pointer group relative overflow-hidden rounded-xl bg-card border transition-all duration-300 flex flex-col justify-center items-center text-center p-4 md:min-h-0 md:p-6",
                        selectedBarberId === 0 
                          ? "border-primary shadow-[0_0_20px_rgba(212,175,55,0.3)] bg-primary/5" 
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
                      const avatarSrc = getBarberAvatar(barber);
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
                              ? "border-primary shadow-[0_0_20px_rgba(212,175,55,0.3)]" 
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
              </div>
            )}

            {/* STEP 2: SELECT SERVICE */}
            {step === 2 && (
              <div className="space-y-6 lg:space-y-4">
                <div className="text-center mb-8 lg:mb-6">
                  <h2 className="text-2xl font-display font-bold mb-2">Selecione o Serviço</h2>
                  <p className="text-gray-400">O que vamos fazer hoje?</p>
                </div>

                {loadingServices ? (
                  <div className="mx-auto max-w-2xl space-y-3 px-1 md:space-y-4 lg:grid lg:max-w-6xl lg:grid-cols-3 lg:gap-4 lg:space-y-0">
                    {Array.from({ length: 3 }, (_, i) => <ServiceCardSkeleton key={i} />)}
                  </div>
                ) : (
                  <div className="mx-auto max-w-2xl space-y-3 px-1 md:space-y-4 lg:grid lg:max-w-6xl lg:grid-cols-3 lg:gap-4 lg:space-y-0">
                    {availableServices.map((service) => (
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
                    ))}
                    {availableServices.length === 0 && (
                      <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-gray-500">
                        Este barbeiro não tem serviços disponíveis para marcação online.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: DATE & TIME */}
            {step === 3 && (
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(300px,380px)_1fr] lg:items-start">
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
                      disabled={(date) => date < startOfToday()}
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
                    {!selectedDate ? (
                      <p className="text-gray-500 text-center mt-10">Selecione uma data primeiro.</p>
                    ) : loadingAppointments ? (
                      <div className="flex justify-center mt-10">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      </div>
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
                              {time}
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
              </div>
            )}

            {/* STEP 4: CUSTOMER DETAILS */}
            {step === 4 && (
              <div className="mx-auto max-w-md space-y-8 lg:grid lg:max-w-4xl lg:grid-cols-2 lg:gap-6 lg:space-y-0">
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
                      {selectedDate && format(selectedDate, "dd/MM/yyyy")} às {selectedTime}
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
                          aria-label="Pais do telemovel"
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
                        maxLength={MAX_PHONE_LENGTH}
                        aria-invalid={showCustomerError("phone")}
                        aria-describedby={showCustomerError("phone") ? "phone-error" : "phone-help"}
                        value={customerDetails.phone}
                        onChange={(e) => setCustomerDetails(prev => ({ ...prev, phone: formatPhoneInput(e.target.value, selectedPhoneCountryData.maxDigits) }))}
                        onBlur={() => markCustomerTouched("phone")}
                      />
                    </div>
                    {showCustomerError("phone") ? (
                      <p id="phone-error" className="text-xs font-medium text-red-400">
                        {customerFieldErrors.phone}
                      </p>
                    ) : (
                      <p id="phone-help" className="text-[11px] text-gray-500">
                        Escolha o país e escreva apenas o número. O indicativo é adicionado automaticamente.
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
                      aria-describedby={showCustomerError("email") ? "email-error" : undefined}
                      value={customerDetails.email}
                      onChange={(e) => setCustomerDetails(prev => ({ ...prev, email: e.target.value }))}
                      onBlur={() => markCustomerTouched("email")}
                    />
                    {showCustomerError("email") && (
                      <p id="email-error" className="text-xs font-medium text-red-400">
                        {customerFieldErrors.email}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Footer Actions */}
        <div className="fixed bottom-0 left-0 w-full bg-card border-t border-white/10 p-4 md:static md:bg-transparent md:border-0 md:mt-12 lg:mt-6">
          <div className="mx-auto flex w-full max-w-4xl justify-end lg:max-w-[calc(100vw-4rem)] xl:max-w-7xl">
            {step < 4 ? (
              <Button 
                variant="gold" 
                onClick={handleNext}
                disabled={
                  (step === 1 && selectedBarberId === null) ||
                  (step === 2 && !selectedServiceId) ||
                  (step === 3 && (!selectedDate || !selectedTime))
                }
              >
                Seguinte
              </Button>
            ) : (
              <Button 
                variant="gold" 
                onClick={handleSubmit}
                disabled={createAppointment.isPending}
                className="w-32"
              >
                {createAppointment.isPending ? "A marcar..." : "Confirmar"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
