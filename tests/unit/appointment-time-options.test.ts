import assert from "node:assert/strict";
import test from "node:test";
import { createAppointmentTimeOptions } from "../../client/src/lib/appointment-time-options";

function values(intervalMinutes: 15 | 30 | 60, currentTime = "16:00") {
  return createAppointmentTimeOptions({ currentTime, intervalMinutes });
}

test("appointment time options follow the configured 60-minute grid", () => {
  const options = values(60);
  assert.deepEqual(
    options.filter((option) => option.value >= "15:00" && option.value <= "17:00"),
    [
      { value: "15:00", label: "15:00" },
      { value: "16:00", label: "16:00" },
      { value: "17:00", label: "17:00" },
    ],
  );
  assert.equal(options.some((option) => ["16:15", "16:30", "16:45"].includes(option.value)), false);
});

test("appointment time options follow the configured 30 and 15-minute grids", () => {
  assert.deepEqual(
    values(30).filter((option) => option.value >= "16:00" && option.value <= "17:30").map((option) => option.value),
    ["16:00", "16:30", "17:00", "17:30"],
  );
  assert.deepEqual(
    values(15).filter((option) => option.value >= "16:00" && option.value <= "16:45").map((option) => option.value),
    ["16:00", "16:15", "16:30", "16:45"],
  );
});

test("a historical off-grid time remains a single explicit current option", () => {
  const options = values(60, "16:30");
  assert.deepEqual(options.filter((option) => option.value === "16:30"), [
    { value: "16:30", label: "16:30 — Hora atual" },
  ]);
  assert.deepEqual(
    options.filter((option) => option.value >= "16:00" && option.value <= "17:00"),
    [
      { value: "16:00", label: "16:00" },
      { value: "16:30", label: "16:30 — Hora atual" },
      { value: "17:00", label: "17:00" },
    ],
  );
});
