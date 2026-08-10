import { buildUrl } from "@shared/routes";

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
  const response = await fetch(toApiUrl(path), {
    ...init,
    credentials: init?.credentials ?? "include",
  });

  const relativePath = path.startsWith("http")
    ? new URL(path).pathname
    : path.split("?", 1)[0];
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
