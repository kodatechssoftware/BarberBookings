import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Settings2, ShieldAlert } from "lucide-react";
import {
  beautyV2FeatureNames,
  type BeautyV2FeatureName,
  type BeautyV2FeatureSetting,
  type BeautyV2Features,
} from "@shared/business/v2-features";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { locationHeaders } from "@/lib/location-context";
import { queryClient } from "@/lib/queryClient";

type AdminFeatureResponse = {
  masterEnabled: boolean;
  settings: BeautyV2FeatureSetting[];
  effective: BeautyV2Features;
};

type PendingChange = {
  featureName: BeautyV2FeatureName;
  enabled: boolean;
};

const featurePresentation: Record<BeautyV2FeatureName, {
  label: string;
  description: string;
  warning?: string;
}> = {
  appointmentRequests: {
    label: "Pedidos de marcação",
    description: "Submete novas marcações para análise e decisão da equipa.",
    warning: "Ao desativar, o site deixa de aceitar novos pedidos sujeitos a aprovação.",
  },
  multiServiceAppointments: {
    label: "Vários serviços por marcação",
    description: "Permite selecionar vários serviços dentro do mesmo pedido ou marcação.",
  },
  parallelServiceScheduling: {
    label: "Serviços em simultâneo",
    description: "Disponibiliza o planeamento paralelo apenas para combinações compatíveis.",
  },
  notificationDeliveryStatus: {
    label: "Estado das comunicações",
    description: "Mostra falhas definitivas de WhatsApp e o acompanhamento manual no Admin.",
  },
  consultationRole: {
    label: "Perfil de consulta",
    description: "Permite atribuir acesso administrativo estritamente de leitura.",
    warning: "Ao desativar, os perfis de consulta perdem imediatamente o acesso protegido.",
  },
  teamProfiles: {
    label: "Perfis públicos da equipa",
    description: "Publica apenas perfis, qualificações e certificados previamente autorizados.",
    warning: "Ao desativar, todos os perfis públicos desta localização ficam imediatamente ocultos.",
  },
  googleReviews: {
    label: "Ligações para avaliações Google",
    description: "Apresenta as ligações oficiais configuradas para consultar e deixar avaliações.",
  },
};

const orderedFeatures: BeautyV2FeatureName[] = [
  "appointmentRequests",
  "multiServiceAppointments",
  "parallelServiceScheduling",
  "teamProfiles",
  "googleReviews",
  "notificationDeliveryStatus",
  "consultationRole",
];

export function BeautyV2FeatureSettings({
  locationId,
  locationName,
}: {
  locationId: number;
  locationName: string;
}) {
  const { toast } = useToast();
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [savingFeature, setSavingFeature] = useState<BeautyV2FeatureName | null>(null);
  const queryKey = ["/api/admin/beauty-v2/features", { locationId }];
  const { data, isLoading, error } = useQuery<AdminFeatureResponse>({
    queryKey,
    queryFn: async () => {
      const response = await apiFetch(`/api/admin/beauty-v2/features?locationId=${locationId}`, {
        cache: "no-store",
        headers: locationHeaders(locationId),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Não foi possível carregar as funcionalidades.");
      return payload;
    },
  });

  const locationOverrides = useMemo(() => new Map(
    (data?.settings ?? [])
      .filter((setting) => setting.locationId === locationId)
      .map((setting) => [setting.featureName, setting.enabled]),
  ), [data?.settings, locationId]);

  const applyChange = async () => {
    if (!pendingChange) return;
    const change = pendingChange;
    setPendingChange(null);
    setSavingFeature(change.featureName);
    try {
      const response = await apiFetch(`/api/admin/beauty-v2/features/${change.featureName}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...locationHeaders(locationId),
        },
        body: JSON.stringify({ enabled: change.enabled, locationId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Não foi possível alterar a funcionalidade.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["/api/beauty-v2/features"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] }),
      ]);
      toast({
        title: change.enabled ? "Funcionalidade ativada" : "Funcionalidade desativada",
        description: `${featurePresentation[change.featureName].label} foi atualizada apenas em ${locationName}.`,
      });
    } catch (updateError) {
      toast({
        title: "Não foi possível guardar",
        description: updateError instanceof Error ? updateError.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSavingFeature(null);
    }
  };

  return (
    <>
      <Card className="border-white/10 bg-card text-white" data-testid="beauty-v2-feature-settings">
        <CardHeader className="space-y-3">
          <CardTitle className="flex items-center gap-2 text-xl text-white">
            <Settings2 className="h-5 w-5 text-primary" aria-hidden="true" />
            Funcionalidades
          </CardTitle>
          <p className="max-w-3xl text-sm leading-relaxed text-gray-300">
            Consulte e altere as funcionalidades disponíveis em <strong className="text-white">{locationName}</strong>.
            Cada alteração exige confirmação e fica registada no histórico de auditoria.
          </p>
          {data && !data.masterEnabled ? (
            <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              O interruptor global da Beauty v2 está desligado. As opções abaixo ficam inativas até essa configuração ser autorizada no ambiente.
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-gray-300">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              A carregar funcionalidades…
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
              {error.message}
            </p>
          ) : null}
          {data ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {orderedFeatures.map((featureName) => {
                const presentation = featurePresentation[featureName];
                const enabled = data.effective[featureName];
                const isSaving = savingFeature === featureName;
                return (
                  <div
                    key={featureName}
                    className="flex min-w-0 items-start justify-between gap-4 rounded-xl border border-white/10 bg-background/40 p-4"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-white">{presentation.label}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${enabled ? "bg-emerald-500/15 text-emerald-200" : "bg-white/10 text-gray-300"}`}>
                          {enabled ? "Ativa" : "Inativa"}
                        </span>
                        {locationOverrides.has(featureName) ? (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Configuração local</span>
                        ) : null}
                      </div>
                      <p id={`feature-${featureName}-description`} className="mt-1 text-sm leading-6 text-gray-300">
                        {presentation.description}
                      </p>
                    </div>
                    <div className="flex min-h-11 shrink-0 items-center">
                      {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" aria-hidden="true" /> : null}
                      <Switch
                        checked={enabled}
                        disabled={!data.masterEnabled || savingFeature !== null}
                        onCheckedChange={(nextEnabled) => setPendingChange({ featureName, enabled: nextEnabled })}
                        aria-label={`${enabled ? "Desativar" : "Ativar"} ${presentation.label}`}
                        aria-describedby={`feature-${featureName}-description`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          {data?.masterEnabled ? (
            <p className="mt-4 flex items-center gap-2 text-xs leading-5 text-gray-400">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
              Nenhuma alteração é aplicada sem confirmação. As restantes localizações não são modificadas.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={pendingChange !== null} onOpenChange={(open) => { if (!open) setPendingChange(null); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-lg border-white/10 bg-card text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingChange?.enabled ? "Ativar" : "Desativar"} {pendingChange ? featurePresentation[pendingChange.featureName].label : "funcionalidade"}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left text-gray-300">
              <span className="block">Esta alteração aplica-se exclusivamente a <strong className="text-white">{locationName}</strong>.</span>
              {pendingChange && featurePresentation[pendingChange.featureName].warning ? (
                <span className="block text-amber-100">{featurePresentation[pendingChange.featureName].warning}</span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={applyChange} className={pendingChange?.enabled ? "" : "bg-red-600 text-white hover:bg-red-500"}>
              Confirmar alteração
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
