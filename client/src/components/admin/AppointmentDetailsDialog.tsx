import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import { CheckCircle, MessageCircle, Pencil, Phone, User, XCircle } from "lucide-react";
import { type AppointmentStatus } from "@/hooks/use-appointments";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button-custom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { canBarberPerformService } from "@/lib/availability";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { getAppointmentContactLinks, getWeeklyAppointmentEnd } from "@/components/admin/WeeklyAgenda";

type AdminAppointment = {
  id: number;
  barberId: number;
  serviceId: number | null;
  startTime: string;
  durationMinutes: number;
  status: AppointmentStatus;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  depositRequired?: boolean;
  depositReason?: string | null;
};

type ServiceListItem = {
  id: number;
  name: string;
  duration?: number;
  isVisible?: boolean | null;
};

function EditAppointmentDialog({
  appointment,
  barbers,
  services,
  toast,
}: {
  appointment: AdminAppointment;
  barbers?: Array<{ id: number; name: string; serviceIds?: number[] | null; isVisible?: boolean | null }>;
  services?: ServiceListItem[];
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [open, setOpen] = useState(false);
  const [dateValue, setDateValue] = useState(format(parseISO(appointment.startTime), "yyyy-MM-dd"));
  const [timeValue, setTimeValue] = useState(format(parseISO(appointment.startTime), "HH:mm"));
  const [barberId, setBarberId] = useState(String(appointment.barberId));
  const [serviceId, setServiceId] = useState(appointment.serviceId ? String(appointment.serviceId) : "none");
  const [isSaving, setIsSaving] = useState(false);
  const serviceList = (services || []).filter((service) =>
    service.isVisible !== false || service.id === appointment.serviceId,
  );
  const activeBarbers = (barbers || []).filter((barber) =>
    barber.isVisible !== false || barber.id === appointment.barberId,
  );
  const selectedBarber = activeBarbers.find((barber) => String(barber.id) === barberId);
  const compatibleServices = useMemo(
    () => serviceList.filter((service) => canBarberPerformService(selectedBarber, service.id)),
    [selectedBarber, serviceList],
  );
  const canUseNoService = appointment.serviceId === null;
  const hasCompatibleService = serviceId !== "none" || canUseNoService;

  useEffect(() => {
    if (!open) return;
    if (serviceId === "none") {
      if (!canUseNoService && compatibleServices.length > 0) {
        setServiceId(String(compatibleServices[0].id));
      }
      return;
    }

    if (!compatibleServices.some((service) => String(service.id) === serviceId)) {
      setServiceId(compatibleServices[0] ? String(compatibleServices[0].id) : "none");
    }
  }, [canUseNoService, compatibleServices, open, serviceId]);

  const resetForm = () => {
    setDateValue(format(parseISO(appointment.startTime), "yyyy-MM-dd"));
    setTimeValue(format(parseISO(appointment.startTime), "HH:mm"));
    setBarberId(String(appointment.barberId));
    setServiceId(appointment.serviceId ? String(appointment.serviceId) : "none");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) resetForm();
    setOpen(nextOpen);
  };

  const handleSave = async () => {
    const newStartTime = new Date(`${dateValue}T${timeValue}`);
    const parsedBarberId = Number(barberId);
    const parsedServiceId = serviceId === "none" ? null : Number(serviceId);

    if (Number.isNaN(newStartTime.getTime()) || !Number.isFinite(parsedBarberId)) {
      toast({ title: "Erro", description: "Verifique a data, hora e barbeiro.", variant: "destructive" });
      return;
    }

    if (!hasCompatibleService) {
      toast({ title: "Serviço inválido", description: "Escolha um serviço compatível com o barbeiro.", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      await apiRequest("PATCH", `/api/appointments/${appointment.id}`, {
        startTime: newStartTime,
        barberId: parsedBarberId,
        serviceId: parsedServiceId,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/public"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
      toast({ title: "Sucesso", description: "Marcação atualizada." });
      setOpen(false);
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message || "Não foi possível atualizar a marcação.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 text-xs text-primary hover:text-primary/80">
          <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-white/10 text-white">
        <DialogHeader><DialogTitle>Editar marcação</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input type="date" value={dateValue} onChange={(event) => setDateValue(event.target.value)} className="bg-background border-white/10 text-white" />
            </div>
            <div className="space-y-2">
              <Label>Hora</Label>
              <Input type="time" value={timeValue} onChange={(event) => setTimeValue(event.target.value)} className="bg-background border-white/10 text-white" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Barbeiro</Label>
            <Select value={barberId} onValueChange={setBarberId}>
              <SelectTrigger className="bg-background border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-white/10 text-white">
                {activeBarbers.map((barber) => <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Serviço</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger className="bg-background border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-white/10 text-white">
                {canUseNoService && <SelectItem value="none">Sem serviço</SelectItem>}
                {compatibleServices.map((service) => (
                  <SelectItem key={service.id} value={String(service.id)}>
                    {service.name}{service.duration ? ` · ${service.duration} min` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {compatibleServices.length === 0 && !canUseNoService && (
              <p className="text-xs text-red-300">Este barbeiro não tem serviços compatíveis.</p>
            )}
          </div>
          <Button
            variant="gold"
            className="w-full"
            disabled={isSaving || !hasCompatibleService}
            onClick={handleSave}
          >
            {isSaving ? "A guardar..." : "Guardar alterações"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmAction({
  children,
  title,
  description,
  confirmLabel = "Confirmar",
  confirmClassName = "",
  onConfirm,
}: {
  children: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmClassName?: string;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent className="border-white/10 bg-card text-white">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-400">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-white/10 bg-background text-white hover:bg-white/10">
            Voltar
          </AlertDialogCancel>
          <AlertDialogAction className={confirmClassName} onClick={() => void onConfirm()}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function AppointmentDetailsDialog({
  appointment,
  open,
  onOpenChange,
  barbers,
  services,
  toast,
  getBarberName,
  getServiceName,
  getStatusLabel,
  getStatusClass,
  onOpenHistory,
  onStatusChange,
  onBlockCustomer,
  canManageSchedule,
}: {
  appointment: AdminAppointment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barbers?: Array<{ id: number; name: string; serviceIds?: number[] | null }>;
  services?: ServiceListItem[];
  toast: ReturnType<typeof useToast>["toast"];
  getBarberName: (id: number) => string;
  getServiceName: (id?: number | null) => string;
  getStatusLabel: (status: string) => string;
  getStatusClass: (status: string) => string;
  onOpenHistory: (appointment: AdminAppointment) => void;
  onStatusChange: (
    appointmentId: number,
    status: AppointmentStatus,
    options?: { onSuccess?: () => void },
  ) => void;
  onBlockCustomer: (appointment: AdminAppointment) => Promise<boolean | void>;
  canManageSchedule: boolean;
}) {
  const [customerNotes, setCustomerNotes] = useState("");
  const [customerNotesUpdatedAt, setCustomerNotesUpdatedAt] = useState<string | null>(null);
  const [isLoadingCustomerNotes, setIsLoadingCustomerNotes] = useState(false);
  const [isSavingCustomerNotes, setIsSavingCustomerNotes] = useState(false);

  useEffect(() => {
    if (!open || !appointment?.customerPhone) return;

    let isMounted = true;
    const loadCustomerNotes = async () => {
      setIsLoadingCustomerNotes(true);
      try {
        const params = new URLSearchParams();
        if (appointment.customerEmail) params.set("email", appointment.customerEmail);
        if (appointment.customerName) params.set("name", appointment.customerName);
        const query = params.toString() ? `?${params.toString()}` : "";
        const res = await apiFetch(`/api/admin/customers/${encodeURIComponent(appointment.customerPhone)}/history${query}`);
        if (!res.ok) throw new Error("Não foi possível carregar as notas.");
        const data = await res.json();
        if (!isMounted) return;
        setCustomerNotes(data.notes?.notes || "");
        setCustomerNotesUpdatedAt(data.notes?.updatedAt || null);
      } catch {
        if (!isMounted) return;
        setCustomerNotes("");
        setCustomerNotesUpdatedAt(null);
      } finally {
        if (isMounted) setIsLoadingCustomerNotes(false);
      }
    };

    loadCustomerNotes();
    return () => {
      isMounted = false;
    };
  }, [appointment?.customerEmail, appointment?.customerName, appointment?.customerPhone, open]);

  const handleSaveCustomerNotes = async () => {
    if (!appointment?.customerPhone) return;
    setIsSavingCustomerNotes(true);
    try {
      const res = await apiRequest("PATCH", `/api/admin/customers/${encodeURIComponent(appointment.customerPhone)}/notes`, {
        customerName: appointment.customerName || "",
        email: appointment.customerEmail || "",
        notes: customerNotes,
      });
      const savedNote = await res.json();
      setCustomerNotes(savedNote.notes || "");
      setCustomerNotesUpdatedAt(savedNote.updatedAt || null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
      toast({ title: "Notas guardadas", description: "As notas internas do cliente foram atualizadas." });
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message || "Não foi possível guardar as notas.",
        variant: "destructive",
      });
    } finally {
      setIsSavingCustomerNotes(false);
    }
  };

  if (!appointment) {
    return <Dialog open={open} onOpenChange={onOpenChange} />;
  }

  const start = parseISO(appointment.startTime);
  const end = getWeeklyAppointmentEnd(appointment);
  const contactLinks = getAppointmentContactLinks(appointment.customerPhone);

  const handleOpenHistory = () => {
    onOpenChange(false);
    onOpenHistory(appointment);
  };

  const handleStatusChange = (status: AppointmentStatus) => {
    onStatusChange(appointment.id, status, { onSuccess: () => onOpenChange(false) });
  };

  const handleBlockCustomer = async () => {
    const completed = await onBlockCustomer(appointment);
    if (completed !== false) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1rem)] overflow-y-auto border-white/10 bg-card text-white sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Detalhes da marcação</DialogTitle>
          <DialogDescription className="text-gray-400">
            {format(start, "dd/MM/yyyy", { locale: pt })} · {format(start, "HH:mm")} - {format(end, "HH:mm")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-2xl border border-white/10 bg-background/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xl font-display font-bold text-primary">{format(start, "HH:mm")}</p>
                <h3 className="mt-1 truncate text-lg font-bold text-white">{appointment.customerName}</h3>
                <p className="text-sm text-gray-400">{contactLinks.displayPhone || appointment.customerPhone}</p>
              </div>
              <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide", getStatusClass(appointment.status))}>
                {getStatusLabel(appointment.status)}
              </span>
            </div>

            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-card px-3 py-2">
                <p className="text-xs uppercase tracking-widest text-gray-500">Barbeiro</p>
                <p className="mt-1 font-semibold text-white">{getBarberName(appointment.barberId)}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-card px-3 py-2">
                <p className="text-xs uppercase tracking-widest text-gray-500">Serviço</p>
                <p className="mt-1 font-semibold text-white">{getServiceName(appointment.serviceId)}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Label className="text-sm font-semibold text-white">Notas internas</Label>
                <p className="mt-1 text-xs text-gray-400">
                  Preferências, atrasos habituais, alergias ou detalhes importantes do cliente.
                </p>
              </div>
              {customerNotesUpdatedAt && (
                <span className="text-[11px] text-gray-500">
                  {format(parseISO(customerNotesUpdatedAt), "dd/MM HH:mm")}
                </span>
              )}
            </div>
            <Textarea
              value={customerNotes}
              onChange={(event) => setCustomerNotes(event.target.value)}
              maxLength={1200}
              disabled={isLoadingCustomerNotes}
              placeholder="Ex.: prefere máquina 0.5, costuma atrasar 10 min, quer sempre barba curta."
              className="mt-3 min-h-[96px] resize-y border-white/10 bg-card text-white placeholder:text-gray-600"
            />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-gray-500">
                {isLoadingCustomerNotes ? "A carregar notas..." : `${customerNotes.length}/1200`}
              </span>
              <Button
                type="button"
                variant="gold"
                size="sm"
                onClick={handleSaveCustomerNotes}
                disabled={isLoadingCustomerNotes || isSavingCustomerNotes}
                className="w-full sm:w-auto"
              >
                {isSavingCustomerNotes ? "A guardar..." : "Guardar notas"}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {contactLinks.whatsapp && (
              <Button asChild size="sm" variant="outline" className="h-9 border-white/10 text-xs text-green-300 hover:text-green-200">
                <a href={contactLinks.whatsapp} target="_blank" rel="noreferrer">
                  <MessageCircle className="mr-1 h-3.5 w-3.5" /> WhatsApp
                </a>
              </Button>
            )}
            {contactLinks.tel && (
              <Button asChild size="sm" variant="outline" className="h-9 border-white/10 text-xs">
                <a href={contactLinks.tel}>
                  <Phone className="mr-1 h-3.5 w-3.5" /> Ligar
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleOpenHistory} className="h-9 border-white/10 text-xs">
              <User className="mr-1 h-3.5 w-3.5" /> Histórico
            </Button>

            {appointment.status === "booked" && (
              <>
                <Button size="sm" variant="ghost" onClick={() => handleStatusChange("completed")} className="h-9 text-xs text-green-300 hover:text-green-200">
                  <CheckCircle className="mr-1 h-3.5 w-3.5" /> Feita
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleStatusChange("no_show")} className="h-9 text-xs text-rose-300 hover:text-rose-200">
                  Falta
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleStatusChange("cancelled")} className="h-9 text-xs text-red-300 hover:text-red-200">
                  <XCircle className="mr-1 h-3.5 w-3.5" /> Cancelar
                </Button>
                {canManageSchedule && (
                  <>
                    <ConfirmAction
                      title="Bloquear cliente?"
                      description={`${appointment.customerName} (${contactLinks.displayPhone || appointment.customerPhone}) deixa de conseguir fazer marcações online.`}
                      confirmLabel="Bloquear"
                      confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onConfirm={handleBlockCustomer}
                    >
                      <Button size="sm" variant="ghost" className="h-9 text-xs text-destructive hover:text-red-300">
                        Bloquear
                      </Button>
                    </ConfirmAction>
                    <EditAppointmentDialog
                      appointment={appointment}
                      barbers={barbers}
                      services={services}
                      toast={toast}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
