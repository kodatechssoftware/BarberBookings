import assert from "node:assert/strict";
import test from "node:test";
import {
  clampWindowTimeToHour,
  getWindowTimeOptions,
  maxWindowClockTime,
  minWindowClockTime,
  rebaseAvailabilityWindows,
  shiftWindowClockMinute,
} from "../../client/src/lib/availability-window-time";

test("window picker only offers times inside the service", () => {
  const atStart = getWindowTimeOptions("13:30", "14:45", "13");
  assert.deepEqual(atStart.hours, ["13", "14"]);
  assert.equal(atStart.minutes[0], "30");
  assert.equal(atStart.minutes.at(-1), "59");

  const atEnd = getWindowTimeOptions("13:30", "14:45", "14");
  assert.equal(atEnd.minutes[0], "00");
  assert.equal(atEnd.minutes.at(-1), "45");
  assert.deepEqual(getWindowTimeOptions("13:30", "14:45", "12").minutes, []);
});

test("changing hours clamps the selected minute to the service bounds", () => {
  assert.equal(clampWindowTimeToHour("13", "15", "13:30", "14:45"), "13:30");
  assert.equal(clampWindowTimeToHour("14", "59", "13:30", "14:45"), "14:45");
  assert.equal(clampWindowTimeToHour("14", "30", "13:30", "14:45"), "14:30");
  assert.equal(clampWindowTimeToHour("12", "30", "13:30", "14:45"), null);
});

test("moving an appointment moves its availability windows by the same amount", () => {
  assert.deepEqual(rebaseAvailabilityWindows(
    [{ startTime: "13:40", endTime: "14:10" }, { startTime: "14:20", endTime: "14:35" }],
    "13:30", "16:00", "17:15",
  ), [
    { startTime: "16:10", endTime: "16:40" },
    { startTime: "16:50", endTime: "17:05" },
  ]);
});

test("a shorter service keeps its window inside the new end time", () => {
  assert.deepEqual(rebaseAvailabilityWindows(
    [{ startTime: "13:45", endTime: "14:30" }],
    "13:30", "13:30", "14:00",
  ), [{ startTime: "13:30", endTime: "14:00" }]);
});

test("window endpoints keep at least one minute between start and end", () => {
  assert.equal(shiftWindowClockMinute("14:00", -1), "13:59");
  assert.equal(shiftWindowClockMinute("14:00", 1), "14:01");
  assert.equal(minWindowClockTime("13:59", "14:45"), "13:59");
  assert.equal(maxWindowClockTime("14:01", "13:30"), "14:01");
});
