import { useQuery } from "@tanstack/react-query";
import { apiFetch, toApiUrl } from "@/lib/api";
import { locationHeaders, useActiveLocationId } from "@/lib/location-context";
import type { PublicTeamProfile } from "@shared/team-profiles";

function normalizeAvatar<T extends { professionalId: number; avatar: string | null }>(profile: T): T {
  return {
    ...profile,
    avatar: profile.avatar?.startsWith(`/api/barbers/${profile.professionalId}/avatar?`)
      ? toApiUrl(profile.avatar)
      : profile.avatar,
  };
}

export function usePublicTeamProfiles(options?: { enabled?: boolean; locationId?: number | null }) {
  const activeLocationId = useActiveLocationId();
  const locationId = options?.locationId === undefined ? activeLocationId : options.locationId;
  return useQuery<PublicTeamProfile[]>({
    queryKey: ["/api/public/team-profiles", { locationId }],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const response = await apiFetch("/api/public/team-profiles", { cache: "no-store", headers: locationHeaders(locationId) });
      if (!response.ok) throw new Error("Não foi possível carregar os perfis da equipa.");
      return (await response.json() as PublicTeamProfile[]).map(normalizeAvatar);
    },
  });
}

export function usePublicTeamProfile(slug: string, options?: { enabled?: boolean; locationId?: number | null }) {
  const activeLocationId = useActiveLocationId();
  const locationId = options?.locationId === undefined ? activeLocationId : options.locationId;
  return useQuery<PublicTeamProfile | null>({
    queryKey: ["/api/public/team-profiles", slug, { locationId }],
    enabled: (options?.enabled ?? true) && Boolean(slug),
    queryFn: async () => {
      const response = await apiFetch(`/api/public/team-profiles/${encodeURIComponent(slug)}`, { cache: "no-store", headers: locationHeaders(locationId) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Não foi possível carregar o perfil.");
      return normalizeAvatar(await response.json() as PublicTeamProfile);
    },
  });
}
