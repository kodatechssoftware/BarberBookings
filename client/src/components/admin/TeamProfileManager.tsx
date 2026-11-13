import { useEffect, useState } from "react";
import { Award, Eye, Loader2, Plus, Quote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { locationHeaders, useActiveLocationId } from "@/lib/location-context";
import { queryClient } from "@/lib/queryClient";

type Qualification = {
  id?: number;
  kind: "course" | "training" | "diploma" | "certification";
  title: string;
  issuer: string | null;
  completedYear: number | null;
  description: string | null;
  displayOrder: number;
  isPublished: boolean;
  publicationAuthorized: boolean;
};
type Testimonial = {
  id?: number;
  authorDisplayName: string;
  quote: string;
  sourceLabel: string | null;
  displayOrder: number;
  isPublished: boolean;
  publicationAuthorized: boolean;
};
type AdminProfile = {
  professionalId: number;
  name: string;
  specialty: string;
  avatar: string | null;
  bio: string | null;
  slug: string;
  displayOrder: number;
  isPublished: boolean;
  publicationAuthorized: boolean;
  services: Array<{ id: number; name: string }>;
  qualifications: Qualification[];
  testimonials: Testimonial[];
};

const emptyQualification = (position: number): Qualification => ({
  kind: "training", title: "", issuer: null, completedYear: null, description: null,
  displayOrder: position, isPublished: false, publicationAuthorized: false,
});
const emptyTestimonial = (position: number): Testimonial => ({
  authorDisplayName: "", quote: "", sourceLabel: null, displayOrder: position,
  isPublished: false, publicationAuthorized: false,
});

export function TeamProfileManager({ professionalId, professionalName }: { professionalId: number; professionalName: string }) {
  const locationId = useActiveLocationId();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !locationId) return;
    setLoading(true);
    apiFetch(`/api/admin/team-profiles/${professionalId}`, { headers: locationHeaders(locationId), cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Não foi possível carregar o perfil.");
        setProfile(await response.json());
      })
      .catch((error) => toast({ title: "Erro", description: error.message, variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [locationId, open, professionalId, toast]);

  const save = async () => {
    if (!profile || !locationId) return;
    setSaving(true);
    try {
      const response = await apiFetch(`/api/admin/team-profiles/${professionalId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...locationHeaders(locationId) },
        body: JSON.stringify({
          slug: profile.slug,
          bio: profile.bio || null,
          displayOrder: profile.displayOrder,
          isPublished: profile.isPublished,
          publicationAuthorized: profile.publicationAuthorized,
          qualifications: profile.qualifications.map((item, index) => ({ ...item, displayOrder: index })),
          testimonials: profile.testimonials.map((item, index) => ({ ...item, displayOrder: index })),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message || "Não foi possível guardar o perfil.");
      setProfile(body);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/public/team-profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/barbers"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] }),
      ]);
      toast({ title: "Perfil guardado", description: profile.isPublished ? "O perfil público está disponível." : "As alterações ficaram guardadas sem publicação." });
    } catch (error) {
      toast({ title: "Erro", description: error instanceof Error ? error.message : "Não foi possível guardar.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button variant="outline" size="sm" className="h-8 flex-1 text-xs"><Eye className="mr-1.5 h-3.5 w-3.5" /> Perfil público</Button>
    </DialogTrigger>
    <DialogContent className="max-h-[92vh] w-[96vw] max-w-4xl overflow-y-auto border-white/10 bg-card text-white">
      <DialogHeader><DialogTitle>Perfil público · {professionalName}</DialogTitle></DialogHeader>
      {loading || !profile ? <div className="flex min-h-52 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : <div className="space-y-7 py-2">
        <section className="grid gap-4 rounded-xl border border-white/10 bg-background/40 p-4 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor={`profile-slug-${professionalId}`}>Endereço público</Label><Input id={`profile-slug-${professionalId}`} value={profile.slug} onChange={(event) => setProfile({ ...profile, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /><p className="text-xs text-gray-400">/equipa/{profile.slug || "profissional"}</p></div>
          <div className="space-y-2"><Label htmlFor={`profile-order-${professionalId}`}>Ordem de apresentação</Label><Input id={`profile-order-${professionalId}`} type="number" min={0} value={profile.displayOrder} onChange={(event) => setProfile({ ...profile, displayOrder: Math.max(0, Number(event.target.value) || 0) })} /></div>
          <div className="space-y-2 md:col-span-2"><Label htmlFor={`profile-bio-${professionalId}`}>Apresentação pública</Label><Textarea id={`profile-bio-${professionalId}`} className="min-h-28" maxLength={2000} value={profile.bio ?? ""} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} /></div>
          <div className="md:col-span-2"><p className="text-sm font-medium">Serviços associados</p><div className="mt-2 flex flex-wrap gap-2">{profile.services.length ? profile.services.map((service) => <span key={service.id} className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{service.name}</span>) : <span className="text-sm text-gray-400">Associe serviços no formulário principal da profissional.</span>}</div></div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 font-bold"><Award className="h-4 w-4 text-primary" /> Formações e certificações</h3><p className="text-xs text-gray-400">Não carregamos documentos originais nesta fase.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setProfile({ ...profile, qualifications: [...profile.qualifications, emptyQualification(profile.qualifications.length)] })}><Plus className="mr-1 h-4 w-4" /> Adicionar</Button></div>
          {profile.qualifications.map((item, index) => <div key={item.id ?? `new-${index}`} className="grid gap-3 rounded-xl border border-white/10 p-4 md:grid-cols-2">
            <Select value={item.kind} onValueChange={(kind: Qualification["kind"]) => setProfile({ ...profile, qualifications: profile.qualifications.map((entry, position) => position === index ? { ...entry, kind } : entry) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="course">Curso</SelectItem><SelectItem value="training">Formação</SelectItem><SelectItem value="diploma">Diploma</SelectItem><SelectItem value="certification">Certificação</SelectItem></SelectContent></Select>
            <Input placeholder="Designação" value={item.title} onChange={(event) => setProfile({ ...profile, qualifications: profile.qualifications.map((entry, position) => position === index ? { ...entry, title: event.target.value } : entry) })} />
            <Input placeholder="Entidade (opcional)" value={item.issuer ?? ""} onChange={(event) => setProfile({ ...profile, qualifications: profile.qualifications.map((entry, position) => position === index ? { ...entry, issuer: event.target.value || null } : entry) })} />
            <Input type="number" min={1900} max={2200} placeholder="Ano (opcional)" value={item.completedYear ?? ""} onChange={(event) => setProfile({ ...profile, qualifications: profile.qualifications.map((entry, position) => position === index ? { ...entry, completedYear: event.target.value ? Number(event.target.value) : null } : entry) })} />
            <Textarea className="md:col-span-2" placeholder="Descrição (opcional)" value={item.description ?? ""} onChange={(event) => setProfile({ ...profile, qualifications: profile.qualifications.map((entry, position) => position === index ? { ...entry, description: event.target.value || null } : entry) })} />
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={item.publicationAuthorized} onCheckedChange={(checked) => setProfile({ ...profile, qualifications: profile.qualifications.map((entry, position) => position === index ? { ...entry, publicationAuthorized: checked === true, isPublished: checked === true ? entry.isPublished : false } : entry) })} /> Autorização confirmada</label>
            <div className="flex items-center justify-end gap-3"><label className="flex items-center gap-2 text-sm"><Checkbox checked={item.isPublished} disabled={!item.publicationAuthorized} onCheckedChange={(checked) => setProfile({ ...profile, qualifications: profile.qualifications.map((entry, position) => position === index ? { ...entry, isPublished: checked === true } : entry) })} /> Publicar</label><Button type="button" size="icon" variant="ghost" aria-label="Remover formação" onClick={() => setProfile({ ...profile, qualifications: profile.qualifications.filter((_, position) => position !== index) })}><Trash2 className="h-4 w-4 text-red-300" /></Button></div>
          </div>)}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 font-bold"><Quote className="h-4 w-4 text-primary" /> Testemunhos autorizados</h3><p className="text-xs text-gray-400">Publique apenas opiniões com autorização da cliente.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setProfile({ ...profile, testimonials: [...profile.testimonials, emptyTestimonial(profile.testimonials.length)] })}><Plus className="mr-1 h-4 w-4" /> Adicionar</Button></div>
          {profile.testimonials.map((item, index) => <div key={item.id ?? `new-${index}`} className="grid gap-3 rounded-xl border border-white/10 p-4 md:grid-cols-2">
            <Input placeholder="Nome público da cliente" value={item.authorDisplayName} onChange={(event) => setProfile({ ...profile, testimonials: profile.testimonials.map((entry, position) => position === index ? { ...entry, authorDisplayName: event.target.value } : entry) })} />
            <Input placeholder="Origem (opcional)" value={item.sourceLabel ?? ""} onChange={(event) => setProfile({ ...profile, testimonials: profile.testimonials.map((entry, position) => position === index ? { ...entry, sourceLabel: event.target.value || null } : entry) })} />
            <Textarea className="min-h-24 md:col-span-2" placeholder="Testemunho" value={item.quote} onChange={(event) => setProfile({ ...profile, testimonials: profile.testimonials.map((entry, position) => position === index ? { ...entry, quote: event.target.value } : entry) })} />
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={item.publicationAuthorized} onCheckedChange={(checked) => setProfile({ ...profile, testimonials: profile.testimonials.map((entry, position) => position === index ? { ...entry, publicationAuthorized: checked === true, isPublished: checked === true ? entry.isPublished : false } : entry) })} /> Autorização da cliente confirmada</label>
            <div className="flex items-center justify-end gap-3"><label className="flex items-center gap-2 text-sm"><Checkbox checked={item.isPublished} disabled={!item.publicationAuthorized} onCheckedChange={(checked) => setProfile({ ...profile, testimonials: profile.testimonials.map((entry, position) => position === index ? { ...entry, isPublished: checked === true } : entry) })} /> Publicar</label><Button type="button" size="icon" variant="ghost" aria-label="Remover testemunho" onClick={() => setProfile({ ...profile, testimonials: profile.testimonials.filter((_, position) => position !== index) })}><Trash2 className="h-4 w-4 text-red-300" /></Button></div>
          </div>)}
        </section>

        <section className="rounded-xl border border-primary/25 bg-primary/5 p-4"><h3 className="font-bold">Pré-visualização</h3><p className="mt-1 text-sm text-gray-300">{profile.name} · {profile.specialty}</p><p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-gray-400">{profile.bio || "Adicione uma apresentação pública."}</p></section>
        <div className="flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between"><label className="flex items-center gap-2 text-sm"><Checkbox checked={profile.publicationAuthorized} onCheckedChange={(checked) => setProfile({ ...profile, publicationAuthorized: checked === true, isPublished: checked === true ? profile.isPublished : false })} /> Autorização da profissional confirmada</label><div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm"><Checkbox checked={profile.isPublished} disabled={!profile.publicationAuthorized} onCheckedChange={(checked) => setProfile({ ...profile, isPublished: checked === true })} /> Perfil publicado</label><Button variant="gold" disabled={saving} onClick={save}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar perfil</Button></div></div>
      </div>}
    </DialogContent>
  </Dialog>;
}
