const DEFAULT_MAX_LOCATIONS = 1;
const MAX_SUPPORTED_LOCATIONS = 50;

export type MultiLocationConfig = {
  enabled: boolean;
  maxLocations: number;
};

export function parseMultiLocationConfig(
  environment: Record<string, string | undefined>,
): MultiLocationConfig {
  const enabled = environment.MULTI_LOCATION_ENABLED?.trim().toLowerCase() === "true";
  if (!enabled) {
    return { enabled: false, maxLocations: DEFAULT_MAX_LOCATIONS };
  }
  const rawMaxLocations = environment.MAX_LOCATIONS?.trim();
  const parsedMaxLocations = rawMaxLocations
    ? Number.parseInt(rawMaxLocations, 10)
    : DEFAULT_MAX_LOCATIONS;

  if (
    !Number.isInteger(parsedMaxLocations) ||
    parsedMaxLocations < 1 ||
    parsedMaxLocations > MAX_SUPPORTED_LOCATIONS ||
    (rawMaxLocations && String(parsedMaxLocations) !== rawMaxLocations)
  ) {
    throw new Error(
      `MAX_LOCATIONS deve ser um número inteiro entre 1 e ${MAX_SUPPORTED_LOCATIONS}.`,
    );
  }

  return {
    enabled,
    maxLocations: parsedMaxLocations,
  };
}

