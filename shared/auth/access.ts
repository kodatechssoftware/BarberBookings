import {
  canGrantCapabilityAtLocation,
  type CapabilityCode,
  type OwnCapabilityCode,
} from "./capabilities";
import { accessPresets, resolvePresetCapabilities } from "./presets";
import type { AccessScope, EffectiveAccess } from "./types";

function addScopeCapabilities(
  target: Set<CapabilityCode>,
  scope: AccessScope,
): void {
  const capabilities = [
    ...(scope.preset ? resolvePresetCapabilities(scope.preset) : []),
    ...(scope.capabilities ?? []),
  ];

  for (const capability of capabilities) {
    if (scope.kind === "location" && !canGrantCapabilityAtLocation(capability)) {
      throw new Error(
        `${capability} cannot be granted at location scope (${scope.locationId}).`,
      );
    }
    target.add(capability);
  }
}

export function resolveEffectiveAccess(scopes: readonly AccessScope[]): EffectiveAccess {
  const globalCapabilities = new Set<CapabilityCode>();
  const capabilitiesByLocation = new Map<number, Set<CapabilityCode>>();
  const presetLabels = new Set<string>();

  for (const scope of scopes) {
    if (scope.preset) presetLabels.add(accessPresets[scope.preset].label);

    if (scope.kind === "global") {
      addScopeCapabilities(globalCapabilities, scope);
      continue;
    }

    if (!Number.isSafeInteger(scope.locationId) || scope.locationId <= 0) {
      throw new Error("Location access scopes require a positive integer locationId.");
    }

    const locationCapabilities = capabilitiesByLocation.get(scope.locationId)
      ?? new Set<CapabilityCode>();
    addScopeCapabilities(locationCapabilities, scope);
    capabilitiesByLocation.set(scope.locationId, locationCapabilities);
  }

  return {
    globalCapabilities: Array.from(globalCapabilities),
    locationCapabilities: Array.from(capabilitiesByLocation.entries()).map(
      ([locationId, capabilities]) => ({
        locationId,
        capabilities: Array.from(capabilities),
      }),
    ),
    presetLabels: Array.from(presetLabels),
  };
}

/**
 * Checks installation-wide access only. A location-scoped grant must never pass
 * this helper accidentally; use hasCapabilityAtLocation for location operations.
 */
export function hasCapability(
  access: EffectiveAccess,
  capability: CapabilityCode,
): boolean {
  return access.globalCapabilities.includes(capability);
}

export function hasCapabilityAtLocation(
  access: EffectiveAccess,
  capability: CapabilityCode,
  locationId: number,
): boolean {
  if (hasCapability(access, capability)) return true;

  return access.locationCapabilities.some(
    (locationAccess) => locationAccess.locationId === locationId
      && locationAccess.capabilities.includes(capability),
  );
}

/** Own/team are deliberately exact grants; this helper adds no implicit hierarchy. */
export function hasOwnCapability(
  access: EffectiveAccess,
  capability: OwnCapabilityCode,
  locationId?: number,
): boolean {
  return locationId === undefined
    ? hasCapability(access, capability)
    : hasCapabilityAtLocation(access, capability, locationId);
}
