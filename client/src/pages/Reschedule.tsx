import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { addDays, format, parseISO, startOfToday } from "date-fns";
import { pt } from "date-fns/locale";
import { Calendar as CalendarIcon, Check, Clock, Loader2, XCircle } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button-custom";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { preloadCancellationPage } from "@/lib/page-preloads";
import { useToast } from "@/hooks/use-toast";
import { useAppointmentByToken, usePublicAppointments, useRescheduleAppointment } from "@/hooks/use-appointments";
import { useBarberAvailability, useShopAvailability } from "@/hooks/use-barbers";
import { type AvailabilityRow, type ShopAvailabilityRow, getAvailableTimeSlots } from "@/lib/availability";

export default function Reschedule() {
  const [, params] = useRoute("/reschedule/:token");
  const token = params?.token;
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(startOfToday());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [rescheduledStart, setRescheduledStart] = useState<Date | null>(null);

  const { data: appointment, isLoading: loadingAppointment } = useAppointmentByToken(token);
  const { data: availabilityRows } = useBarberAvailability();
  const { data: shopAvailabilityRows } = useShopAvailability();
  const rescheduleAppointment = useRescheduleAppointment();

  useEffect(() => {
    if (appointment?.startTime) {
      setSelectedDate(parseISO(appointment.startTime));
    }
  }, [appointment?.startTime]);

  useEffect(() => {
    if (appointment?.status === "booked") {
      void preloadCancellationPage();
    }
  }, [appointment?.status]);

  const { data: existingAppointments, isLoading: loadingAppointments } = usePublicAppointments({
    barberId: appointment?.barberId ? String(appointment.barberId) : undefined,
    date: selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined,
    enabled: Boolean(appointment?.barberId && selectedDate),
  });

  const timeSlots = useMemo(() => {
    if (!appointment || !existingAppointments || !selectedDate) return [];

    const duration = appointment.duration || 30;
    return getAvailableTimeSlots({
      selectedService: { duration },
      selectedDate,
      selectedBarberId: appointment.barberId,
      visibleBarbers: [{ id: appointment.barberId }],
      availabilityRows: (availabilityRows as AvailabilityRow[] | undefined) ?? [],
      shopAvailabilityRows: (shopAvailabilityRows as ShopAvailabilityRow[] | undefined) ?? [],
      existingAppointments: existingAppointments.filter((existing) => existing.id !== appointment.id),
    });
  }, [appointment, availabilityRows, existingAppointments, selectedDate, shopAvailabilityRows]);

  const handleSubmit = async () => {
    if (!token || !selectedDate || !selectedTime) return;

    const [hours, minutes] = selectedTime.split(":").map(Number);
    const startTime = new Date(selectedDate);
    startTime.setHours(hours, minutes, 0, 0);

    try {
      await rescheduleAppointment.mutateAsync({ token, startTime });
      setRescheduledStart(startTime);
      setSuccess(true);
    } catch (error: any) {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível reagendar a marcação.",
        variant: "destructive",
      });
    }
  };

  if (loadingAppointment) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!appointment) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 text-center">
        <div className="max-w-md">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-3xl font-display mb-4">Marcação não encontrada</h1>
          <p className="text-gray-400 mb-6">O link pode estar incorreto ou a marcação já não existir.</p>
          <Link href="/"><Button variant="gold">Voltar ao início</Button></Link>
        </div>
      </div>
    );
  }

  if (appointment.status !== "booked" || success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 text-center">
        <div className="max-w-md">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-20 h-20 bg-primary rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-10 h-10 text-background" />
          </motion.div>
          <h1 className="text-3xl font-display mb-4">{success ? "Marcação reagendada" : "Marcação já não pode ser reagendada"}</h1>
          <p className="text-gray-400 mb-6">
            {success ? "A nova data ficou guardada com sucesso." : "Esta marcação já foi cancelada, concluída ou alterada."}
          </p>
          {success && rescheduledStart && (
            <p className="mb-6 rounded-xl border border-white/10 bg-card px-4 py-3 text-sm text-gray-300">
              {format(rescheduledStart, "dd 'de' MMMM", { locale: pt })} às {format(rescheduledStart, "HH:mm")}
            </p>
          )}
          <Link href="/"><Button variant="gold">Voltar ao início</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-body">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl md:text-5xl font-display mb-3">Reagendar marcação</h1>
          <p className="text-gray-400">
            {appointment.serviceName} com {appointment.barberName}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Atual: {format(parseISO(appointment.startTime), "dd/MM/yyyy 'às' HH:mm")}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card border border-white/10 rounded-xl p-4">
            <h2 className="font-bold mb-4 flex items-center gap-2"><CalendarIcon className="w-5 h-5 text-primary" /> Nova data</h2>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                setSelectedDate(date);
                setSelectedTime(null);
              }}
              disabled={(date) => date < addDays(new Date(), -1)}
              locale={pt}
              className="rounded-md mx-auto"
            />
          </div>

          <div className="bg-card border border-white/10 rounded-xl p-4">
            <h2 className="font-bold mb-4 flex items-center gap-2"><Clock className="w-5 h-5 text-primary" /> Nova hora</h2>
            {loadingAppointments ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : timeSlots.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-10">Não existem horários disponíveis para esta data.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {timeSlots.map(({ time, available }) => (
                  <button
                    key={time}
                    disabled={!available}
                    onClick={() => setSelectedTime(time)}
                    className={cn(
                      "py-3 rounded-lg text-sm border transition-colors",
                      !available ? "bg-white/5 text-gray-600 border-transparent cursor-not-allowed" :
                        selectedTime === time ? "bg-primary text-background border-primary" :
                          "border-white/10 text-gray-300 hover:border-primary/50",
                    )}
                  >
                    {time}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Button variant="gold" disabled={!selectedTime || rescheduleAppointment.isPending} onClick={handleSubmit}>
            {rescheduleAppointment.isPending ? "A reagendar..." : "Confirmar nova data"}
          </Button>
          <Link
            href={`/cancel/${token}`}
            onFocus={() => void preloadCancellationPage()}
            onMouseEnter={() => void preloadCancellationPage()}
            onTouchStart={() => void preloadCancellationPage()}
          >
            <Button variant="outline" className="border-white/10">Cancelar marcação</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
