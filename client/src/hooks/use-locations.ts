import { useQuery } from "@tanstack/react-query";
import type { ShopLocation } from "@shared/locations";
import { apiFetch } from "@/lib/api";

export function useLocations(options: { purpose?: "booking" } = {}) {
  const path = options.purpose === "booking" ? "/api/locations?purpose=booking" : "/api/locations";
  return useQuery<ShopLocation[]>({
    queryKey: [path],
    queryFn: async () => {
      const response = await apiFetch(path);
      if (!response.ok) throw new Error("Não foi possível carregar as localizações.");
      return response.json();
    },
  });
}
