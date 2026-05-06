import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type CreateBarberRequest } from "@shared/routes";
import { apiFetch } from "@/lib/api";

export function useBarbers(options?: { enabled?: boolean; includeHidden?: boolean }) {
  return useQuery({
    queryKey: [api.barbers.list.path, { includeHidden: options?.includeHidden ?? false }],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const url = options?.includeHidden
        ? `${api.barbers.list.path}?includeHidden=true`
        : api.barbers.list.path;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error("Failed to fetch barbers");
      return api.barbers.list.responses[200].parse(await res.json());
    },
  });
}

export function useBarber(id: number) {
  return useQuery({
    queryKey: [api.barbers.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.barbers.get.path, { id });
      const res = await apiFetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch barber");
      return api.barbers.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

export function useBarberAvailability() {
  return useQuery({
    queryKey: ["/api/barbers/availability"],
    queryFn: async () => {
      const res = await apiFetch("/api/barbers/availability");
      if (!res.ok) throw new Error("Failed to fetch barber availability");
      return res.json();
    },
  });
}

export function useCreateBarber() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateBarberRequest) => {
      const res = await apiFetch(api.barbers.create.path, {
        method: api.barbers.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create barber");
      return api.barbers.create.responses[201].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.barbers.list.path] }),
  });
}
