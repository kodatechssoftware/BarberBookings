import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveLocationId } from "@/lib/location-context";
import { Button } from "@/components/ui/button-custom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useBusinessCopy } from "@/business/use-business-copy";

export function AssociateBarberDialog() {
  const copy = useBusinessCopy().admin.team;
  const [open, setOpen] = useState(false);
  const [barberId, setBarberId] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const locationId = useActiveLocationId();
  const { toast } = useToast();
  const { data: barbers = [], isLoading, isError } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/admin/available-barbers", { locationId }], enabled: open, staleTime: 0,
  });
  async function associate() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await apiRequest("POST", "/api/admin/location-barbers", { barberId: Number(barberId) });
      await Promise.all(["/api/barbers", "/api/account/locations", "/api/locations?purpose=booking", "/api/admin/available-barbers", "/api/admin/audit-logs"]
        .map((path) => queryClient.invalidateQueries({ queryKey: [path] })));
      setOpen(false);
      setBarberId("");
      toast({ title: copy.associateSuccessTitle, description: copy.associateSuccessDescription });
    } catch (error) {
      toast({ title: copy.associateErrorTitle, description: error instanceof Error ? error.message : copy.associateErrorFallback, variant: "destructive" });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return <Dialog open={open} onOpenChange={(nextOpen) => {
    if (!nextOpen && savingRef.current) return;
    setOpen(nextOpen);
  }}>
    <DialogTrigger asChild><Button variant="outline">{copy.associateTrigger}</Button></DialogTrigger>
    <DialogContent className="w-[95vw] max-w-lg border-white/10 bg-card text-white">
      <DialogHeader><DialogTitle>{copy.associateTitle}</DialogTitle>
        <DialogDescription>{copy.associateDescription}</DialogDescription>
      </DialogHeader>
      {isLoading ? <p>{copy.associateLoading}</p> : isError ? <p>{copy.associateLoadError}</p> : barbers.length === 0 ?
        <p className="text-sm text-gray-400">{copy.associateEmpty}</p> :
        <Select value={barberId} onValueChange={setBarberId}>
          <SelectTrigger aria-label={copy.associateAria}><SelectValue placeholder={copy.associatePlaceholder} /></SelectTrigger>
          <SelectContent>{barbers.map((barber) => <SelectItem key={barber.id} value={String(barber.id)}>{barber.name}</SelectItem>)}</SelectContent>
        </Select>}
      <Button variant="gold" disabled={!barberId || saving} onClick={associate}>{saving ? copy.associatePending : copy.associateAction}</Button>
    </DialogContent>
  </Dialog>;
}
