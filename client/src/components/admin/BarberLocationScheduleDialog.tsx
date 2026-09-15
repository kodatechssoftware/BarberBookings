import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock, Loader2, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { locationHeaders } from "@/lib/location-context";
import { queryClient } from "@/lib/queryClient";
import { periodsForShop, type AvailabilityRow, type ShopAvailabilityRow } from "@/lib/availability";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button-custom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type Props = {
  barber: { id: number; name: string };
  location: { id: number; name: string; timezone: string };
};
type ScheduleRow = Omit<AvailabilityRow, "barberId">;
const weekdays = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const dayOrder = [1, 2, 3, 4, 5, 6, 0];
const clockTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// Mounted only in multi-location, keyed by location + barber by the caller.
export function BarberLocationScheduleDialog({ barber, location }: Props) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button variant="outline" size="sm" className="mb-3 w-full border-white/10" aria-label={`Horário de ${barber.name} nesta loja`}>
        <Clock className="mr-2 h-4 w-4" /> Horário nesta loja
      </Button>
    </DialogTrigger>
    <DialogContent className="max-h-[90dvh] w-[95vw] max-w-xl overflow-y-auto border-white/10 bg-card text-white">
      <DialogHeader>
        <DialogTitle>Horário de {barber.name}</DialogTitle>
        <DialogDescription className="break-words">
          {location.name} · {location.timezone}. Horário semanal fixo, apenas nesta loja.
          A disponibilidade respeita também o horário da loja e as marcações do barbeiro em todas as lojas.
        </DialogDescription>
      </DialogHeader>
      {open && <LoadSchedule barber={barber} location={location} onSaved={() => setOpen(false)} />}
    </DialogContent>
  </Dialog>;
}

function LoadSchedule({ barber, location, onSaved }: Props & { onSaved: () => void }) {
  const path = `/api/barbers/${barber.id}/availability`;
  const schedule = useQuery<ScheduleRow[]>({
    queryKey: [path, { locationId: location.id }], staleTime: 0,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(path, { signal, headers: locationHeaders(location.id) });
      if (!response.ok) throw new Error("Não foi possível carregar o horário do barbeiro.");
      return response.json();
    },
  });
  const shop = useQuery<ShopAvailabilityRow[]>({
    queryKey: ["/api/shop/availability", { locationId: location.id }], staleTime: 0,
    queryFn: async ({ signal }) => {
      const response = await apiFetch("/api/shop/availability", { signal, headers: locationHeaders(location.id) });
      if (!response.ok) throw new Error("Não foi possível carregar o horário da loja.");
      return response.json();
    },
  });
  if (schedule.isError || shop.isError) return <p role="alert">Não foi possível carregar o horário. Feche e volte a abrir para tentar novamente.</p>;
  // Never initialise an editable form from stale cached rows during a location switch/reopen.
  if (!schedule.data || !shop.data || schedule.isFetching || shop.isFetching) return <p role="status" className="flex gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />A carregar horário…</p>;
  return <ScheduleForm barber={barber} location={location} rows={schedule.data} shopRows={shop.data} onSaved={onSaved} />;
}

function ScheduleForm({ barber, location, rows, shopRows, onSaved }: Props & {
  rows: ScheduleRow[]; shopRows: ShopAvailabilityRow[]; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [days, setDays] = useState(() => weekdays.map((_, dayOfWeek) => {
    const periods = rows.length
      ? rows.filter((row) => row.dayOfWeek === dayOfWeek && row.isWorking).map(({ startTime, endTime }) => ({ startTime, endTime }))
      : periodsForShop({ dayOfWeek, shopAvailabilityRows: shopRows }).map(({ start, end }) => ({ startTime: clockTime(start), endTime: clockTime(end) }));
    return { isWorking: periods.length > 0, periods: periods.length ? periods : [{ startTime: "09:00", endTime: "19:00" }] };
  }));
  const save = useMutation({
    mutationFn: async (data: ScheduleRow[]) => {
      const response = await apiFetch(`/api/barbers/${barber.id}/availability`, {
        method: "PATCH", headers: { ...locationHeaders(location.id), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || "Não foi possível guardar o horário.");
      }
      return response.json();
    },
    onSuccess: () => {
      onSaved();
      // Only the edited shop's availability changes. Other shops retain their cached schedules.
      for (const path of ["/api/barbers/availability", `/api/barbers/${barber.id}/availability`]) {
        void queryClient.invalidateQueries({ queryKey: [path, { locationId: location.id }] });
      }
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
      toast({ title: "Horário guardado", description: `${barber.name} — ${location.name}. As outras lojas não foram alteradas.` });
    },
  });
  const updateDay = (day: number, data: Partial<typeof days[number]>) => setDays((current) => current.map((value, index) => index === day ? { ...value, ...data } : value));
  return <form className="min-w-0 space-y-4" onSubmit={(event) => {
    event.preventDefault();
    // Closed rows are intentional: [] means inherit shop hours, not a closed week.
    save.mutate(days.flatMap<ScheduleRow>((day, dayOfWeek) => day.isWorking
      ? day.periods.map((period) => ({ ...period, dayOfWeek, isWorking: true }))
      : [{ dayOfWeek, startTime: "09:00", endTime: "19:00", isWorking: false }]));
  }}>
    <p className="text-sm text-gray-400">{rows.length ? "Horário próprio nesta loja." : "Sem horário próprio: segue atualmente o horário da loja. Guardar cria um horário próprio."}</p>
    <fieldset disabled={save.isPending} className="min-w-0 space-y-3">
      {dayOrder.map((day) => <section key={day} className="min-w-0 space-y-2 rounded-lg border border-white/10 p-3" aria-label={weekdays[day]}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{weekdays[day]}</span>
          <Switch aria-label={`Trabalha ${weekdays[day]}`} checked={days[day].isWorking} onCheckedChange={(isWorking) => updateDay(day, { isWorking })} />
        </div>
        {days[day].isWorking ? <>
          {days[day].periods.map((period, index) => <div className="flex min-w-0 items-center gap-2" key={index}>
            {(["startTime", "endTime"] as const).map((field) => <Input
              key={field} type="time" required value={period[field]}
              aria-label={`${field === "startTime" ? "Início" : "Fim"} ${weekdays[day]} ${index + 1}`}
              className="min-w-0 flex-1 bg-background px-2"
              onChange={(event) => updateDay(day, { periods: days[day].periods.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: event.target.value } : row) })}
            />)}
            <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={`Remover período ${index + 1} ${weekdays[day]}`} disabled={days[day].periods.length === 1} onClick={() => updateDay(day, { periods: days[day].periods.filter((_, rowIndex) => rowIndex !== index) })}><Trash2 className="h-4 w-4" /></Button>
          </div>)}
          <Button type="button" variant="ghost" size="sm" onClick={() => updateDay(day, { periods: [...days[day].periods, { startTime: "14:00", endTime: "19:00" }] })}><Plus className="mr-1 h-3 w-3" />Adicionar período</Button>
        </> : <p className="text-xs text-gray-400">Não trabalha nesta loja.</p>}
      </section>)}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="gold" className="flex-1">{save.isPending ? "A guardar…" : "Guardar horário nesta loja"}</Button>
        <Button type="button" variant="outline" onClick={() => save.mutate([])}>Usar horário da loja</Button>
      </div>
    </fieldset>
    {save.isError && <p role="alert" className="text-sm text-red-400">{save.error.message}</p>}
  </form>;
}
