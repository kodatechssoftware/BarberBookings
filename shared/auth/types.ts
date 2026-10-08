import type { CapabilityCode } from "./capabilities";
import type { AccessPresetKey } from "./presets";

export type AuthUser = {
  id: number;
  email: string;
  displayName: string | null;
  isActive: boolean;
};

type AccessScopeBase = {
  /** Optional preset plus explicit capabilities can coexist in the same scope. */
  preset?: AccessPresetKey;
  capabilities?: readonly CapabilityCode[];
};

export type GlobalAccessScope = AccessScopeBase & {
  kind: "global";
};

export type LocationAccessScope = AccessScopeBase & {
  kind: "location";
  locationId: number;
};

export type AccessScope = GlobalAccessScope | LocationAccessScope;

export type EffectiveLocationAccess = {
  locationId: number;
  capabilities: readonly CapabilityCode[];
};

export type EffectiveAccess = {
  globalCapabilities: readonly CapabilityCode[];
  locationCapabilities: readonly EffectiveLocationAccess[];
  presetLabels: readonly string[];
};

export type AuthContext = {
  user: AuthUser;
  /** Identity link only. It never grants access by itself. */
  professionalId: number | null;
  access: EffectiveAccess;
};
