let bookingPagePromise: ReturnType<typeof importBookingPage> | undefined;
let adminPagePromise: ReturnType<typeof importAdminPage> | undefined;
let cancellationPagePromise: ReturnType<typeof importCancellationPage> | undefined;
let reschedulePagePromise: ReturnType<typeof importReschedulePage> | undefined;

function importBookingPage() {
  return import("@/pages/Booking");
}

function importAdminPage() {
  return import("@/pages/Admin");
}

function importCancellationPage() {
  return import("@/pages/Cancellation");
}

function importReschedulePage() {
  return import("@/pages/Reschedule");
}

export function preloadBookingPage() {
  bookingPagePromise ??= importBookingPage();
  return bookingPagePromise;
}

export function preloadAdminPage() {
  adminPagePromise ??= importAdminPage();
  return adminPagePromise;
}

export function preloadCancellationPage() {
  cancellationPagePromise ??= importCancellationPage();
  return cancellationPagePromise;
}

export function preloadReschedulePage() {
  reschedulePagePromise ??= importReschedulePage();
  return reschedulePagePromise;
}
