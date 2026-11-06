export const beautyV2FeatureNames = [
  "appointmentRequests",
  "teamProfiles",
  "googleReviews",
  "notificationDeliveryStatus",
  "consultationRole",
  "multiServiceAppointments",
  "parallelServiceScheduling",
] as const;

export type BeautyV2FeatureName = (typeof beautyV2FeatureNames)[number];
export type BeautyV2Features = Record<BeautyV2FeatureName, boolean>;

export type BeautyV2FeatureSetting = {
  featureName: BeautyV2FeatureName;
  locationId: number | null;
  enabled: boolean;
};

export const disabledBeautyV2Features: Readonly<BeautyV2Features> = Object.freeze(
  Object.fromEntries(beautyV2FeatureNames.map((name) => [name, false])) as BeautyV2Features,
);

export function parseBeautyV2MasterSwitch(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return false;
  if (["true", "1"].includes(normalized)) return true;
  if (["false", "0"].includes(normalized)) return false;
  throw new Error("BEAUTY_V2_FEATURES_ENABLED must be true or false.");
}

export function isBeautyV2FeatureName(value: string): value is BeautyV2FeatureName {
  return beautyV2FeatureNames.includes(value as BeautyV2FeatureName);
}

export function resolveBeautyV2Features(input: {
  masterEnabled: boolean;
  settings: readonly BeautyV2FeatureSetting[];
  locationId?: number | null;
}): BeautyV2Features {
  if (!input.masterEnabled) return { ...disabledBeautyV2Features };

  const resolved = { ...disabledBeautyV2Features };
  for (const setting of input.settings) {
    if (setting.locationId === null) resolved[setting.featureName] = setting.enabled;
  }
  if (input.locationId !== undefined && input.locationId !== null) {
    for (const setting of input.settings) {
      if (setting.locationId === input.locationId) resolved[setting.featureName] = setting.enabled;
    }
  }
  return resolved;
}
