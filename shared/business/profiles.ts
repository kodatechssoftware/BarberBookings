import { businessBookingFlows, type BusinessBookingFlow } from "./booking-flow";
import { businessCopy, type BusinessCopy } from "./copy";
import type { BusinessFeatures } from "./features";
import { businessTerms, type BusinessTerms } from "./terms";
import { defaultBusinessThemes, type BusinessThemeId } from "./themes";
import type { BusinessVertical } from "./vertical";

export type BusinessProfile = {
  vertical: BusinessVertical;
  terms: BusinessTerms;
  copy: BusinessCopy;
  bookingFlow: BusinessBookingFlow;
  defaultTheme: BusinessThemeId;
  featureDefaults: BusinessFeatures;
};

const currentFeatureDefaults: BusinessFeatures = {
  clientProfile: false,
  consentForms: false,
  treatmentContraindications: false,
  preparationBuffers: false,
  resources: false,
  deposits: false,
  treatmentPhotos: false,
  packages: false,
  giftCardLedger: false,
  workspaceRent: true,
  multiLocation: false,
};

export const businessProfiles = {
  barber: {
    vertical: "barber",
    terms: businessTerms.barber,
    copy: businessCopy.barber,
    bookingFlow: businessBookingFlows.barber,
    defaultTheme: defaultBusinessThemes.barber,
    featureDefaults: currentFeatureDefaults,
  },
  beauty: {
    vertical: "beauty",
    terms: businessTerms.beauty,
    copy: businessCopy.beauty,
    bookingFlow: businessBookingFlows.beauty,
    defaultTheme: defaultBusinessThemes.beauty,
    // Future Beauty capabilities remain disabled until their implementation is shipped.
    featureDefaults: currentFeatureDefaults,
  },
} as const satisfies Record<BusinessVertical, BusinessProfile>;

export function getBusinessProfile(vertical: BusinessVertical): BusinessProfile {
  return businessProfiles[vertical];
}
