import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { apiFetch } from "@/lib/api";
import { locationHeaders } from "@/lib/location-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ServiceOption = { id: number; name: string; isVisible?: boolean | null; isActive?: boolean | null };
type Pair = { firstServiceId: number; secondServiceId: number };

function pairKey(left: number, right: number) {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

export function ParallelServiceCompatibilityManager({
  locationId,
  services,
  canManage,
}: {
  locationId: number;
  services: readonly ServiceOption[];
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const queryKey = ["/api/admin/parallel-service-compatibilities", { locationId }];
  const { data, isLoading, isError } = useQuery<{ pairs: Pair[] }>({
    queryKey,
    queryFn: async () => {
      const response = await apiFetch("/api/admin/parallel-service-compatibilities", {
        cache: "no-store",
        headers: locationHeaders(locationId),
      });
      if (!response.ok) throw new Error("Não foi possível carregar as compatibilidades.");
      return response.json();
    },
    enabled: locationId > 0,
  });
  useEffect(() => {
    if (!data || dirty) return;
    setSelected(new Set(data.pairs.map((pair) => pairKey(pair.firstServiceId, pair.secondServiceId))));
  }, [data, dirty]);
  useEffect(() => {
    setDirty(false);
    setSelected(new Set());
  }, [locationId]);

  const activeServices = useMemo(() => services.filter((service) =>
    service.isVisible !== false && service.isActive !== false), [services]);
  const pairs = useMemo(() => activeServices.flatMap((first, index) =>
    activeServices.slice(index + 1).map((second) => ({ first, second, key: pairKey(first.id, second.id) }))), [activeServices]);

  const toggle = (key: string, enabled: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (enabled) next.add(key); else next.delete(key);
      return next;
    });
    setDirty(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      const payload = Array.from(selected).map((key) => {
        const [firstServiceId, secondServiceId] = key.split(":").map(Number);
        return { firstServiceId, secondServiceId };
      });
      await apiRequest("PUT", "/api/admin/parallel-service-compatibilities", { pairs: payload }, {
        headers: locationHeaders(locationId),
      });
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
      setDirty(false);
      toast({ title: "Compatibilidades guardadas", description: "Os próximos pedidos utilizarão esta configuração." });
    } catch (error) {
      toast({
        title: "Não foi possível guardar",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return <Card className="mb-6 border-primary/20 bg-card text-white" data-testid="parallel-service-compatibilities">
    <CardHeader className="space-y-2">
      <CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="h-5 w-5 text-primary" /> Serviços em simultâneo</CardTitle>
      <p className="text-sm leading-relaxed text-gray-400">
        Autorize apenas pares de serviços que possam decorrer ao mesmo tempo. Para combinar três serviços, os três pares têm de estar autorizados.
      </p>
    </CardHeader>
    <CardContent>
      {isLoading ? <div className="flex min-h-24 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        : isError ? <p className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">Não foi possível carregar as compatibilidades.</p>
        : pairs.length === 0 ? <p className="text-sm text-gray-400">São necessários pelo menos dois serviços ativos neste estabelecimento.</p>
        : <div className="grid gap-2 md:grid-cols-2">{pairs.map(({ first, second, key }) => <label
          key={key}
          className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-background/40 p-3 text-sm hover:border-primary/30"
        >
          <Checkbox
            checked={selected.has(key)}
            disabled={!canManage || saving}
            onCheckedChange={(checked) => toggle(key, checked === true)}
            aria-label={`${first.name} e ${second.name} podem decorrer em simultâneo`}
          />
          <span><strong className="text-white">{first.name}</strong><span className="mx-1.5 text-gray-500">+</span><strong className="text-white">{second.name}</strong></span>
        </label>)}</div>}
      {canManage && pairs.length > 0 && <div className="mt-4 flex justify-end">
        <Button variant="gold" disabled={!dirty || saving} onClick={save}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar compatibilidades
        </Button>
      </div>}
    </CardContent>
  </Card>;
}
