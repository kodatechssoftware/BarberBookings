import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useBarbers } from "@/hooks/use-barbers";
import { useServices } from "@/hooks/use-services";
import { useAppointments, useCreateAppointment, useCancelAppointment } from "@/hooks/use-appointments";
import { Button } from "@/components/ui/button-custom";
import { ChevronLeft, Check, Calendar as CalendarIcon, Clock, User, Scissors, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format, addDays, startOfToday, isSameDay, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type Appointment } from "@shared/schema";

import fabioAvatar from "@assets/image_1768576079386.png";
import brunoAvatar from "@assets/image_1768576179876.png";

// Step components
const StepIndicator = ({ currentStep }: { currentStep: number }) => {
  const steps = ["Profissional", "Serviço", "Data & Hora", "Detalhes"];
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
  const [step, setStep] = useState(1);
  const [selectedBarberId, setSelectedBarberId] = useState<number | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(startOfToday());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [showTimeError, setShowTimeError] = useState(false);
  const [customerDetails, setCustomerDetails] = useState({ name: "", email: "", phone: "" });
  const [createdAppointment, setCreatedAppointment] = useState<Appointment | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: barbers, isLoading: loadingBarbers } = useBarbers();
  const { data: services, isLoading: loadingServices } = useServices();
  const createAppointment = useCreateAppointment();
  const cancelAppointment = useCancelAppointment();

  // Fetch appointments for selected date/barber to block slots
  const { data: existingAppointments } = useAppointments({ 
    barberId: selectedBarberId === 0 ? undefined : (selectedBarberId?.toString()), 
    date: selectedDate ? format(selectedDate, 'yyyy-MM-dd') : undefined,
    public: true
  } as any);

  const selectedBarber = barbers?.find(b => b.id === selectedBarberId);
  const selectedService = services?.find(s => s.id === selectedServiceId);

  // Generate Time Slots
  const timeSlots = useMemo(() => {
    if (!selectedService || !existingAppointments || !selectedDate) return [];
    
    const slots: { time: string; available: boolean }[] = [];
    const dayOfWeek = selectedDate.getDay();

    let schedule: {start: number, end: number}[] = [];
    if (dayOfWeek === 1) { // Monday
      schedule = [{ start: 14, end: 20 }];
    } else if (dayOfWeek >= 2 && dayOfWeek <= 5) { // Tue-Fri
      schedule = [{ start: 9, end: 13 }, { start: 14, end: 20 }];
    } else if (dayOfWeek === 6) { // Saturday
      schedule = [{ start: 9, end: 13 }, { start: 14, end: 19 }];
    }

    const interval = 30; // 30 mins

    schedule.forEach(period => {
      for (let h = period.start; h < period.end; h++) {
        for (let m = 0; m < 60; m += interval) {
          const timeString = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
          
          // Check if slot is in the past (only for today)
          const now = new Date();
          const isPast = isSameDay(selectedDate, now) && (h < now.getHours() || (h === now.getHours() && m < now.getMinutes()));

          // Check if service fits before closing (or break in schedule)
          const slotDateTime = new Date(selectedDate);
          slotDateTime.setHours(h, m, 0, 0);
          const endDateTime = new Date(slotDateTime.getTime() + selectedService.duration * 60000);
          
          const fitsInSchedule = schedule.some(p => {
            const periodEnd = new Date(selectedDate);
            periodEnd.setHours(p.end, 0, 0, 0);
            return slotDateTime.getHours() >= p.start && endDateTime <= periodEnd;
          });

          const isTaken = existingAppointments.filter((app: any) => app.status !== 'cancelled').some((app: any) => {
            const appTime = new Date(app.startTime);
            const isSameTime = appTime.getHours() === h && appTime.getMinutes() === m;
            
            // Check if service duration overlaps with this appointment
            const appService = services?.find(s => s.id === app.serviceId);
            const appDuration = appService?.duration || 30;
            const appEndTime = new Date(appTime.getTime() + appDuration * 60000);
            
            const overlaps = slotDateTime < appEndTime && endDateTime > appTime;

            if (selectedBarberId === 0) {
              const busyBarbersCount = existingAppointments
                .filter((a: any) => {
                  if (a.status === 'cancelled') return false;
                  const aTime = new Date(a.startTime);
                  const aService = services?.find(s => s.id === a.serviceId);
                  const aDuration = aService?.duration || 30;
                  const aEndTime = new Date(aTime.getTime() + aDuration * 60000);
                  return slotDateTime < aEndTime && endDateTime > aTime;
                })
                .map((a: any) => a.barberId);
              
              const totalBarbersCount = barbers?.length || 0;
              const uniqueBusyBarbers = new Set(busyBarbersCount).size;
              
              return uniqueBusyBarbers >= totalBarbersCount;
            }
            
            return overlaps;
          });

          slots.push({ time: timeString, available: !isTaken && !isPast && fitsInSchedule });
        }
      }
    });

    return slots;
  }, [selectedService, existingAppointments, selectedDate]);

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
    if (!selectedBarberId || !selectedServiceId || !selectedDate || !selectedTime || !customerDetails.name || !customerDetails.phone) {
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
      await cancelAppointment.mutateAsync(createdAppointment.cancelToken);
      toast({ title: "Sucesso", description: "Marcação cancelada com sucesso." });
      setStep(6); // Cancelled success step
    } catch (error: any) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
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
          <p className="text-gray-400 mb-8">
            Obrigado, {customerDetails.name}. O seu horário está reservado para {format(selectedDate!, "dd 'de' MMMM", { locale: pt })} às {selectedTime}.
          </p>
          
          <div className="space-y-4">
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
            A sua marcação foi cancelada com sucesso. O horário está agora disponível para outros clientes.
          </p>
          <Link href="/">
            <Button variant="gold" className="w-full">Voltar ao Início</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-body">
      <nav className="border-b border-white/10 py-4 bg-background sticky top-0 z-50">
        <div className="container mx-auto px-4 flex items-center gap-4">
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

      <div className="flex-1 container mx-auto px-4 py-8 max-w-4xl">
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
                  <h2 className="text-2xl font-display font-bold mb-2">Escolha o Profissional</h2>
                  <p className="text-gray-400">Selecione quem irá cuidar do seu visual hoje.</p>
                </div>
                
                {loadingBarbers ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-pulse">
                    {[1,2,3].map(i => <div key={i} className="h-64 bg-card rounded-xl"></div>)}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
                    <motion.div 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedBarberId(0)}
                      className={cn(
                        "cursor-pointer group relative overflow-hidden rounded-xl bg-card border transition-all duration-300 flex flex-col justify-center items-center text-center p-4 md:p-6",
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

                    {barbers?.map((barber) => {
                      const avatarSrc = barber.name === "Fábio Baptista" ? fabioAvatar : 
                                      barber.name === "Bruno Santos" ? brunoAvatar : 
                                      barber.avatar;
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
                          <div className="aspect-[4/5] bg-muted relative overflow-hidden">
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
                    {services?.map((service) => (
                      <div
                        key={service.id}
                        onClick={() => setSelectedServiceId(service.id)}
                        className={cn(
                          "flex items-center justify-between p-4 md:p-6 rounded-xl border bg-card cursor-pointer transition-all duration-200",
                          selectedServiceId === service.id
                            ? "border-primary bg-primary/5"
                            : "border-white/5 hover:border-white/20 hover:bg-white/5"
                        )}
                      >
                        <div className="flex items-start gap-3 md:gap-4">
                          <div className={cn(
                            "w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center border shrink-0",
                            selectedServiceId === service.id ? "border-primary text-primary" : "border-white/20 text-gray-400"
                          )}>
                            <Scissors className="w-4 h-4 md:w-5 md:h-5" />
                          </div>
                          <div>
                            <h3 className="font-bold text-sm md:text-lg text-white leading-tight">{service.name}</h3>
                            <p className="text-xs md:text-sm text-gray-400 line-clamp-2">{service.description}</p>
                            <p className="text-[10px] md:text-xs text-gray-500 mt-1">{service.duration} min</p>
                          </div>
                        </div>
                        <div className="text-right pl-2">
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
                    <Clock className="w-5 h-5 text-primary" /> Horários Disponíveis
                  </h3>
                  <div className={cn(
                    "bg-card border rounded-xl p-4 md:p-6 min-h-[200px] transition-all duration-300",
                    showTimeError ? "border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]" : "border-white/5"
                  )}>
                    {!selectedDate ? (
                      <p className="text-gray-500 text-center mt-10">Selecione uma data primeiro.</p>
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
                    <span className="font-medium">{selectedBarber?.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Serviço:</span>
                    <span className="font-medium">{selectedService?.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Data & Hora:</span>
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
                    <Label htmlFor="email">Email (Opcional)</Label>
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
          <div className="container mx-auto flex justify-between max-w-4xl">
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
