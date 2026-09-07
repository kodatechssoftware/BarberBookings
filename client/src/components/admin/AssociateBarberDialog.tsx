import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveLocationId } from "@/lib/location-context";
import { Button } from "@/components/ui/button-custom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export function AssociateBarberDialog() {
  const [open, setOpen] = useState(false);
  const [barberId, setBarberId] = useState("");
  const [saving, setSaving] = useState(false);
  const locationId = useActiveLocationId();
  const { toast } = useToast();
  const { data: barbers = [], isLoading, isError } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/admin/available-barbers", { locationId }], enabled: open, staleTime: 0,
  });
  async function associate() {
    setSaving(true);
    try {
      await apiRequest("POST", "/api/admin/location-barbers", { barberId: Number(barberId) });
      await Promise.all(["/api/barbers", "/api/account/locations", "/api/locations?purpose=booking", "/api/admin/available-barbers", "/api/admin/audit-logs"]
        .map((path) => queryClient.invalidateQueries({ queryKey: [path] })));
      setOpen(false);
      setBarberId("");
      toast({ title: "Barbeiro associado", description: "Configure os serviços e o horário do barbeiro nesta loja." });
    } catch (error) {
      toast({ title: "Não foi possível associar", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" });
    } finally { setSaving(false); }
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline">Associar barbeiro existente</Button></DialogTrigger>
    <DialogContent className="w-[95vw] max-w-lg border-white/10 bg-card text-white">
      <DialogHeader><DialogTitle>Associar barbeiro a esta loja</DialogTitle>
        <DialogDescription>O perfil, o acesso e as condições financeiras são comuns às lojas. Os serviços e o horário são configurados em cada loja.</DialogDescription>
      </DialogHeader>
      {isLoading ? <p>A carregar equipa…</p> : isError ? <p>Não foi possível carregar a equipa.</p> : barbers.length === 0 ?
        <p className="text-sm text-gray-400">Não existem outros barbeiros disponíveis para associar.</p> :
        <Select value={barberId} onValueChange={setBarberId}>
          <SelectTrigger aria-label="Barbeiro a associar"><SelectValue placeholder="Escolha o barbeiro" /></SelectTrigger>
          <SelectContent>{barbers.map((barber) => <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>)}</SelectContent>
        </Select>}
      <Button variant="gold" disabled={!barberId || saving} onClick={associate}>{saving ? "A associar…" : "Associar à loja"}</Button>
    </DialogContent>
  </Dialog>;
}
