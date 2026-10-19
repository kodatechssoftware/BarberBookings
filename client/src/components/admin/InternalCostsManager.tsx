import { useMemo, useRef, useState } from "react";
import { Boxes, Loader2, Pencil, Plus } from "lucide-react";
import type { InternalCostDefinition } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useInternalCosts } from "@/hooks/use-internal-costs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { centsToMoneyInput, formatMoneyInputOnBlur, moneyInputToCents, normalizeMoneyInput } from "@/lib/money-input";

type CostForm = {
  name: string;
  description: string;
  amountEuros: string;
  unitLabel: string;
  sortOrder: string;
};

const emptyForm: CostForm = {
  name: "",
  description: "",
  amountEuros: "",
  unitLabel: "unidade",
  sortOrder: "0",
};

const euroFormatter = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

export function InternalCostsManager({ enabled }: { enabled: boolean }) {
  const { data: costs = [], isLoading, isError, refetch } = useInternalCosts({ enabled });
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InternalCostDefinition | null>(null);
  const [form, setForm] = useState<CostForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const nextSortOrder = useMemo(
    () => costs.reduce((highest, cost) => Math.max(highest, cost.sortOrder), -1) + 1,
    [costs],
  );

  const close = () => {
    if (pendingRef.current) return;
    setOpen(false);
    setEditing(null);
    setForm(emptyForm);
    setError(null);
  };
  const create = () => {
    setEditing(null);
    setForm({ ...emptyForm, sortOrder: String(nextSortOrder) });
    setError(null);
    setOpen(true);
  };
  const edit = (cost: InternalCostDefinition) => {
    setEditing(cost);
    setForm({
      name: cost.name,
      description: cost.description ?? "",
      amountEuros: centsToMoneyInput(cost.defaultUnitCostCents),
      unitLabel: cost.unitLabel,
      sortOrder: String(cost.sortOrder),
    });
    setError(null);
    setOpen(true);
  };
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/admin/internal-costs"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] }),
    ]);
  };
  const save = async () => {
    if (pendingRef.current) return;
    const defaultUnitCostCents = moneyInputToCents(form.amountEuros, { minCents: 0, maxCents: 1_000_000 });
    const sortOrder = Number(form.sortOrder);
    if (!form.name.trim() || !form.unitLabel.trim() || defaultUnitCostCents === null
      || !Number.isInteger(sortOrder) || sortOrder < 0) {
      setError("Preencha nome, custo unitário, unidade e ordem com valores válidos.");
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await apiRequest(editing ? "PATCH" : "POST", editing
        ? `/api/admin/internal-costs/${editing.id}`
        : "/api/admin/internal-costs", {
        name: form.name.trim(),
        description: form.description.trim() || null,
        defaultUnitCostCents,
        unitLabel: form.unitLabel.trim(),
        sortOrder,
      });
      await refresh();
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      toast({ title: "Sucesso", description: editing ? "Custo/consumo atualizado." : "Custo/consumo criado." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível guardar o custo/consumo.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  const toggle = async (cost: InternalCostDefinition, isActive: boolean) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await apiRequest("PATCH", `/api/admin/internal-costs/${cost.id}`, { isActive });
      await refresh();
    } catch (caught) {
      toast({
        title: "Erro",
        description: caught instanceof Error ? caught.message : "Não foi possível atualizar o custo/consumo.",
        variant: "destructive",
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return <>
    <Card className="border-white/10 bg-card text-white" data-testid="internal-costs-manager">
      <CardHeader className="border-b border-white/10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl"><Boxes className="h-5 w-5 text-primary" /> Custos / Consumos</CardTitle>
            <p className="mt-2 max-w-2xl text-sm text-gray-400">Catálogo exclusivamente interno para apurar custo direto e margem. Nunca altera o preço cobrado à cliente.</p>
          </div>
          <Button variant="gold" className="w-full gap-2 sm:w-auto" onClick={create}><Plus className="h-4 w-4" /> Novo custo</Button>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {isLoading ? <p className="flex justify-center gap-2 py-10 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> A carregar...</p>
          : isError ? <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm"><p>Não foi possível carregar os custos e consumos.</p><Button size="sm" variant="outline" className="mt-3" onClick={() => void refetch()}>Tentar novamente</Button></div>
          : costs.length === 0 ? <div className="rounded-lg border border-dashed border-white/15 p-8 text-center text-sm text-gray-400">Ainda não existem custos ou consumos internos nesta localização.</div>
          : <div className="space-y-3">{costs.map((cost) => <div key={cost.id} className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${cost.isActive ? "border-white/10 bg-background/50" : "border-white/5 opacity-70"}`}>
            <div><div className="flex items-center gap-2"><h3 className="font-semibold">{cost.name}</h3><Badge variant={cost.isActive ? "default" : "outline"}>{cost.isActive ? "Ativo" : "Inativo"}</Badge></div><p className="mt-1 text-sm text-gray-300">{euroFormatter.format(cost.defaultUnitCostCents / 100)} / {cost.unitLabel}</p>{cost.description && <p className="mt-1 text-sm text-gray-400">{cost.description}</p>}</div>
            <div className="flex items-center gap-3"><Button size="sm" variant="outline" onClick={() => edit(cost)} disabled={pending}><Pencil className="mr-1 h-3.5 w-3.5" />Editar</Button><Switch checked={cost.isActive} onCheckedChange={(value) => void toggle(cost, value)} disabled={pending} aria-label={`${cost.isActive ? "Desativar" : "Ativar"} ${cost.name}`} /></div>
          </div>)}</div>}
      </CardContent>
    </Card>

    <Dialog open={open} onOpenChange={(value) => { if (!value) close(); }}>
      <DialogContent mobileViewportAware className="w-[calc(100vw-1rem)] max-w-lg overflow-y-auto border-white/10 bg-card text-white">
        <DialogHeader><DialogTitle>{editing ? "Editar custo/consumo" : "Novo custo/consumo"}</DialogTitle><DialogDescription className="text-gray-400">Este valor é interno e não entra no total da cliente.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="space-y-2"><Label htmlFor="cost-name">Nome</Label><Input id="cost-name" value={form.name} maxLength={100} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} required /></div>
          <div className="space-y-2"><Label htmlFor="cost-description">Descrição</Label><Textarea id="cost-description" value={form.description} maxLength={500} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} /></div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="cost-value">Custo unitário (€)</Label><Input id="cost-value" inputMode="decimal" value={form.amountEuros} onChange={(event) => setForm((value) => ({ ...value, amountEuros: normalizeMoneyInput(event.target.value, value.amountEuros) }))} onBlur={() => setForm((value) => ({ ...value, amountEuros: formatMoneyInputOnBlur(value.amountEuros, { minCents: 0, maxCents: 1_000_000 }) }))} required /></div><div className="space-y-2"><Label htmlFor="cost-unit">Unidade</Label><Input id="cost-unit" value={form.unitLabel} maxLength={40} onChange={(event) => setForm((value) => ({ ...value, unitLabel: event.target.value }))} required /></div></div>
          <div className="space-y-2"><Label htmlFor="cost-order">Ordem</Label><Input id="cost-order" type="number" min={0} step={1} value={form.sortOrder} onChange={(event) => setForm((value) => ({ ...value, sortOrder: event.target.value }))} required /></div>
          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" variant="gold" disabled={pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? "Guardar" : "Criar"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
