import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPublicBookingMonthOpeningNotice,
  getPublicBookingMonthOpeningNotice,
  getPublicBookingWindow,
} from "../../shared/public-booking-window";

const timeZone = "Europe/Lisbon";

function notice(now: string, visibleMonth: string) {
  return getPublicBookingMonthOpeningNotice(
    getPublicBookingWindow(new Date(now), timeZone, 20),
    `${visibleMonth}-01`,
  );
}

test("calendar notice follows the September 19/20/21 booking boundary", () => {
  const september19 = notice("2026-09-19T12:00:00Z", "2026-09");
  assert.deepEqual(september19, { bookingMonth: "2026-10", openingDate: "2026-09-20" });
  assert.equal(
    formatPublicBookingMonthOpeningNotice(september19!),
    "As marcações para outubro ficam disponíveis a partir de 20 de setembro.",
  );

  assert.equal(notice("2026-09-19T23:00:00Z", "2026-09"), null,
    "00:00 on 20 September in Lisbon must open October");
  assert.equal(notice("2026-09-21T12:00:00Z", "2026-09"), null);

  const octoberFromSeptember = notice("2026-09-21T12:00:00Z", "2026-10");
  assert.deepEqual(octoberFromSeptember, { bookingMonth: "2026-11", openingDate: "2026-10-20" });
  assert.equal(
    formatPublicBookingMonthOpeningNotice(octoberFromSeptember!),
    "As marcações para novembro ficam disponíveis a partir de 20 de outubro.",
  );
});

test("calendar notice follows the October 19/20 boundary and the visible month", () => {
  assert.deepEqual(notice("2026-10-19T12:00:00Z", "2026-10"), {
    bookingMonth: "2026-11",
    openingDate: "2026-10-20",
  });
  assert.equal(notice("2026-10-19T23:00:00Z", "2026-10"), null,
    "00:00 on 20 October in Lisbon must open November");
  const november = notice("2026-10-20T12:00:00Z", "2026-11");
  assert.deepEqual(november, { bookingMonth: "2026-12", openingDate: "2026-11-20" });
});

test("calendar notice handles year changes, February and 30/31-day months", () => {
  const december = notice("2026-12-19T12:00:00Z", "2026-12");
  assert.deepEqual(december, { bookingMonth: "2027-01", openingDate: "2026-12-20" });
  assert.equal(
    formatPublicBookingMonthOpeningNotice(december!),
    "As marcações para janeiro ficam disponíveis a partir de 20 de dezembro.",
  );

  assert.deepEqual(notice("2026-12-20T12:00:00Z", "2027-01"), {
    bookingMonth: "2027-02",
    openingDate: "2027-01-20",
  });
  assert.deepEqual(notice("2027-02-19T12:00:00Z", "2027-02"), {
    bookingMonth: "2027-03",
    openingDate: "2027-02-20",
  });
  assert.equal(notice("2027-02-20T00:00:00Z", "2027-02"), null);
  assert.deepEqual(notice("2027-04-19T12:00:00Z", "2027-04"), {
    bookingMonth: "2027-05",
    openingDate: "2027-04-20",
  });
  assert.deepEqual(notice("2027-05-19T12:00:00Z", "2027-05"), {
    bookingMonth: "2027-06",
    openingDate: "2027-05-20",
  });
});

test("notice is hidden when the feature is disabled or the next visible month is already open", () => {
  const window = getPublicBookingWindow(new Date("2026-09-21T12:00:00Z"), timeZone, 20);
  assert.equal(getPublicBookingMonthOpeningNotice({ ...window, enabled: false }, "2026-10-01"), null);
  assert.equal(getPublicBookingMonthOpeningNotice(window, "2026-09-01"), null);
  assert.equal(getPublicBookingMonthOpeningNotice(window, "invalid"), null);
});
