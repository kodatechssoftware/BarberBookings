import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useAppointmentByToken, useCancelAppointment } from "@/hooks/use-appointments";
import { Button } from "@/components/ui/button-custom";
import { XCircle, Loader2, Home } from "lucide-react";
import { motion } from "framer-motion";

export default function Cancellation() {
  const [, params] = useRoute("/cancel/:token");
  const token = params?.token;
  const cancelAppointment = useCancelAppointment();
  const { data: appointment, isLoading } = useAppointmentByToken(token);
  const [success, setSuccess] = useState(false);
  const [cancelMessage, setCancelMessage] = useState("");

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
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (appointment === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <h2 className="text-3xl font-display font-bold mb-4 text-white">Marcação não encontrada</h2>
          <p className="text-gray-400 mb-8">Este link não corresponde a nenhuma marcação ativa.</p>
          <Link href="/">
            <Button variant="gold" className="w-full flex items-center justify-center gap-2">
              <Home className="w-4 h-4" /> Voltar ao Início
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (success || isCancelled) {
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
            {cancelMessage || "Esta marcação já se encontra cancelada. Não é necessária nova ação."}
          </p>
          <Link href="/">
            <Button variant="gold" className="w-full flex items-center justify-center gap-2">
              <Home className="w-4 h-4" /> Voltar ao Início
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (isUnavailable) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <h2 className="text-3xl font-display font-bold mb-4 text-white">Marcação indisponível</h2>
          <p className="text-gray-400 mb-8">Esta marcação já não pode ser cancelada por este link.</p>
          <Link href="/">
            <Button variant="gold" className="w-full flex items-center justify-center gap-2">
              <Home className="w-4 h-4" /> Voltar ao Início
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <h2 className="text-3xl font-display font-bold mb-6 text-white">Confirmar Cancelamento</h2>
        <p className="text-gray-400 mb-8">
          Tem a certeza que deseja cancelar a sua marcação na Baptista Barber Shop? Esta ação não pode ser desfeita.
        </p>

        {appointment?.isLateCancellation && (
          <div className="mb-6 rounded-xl border border-orange-400/20 bg-orange-500/10 p-4 text-left text-sm text-orange-200">
            Esta marcação está a menos de {appointment.cancellationPolicyHours || 4} horas. Se avançar, ficará registada como cancelamento tardio.
          </div>
        )}

        <div className="space-y-4">
          <Link href={`/reschedule/${token}`}>
            <Button variant="gold" className="w-full h-12 text-lg">
              Reagendar em vez de cancelar
            </Button>
          </Link>

          <Button
            variant="destructive"
            className="w-full h-12 text-lg"
            onClick={handleCancel}
            disabled={cancelAppointment.isPending}
          >
            {cancelAppointment.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            ) : (
              "Sim, Cancelar Marcação"
            )}
          </Button>

          <Link href="/">
            <Button variant="ghost" className="w-full">
              Manter Marcação
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
