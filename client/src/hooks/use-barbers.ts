import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type CreateBarberRequest } from "@shared/routes";
import { apiFetch, toApiUrl } from "@/lib/api";
import { locationHeaders, useActiveLocationId } from "@/lib/location-context";

export function useBarbers(options?: { enabled?: boolean; includeHidden?: boolean }) {
  const locationId = useActiveLocationId();
  return useQuery({
    queryKey: [api.barbers.list.path, { includeHidden: options?.includeHidden ?? false, locationId }],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const url = options?.includeHidden
        ? `${api.barbers.list.path}?includeHidden=true&avatarMode=reference`
        : `${api.barbers.list.path}?avatarMode=reference`;
      const res = await apiFetch(url, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", ...locationHeaders(locationId) },
      });
      if (!res.ok) throw new Error("Failed to fetch barbers");
      return api.barbers.list.responses[200].parse(await res.json()).map((barber) => ({
        ...barber,
        avatar: barber.avatar?.startsWith(`/api/barbers/${barber.id}/avatar?`)
          ? toApiUrl(barber.avatar) : barber.avatar,
      }));
    },
    retry: 2,
    retryDelay: 800,
  });
}

export function useBarber(id: number) {
  const locationId = useActiveLocationId();
  return useQuery({
    queryKey: [api.barbers.get.path, id, { locationId }],
    queryFn: async () => {
      const url = buildUrl(api.barbers.get.path, { id });
      const res = await apiFetch(url, { headers: locationHeaders(locationId) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch barber");
      return api.barbers.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

export function useBarberAvailability(options?: { locationId?: number; enabled?: boolean }) {
  const activeLocationId = useActiveLocationId();
  const locationId = options?.locationId ?? activeLocationId;
  return useQuery({
    queryKey: ["/api/barbers/availability", { locationId }],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const res = await apiFetch("/api/barbers/availability", { headers: locationHeaders(locationId) });
      if (!res.ok) throw new Error("Failed to fetch barber availability");
      return res.json();
    },
  });
}

export function useShopAvailability(options?: { locationId?: number | null; enabled?: boolean }) {
  const activeLocationId = useActiveLocationId();
  // Explicit null selects the default location, even when another location is stored.
  const locationId = options?.locationId === null ? null : (options?.locationId ?? activeLocationId);
  return useQuery({
    queryKey: ["/api/shop/availability", { locationId }],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const res = await apiFetch("/api/shop/availability", { headers: locationHeaders(locationId) });
      if (!res.ok) throw new Error("Failed to fetch shop availability");
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
