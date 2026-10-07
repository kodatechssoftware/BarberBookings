import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import type { ServiceCatalogueItem } from "@shared/schema";
import { Button } from "@/components/ui/button-custom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { moneyInputToCents } from "@/lib/money-input";
import { useActiveLocationId } from "@/lib/location-context";

type Props = {
  locationName?: string;
  onChanged?: () => void;
};

export function AssociateServiceDialog({ locationName, onChanged }: Props) {
  const activeLocationId = useActiveLocationId();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const { data: available = [], isLoading, isError } = useQuery<ServiceCatalogueItem[]>({
    queryKey: ["/api/admin/services/available", { locationId: activeLocationId }],
    enabled: open && activeLocationId !== null,
  });
  const selected = useMemo(
    () => available.find((service) => String(service.id) === serviceId),
    [available, serviceId],
  );

  useEffect(() => {
    if (!selected) return;
    setPrice(((selected.basePrice ?? selected.price) / 100).toFixed(2).replace(".", ","));
    setDuration(String(selected.baseDuration ?? selected.duration));
  }, [selected]);

  const reset = () => {
    setServiceId("");
    setPrice("");
    setDuration("");
  };

  const submit = async () => {
    if (savingRef.current || !selected) return;
    const priceOverride = moneyInputToCents(price);
    const durationOverride = Number(duration);
    if (priceOverride === null || !Number.isInteger(durationOverride) || durationOverride <= 0 || durationOverride > 720) {
      toast({ title: "Dados inválidos", description: "Confirme o preço e a duração nesta loja.", variant: "destructive" });
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    try {
      await apiRequest("POST", "/api/admin/service-locations", {
        serviceId: selected.id,
        priceOverride,
        durationOverride,
        isActive: true,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/services/available"] });
      onChanged?.();
      setOpen(false);
      reset();
      toast({ title: "Serviço associado", description: `O serviço está disponível em ${locationName || "esta loja"}.` });
    } catch (error: any) {
      toast({ title: "Erro", description: error?.message || "Não foi possível associar o serviço.", variant: "destructive" });
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next && savingRef.current) return;
      setOpen(next);
      if (!next) reset();
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Plus className="h-4 w-4" /> Associar serviço existente
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-white/10 bg-card text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Associar serviço a {locationName || "esta loja"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-3">
          <div className="space-y-2">
            <Label>Serviço global</Label>
            <Select value={serviceId} onValueChange={setServiceId} disabled={isLoading || isSaving}>
              <SelectTrigger className="border-white/10 bg-background text-white">
                <SelectValue placeholder={isLoading ? "A carregar..." : "Selecione um serviço"} />
              </SelectTrigger>
              <SelectContent>
                {available.map((service) => (
                  <SelectItem key={service.id} value={String(service.id)}>{service.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isError && <p className="text-sm text-red-300">Não foi possível carregar os serviços disponíveis.</p>}
            {!isLoading && !isError && available.length === 0 && (
              <p className="text-sm text-gray-400">Todos os serviços existentes já estão associados a esta loja.</p>
            )}
          </div>
          {selected && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="associate-service-price">Preço nesta loja (€)</Label>
                <Input id="associate-service-price" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
                <p className="text-xs text-gray-500">Base global: {((selected.basePrice ?? selected.price) / 100).toFixed(2)} €</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="associate-service-duration">Duração nesta loja (min)</Label>
                <Input id="associate-service-duration" type="number" min={1} max={720} value={duration} onChange={(event) => setDuration(event.target.value)} />
                <p className="text-xs text-gray-500">Base global: {selected.baseDuration ?? selected.duration} min</p>
              </div>
            </div>
          )}
          <Button className="w-full" variant="gold" disabled={!selected || isSaving || isLoading} onClick={submit}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Associar nesta loja
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
