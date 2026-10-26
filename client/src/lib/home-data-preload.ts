import type { HomeDataPreloadKey } from "@/lib/home-data-preload-types";

export function takeHomeDataPreload<T>(key: HomeDataPreloadKey, locationId: number | null | undefined) {
  if (typeof window === "undefined") return undefined;
  const state = window.__barberBookingsHomeDataPreload;
  if (!state || state.locationId !== (locationId ?? null)) return undefined;
  const request = state.requests[key];
  if (!request) return undefined;

  // The preload belongs to the first render only. Invalidations and retries
  // must perform a fresh read instead of replaying the startup snapshot.
  delete state.requests[key];
  return request.then((result) => {
    if (!result.ok) {
      const error = new Error(result.message) as Error & { status?: number };
      error.status = result.status;
      throw error;
    }
    return result.data as T;
  });
}
