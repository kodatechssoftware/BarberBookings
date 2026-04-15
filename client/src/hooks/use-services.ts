import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type CreateServiceRequest } from "@shared/routes";
import { apiFetch } from "@/lib/api";

export function useServices(options?: { enabled?: boolean; includeHidden?: boolean }) {
  return useQuery({
    queryKey: [api.services.list.path, { includeHidden: options?.includeHidden ?? false }],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const url = options?.includeHidden
        ? `${api.services.list.path}?includeHidden=true`
        : api.services.list.path;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error("Failed to fetch services");
      return api.services.list.responses[200].parse(await res.json());
    },
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
