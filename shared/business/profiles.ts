import { businessBookingFlows, type BusinessBookingFlow } from "./booking-flow";
import { businessBrandingProfiles, type BusinessBrandingProfile } from "./branding";
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
  branding: BusinessBrandingProfile;
  defaultTheme: BusinessThemeId;
  featureDefaults: BusinessFeatures;
};

const barberFeatureDefaults: BusinessFeatures = {
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

const beautyFeatureDefaults: BusinessFeatures = {
  ...barberFeatureDefaults,
  preparationBuffers: true,
};

export const businessProfiles = {
  barber: {
    vertical: "barber",
    terms: businessTerms.barber,
    copy: businessCopy.barber,
    bookingFlow: businessBookingFlows.barber,
    branding: businessBrandingProfiles.barber,
    defaultTheme: defaultBusinessThemes.barber,
    featureDefaults: barberFeatureDefaults,
  },
  beauty: {
    vertical: "beauty",
    terms: businessTerms.beauty,
    copy: businessCopy.beauty,
    bookingFlow: businessBookingFlows.beauty,
    branding: businessBrandingProfiles.beauty,
    defaultTheme: defaultBusinessThemes.beauty,
    featureDefaults: beautyFeatureDefaults,
  },
} as const satisfies Record<BusinessVertical, BusinessProfile>;

export function getBusinessProfile(vertical: BusinessVertical): BusinessProfile {
  return businessProfiles[vertical];
}
