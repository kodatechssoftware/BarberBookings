import { lazy, Suspense, useState, useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import { type AppointmentStatus, useAppointments, useUpdateAppointmentStatus, useCreateAppointment } from "@/hooks/use-appointments";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, startOfToday, subDays } from "date-fns";
import { pt } from "date-fns/locale";
import { Loader2, CheckCircle, XCircle, Plus, Calendar as CalendarIcon, Clock, User, LogOut, Scissors, Settings, Users, FileDown, Bell, Copy, BarChart3, TrendingUp, Euro, AlertTriangle, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { useBarbers } from "@/hooks/use-barbers";
import { useServices } from "@/hooks/use-services";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiFetch, buildApiUrl } from "@/lib/api";

type AvailabilityPeriod = { startTime: string; endTime: string };
type AvailabilityForm = Record<number, { isWorking: boolean; periods: AvailabilityPeriod[] }>;
type AdminUser = {
  authorized: boolean;
  role: "" | "admin" | "barber";
  id?: number;
  name?: string;
  email?: string;
};
type AdminAppointment = {
  id: number;
  barberId: number;
  serviceId: number | null;
  startTime: string;
  status: AppointmentStatus;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  depositRequired?: boolean;
  depositReason?: string | null;
};
type DashboardData = {
  range: {
    startDate: string;
    endDate: string;
    days: number;
    barberId: number | "all";
  };
  summary: {
    appointments: number;
    completed: number;
    booked: number;
    cancellations: number;
    noShows: number;
    revenueCents: number;
    projectedRevenueCents: number;
    averageTicketCents: number;
    completionRate: number;
    noShowRate: number;
    upcomingWeek: number;
    inactiveCustomers: number;
    busiestHour: string | null;
  };
  daily: Array<{
    date: string;
    label: string;
    appointments: number;
    completed: number;
    booked: number;
    cancelled: number;
    noShows: number;
    revenueCents: number;
  }>;
  barbers: Array<{
    id: number;
    name: string;
    appointments: number;
    completed: number;
    booked: number;
    noShows: number;
    revenueCents: number;
  }>;
  services: Array<{
    id: number;
    name: string;
    count: number;
    revenueCents: number;
  }>;
  inactiveCustomers: Array<{
    name: string;
    phone: string;
    email: string;
    lastVisit: string;
    totalVisits: number;
    daysSinceLastVisit: number;
  }>;
};

const currencyFormatter = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
});

function formatCents(value: number) {
  return currencyFormatter.format((value || 0) / 100);
}

const DashboardChartCard = lazy(() => import("@/components/admin/DashboardChartCard"));

function DashboardChartFallback({
  title,
  heightClassName,
  description,
}: {
  title: string;
  heightClassName: string;
  description?: string;
}) {
  return (
    <Card className="border-white/10 bg-card text-white">
      <CardHeader>
        <CardTitle className="text-base font-bold">{title}</CardTitle>
        {description && <p className="text-sm text-gray-400">{description}</p>}
      </CardHeader>
      <CardContent>
        <div className={`${heightClassName} w-full animate-pulse rounded-lg bg-white/5`} />
      </CardContent>
    </Card>
  );
}

const weekDays = [
  { id: 1, label: "Segunda" },
  { id: 2, label: "Terça" },
  { id: 3, label: "Quarta" },
  { id: 4, label: "Quinta" },
  { id: 5, label: "Sexta" },
  { id: 6, label: "Sábado" },
  { id: 0, label: "Domingo" },
];

function ConfirmAction({
  children,
  title,
  description,
  confirmLabel = "Confirmar",
  confirmClassName = "",
  onConfirm,
}: {
  children: React.ReactNode;
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
function createDefaultAvailabilityForm(): AvailabilityForm {
  return {
    0: { isWorking: false, periods: [{ startTime: "09:00", endTime: "13:00" }] },
    1: { isWorking: true, periods: [{ startTime: "14:00", endTime: "20:00" }] },
    2: { isWorking: true, periods: [{ startTime: "09:00", endTime: "13:00" }, { startTime: "14:00", endTime: "20:00" }] },
    3: { isWorking: true, periods: [{ startTime: "09:00", endTime: "13:00" }, { startTime: "14:00", endTime: "20:00" }] },
    4: { isWorking: true, periods: [{ startTime: "09:00", endTime: "13:00" }, { startTime: "14:00", endTime: "20:00" }] },
    5: { isWorking: true, periods: [{ startTime: "09:00", endTime: "13:00" }, { startTime: "14:00", endTime: "20:00" }] },
    6: { isWorking: true, periods: [{ startTime: "09:00", endTime: "13:00" }, { startTime: "14:00", endTime: "19:00" }] },
  };
}

function createBlankAvailabilityForm(): AvailabilityForm {
  return weekDays.reduce((acc, day) => {
    acc[day.id] = { isWorking: false, periods: [{ startTime: "09:00", endTime: "13:00" }] };
    return acc;
  }, {} as AvailabilityForm);
}

export default function Admin() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isAddingBarber, setIsAddingBarber] = useState(false);
  const [isAddingService, setIsAddingService] = useState(false);
  const [barberFormData, setBarberFormData] = useState({ name: "", specialty: "", bio: "", avatar: "", email: "" });
  const [serviceFormData, setServiceFormData] = useState({ name: "", description: "", price: 0, duration: 30 });

  const [selectedDateFilter, setSelectedDateFilter] = useState<Date>(startOfToday());
  const [selectedBarberFilter, setSelectedBarberFilter] = useState<string>("all");
  const [dashboardDays, setDashboardDays] = useState("30");
  const [dashboardBarberFilter, setDashboardBarberFilter] = useState("all");
  const { data: appointments, isLoading: isLoadingAppointments, refetch } = useAppointments({ 
    enabled: user?.authorized === true,
    date: format(selectedDateFilter, 'yyyy-MM-dd'),
    barberId: user?.role === "barber" ? (user.id ? String(user.id) : undefined) : (selectedBarberFilter === "all" ? undefined : selectedBarberFilter),
    refetchInterval: 10000,
  });
  const { data: barbers } = useBarbers({ enabled: user?.authorized === true, includeHidden: true });
  const { data: services } = useServices({ enabled: user?.authorized === true, includeHidden: true });
  const { data: blacklistEntries } = useQuery<any[]>({ 
    queryKey: ["/api/admin/blacklist"],
    enabled: user?.role === "admin"
  });
  const { data: allAvailabilityRows } = useQuery<any[]>({
    queryKey: ["/api/barbers/availability"],
    enabled: user?.authorized === true,
  });
  const { data: dashboardData, isLoading: isLoadingDashboard } = useQuery<DashboardData>({
    queryKey: ["/api/admin/dashboard", dashboardDays, dashboardBarberFilter, user?.role, user?.id],
    enabled: user?.authorized === true,
    queryFn: async () => {
      const params = new URLSearchParams({ days: dashboardDays });
      if (user?.role === "barber" && user.id) {
        params.set("barberId", String(user.id));
      } else if (dashboardBarberFilter !== "all") {
        params.set("barberId", dashboardBarberFilter);
      }

      const res = await apiFetch(`/api/admin/dashboard?${params.toString()}`);
      if (!res.ok) throw new Error("Não foi possível carregar o dashboard.");
      return res.json();
    },
  });
  const appointmentList = useMemo(
    () => (Array.isArray(appointments) ? (appointments as AdminAppointment[]) : []),
    [appointments],
  );
  const updateStatus = useUpdateAppointmentStatus();
  const createAppointment = useCreateAppointment();
  const { toast } = useToast();

  const [isBlocking, setIsBlocking] = useState(false);
  const [blockData, setBlockData] = useState<{
    barberId: string;
    serviceId: string;
    times: string[];
    name: string;
    phone: string;
    date: Date;
    endDate: Date;
    isMultiDay: boolean;
    isManualBooking: boolean;
    isRecurring: boolean;
    recurringWeeks: string;
    recurringMonths: string;
  }>({
    barberId: "",
    serviceId: "",
    times: [],
    name: "",
    phone: "900000000",
    date: startOfToday(),
    endDate: startOfToday(),
    isMultiDay: false,
    isManualBooking: false,
    isRecurring: false,
    recurringWeeks: "2",
    recurringMonths: "6",
  });

  const [loginData, setLoginData] = useState({ username: "", password: "" });
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [exportDates, setExportDates] = useState({ 
    start: subDays(startOfToday(), 30), 
    end: startOfToday(),
    barberId: "all"
  });
  const [availabilityBarber, setAvailabilityBarber] = useState<any | null>(null);
  const [availabilityForm, setAvailabilityForm] = useState<AvailabilityForm>(() => createDefaultAvailabilityForm());
  const [isSavingAvailability, setIsSavingAvailability] = useState(false);
  const [customerHistory, setCustomerHistory] = useState<any | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [customerNotes, setCustomerNotes] = useState("");
  const [isSavingCustomerNotes, setIsSavingCustomerNotes] = useState(false);
  const appointmentSignaturesRef = useRef<Set<string>>(new Set());
  const hasHydratedAppointmentsRef = useRef(false);

  const handleAddBarber = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest("POST", "/api/barbers", barberFormData);
      queryClient.invalidateQueries({ queryKey: ["/api/barbers"] });
      setIsAddingBarber(false);
      setBarberFormData({ name: "", specialty: "", bio: "", avatar: "", email: "" });
      toast({ title: "Sucesso", description: "Barbeiro adicionado com sucesso." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Erro ao adicionar barbeiro.", variant: "destructive" });
    }
  };

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest("POST", "/api/services", serviceFormData);
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setIsAddingService(false);
      setServiceFormData({ name: "", description: "", price: 0, duration: 30 });
      toast({ title: "Sucesso", description: "Serviço adicionado com sucesso." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Erro ao adicionar serviço.", variant: "destructive" });
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const url = `/api/admin/export?startDate=${format(exportDates.start, 'yyyy-MM-dd')}&endDate=${format(exportDates.end, 'yyyy-MM-dd')}&barberId=${exportDates.barberId}`;
      window.open(buildApiUrl(url), '_blank');
      toast({ title: "Sucesso", description: "O relatório está a ser gerado." });
    } catch (err) {
      toast({ title: "Erro", description: "Falha ao gerar o relatório.", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const checkAuth = async () => {
    try {
      const res = await apiFetch("/api/admin/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        setUser({ authorized: false, role: "" });
      }
    } catch {
      setUser({ authorized: false, role: "" });
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const res = await apiFetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginData),
      });
      if (res.ok) {
        const data = await res.json();
        await checkAuth();
        toast({ title: "Bem-vindo", description: data.message });
      } else {
        const data = await res.json().catch(() => null);
        toast({ title: "Erro", description: data?.message || "Utilizador ou palavra-passe incorretos.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro", description: "Erro ao tentar fazer login.", variant: "destructive" });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await apiFetch("/api/admin/logout", { method: "POST" });
    setUser({ authorized: false, role: "" });
  };

  const availabilityRowsToForm = (rows: any[]) => {
    if (!rows || rows.length === 0) return createDefaultAvailabilityForm();

    const form = createBlankAvailabilityForm();
    rows.forEach((row) => {
      if (!form[row.dayOfWeek]) return;
      form[row.dayOfWeek].isWorking = true;
      if (form[row.dayOfWeek].periods.length === 1 && form[row.dayOfWeek].periods[0].startTime === "09:00" && form[row.dayOfWeek].periods[0].endTime === "13:00") {
        form[row.dayOfWeek].periods = [];
      }
      form[row.dayOfWeek].periods.push({ startTime: row.startTime, endTime: row.endTime });
    });

    return form;
  };

  const openAvailabilityEditor = async (barber: any) => {
    try {
      const res = await apiFetch(`/api/barbers/${barber.id}/availability`);
      if (!res.ok) throw new Error("Não foi possível carregar os horários.");
      const rows = await res.json();
      setAvailabilityForm(availabilityRowsToForm(rows));
      setAvailabilityBarber(barber);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const handleSaveAvailability = async () => {
    if (!availabilityBarber) return;
    setIsSavingAvailability(true);
    try {
      const rows = weekDays.flatMap((day) => {
        const dayConfig = availabilityForm[day.id];
        if (!dayConfig?.isWorking) return [];
        return dayConfig.periods
          .filter((period) => period.startTime && period.endTime && period.endTime > period.startTime)
          .map((period) => ({
            dayOfWeek: day.id,
            startTime: period.startTime,
            endTime: period.endTime,
            isWorking: true,
          }));
      });

      await apiRequest("PATCH", `/api/barbers/${availabilityBarber.id}/availability`, rows);
      queryClient.invalidateQueries({ queryKey: ["/api/barbers/availability"] });
      setAvailabilityBarber(null);
      toast({ title: "Sucesso", description: "Horários do barbeiro atualizados." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Não foi possível guardar os horários.", variant: "destructive" });
    } finally {
      setIsSavingAvailability(false);
    }
  };

  const handleCreateBarberInvite = async (barber: any) => {
    try {
      const res = await apiRequest("POST", `/api/barbers/${barber.id}/invite`, {});
      const data = await res.json();

      try {
        await navigator.clipboard?.writeText(data.inviteUrl);
      } catch {
        // Clipboard can fail on non-HTTPS local previews; the link is still shown in the toast.
      }

      toast({
        title: "Convite criado",
        description: `Link copiado para enviar a ${barber.name}: ${data.inviteUrl}`,
      });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Não foi possível criar o convite.", variant: "destructive" });
    }
  };

  const openCustomerHistory = async (appointment: any) => {
    setIsHistoryOpen(true);
    setIsLoadingHistory(true);
    setCustomerHistory(null);
    setCustomerNotes("");
    try {
      const emailQuery = appointment.customerEmail ? `?email=${encodeURIComponent(appointment.customerEmail)}` : "";
      const res = await apiFetch(`/api/admin/customers/${encodeURIComponent(appointment.customerPhone)}/history${emailQuery}`);
      if (!res.ok) throw new Error("Não foi possível carregar o histórico do cliente.");
      const data = await res.json();
      setCustomerHistory(data);
      setCustomerNotes(data.notes?.notes || "");
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
      setIsHistoryOpen(false);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleSaveCustomerNotes = async () => {
    if (!customerHistory?.customer?.phone) return;
    setIsSavingCustomerNotes(true);
    try {
      const res = await apiRequest("PATCH", `/api/admin/customers/${encodeURIComponent(customerHistory.customer.phone)}/notes`, {
        email: customerHistory.customer.email || "",
        notes: customerNotes,
      });
      const savedNote = await res.json();
      setCustomerHistory({
        ...customerHistory,
        notes: {
          notes: savedNote.notes,
          updatedAt: savedNote.updatedAt,
        },
      });
      setCustomerNotes(savedNote.notes || "");
      toast({ title: "Notas guardadas", description: "As preferências do cliente foram atualizadas." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message || "Não foi possível guardar as notas.", variant: "destructive" });
    } finally {
      setIsSavingCustomerNotes(false);
    }
  };

  const getBarberName = (id: number) => barbers?.find(b => b.id === id)?.name || "Desconhecido";
  const getServiceName = (id?: number | null) => services?.find(s => s.id === id)?.name || "Serviço indisponível";
  const getStatusLabel = (status: string) => ({
    booked: "Marcada",
    completed: "Concluída",
    cancelled: "Cancelada",
    late_cancelled: "Cancelamento tardio",
    no_show: "Falta",
  }[status] || status);
  const getStatusClass = (status: string) => ({
    booked: "text-blue-300 border-blue-400/20 bg-blue-500/10",
    completed: "text-green-300 border-green-400/20 bg-green-500/10",
    cancelled: "text-red-300 border-red-400/20 bg-red-500/10",
    late_cancelled: "text-orange-300 border-orange-400/20 bg-orange-500/10",
    no_show: "text-rose-300 border-rose-400/20 bg-rose-500/10",
  }[status] || "text-gray-300 border-white/10 bg-white/5");

  const handleStatusChange = (appointmentId: number, status: AppointmentStatus) => {
    updateStatus.mutate(
      { id: appointmentId, status },
      {
        onSuccess: () => {
          toast({ title: "Atualizado", description: `Estado alterado para ${getStatusLabel(status).toLowerCase()}.` });
        },
        onError: (error: any) => {
          toast({ title: "Erro", description: error.message || "Não foi possível atualizar a marcação.", variant: "destructive" });
        },
      },
    );
  };

  const activeBarberColumns = useMemo(() => {
    const allBarbers = barbers || [];
    if (user?.role === "barber") {
      return allBarbers.filter((barber) => barber.id === user.id);
    }
    if (selectedBarberFilter !== "all") {
      return allBarbers.filter((barber) => String(barber.id) === selectedBarberFilter);
    }
    return allBarbers;
  }, [barbers, selectedBarberFilter, user]);

  const appointmentsByBarber = useMemo(() => {
    return activeBarberColumns.map((barber) => ({
      barber,
      appointments: appointmentList
        .filter((appointment) => appointment.barberId === barber.id)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    }));
  }, [activeBarberColumns, appointmentList]);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    appointmentSignaturesRef.current = new Set();
    hasHydratedAppointmentsRef.current = false;
  }, [selectedDateFilter, selectedBarberFilter, user?.role, user?.id]);

  useEffect(() => {
    if (!user?.authorized) return;

    const list = appointmentList.filter((appointment) =>
      ["booked", "cancelled", "late_cancelled"].includes(appointment.status),
    );
    const signatures = new Set(
      list.map((appointment) => `${appointment.id}:${appointment.status}:${appointment.startTime}`),
    );

    if (hasHydratedAppointmentsRef.current) {
      const changedItems = list.filter(
        (appointment) => !appointmentSignaturesRef.current.has(`${appointment.id}:${appointment.status}:${appointment.startTime}`),
      );
      if (changedItems.length > 0) {
        const appointment = changedItems[0];
        toast({
          title: "Painel atualizado",
          description: `${getStatusLabel(appointment.status)}: ${appointment.customerName} às ${format(parseISO(appointment.startTime), "HH:mm")}.`,
        });
      }
    }

    appointmentSignaturesRef.current = signatures;
    hasHydratedAppointmentsRef.current = true;
  }, [appointmentList, toast, user?.authorized]);

  const isDayClosed = (date: Date) => {
    const day = date.getDay();
    return day === 0;
  };

  const isTimeAvailableForDay = (date: Date, timeStr: string, duration = 30, barberId?: string) => {
    const day = date.getDay();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const startMinutes = hours * 60 + minutes;
    const endMinutes = startMinutes + duration;

    const barberRows = barberId
      ? (allAvailabilityRows || []).filter((row: any) => String(row.barberId) === barberId)
      : [];
    const periods = barberRows.length > 0
      ? barberRows
          .filter((row: any) => row.dayOfWeek === day && row.isWorking)
          .map((row: any) => ({
            start: row.startTime.split(":").map(Number)[0] * 60 + row.startTime.split(":").map(Number)[1],
            end: row.endTime.split(":").map(Number)[0] * 60 + row.endTime.split(":").map(Number)[1],
          }))
      : (() => {
          if (day === 1) return [{ start: 14 * 60, end: 20 * 60 }];
          if (day >= 2 && day <= 5) return [{ start: 9 * 60, end: 13 * 60 }, { start: 14 * 60, end: 20 * 60 }];
          if (day === 6) return [{ start: 9 * 60, end: 13 * 60 }, { start: 14 * 60, end: 19 * 60 }];
          return [];
        })();

    return periods.some((period: any) => startMinutes >= period.start && endMinutes <= period.end);
  };

  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const handleBlockTime = async () => {
    if (!blockData.barberId) {
      toast({ title: "Erro", description: "Selecione um barbeiro.", variant: "destructive" });
      return;
    }
    if (blockData.times.length === 0) {
      toast({ title: "Erro", description: "Selecione pelo menos um horário.", variant: "destructive" });
      return;
    }
    if (blockData.isManualBooking && !blockData.serviceId) {
      toast({ title: "Erro", description: "Selecione um serviço.", variant: "destructive" });
      return;
    }

    try {
      const promises: any[] = [];
      
      if (blockData.isRecurring) {
        const timeStr = blockData.times[0];
        const [hours, minutes] = timeStr.split(':').map(Number);
        const startTime = new Date(blockData.date);
        startTime.setHours(hours, minutes, 0, 0);

        await apiRequest("POST", "/api/appointments/block", {
          barberId: Number(blockData.barberId),
          serviceId: Number(blockData.serviceId),
          startTime: startTime,
          name: blockData.name || "Cliente Manual",
          phone: blockData.phone || "900000000",
          isManualBooking: true,
          isRecurring: true,
          recurringWeeks: Number(blockData.recurringWeeks),
          recurringMonths: Number(blockData.recurringMonths)
        });
      } else {
        let datesToBlock = [blockData.date];
        if (blockData.isMultiDay && blockData.endDate > blockData.date) {
          datesToBlock = [];
          let current = new Date(blockData.date);
          while (current <= blockData.endDate) {
            if (!isDayClosed(current)) datesToBlock.push(new Date(current));
            current.setDate(current.getDate() + 1);
          }
        }
        
        for (const date of datesToBlock) {
          for (const timeStr of blockData.times) {
            const [hours, minutes] = timeStr.split(':').map(Number);
            const startTime = new Date(date);
            startTime.setHours(hours, minutes, 0, 0);
            
            const payload = {
              barberId: Number(blockData.barberId),
              serviceId: blockData.isManualBooking ? Number(blockData.serviceId) : (services?.[0]?.id || 1),
              startTime: startTime,
              customerName: blockData.isManualBooking ? (blockData.name || "Cliente Manual") : (blockData.name || "BLOQUEIO MANUAL"),
              customerPhone: blockData.phone || "900000000",
            };
            
            // If it's a manual booking with a service, we use the block endpoint to ensure consistency
            if (blockData.isManualBooking) {
               promises.push(apiRequest("POST", "/api/appointments/block", { ...payload, isManualBooking: true }));
            } else {
               promises.push(createAppointment.mutateAsync(payload));
            }
          }
        }
        await Promise.all(promises);
      }
      
      toast({ title: "Sucesso", description: "Registo(s) processado(s) com sucesso." });
      setIsBlocking(false);
      setBlockData({ ...blockData, times: [], name: "", phone: "900000000", serviceId: "", isMultiDay: false, isManualBooking: false, isRecurring: false });
      refetch();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  if (user === null) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!user.authorized) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-card border-white/10">
          <CardHeader>
            <CardTitle className="text-2xl font-display font-bold text-center text-white">Baptista Barber Shop</CardTitle>
            <p className="text-center text-gray-400 text-sm mt-2">Acesso para Administradores e Barbeiros</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-white">Email ou Utilizador</Label>
                <Input value={loginData.username} onChange={(e) => setLoginData({...loginData, username: e.target.value})} className="bg-background border-white/10 text-white" placeholder="admin ou o seu email" required />
              </div>
              <div className="space-y-2">
                <Label className="text-white">Palavra-passe</Label>
                <Input type="password" value={loginData.password} onChange={(e) => setLoginData({...loginData, password: e.target.value})} className="bg-background border-white/10 text-white" required />
              </div>
              <Button type="submit" variant="gold" className="w-full" disabled={isLoggingIn}>{isLoggingIn ? "A entrar..." : "Entrar"}</Button>
              <p className="text-[10px] text-gray-500 text-center">Barbeiros devem definir a palavra-passe através do convite enviado pelo administrador.</p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-body p-4 md:p-8">
      <div className="container mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8 text-white">
          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-2">
              <h1 className="text-2xl md:text-3xl font-display font-bold">Painel Administrativo</h1>
              <div className="flex items-center gap-2">
                <Link href="/"><Button variant="outline" size="sm" className="text-primary border-primary/20 hover:bg-primary/10 h-8">Ver Site</Button></Link>
                <Button variant="ghost" size="sm" onClick={handleLogout} className="text-gray-500 hover:text-white w-fit px-0 sm:px-3"><LogOut className="w-4 h-4 mr-2" /> Sair</Button>
              </div>
            </div>
            <p className="text-gray-400 text-sm">Faça a gestão das marcações, da equipa e dos serviços.</p>
          </div>
        </div>

        <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
          <DialogContent className="bg-card border-white/10 text-white w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Histórico do cliente</DialogTitle>
            </DialogHeader>
            {isLoadingHistory ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : customerHistory ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-bold">{customerHistory.customer.name || "Cliente"}</h3>
                  <p className="text-sm text-gray-400">{customerHistory.customer.phone} {customerHistory.customer.email ? `· ${customerHistory.customer.email}` : ""}</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-gray-400">Total</p><p className="text-xl font-bold">{customerHistory.stats.total}</p></div>
                  <div className="rounded-xl bg-blue-500/10 p-3"><p className="text-xs text-gray-400">Marcadas</p><p className="text-xl font-bold text-blue-300">{customerHistory.stats.booked}</p></div>
                  <div className="rounded-xl bg-green-500/10 p-3"><p className="text-xs text-gray-400">Concluídas</p><p className="text-xl font-bold text-green-300">{customerHistory.stats.completed}</p></div>
                  <div className="rounded-xl bg-red-500/10 p-3"><p className="text-xs text-gray-400">Canceladas</p><p className="text-xl font-bold text-red-300">{customerHistory.stats.cancelled}</p></div>
                  <div className="rounded-xl bg-orange-500/10 p-3"><p className="text-xs text-gray-400">Tardios</p><p className="text-xl font-bold text-orange-300">{customerHistory.stats.lateCancelled}</p></div>
                  <div className="rounded-xl bg-rose-500/10 p-3"><p className="text-xs text-gray-400">Faltas</p><p className="text-xl font-bold text-rose-300">{customerHistory.stats.noShows}</p></div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-gray-300">
                  Última presença: {customerHistory.stats.lastPresence ? format(parseISO(customerHistory.stats.lastPresence), "dd/MM/yyyy HH:mm") : "sem presença registada"}
                  {customerHistory.stats.depositRecommended && (
                    <span className="ml-2 text-primary">Depósito recomendado nas próximas marcações.</span>
                  )}
                </div>
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <Label className="text-sm font-semibold text-white">Notas do cliente</Label>
                      <p className="text-xs text-gray-400">
                        Preferências de corte, hábitos de visita, barbeiro preferido ou cuidados a lembrar.
                      </p>
                    </div>
                    {customerHistory.notes?.updatedAt && (
                      <span className="text-[11px] text-gray-500">
                        Atualizado em {format(parseISO(customerHistory.notes.updatedAt), "dd/MM/yyyy HH:mm")}
                      </span>
                    )}
                  </div>
                  <Textarea
                    value={customerNotes}
                    onChange={(e) => setCustomerNotes(e.target.value)}
                    maxLength={1200}
                    placeholder="Ex.: Degradê médio, máquina 0.5 dos lados, prefere Bruno, costuma vir a cada 3 semanas."
                    className="min-h-[110px] resize-y border-white/10 bg-background text-white placeholder:text-gray-600"
                  />
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-xs text-gray-500">{customerNotes.length}/1200</span>
                    <Button
                      variant="gold"
                      size="sm"
                      onClick={handleSaveCustomerNotes}
                      disabled={isSavingCustomerNotes}
                      className="w-full sm:w-auto"
                    >
                      {isSavingCustomerNotes ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Guardar notas
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {customerHistory.appointments.map((appointment: any) => (
                    <div key={appointment.id} className="rounded-xl border border-white/10 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{appointment.serviceName}</p>
                        <p className="text-xs text-gray-400">{appointment.barberName} · {format(parseISO(appointment.startTime), "dd/MM/yyyy HH:mm")}</p>
                      </div>
                      <span className="text-xs uppercase tracking-widest text-gray-400">{getStatusLabel(appointment.status)}</span>
                    </div>
                  ))}
                  {customerHistory.appointments.length === 0 && (
                    <p className="text-center text-gray-500 py-6">Sem histórico para este cliente.</p>
                  )}
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog open={!!availabilityBarber} onOpenChange={(open) => !open && setAvailabilityBarber(null)}>
          <DialogContent className="bg-card border-white/10 text-white w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Horários de {availabilityBarber?.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {weekDays.map((day) => {
                const dayConfig = availabilityForm[day.id];
                return (
                  <div key={day.id} className="rounded-xl border border-white/10 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="font-bold text-white">{day.label}</Label>
                      <label className="flex items-center gap-2 text-sm text-gray-300">
                        <input
                          type="checkbox"
                          checked={dayConfig?.isWorking || false}
                          onChange={(e) => setAvailabilityForm({
                            ...availabilityForm,
                            [day.id]: {
                              ...(dayConfig || { periods: [{ startTime: "09:00", endTime: "13:00" }] }),
                              isWorking: e.target.checked,
                            },
                          })}
                          className="accent-primary"
                        />
                        Trabalha
                      </label>
                    </div>
                    {dayConfig?.isWorking && (
                      <div className="space-y-2">
                        {dayConfig.periods.map((period, index) => (
                          <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                            <div>
                              <Label className="text-xs text-gray-400">Entrada</Label>
                              <Input
                                type="time"
                                value={period.startTime}
                                onChange={(e) => {
                                  const periods = [...dayConfig.periods];
                                  periods[index] = { ...period, startTime: e.target.value };
                                  setAvailabilityForm({ ...availabilityForm, [day.id]: { ...dayConfig, periods } });
                                }}
                                className="bg-background border-white/10 text-white"
                              />
                            </div>
                            <div>
                              <Label className="text-xs text-gray-400">Saída</Label>
                              <Input
                                type="time"
                                value={period.endTime}
                                onChange={(e) => {
                                  const periods = [...dayConfig.periods];
                                  periods[index] = { ...period, endTime: e.target.value };
                                  setAvailabilityForm({ ...availabilityForm, [day.id]: { ...dayConfig, periods } });
                                }}
                                className="bg-background border-white/10 text-white"
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-400"
                              disabled={dayConfig.periods.length === 1}
                              onClick={() => setAvailabilityForm({
                                ...availabilityForm,
                                [day.id]: { ...dayConfig, periods: dayConfig.periods.filter((_, periodIndex) => periodIndex !== index) },
                              })}
                            >
                              Remover
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-white/10"
                          onClick={() => setAvailabilityForm({
                            ...availabilityForm,
                            [day.id]: {
                              ...dayConfig,
                              periods: [...dayConfig.periods, { startTime: "14:00", endTime: "18:00" }],
                            },
                          })}
                        >
                          Adicionar período
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              <Button variant="gold" className="w-full" disabled={isSavingAvailability} onClick={handleSaveAvailability}>
                {isSavingAvailability ? "A guardar..." : "Guardar horários"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="w-full justify-start overflow-x-auto bg-card border border-white/10 p-1">
            <TabsTrigger value="dashboard" className="gap-2 whitespace-nowrap text-white data-[state=active]:text-primary"><BarChart3 className="w-4 h-4" /> Dashboard</TabsTrigger>
            <TabsTrigger value="appointments" className="gap-2 whitespace-nowrap text-white data-[state=active]:text-primary"><Clock className="w-4 h-4" /> Marcações</TabsTrigger>
            {user.role === "admin" && (
              <>
                <TabsTrigger value="barbers" className="gap-2 whitespace-nowrap text-white data-[state=active]:text-primary"><Users className="w-4 h-4" /> Equipa</TabsTrigger>
                <TabsTrigger value="services" className="gap-2 whitespace-nowrap text-white data-[state=active]:text-primary"><Scissors className="w-4 h-4" /> Serviços</TabsTrigger>
                <TabsTrigger value="blacklist" className="gap-2 whitespace-nowrap text-white data-[state=active]:text-primary"><User className="w-4 h-4 text-red-400" /> Bloqueados</TabsTrigger>
                <TabsTrigger value="reports" className="gap-2 whitespace-nowrap text-white data-[state=active]:text-primary"><FileDown className="w-4 h-4" /> Relatórios</TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6 outline-none">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Dashboard de negócio</h2>
                <p className="text-sm text-gray-400">
                  Receita, procura, faltas e clientes a recuperar num só lugar.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select value={dashboardDays} onValueChange={setDashboardDays}>
                  <SelectTrigger className="h-11 border-white/10 bg-card text-white sm:w-[170px]">
                    <SelectValue placeholder="Período" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10 text-white">
                    <SelectItem value="7">Últimos 7 dias</SelectItem>
                    <SelectItem value="30">Últimos 30 dias</SelectItem>
                    <SelectItem value="90">Últimos 90 dias</SelectItem>
                  </SelectContent>
                </Select>
                {user.role === "admin" ? (
                  <Select value={dashboardBarberFilter} onValueChange={setDashboardBarberFilter}>
                    <SelectTrigger className="h-11 border-white/10 bg-card text-white sm:w-[190px]">
                      <SelectValue placeholder="Barbeiro" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-white/10 text-white">
                      <SelectItem value="all">Todos os barbeiros</SelectItem>
                      {barbers?.map((barber) => (
                        <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex h-11 items-center rounded-md border border-white/10 bg-card px-3 text-sm font-semibold text-primary">
                    {user.name}
                  </div>
                )}
              </div>
            </div>

            {isLoadingDashboard || !dashboardData ? (
              <Card className="border-white/10 bg-card text-white">
                <CardContent className="flex min-h-[320px] items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    {
                      label: "Receita concluída",
                      value: formatCents(dashboardData.summary.revenueCents),
                      detail: `${dashboardData.summary.completed} serviços concluídos`,
                      icon: Euro,
                      tone: "text-green-300",
                    },
                    {
                      label: "Receita em agenda",
                      value: formatCents(dashboardData.summary.projectedRevenueCents),
                      detail: `${dashboardData.summary.booked} marcações ativas`,
                      icon: TrendingUp,
                      tone: "text-primary",
                    },
                    {
                      label: "Taxa de conclusão",
                      value: `${dashboardData.summary.completionRate}%`,
                      detail: `${dashboardData.summary.appointments} marcações no período`,
                      icon: UserCheck,
                      tone: "text-blue-300",
                    },
                    {
                      label: "Risco operacional",
                      value: `${dashboardData.summary.noShowRate}%`,
                      detail: `${dashboardData.summary.noShows} faltas · ${dashboardData.summary.cancellations} cancelamentos`,
                      icon: AlertTriangle,
                      tone: "text-rose-300",
                    },
                  ].map((metric) => (
                    <Card key={metric.label} className="border-white/10 bg-card text-white">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-widest text-gray-500">{metric.label}</p>
                            <p className="mt-2 text-2xl font-bold">{metric.value}</p>
                          </div>
                          <metric.icon className={cn("mt-1 h-5 w-5", metric.tone)} />
                        </div>
                        <p className="mt-3 text-xs text-gray-400">{metric.detail}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
                  <Suspense
                    fallback={
                      <DashboardChartFallback
                        title="Evolução diária"
                        description="Marcações, serviços concluídos e receita por dia."
                        heightClassName="h-[280px]"
                      />
                    }
                  >
                    <DashboardChartCard variant="daily" daily={dashboardData.daily} formatCents={formatCents} />
                  </Suspense>

                  <Card className="border-white/10 bg-card text-white">
                    <CardHeader>
                      <CardTitle className="text-base font-bold">Sinais rápidos</CardTitle>
                      <p className="text-sm text-gray-400">Pontos que merecem ação nos próximos dias.</p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="rounded-lg border border-white/10 bg-background/60 p-3">
                        <p className="text-xs text-gray-500">Próximos 7 dias</p>
                        <p className="mt-1 text-xl font-bold">{dashboardData.summary.upcomingWeek} marcações</p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-background/60 p-3">
                        <p className="text-xs text-gray-500">Ticket médio concluído</p>
                        <p className="mt-1 text-xl font-bold">{formatCents(dashboardData.summary.averageTicketCents)}</p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-background/60 p-3">
                        <p className="text-xs text-gray-500">Hora com mais procura</p>
                        <p className="mt-1 text-xl font-bold">{dashboardData.summary.busiestHour || "Sem dados"}</p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-background/60 p-3">
                        <p className="text-xs text-gray-500">Clientes a recuperar</p>
                        <p className="mt-1 text-xl font-bold">{dashboardData.summary.inactiveCustomers}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                  <Suspense fallback={<DashboardChartFallback title="Desempenho por barbeiro" heightClassName="h-[260px]" />}>
                    <DashboardChartCard variant="barbers" barbers={dashboardData.barbers} formatCents={formatCents} />
                  </Suspense>

                  <Card className="border-white/10 bg-card text-white">
                    <CardHeader>
                      <CardTitle className="text-base font-bold">Serviços com mais procura</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {dashboardData.services.length === 0 ? (
                        <p className="py-8 text-center text-sm text-gray-500">Sem dados neste período.</p>
                      ) : (
                        dashboardData.services.map((service) => {
                          const maxCount = Math.max(...dashboardData.services.map((item) => item.count), 1);
                          return (
                            <div key={service.id} className="space-y-2">
                              <div className="flex items-center justify-between gap-3 text-sm">
                                <span className="font-medium text-white">{service.name}</span>
                                <span className="text-gray-400">{service.count} marcações · {formatCents(service.revenueCents)}</span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full rounded-full bg-primary"
                                  style={{ width: `${Math.max(8, (service.count / maxCount) * 100)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-white/10 bg-card text-white">
                  <CardHeader>
                    <CardTitle className="text-base font-bold">Clientes que podem voltar</CardTitle>
                    <p className="text-sm text-gray-400">Clientes concluídos sem nova marcação há mais de 45 dias.</p>
                  </CardHeader>
                  <CardContent>
                    {dashboardData.inactiveCustomers.length === 0 ? (
                      <p className="py-6 text-center text-sm text-gray-500">Sem clientes inativos para este filtro.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {dashboardData.inactiveCustomers.map((customer) => (
                          <div key={`${customer.phone}-${customer.email}`} className="rounded-lg border border-white/10 bg-background/60 p-3">
                            <p className="font-semibold text-white">{customer.name || "Cliente"}</p>
                            <p className="mt-1 text-xs text-gray-400">{customer.phone || customer.email}</p>
                            <p className="mt-3 text-xs text-gray-500">
                              Última visita há {customer.daysSinceLastVisit} dias · {customer.totalVisits} visitas
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="appointments" className="space-y-6 outline-none">
            <div className="flex flex-col sm:flex-row items-stretch gap-3 shrink-0 mb-6">
              {user.role === "admin" ? (
                <Select value={selectedBarberFilter} onValueChange={setSelectedBarberFilter}>
                  <SelectTrigger className="border-white/10 h-11 sm:h-9 bg-card w-full sm:w-[180px] text-white">
                    <SelectValue placeholder="Filtrar por Barbeiro" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10 text-white">
                    <SelectItem value="all">Todos os Barbeiros</SelectItem>
                    {barbers?.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center px-4 bg-card border border-white/10 rounded-md text-primary font-bold text-sm h-11 sm:h-9">
                  {user.name}
                </div>
              )}

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="border-white/10 gap-2 justify-start h-11 sm:h-9 text-white">
                    <CalendarIcon className="w-4 h-4" /> {format(selectedDateFilter, "dd 'de' MMMM", { locale: pt })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-card border-white/10" align="end">
                  <Calendar mode="single" selected={selectedDateFilter} onSelect={(d) => d && setSelectedDateFilter(d)} locale={pt} initialFocus />
                </PopoverContent>
              </Popover>

              <Dialog open={isBlocking} onOpenChange={setIsBlocking}>
                <DialogTrigger asChild><Button variant="gold" className="gap-2 h-11 sm:h-9 sm:ml-auto"><Plus className="w-4 h-4" /> Bloquear horário</Button></DialogTrigger>
                <DialogContent className="bg-card border-white/10 text-white w-[95vw] max-w-md max-h-[90vh] overflow-y-auto rounded-2xl p-6 shadow-2xl backdrop-blur-md">
                  <DialogHeader><DialogTitle className="text-xl font-display font-bold text-primary">Gestão de horário</DialogTitle></DialogHeader>
                  <div className="space-y-6">
                    <div className="flex flex-col gap-3 p-3 bg-primary/5 rounded-xl border border-primary/10">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" id="manualBooking" checked={blockData.isManualBooking} onChange={(e) => setBlockData({...blockData, isManualBooking: e.target.checked, isMultiDay: false})} className="w-4 h-4 rounded border-white/10 accent-primary" />
                        <Label htmlFor="manualBooking" className="text-sm font-medium cursor-pointer">Nova marcação (cliente ligou)</Label>
                      </div>
                      {!blockData.isManualBooking && (
                        <div className="flex items-center gap-2 pt-2 border-t border-primary/10">
                          <input type="checkbox" id="multiDay" checked={blockData.isMultiDay} onChange={(e) => setBlockData({...blockData, isMultiDay: e.target.checked, isManualBooking: false, isRecurring: false})} className="w-4 h-4 rounded border-white/10 accent-primary" />
                          <Label htmlFor="multiDay" className="text-sm font-medium cursor-pointer">Bloqueio de vários dias (férias/ausência)</Label>
                        </div>
                      )}
                      {blockData.isManualBooking && (
                        <div className="flex items-center gap-2 pt-2 border-t border-primary/10">
                          <input type="checkbox" id="recurring" checked={blockData.isRecurring} onChange={(e) => setBlockData({...blockData, isRecurring: e.target.checked, isMultiDay: false})} className="w-4 h-4 rounded border-white/10 accent-primary" />
                          <Label htmlFor="recurring" className="text-sm font-medium cursor-pointer">Marcação recorrente (repetir reserva)</Label>
                        </div>
                      )}
                    </div>
                    
                    {blockData.isRecurring && (
                      <div className="grid grid-cols-2 gap-4 p-4 bg-primary/5 rounded-xl border border-primary/10">
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-400">Repetir a cada (semanas)</Label>
                          <Select value={blockData.recurringWeeks} onValueChange={(v) => setBlockData({...blockData, recurringWeeks: v})}>
                            <SelectTrigger className="bg-background/50 border-white/10 h-10"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-card border-white/10 text-white">
                              <SelectItem value="1">1 semana</SelectItem>
                              <SelectItem value="2">2 semanas</SelectItem>
                              <SelectItem value="3">3 semanas</SelectItem>
                              <SelectItem value="4">4 semanas</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-400">Durante (meses)</Label>
                          <Select value={blockData.recurringMonths} onValueChange={(v) => setBlockData({...blockData, recurringMonths: v})}>
                            <SelectTrigger className="bg-background/50 border-white/10 h-10"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-card border-white/10 text-white">
                              <SelectItem value="1">1 mês</SelectItem>
                              <SelectItem value="3">3 meses</SelectItem>
                              <SelectItem value="6">6 meses</SelectItem>
                              <SelectItem value="12">1 ano</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <Label className="text-sm font-medium text-gray-300">{blockData.isMultiDay ? "Início" : "Data"}</Label>
                        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                          <PopoverTrigger asChild><Button variant="outline" className="w-full bg-background/50 border-white/10 h-12 rounded-xl justify-start gap-2 text-white"><CalendarIcon className="w-4 h-4" />{format(blockData.date, "dd/MM/yyyy")}</Button></PopoverTrigger>
                          <PopoverContent className="w-auto p-0 bg-card border-white/10"><Calendar mode="single" selected={blockData.date} onSelect={(d) => { if (d) { setBlockData({ ...blockData, date: d }); setIsCalendarOpen(false); } }} locale={pt} initialFocus /></PopoverContent>
                        </Popover>
                      </div>
                      {blockData.isMultiDay && (
                        <div className="space-y-3">
                          <Label className="text-sm font-medium text-gray-300">Fim</Label>
                          <Popover>
                            <PopoverTrigger asChild><Button variant="outline" className="w-full bg-background/50 border-white/10 h-12 rounded-xl justify-start gap-2 text-white"><CalendarIcon className="w-4 h-4" />{format(blockData.endDate, "dd/MM/yyyy")}</Button></PopoverTrigger>
                            <PopoverContent className="w-auto p-0 bg-card border-white/10"><Calendar mode="single" selected={blockData.endDate} onSelect={(d) => d && setBlockData({ ...blockData, endDate: d })} disabled={(d) => d < blockData.date} locale={pt} initialFocus /></PopoverContent>
                          </Popover>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <Label className="text-sm font-medium text-gray-300">Barbeiro</Label>
                        <Select onValueChange={(v) => setBlockData({...blockData, barberId: v})}>
                          <SelectTrigger className="bg-background/50 border-white/10 h-12 rounded-xl text-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent className="bg-card border-white/10 text-white">{barbers?.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      {blockData.isManualBooking && (
                        <div className="space-y-3">
                          <Label className="text-sm font-medium text-gray-300">Serviço</Label>
                          <Select onValueChange={(v) => setBlockData({...blockData, serviceId: v})}>
                            <SelectTrigger className="bg-background/50 border-white/10 h-12 rounded-xl text-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
                            <SelectContent className="bg-card border-white/10 text-white">{services?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-medium text-gray-300">Horários</Label>
                      <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1 scrollbar-thin">
                        {["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00", "19:30"].map((time) => {
                          const duration = blockData.isManualBooking && blockData.serviceId
                            ? services?.find((service) => String(service.id) === blockData.serviceId)?.duration ?? 30
                            : 30;
                          const isAvailable = isTimeAvailableForDay(blockData.date, time, duration, blockData.barberId);

                          return (
                            <Button
                              key={time}
                              variant={blockData.times.includes(time) ? "gold" : "outline"}
                              size="sm"
                              className="h-10 text-xs rounded-lg disabled:opacity-30"
                              disabled={!isAvailable}
                              onClick={() => setBlockData({
                                ...blockData,
                                times: blockData.times.includes(time)
                                  ? blockData.times.filter(t => t !== time)
                                  : [...blockData.times, time],
                              })}
                            >
                              {time}
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-3">
                          <Label className="text-sm font-medium text-gray-300">Nome do Cliente / Nota</Label>
                          <Input value={blockData.name} onChange={(e) => setBlockData({...blockData, name: e.target.value})} className="bg-background/50 border-white/10 h-12 rounded-xl text-white" placeholder="João" />
                        </div>
                        {blockData.isManualBooking && (
                          <div className="space-y-3">
                            <Label className="text-sm font-medium text-gray-300">Telemóvel</Label>
                            <Input value={blockData.phone} onChange={(e) => setBlockData({...blockData, phone: e.target.value})} className="bg-background/50 border-white/10 h-12 rounded-xl text-white" placeholder="912..." />
                          </div>
                        )}
                      </div>

                      <Button variant="gold" className="w-full h-12 text-base font-bold rounded-xl mt-4" onClick={handleBlockTime}>Confirmar</Button>
                    </div>
                  </DialogContent>
              </Dialog>
            </div>
            
            <div className="rounded-xl border border-white/10 bg-card p-4 md:p-5">
              {isLoadingAppointments ? <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div> : (
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-display font-bold text-white">Agenda do dia</h2>
                      <p className="text-xs text-gray-400 flex items-center gap-2 mt-1">
                        <Bell className="w-3.5 h-3.5 text-primary" />
                        Atualiza automaticamente a cada 10 segundos.
                      </p>
                    </div>
                    <span className="w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300">
                      {appointmentList.length} registos
                    </span>
                  </div>

                  {appointmentsByBarber.length === 0 ? (
                    <p className="text-center text-gray-500 py-10">Sem barbeiros para apresentar nesta vista.</p>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
                      {appointmentsByBarber.map(({ barber, appointments: barberAppointments }) => (
                        <div key={barber.id} className="rounded-2xl border border-white/10 bg-background/60 min-h-[220px]">
                          <div className="sticky top-0 z-10 rounded-t-2xl border-b border-white/10 bg-background/95 p-4 backdrop-blur">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <h3 className="font-bold text-white">{barber.name}</h3>
                                <p className="text-xs text-gray-500">{format(selectedDateFilter, "dd/MM/yyyy")}</p>
                              </div>
                              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                                {barberAppointments.length}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-3 p-3">
                            {barberAppointments.map((app) => (
                              <div
                                key={app.id}
                                className={cn(
                                  "rounded-2xl border border-white/10 bg-card p-3 shadow-sm transition-colors",
                                  app.status !== "booked" && "opacity-65",
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-2xl font-display font-bold text-primary">{format(parseISO(app.startTime), "HH:mm")}</p>
                                    <p className="text-sm font-semibold text-white">{app.customerName}</p>
                                  </div>
                                  <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", getStatusClass(app.status))}>
                                    {getStatusLabel(app.status)}
                                  </span>
                                </div>

                                <div className="mt-3 space-y-1 text-xs text-gray-400">
                                  <p>{getServiceName(app.serviceId)}</p>
                                  {app.customerPhone && <p>{app.customerPhone}</p>}
                                  {app.depositRequired && (
                                    <p className="rounded-lg border border-primary/20 bg-primary/10 px-2 py-1 text-primary">
                                      Depósito recomendado: {app.depositReason || "regra operacional"}
                                    </p>
                                  )}
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Button size="sm" variant="outline" onClick={() => openCustomerHistory(app)} className="h-8 border-white/10 text-xs">
                                    <User className="mr-1 h-3.5 w-3.5" /> Histórico
                                  </Button>

                                  {app.status === "booked" && (
                                    <>
                                      <Button size="sm" variant="ghost" onClick={() => handleStatusChange(app.id, "completed")} className="h-8 text-xs text-green-300 hover:text-green-200">
                                        <CheckCircle className="mr-1 h-3.5 w-3.5" /> Feita
                                      </Button>
                                      <Button size="sm" variant="ghost" onClick={() => handleStatusChange(app.id, "no_show")} className="h-8 text-xs text-rose-300 hover:text-rose-200">
                                        Falta
                                      </Button>
                                      <Button size="sm" variant="ghost" onClick={() => handleStatusChange(app.id, "cancelled")} className="h-8 text-xs text-red-300 hover:text-red-200">
                                        <XCircle className="mr-1 h-3.5 w-3.5" /> Cancelar
                                      </Button>
                                      <ConfirmAction
                                        title="Bloquear cliente?"
                                        description={`${app.customerName} (${app.customerPhone}) deixa de conseguir fazer marcações online.`}
                                        confirmLabel="Bloquear"
                                        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        onConfirm={async () => {
                                          await apiRequest("POST", "/api/admin/blacklist", { phone: app.customerPhone, email: app.customerEmail, reason: `Faltou à marcação de ${format(parseISO(app.startTime), "dd/MM/yyyy HH:mm")}` });
                                          toast({ title: "Sucesso", description: "Cliente adicionado à lista de bloqueio." });
                                          queryClient.invalidateQueries({ queryKey: ["/api/admin/blacklist"] });
                                        }}
                                      >
                                        <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive hover:text-red-300" title="Adicionar à lista de bloqueio">
                                          Bloquear
                                        </Button>
                                      </ConfirmAction>
                                      <Dialog>
                                        <DialogTrigger asChild>
                                          <Button size="sm" variant="ghost" className="h-8 text-xs text-primary hover:text-primary/80">
                                            <Settings className="mr-1 h-3.5 w-3.5" /> Editar
                                          </Button>
                                        </DialogTrigger>
                                        <DialogContent className="bg-card border-white/10 text-white">
                                          <DialogHeader><DialogTitle>Editar marcação</DialogTitle></DialogHeader>
                                          <div className="space-y-4 pt-4">
                                            <div className="grid grid-cols-2 gap-4">
                                              <div className="space-y-2">
                                                <Label>Data</Label>
                                                <Input type="date" defaultValue={format(parseISO(app.startTime), "yyyy-MM-dd")} id={`edit-app-date-${app.id}`} className="bg-background border-white/10 text-white" />
                                              </div>
                                              <div className="space-y-2">
                                                <Label>Hora</Label>
                                                <Input type="time" defaultValue={format(parseISO(app.startTime), "HH:mm")} id={`edit-app-time-${app.id}`} className="bg-background border-white/10 text-white" />
                                              </div>
                                            </div>
                                            <div className="space-y-2">
                                              <Label>Barbeiro</Label>
                                              <Select defaultValue={String(app.barberId)} onValueChange={(v) => {
                                                const el = document.getElementById(`edit-app-barber-val-${app.id}`);
                                                if (el) el.setAttribute('data-value', v);
                                              }}>
                                                <SelectTrigger className="bg-background border-white/10 text-white"><SelectValue /></SelectTrigger>
                                                <SelectContent className="bg-card border-white/10 text-white">
                                                  {barbers?.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                                                </SelectContent>
                                              </Select>
                                              <input type="hidden" id={`edit-app-barber-val-${app.id}`} data-value={String(app.barberId)} />
                                            </div>
                                            <Button variant="gold" className="w-full" onClick={async () => {
                                              const dateVal = (document.getElementById(`edit-app-date-${app.id}`) as HTMLInputElement).value;
                                              const timeVal = (document.getElementById(`edit-app-time-${app.id}`) as HTMLInputElement).value;
                                              const barberId = (document.getElementById(`edit-app-barber-val-${app.id}`) as HTMLInputElement).getAttribute('data-value') || String(app.barberId);
                                              const newStartTime = new Date(`${dateVal}T${timeVal}`);
                                              await apiRequest("PATCH", `/api/appointments/${app.id}`, { startTime: newStartTime, barberId: Number(barberId) });
                                              queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
                                              toast({ title: "Sucesso", description: "Marcação atualizada." });
                                            }}>Guardar alterações</Button>
                                          </div>
                                        </DialogContent>
                                      </Dialog>
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}

                            {barberAppointments.length === 0 && (
                              <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-gray-500">
                                Sem marcações neste dia.
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="barbers" className="outline-none">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white">Equipa de Barbeiros</h2>
              <Dialog open={isAddingBarber} onOpenChange={setIsAddingBarber}>
                <DialogTrigger asChild>
                  <Button variant="gold" className="gap-2">
                    <Plus className="w-4 h-4" /> Adicionar Barbeiro
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-card border-white/10 text-white">
                  <DialogHeader>
                    <DialogTitle>Adicionar Membro à Equipa</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div>
                      <Label>Nome *</Label>
                      <Input 
                        value={barberFormData.name} 
                        onChange={e => setBarberFormData({...barberFormData, name: e.target.value})} 
                        className="bg-background border-white/10 text-white" 
                        required
                      />
                    </div>
                    <div>
                      <Label>Especialidade *</Label>
                      <Input 
                        value={barberFormData.specialty} 
                        onChange={e => setBarberFormData({...barberFormData, specialty: e.target.value})} 
                        className="bg-background border-white/10 text-white" 
                        required
                      />
                    </div>
                    <div>
                      <Label>Email (para login)</Label>
                      <Input 
                        type="email"
                        value={barberFormData.email} 
                        onChange={e => setBarberFormData({...barberFormData, email: e.target.value})} 
                        className="bg-background border-white/10 text-white" 
                      />
                    </div>
                    <div>
                      <Label>Bio</Label>
                      <Input 
                        value={barberFormData.bio} 
                        onChange={e => setBarberFormData({...barberFormData, bio: e.target.value})} 
                        className="bg-background border-white/10 text-white" 
                      />
                    </div>
                    <Button 
                      variant="gold" 
                      className="w-full" 
                      onClick={handleAddBarber}
                    >
                      Criar Barbeiro
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {barbers?.map(barber => (
                <Card key={barber.id} className="bg-card border-white/10 overflow-hidden text-white">
                  <div className="aspect-square bg-muted relative">
                    <img src={barber.avatar || "/images/logo.jpg"} className="w-full h-full object-cover" />
                    <ConfirmAction
                      title={`Remover ${barber.name}?`}
                      description="O barbeiro só será removido se não tiver marcações associadas."
                      confirmLabel="Remover"
                      confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onConfirm={async () => {
                        try {
                          await apiRequest("DELETE", `/api/barbers/${barber.id}`);
                          queryClient.invalidateQueries({ queryKey: ["/api/barbers"] });
                          toast({ title: "Sucesso", description: "Barbeiro removido." });
                        } catch (err: any) {
                          toast({ title: "Erro", description: err.message || "Não foi possível remover o barbeiro.", variant: "destructive" });
                        }
                      }}
                    >
                      <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-8 w-8">
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </ConfirmAction>
                  </div>
                  <CardContent className="p-4">
                    <h3 className="font-bold text-lg">{barber.name}</h3>
                    <p className="text-sm text-primary mb-2">{barber.specialty}</p>
                    <div className="flex flex-wrap gap-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="flex-1 h-8 text-xs">Editar</Button>
                        </DialogTrigger>
                        <DialogContent className="bg-card border-white/10 text-white">
                          <DialogHeader><DialogTitle>Editar Barbeiro</DialogTitle></DialogHeader>
                          <div className="space-y-4 pt-4">
                            <div><Label>Nome</Label><Input defaultValue={barber.name} id={`edit-barber-name-${barber.id}`} className="bg-background border-white/10" /></div>
                            <div><Label>Especialidade</Label><Input defaultValue={barber.specialty} id={`edit-barber-spec-${barber.id}`} className="bg-background border-white/10" /></div>
                            <Button variant="gold" className="w-full" onClick={async () => {
                              const name = (document.getElementById(`edit-barber-name-${barber.id}`) as HTMLInputElement).value;
                              const specialty = (document.getElementById(`edit-barber-spec-${barber.id}`) as HTMLInputElement).value;
                              await apiRequest("PATCH", `/api/barbers/${barber.id}`, { name, specialty });
                              queryClient.invalidateQueries({ queryKey: ["/api/barbers"] });
                              toast({ title: "Sucesso", description: "Barbeiro atualizado." });
                            }}>Guardar</Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-xs"
                        onClick={() => openAvailabilityEditor(barber)}
                      >
                        Horários
                      </Button>
                      <ConfirmAction
                        title={`Criar convite para ${barber.name}?`}
                        description="A palavra-passe atual deixa de funcionar até o barbeiro aceitar o novo convite."
                        confirmLabel="Criar convite"
                        confirmClassName="bg-primary text-primary-foreground hover:bg-primary/90"
                        onConfirm={() => handleCreateBarberInvite(barber)}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 h-8 text-[10px] border-red-500/20 text-red-400 hover:bg-red-500/10"
                        >
                          <Copy className="mr-1 h-3 w-3" /> Convite
                        </Button>
                      </ConfirmAction>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-[10px] text-gray-400 border-white/5"
                        onClick={async () => {
                          try {
                            await apiRequest("PATCH", `/api/barbers/${barber.id}`, { isVisible: !barber.isVisible });
                            queryClient.invalidateQueries({ queryKey: ["/api/barbers"] });
                            toast({
                              title: "Sucesso",
                              description: barber.isVisible ? "Barbeiro ocultado." : "Barbeiro visível no site.",
                            });
                          } catch (err: any) {
                            toast({
                              title: "Erro",
                              description: err.message || "Não foi possível atualizar a visibilidade do barbeiro.",
                              variant: "destructive",
                            });
                          }
                        }}
                      >
                        {barber.isVisible ? "Visível" : "Oculto"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="blacklist" className="outline-none">
            <Card className="bg-card border-white/10 text-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-400">
                  <User className="w-5 h-5" /> Clientes Bloqueados
                </CardTitle>
                <p className="text-sm text-gray-400">Clientes nesta lista não conseguirão fazer marcações online através do site.</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-white/5 rounded-xl border border-white/10">
                    <div className="space-y-2">
                      <Label className="text-xs">Telemóvel (obrigatório)</Label>
                      <Input id="bl-phone" className="bg-background border-white/10" placeholder="912345678" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Email (opcional)</Label>
                      <Input id="bl-email" className="bg-background border-white/10" placeholder="cliente@email.com" />
                    </div>
                    <div className="flex items-end">
                      <Button variant="destructive" className="w-full" onClick={async () => {
                        const phone = (document.getElementById("bl-phone") as HTMLInputElement).value;
                        const email = (document.getElementById("bl-email") as HTMLInputElement).value;
                        if (!phone) { toast({ title: "Erro", description: "O telemóvel é obrigatório.", variant: "destructive" }); return; }
                        await apiRequest("POST", "/api/admin/blacklist", { phone, email, reason: "Bloqueio manual pelo administrador" });
                        queryClient.invalidateQueries({ queryKey: ["/api/admin/blacklist"] });
                        (document.getElementById("bl-phone") as HTMLInputElement).value = "";
                        (document.getElementById("bl-email") as HTMLInputElement).value = "";
                        toast({ title: "Sucesso", description: "Cliente adicionado à lista de bloqueio." });
                      }}>Bloquear Cliente</Button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-white/5 uppercase text-xs font-bold text-gray-400">
                        <tr>
                          <th className="px-6 py-4">Telemóvel</th>
                          <th className="px-6 py-4">Email</th>
                          <th className="px-6 py-4">Data do bloqueio</th>
                          <th className="px-6 py-4 text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {blacklistEntries?.map((entry: any) => (
                          <tr key={entry.id} className="hover:bg-white/5">
                            <td className="px-6 py-4 font-mono">{entry.phone}</td>
                            <td className="px-6 py-4">{entry.email || "-"}</td>
                            <td className="px-6 py-4 text-gray-400">{format(parseISO(entry.createdAt), "dd/MM/yyyy")}</td>
                            <td className="px-6 py-4 text-right">
                              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white" onClick={async () => {
                                try {
                                  await apiRequest("DELETE", `/api/admin/blacklist/${entry.id}`);
                                  queryClient.invalidateQueries({ queryKey: ["/api/admin/blacklist"] });
                                  toast({ title: "Sucesso", description: "Cliente removido da lista de bloqueio." });
                                } catch (err: any) {
                                  toast({ title: "Erro", description: err.message || "Não foi possível remover o cliente da lista de bloqueio.", variant: "destructive" });
                                }
                              }}>Remover</Button>
                            </td>
                          </tr>
                        ))}
                        {(!blacklistEntries || blacklistEntries.length === 0) && (
                          <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-500 italic">Nenhum cliente bloqueado.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="services" className="outline-none">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <h2 className="text-xl font-bold text-white">Serviços Disponíveis</h2>
              <Dialog open={isAddingService} onOpenChange={setIsAddingService}>
                <DialogTrigger asChild>
                  <Button variant="gold" className="gap-2">
                    <Plus className="w-4 h-4" /> Adicionar Serviço
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-card border-white/10 text-white">
                  <DialogHeader>
                    <DialogTitle>Novo Serviço</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div>
                      <Label>Nome *</Label>
                      <Input 
                        value={serviceFormData.name} 
                        onChange={e => setServiceFormData({...serviceFormData, name: e.target.value})} 
                        className="bg-background border-white/10 text-white" 
                        required
                      />
                    </div>
                    <div>
                      <Label>Descrição</Label>
                      <Input 
                        value={serviceFormData.description} 
                        onChange={e => setServiceFormData({...serviceFormData, description: e.target.value})} 
                        className="bg-background border-white/10 text-white" 
                      />
                    </div>
                    <div>
                      <Label>Preço (€) *</Label>
                      <Input 
                        type="number" 
                        step="0.01" 
                        value={serviceFormData.price / 100} 
                        onChange={e => setServiceFormData({...serviceFormData, price: Math.round(Number(e.target.value) * 100)})} 
                        className="bg-background border-white/10 text-white" 
                        required
                      />
                    </div>
                    <div>
                      <Label>Duração (Min) *</Label>
                      <Input 
                        type="number" 
                        value={serviceFormData.duration} 
                        onChange={e => setServiceFormData({...serviceFormData, duration: Number(e.target.value)})} 
                        className="bg-background border-white/10 text-white" 
                        required
                      />
                    </div>
                    <Button 
                      variant="gold" 
                      className="w-full" 
                      onClick={handleAddService}
                    >
                      Criar Serviço
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services?.map(service => (
                <Card key={service.id} className="bg-card border-white/10 text-white">
                  <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-lg font-bold">{service.name}</CardTitle><span className="text-primary font-bold">{(service.price / 100).toFixed(2)}€</span></CardHeader>
                  <CardContent><p className="text-sm text-gray-400 mb-4">{service.duration} min</p>
                    <div className="flex flex-wrap gap-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="flex-1 h-8 text-xs">Editar</Button>
                        </DialogTrigger>
                        <DialogContent className="bg-card border-white/10 text-white">
                          <DialogHeader><DialogTitle>Editar Serviço</DialogTitle></DialogHeader>
                          <div className="space-y-4 pt-4">
                            <div><Label>Nome</Label><Input defaultValue={service.name} id={`edit-service-name-${service.id}`} className="bg-background border-white/10" /></div>
                            <div><Label>Preço (€)</Label><Input type="number" step="0.01" defaultValue={service.price / 100} id={`edit-service-price-${service.id}`} className="bg-background border-white/10" /></div>
                            <div><Label>Duração (Min)</Label><Input type="number" defaultValue={service.duration} id={`edit-service-dur-${service.id}`} className="bg-background border-white/10" /></div>
                            <Button variant="gold" className="w-full" onClick={async () => {
                              const name = (document.getElementById(`edit-service-name-${service.id}`) as HTMLInputElement).value;
                              const price = Math.round(Number((document.getElementById(`edit-service-price-${service.id}`) as HTMLInputElement).value) * 100);
                              const duration = Number((document.getElementById(`edit-service-dur-${service.id}`) as HTMLInputElement).value);
                              await apiRequest("PATCH", `/api/services/${service.id}`, { name, price, duration });
                              queryClient.invalidateQueries({ queryKey: ["/api/services"] });
                              toast({ title: "Sucesso", description: "Serviço atualizado." });
                            }}>Guardar</Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                      <ConfirmAction
                        title={`Remover ${service.name}?`}
                        description="As marcações antigas ficam guardadas, mas este serviço deixa de estar disponível."
                        confirmLabel="Remover"
                        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onConfirm={async () => {
                          try {
                            await apiRequest("DELETE", `/api/services/${service.id}`);
                            queryClient.invalidateQueries({ queryKey: ["/api/services"] });
                            toast({ title: "Sucesso", description: "Serviço removido." });
                          } catch {
                            toast({ title: "Erro", description: "Não foi possível remover o serviço. Verifique se existem marcações associadas.", variant: "destructive" });
                          }
                        }}
                      >
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-400">
                          Remover
                        </Button>
                      </ConfirmAction>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-[10px] text-gray-400 border-white/5"
                        onClick={async () => {
                          try {
                            await apiRequest("PATCH", `/api/services/${service.id}`, { isVisible: !service.isVisible });
                            queryClient.invalidateQueries({ queryKey: ["/api/services"] });
                            toast({
                              title: "Sucesso",
                              description: service.isVisible ? "Serviço ocultado." : "Serviço visível no site.",
                            });
                          } catch (err: any) {
                            toast({
                              title: "Erro",
                              description: err.message || "Não foi possível atualizar a visibilidade do serviço.",
                              variant: "destructive",
                            });
                          }
                        }}
                      >
                        {service.isVisible ? "Visível" : "Oculto"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="reports" className="outline-none">
            <Card className="bg-card border-white/10 max-w-2xl mx-auto">
              <CardHeader>
                <CardTitle className="text-xl font-display font-bold text-primary">Exportar Relatório Excel</CardTitle>
                <p className="text-gray-400 text-sm">Gere um ficheiro .xlsx com o resumo e detalhes das marcações concluídas.</p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-white">Data Início</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start border-white/10 bg-background text-white h-11">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {format(exportDates.start, "dd/MM/yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 bg-card border-white/10">
                        <Calendar mode="single" selected={exportDates.start} onSelect={(d) => d && setExportDates({...exportDates, start: d})} locale={pt} initialFocus />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white">Data Fim</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start border-white/10 bg-background text-white h-11">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {format(exportDates.end, "dd/MM/yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 bg-card border-white/10">
                        <Calendar mode="single" selected={exportDates.end} onSelect={(d) => d && setExportDates({...exportDates, end: d})} locale={pt} initialFocus />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-white">Barbeiro</Label>
                  <Select value={exportDates.barberId} onValueChange={(v) => setExportDates({...exportDates, barberId: v})}>
                    <SelectTrigger className="border-white/10 bg-background text-white h-11">
                      <SelectValue placeholder="Selecione o barbeiro" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-white/10 text-white">
                      <SelectItem value="all">Todos os Barbeiros</SelectItem>
                      {barbers?.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <Button variant="gold" className="w-full h-12 text-base font-bold gap-2" onClick={handleExport} disabled={isExporting}>
                  {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileDown className="w-5 h-5" />}
                  Gerar Relatório Excel
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
