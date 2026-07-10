import { type Dispatch, type SetStateAction } from "react";
import { format, startOfToday } from "date-fns";
import { pt } from "date-fns/locale";
import { AlertTriangle, Calendar as CalendarIcon, User } from "lucide-react";
import { blockTimeOptions, outsideHoursBlockTimeOptions, type AppointmentBlockData } from "@/components/admin/AppointmentsTab";
import { Button } from "@/components/ui/button-custom";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type AppointmentBlockBarberOption = {
  id: number;
  name: string;
};

type AppointmentBlockServiceOption = {
  id: number;
  name: string;
};

type AppointmentBlockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barbers?: AppointmentBlockBarberOption[];
  manualBookingServices: AppointmentBlockServiceOption[];
  blockData: AppointmentBlockData;
  onBlockDataChange: Dispatch<SetStateAction<AppointmentBlockData>>;
  isCalendarOpen: boolean;
  onCalendarOpenChange: (open: boolean) => void;
  availableBlockTimes: string[];
  isCheckingAvailability?: boolean;
  onSubmit: () => void;
};

export function AppointmentBlockDialog({
  open,
  onOpenChange,
  barbers,
  manualBookingServices,
  blockData,
  onBlockDataChange,
  isCalendarOpen,
  onCalendarOpenChange,
  availableBlockTimes,
  isCheckingAvailability = false,
  onSubmit,
}: AppointmentBlockDialogProps) {
  const isSingleTimeMode = blockData.isManualBooking && blockData.isRecurring;
  const visibleBlockTimeOptions = blockData.isManualBooking && blockData.allowOutsideHours
    ? outsideHoursBlockTimeOptions
    : blockTimeOptions;
  const morningBlockTimes = visibleBlockTimeOptions.filter((time) => time < "13:00");
  const afternoonBlockTimes = visibleBlockTimeOptions.filter((time) => time >= "14:00");
  const today = startOfToday();
  const recurringStartsInPast = blockData.isRecurring && blockData.date < today;

  const setQuickBlockTimes = (times: string[]) => {
    const available = times.filter((time) => availableBlockTimes.includes(time));
    onBlockDataChange({ ...blockData, times: available });
  };

  const handleTimeClick = (time: string) => {
    if (isSingleTimeMode) {
      onBlockDataChange({
        ...blockData,
        times: blockData.times.includes(time) ? [] : [time],
      });
      return;
    }

    onBlockDataChange({
      ...blockData,
      times: blockData.times.includes(time)
        ? blockData.times.filter((selectedTime) => selectedTime !== time)
        : [...blockData.times, time],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                <div className="mt-4 grid gap-3">
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-background/50 px-3 py-3">
                    <div>
                      <Label htmlFor="outsideHours" className="cursor-pointer text-sm font-medium">Mostrar horários fora do horário normal</Label>
                      <p className="text-xs text-gray-500">Use apenas quando o cliente combinou uma exceção diretamente com o barbeiro.</p>
                    </div>
                    <Switch
                      id="outsideHours"
                      checked={blockData.allowOutsideHours}
                      onCheckedChange={(checked) => onBlockDataChange({
                        ...blockData,
                        allowOutsideHours: checked,
                        times: [],
                      })}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-background/50 px-3 py-3">
                    <div>
                      <Label htmlFor="recurring" className="cursor-pointer text-sm font-medium">Repetir marcação</Label>
                      <p className="text-xs text-gray-500">Reserva automática para clientes fixos.</p>
                    </div>
                    <Switch
                      id="recurring"
                      checked={blockData.isRecurring}
                      onCheckedChange={(checked) => onBlockDataChange({
                        ...blockData,
                        date: checked && blockData.date < today ? today : blockData.date,
                        endDate: checked && blockData.endDate < today ? today : blockData.endDate,
                        isRecurring: checked,
                        isMultiDay: false,
                        times: checked ? blockData.times.slice(0, 1) : blockData.times,
                      })}
                    />
                  </div>
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
                      disabled={blockData.isRecurring ? (date) => date < today : undefined}
                      locale={pt}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                {recurringStartsInPast && (
                  <p className="text-xs text-red-300">A recorrência deve começar hoje ou numa data futura.</p>
                )}
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
                  <Label className="text-sm font-medium text-gray-300">{isSingleTimeMode ? "Hora da marcação" : "Horas afetadas"}</Label>
                  <p className="text-xs text-gray-500">
                    {blockData.times.length > 0
                      ? `${blockData.times.length} horário${blockData.times.length === 1 ? "" : "s"} selecionado${blockData.times.length === 1 ? "" : "s"}`
                      : isSingleTimeMode ? "Escolha a hora que se repete." : "Escolha uma ou mais horas."}
                  </p>
                </div>
                {!isSingleTimeMode && (
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    <Button type="button" variant="outline" size="sm" className="h-10 text-xs sm:h-8" onClick={() => setQuickBlockTimes(morningBlockTimes)}>
                      Manhã
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-10 text-xs sm:h-8" onClick={() => setQuickBlockTimes(afternoonBlockTimes)}>
                      Tarde
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-10 text-xs sm:h-8" onClick={() => setQuickBlockTimes(visibleBlockTimeOptions)}>
                      Dia inteiro
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-10 text-xs text-gray-400 sm:h-8" onClick={() => onBlockDataChange({ ...blockData, times: [] })}>
                      Limpar
                    </Button>
                  </div>
                )}
              </div>

              {!blockData.barberId && (
                <div className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
                  Escolha primeiro o barbeiro para ver apenas horas livres.
                </div>
              )}

              <div className="grid max-h-[34dvh] grid-cols-3 gap-2 overflow-y-auto p-1 scrollbar-thin min-[380px]:grid-cols-4 sm:max-h-48 sm:grid-cols-5">
                {visibleBlockTimeOptions.map((time) => {
                  const isAvailable = availableBlockTimes.includes(time);

                  return (
                    <Button
                      key={time}
                      type="button"
                      variant={blockData.times.includes(time) ? "gold" : "outline"}
                      size="sm"
                      className="h-11 rounded-lg text-xs disabled:opacity-30 sm:h-10"
                      disabled={!isAvailable}
                      onClick={() => handleTimeClick(time)}
                    >
                      {time}
                    </Button>
                  );
                })}
              </div>

              {isCheckingAvailability && blockData.barberId && (
                <div className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
                  A atualizar disponibilidade deste dia...
                </div>
              )}

              {!isCheckingAvailability && availableBlockTimes.length === 0 && blockData.barberId && (
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
            onClick={onSubmit}
          >
            {blockData.isManualBooking ? "Criar marcação" : "Guardar ausência"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
