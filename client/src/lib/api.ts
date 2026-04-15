import { buildUrl } from "@shared/routes";

const ABSOLUTE_URL_REGEX = /^https?:\/\//i;

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

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(toApiUrl(path), {
    ...init,
    credentials: init?.credentials ?? "include",
  });
}
