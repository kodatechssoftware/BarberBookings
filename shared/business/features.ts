export const businessFeatureNames = [
  "clientProfile",
  "consentForms",
  "treatmentContraindications",
  "preparationBuffers",
  "recurringExpenses",
  "resources",
  "deposits",
  "treatmentPhotos",
  "packages",
  "giftCardLedger",
  "workspaceRent",
  "multiLocation",
] as const;

export type BusinessFeatureName = (typeof businessFeatureNames)[number];
export type BusinessFeatures = Record<BusinessFeatureName, boolean>;

type FeatureCapability = {
  implemented: boolean;
  environmentVariable?: string;
};

export const businessCapabilityRegistry = {
  clientProfile: {
    implemented: false,
    environmentVariable: "BUSINESS_FEATURE_CLIENT_PROFILE_ENABLED",
  },
  consentForms: {
    implemented: false,
    environmentVariable: "BUSINESS_FEATURE_CONSENT_FORMS_ENABLED",
  },
  treatmentContraindications: {
    implemented: false,
    environmentVariable: "BUSINESS_FEATURE_TREATMENT_CONTRAINDICATIONS_ENABLED",
  },
  preparationBuffers: {
    implemented: true,
    environmentVariable: "BUSINESS_FEATURE_PREPARATION_BUFFERS_ENABLED",
  },
  recurringExpenses: {
    implemented: true,
    environmentVariable: "BUSINESS_FEATURE_RECURRING_EXPENSES_ENABLED",
  },
  resources: {
    implemented: false,
    environmentVariable: "BUSINESS_FEATURE_RESOURCES_ENABLED",
  },
  deposits: {
    implemented: false,
    environmentVariable: "BUSINESS_FEATURE_DEPOSITS_ENABLED",
  },
  treatmentPhotos: {
    implemented: false,
    environmentVariable: "BUSINESS_FEATURE_TREATMENT_PHOTOS_ENABLED",
  },
  packages: {
    implemented: false,
    environmentVariable: "BUSINESS_FEATURE_PACKAGES_ENABLED",
  },
  giftCardLedger: {
    implemented: false,
    environmentVariable: "BUSINESS_FEATURE_GIFT_CARD_LEDGER_ENABLED",
  },
  workspaceRent: { implemented: true },
  multiLocation: {
    implemented: true,
    environmentVariable: "MULTI_LOCATION_ENABLED",
  },
} as const satisfies Record<BusinessFeatureName, FeatureCapability>;

const recognizedFeatureEnvironmentVariables: ReadonlySet<string> = new Set<string>(
  Object.values(businessCapabilityRegistry).flatMap((capability) => (
    "environmentVariable" in capability ? [capability.environmentVariable] : []
  )),
);

function parseOptionalBoolean(name: string, value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["true", "1"].includes(normalized)) return true;
  if (["false", "0"].includes(normalized)) return false;
  throw new Error(`${name} must be true or false.`);
}

export function validateBusinessFeatureEnvironment(
  environment: Record<string, string | undefined>,
) {
  for (const [name, value] of Object.entries(environment)) {
    if (!name.startsWith("BUSINESS_FEATURE_") || !name.endsWith("_ENABLED")) continue;
    if (!recognizedFeatureEnvironmentVariables.has(name)) {
      throw new Error(`Unknown business feature flag: ${name}.`);
    }
    parseOptionalBoolean(name, value);
  }
}

export function resolveBusinessFeatures(input: {
  environment: Record<string, string | undefined>;
  defaults: BusinessFeatures;
  multiLocationEnabled: boolean;
}): BusinessFeatures {
  validateBusinessFeatureEnvironment(input.environment);

  const resolved: BusinessFeatures = {
    ...input.defaults,
    multiLocation: input.multiLocationEnabled,
  };

  for (const name of businessFeatureNames) {
    const capability = businessCapabilityRegistry[name];
    const environmentVariable = "environmentVariable" in capability
      ? capability.environmentVariable
      : undefined;
    if (!environmentVariable || environmentVariable === "MULTI_LOCATION_ENABLED") continue;

    const requested = parseOptionalBoolean(
      environmentVariable,
      input.environment[environmentVariable],
    );
    if (requested === true && !capability.implemented) {
      throw new Error(
        `${environmentVariable} cannot be enabled because ${name} is not implemented.`,
      );
    }
    if (requested !== undefined) resolved[name] = requested;
  }

  return resolved;
}
