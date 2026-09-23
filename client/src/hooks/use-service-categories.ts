import { useQuery } from "@tanstack/react-query";
import { api, type ServiceCategoryWithCount } from "@shared/routes";
import { apiFetch } from "@/lib/api";

export function useServiceCategories(options?: { enabled?: boolean }) {
  return useQuery<ServiceCategoryWithCount[]>({
    queryKey: [api.serviceCategories.list.path],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const response = await apiFetch(api.serviceCategories.list.path, { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível carregar as categorias.");
      return api.serviceCategories.list.responses[200].parse(await response.json());
    },
  });
}
