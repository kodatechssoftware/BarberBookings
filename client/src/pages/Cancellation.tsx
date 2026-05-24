import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useAppointmentByToken, useCancelAppointment } from "@/hooks/use-appointments";
import { Button } from "@/components/ui/button-custom";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Home,
  Loader2,
  RotateCcw,
  Scissors,
  UserRound,
  XCircle,
} from "lucide-react";
import { motion } from "framer-motion";

function formatAppointmentDate(value?: string) {
  if (!value) return "";

  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function StatusScreen({
  tone,
  title,
  description,
}: {
  tone: "success" | "danger" | "neutral";
  title: string;
  description: string;
}) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "danger" ? XCircle : AlertTriangle;
  const iconClass = tone === "success" ? "text-emerald-400" : tone === "danger" ? "text-red-400" : "text-primary";
  const bgClass = tone === "success" ? "bg-emerald-500/10" : tone === "danger" ? "bg-red-500/10" : "bg-primary/10";

  return (
    <div className="min-h-[100svh] bg-background text-white flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-card/80 p-6 text-center shadow-2xl shadow-black/30">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full ${bgClass}`}
        >
          <Icon className={`h-8 w-8 ${iconClass}`} />
        </motion.div>
        <h2 className="mb-3 font-display text-2xl font-bold leading-tight text-white">{title}</h2>
        <p className="mb-6 text-sm leading-6 text-gray-300">{description}</p>
        <Link href="/">
          <Button variant="gold" className="flex h-11 w-full items-center justify-center gap-2">
            <Home className="h-4 w-4" /> Voltar ao Início
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function Cancellation() {
  const [, params] = useRoute("/cancel/:token");
  const token = params?.token;
  const cancelAppointment = useCancelAppointment();
  const { data: appointment, isLoading } = useAppointmentByToken(token);
  const [success, setSuccess] = useState(false);
  const [cancelMessage, setCancelMessage] = useState("");

  const appointmentDate = useMemo(
    () => formatAppointmentDate(appointment?.startTime),
    [appointment?.startTime],
  );
  const isCancelled = appointment?.status === "cancelled" || appointment?.status === "late_cancelled";
  const isUnavailable = appointment && appointment.status !== "booked" && !isCancelled;

  const handleCancel = async () => {
    if (!token) return;
    try {
      const result = await cancelAppointment.mutateAsync(token);
      setCancelMessage(result.message || "Marcação cancelada com sucesso.");
      setSuccess(true);
    } catch {
      // Error handled by mutation
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[100svh] bg-background flex items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (appointment === null) {
    return (
      <StatusScreen
        tone="neutral"
        title="Marcação não encontrada"
        description="Este link não corresponde a nenhuma marcação ativa."
      />
    );
  }

  if (success || isCancelled) {
    return (
      <StatusScreen
        tone="danger"
        title="Marcação Cancelada"
        description={cancelMessage || "Esta marcação já se encontra cancelada. Não é necessária nova ação."}
      />
    );
  }

  if (isUnavailable) {
    return (
      <StatusScreen
        tone="neutral"
        title="Marcação indisponível"
        description="Esta marcação já não pode ser cancelada por este link."
      />
    );
  }

  return (
    <div className="min-h-[100svh] bg-background text-white flex items-center justify-center px-4 py-6">
      <main className="w-full max-w-md">
        <div className="mb-5 text-center">
          <p className="text-xs font-semibold uppercase text-primary">Baptista Barber Shop</p>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight">Cancelar marcação</h1>
          <p className="mt-3 text-sm leading-6 text-gray-300">
            Confirme os dados antes de libertar este horário.
          </p>
        </div>

        <section className="rounded-lg border border-white/10 bg-card/80 p-5 shadow-2xl shadow-black/30">
          <div className="text-left">
            <div className="flex items-start gap-3 border-b border-white/10 pb-4">
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-xs uppercase text-gray-500">Data e hora</p>
                <p className="text-sm font-semibold capitalize text-white">{appointmentDate}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2">
              <div className="flex items-start gap-3 border-b border-white/10 py-4 sm:border-r sm:pr-4">
                <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-xs uppercase text-gray-500">Barbeiro</p>
                  <p className="text-sm font-semibold text-white">{appointment?.barberName}</p>
                </div>
              </div>

              <div className="flex items-start gap-3 border-b border-white/10 py-4 sm:pl-4">
                <Scissors className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-xs uppercase text-gray-500">Serviço</p>
                  <p className="text-sm font-semibold text-white">{appointment?.serviceName}</p>
                </div>
              </div>
            </div>
          </div>

          {appointment?.isLateCancellation && (
            <div className="mt-4 rounded-md border border-orange-400/25 bg-orange-500/10 p-3 text-left text-sm leading-6 text-orange-100">
              Esta marcação está a menos de {appointment.cancellationPolicyHours || 4} horas. Se avançar, ficará registada como cancelamento tardio.
            </div>
          )}

          <div className="mt-6 space-y-3">
            <Link href={`/reschedule/${token}`}>
              <Button variant="gold" className="flex h-12 w-full items-center justify-center gap-2 text-base">
                <RotateCcw className="h-4 w-4" /> Reagendar
              </Button>
            </Link>

            <Button
              variant="destructive"
              className="h-12 w-full text-base"
              onClick={handleCancel}
              disabled={cancelAppointment.isPending}
            >
              {cancelAppointment.isPending ? (
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              ) : (
                "Cancelar marcação"
              )}
            </Button>

            <Link href="/">
              <Button variant="ghost" className="h-11 w-full">
                Manter marcação
              </Button>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
