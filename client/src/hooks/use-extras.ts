import { useQuery } from "@tanstack/react-query";
import type { ExtraDefinition } from "@shared/schema";
import { apiFetch } from "@/lib/api";
import { locationHeaders, useActiveLocationId } from "@/lib/location-context";

export function useExtras(options?: { enabled?: boolean; locationId?: number }) {
  const activeLocationId = useActiveLocationId();
  const locationId = options?.locationId ?? activeLocationId;

  return useQuery<ExtraDefinition[]>({
    queryKey: ["/api/admin/extras", { locationId }],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const response = await apiFetch("/api/admin/extras", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", ...locationHeaders(locationId) },
      });
      if (!response.ok) throw new Error("Não foi possível carregar os Extras.");
      return response.json();
    },
  });
}
