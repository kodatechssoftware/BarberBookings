import type { AuthRuntimeMode } from "./auth-runtime";

export type InitialSeedState = {
  authRuntimeMode: AuthRuntimeMode;
  hasLegacyProfessionalData: boolean;
  hasCanonicalUsers: boolean;
};

export function shouldSkipLegacyInitialSeed(state: InitialSeedState) {
  if (state.authRuntimeMode !== "canonical") return false;

  // A new canonical installation is intentionally empty until /setup creates
  // its first administrator. Once that identity exists, later restarts must
  // remain on the same canonical lifecycle even after professionals are added.
  return !state.hasLegacyProfessionalData || state.hasCanonicalUsers;
}

export async function runInitialSeedPolicy(input: InitialSeedState & {
  prepareCanonicalInstallation: () => Promise<void>;
  runLegacySeed: () => Promise<void>;
}) {
  if (shouldSkipLegacyInitialSeed(input)) {
    await input.prepareCanonicalInstallation();
    return "canonical" as const;
  }

  await input.runLegacySeed();
  return "legacy" as const;
}
