import { type Dispatch, type SetStateAction } from "react";
import { format, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import { AlertTriangle, Bell, Calendar as CalendarIcon, Loader2, Plus, User } from "lucide-react";
import { type AppointmentStatus } from "@/hooks/use-appointments";
import { Button } from "@/components/ui/button-custom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AppointmentDaySummary } from "@/components/admin/AppointmentDaySummary";
import type { WeeklyAgendaAppointment } from "@/components/admin/WeeklyAgenda";

export type AppointmentStatusFilter = AppointmentStatus | "all";
export type AppointmentViewMode = "day" | "upcoming";

export type AppointmentBlockData = {
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
};

type AppointmentsTabUser = {
  role: "" | "admin" | "barber";
  name?: string;
};

type AppointmentBarberOption = {
  id: number;
  name: string;
};

type AppointmentServiceOption = {
  id: number;
  name: string;
};

type DayAppointmentSummary = {
  total: number;
  booked: number;
  completed: number;
  risk: number;
};

type AppointmentsTabProps = {
  user: AppointmentsTabUser;
  barbers?: AppointmentBarberOption[];
  manualBookingServices: AppointmentServiceOption[];
  appointmentList: WeeklyAgendaAppointment[];
  filteredAppointmentList: WeeklyAgendaAppointment[];
  appointmentViewMode: AppointmentViewMode;
  onAppointmentViewModeChange: (mode: AppointmentViewMode) => void;
  selectedDateFilter: Date;
  onSelectedDateFilterChange: (date: Date) => void;
  selectedBarberFilter: string;
  onSelectedBarberFilterChange: (barberId: string) => void;
  selectedStatusFilter: AppointmentStatusFilter;
  onSelectedStatusFilterChange: (status: AppointmentStatusFilter) => void;
  isLoadingAppointments: boolean;
  isBlocking: boolean;
  onBlockingChange: (open: boolean) => void;
  blockData: AppointmentBlockData;
  onBlockDataChange: Dispatch<SetStateAction<AppointmentBlockData>>;
  isCalendarOpen: boolean;
  onCalendarOpenChange: (open: boolean) => void;
  availableBlockTimes: string[];
  dayAppointmentSummary: DayAppointmentSummary;
  onOpenAgendaException: () => void;
  onOpenManualBooking: () => void;
  onBlockTime: () => void;
  onSelectAppointment: (appointment: WeeklyAgendaAppointment) => void;
  getBarberName: (id: number) => string;
  getServiceName: (id?: number | null) => string;
  getStatusLabel: (status: string) => string;
  getStatusClass: (status: string) => string;
};

export const blockTimeOptions = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30",
  "18:00", "18:30", "19:00", "19:30",
];

const morningBlockTimes = blockTimeOptions.filter((time) => time < "13:00");
const afternoonBlockTimes = blockTimeOptions.filter((time) => time >= "14:00");

const appointmentStatusFilterOptions: Array<{ value: AppointmentStatusFilter; label: string }> = [
  { value: "all", label: "Todos os estados" },
  { value: "booked", label: "Marcadas" },
  { value: "completed", label: "Concluídas" },
  { value: "cancelled", label: "Canceladas" },
  { value: "late_cancelled", label: "Cancelamentos tardios" },
  { value: "no_show", label: "Faltas" },
];

export function AppointmentsTab({
  user,
  barbers,
  manualBookingServices,
  appointmentList,
  filteredAppointmentList,
  appointmentViewMode,
  onAppointmentViewModeChange,
  selectedDateFilter,
  onSelectedDateFilterChange,
  selectedBarberFilter,
  onSelectedBarberFilterChange,
  selectedStatusFilter,
  onSelectedStatusFilterChange,
  isLoadingAppointments,
  isBlocking,
  onBlockingChange,
  blockData,
  onBlockDataChange,
  isCalendarOpen,
  onCalendarOpenChange,
  availableBlockTimes,
  dayAppointmentSummary,
  onOpenAgendaException,
  onOpenManualBooking,
  onBlockTime,
  onSelectAppointment,
  getBarberName,
  getServiceName,
  getStatusLabel,
  getStatusClass,
}: AppointmentsTabProps) {
  const setQuickBlockTimes = (times: string[]) => {
    const available = times.filter((time) => availableBlockTimes.includes(time));
    onBlockDataChange({ ...blockData, times: available });
  };

  return (
    <>
      <div className="grid gap-3 rounded-2xl border border-white/10 bg-card/80 p-3 shadow-lg shadow-black/10 backdrop-blur sm:flex sm:flex-wrap sm:items-center sm:rounded-xl">
        {user.role === "admin" ? (
          <Select value={selectedBarberFilter} onValueChange={onSelectedBarberFilterChange}>
            <SelectTrigger className="h-11 w-full border-white/10 bg-background/60 text-white sm:w-[180px]">
              <SelectValue placeholder="Filtrar por barbeiro" />
            </SelectTrigger>
            <SelectContent className="bg-card border-white/10 text-white">
              <SelectItem value="all">Todos os barbeiros</SelectItem>
              {barbers?.map((barber) => (
                <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex h-11 items-center rounded-md border border-white/10 bg-background/60 px-4 text-sm font-bold text-primary">
            {user.name}
          </div>
        )}

        <div className="grid h-11 grid-cols-2 gap-1 rounded-md border border-white/10 bg-background/60 p-1 sm:w-[178px]">
          <Button
            type="button"
            variant={appointmentViewMode === "day" ? "gold" : "ghost"}
            className="h-full px-3 text-xs"
            onClick={() => onAppointmentViewModeChange("day")}
          >
            Dia
          </Button>
          <Button
            type="button"
            variant={appointmentViewMode === "upcoming" ? "gold" : "ghost"}
            className="h-full px-3 text-xs"
            onClick={() => onAppointmentViewModeChange("upcoming")}
          >
            Próximas
          </Button>
        </div>

        {appointmentViewMode === "day" ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-11 justify-start gap-2 border-white/10 text-white sm:min-w-[172px]">
                <CalendarIcon className="h-4 w-4" /> {format(selectedDateFilter, "dd 'de' MMMM", { locale: pt })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-card border-white/10" align="end">
              <Calendar
                mode="single"
                selected={selectedDateFilter}
                onSelect={(date) => date && onSelectedDateFilterChange(date)}
                locale={pt}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        ) : (
          <Button variant="outline" className="pointer-events-none h-11 justify-start gap-2 border-white/10 text-white/80 sm:min-w-[172px]">
            <CalendarIcon className="h-4 w-4" /> Hoje em diante
          </Button>
        )}

        <Select value={selectedStatusFilter} onValueChange={(value) => onSelectedStatusFilterChange(value as AppointmentStatusFilter)}>
          <SelectTrigger className="h-11 w-full border-white/10 bg-background/60 text-white sm:w-[210px]">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent className="bg-card border-white/10 text-white">
            {appointmentStatusFilterOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex">
          <Button
            variant="outline"
            className="h-11 min-w-0 gap-2 whitespace-normal border-white/10 px-3"
            onClick={onOpenAgendaException}
          >
            <AlertTriangle className="h-4 w-4" /> Ausência
          </Button>
          <Button
            variant="gold"
            className="h-11 min-w-0 gap-2 whitespace-normal px-3"
            onClick={onOpenManualBooking}
          >
            <Plus className="h-4 w-4" /> Manual
          </Button>
        </div>

        <Dialog open={isBlocking} onOpenChange={onBlockingChange}>
          <DialogContent className="grid max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-2xl border-white/10 bg-card p-0 text-white shadow-2xl backdrop-blur-md sm:w-[94vw] sm:max-w-2xl">
            <DialogHeader className="border-b border-white/10 px-5 py-5 pr-12 sm:px-6">
              <DialogTitle className="text-xl font-display font-bold text-primary">
                {blockData.isManualBooking ? "Marcação manual" : "Ausência na agenda"}
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-400">
                {blockData.isManualBooking
                  ? "Crie uma marcação que chegou por chamada ou mensagem diretamente na agenda."
                  : "Bloqueie horas, férias ou ausências sem alterar o horário base da barbearia."}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
              <div className="space-y-5">
                <div className="rounded-xl border border-primary/10 bg-primary/5 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                      {blockData.isManualBooking ? <User className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white">
                        {blockData.isManualBooking ? "Marcação adicionada à agenda" : "Ausência / bloqueio"}
                      </p>
                      <p className="mt-1 whitespace-normal break-words text-xs text-gray-400">
                        {blockData.isManualBooking
                          ? "Para clientes que entraram por contacto direto e precisam de ficar registados."
                          : "Pausas, férias, almoço maior ou fecho excecional para um barbeiro."}
                      </p>
                    </div>
                  </div>

                  {!blockData.isManualBooking && (
                    <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-background/50 px-3 py-3">
                      <div>
                        <Label htmlFor="multiDay" className="cursor-pointer text-sm font-medium">Bloquear vários dias</Label>
                        <p className="text-xs text-gray-500">Ideal para férias ou ausências completas.</p>
                      </div>
                      <Switch
                        id="multiDay"
                        checked={blockData.isMultiDay}
                        onCheckedChange={(checked) => onBlockDataChange({ ...blockData, isMultiDay: checked, isManualBooking: false, isRecurring: false })}
                      />
                    </div>
                  )}

                  {blockData.isManualBooking && (
                    <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-background/50 px-3 py-3">
                      <div>
                        <Label htmlFor="recurring" className="cursor-pointer text-sm font-medium">Repetir marcação</Label>
                        <p className="text-xs text-gray-500">Reserva automática para clientes fixos.</p>
                      </div>
                      <Switch
                        id="recurring"
                        checked={blockData.isRecurring}
                        onCheckedChange={(checked) => onBlockDataChange({ ...blockData, isRecurring: checked, isMultiDay: false })}
                      />
                    </div>
                  )}
                </div>

                {blockData.isRecurring && (
                  <div className="grid grid-cols-1 gap-4 rounded-xl border border-primary/10 bg-primary/5 p-4 min-[420px]:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-400">Repetir a cada (semanas)</Label>
                      <Select value={blockData.recurringWeeks} onValueChange={(value) => onBlockDataChange({ ...blockData, recurringWeeks: value })}>
                        <SelectTrigger className="h-11 border-white/10 bg-background/50"><SelectValue /></SelectTrigger>
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
                      <Select value={blockData.recurringMonths} onValueChange={(value) => onBlockDataChange({ ...blockData, recurringMonths: value })}>
                        <SelectTrigger className="h-11 border-white/10 bg-background/50"><SelectValue /></SelectTrigger>
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

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-3">
                    <Label className="text-sm font-medium text-gray-300">{blockData.isMultiDay ? "Início" : "Data"}</Label>
                    <Popover open={isCalendarOpen} onOpenChange={onCalendarOpenChange}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="h-12 w-full justify-start gap-2 rounded-xl border-white/10 bg-background/50 text-white">
                          <CalendarIcon className="h-4 w-4" />{format(blockData.date, "dd/MM/yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 bg-card border-white/10">
                        <Calendar
                          mode="single"
                          selected={blockData.date}
                          onSelect={(date) => {
                            if (!date) return;
                            onBlockDataChange({ ...blockData, date });
                            onCalendarOpenChange(false);
                          }}
                          locale={pt}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  {blockData.isMultiDay && (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium text-gray-300">Fim</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="h-12 w-full justify-start gap-2 rounded-xl border-white/10 bg-background/50 text-white">
                            <CalendarIcon className="h-4 w-4" />{format(blockData.endDate, "dd/MM/yyyy")}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 bg-card border-white/10">
                          <Calendar
                            mode="single"
                            selected={blockData.endDate}
                            onSelect={(date) => date && onBlockDataChange({ ...blockData, endDate: date })}
                            disabled={(date) => date < blockData.date}
                            locale={pt}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-3">
                    <Label className="text-sm font-medium text-gray-300">Barbeiro</Label>
                    <Select value={blockData.barberId} onValueChange={(value) => onBlockDataChange({ ...blockData, barberId: value })}>
                      <SelectTrigger className="h-12 rounded-xl border-white/10 bg-background/50 text-white">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-white/10 text-white">
                        {barbers?.map((barber) => (
                          <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {blockData.isManualBooking && (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium text-gray-300">Serviço</Label>
                      <Select value={blockData.serviceId} onValueChange={(value) => onBlockDataChange({ ...blockData, serviceId: value })}>
                        <SelectTrigger className="h-12 rounded-xl border-white/10 bg-background/50 text-white">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-white/10 text-white">
                          {manualBookingServices.map((service) => (
                            <SelectItem key={service.id} value={String(service.id)}>{service.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {blockData.barberId && manualBookingServices.length === 0 && (
                        <p className="text-xs text-red-300">Este barbeiro não tem serviços associados.</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <Label className="text-sm font-medium text-gray-300">Horas afetadas</Label>
                      <p className="text-xs text-gray-500">
                        {blockData.times.length > 0 ? `${blockData.times.length} horário${blockData.times.length === 1 ? "" : "s"} selecionado${blockData.times.length === 1 ? "" : "s"}` : "Escolha uma ou mais horas."}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex">
                      <Button type="button" variant="outline" size="sm" className="h-10 text-xs sm:h-8" onClick={() => setQuickBlockTimes(morningBlockTimes)}>
                        Manhã
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-10 text-xs sm:h-8" onClick={() => setQuickBlockTimes(afternoonBlockTimes)}>
                        Tarde
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-10 text-xs sm:h-8" onClick={() => setQuickBlockTimes(blockTimeOptions)}>
                        Dia inteiro
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-10 text-xs text-gray-400 sm:h-8" onClick={() => onBlockDataChange({ ...blockData, times: [] })}>
                        Limpar
                      </Button>
                    </div>
                  </div>

                  {!blockData.barberId && (
                    <div className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
                      Escolha primeiro o barbeiro para ver apenas horas livres.
                    </div>
                  )}

                  <div className="grid max-h-[34dvh] grid-cols-3 gap-2 overflow-y-auto p-1 scrollbar-thin min-[380px]:grid-cols-4 sm:max-h-48 sm:grid-cols-5">
                    {blockTimeOptions.map((time) => {
                      const isAvailable = availableBlockTimes.includes(time);

                      return (
                        <Button
                          key={time}
                          type="button"
                          variant={blockData.times.includes(time) ? "gold" : "outline"}
                          size="sm"
                          className="h-11 rounded-lg text-xs disabled:opacity-30 sm:h-10"
                          disabled={!isAvailable}
                          onClick={() => onBlockDataChange({
                            ...blockData,
                            times: blockData.times.includes(time)
                              ? blockData.times.filter((selectedTime) => selectedTime !== time)
                              : [...blockData.times, time],
                          })}
                        >
                          {time}
                        </Button>
                      );
                    })}
                  </div>

                  {availableBlockTimes.length === 0 && blockData.barberId && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                      Não há horas disponíveis para este dia e barbeiro.
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-3">
                    <Label className="text-sm font-medium text-gray-300">Nome do cliente / nota</Label>
                    <Input
                      value={blockData.name}
                      onChange={(event) => onBlockDataChange({ ...blockData, name: event.target.value })}
                      className="h-12 rounded-xl border-white/10 bg-background/50 text-white"
                      placeholder="João"
                    />
                  </div>

                  {blockData.isManualBooking && (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium text-gray-300">Telemóvel</Label>
                      <Input
                        value={blockData.phone}
                        onChange={(event) => onBlockDataChange({ ...blockData, phone: event.target.value })}
                        className="h-12 rounded-xl border-white/10 bg-background/50 text-white"
                        placeholder="912..."
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="border-t border-white/10 bg-card/95 px-5 py-4 sm:px-6">
              <Button
                type="button"
                variant="gold"
                className="h-12 w-full rounded-xl text-base font-bold"
                disabled={!blockData.barberId || blockData.times.length === 0 || (blockData.isManualBooking && !blockData.serviceId)}
                onClick={onBlockTime}
              >
                {blockData.isManualBooking ? "Criar marcação" : "Guardar ausência"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {appointmentViewMode === "day" && (
        <AppointmentDaySummary summary={dayAppointmentSummary} />
      )}

      <div className="rounded-xl border border-white/10 bg-card p-3 sm:p-4 md:p-5">
        {isLoadingAppointments ? (
          <div className="flex p-12 justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-display font-bold text-white">Lista de marcações</h2>
                <p className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                  <Bell className="h-3.5 w-3.5 text-primary" />
                  {appointmentViewMode === "day"
                    ? "Marcações do dia selecionado, com filtros e ações no detalhe."
                    : "Marcações futuras, com filtros e ações no detalhe."}
                </p>
              </div>
              <span className="w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300">
                {selectedStatusFilter === "all"
                  ? `${appointmentList.length} registos`
                  : `${filteredAppointmentList.length} de ${appointmentList.length} registos`}
              </span>
            </div>

            {filteredAppointmentList.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-gray-500">
                {selectedStatusFilter === "all"
                  ? appointmentViewMode === "day" ? "Sem marcações neste dia." : "Sem marcações futuras."
                  : "Sem marcações para este estado."}
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10 md:bg-background/20">
                <div className="hidden grid-cols-[120px_1.2fr_1fr_1fr_130px] gap-4 border-b border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-bold uppercase tracking-widest text-gray-500 md:grid">
                  <span>Quando</span>
                  <span>Cliente</span>
                  <span>Barbeiro</span>
                  <span>Serviço</span>
                  <span className="text-right">Estado</span>
                </div>
                <div className="space-y-2 p-2 md:space-y-0 md:p-0 md:divide-y md:divide-white/10">
                  {filteredAppointmentList.map((appointment) => {
                    const start = parseISO(appointment.startTime);
                    const appointmentLabel = `Abrir detalhes da marcação de ${appointment.customerName}, ${format(start, "HH:mm")}`;

                    return (
                      <button
                        key={appointment.id}
                        type="button"
                        aria-label={appointmentLabel}
                        title={appointmentLabel}
                        onClick={() => onSelectAppointment(appointment)}
                        className={cn(
                          "grid w-full gap-3 rounded-xl border border-white/10 bg-background/55 px-4 py-4 text-left transition hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary md:rounded-none md:border-0 md:bg-transparent md:grid-cols-[120px_1.2fr_1fr_1fr_130px] md:items-center md:gap-4",
                          appointment.status !== "booked" && "opacity-70",
                        )}
                      >
                        <div>
                          <p className="font-display text-xl font-bold text-primary">{format(start, "HH:mm")}</p>
                          <p className="text-xs text-gray-500">{format(start, "dd/MM/yyyy")}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-white">{appointment.customerName}</p>
                          <p className="truncate text-xs text-gray-400">{appointment.customerPhone || "Sem telemóvel"}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 md:hidden">Barbeiro</p>
                          <p className="truncate text-sm text-gray-300">{getBarberName(appointment.barberId)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 md:hidden">Serviço</p>
                          <p className="truncate text-sm text-gray-300">{getServiceName(appointment.serviceId)}</p>
                        </div>
                        <div className="flex md:justify-end">
                          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", getStatusClass(appointment.status))}>
                            {getStatusLabel(appointment.status)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
