import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfToday } from "date-fns";
import { History, Loader2, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useActiveLocationId } from "@/lib/location-context";
import { moneyInputToCents } from "@/lib/money-input";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Category = "rent" | "utilities" | "internet" | "materials" | "equipment" | "marketing" | "accounting" | "staff" | "other";
type Frequency = "weekly" | "monthly";
type Version = {
  id: number;
  effectiveFrom: string;
  category: Category;
  description: string;
  amountCents: number;
  recurrence: Frequency;
  weekday: number | null;
  monthDay: number | null;
  notes: string | null;
  createdAt: string;
};
type Series = {
  id: number;
  locationId: number;
  status: "active" | "paused" | "ended";
  anchorDate: string;
  endedOn: string | null;
  nextOccurrenceDate: string | null;
  currentVersion: Version;
  versions: Version[];
  pauses: Array<{ id: number; pausedFrom: string; resumedOn: string | null; createdAt: string }>;
  occurrences: Array<{
    id: number;
    scheduledDate: string;
    category: Category;
    description: string;
    amountCents: number;
    recurrence: Frequency;
    notes: string | null;
    isOccurrenceOverride: boolean;
    updatedAt: string;
  }>;
};

export type RecurringExpenseOccurrence = {
  id: number;
  recurringSeriesId: number;
  scheduledDate: string;
  category: Category;
  description: string;
  amountCents: number;
  recurrence: Frequency;
  notes?: string | null;
};

const statusLabels = { active: "Ativa", paused: "Pausada", ended: "Terminada" } as const;
const recurrenceLabels = { weekly: "Semanal", monthly: "Mensal" } as const;
const categoryLabels: Array<{ value: Category; label: string }> = [
  { value: "rent", label: "Renda" },
  { value: "utilities", label: "Água / luz" },
  { value: "internet", label: "Internet / telefone" },
  { value: "materials", label: "Material e produtos" },
  { value: "equipment", label: "Equipamentos" },
  { value: "marketing", label: "Marketing" },
  { value: "accounting", label: "Contabilidade" },
  { value: "staff", label: "Pagamentos de equipa" },
  { value: "other", label: "Outros" },
];

function euros(cents: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function RecurringExpensesManager() {
  const activeLocationId = useActiveLocationId();
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | Series["status"]>("all");
  const [editing, setEditing] = useState<Series | null>(null);
  const [pendingSeriesId, setPendingSeriesId] = useState<number | null>(null);
  const pendingRef = useRef(false);
  const [draft, setDraft] = useState({
    effectiveFrom: format(startOfToday(), "yyyy-MM-dd"),
    category: "other" as Category,
    description: "",
    amount: "",
    recurrence: "monthly" as Frequency,
    notes: "",
  });
  const todayDateKey = format(startOfToday(), "yyyy-MM-dd");
  const queryKey = ["/api/admin/expense-series", { locationId: activeLocationId }];
  const { data: series = [], isLoading } = useQuery<Series[]>({ queryKey });
  const visible = useMemo(
    () => filter === "all" ? series : series.filter((item) => item.status === filter),
    [filter, series],
  );
  useEffect(() => {
    setEditing(null);
    setFilter("all");
  }, [activeLocationId]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/admin/expense-series"] }),
      queryClient.invalidateQueries({ predicate: ({ queryKey }) => String(queryKey[0]).startsWith("/api/admin/expenses") }),
    ]);
  };

  const changeState = async (item: Series, action: "pause" | "resume" | "end") => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingSeriesId(item.id);
    try {
      await apiRequest("POST", `/api/admin/expense-series/${item.id}/state`, {
        action,
      });
      await refresh();
      toast({ title: "Despesa recorrente atualizada" });
    } catch (error) {
      toast({ title: "Não foi possível alterar a série", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      pendingRef.current = false;
      setPendingSeriesId(null);
    }
  };

  const openEdit = (item: Series) => {
    const latestVersion = item.versions.at(-1) ?? item.currentVersion;
    const today = format(startOfToday(), "yyyy-MM-dd");
    setEditing(item);
    setDraft({
      effectiveFrom: latestVersion.effectiveFrom > today ? latestVersion.effectiveFrom : today,
      category: latestVersion.category,
      description: latestVersion.description,
      amount: (latestVersion.amountCents / 100).toFixed(2).replace(".", ","),
      recurrence: latestVersion.recurrence,
      notes: latestVersion.notes ?? "",
    });
  };

  const saveVersion = async () => {
    if (!editing || pendingRef.current) return;
    const amountCents = moneyInputToCents(draft.amount);
    if (amountCents === null || !draft.description.trim()) {
      toast({ title: "Preencha a descrição e um valor válido.", variant: "destructive" });
      return;
    }
    pendingRef.current = true;
    setPendingSeriesId(editing.id);
    try {
      await apiRequest("POST", `/api/admin/expense-series/${editing.id}/versions`, {
        effectiveFrom: draft.effectiveFrom,
        category: draft.category,
        description: draft.description.trim(),
        amountCents,
        recurrence: draft.recurrence,
        notes: draft.notes.trim() || null,
      });
      setEditing(null);
      await refresh();
      toast({ title: "Condições futuras guardadas" });
    } catch (error) {
      toast({ title: "Não foi possível guardar", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      pendingRef.current = false;
      setPendingSeriesId(null);
    }
  };

  return (
    <Card data-testid="recurring-expenses-manager" className="bg-card border-white/10 xl:col-span-2">
      <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="text-xl font-display font-bold text-primary">Despesas recorrentes</CardTitle>
          <p className="mt-1 text-sm text-gray-400">Gira séries semanais e mensais sem alterar o histórico já registado.</p>
        </div>
        <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
          <SelectTrigger aria-label="Filtrar séries por estado" className="h-11 w-full border-white/10 bg-background text-white md:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card text-white">
            <SelectItem value="all">Todos os estados</SelectItem>
            <SelectItem value="active">Ativas</SelectItem>
            <SelectItem value="paused">Pausadas</SelectItem>
            <SelectItem value="ended">Terminadas</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8 text-gray-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />A carregar séries...</div>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/15 py-8 text-center text-gray-400">Ainda não existem séries neste estado.</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {visible.map((item) => (
              <div key={item.id} className="rounded-xl border border-white/15 bg-background/75 p-4" data-testid={`recurring-expense-series-${item.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{item.currentVersion.description}</p>
                    <p className="text-sm text-gray-300">{euros(item.currentVersion.amountCents)} · {recurrenceLabels[item.currentVersion.recurrence]}</p>
                  </div>
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{statusLabels[item.status]}</span>
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  Desde {item.anchorDate}
                  {item.nextOccurrenceDate ? ` · próxima: ${item.nextOccurrenceDate}` : ""}
                  {item.endedOn ? ` · terminada em ${item.endedOn}` : ""}
                </p>
                <details className="mt-3 text-sm text-gray-300">
                  <summary className="flex cursor-pointer items-center gap-2 text-primary"><History className="h-4 w-4" />Ver histórico</summary>
                  <div className="mt-2 space-y-3 pl-6 text-xs text-gray-400">
                    <div className="space-y-1">
                      <p className="font-semibold text-gray-300">Ocorrências</p>
                      {item.occurrences.length === 0
                        ? <p>Ainda não existem ocorrências até hoje.</p>
                        : item.occurrences.map((occurrence) => (
                          <p key={`occurrence-${occurrence.id}`}>
                            {occurrence.scheduledDate} · {euros(occurrence.amountCents)}
                            {occurrence.isOccurrenceOverride ? " · correção isolada" : ""}
                          </p>
                        ))}
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-gray-300">Alterações da série</p>
                      {item.versions.map((version) => <p key={version.id}>{version.effectiveFrom} · {euros(version.amountCents)} · {recurrenceLabels[version.recurrence]} · registado em {new Date(version.createdAt).toLocaleString("pt-PT")}</p>)}
                      {item.pauses.map((pause) => <p key={`pause-${pause.id}`}>Pausa: {pause.pausedFrom} → {pause.resumedOn ?? "em curso"} · registada em {new Date(pause.createdAt).toLocaleString("pt-PT")}</p>)}
                    </div>
                  </div>
                </details>
                <div className="mt-4 flex flex-wrap gap-2">
                  {item.status !== "ended" && <Button size="sm" variant="outline" onClick={() => openEdit(item)}>Alterar futuro</Button>}
                  {item.status === "active" && <Button size="sm" variant="outline" onClick={() => changeState(item, "pause")} disabled={pendingSeriesId !== null}><Pause className="mr-1 h-4 w-4" />Pausar</Button>}
                  {item.status === "paused" && <Button size="sm" variant="outline" onClick={() => changeState(item, "resume")} disabled={pendingSeriesId !== null}><Play className="mr-1 h-4 w-4" />Retomar</Button>}
                  {item.status !== "ended" && <Button size="sm" variant="outline" className="border-red-500/30 text-red-300" onClick={() => changeState(item, "end")} disabled={pendingSeriesId !== null}><Square className="mr-1 h-4 w-4" />Terminar</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent mobileViewportAware className="max-w-lg bg-card text-white">
          <DialogHeader>
            <DialogTitle>Alterar esta e as ocorrências seguintes</DialogTitle>
            <DialogDescription>É criada uma nova versão. As ocorrências anteriores mantêm os valores originais.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2"><Label>Produzir efeitos em</Label><Input aria-label="Data de efeito da série" type="date" min={(editing?.versions.at(-1)?.effectiveFrom ?? todayDateKey) > todayDateKey ? editing?.versions.at(-1)?.effectiveFrom : todayDateKey} value={draft.effectiveFrom} onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })} /></div>
            <div className="space-y-2"><Label>Descrição</Label><Input aria-label="Descrição da série" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></div>
            <div className="space-y-2"><Label>Categoria</Label><Select value={draft.category} onValueChange={(value) => setDraft({ ...draft, category: value as Category })}><SelectTrigger aria-label="Categoria da série"><SelectValue /></SelectTrigger><SelectContent>{categoryLabels.map((category) => <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Valor</Label><Input aria-label="Valor da série" inputMode="decimal" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></div>
              <div className="space-y-2"><Label>Periodicidade</Label><Select value={draft.recurrence} onValueChange={(value) => setDraft({ ...draft, recurrence: value as Frequency })}><SelectTrigger aria-label="Periodicidade da série"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="weekly">Semanal</SelectItem><SelectItem value="monthly">Mensal</SelectItem></SelectContent></Select></div>
            </div>
            <div className="space-y-2"><Label>Notas</Label><Textarea aria-label="Notas da série" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button variant="gold" onClick={saveVersion} disabled={pendingSeriesId !== null}>Guardar nova versão</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function RecurringExpenseOccurrenceDialog({
  occurrence,
  onClose,
}: {
  occurrence: RecurringExpenseOccurrence | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [scope, setScope] = useState<"only" | "following">("only");
  const [category, setCategory] = useState<Category>(occurrence?.category ?? "other");
  const [description, setDescription] = useState(occurrence?.description ?? "");
  const [amount, setAmount] = useState(occurrence ? (occurrence.amountCents / 100).toFixed(2).replace(".", ",") : "");
  const [notes, setNotes] = useState(occurrence?.notes ?? "");
  const today = format(startOfToday(), "yyyy-MM-dd");

  const save = async () => {
    if (!occurrence || pendingRef.current) return;
    const amountCents = moneyInputToCents(amount);
    if (amountCents === null || !description.trim()) {
      toast({ title: "Preencha a descrição e um valor válido.", variant: "destructive" });
      return;
    }
    pendingRef.current = true;
    setPending(true);
    try {
      if (scope === "only") {
        await apiRequest("PATCH", `/api/admin/expenses/${occurrence.id}/occurrence`, {
          category,
          description: description.trim(),
          amountCents,
          notes: notes.trim() || null,
        });
      } else {
        await apiRequest("POST", `/api/admin/expense-series/${occurrence.recurringSeriesId}/versions`, {
          effectiveFrom: occurrence.scheduledDate,
          category,
          description: description.trim(),
          amountCents,
          recurrence: occurrence.recurrence,
          notes: notes.trim() || null,
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/expense-series"] }),
        queryClient.invalidateQueries({ predicate: ({ queryKey }) => String(queryKey[0]).startsWith("/api/admin/expenses") }),
      ]);
      toast({ title: scope === "only" ? "Ocorrência atualizada" : "Ocorrências futuras atualizadas" });
      onClose();
    } catch (error) {
      toast({ title: "Não foi possível guardar", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <Dialog open={Boolean(occurrence)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent mobileViewportAware className="max-w-lg bg-card text-white">
        <DialogHeader>
          <DialogTitle>Editar despesa recorrente</DialogTitle>
          <DialogDescription>Escolha se a alteração afeta apenas esta ocorrência ou também as seguintes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Âmbito</Label>
            <Select value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
              <SelectTrigger aria-label="Âmbito da alteração"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="only">Apenas esta ocorrência</SelectItem>
                <SelectItem value="following" disabled={Boolean(occurrence && occurrence.scheduledDate < today)}>Esta e as seguintes</SelectItem>
              </SelectContent>
            </Select>
            {occurrence && occurrence.scheduledDate < today && <p className="text-xs text-gray-400">O histórico passado só pode ser corrigido ocorrência a ocorrência.</p>}
          </div>
          <div className="space-y-2"><Label>Descrição</Label><Input aria-label="Descrição da ocorrência" value={description} onChange={(event) => setDescription(event.target.value)} /></div>
          <div className="space-y-2"><Label>Categoria</Label><Select value={category} onValueChange={(value) => setCategory(value as Category)}><SelectTrigger aria-label="Categoria da ocorrência"><SelectValue /></SelectTrigger><SelectContent>{categoryLabels.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Valor</Label><Input aria-label="Valor da ocorrência" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
          <div className="space-y-2"><Label>Notas</Label><Textarea aria-label="Notas da ocorrência" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button variant="gold" onClick={save} disabled={pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
