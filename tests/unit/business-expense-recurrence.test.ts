import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarMonthDay,
  calendarWeekday,
  isRecurringExpensePaused,
  recurringExpenseDates,
} from "../../shared/business-expense-recurrence";
import { getCalendarDateBounds } from "../../server/calendar-timezone";

test("monthly day 31 falls on the last valid day and remains stable", () => {
  assert.deepEqual(recurringExpenseDates({
    anchorDate: "2027-01-31",
    from: "2027-01-01",
    through: "2027-04-30",
    schedule: { recurrence: "monthly", weekday: null, monthDay: 31 },
  }), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
});

test("weekly schedule preserves the configured weekday and exact boundaries", () => {
  assert.equal(calendarWeekday("2027-01-04"), 1);
  assert.deepEqual(recurringExpenseDates({
    anchorDate: "2027-01-04",
    from: "2027-01-04",
    through: "2027-01-18",
    schedule: { recurrence: "weekly", weekday: 1, monthDay: null },
  }), ["2027-01-04", "2027-01-11", "2027-01-18"]);
});

test("pause ranges are inclusive at pause and exclusive at resume", () => {
  const pauses = [{ pausedFrom: "2027-01-11", resumedOn: "2027-01-25" }];
  assert.equal(isRecurringExpensePaused("2027-01-11", pauses), true);
  assert.equal(isRecurringExpensePaused("2027-01-24", pauses), true);
  assert.equal(isRecurringExpensePaused("2027-01-25", pauses), false);
  assert.deepEqual(recurringExpenseDates({
    anchorDate: "2027-01-04",
    from: "2027-01-04",
    through: "2027-02-01",
    schedule: { recurrence: "weekly", weekday: 1, monthDay: null },
    pauses,
  }), ["2027-01-04", "2027-01-25", "2027-02-01"]);
});

test("ended series excludes the end date and following dates", () => {
  assert.deepEqual(recurringExpenseDates({
    anchorDate: "2027-01-01",
    from: "2027-01-01",
    through: "2027-04-30",
    endedOn: "2027-03-01",
    schedule: { recurrence: "monthly", weekday: null, monthDay: calendarMonthDay("2027-01-01") },
  }), ["2027-01-01", "2027-02-01"]);
});

test("occurrence day boundaries respect the location timezone and DST", () => {
  const lisbonDst = getCalendarDateBounds("2027-03-28", "Europe/Lisbon");
  assert.equal(lisbonDst.start.toISOString(), "2027-03-28T00:00:00.000Z");
  assert.equal(lisbonDst.endExclusive.toISOString(), "2027-03-28T23:00:00.000Z");
  assert.equal(lisbonDst.endExclusive.getTime() - lisbonDst.start.getTime(), 23 * 60 * 60 * 1000);

  const newYork = getCalendarDateBounds("2027-07-15", "America/New_York");
  assert.equal(newYork.start.toISOString(), "2027-07-15T04:00:00.000Z");
  assert.equal(newYork.endExclusive.toISOString(), "2027-07-16T04:00:00.000Z");
});
