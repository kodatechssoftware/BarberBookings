export type BookingCopy = {
  steps: readonly [string, string, string, string];
  navigation: {
    back: string;
    backHome: string;
    backPreviousAria: string;
    headerTitle: string;
    changeLocation: string;
    next: string;
    confirm: string;
    submitting: string;
    returnHome: string;
  };
  locations: {
    unavailableTitle: string;
    loadError: string;
    empty: string;
    eyebrow: string;
    heading: string;
    description: string;
  };
  professional: {
    heading: string;
    description: string;
    loadError: string;
    empty: string;
    noPreference: string;
    anyAvailable: string;
  };
  service: {
    heading: string;
    description: string;
    loadError: string;
    emptyLocation: string;
    emptyProfessional: string;
  };
  dateTime: {
    dateHeading: string;
    timeHeading: string;
    loadingWindow: string;
    availableDaysLegend: string;
    loadError: string;
    noAvailabilityInWindow: string;
    selectDateFirst: string;
    dateLoadError: string;
    establishmentClosed: string;
    noAvailabilityForDate: string;
    timeRequired: string;
  };
  details: {
    summaryTitle: string;
    professionalLabel: string;
    serviceLabel: string;
    dateTimeLabel: string;
    totalLabel: string;
    nameLabel: string;
    namePlaceholder: string;
    phoneLabel: string;
    phoneCountryAriaLabel: string;
    emailLabel: string;
    emailPlaceholder: string;
    phoneNotice: string;
    emailHelp: string;
  };
  validation: {
    nameRequired: string;
    phoneRequired: string;
    phoneInvalid: string;
    phoneDigitsExact: string;
    phoneDigitsRange: string;
    emailInvalid: string;
    selectionRequiredTitle: string;
    selectionRequiredDescription: string;
    incompleteSelectionTitle: string;
    incompleteSelectionDescription: string;
    unavailableDateTitle: string;
    nextMonthOpening: string;
    bookingWindowError: string;
    invalidDetailsTitle: string;
    invalidDetailsDescription: string;
    submitErrorTitle: string;
    submitErrorFallback: string;
    exposeServerErrorMessage: boolean;
  };
  confirmation: {
    heading: string;
    reserved: string;
    deliveryNotice: string;
    deliveryFallbackWithEmail: string;
    deliveryFallbackWithoutEmail: string;
  };
};

export type BusinessCopy = {
  booking: BookingCopy;
};

export function formatBusinessCopy(
  template: string,
  values: Record<string, string | number>,
) {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (placeholder, key: string) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder
  ));
}
