import { useSyncExternalStore } from "react";

const STORAGE_KEY = "barberbookings:location-id";
const CHANGE_EVENT = "barberbookings:location-change";

export function getActiveLocationId() {
  if (typeof window === "undefined") return null;
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch { return null; }
}

export function setActiveLocationId(locationId: number | null) {
  if (typeof window === "undefined") return;
  if (locationId === null) window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, String(locationId));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useActiveLocationId() {
  return useSyncExternalStore(subscribe, getActiveLocationId, () => null);
}

export function locationHeaders(locationId: number | null | undefined) {
  return { "X-Location-Id": locationId == null ? "" : String(locationId) };
}
