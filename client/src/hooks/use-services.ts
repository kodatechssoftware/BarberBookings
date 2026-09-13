import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type CreateServiceRequest } from "@shared/routes";
import { apiFetch } from "@/lib/api";
import { locationHeaders, useActiveLocationId } from "@/lib/location-context";

export function useServices(options?: { enabled?: boolean; includeHidden?: boolean }) {
  const locationId = useActiveLocationId();
  return useQuery({
    queryKey: [api.services.list.path, { includeHidden: options?.includeHidden ?? false, locationId }],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const url = options?.includeHidden
        ? `${api.services.list.path}?includeHidden=true`
        : api.services.list.path;
      const res = await apiFetch(url, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", ...locationHeaders(locationId) },
      });
      if (!res.ok) throw new Error("Failed to fetch services");
      return api.services.list.responses[200].parse(await res.json());
    },
    retry: 2,
    retryDelay: 800,
  });
}

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateServiceRequest) => {
      const res = await apiFetch(api.services.create.path, {
        method: api.services.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create service");
      return api.services.create.responses[201].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.services.list.path] }),
  });
}
