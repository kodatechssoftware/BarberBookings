import { parseBeautyV2MasterSwitch } from "@shared/business/v2-features";
import type { AccessPresetProfile } from "@shared/auth";

export function runtimeAccessPresetProfile(
  environment: NodeJS.ProcessEnv = process.env,
): AccessPresetProfile {
  return environment.BUSINESS_VERTICAL?.trim().toLowerCase() === "beauty"
    && parseBeautyV2MasterSwitch(environment.BEAUTY_V2_FEATURES_ENABLED)
    ? "beauty-v2"
    : "default";
}
