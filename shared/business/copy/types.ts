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

export type AgendaCopy = {
  professional: {
    label: string;
    fallbackName: string;
    filterPlaceholder: string;
    allFilter: string;
    empty: string;
    selectRequired: string;
    chooseFirst: string;
    noAvailability: string;
    noServices: string;
    noCompatibleServices: string;
    invalidAppointment: string;
    incompatibleService: string;
    unavailableForEdit: string;
    otherOwnerNotice: string;
  };
  locationScope: string;
  blockEstablishmentHelp: string;
  blockProfessionalHelp: string;
  noProfessionalsAtLocation: string;
  outsideHoursCreateHelp: string;
  outsideHoursEditHelp: string;
  historyNotesHelp: string;
  historyNotesPlaceholder: string;
  appointmentNotesPlaceholder: string;
};

export type AdminCopy = {
  auth: {
    accessAudience: string;
    passwordInviteHelp: string;
  };
  team: {
    heading: string;
    description: string;
    add: string;
    create: string;
    edit: string;
    loading: string;
    empty: string;
    archivedHeading: string;
    publicPresentationHelp: string;
    createSuccess: string;
    createError: string;
    removeSuccess: string;
    removeError: string;
    reactivated: string;
    archived: string;
    updateSuccess: string;
    updateEmailChanged: string;
    updateError: string;
    hidden: string;
    visible: string;
    visibilityError: string;
    reactivateError: string;
    removeConflict: string;
    absenceConflict: string;
    chooseReplacement: string;
    replacementLabel: string;
    replacementHelp: string;
    missingReplacementTitle: string;
    missingReplacementDescription: string;
    futureReassigned: string;
    associateTrigger: string;
    associateTitle: string;
    associateDescription: string;
    associateSuccessTitle: string;
    associateSuccessDescription: string;
    associateEmpty: string;
    associateAria: string;
    associatePlaceholder: string;
    associateAction: string;
    serviceSelectionHelp: string;
    sharedAcrossLocations: string;
  };
  compensation: {
    modelLabel: string;
    commissionSummary: string;
    workspaceRentSummary: string;
    workspaceRentModel: string;
    commissionHelp: string;
    workspaceRentHelp: string;
    noneHelp: string;
    professionalPercentLabel: string;
    workspaceRentAmountLabel: string;
  };
  schedules: {
    establishmentBaseHeading: string;
    establishmentSaved: string;
    establishmentSaveError: string;
    establishmentLoadError: string;
    establishmentDescription: string;
    establishmentClosedDay: string;
    locationProfessionalAria: string;
    locationProfessionalTrigger: string;
    locationProfessionalTitle: string;
    locationProfessionalDescription: string;
    loadProfessionalError: string;
    ownLocationSchedule: string;
    inheritedLocationSchedule: string;
    notWorkingAtLocation: string;
    saveLocationSchedule: string;
    useEstablishmentSchedule: string;
    locationScheduleSaved: string;
  };
  locations: {
    description: string;
    managedLabel: string;
    namePlaceholder: string;
  };
  services: {
    professionalAssociationHelp: string;
    globalSharedHelp: string;
    localSectionHeading: string;
    localTermsDescription: string;
    localPriceLabel: string;
    localDurationLabel: string;
    removeFromLocationTitle: string;
    removeFromLocationDescription: string;
    removeFromLocationConfirm: string;
    removedFromLocation: string;
    hiddenAtLocation: string;
    activeAtLocation: string;
    activeAtLocationStatus: string;
    inactiveAtLocationStatus: string;
  };
  extras: {
    followCompensation: string;
    professional: string;
    establishment: string;
  };
};

export type BusinessCopy = {
  booking: BookingCopy;
  agenda: AgendaCopy;
  admin: AdminCopy;
};

export function formatBusinessCopy(
  template: string,
  values: Record<string, string | number>,
) {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (placeholder, key: string) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder
  ));
}
