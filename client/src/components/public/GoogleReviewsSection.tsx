import { ExternalLink, MessageCircleMore, Star } from "lucide-react";
import type { PublicGoogleReviewsPresentation } from "@shared/google-reviews";
import { cn } from "@/lib/utils";

type GoogleReviewsSectionProps = {
  presentation: PublicGoogleReviewsPresentation;
  preview?: boolean;
};

export function GoogleReviewsSection({ presentation, preview = false }: GoogleReviewsSectionProps) {
  const content = (
    <div className={cn("mx-auto max-w-4xl", preview ? "p-5 sm:p-6" : "px-4 text-center")}>
      <div className={cn("flex items-center gap-3", preview ? "justify-start" : "justify-center")}>
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary" aria-hidden="true">
          <Star className="h-5 w-5" />
        </span>
        <div className={preview ? "text-left" : "text-left sm:text-center"}>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Avaliações Google</p>
          <h2 className={cn("font-bold text-white", preview ? "mt-1 text-xl" : "mt-2 text-3xl md:text-5xl")}>A opinião das nossas clientes</h2>
        </div>
      </div>
      <p className={cn("leading-relaxed text-gray-400", preview ? "mt-4 text-sm" : "mx-auto mt-5 max-w-2xl text-sm md:text-base")}>
        Consulte as avaliações reais no Google ou partilhe a sua experiência diretamente na página oficial do estabelecimento.
      </p>
      <div className={cn("mt-7 flex flex-col gap-3 sm:flex-row", preview ? "sm:justify-start" : "sm:justify-center")}>
        <a
          href={presentation.links.reviewsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-primary/50 bg-primary/10 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Star className="h-4 w-4 text-primary" aria-hidden="true" />
          Ver avaliações no Google
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
        <a
          href={presentation.links.reviewRequestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <MessageCircleMore className="h-4 w-4" aria-hidden="true" />
          Deixar uma avaliação
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
      <p className={cn("text-xs text-gray-500", preview ? "mt-4" : "mt-5")}>As ligações abrem o Google numa nova janela.</p>
    </div>
  );

  if (preview) {
    return <div className="overflow-hidden rounded-xl border border-white/10 bg-background">{content}</div>;
  }
  return <section id="google-reviews" className="home-section scroll-mt-20 bg-white/[0.03] py-16 md:py-24">{content}</section>;
}
