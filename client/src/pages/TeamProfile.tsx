import { useEffect } from "react";
import { ArrowLeft, Award, CalendarDays, Clock, Quote, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button-custom";
import { useBusinessBranding } from "@/business/use-business-branding";
import { useLocations } from "@/hooks/use-locations";
import { useBeautyV2Features } from "@/hooks/use-beauty-v2";
import { usePublicTeamProfile } from "@/hooks/use-team-profiles";
import { setActiveLocationId, useActiveLocationId } from "@/lib/location-context";
import { getProfessionalAvatar } from "@/lib/professional-presentation";

const qualificationLabels = {
  course: "Curso",
  training: "Formação",
  diploma: "Diploma",
  certification: "Certificação",
} as const;

export default function TeamProfile({ slug }: { slug: string }) {
  const branding = useBusinessBranding();
  const activeLocationId = useActiveLocationId();
  const { data: locations = [], isLoading: loadingLocations } = useLocations({ purpose: "booking" });
  const locationId = activeLocationId
    ?? locations.find((location) => location.isDefault)?.id
    ?? locations[0]?.id
    ?? null;
  useEffect(() => {
    if (activeLocationId === null && locationId !== null) setActiveLocationId(locationId);
  }, [activeLocationId, locationId]);
  const { data: features, isLoading: loadingFeatures } = useBeautyV2Features({ enabled: locationId !== null, locationId });
  const { data: profile, isLoading: loadingProfile, isError } = usePublicTeamProfile(slug, {
    enabled: features?.teamProfiles === true,
    locationId,
  });

  if (loadingLocations || loadingFeatures || (features?.teamProfiles && loadingProfile)) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }
  if (!features?.teamProfiles || !profile || isError) {
    return <main className="flex min-h-screen items-center justify-center bg-background p-5 text-foreground"><div className="max-w-md text-center"><h1 className="text-2xl font-bold">Perfil não disponível</h1><p className="mt-3 text-muted-foreground">Este perfil não está publicado ou deixou de estar disponível.</p><Button asChild variant="outline" className="mt-6"><Link href="/">Voltar ao site</Link></Button></div></main>;
  }

  const avatar = getProfessionalAvatar(profile, branding);
  return <main className="min-h-screen bg-background text-foreground">
    <header className="border-b border-white/10 bg-background/90 backdrop-blur"><div className="container mx-auto flex items-center justify-between px-4 py-4"><Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> Voltar à equipa</Link><span className="text-sm font-semibold text-primary">{branding.shortName}</span></div></header>
    <section className="container mx-auto grid gap-8 px-4 py-10 lg:grid-cols-[minmax(280px,420px)_1fr] lg:py-16">
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-card"><img src={avatar} alt={profile.name} className="aspect-[4/5] h-full max-h-[620px] w-full object-cover object-top" /></div>
      <div className="min-w-0 self-center">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">A nossa equipa</p>
        <h1 className="mt-3 text-4xl font-bold text-white sm:text-5xl">{profile.name}</h1>
        <p className="mt-2 text-sm font-semibold uppercase tracking-widest text-primary">{profile.specialty}</p>
        {profile.bio && <p className="mt-6 whitespace-pre-line text-base leading-8 text-gray-300">{profile.bio}</p>}
        {profile.services.length > 0 && <section className="mt-8"><h2 className="flex items-center gap-2 text-lg font-bold text-white"><Sparkles className="h-5 w-5 text-primary" /> Serviços e especialidades</h2><div className="mt-4 flex flex-wrap gap-2">{profile.services.map((service) => <span key={service.id} className="rounded-full border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-gray-100">{service.name} · {service.duration} min</span>)}</div></section>}
        <Button asChild variant="gold" size="lg" className="mt-9 w-full sm:w-auto"><Link href={`/booking?barberId=${profile.professionalId}`}><CalendarDays className="mr-2 h-5 w-5" /> Pedir marcação com {profile.name.split(" ")[0]}</Link></Button>
      </div>
    </section>

    {profile.qualifications.length > 0 && <section className="border-y border-white/10 bg-white/[0.02]"><div className="container mx-auto px-4 py-12"><h2 className="flex items-center gap-2 text-2xl font-bold text-white"><Award className="h-6 w-6 text-primary" /> Formação e experiência</h2><div className="mt-6 grid gap-4 md:grid-cols-2">{profile.qualifications.map((item, index) => <article key={`${item.title}-${index}`} className="rounded-2xl border border-white/10 bg-card p-5"><p className="text-xs font-semibold uppercase tracking-widest text-primary">{qualificationLabels[item.kind]}</p><h3 className="mt-2 text-lg font-bold text-white">{item.title}</h3>{(item.issuer || item.completedYear) && <p className="mt-1 text-sm text-gray-400">{[item.issuer, item.completedYear].filter(Boolean).join(" · ")}</p>}{item.description && <p className="mt-3 text-sm leading-relaxed text-gray-300">{item.description}</p>}</article>)}</div></div></section>}

    {profile.testimonials.length > 0 && <section><div className="container mx-auto px-4 py-12"><h2 className="flex items-center gap-2 text-2xl font-bold text-white"><Quote className="h-6 w-6 text-primary" /> Opiniões autorizadas</h2><div className="mt-6 grid gap-4 md:grid-cols-2">{profile.testimonials.map((item, index) => <figure key={`${item.authorDisplayName}-${index}`} className="rounded-2xl border border-white/10 bg-card p-5"><blockquote className="text-base leading-relaxed text-gray-200">“{item.quote}”</blockquote><figcaption className="mt-4 text-sm font-semibold text-primary">{item.authorDisplayName}{item.sourceLabel ? <span className="font-normal text-gray-500"> · {item.sourceLabel}</span> : null}</figcaption></figure>)}</div></div></section>}
    <footer className="border-t border-white/10 py-8 text-center text-sm text-gray-500"><Clock className="mx-auto mb-2 h-4 w-4 text-primary" /> A disponibilidade é sempre confirmada no momento da marcação.</footer>
  </main>;
}
