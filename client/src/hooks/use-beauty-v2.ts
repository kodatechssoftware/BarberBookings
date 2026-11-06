import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { locationHeaders, useActiveLocationId } from "@/lib/location-context";

export type BeautyV2PublicFeatures = {
  enabled: boolean;
  appointmentRequests: boolean;
  multiServiceAppointments: boolean;
  parallelServiceScheduling: boolean;
  appointmentRequestsAvailable: boolean;
};

export function useBeautyV2Features(options?: { enabled?: boolean; locationId?: number | null }) {
  const activeLocationId = useActiveLocationId();
  const locationId = options?.locationId === undefined ? activeLocationId : options.locationId;
  return useQuery<BeautyV2PublicFeatures>({
    queryKey: ["/api/beauty-v2/features", { locationId }],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const response = await apiFetch("/api/beauty-v2/features", {
        cache: "no-store",
        headers: locationHeaders(locationId),
      });
      if (!response.ok) throw new Error("Não foi possível carregar as funcionalidades Beauty v2.");
      return response.json();
    },
  });
}
