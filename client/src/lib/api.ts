import { buildUrl } from "@shared/routes";
import { getActiveLocationId } from "@/lib/location-context";

const ABSOLUTE_URL_REGEX = /^https?:\/\//i;

export const API_UNAUTHORIZED_EVENT = "barberbookings:unauthorized";

const AUTH_PROBE_PATHS = new Set([
  "/api/admin/login",
  "/api/admin/logout",
  "/api/admin/me",
]);

function getApiBaseUrl() {
  return (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");
}

export function toApiUrl(path: string) {
  if (ABSOLUTE_URL_REGEX.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const apiBaseUrl = getApiBaseUrl();

  return apiBaseUrl ? `${apiBaseUrl}${normalizedPath}` : normalizedPath;
}

export function buildApiUrl(
  path: string,
  params?: Record<string, string | number>,
) {
  return toApiUrl(buildUrl(path, params));
}

export async function apiFetch(path: string, init?: RequestInit) {
  const relativePath = path.startsWith("http")
    ? new URL(path).pathname
    : path.split("?", 1)[0];
  const headers = new Headers(init?.headers);
  if (!headers.has("X-Location-Id") && !AUTH_PROBE_PATHS.has(relativePath)) {
    const locationId = getActiveLocationId();
    if (locationId !== null) headers.set("X-Location-Id", String(locationId));
  }
  const response = await fetch(toApiUrl(path), {
    ...init,
    headers,
    credentials: init?.credentials ?? "include",
  });

  if (
    response.status === 401
    && !AUTH_PROBE_PATHS.has(relativePath)
    && typeof window !== "undefined"
  ) {
    window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT, {
      detail: { path: relativePath },
    }));
  }

  return response;
}
