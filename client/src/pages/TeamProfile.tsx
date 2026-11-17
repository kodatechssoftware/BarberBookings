import { useEffect } from "react";
import { ArrowLeft, Award, CalendarDays, Clock, ExternalLink, Quote, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button-custom";
import { useBusinessBranding } from "@/business/use-business-branding";
import { useLocations } from "@/hooks/use-locations";
import { useBeautyV2Features } from "@/hooks/use-beauty-v2";
import { usePublicTeamProfile } from "@/hooks/use-team-profiles";
import { setActiveLocationId, useActiveLocationId } from "@/lib/location-context";
import { getProfessionalAvatar } from "@/lib/professional-presentation";
import { toApiUrl } from "@/lib/api";

const qualificationLabels = {
  course: "Curso",
  training: "Formação",
  diploma: "Diploma",
  certification: "Certificação",
} as const;

const compactGridStyle = {
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 17rem), 21rem))",
};

const testimonialGridStyle = {
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 20rem), 36rem))",
};

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

  const { data: features, isLoading: loadingFeatures } = useBeautyV2Features({
    enabled: locationId !== null,
    locationId,
  });
  const { data: profile, isLoading: loadingProfile, isError } = usePublicTeamProfile(slug, {
    enabled: features?.teamProfiles === true,
    locationId,
  });

  if (loadingLocations || loadingFeatures || (features?.teamProfiles && loadingProfile)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!features?.teamProfiles || !profile || isError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-5 text-foreground">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">Perfil não disponível</h1>
          <p className="mt-3 text-muted-foreground">Este perfil não está publicado ou deixou de estar disponível.</p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/">Voltar ao site</Link>
          </Button>
        </div>
      </main>
    );
  }

  const avatar = getProfessionalAvatar(profile, branding);
  const hasProfessionalPhoto = Boolean(profile.avatar);

  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/#team"
            className="inline-flex min-h-10 items-center gap-2 rounded-md text-sm text-muted-foreground transition-colors hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar à equipa
          </Link>
          <span className="text-sm font-semibold text-primary">{branding.shortName}</span>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:py-16">
        <div className="grid items-center gap-8 md:grid-cols-[minmax(240px,360px)_minmax(0,1fr)] lg:gap-14">
          <div className="mx-auto w-full max-w-[320px] sm:max-w-[360px] md:max-w-none">
            <div className="overflow-hidden rounded-[2rem] border border-border bg-card shadow-[0_24px_70px_-45px_rgba(80,36,57,0.65)]">
              <img
                src={avatar}
                alt={hasProfessionalPhoto ? `Fotografia de ${profile.name}` : `Identidade visual de ${branding.shortName}`}
                className={`aspect-[4/5] w-full ${hasProfessionalPhoto ? "object-cover object-top" : "bg-background/50 object-contain p-6 sm:p-8"}`}
              />
            </div>
          </div>

          <div className="min-w-0 md:py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">A nossa equipa</p>
            <h1 className="mt-3 break-words text-4xl font-bold leading-tight text-foreground sm:text-5xl lg:text-6xl">
              {profile.name}
            </h1>
            <p className="mt-2 text-sm font-semibold uppercase tracking-[0.16em] text-primary sm:tracking-widest">
              {profile.specialty}
            </p>

            {profile.bio && (
              <p className="mt-5 max-w-2xl whitespace-pre-line break-words text-base leading-7 text-foreground sm:mt-6 sm:leading-8">
                {profile.bio}
              </p>
            )}

            {profile.services.length > 0 && (
              <section className="mt-7 sm:mt-8" aria-labelledby="profile-services-heading">
                <h2 id="profile-services-heading" className="flex items-center gap-2 text-lg font-bold text-foreground">
                  <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
                  Serviços e especialidades
                </h2>
                <div className="mt-3 flex flex-wrap gap-2 sm:mt-4">
                  {profile.services.map((service) => (
                    <span key={service.id} className="rounded-full border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-foreground">
                      {service.name} · {service.duration} min
                    </span>
                  ))}
                </div>
              </section>
            )}

            {profile.services.length > 0 ? (
              <Button asChild variant="gold" size="lg" className="mt-8 w-full shadow-lg shadow-primary/10 sm:mt-9 sm:w-auto">
                <Link href={`/booking?barberId=${profile.professionalId}`}>
                  <CalendarDays className="mr-2 h-5 w-5" aria-hidden="true" />
                  Pedir marcação com {profile.name.split(" ")[0]}
                </Link>
              </Button>
            ) : (
              <p role="status" className="mt-8 max-w-xl rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground">
                Esta profissional ainda não tem serviços disponíveis para marcação online.
              </p>
            )}
          </div>
        </div>
      </section>

      {profile.qualifications.length > 0 && (
        <section className="border-y border-border bg-secondary/20" aria-labelledby="profile-qualifications-heading">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Percurso profissional</p>
              <h2 id="profile-qualifications-heading" className="mt-2 flex items-center gap-2 text-2xl font-bold text-foreground sm:text-3xl">
                <Award className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
                Formação e experiência
              </h2>
            </div>

            <div className="mt-6 grid items-start justify-center gap-4 sm:mt-8 sm:gap-5" style={compactGridStyle}>
              {profile.qualifications.map((item) => (
                <article
                  key={item.id}
                  data-testid="qualification-card"
                  className="w-full self-start overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_55px_-45px_rgba(80,36,57,0.8)]"
                >
                  {item.certificateUrl && (
                    <a
                      href={toApiUrl(item.certificateUrl)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Abrir certificado: ${item.title}`}
                      className="group block p-3 pb-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-4 sm:pb-0"
                    >
                      <span
                        data-testid="certificate-preview"
                        className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl border border-border/80 bg-background/60 p-2.5 sm:p-3"
                      >
                        <img
                          src={toApiUrl(item.certificateUrl)}
                          alt={`Certificado: ${item.title}`}
                          loading="lazy"
                          className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.01]"
                        />
                      </span>
                    </a>
                  )}

                  <div className="p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                      {qualificationLabels[item.kind]}
                    </p>
                    <h3 className="mt-2 break-words text-lg font-bold leading-snug text-foreground">
                      {item.title}
                    </h3>
                    {(item.issuer || item.completedYear) && (
                      <p className="mt-1.5 break-words text-sm leading-6 text-muted-foreground">
                        {[item.issuer, item.completedYear].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {item.description && (
                      <p className="mt-3 break-words text-sm leading-6 text-foreground">
                        {item.description}
                      </p>
                    )}
                    {item.certificateUrl && (
                      <a
                        href={toApiUrl(item.certificateUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-primary underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                      >
                        Ver certificado
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {profile.testimonials.length > 0 && (
        <section aria-labelledby="profile-testimonials-heading">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
            <h2 id="profile-testimonials-heading" className="flex items-center gap-2 text-2xl font-bold text-foreground sm:text-3xl">
              <Quote className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
              Opiniões autorizadas
            </h2>
            <div className="mt-6 grid items-start justify-center gap-4" style={testimonialGridStyle}>
              {profile.testimonials.map((item, index) => (
                <figure key={`${item.authorDisplayName}-${index}`} className="w-full self-start rounded-2xl border border-border bg-card p-5 sm:p-6">
                  <blockquote className="break-words text-base leading-7 text-foreground">“{item.quote}”</blockquote>
                  <figcaption className="mt-4 break-words text-sm font-semibold text-primary">
                    {item.authorDisplayName}
                    {item.sourceLabel ? <span className="font-normal text-muted-foreground"> · {item.sourceLabel}</span> : null}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      <footer className="border-t border-border px-4 py-8 text-center text-sm leading-6 text-muted-foreground">
        <Clock className="mx-auto mb-2 h-4 w-4 text-primary" aria-hidden="true" />
        A disponibilidade é sempre confirmada no momento da marcação.
      </footer>
    </main>
  );
}
