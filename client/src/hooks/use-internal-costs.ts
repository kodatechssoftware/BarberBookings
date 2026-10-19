import { useQuery } from "@tanstack/react-query";
import type { InternalCostDefinition } from "@shared/schema";
import { apiFetch } from "@/lib/api";
import { locationHeaders, useActiveLocationId } from "@/lib/location-context";

export function useInternalCosts(options?: { enabled?: boolean; locationId?: number }) {
  const activeLocationId = useActiveLocationId();
  const locationId = options?.locationId ?? activeLocationId;
  return useQuery<InternalCostDefinition[]>({
    queryKey: ["/api/admin/internal-costs", { locationId }],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const response = await apiFetch("/api/admin/internal-costs", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", ...locationHeaders(locationId) },
      });
      if (!response.ok) throw new Error("Não foi possível carregar os custos e consumos.");
      return response.json();
    },
  });
}
