import {
  hasCapability,
  hasCapabilityAtLocation,
  type CapabilityCode,
  type EffectiveAccess,
} from "@shared/auth";

export type RuntimeAccessUser = {
  role: "" | "admin" | "barber" | "user";
  access?: EffectiveAccess;
};

export function canUseRuntimeCapability(
  user: RuntimeAccessUser | null | undefined,
  capability: CapabilityCode,
  locationId: number | null | undefined,
  legacyFallback: (role: RuntimeAccessUser["role"]) => boolean,
) {
  if (!user) return false;
  if (!user.access) return legacyFallback(user.role);
  return locationId && locationId > 0
    ? hasCapabilityAtLocation(user.access, capability, locationId)
    : hasCapability(user.access, capability);
}

