import { useEffect } from "react";
import { ArrowLeft, ArrowRight, Users } from "lucide-react";
import { Link } from "wouter";
import { useBusinessBranding } from "@/business/use-business-branding";
import { useLocations } from "@/hooks/use-locations";
import { useBeautyV2Features } from "@/hooks/use-beauty-v2";
import { usePublicTeamProfiles } from "@/hooks/use-team-profiles";
import { setActiveLocationId, useActiveLocationId } from "@/lib/location-context";
import { getProfessionalAvatar } from "@/lib/professional-presentation";

export default function TeamDirectory() {
  const branding = useBusinessBranding();
  const activeLocationId = useActiveLocationId();
  const { data: locations = [], isLoading: loadingLocations } = useLocations({ purpose: "booking" });
  const locationId = activeLocationId ?? locations.find((item) => item.isDefault)?.id ?? locations[0]?.id ?? null;
  useEffect(() => {
    if (activeLocationId === null && locationId !== null) setActiveLocationId(locationId);
  }, [activeLocationId, locationId]);
  const { data: features, isLoading: loadingFeatures } = useBeautyV2Features({ enabled: locationId !== null, locationId });
  const { data: profiles = [], isLoading: loadingProfiles } = usePublicTeamProfiles({ enabled: features?.teamProfiles === true, locationId });
  const loading = loadingLocations || loadingFeatures || (features?.teamProfiles && loadingProfiles);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  return <main className="min-h-screen bg-background text-foreground">
    <header className="border-b border-white/10"><div className="container mx-auto flex items-center justify-between px-4 py-4"><Link href="/#team" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> Voltar ao site</Link><span className="text-sm font-semibold text-primary">{branding.shortName}</span></div></header>
    <section className="container mx-auto px-4 py-12 md:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Equipa</p>
      <h1 className="mt-3 text-4xl font-bold text-white md:text-5xl">Conheça as nossas profissionais</h1>
      <p className="mt-4 max-w-2xl leading-relaxed text-gray-400">Conheça a experiência, as especialidades e os serviços de cada profissional.</p>
      {!features?.teamProfiles || profiles.length === 0 ? <div className="mt-10 rounded-2xl border border-dashed border-white/15 p-8 text-center"><Users className="mx-auto h-8 w-8 text-primary" /><h2 className="mt-3 font-bold text-white">Perfis ainda não disponíveis</h2><p className="mt-2 text-sm text-gray-400">Consulte a equipa na página inicial.</p></div> : <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{profiles.map((profile) => <article key={profile.slug} className="overflow-hidden rounded-2xl border border-white/10 bg-card"><img src={getProfessionalAvatar(profile, branding)} alt={profile.name} className="aspect-[4/3] w-full object-cover object-top" /><div className="p-5"><h2 className="text-xl font-bold text-white">{profile.name}</h2><p className="mt-1 text-xs font-semibold uppercase tracking-widest text-primary">{profile.specialty}</p>{profile.bio && <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-gray-400">{profile.bio}</p>}<Link href={`/equipa/${profile.slug}`} className="mt-5 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary hover:underline">Ver perfil <ArrowRight className="h-4 w-4" /></Link></div></article>)}</div>}
    </section>
  </main>;
}
