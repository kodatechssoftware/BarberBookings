import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, Loader2, Mail, Settings2, TimerReset } from "lucide-react";
import type {
  RequestNotificationSettingsInput,
  RequestNotificationSettingsResponse,
} from "@shared/admin-notifications";
import { Button } from "@/components/ui/button-custom";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { locationHeaders } from "@/lib/location-context";
import { useToast } from "@/hooks/use-toast";

export function RequestNotificationSettingsDialog({ locationId }: { locationId: number }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RequestNotificationSettingsInput | null>(null);
  const { toast } = useToast();
  const queryKey = ["request-notification-settings", locationId];
  const { data, isLoading, isError } = useQuery<RequestNotificationSettingsResponse>({
    queryKey,
    enabled: open,
    queryFn: async () => {
      const response = await apiFetch("/api/admin/request-notification-settings", {
        headers: locationHeaders(locationId),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Não foi possível carregar a configuração.");
      return response.json();
    },
  });
  useEffect(() => {
    if (!data || !open) return;
    setDraft({
      emailEnabled: data.emailEnabled,
      reminderEnabled: data.reminderEnabled,
      reminderDelayMinutes: data.reminderDelayMinutes,
      respectOpeningHours: data.respectOpeningHours,
      recipients: data.recipients.map((recipient) => ({
        userId: recipient.userId,
        isActive: recipient.isActive,
        newRequestEmail: recipient.newRequestEmail,
        pendingReminderEmail: recipient.pendingReminderEmail,
      })),
    });
  }, [data, open]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Configuração indisponível.");
      const response = await apiRequest("PUT", "/api/admin/request-notification-settings", draft, {
        headers: locationHeaders(locationId),
      });
      return response.json() as Promise<RequestNotificationSettingsResponse>;
    },
    onSuccess: async (next) => {
      queryClient.setQueryData(queryKey, next);
      setOpen(false);
      toast({ title: "Alertas atualizados", description: "A configuração desta localização foi guardada." });
    },
    onError: (error: Error) => toast({
      title: "Não foi possível guardar os alertas",
      description: error.message,
      variant: "destructive",
    }),
  });

  const updateRecipient = (userId: number, patch: Partial<RequestNotificationSettingsInput["recipients"][number]>) => {
    setDraft((current) => current ? {
      ...current,
      recipients: current.recipients.map((recipient) => recipient.userId === userId
        ? { ...recipient, ...patch }
        : recipient),
    } : current);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setDraft(null); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2 border-white/10">
          <Settings2 className="h-4 w-4" /> Configurar alertas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-white/10 bg-card text-white">
        <DialogHeader>
          <DialogTitle>Alertas de novos pedidos</DialogTitle>
          <DialogDescription className="text-gray-400">
            Escolha quem recebe os avisos desta localização. As notificações no painel permanecem disponíveis aos utilizadores autorizados.
          </DialogDescription>
        </DialogHeader>
        {isLoading || !draft || !data ? (
          <div className="flex min-h-48 items-center justify-center">
            {isError ? <p className="text-sm text-red-300">Não foi possível carregar a configuração.</p> : <Loader2 className="h-7 w-7 animate-spin text-primary" />}
          </div>
        ) : (
          <div className="space-y-5">
            {!data.externalEmailRuntimeEnabled && (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-100">
                O envio externo está desligado nesta instalação. Pode preparar a configuração sem enviar e-mails.
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-start gap-3 rounded-xl border border-white/10 p-4">
                <Switch
                  checked={draft.emailEnabled}
                  onCheckedChange={(emailEnabled) => setDraft({ ...draft, emailEnabled })}
                  aria-label="Ativar alertas por e-mail"
                />
                <span><strong className="flex items-center gap-2 text-sm"><Mail className="h-4 w-4" /> E-mail para novos pedidos</strong><small className="mt-1 block text-gray-400">Só será enviado quando o interruptor global também estiver ativo.</small></span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-white/10 p-4">
                <Switch
                  checked={draft.reminderEnabled}
                  onCheckedChange={(reminderEnabled) => setDraft({ ...draft, reminderEnabled })}
                  aria-label="Ativar lembrete de pedidos pendentes"
                />
                <span><strong className="flex items-center gap-2 text-sm"><TimerReset className="h-4 w-4" /> Lembrete de pedidos pendentes</strong><small className="mt-1 block text-gray-400">Cria um único lembrete enquanto o pedido aguarda decisão.</small></span>
              </label>
            </div>
            {draft.reminderEnabled && (
              <div className="grid gap-4 rounded-xl border border-white/10 p-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="request-reminder-delay">Lembrar após (minutos)</Label>
                  <Input
                    id="request-reminder-delay"
                    type="number"
                    min={5}
                    max={1440}
                    value={draft.reminderDelayMinutes}
                    onChange={(event) => setDraft({ ...draft, reminderDelayMinutes: Number(event.target.value) })}
                    className="border-white/10 bg-background"
                  />
                </div>
                <label className="flex items-center gap-3 self-end rounded-lg bg-background/40 p-3 text-sm">
                  <Checkbox
                    checked={draft.respectOpeningHours}
                    onCheckedChange={(checked) => setDraft({ ...draft, respectOpeningHours: checked === true })}
                  />
                  Respeitar o horário do estabelecimento
                </label>
              </div>
            )}
            <div className="space-y-3">
              <div><h3 className="font-semibold">Destinatários</h3><p className="text-xs text-gray-400">Apenas contas ativas com permissão para gerir marcações podem ser selecionadas.</p></div>
              {data.recipients.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-gray-400">Não existem utilizadores elegíveis.</p>
              ) : data.recipients.map((option) => {
                const recipient = draft.recipients.find((item) => item.userId === option.userId)!;
                return <div key={option.userId} className="rounded-xl border border-white/10 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0"><p className="font-medium">{option.displayName}</p><p className="truncate text-xs text-gray-400">{option.email}</p>{!option.eligible && <p className="mt-1 text-xs text-amber-300">Sem acesso ativo a esta localização</p>}</div>
                    <label className="flex items-center gap-2 text-sm"><Switch checked={recipient.isActive} disabled={!option.eligible} onCheckedChange={(isActive) => updateRecipient(option.userId, { isActive })} /> Receber alertas</label>
                  </div>
                  {recipient.isActive && option.eligible && <div className="mt-3 flex flex-wrap gap-4 border-t border-white/10 pt-3 text-sm">
                    <label className="flex items-center gap-2"><Checkbox checked={recipient.newRequestEmail} onCheckedChange={(checked) => updateRecipient(option.userId, { newRequestEmail: checked === true })} /> Novos pedidos</label>
                    <label className="flex items-center gap-2"><Checkbox checked={recipient.pendingReminderEmail} onCheckedChange={(checked) => updateRecipient(option.userId, { pendingReminderEmail: checked === true })} /> Lembretes</label>
                  </div>}
                </div>;
              })}
            </div>
            <div className="flex items-start gap-2 rounded-xl bg-primary/[0.06] p-3 text-xs text-gray-300">
              <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              Ler uma notificação não resolve o pedido. O contador de pedidos pendentes só diminui depois de uma decisão.
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="button" disabled={!draft || save.isPending || isError} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar alertas"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
