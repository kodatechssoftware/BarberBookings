import type { BookingSlotIntervalMinutes } from "../booking-slot-interval";
import type { MultiLocationConfig } from "../multi-location-config";
import type { BusinessBookingFlow } from "./booking-flow";
import type { BusinessBrandingProfile } from "./branding";
import type { BusinessCopy } from "./copy";
import type { BusinessFeatures } from "./features";
import type { BusinessTerms } from "./terms";
import type { BusinessThemeId } from "./themes";
import type { BusinessVertical } from "./vertical";

export const businessConfigSchemaVersion = 2 as const;

export type ResolvedBusinessConfig = {
  schemaVersion: typeof businessConfigSchemaVersion;
  vertical: BusinessVertical;
  terms: BusinessTerms;
  copy: BusinessCopy;
  booking: {
    flow: BusinessBookingFlow;
  };
  branding: BusinessBrandingProfile;
  features: BusinessFeatures;
  theme: {
    id: BusinessThemeId;
  };
  runtime: {
    multiLocation: MultiLocationConfig;
    bookingSlotIntervalMinutes: BookingSlotIntervalMinutes;
  };
};
