import assert from "node:assert/strict";
import test from "node:test";
import { getAvailableTimeSlots, calendarTimeInTimeZone } from "../../client/src/lib/availability";
import {
  getAvailabilitySocialImageLayout,
  getAvailabilitySocialImageDimensions,
  getAvailabilitySocialTrackedGlyphLayout,
  formatAvailabilitySocialServiceLine,
  sanitizeAvailabilitySocialFileName,
  type AvailabilitySocialRect,
} from "../../client/src/lib/availability-social-image";
import { formatPublicBookingLabel, resolvePublicBookingUrl } from "../../client/src/lib/public-booking-link";
import {
  availabilitySocialPresetStorageKey,
  createDefaultAvailabilitySocialSettings,
  normalizeAvailabilitySocialSettings,
} from "../../client/src/lib/availability-social-presets";

const barbers = [
  { id: 1, serviceIds: [10] },
  { id: 2, serviceIds: [10] },
];

const saturday = new Date(2026, 9, 31, 12, 0, 0);
const saturdayRows = [
  { barberId: 1, dayOfWeek: 6, startTime: "09:00", endTime: "12:00", isWorking: true },
  { barberId: 2, dayOfWeek: 6, startTime: "09:00", endTime: "12:00", isWorking: true },
];
const saturdayShopRows = [
  { dayOfWeek: 6, startTime: "09:00", endTime: "12:00", isOpen: true },
];

test("social image formats keep the exact Instagram dimensions and safe filenames", () => {
  assert.deepEqual(getAvailabilitySocialImageDimensions("story"), {
    width: 1080,
    height: 1920,
    label: "Story vertical",
    detail: "1080 × 1920 px",
  });
  assert.deepEqual(getAvailabilitySocialImageDimensions("square"), {
    width: 1080,
    height: 1080,
    label: "Publicação quadrada",
    detail: "1080 × 1080 px",
  });
  assert.equal(sanitizeAvailabilitySocialFileName("Baptista Barber Shop — Baião"), "baptista-barber-shop-baiao");
});

test("public booking links prefer the configured deployment URL and fail over safely", () => {
  assert.equal(
    resolvePublicBookingUrl("https://baptista.kodatechs.com/", "https://barberbookings-dev.onrender.com"),
    "https://baptista.kodatechs.com/booking",
  );
  assert.equal(
    resolvePublicBookingUrl("not-a-url", "https://barberbookings-dev.onrender.com"),
    "https://barberbookings-dev.onrender.com/booking",
  );
  assert.equal(
    resolvePublicBookingUrl("http://localhost:5000", "https://barberbookings-dev.onrender.com"),
    "https://barberbookings-dev.onrender.com/booking",
  );
  assert.equal(resolvePublicBookingUrl("javascript:alert(1)", ""), "");
  assert.equal(formatPublicBookingLabel("https://baptista.kodatechs.com/booking"), "baptista.kodatechs.com/booking");
});

test("social images omit the aggregate professional label without leaving a separator", () => {
  for (const template of ["classic", "modern", "premium"] as const) {
    for (const format of ["story", "square"] as const) {
      assert.equal(
        formatAvailabilitySocialServiceLine("Corte de cabelo", ""),
        "Corte de cabelo",
        `${template}/${format}: aggregate selection should only show the service`,
      );
      assert.equal(
        formatAvailabilitySocialServiceLine("Corte de cabelo", "Bruno Santos"),
        "Corte de cabelo · Bruno Santos",
        `${template}/${format}: individual selection should show service and professional`,
      );
    }
  }
});

function contains(outer: AvailabilitySocialRect, inner: AvailabilitySocialRect) {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function intersects(first: AvailabilitySocialRect, second: AvailabilitySocialRect) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

test("tracked headings keep variable-width and accented glyphs uniformly positioned around the center", () => {
  const value = "POWERHOUSE BARBERSHOP 24/7 — Ç";
  const characters = Array.from(value);
  const widths = characters.map((character) => character === " " ? 9 : "MW".includes(character) ? 22 : 14);
  const tracking = 4;
  const centerX = 540;
  const glyphs = getAvailabilitySocialTrackedGlyphLayout(value, widths, centerX, tracking);

  assert.equal(glyphs.length, characters.length);
  for (let index = 1; index < glyphs.length; index += 1) {
    assert.equal(glyphs[index].x - glyphs[index - 1].x, widths[index - 1] + tracking);
  }
  const firstEdge = glyphs[0].x;
  const lastEdge = glyphs.at(-1)!.x + glyphs.at(-1)!.width;
  assert.equal((firstEdge + lastEdge) / 2, centerX);
});

test("story and square layouts keep content regions and 1/2/3/4/6/8 slots separated", () => {
  for (const format of ["story", "square"] as const) {
    for (const scheduleLayout of ["balanced", "compact", "stacked"] as const) {
      for (const slotCount of [1, 2, 3, 4, 6, 8]) {
      const layout = getAvailabilitySocialImageLayout(format, slotCount, scheduleLayout);
      const regions = [layout.header, layout.title, layout.meta, layout.slots];

      for (const region of regions) assert.equal(contains(layout.safeArea, region), true, `${format}: region outside safe area`);
      for (let index = 0; index < regions.length; index += 1) {
        for (let other = index + 1; other < regions.length; other += 1) {
          assert.equal(intersects(regions[index], regions[other]), false, `${format}: content regions overlap`);
        }
      }

      assert.equal(layout.slotRects.length, slotCount);
      for (const slot of layout.slotRects) assert.equal(contains(layout.slots, slot), true, `${format}: slot outside slot region`);
      for (let index = 0; index < layout.slotRects.length; index += 1) {
        for (let other = index + 1; other < layout.slotRects.length; other += 1) {
          assert.equal(intersects(layout.slotRects[index], layout.slotRects[other]), false, `${format}: slot cards overlap`);
        }
      }
      assert.deepEqual(
        Object.keys(layout).sort(),
        ["header", "meta", "safeArea", "slotRects", "slots", "title"],
        `${format}: only essential image regions should remain`,
      );
      }
    }
  }
});

test("slot compositions stay moderate and adapt their rows to the selected amount", () => {
  const storySingle = getAvailabilitySocialImageLayout("story", 1, "balanced").slotRects[0];
  const squareSingle = getAvailabilitySocialImageLayout("square", 1, "balanced").slotRects[0];
  assert.ok(storySingle.width <= 430 && storySingle.height <= 170);
  assert.ok(squareSingle.width <= 380 && squareSingle.height <= 125);

  for (const format of ["story", "square"] as const) {
    const two = getAvailabilitySocialImageLayout(format, 2, "balanced").slotRects;
    assert.equal(two[0].y, two[1].y, `${format}: two slots should sit side by side`);

    const three = getAvailabilitySocialImageLayout(format, 3, "balanced").slotRects;
    assert.equal(three[0].y, three[1].y, `${format}: first row should contain two slots`);
    assert.ok(three[2].y > three[0].y, `${format}: third slot should form a centered second row`);

    for (const count of [4, 6, 8]) {
      const rects = getAvailabilitySocialImageLayout(format, count, "balanced").slotRects;
      assert.equal(new Set(rects.map((rect) => rect.x)).size, 2, `${format}/${count}: expected two columns`);
    }
  }

  const compactThree = getAvailabilitySocialImageLayout("story", 3, "compact").slotRects;
  assert.equal(new Set(compactThree.map((rect) => rect.x)).size, 3);
  assert.equal(new Set(compactThree.map((rect) => rect.y)).size, 1);

  const stackedThree = getAvailabilitySocialImageLayout("story", 3, "stacked").slotRects;
  assert.equal(new Set(stackedThree.map((rect) => rect.x)).size, 1);
  assert.equal(new Set(stackedThree.map((rect) => rect.y)).size, 3);
});

test("saved visual settings are bounded and reject unsafe persisted values", () => {
  assert.equal(
    availabilitySocialPresetStorageKey("location-1"),
    "barberbookings:availability-social-presets:v2:location-1",
  );
  assert.notEqual(
    availabilitySocialPresetStorageKey("location-1"),
    availabilitySocialPresetStorageKey("location-2"),
  );
  const defaults = createDefaultAvailabilitySocialSettings("premium");
  assert.equal(defaults.template, "premium");
  assert.equal(defaults.backgroundImageId, null);
  assert.deepEqual(normalizeAvailabilitySocialSettings({
    template: "modern",
    accentColor: "#abcdef",
    secondaryColor: "#123456",
    overlayOpacity: 4,
    scheduleLayout: "compact",
    backgroundImageId: "asset-1",
    backgroundImageName: "photo.jpg",
    backgroundPositionX: -10,
    backgroundPositionY: 110,
    backgroundZoom: 9,
  }), {
    template: "modern",
    accentColor: "#ABCDEF",
    secondaryColor: "#123456",
    overlayOpacity: 0.85,
    scheduleLayout: "compact",
    backgroundImageId: "asset-1",
    backgroundImageName: "photo.jpg",
    backgroundPositionX: 0,
    backgroundPositionY: 100,
    backgroundZoom: 1.8,
  });
  const invalid = normalizeAvailabilitySocialSettings({ accentColor: "javascript:alert(1)", scheduleLayout: "free" });
  assert.equal(invalid.accentColor, "#D4AF37");
  assert.equal(invalid.scheduleLayout, "balanced");
});

test("promotion availability respects service duration and never announces a slot that does not fit", () => {
  const base = {
    selectedDate: saturday,
    selectedBarberId: 1,
    visibleBarbers: barbers,
    availabilityRows: saturdayRows,
    shopAvailabilityRows: saturdayShopRows,
    existingAppointments: [],
    now: new Date(2026, 9, 30, 8, 0, 0),
    timeZone: "Europe/Lisbon",
    slotIntervalMinutes: 30 as const,
  };

  const shortSlots = getAvailableTimeSlots({ ...base, selectedService: { id: 10, duration: 30 } })
    .filter((slot) => slot.available).map((slot) => slot.time);
  const longSlots = getAvailableTimeSlots({ ...base, selectedService: { id: 10, duration: 180 } })
    .filter((slot) => slot.available).map((slot) => slot.time);
  const tooLongSlots = getAvailableTimeSlots({ ...base, selectedService: { id: 10, duration: 210 } })
    .filter((slot) => slot.available).map((slot) => slot.time);

  assert.deepEqual(shortSlots, ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
  assert.deepEqual(longSlots, ["09:00"]);
  assert.deepEqual(tooLongSlots, []);
});

test("all-professionals and individual views use the same conflict and timezone engine", () => {
  const firstStart = calendarTimeInTimeZone(saturday, "09:00", "Europe/Lisbon");
  const input = {
    selectedService: { id: 10, duration: 60 },
    selectedDate: saturday,
    visibleBarbers: barbers,
    availabilityRows: saturdayRows,
    shopAvailabilityRows: saturdayShopRows,
    existingAppointments: [
      { id: 1, barberId: 1, serviceId: 10, startTime: firstStart.toISOString(), duration: 60 },
      { id: 2, barberId: 2, serviceId: 10, startTime: firstStart.toISOString(), duration: 30 },
    ],
    now: new Date(2026, 9, 30, 8, 0, 0),
    timeZone: "Europe/Lisbon",
    slotIntervalMinutes: 30 as const,
  };

  const all = new Map(getAvailableTimeSlots({ ...input, selectedBarberId: 0 }).map((slot) => [slot.time, slot.available]));
  const first = new Map(getAvailableTimeSlots({ ...input, selectedBarberId: 1 }).map((slot) => [slot.time, slot.available]));
  const second = new Map(getAvailableTimeSlots({ ...input, selectedBarberId: 2 }).map((slot) => [slot.time, slot.available]));

  assert.equal(all.get("09:00"), false);
  assert.equal(all.get("09:30"), true);
  assert.equal(first.get("09:30"), false);
  assert.equal(second.get("09:30"), true);
});

test("same-day promotion does not expose slots at or before the current instant", () => {
  const now = calendarTimeInTimeZone(saturday, "09:30", "Europe/Lisbon");
  const availability = new Map(getAvailableTimeSlots({
    selectedService: { id: 10, duration: 30 },
    selectedDate: saturday,
    selectedBarberId: 1,
    visibleBarbers: barbers,
    availabilityRows: saturdayRows,
    shopAvailabilityRows: saturdayShopRows,
    existingAppointments: [],
    now,
    timeZone: "Europe/Lisbon",
    slotIntervalMinutes: 30,
  }).map((slot) => [slot.time, slot.available]));

  assert.equal(availability.get("09:00"), false);
  assert.equal(availability.get("09:30"), false);
  assert.equal(availability.get("10:00"), true);
});
