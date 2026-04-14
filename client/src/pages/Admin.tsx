import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAppointments, useUpdateAppointmentStatus, useCreateAppointment } from "@/hooks/use-appointments";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, startOfToday, subDays } from "date-fns";
import { pt } from "date-fns/locale";
import { Loader2, CheckCircle, XCircle, Plus, Calendar as CalendarIcon, Clock, User, LogOut, Scissors, Settings, Users, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { useBarbers } from "@/hooks/use-barbers";
import { useServices } from "@/hooks/use-services";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function Admin() {
  const [user, setUser] = useState<{ authorized: boolean; role: string; name?: string } | null>(null);
  const [activeTab, setActiveTab] = useState("appointments");
  const [isAddingBarber, setIsAddingBarber] = useState(false);
  const [isAddingService, setIsAddingService] = useState(false);
  const [barberFormData, setBarberFormData] = useState({ name: "", specialty: "", bio: "", avatar: "", email: "" });
  const [serviceFormData, setServiceFormData] = useState({ name: "", description: "", price: 0, duration: 30 });

  const [selectedDateFilter, setSelectedDateFilter] = useState<Date>(startOfToday());
  const [selectedBarberFilter, setSelectedBarberFilter] = useState<string>("all");
  const { data: appointments, isLoading: isLoadingAppointments, refetch } = useAppointments({ 
    date: format(selectedDateFilter, 'yyyy-MM-dd'),
    barberId: user?.role === "barber" ? (user as any).id : (selectedBarberFilter === "all" ? undefined : selectedBarberFilter)
  } as any);
  const { data: barbers } = useBarbers();
  const { data: services } = useServices();
  const { data: blacklistEntries } = useQuery({ 
    queryKey: ["/api/admin/blacklist"],
    enabled: user?.role === "admin"
  });
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
      window.open(url, '_blank');
      toast({ title: "Sucesso", description: "O relatório está a ser gerado." });
    } catch (err) {
      toast({ title: "Erro", description: "Falha ao gerar o relatório.", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/admin/me");
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
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginData),
      });
      if (res.ok) {
        const data = await res.json();
        setUser({ authorized: true, role: data.role });
        toast({ title: "Bem-vindo", description: data.message });
      } else {
        toast({ title: "Erro", description: "Utilizador ou senha incorretos.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro", description: "Erro ao tentar fazer login.", variant: "destructive" });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    setUser({ authorized: false, role: "" });
  };

  const getBarberName = (id: number) => barbers?.find(b => b.id === id)?.name || "Desconhecido";
  const getServiceName = (id: number) => services?.find(s => s.id === id)?.name || "Desconhecido";

  useEffect(() => {
    checkAuth();
  }, []);

  const isDayClosed = (date: Date) => {
    const day = date.getDay();
    return day === 0;
  };

  const isTimeAvailableForDay = (date: Date, timeStr: string) => {
    const day = date.getDay();
    const [hours] = timeStr.split(':').map(Number);
    if (day === 0) return false;
    if (day === 1) return hours >= 14 && hours < 20;
    if (day >= 2 && day <= 5) return (hours >= 9 && hours < 13) || (hours >= 14 && hours < 20);
    if (day === 6) return (hours >= 9 && hours < 13) || (hours >= 14 && hours < 19);
    return false;
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
              <p className="text-[10px] text-gray-500 text-center">No primeiro acesso, use o seu email e a password que deseja definir.</p>
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
            <p className="text-gray-400 text-sm">Gerencie marcações, equipa e serviços.</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-card border border-white/10 p-1">
            <TabsTrigger value="appointments" className="gap-2 text-white data-[state=active]:text-primary"><Clock className="w-4 h-4" /> Marcações</TabsTrigger>
            {user.role === "admin" && (
              <>
                <TabsTrigger value="barbers" className="gap-2 text-white data-[state=active]:text-primary"><Users className="w-4 h-4" /> Equipa</TabsTrigger>
                <TabsTrigger value="services" className="gap-2 text-white data-[state=active]:text-primary"><Scissors className="w-4 h-4" /> Serviços</TabsTrigger>
                <TabsTrigger value="blacklist" className="gap-2 text-white data-[state=active]:text-primary"><User className="w-4 h-4 text-red-400" /> Blacklist</TabsTrigger>
                <TabsTrigger value="reports" className="gap-2 text-white data-[state=active]:text-primary"><FileDown className="w-4 h-4" /> Relatórios</TabsTrigger>
              </>
            )}
          </TabsList>

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
                <DialogTrigger asChild><Button variant="gold" className="gap-2 h-11 sm:h-9 ml-auto"><Plus className="w-4 h-4" /> Bloquear Horário</Button></DialogTrigger>
                <DialogContent className="bg-card border-white/10 text-white w-[95vw] max-w-md rounded-2xl p-6 shadow-2xl backdrop-blur-md">
                  <DialogHeader><DialogTitle className="text-xl font-display font-bold text-primary">Gestão de Horário</DialogTitle></DialogHeader>
                  <div className="space-y-6">
                    <div className="flex flex-col gap-3 p-3 bg-primary/5 rounded-xl border border-primary/10">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" id="manualBooking" checked={blockData.isManualBooking} onChange={(e) => setBlockData({...blockData, isManualBooking: e.target.checked, isMultiDay: false})} className="w-4 h-4 rounded border-white/10 accent-primary" />
                        <Label htmlFor="manualBooking" className="text-sm font-medium cursor-pointer">Nova Marcação (Cliente ligou)</Label>
                      </div>
                      {!blockData.isManualBooking && (
                        <div className="flex items-center gap-2 pt-2 border-t border-primary/10">
                          <input type="checkbox" id="multiDay" checked={blockData.isMultiDay} onChange={(e) => setBlockData({...blockData, isMultiDay: e.target.checked, isManualBooking: false, isRecurring: false})} className="w-4 h-4 rounded border-white/10 accent-primary" />
                          <Label htmlFor="multiDay" className="text-sm font-medium cursor-pointer">Bloqueio de vários dias (Férias/Ausência)</Label>
                        </div>
                      )}
                      {blockData.isManualBooking && (
                        <div className="flex items-center gap-2 pt-2 border-t border-primary/10">
                          <input type="checkbox" id="recurring" checked={blockData.isRecurring} onChange={(e) => setBlockData({...blockData, isRecurring: e.target.checked, isMultiDay: false})} className="w-4 h-4 rounded border-white/10 accent-primary" />
                          <Label htmlFor="recurring" className="text-sm font-medium cursor-pointer">Marcação Recorrente (Repetir reserva)</Label>
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
                        {["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00", "19:30"].map((time) => (
                          <Button key={time} variant={blockData.times.includes(time) ? "gold" : "outline"} size="sm" className="h-10 text-xs rounded-lg" onClick={() => setBlockData({ ...blockData, times: blockData.times.includes(time) ? blockData.times.filter(t => t !== time) : [...blockData.times, time] })}>{time}</Button>
                        ))}
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
            
            <div className="rounded-xl border border-white/10 overflow-hidden bg-card">
              {isLoadingAppointments ? <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div> : (
                <div className="overflow-x-auto"><table className="w-full text-left text-sm text-white">
                  <thead className="bg-white/5 uppercase text-xs font-bold text-gray-400"><tr><th className="px-6 py-4">Hora</th><th className="px-6 py-4">Cliente</th><th className="px-6 py-4">Serviço</th><th className="px-6 py-4">Profissional</th><th className="px-6 py-4">Estado</th><th className="px-6 py-4 text-right">Ações</th></tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {appointments?.map((app: any) => (
                      <tr key={app.id} className={cn("hover:bg-white/5 transition-colors", app.status === 'cancelled' && "opacity-40")}>
                        <td className="px-6 py-4 text-primary font-bold">{format(parseISO(app.startTime as string), "HH:mm")}</td>
                        <td className="px-6 py-4">{app.customerName}</td>
                        <td className="px-6 py-4">{getServiceName(app.serviceId)}</td>
                        <td className="px-6 py-4">{getBarberName(app.barberId)}</td>
                        <td className="px-6 py-4"><span className={cn("px-2 py-0.5 rounded-full text-[10px] border", app.status === 'booked' ? 'text-blue-400 border-blue-400/20' : app.status === 'completed' ? 'text-green-400 border-green-400/20' : 'text-red-400 border-red-400/20')}>{app.status}</span></td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            {app.status === 'booked' && (
                              <div className="flex gap-2">
                                <Button size="icon" variant="ghost" onClick={() => updateStatus.mutate({ id: app.id, status: 'cancelled' })} className="text-red-500 hover:text-red-400 h-8 w-8" title="Cancelar Marcação"><XCircle className="w-4 h-4" /></Button>
                                <Button size="icon" variant="ghost" className="text-destructive hover:text-red-400 h-8 w-8" title="Adicionar à Blacklist" onClick={async () => {
                                  if (confirm(`Deseja bloquear ${app.customerName} (${app.customerPhone})? Ele não conseguirá marcar mais online.`)) {
                                    await apiRequest("POST", "/api/admin/blacklist", { phone: app.customerPhone, email: app.customerEmail, reason: `Faltou à marcação de ${format(parseISO(app.startTime), "dd/MM/yyyy HH:mm")}` });
                                    toast({ title: "Sucesso", description: "Cliente adicionado à blacklist." });
                                    queryClient.invalidateQueries({ queryKey: ["/api/admin/blacklist"] });
                                  }
                                }}><User className="w-4 h-4 text-red-500" /></Button>
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button size="icon" variant="ghost" className="text-primary hover:text-primary/80 h-8 w-8"><Settings className="w-4 h-4" /></Button>
                                  </DialogTrigger>
                                  <DialogContent className="bg-card border-white/10 text-white">
                                    <DialogHeader><DialogTitle>Editar Marcação</DialogTitle></DialogHeader>
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
                                      }}>Guardar Alterações</Button>
                                    </div>
                                  </DialogContent>
                                </Dialog>
                              </div>
                            )}
                            {(app.customerName === "BLOQUEIO MANUAL" || app.customerName.includes("AUSÊNCIA") || app.customerName.includes("FÉRIAS")) && (
                              <Button size="icon" variant="ghost" onClick={() => updateStatus.mutate({ id: app.id, status: 'cancelled' })} className="text-gray-400 hover:text-white h-8 w-8" title="Remover Bloqueio">
                                <LogOut className="w-4 h-4 rotate-180" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
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
                    <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-8 w-8" onClick={async () => { if (confirm(`Remover ${barber.name}?`)) { await apiRequest("DELETE", `/api/barbers/${barber.id}`); queryClient.invalidateQueries({ queryKey: ["/api/barbers"] }); } }}><XCircle className="w-4 h-4" /></Button>
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
                        className="flex-1 h-8 text-[10px] border-red-500/20 text-red-400 hover:bg-red-500/10"
                        onClick={async () => {
                          if (confirm(`Deseja repor a password de ${barber.name}? No próximo login ele terá de definir uma nova.`)) {
                            await apiRequest("PATCH", `/api/barbers/${barber.id}/reset-password`, {});
                            toast({ title: "Sucesso", description: "Password removida. O barbeiro já pode definir uma nova no próximo login." });
                          }
                        }}
                      >
                        Repor Pass
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-[10px] text-gray-400 border-white/5">
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
                      <Label className="text-xs">Telemóvel (Obrigatório)</Label>
                      <Input id="bl-phone" className="bg-background border-white/10" placeholder="912345678" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Email (Opcional)</Label>
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
                        toast({ title: "Sucesso", description: "Cliente adicionado à blacklist." });
                      }}>Bloquear Cliente</Button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-white/5 uppercase text-xs font-bold text-gray-400">
                        <tr>
                          <th className="px-6 py-4">Telemóvel</th>
                          <th className="px-6 py-4">Email</th>
                          <th className="px-6 py-4">Data Bloqueio</th>
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
                                await apiRequest("DELETE", `/api/admin/blacklist/${entry.id}`);
                                queryClient.invalidateQueries({ queryKey: ["/api/admin/blacklist"] });
                                toast({ title: "Sucesso", description: "Cliente removido da blacklist." });
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
            <div className="flex justify-between items-center mb-6">
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
                    <div className="flex gap-2">
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
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-400" onClick={async () => { if (confirm(`Remover ${service.name}?`)) { try { await apiRequest("DELETE", `/api/services/${service.id}`); queryClient.invalidateQueries({ queryKey: ["/api/services"] }); toast({ title: "Sucesso", description: "Serviço removido." }); } catch (e) { toast({ title: "Erro", description: "Não foi possível remover o serviço. Verifique se existem marcações associadas.", variant: "destructive" }); } } }}>Remover</Button>
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
