import { useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Sparkles } from "lucide-react";
import type { ExtraDefinition, ExtraFinancialRule, ExtraPricingMode } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useExtras } from "@/hooks/use-extras";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const financialRuleLabels: Record<ExtraFinancialRule, string> = {
  follow_compensation: "Segue a regra de compensação do barbeiro",
  barber: "100% para o barbeiro",
  establishment: "100% para o estabelecimento",
};

type ExtraForm = {
  name: string;
  pricingMode: ExtraPricingMode;
  amountEuros: string;
  financialRule: ExtraFinancialRule;
  sortOrder: string;
};

const emptyForm: ExtraForm = {
  name: "",
  pricingMode: "fixed",
  amountEuros: "",
  financialRule: "follow_compensation",
  sortOrder: "0",
};

const euroFormatter = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
});

function amountInputFromCents(amountCents: number | null) {
  if (amountCents === null) return "";
  return (amountCents / 100).toFixed(2).replace(".", ",");
}

function parseAmountCents(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function ExtrasManager({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const { data: extras = [], isLoading, isError, refetch } = useExtras({ enabled });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingExtra, setEditingExtra] = useState<ExtraDefinition | null>(null);
  const [form, setForm] = useState<ExtraForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const nextSortOrder = useMemo(
    () => extras.reduce((highest, extra) => Math.max(highest, extra.sortOrder), -1) + 1,
    [extras],
  );

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/admin/extras"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] }),
    ]);
  };

  const openCreateDialog = () => {
    setEditingExtra(null);
    setForm({ ...emptyForm, sortOrder: String(nextSortOrder) });
    setFormError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (extra: ExtraDefinition) => {
    setEditingExtra(extra);
    setForm({
      name: extra.name,
      pricingMode: extra.pricingMode,
      amountEuros: amountInputFromCents(extra.amountCents),
      financialRule: extra.financialRule,
      sortOrder: String(extra.sortOrder),
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingExtra(null);
    setForm(emptyForm);
    setFormError(null);
  };

  const saveExtra = async () => {
    const name = form.name.trim();
    const amountCents = form.pricingMode === "fixed" ? parseAmountCents(form.amountEuros) : null;
    const sortOrder = Number(form.sortOrder);
    if (!name) {
      setFormError("Indique o nome do Extra.");
      return;
    }
    if (form.pricingMode === "fixed" && amountCents === null) {
      setFormError("Indique um valor superior a zero, com no máximo duas casas decimais.");
      return;
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      setFormError("A ordem deve ser um número inteiro igual ou superior a zero.");
      return;
    }

    const actionKey = editingExtra ? `save-${editingExtra.id}` : "create";
    setPendingAction(actionKey);
    setFormError(null);
    try {
      const path = editingExtra ? `/api/admin/extras/${editingExtra.id}` : "/api/admin/extras";
      await apiRequest(editingExtra ? "PATCH" : "POST", path, {
        name,
        pricingMode: form.pricingMode,
        amountCents,
        financialRule: form.financialRule,
        sortOrder,
      });
      await refresh();
      closeDialog();
      toast({
        title: "Sucesso",
        description: editingExtra ? "Extra atualizado." : "Extra criado.",
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível guardar o Extra.");
    } finally {
      setPendingAction(null);
    }
  };

  const toggleExtra = async (extra: ExtraDefinition, isActive: boolean) => {
    setPendingAction(`toggle-${extra.id}`);
    try {
      await apiRequest("PATCH", `/api/admin/extras/${extra.id}`, { isActive });
      await refresh();
      toast({
        title: "Sucesso",
        description: isActive ? "Extra ativado." : "Extra desativado.",
      });
    } catch (error) {
      toast({
        title: "Erro",
        description: error instanceof Error ? error.message : "Não foi possível atualizar o Extra.",
        variant: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <Card className="border-white/10 bg-card text-white" data-testid="extras-manager">
      <CardHeader className="border-b border-white/10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-5 w-5 text-primary" /> Catálogo de Extras
            </CardTitle>
            <p className="mt-2 max-w-2xl text-sm text-gray-400">
              Defina os Extras disponíveis nesta localização, o tipo de valor e a distribuição financeira.
            </p>
          </div>
          <Button variant="gold" className="w-full gap-2 sm:w-auto" onClick={openCreateDialog}>
            <Plus className="h-4 w-4" /> Novo Extra
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin text-primary" /> A carregar Extras...
          </div>
        ) : isError ? (
          <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
            <p>Não foi possível carregar os Extras desta localização.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : extras.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/15 p-8 text-center text-sm text-gray-400">
            Ainda não existem Extras nesta localização.
          </div>
        ) : (
          <div className="space-y-3">
            {extras.map((extra) => (
              <div
                key={extra.id}
                data-testid={`extra-card-${extra.id}`}
                className={`flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
                  extra.isActive
                    ? "border-white/10 bg-background/50"
                    : "border-white/5 bg-background/20 opacity-70"
                }`}
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words font-semibold text-white">{extra.name}</h3>
                    <Badge
                      variant={extra.isActive ? "default" : "outline"}
                      className={extra.isActive ? "" : "border-gray-500 text-gray-300"}
                    >
                      {extra.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-1 text-sm text-gray-300 sm:flex-row sm:flex-wrap sm:gap-x-4">
                    <span className="font-semibold text-primary">
                      {extra.pricingMode === "fixed"
                        ? euroFormatter.format(extra.amountCents! / 100)
                        : "Valor definido na marcação"}
                    </span>
                    <span>{extra.pricingMode === "fixed" ? "Valor fixo" : "Variável por marcação"}</span>
                    <span data-testid={`extra-financial-rule-${extra.id}`}>
                      {financialRuleLabels[extra.financialRule]}
                    </span>
                    <span className="text-gray-500">Ordem: {extra.sortOrder}</span>
                  </div>
                </div>

                <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:flex-nowrap sm:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-2 sm:flex-none"
                    disabled={pendingAction !== null}
                    onClick={() => openEditDialog(extra)}
                    aria-label={`Editar ${extra.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </Button>
                  <label className="flex min-h-9 items-center gap-2 text-xs text-gray-300">
                    <Switch
                      checked={extra.isActive}
                      disabled={pendingAction !== null}
                      aria-label={`${extra.isActive ? "Desativar" : "Ativar"} ${extra.name}`}
                      onCheckedChange={(isActive) => void toggleExtra(extra, isActive)}
                    />
                    {pendingAction === `toggle-${extra.id}`
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : extra.isActive ? "Ativo" : "Inativo"}
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent
          mobileViewportAware
          className="w-[calc(100vw-1rem)] max-w-lg overflow-y-auto border-white/10 bg-card text-white"
        >
          <DialogHeader>
            <DialogTitle>{editingExtra ? "Editar Extra" : "Novo Extra"}</DialogTitle>
            <DialogDescription className="text-gray-400">
              O Extra fica disponível apenas na localização ativa. A ordem mais baixa aparece primeiro.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveExtra();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="extra-name">Nome</Label>
              <Input
                id="extra-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                maxLength={100}
                required
                autoFocus
                className="border-white/10 bg-background text-white"
              />
            </div>

            <div className="space-y-3">
              <Label>Tipo de valor</Label>
              <RadioGroup
                value={form.pricingMode}
                onValueChange={(pricingMode: ExtraPricingMode) => setForm((current) => ({
                  ...current,
                  pricingMode,
                  amountEuros: "",
                }))}
                className="grid gap-3 sm:grid-cols-2"
              >
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-background px-3 py-2">
                  <RadioGroupItem value="fixed" id="extra-pricing-fixed" />
                  <span>Fixo</span>
                </label>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-background px-3 py-2">
                  <RadioGroupItem value="variable" id="extra-pricing-variable" />
                  <span>Variável por marcação</span>
                </label>
              </RadioGroup>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {form.pricingMode === "fixed" ? (
                <div className="space-y-2">
                  <Label htmlFor="extra-amount">Valor (€)</Label>
                  <Input
                    id="extra-amount"
                    inputMode="decimal"
                    value={form.amountEuros}
                    onChange={(event) => setForm((current) => ({ ...current, amountEuros: event.target.value }))}
                    placeholder="Ex.: 5,00"
                    required
                    className="border-white/10 bg-background text-white"
                  />
                </div>
              ) : (
                <div className="flex min-h-12 items-center rounded-lg border border-white/10 bg-background/50 px-3 text-sm text-gray-300">
                  Valor definido na marcação
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="extra-sort-order">Ordem</Label>
                <Input
                  id="extra-sort-order"
                  type="number"
                  min={0}
                  step={1}
                  value={form.sortOrder}
                  onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
                  required
                  className="border-white/10 bg-background text-white"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="extra-financial-rule">Regra financeira</Label>
              <Select
                value={form.financialRule}
                onValueChange={(financialRule: ExtraFinancialRule) => {
                  setForm((current) => ({ ...current, financialRule }));
                }}
              >
                <SelectTrigger id="extra-financial-rule" className="border-white/10 bg-background text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(financialRuleLabels) as Array<[ExtraFinancialRule, string]>).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formError && (
              <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                {formError}
              </p>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={pendingAction !== null}>
                Cancelar
              </Button>
              <Button type="submit" variant="gold" disabled={pendingAction !== null}>
                {pendingAction && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingExtra ? "Guardar alterações" : "Criar Extra"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
