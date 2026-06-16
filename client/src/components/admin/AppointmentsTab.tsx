import { format, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import { Bell, Calendar as CalendarIcon, Loader2, Plus } from "lucide-react";
import { type AppointmentStatus } from "@/hooks/use-appointments";
import { Button } from "@/components/ui/button-custom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type DayAppointmentSummary = {
  total: number;
  booked: number;
  completed: number;
  risk: number;
};

type AppointmentsTabProps = {
  user: AppointmentsTabUser;
  barbers?: AppointmentBarberOption[];
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
  dayAppointmentSummary: DayAppointmentSummary;
  onOpenManualBooking: () => void;
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
  dayAppointmentSummary,
  onOpenManualBooking,
  onSelectAppointment,
  getBarberName,
  getServiceName,
  getStatusLabel,
  getStatusClass,
}: AppointmentsTabProps) {
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

        <div className="sm:ml-auto">
          <Button
            variant="gold"
            className="h-11 min-w-0 gap-2 whitespace-normal px-3"
            onClick={onOpenManualBooking}
          >
            <Plus className="h-4 w-4" /> Manual
          </Button>
        </div>
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
