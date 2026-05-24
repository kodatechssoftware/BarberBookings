import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useBarberAvailability, useBarbers, useShopAvailability } from "@/hooks/use-barbers";
import { useServices } from "@/hooks/use-services";
import { type AppointmentRecord, useCancelAppointment, useCreateAppointment, usePublicAppointments } from "@/hooks/use-appointments";
import { Button } from "@/components/ui/button-custom";
import { ChevronLeft, Check, Calendar as CalendarIcon, Clock, User, Scissors, XCircle, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format, addDays, startOfToday, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildGoogleCalendarUrl, buildIcsDataUri } from "@/lib/calendar";
import { type AvailabilityRow, type ShopAvailabilityRow, getAvailableTimeSlots } from "@/lib/availability";

import fabioAvatar from "@assets/fabio-baptista-avatar.jpg";
import brunoAvatar from "@assets/bruno-santos-avatar.jpg";

type BookingPreference = {
  step: number;
  barberId: number | null;
  serviceId: number | null;
  selectedDate: Date;
  selectedTime: string | null;
  customerDetails: {
    name: string;
    email: string;
    phone: string;
  };
};

const lastBookingStorageKey = "baptista:lastBooking";

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
    customerDetails: { name: "", email: "", phone: "" },
  };

  if (typeof window === "undefined") return emptyPreference;

  const params = new URLSearchParams(window.location.search);
  const lastBooking = params.get("repeat") === "last" ? readLastBookingPreference() : null;
  const barberId = parseNumericParam(params.get("barberId")) ?? lastBooking?.barberId ?? null;
  const serviceId = parseNumericParam(params.get("serviceId")) ?? lastBooking?.serviceId ?? null;
  const selectedDate = parseDateParam(params.get("date")) ?? startOfToday();
  const selectedTime = parseTimeParam(params.get("time"));

  return {
    step: barberId !== null && serviceId !== null && selectedTime ? 4 : barberId !== null && serviceId !== null ? 3 : barberId !== null ? 2 : 1,
    barberId,
    serviceId,
    selectedDate,
    selectedTime,
    customerDetails: {
      name: lastBooking?.customerName || "",
      email: lastBooking?.customerEmail || "",
      phone: lastBooking?.customerPhone || "",
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

// Step components
const StepIndicator = ({ currentStep }: { currentStep: number }) => {
  const steps = ["Barbeiro", "Serviço", "Data e hora", "Detalhes"];
  return (
    <div className="w-full py-4 md:py-6 mb-4 md:mb-8">
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
  const [selectedTime, setSelectedTime] = useState<string | null>(initialPreference.selectedTime);
  const [showTimeError, setShowTimeError] = useState(false);
  const [customerDetails, setCustomerDetails] = useState(initialPreference.customerDetails);
  const [createdAppointment, setCreatedAppointment] = useState<AppointmentRecord | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: barbers, isLoading: loadingBarbers } = useBarbers();
  const { data: services, isLoading: loadingServices } = useServices();
  const { data: availabilityRows } = useBarberAvailability();
  const { data: shopAvailabilityRows } = useShopAvailability();
  const createAppointment = useCreateAppointment();
  const cancelAppointment = useCancelAppointment();
  const visibleBarbers = useMemo(() => barbers?.filter((barber) => barber.isVisible) ?? [], [barbers]);
  const visibleServices = useMemo(() => services?.filter((service) => service.isVisible) ?? [], [services]);

  // Fetch appointments for selected date/barber to block slots
  const { data: existingAppointments, isLoading: loadingAppointments } = usePublicAppointments({
    barberId: selectedBarberId === 0 ? undefined : (selectedBarberId?.toString()), 
    date: selectedDate ? format(selectedDate, 'yyyy-MM-dd') : undefined,
  });

  const selectedBarber = visibleBarbers.find((barber) => barber.id === selectedBarberId);
  const selectedService = visibleServices.find((service) => service.id === selectedServiceId);
  const selectedBarberLabel = selectedBarberId === 0 ? "Sem preferência" : selectedBarber?.name;

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

  const handleNext = () => {
    if (step === 3 && !selectedTime) {
      setShowTimeError(true);
      toast({
        title: "Seleção necessária",
        description: "Por favor, escolha uma hora para a sua marcação.",
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
    if (selectedBarberId === null || !selectedServiceId || !selectedDate || !selectedTime || !customerDetails.name || !customerDetails.phone) {
      toast({ title: "Erro", description: "Por favor preencha todos os campos obrigatórios.", variant: "destructive" });
      return;
    }

    const [hours, minutes] = selectedTime.split(':').map(Number);
    const appointmentDate = new Date(selectedDate);
    appointmentDate.setHours(hours, minutes, 0, 0);

    try {
      const result = await createAppointment.mutateAsync({
        barberId: selectedBarberId,
        serviceId: selectedServiceId,
        startTime: appointmentDate,
        customerName: customerDetails.name,
        customerEmail: customerDetails.email || undefined,
        customerPhone: customerDetails.phone,
      });
      saveLastBookingPreference({
        barberId: selectedBarberId,
        serviceId: selectedServiceId,
        customerName: customerDetails.name,
        customerEmail: customerDetails.email,
        customerPhone: customerDetails.phone,
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

  const handleCancel = async () => {
    if (!createdAppointment) return;
    try {
      const result = await cancelAppointment.mutateAsync(createdAppointment.cancelToken);
      toast({ title: "Sucesso", description: result.message || "Marcação cancelada com sucesso." });
      setStep(6); // Cancelled success step
    } catch (error: any) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    }
  };

  if (step === 5) {
    const appointmentStart = createdAppointment?.startTime
      ? new Date(createdAppointment.startTime)
      : (() => {
          const fallback = new Date(selectedDate!);
          const [hours, minutes] = selectedTime!.split(":").map(Number);
          fallback.setHours(hours, minutes, 0, 0);
          return fallback;
        })();
    const calendarEvent = {
      title: `Baptista Barber Shop - ${selectedService?.name || "Marcação"}`,
      start: appointmentStart,
      durationMinutes: selectedService?.duration || 30,
      details: `${selectedService?.name || "Serviço"} com ${selectedBarberLabel || "barbeiro"}.`,
      location: "Rua Comandante Agatão Lança Nº28",
    };

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
          <p className="text-gray-400 mb-8">
            Obrigado, {customerDetails.name}. O seu horário está reservado para {format(selectedDate!, "dd 'de' MMMM", { locale: pt })} às {selectedTime}.
          </p>
          
          <div className="space-y-4">
            <a href={buildGoogleCalendarUrl(calendarEvent)} target="_blank" rel="noreferrer">
              <Button variant="outline" className="w-full">Adicionar ao Google Calendar</Button>
            </a>
            <a href={buildIcsDataUri(calendarEvent)} download="marcacao-baptista-barber-shop.ics">
              <Button variant="outline" className="w-full">Adicionar ao Apple Calendar</Button>
            </a>
            <Link href="/">
              <Button variant="gold" className="w-full">Voltar ao Início</Button>
            </Link>
            
            <Button 
              variant="outline" 
              className="w-full border-red-500/50 text-red-500 hover:bg-red-500/10"
              onClick={handleCancel}
              disabled={cancelAppointment.isPending}
            >
              {cancelAppointment.isPending ? "A cancelar..." : "Cancelar Marcação"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 6) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-24 h-24 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6"
          >
            <XCircle className="w-12 h-12 text-red-500" />
          </motion.div>
          <h2 className="text-3xl font-display font-bold mb-4 text-white">Marcação Cancelada</h2>
          <p className="text-gray-400 mb-8">
            A sua marcação foi cancelada. Se foi em cima da hora, pode ficar registada como cancelamento tardio.
          </p>
          <Link href="/">
            <Button variant="gold" className="w-full">Voltar ao Início</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground flex flex-col font-body">
      <nav className="border-b border-white/10 py-4 bg-background sticky top-0 z-50">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-4 px-4">
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

      <div className="mx-auto flex-1 w-full max-w-4xl px-4 pt-8 pb-28 md:py-8">
        <StepIndicator currentStep={step} />

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="min-h-[400px]"
          >
            {/* STEP 1: SELECT BARBER */}
            {step === 1 && (
              <div className="space-y-6">
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-display font-bold mb-2">Seleciona o barbeiro</h2>
                  <p className="text-gray-400">Escolhe com quem queres marcar.</p>
                </div>
                
                {loadingBarbers ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 animate-pulse">
                    {[1,2,3].map(i => <div key={i} className="h-64 bg-card rounded-xl"></div>)}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
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
                      const barberName = barber.name.toLowerCase();
                      const avatarSrc = barber.avatar ||
                                      (barberName.includes("baptista") ? fabioAvatar :
                                      barberName.includes("bruno") ? brunoAvatar :
                                      null);
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
                          <div className="aspect-[4/3] sm:aspect-[4/5] bg-muted relative overflow-hidden">
                             <img 
                               src={avatarSrc || `https://images.unsplash.com/photo-${barber.id % 2 === 0 ? '1582234057037-9755b3c4342a' : '1562947262-6718d0979e2c'}?w=500&h=600&fit=crop`} 
                               alt={barber.name} 
                               className={cn(
                                 "w-full h-full object-cover transition-all duration-700 ease-in-out",
                                 selectedBarberId === barber.id ? "scale-110 grayscale-0" : "grayscale group-hover:grayscale-0 group-hover:scale-105"
                               )}
                               onError={(e) => {
                                 const target = e.target as HTMLImageElement;
                                 if (!target.src.includes('unsplash')) {
                                   target.src = `https://images.unsplash.com/photo-${barber.id % 2 === 0 ? '1582234057037-9755b3c4342a' : '1562947262-6718d0979e2c'}?w=500&h=600&fit=crop`;
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
              <div className="space-y-6">
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-display font-bold mb-2">Selecione o Serviço</h2>
                  <p className="text-gray-400">O que vamos fazer hoje?</p>
                </div>

                {loadingServices ? (
                  <div className="space-y-4 animate-pulse">
                     {[1,2,3].map(i => <div key={i} className="h-20 bg-card rounded-xl"></div>)}
                  </div>
                ) : (
                  <div className="space-y-3 md:space-y-4 max-w-2xl mx-auto px-1">
                    {visibleServices.map((service) => (
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
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: DATE & TIME */}
            {step === 3 && (
              <div className="flex flex-col gap-8">
                <div className="w-full">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <CalendarIcon className="w-5 h-5 text-primary" /> Selecione a Data
                  </h3>
                  <div className="bg-card border border-white/5 rounded-xl p-2 md:p-4 overflow-x-auto">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => {
                        setSelectedDate(date);
                        setSelectedTime(null);
                        setShowTimeError(false);
                      }}
                      disabled={(date) => date < addDays(new Date(), -1)}
                      initialFocus
                      className="rounded-md mx-auto"
                      locale={pt}
                      classNames={{
                        day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                        day_today: "bg-white/10 text-white",
                        table: "w-full border-collapse space-y-1",
                        head_cell: "text-muted-foreground rounded-md w-8 md:w-9 font-normal text-[0.8rem]",
                        cell: "h-8 w-8 md:h-9 md:w-9 text-center text-sm p-0 relative",
                        day: cn(
                          "h-8 w-8 md:h-9 md:w-9 p-0 font-normal aria-selected:opacity-100 hover:bg-white/5 rounded-md transition-colors"
                        ),
                      }}
                    />
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
              <div className="max-w-md mx-auto space-y-8">
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
                        className="pl-10 bg-background border-white/10 focus:border-primary"
                        value={customerDetails.name}
                        onChange={(e) => setCustomerDetails(prev => ({ ...prev, name: e.target.value }))}
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telemóvel *</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-3 text-xs text-gray-500 font-bold">+351</span>
                      <Input 
                        id="phone" 
                        placeholder="912 345 678" 
                        className="pl-12 bg-background border-white/10 focus:border-primary"
                        value={customerDetails.phone}
                        onChange={(e) => setCustomerDetails(prev => ({ ...prev, phone: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email (opcional)</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      placeholder="exemplo@email.com" 
                      className="bg-background border-white/10 focus:border-primary"
                      value={customerDetails.email}
                      onChange={(e) => setCustomerDetails(prev => ({ ...prev, email: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Footer Actions */}
        <div className="fixed bottom-0 left-0 w-full bg-card border-t border-white/10 p-4 md:static md:bg-transparent md:border-0 md:mt-12">
          <div className="mx-auto flex w-full max-w-4xl justify-between">
            <Button 
              variant="outline" 
              onClick={() => {
                if (step > 1) setStep(prev => prev - 1);
                else navigate("/");
              }}
              className="border-white/10 hover:bg-white/5"
            >
              Voltar
            </Button>

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
                Próximo
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
