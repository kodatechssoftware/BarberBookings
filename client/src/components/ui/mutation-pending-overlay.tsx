import { useEffect, useState } from "react";
import { shopBranding } from "@/lib/branding";
import { cn } from "@/lib/utils";

type MutationPendingOverlayProps = {
  active: boolean;
  label?: string;
  delayMs?: number;
  className?: string;
};

export function MutationPendingOverlay({
  active,
  label = "A processar...",
  delayMs = 180,
  className,
}: MutationPendingOverlayProps) {
  const [isVisible, setIsVisible] = useState(active && delayMs <= 0);

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
          <img
            src={shopBranding.logoUrl}
            alt=""
            aria-hidden="true"
            className="h-14 w-14 rounded-full bg-card object-contain shadow-lg shadow-black/40"
          />
        </div>
        <p className="break-words text-sm font-semibold text-white">{label}</p>
      </div>
    </div>
  );
}
