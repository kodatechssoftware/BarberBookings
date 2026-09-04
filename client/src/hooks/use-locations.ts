import { useQuery } from "@tanstack/react-query";
import type { ShopLocation } from "@shared/locations";

export function useLocations() {
  return useQuery<ShopLocation[]>({ queryKey: ["/api/locations"] });
}

