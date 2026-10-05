import { type SyntheticEvent, useEffect, useState } from "react";
import { resolveLocationLogoUrl, shopBranding } from "@/lib/branding";
import { cn } from "@/lib/utils";

type MutationPendingOverlayProps = {
  active: boolean;
  label?: string;
  logoUrl?: string | null;
  delayMs?: number;
  className?: string;
};

function handleLogoLoadError(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  if (image.dataset.fallbackApplied !== "true") {
    image.dataset.fallbackApplied = "true";
    image.src = shopBranding.logoUrl;
    return;
  }

  image.hidden = true;
}

export function MutationPendingOverlay({
  active,
  label = "A processar...",
  logoUrl,
  delayMs = 180,
  className,
}: MutationPendingOverlayProps) {
  const [isVisible, setIsVisible] = useState(active && delayMs <= 0);
  const resolvedLogoUrl = resolveLocationLogoUrl(logoUrl);

  useEffect(() => {
    if (!active) {
      setIsVisible(false);
      return;
    }

    if (delayMs <= 0) {
      setIsVisible(true);
      return;
    }

    const timeoutId = window.setTimeout(() => setIsVisible(true), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [active, delayMs]);

  if (!active || !isVisible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="mutation-pending-overlay"
      className={cn(
        "absolute inset-0 z-[80] flex min-h-40 items-center justify-center overflow-hidden rounded-[inherit] bg-background/95 px-4 text-center backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex max-w-full flex-col items-center gap-4">
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-spin rounded-full border-2 border-white/15 border-r-primary border-t-primary"
          />
          <div
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-card text-lg font-bold text-primary shadow-lg shadow-black/40"
          >
            {shopBranding.name.trim().charAt(0).toUpperCase() || "B"}
          </div>
          <img
            key={resolvedLogoUrl}
            src={resolvedLogoUrl}
            alt=""
            aria-hidden="true"
            onError={handleLogoLoadError}
            className="absolute h-14 w-14 rounded-full bg-card object-contain shadow-lg shadow-black/40"
          />
        </div>
        <p className="break-words text-sm font-semibold text-white">{label}</p>
      </div>
    </div>
  );
}
