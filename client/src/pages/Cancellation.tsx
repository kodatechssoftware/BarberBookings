import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useCancelAppointment } from "@/hooks/use-appointments";
import { Button } from "@/components/ui/button-custom";
import { CheckCircle, XCircle, Loader2, Home } from "lucide-react";
import { motion } from "framer-motion";

export default function Cancellation() {
  const [, params] = useRoute("/cancel/:token");
  const token = params?.token;
  const cancelAppointment = useCancelAppointment();
  const [success, setSuccess] = useState(false);

  const handleCancel = async () => {
    if (!token) return;
    try {
      await cancelAppointment.mutateAsync(token);
      setSuccess(true);
    } catch (error: any) {
      // Error handled by mutation
    }
  };

  if (success) {
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
        
        <div className="space-y-4">
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
