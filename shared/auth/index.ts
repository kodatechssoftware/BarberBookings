export {
  capabilityCodes,
  capabilityRegistry,
  canGrantCapabilityAtLocation,
  isOwnCapability,
  ownCapabilityCodes,
  type CapabilityArea,
  type CapabilityCode,
  type OwnCapabilityCode,
} from "./capabilities";
export {
  accessPresetKeys,
  accessPresets,
  professionalCapabilityCodes,
  resolvePresetCapabilities,
  type AccessPreset,
  type AccessPresetKey,
} from "./presets";
export {
  hasCapability,
  hasCapabilityAtLocation,
  hasOwnCapability,
  resolveEffectiveAccess,
} from "./access";
export type {
  AccessScope,
  AuthContext,
  AuthUser,
  EffectiveAccess,
  EffectiveLocationAccess,
  GlobalAccessScope,
  LocationAccessScope,
} from "./types";
