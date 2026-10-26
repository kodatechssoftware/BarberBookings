import type {
  HomeDataPreloadKey,
  HomeDataPreloadResult,
} from "@/lib/home-data-preload-types";

const HOME_PATHS: Record<HomeDataPreloadKey, string> = {
  services: "/api/services",
  barbers: "/api/barbers?avatarMode=reference",
  availability: "/api/shop/availability",
};

function activeLocationId() {
  try {
    const value = Number(window.localStorage.getItem("barberbookings:location-id"));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function apiUrl(path: string) {
  const base = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}${path}` : path;
}

function request(path: string, locationId: number | null): Promise<HomeDataPreloadResult> {
  const headers = new Headers();
  if (locationId !== null) headers.set("X-Location-Id", String(locationId));
  if (path === HOME_PATHS.services || path === HOME_PATHS.barbers) {
    headers.set("Cache-Control", "no-cache");
  }

  return fetch(apiUrl(path), {
    credentials: "include",
    cache: path === HOME_PATHS.services || path === HOME_PATHS.barbers ? "no-store" : "default",
    headers,
  }).then(async (response) => {
    if (!response.ok) {
      return { ok: false as const, status: response.status, message: response.statusText || "Request failed" };
    }
    return { ok: true as const, data: await response.json() };
  }).catch((error: unknown) => ({
    ok: false,
    message: error instanceof Error ? error.message : "Request failed",
  }));
}

if (window.location.pathname === "/") {
  const locationId = activeLocationId();
  window.__barberBookingsHomeDataPreload = {
    locationId,
    requests: Object.fromEntries(
      Object.entries(HOME_PATHS).map(([key, path]) => [key, request(path, locationId)]),
    ),
  };
}
