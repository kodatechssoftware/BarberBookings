import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ExternalLink, MapPin, Pencil, Plus } from "lucide-react";
import type { ShopLocation } from "@shared/locations";
import { resolveLocationMapLinks } from "@shared/location-maps";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent } from "@/components/ui/card";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

type LocationForm = {
  name: string;
  address: string;
  logoUrl: string;
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
  logoUrl: "",
  mapUrl: "",
  mapEmbedUrl: "",
  phone: "",
  email: "",
  timezone: "Europe/Lisbon",
  isActive: false,
};

type LocationsTabProps = {
  maxLocations: number;
  mode?: "single" | "multiple";
};

export function LocationsTab({ maxLocations, mode = "multiple" }: LocationsTabProps) {
  const isSingleLocation = mode === "single";
  const { toast } = useToast();
  const [editing, setEditing] = useState<ShopLocation | null>(null);
  const [open, setOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customMapEnabled, setCustomMapEnabled] = useState(false);
  const [automaticMapConfirmationOpen, setAutomaticMapConfirmationOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [form, setForm] = useState<LocationForm>(emptyForm);
  const hasCustomMapLinks = Boolean(form.mapUrl.trim() || form.mapEmbedUrl.trim());
  const showCustomMapAddressWarning = Boolean(
    isSingleLocation
      && editing
      && form.address.trim() !== editing.address.trim()
      && hasCustomMapLinks,
  );
  const { data: locations = [], isLoading } = useQuery<ShopLocation[]>({
    queryKey: ["/api/admin/locations"],
  });

  const openCreate = () => {
    setEditing(null);
    setAdvancedOpen(false);
    setCustomMapEnabled(false);
    setAutomaticMapConfirmationOpen(false);
    setForm({ ...emptyForm, timezone: locations.find((location) => location.isDefault)?.timezone ?? emptyForm.timezone });
    setOpen(true);
  };

  const openEdit = (location: ShopLocation) => {
    setEditing(location);
    setAdvancedOpen(false);
    setCustomMapEnabled(Boolean(location.mapUrl?.trim() || location.mapEmbedUrl?.trim()));
    setAutomaticMapConfirmationOpen(false);
    setForm({
      name: location.name,
      address: location.address,
      logoUrl: location.logoUrl || "",
      mapUrl: location.mapUrl || "",
      mapEmbedUrl: location.mapEmbedUrl || "",
      phone: location.phone || "",
      email: location.email || "",
      timezone: location.timezone,
      isActive: location.isActive,
    });
    setOpen(true);
  };

  const requestAutomaticMap = () => {
    if (!hasCustomMapLinks) {
      setCustomMapEnabled(false);
      return;
    }
    setAutomaticMapConfirmationOpen(true);
  };

  const useAutomaticMap = () => {
    setForm((current) => ({ ...current, mapUrl: "", mapEmbedUrl: "" }));
    setCustomMapEnabled(false);
    setAutomaticMapConfirmationOpen(false);
  };

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const path = editing ? `/api/admin/locations/${editing.id}` : "/api/admin/locations";
      const { isActive: _isActive, ...singleLocationForm } = form;
      await apiRequest(editing ? "PATCH" : "POST", path, isSingleLocation ? singleLocationForm : form);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/locations"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/account/locations"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/locations"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/locations?purpose=booking"] }),
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
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">{isSingleLocation ? "Estabelecimento" : "Localizações"}</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">
            {isSingleLocation
              ? "Atualize os dados públicos, a morada e o mapa do estabelecimento."
              : "Configure as lojas da barbearia. Uma nova localização fica oculta até ser ativada."}
          </p>
        </div>
        {!isSingleLocation && <Button
          variant="gold"
          onClick={openCreate}
          disabled={locations.length >= maxLocations}
        >
          <Plus className="mr-2 h-4 w-4" /> Nova localização
        </Button>}
      </div>

      {!isSingleLocation && <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-gray-400">
        {locations.length} de {maxLocations} localizações utilizadas neste plano.
      </div>}

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
                  <Button variant="outline" size="sm" aria-label={`Editar ${location.name}`} onClick={() => openEdit(location)}>
                    <Pencil className="mr-2 h-4 w-4" /> Editar
                  </Button>
                </div>
                {(location.mapUrl || location.address.trim()) && (
                  <a href={resolveLocationMapLinks(location).mapUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center text-sm text-primary hover:underline">
                    <MapPin className="mr-1.5 h-4 w-4" /> Ver mapa <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (!nextOpen && savingRef.current) return;
        if (!nextOpen) {
          setAdvancedOpen(false);
          setAutomaticMapConfirmationOpen(false);
        }
        setOpen(nextOpen);
      }}>
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
              <p className="text-xs leading-relaxed text-gray-400">
                {isSingleLocation
                  ? "Usamos esta morada no site e no Google Maps."
                  : hasCustomMapLinks
                  ? "Esta localização usa ligações personalizadas. Para usar apenas a morada, reponha o mapa automático nas opções avançadas."
                  : "O mapa e a ligação para o Google Maps são gerados automaticamente a partir desta morada. Confirme a localização no mapa depois de guardar."}
              </p>
              {showCustomMapAddressWarning && (
                <p role="status" className="rounded-md border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-xs leading-relaxed text-amber-100">
                  Os links personalizados podem continuar a apontar para a morada anterior. Pode mantê-los ou usar o mapa automático.
                </p>
              )}
            </div>
            {!isSingleLocation && <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="location-logo-url">Logótipo da localização</Label>
              <Input
                id="location-logo-url"
                value={form.logoUrl}
                onChange={(event) => setForm({ ...form, logoUrl: event.target.value })}
                placeholder="Opcional — usa o logótipo principal quando vazio"
                maxLength={1000}
              />
              <p className="text-xs leading-relaxed text-gray-400">
                Utilize um caminho local iniciado por / ou um endereço HTTP(S).
              </p>
            </div>}
            <div className="space-y-2">
              <Label htmlFor="location-phone">Telefone</Label>
              <Input id="location-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Opcional" maxLength={40} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location-email">Email</Label>
              <Input id="location-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Opcional" maxLength={120} />
            </div>
            <details
              open={isSingleLocation ? advancedOpen : undefined}
              onToggle={(event) => {
                if (isSingleLocation) setAdvancedOpen(event.currentTarget.open);
              }}
              className="min-w-0 rounded-lg border border-white/10 p-4 sm:col-span-2"
            >
              <summary className="cursor-pointer text-sm font-medium text-gray-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                {isSingleLocation
                  ? "Opções avançadas (opcional)"
                  : `Opções avançadas do mapa${hasCustomMapLinks ? " — ligações personalizadas" : " (opcional)"}`}
              </summary>
              <div className="mt-4 space-y-4">
                {isSingleLocation && <div className="space-y-2">
                  <Label htmlFor="location-logo-url">Logótipo da localização</Label>
                  <Input
                    id="location-logo-url"
                    value={form.logoUrl}
                    onChange={(event) => setForm({ ...form, logoUrl: event.target.value })}
                    placeholder="Opcional — usa o logótipo principal quando vazio"
                    maxLength={1000}
                  />
                  <p className="text-xs leading-relaxed text-gray-400">
                    Caminho local ou endereço HTTP(S).
                  </p>
                </div>}
                {isSingleLocation ? (
                  <div className="space-y-4 rounded-lg border border-white/10 bg-white/[0.02] p-4">
                    <div>
                      <p className="text-sm font-semibold text-white">Localização no Google Maps</p>
                      <p className="mt-1 text-xs leading-relaxed text-gray-400">
                        <strong className="font-semibold text-gray-300">Mapa automático (recomendado).</strong>{" "}
                        O mapa é gerado a partir da morada do estabelecimento.
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="location-custom-map-enabled" className="cursor-pointer text-sm text-gray-300">
                        Utilizar localização personalizada
                      </Label>
                      <Switch
                        id="location-custom-map-enabled"
                        checked={customMapEnabled}
                        onCheckedChange={(checked) => {
                          if (checked) setCustomMapEnabled(true);
                          else requestAutomaticMap();
                        }}
                      />
                    </div>
                    {customMapEnabled && (
                      <div className="space-y-4 border-t border-white/10 pt-4">
                        <div className="space-y-2">
                          <Label htmlFor="location-map-url">Link do Google Maps</Label>
                          <Input id="location-map-url" value={form.mapUrl} onChange={(event) => setForm({ ...form, mapUrl: event.target.value })} placeholder="Opcional — link para abrir o mapa" maxLength={1000} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="location-map-embed">Link de incorporação do mapa</Label>
                          <Input id="location-map-embed" value={form.mapEmbedUrl} onChange={(event) => setForm({ ...form, mapEmbedUrl: event.target.value })} placeholder="Opcional — link para apresentar o mapa" maxLength={1000} />
                          <p className="text-xs leading-relaxed text-gray-500">Cole o endereço «src» obtido em Partilhar → Incorporar um mapa.</p>
                        </div>
                        {hasCustomMapLinks && (
                          <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={requestAutomaticMap}>
                            Usar mapa automático
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="text-xs leading-relaxed text-gray-400">
                      Só precisa destas ligações se o Google Maps não localizar corretamente a entrada.
                      Cada campo vazio usa automaticamente a morada.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="location-map-url">Link do Google Maps</Label>
                      <Input id="location-map-url" value={form.mapUrl} onChange={(event) => setForm({ ...form, mapUrl: event.target.value })} placeholder="Opcional — gerado a partir da morada" maxLength={1000} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="location-map-embed">Link de incorporação do mapa</Label>
                      <Input id="location-map-embed" value={form.mapEmbedUrl} onChange={(event) => setForm({ ...form, mapEmbedUrl: event.target.value })} placeholder="Opcional — https://www.google.com/maps/embed?..." maxLength={1000} />
                      <p className="text-xs leading-relaxed text-gray-500">No Google Maps, utilize Partilhar → Incorporar um mapa e copie apenas o endereço de «src».</p>
                    </div>
                    {hasCustomMapLinks && (
                      <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setForm({ ...form, mapUrl: "", mapEmbedUrl: "" })}>
                        Usar apenas a morada
                      </Button>
                    )}
                  </>
                )}
              </div>
            </details>
            {editing && !isSingleLocation && (
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
      <AlertDialog open={automaticMapConfirmationOpen} onOpenChange={setAutomaticMapConfirmationOpen}>
        <AlertDialogContent className="border-white/10 bg-card text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Usar mapa automático?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              Os dois links personalizados serão limpos. O logótipo e os restantes dados do estabelecimento não serão alterados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-background text-white hover:bg-white/10">
              Manter localização personalizada
            </AlertDialogCancel>
            <AlertDialogAction onClick={useAutomaticMap}>Usar mapa automático</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
