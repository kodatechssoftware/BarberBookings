import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Save, Star } from "lucide-react";
import {
  googleReviewSettingsUpdateSchema,
  toPublicGoogleReviewsPresentation,
  type AdminGoogleReviewSettings,
} from "@shared/google-reviews";
import { GoogleReviewsSection } from "@/components/public/GoogleReviewsSection";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { locationHeaders } from "@/lib/location-context";
import { queryClient } from "@/lib/queryClient";

type FormState = {
  googlePlaceId: string;
  googleMapsUrl: string;
  googleReviewRequestUrl: string;
};

const emptyForm: FormState = { googlePlaceId: "", googleMapsUrl: "", googleReviewRequestUrl: "" };

export function GoogleReviewsSettings({ locationId }: { locationId: number }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const { data, isLoading, error } = useQuery<AdminGoogleReviewSettings>({
    queryKey: ["/api/admin/google-reviews", { locationId }],
    queryFn: async () => {
      const response = await apiFetch("/api/admin/google-reviews", {
        cache: "no-store",
        headers: locationHeaders(locationId),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "Não foi possível carregar a configuração.");
      return response.json();
    },
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      googlePlaceId: data.googlePlaceId ?? "",
      googleMapsUrl: data.googleMapsUrl,
      googleReviewRequestUrl: data.googleReviewRequestUrl,
    });
  }, [data]);

  const parsed = useMemo(() => googleReviewSettingsUpdateSchema.safeParse(form), [form]);
  const preview = parsed.success ? toPublicGoogleReviewsPresentation(parsed.data) : null;

  const save = async () => {
    if (!parsed.success) {
      toast({ title: "Verifique as ligações", description: parsed.error.issues[0]?.message, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const response = await apiFetch("/api/admin/google-reviews", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...locationHeaders(locationId) },
        body: JSON.stringify(parsed.data),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Não foi possível guardar a configuração.");
      queryClient.setQueryData(["/api/admin/google-reviews", { locationId }], payload);
      await queryClient.invalidateQueries({ queryKey: ["/api/public/google-reviews"] });
      toast({ title: "Configuração guardada", description: "As ligações oficiais ficam disponíveis no site público." });
    } catch (saveError) {
      toast({ title: "Não foi possível guardar", description: saveError instanceof Error ? saveError.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-6 border-white/10 bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white"><Star className="h-5 w-5 text-primary" /> Avaliações Google</CardTitle>
        <p className="text-sm leading-relaxed text-gray-400">
          Configure apenas as ligações oficiais do estabelecimento. Nesta fase não são importadas classificações nem avaliações.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> A carregar configuração…</div> : null}
        {error ? <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error.message}</p> : null}
        {!isLoading && !error ? (
          <>
            {!data?.configured ? <p className="rounded-lg border border-amber-300/25 bg-amber-500/10 p-3 text-sm text-amber-100">A secção pública permanece oculta até guardar duas ligações válidas.</p> : null}
            <div className="grid gap-5">
              <div className="space-y-2">
                <Label htmlFor="google-maps-url">Ligação para ver as avaliações</Label>
                <Input id="google-maps-url" type="url" autoComplete="url" value={form.googleMapsUrl} onChange={(event) => setForm((current) => ({ ...current, googleMapsUrl: event.target.value }))} placeholder="https://www.google.com/maps/..." />
                <p className="text-xs text-gray-400">Use a ligação HTTPS completa de google.com/maps. Ligações encurtadas não são aceites.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="google-review-request-url">Ligação para deixar uma avaliação</Label>
                <Input id="google-review-request-url" type="url" autoComplete="url" value={form.googleReviewRequestUrl} onChange={(event) => setForm((current) => ({ ...current, googleReviewRequestUrl: event.target.value }))} placeholder="https://search.google.com/local/writereview?placeid=..." />
                <p className="text-xs text-gray-400">Aceita a ligação oficial com Place ID ou o formato g.page/r/…/review.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="google-place-id">Google Place ID <span className="font-normal text-gray-400">(opcional)</span></Label>
                <Input id="google-place-id" value={form.googlePlaceId} onChange={(event) => setForm((current) => ({ ...current, googlePlaceId: event.target.value }))} placeholder="ChIJ…" />
                <p className="text-xs text-gray-400">Fica preparado para uma futura integração oficial. Não é uma chave de API.</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button variant="gold" className="gap-2" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? "A guardar…" : "Guardar ligações"}
              </Button>
              {preview ? <a href={preview.links.reviewsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary hover:underline">Ver ligação configurada <ExternalLink className="h-4 w-4" /></a> : null}
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Pré-visualização</p>
              {preview ? <GoogleReviewsSection presentation={preview} preview /> : <div className="rounded-xl border border-dashed border-white/15 p-6 text-center text-sm text-gray-400">Preencha ligações válidas para pré-visualizar a secção.</div>}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
