import assert from "node:assert/strict";
import test from "node:test";
import { insertAppointmentSchema } from "../../shared/schema";
import {
  PHONE_COUNTRIES,
  formatPhoneForDisplay,
  formatPhoneInput,
  isValidPhoneForCountry,
  normalizePhoneNumber,
  splitStoredPhone,
  supportedPhonesMatch,
} from "../../shared/phone-countries";

const referenceNumbers = [
  ["PT", "912345678", "+351912345678"],
  ["ES", "612345678", "+34612345678"],
  ["FR", "06 12 34 56 78", "+33612345678"],
  ["GB", "07700 900123", "+447700900123"],
  ["DE", "015123456789", "+4915123456789"],
  ["BR", "11 91234-5678", "+5511912345678"],
] as const;

test("normalizes representative national numbers to E.164", () => {
  for (const [country, input, expected] of referenceNumbers) {
    assert.equal(normalizePhoneNumber(input, country), expected, `${country}: ${input}`);
    assert.equal(isValidPhoneForCountry(input, country), true, `${country}: ${input}`);
  }
});

test("accepts complete international numbers independently of the selected country", () => {
  for (const [, , expected] of referenceNumbers) {
    assert.equal(normalizePhoneNumber(expected, "PT"), expected);
    assert.equal(normalizePhoneNumber(`00${expected.slice(1)}`, "PT"), expected);
  }
});

test("supports the full country catalogue and additional regions", () => {
  assert.ok(PHONE_COUNTRIES.length >= 240);
  assert.equal(new Set(PHONE_COUNTRIES.map(({ code }) => code)).size, PHONE_COUNTRIES.length);
  assert.equal(normalizePhoneNumber("2015550123", "US"), "+12015550123");
  assert.equal(normalizePhoneNumber("090-1234-5678", "JP"), "+819012345678");
  assert.equal(normalizePhoneNumber("078 123 45 67", "CH"), "+41781234567");
  assert.equal(normalizePhoneNumber("06 12345678", "NL"), "+31612345678");
  assert.equal(normalizePhoneNumber("923 123 456", "AO"), "+244923123456");
});

test("rejects impossible, too short and too long numbers", () => {
  for (const value of [
    "",
    "123",
    "+35191",
    "+351912345678999",
    "+999123456789",
    "111111111",
    "000000000",
    "abc",
    "91--0000000",
  ] as const) {
    assert.equal(normalizePhoneNumber(value), "", value);
  }
});

test("formatting and country changes never silently discard digits", () => {
  const raw = "015123456789999";
  const formattedForGermany = formatPhoneInput(raw, "DE");
  const reformattedForFrance = formatPhoneInput(formattedForGermany, "FR");
  assert.equal(formattedForGermany.replace(/\D/g, ""), raw);
  assert.equal(reformattedForFrance.replace(/\D/g, ""), raw);
});

test("detects country and keeps national display formatting for stored E.164", () => {
  assert.deepEqual(splitStoredPhone("+33612345678"), {
    countryCode: "FR",
    localPhone: "06 12 34 56 78",
  });
  assert.match(formatPhoneForDisplay("+5511912345678"), /^\+55 /);
});

test("preserves compatibility with Portuguese and provider legacy formats", () => {
  assert.equal(normalizePhoneNumber("912 345 678"), "+351912345678");
  assert.equal(normalizePhoneNumber("351912345678"), "+351912345678");
  assert.equal(supportedPhonesMatch("912345678", "+351 912 345 678"), true);
});

test("the public appointment contract rejects invalid phones and emits E.164", () => {
  const input = {
    barberId: 1,
    serviceId: 1,
    startTime: new Date("2026-11-10T10:00:00.000Z"),
    customerName: "Cliente internacional",
    customerPhone: "0033612345678",
  };
  const parsed = insertAppointmentSchema.parse(input);
  assert.equal(parsed.customerPhone, "+33612345678");
  assert.equal(insertAppointmentSchema.safeParse({ ...input, customerPhone: "+35191" }).success, false);
});
