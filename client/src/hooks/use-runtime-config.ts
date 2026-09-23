import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { BookingSlotIntervalMinutes } from "@shared/booking-slot-interval";

export type PublicRuntimeConfig = {
  enabled: boolean;
  maxLocations: number;
  bookingSlotIntervalMinutes: BookingSlotIntervalMinutes;
};

export function useRuntimeConfig(options?: { enabled?: boolean }) {
  return useQuery<PublicRuntimeConfig>({
    queryKey: ["/api/multi-location/config"],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const response = await apiFetch("/api/multi-location/config", { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível carregar a configuração da aplicação.");
      return response.json() as Promise<PublicRuntimeConfig>;
    },
    staleTime: Infinity,
  });
}
