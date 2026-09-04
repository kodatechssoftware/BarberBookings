import { useQuery } from "@tanstack/react-query";
import type { PublicBookingWindow } from "@shared/public-booking-window";
import { apiFetch } from "@/lib/api";

export function usePublicBookingWindow() {
  return useQuery<PublicBookingWindow>({
    queryKey: ["/api/public-booking-window"],
    queryFn: async () => {
      const response = await apiFetch("/api/public-booking-window", { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível carregar o período de marcações.");
      return response.json() as Promise<PublicBookingWindow>;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
