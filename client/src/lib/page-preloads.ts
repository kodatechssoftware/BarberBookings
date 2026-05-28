let bookingPagePromise: ReturnType<typeof importBookingPage> | undefined;

function importBookingPage() {
  return import("@/pages/Booking");
}

export function preloadBookingPage() {
  bookingPagePromise ??= importBookingPage();
  return bookingPagePromise;
}
