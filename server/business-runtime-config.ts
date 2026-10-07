import { parseBookingSlotIntervalMinutes } from "@shared/booking-slot-interval";
import { resolveBusinessFeatures } from "@shared/business/features";
import { getBusinessProfile } from "@shared/business/profiles";
import {
  businessConfigSchemaVersion,
  type ResolvedBusinessConfig,
} from "@shared/business/public-config";
import { parseBusinessThemeId } from "@shared/business/themes";
import { parseBusinessVertical } from "@shared/business/vertical";
import { parseMultiLocationConfig } from "@shared/multi-location-config";

export type BusinessRuntimeResolution = {
  config: ResolvedBusinessConfig;
  warnings: string[];
};

export function resolveBusinessRuntimeConfig(
  environment: Record<string, string | undefined>,
  options: { productionDeployment: boolean },
): BusinessRuntimeResolution {
  const warnings: string[] = [];
  let vertical = parseBusinessVertical(environment.BUSINESS_VERTICAL);

  if (!vertical) {
    if (options.productionDeployment) {
      throw new Error("BUSINESS_VERTICAL is required in Production.");
    }
    vertical = "barber";
    warnings.push(
      "BUSINESS_VERTICAL is not configured; using barber for Development/Test.",
    );
  }

  const profile = getBusinessProfile(vertical);
  const multiLocation = parseMultiLocationConfig(environment);
  const features = resolveBusinessFeatures({
    environment,
    defaults: profile.featureDefaults,
    multiLocationEnabled: multiLocation.enabled,
  });
  const themeId = parseBusinessThemeId(environment.BUSINESS_THEME) ?? profile.defaultTheme;

  return {
    config: {
      schemaVersion: businessConfigSchemaVersion,
      vertical,
      terms: profile.terms,
      copy: profile.copy,
      booking: { flow: profile.bookingFlow },
      features,
      theme: { id: themeId },
      runtime: {
        multiLocation,
        bookingSlotIntervalMinutes: parseBookingSlotIntervalMinutes(
          environment.BOOKING_SLOT_INTERVAL_MINUTES,
        ),
      },
    },
    warnings,
  };
}
