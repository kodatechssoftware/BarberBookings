import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ExternalLink, MapPin, Pencil, Plus } from "lucide-react";
import type { ShopLocation } from "@shared/locations";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

type LocationForm = {
  name: string;
  address: string;
  mapUrl: string;
  mapEmbedUrl: string;
  phone: string;
  email: string;
  timezone: string;
  isActive: boolean;
};

const emptyForm: LocationForm = {
  name: "",
  address: "",
  mapUrl: "",
  mapEmbedUrl: "",
  phone: "",
  email: "",
  timezone: "Europe/Lisbon",
  isActive: false,
};

export function LocationsTab({ maxLocations }: { maxLocations: number }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<ShopLocation | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<LocationForm>(emptyForm);
  const { data: locations = [], isLoading } = useQuery<ShopLocation[]>({
    queryKey: ["/api/admin/locations"],
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (location: ShopLocation) => {
    setEditing(location);
    setForm({
      name: location.name,
      address: location.address,
      mapUrl: location.mapUrl || "",
      mapEmbedUrl: location.mapEmbedUrl || "",
      phone: location.phone || "",
      email: location.email || "",
      timezone: location.timezone,
      isActive: location.isActive,
    });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const path = editing ? `/api/admin/locations/${editing.id}` : "/api/admin/locations";
      await apiRequest(editing ? "PATCH" : "POST", path, form);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/locations"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/locations"] }),
      ]);
      setOpen(false);
      toast({
        title: editing ? "Localização atualizada" : "Localização criada",
        description: editing
          ? "As informações da localização foram guardadas."
          : "A localização foi criada como rascunho e está oculta dos clientes.",
      });
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Localizações</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">
            Configure as lojas da barbearia. Uma nova localização fica oculta até ser ativada.
          </p>
        </div>
        <Button
          variant="gold"
          onClick={openCreate}
          disabled={locations.length >= maxLocations}
        >
          <Plus className="mr-2 h-4 w-4" /> Nova localização
        </Button>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-gray-400">
        {locations.length} de {maxLocations} localizações utilizadas neste plano.
      </div>

      {isLoading ? (
        <div className="h-36 animate-pulse rounded-xl border border-white/10 bg-card" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {locations.map((location) => (
            <Card key={location.id} className="border-white/10 bg-card text-white">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Building2 className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold">{location.name}</h3>
                        {location.isDefault && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Principal</span>}
                        <span className={`rounded-full px-2 py-0.5 text-xs ${location.isActive ? "bg-emerald-500/10 text-emerald-300" : "bg-white/5 text-gray-400"}`}>
                          {location.isActive ? "Visível" : "Rascunho"}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-gray-400">{location.address}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => openEdit(location)}>
                    <Pencil className="mr-2 h-4 w-4" /> Editar
                  </Button>
                </div>
                {location.mapUrl && (
                  <a href={location.mapUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center text-sm text-primary hover:underline">
                    <MapPin className="mr-1.5 h-4 w-4" /> Ver mapa <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-card text-white sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar localização" : "Nova localização"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="location-name">Nome da localização</Label>
              <Input id="location-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Loja de Paranhos" maxLength={120} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="location-address">Morada completa</Label>
              <Input id="location-address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Rua, número, código postal e localidade" maxLength={300} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="location-map-url">Link do Google Maps</Label>
              <Input id="location-map-url" value={form.mapUrl} onChange={(event) => setForm({ ...form, mapUrl: event.target.value })} placeholder="https://maps.google.com/..." />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="location-map-embed">Link de incorporação do mapa</Label>
              <Input id="location-map-embed" value={form.mapEmbedUrl} onChange={(event) => setForm({ ...form, mapEmbedUrl: event.target.value })} placeholder="https://www.google.com/maps/embed?..." />
              <p className="text-xs text-gray-500">No Google Maps, utilize Partilhar → Incorporar um mapa e copie apenas o endereço de `src`.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="location-phone">Telefone</Label>
              <Input id="location-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Opcional" maxLength={40} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location-email">Email</Label>
              <Input id="location-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Opcional" maxLength={120} />
            </div>
            {editing && (
              <div className="flex items-center justify-between rounded-lg border border-white/10 p-4 sm:col-span-2">
                <div>
                  <p className="font-semibold">Visível no site</p>
                  <p className="text-xs text-gray-400">Mostra esta localização publicamente na secção de moradas.</p>
                </div>
                <Switch
                  checked={form.isActive}
                  disabled={editing.isDefault}
                  onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
                />
              </div>
            )}
          </div>
          <Button variant="gold" className="w-full" onClick={save} disabled={saving || !form.name.trim() || !form.address.trim()}>
            {saving ? "A guardar..." : "Guardar localização"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

