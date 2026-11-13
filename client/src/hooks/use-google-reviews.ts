import { useQuery } from "@tanstack/react-query";
import type { PublicGoogleReviewsPresentation } from "@shared/google-reviews";
import { apiFetch } from "@/lib/api";
import { locationHeaders, useActiveLocationId } from "@/lib/location-context";

export function usePublicGoogleReviews(options?: { enabled?: boolean; locationId?: number | null }) {
  const activeLocationId = useActiveLocationId();
  const locationId = options?.locationId === undefined ? activeLocationId : options.locationId;
  return useQuery<PublicGoogleReviewsPresentation | null>({
    queryKey: ["/api/public/google-reviews", { locationId }],
    enabled: (options?.enabled ?? true) && locationId !== null,
    queryFn: async () => {
      const response = await apiFetch("/api/public/google-reviews", {
        cache: "no-store",
        headers: locationHeaders(locationId),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Não foi possível carregar as ligações das avaliações Google.");
      return response.json();
    },
  });
}
