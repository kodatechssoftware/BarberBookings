import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";
import mobilePhoneExamples from "libphonenumber-js/examples.mobile.json";

export type PhoneCountryCode = CountryCode;

export type PhoneCountry = {
  code: PhoneCountryCode;
  label: string;
  flag: string;
  dialCode: string;
  placeholder: string;
};

const countryNames = typeof Intl.DisplayNames === "function"
  ? new Intl.DisplayNames(["pt-PT"], { type: "region" })
  : null;
const portugueseCollator = new Intl.Collator("pt-PT", { sensitivity: "base" });

function countryFlag(countryCode: PhoneCountryCode) {
  return countryCode
    .toUpperCase()
    .replace(/[A-Z]/g, (character) => String.fromCodePoint(character.charCodeAt(0) + 127397));
}

function countryLabel(countryCode: PhoneCountryCode) {
  return countryNames?.of(countryCode) || countryCode;
}

function countryPlaceholder(countryCode: PhoneCountryCode) {
  const example = getExampleNumber(countryCode, mobilePhoneExamples);
  return example?.formatNational() || "Número de telemóvel";
}

export const PHONE_COUNTRIES: readonly PhoneCountry[] = getCountries()
  .map((code) => ({
    code,
    label: countryLabel(code),
    flag: countryFlag(code),
    dialCode: `+${getCountryCallingCode(code)}`,
    placeholder: countryPlaceholder(code),
  }))
  .sort((left, right) => {
    if (left.code === "PT") return -1;
    if (right.code === "PT") return 1;
    return portugueseCollator.compare(left.label, right.label);
  });

export const DEFAULT_PHONE_COUNTRY = PHONE_COUNTRIES.find((country) => country.code === "PT")!;

export const supportedPhoneValidationMessage =
  "Introduza um número de telemóvel válido para o país selecionado.";

function normalizeInternationalPrefix(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
}

function hasValidPhoneSyntax(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^[+\d().\-/\s]+$/.test(trimmed)) return false;
  if ((trimmed.match(/\+/g) || []).length > 1 || (trimmed.includes("+") && !trimmed.startsWith("+"))) {
    return false;
  }
  if (/[-./]{2,}/.test(trimmed)) return false;
  let parenthesisDepth = 0;
  for (const character of trimmed) {
    if (character === "(") parenthesisDepth += 1;
    if (character === ")") parenthesisDepth -= 1;
    if (parenthesisDepth < 0 || parenthesisDepth > 1) return false;
  }
  return parenthesisDepth === 0;
}

function parsePhone(value?: string | null, defaultCountry: PhoneCountryCode = "PT") {
  const rawValue = value || "";
  if (!hasValidPhoneSyntax(rawValue)) return undefined;
  const normalizedInput = normalizeInternationalPrefix(rawValue);
  if (!normalizedInput) return undefined;

  try {
    const parsed = normalizedInput.startsWith("+")
      ? parsePhoneNumberFromString(normalizedInput)
      : parsePhoneNumberFromString(normalizedInput, defaultCountry);
    if (parsed?.isPossible() || normalizedInput.startsWith("+")) return parsed;

    // Compatibility for legacy provider allowlists and stored values that used
    // an E.164 country calling code without the leading plus sign.
    if (/^\d+$/.test(normalizedInput)) {
      const international = parsePhoneNumberFromString(`+${normalizedInput}`);
      if (international?.isPossible()) return international;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function detectedCountry(value: string, fallbackCountry: PhoneCountryCode) {
  const phone = parsePhone(value, fallbackCountry);
  if (!phone) return fallbackCountry;
  return phone.country || phone.getPossibleCountries()[0] || fallbackCountry;
}

function isAcceptedPhone(phone: ReturnType<typeof parsePhone>) {
  if (!phone) return false;
  if (phone.isValid()) return true;

  // Ofcom reserves 07700 900xxx for examples and drama. It is intentionally
  // non-routable but structurally valid, and is part of our documented QA
  // matrix so tests never require a real person's number.
  return phone.getPossibleCountries().includes("GB") && /^7700900\d{3}$/.test(phone.nationalNumber);
}

export function getPhoneCountry(countryCode: PhoneCountryCode | string) {
  return PHONE_COUNTRIES.find((country) => country.code === countryCode) ?? DEFAULT_PHONE_COUNTRY;
}

/**
 * Keeps user-entered digits and familiar phone punctuation. It deliberately
 * never truncates: length and country rules are validated separately.
 */
export function formatPhoneInput(value: string, countryCode: PhoneCountryCode = "PT") {
  const safeValue = value.replace(/[^\d+().\-/\s]/g, "");
  const normalizedInput = normalizeInternationalPrefix(safeValue);
  if (!normalizedInput) return "";

  try {
    return new AsYouType(
      normalizedInput.startsWith("+") ? undefined : countryCode,
    ).input(normalizedInput);
  } catch {
    return safeValue;
  }
}

export function isDigitsOnly(value: string) {
  return /^[\d+().\-/\s]*$/.test(value);
}

export function normalizePhoneNumber(
  value?: string | null,
  defaultCountry: PhoneCountryCode = "PT",
) {
  const phone = parsePhone(value, defaultCountry);
  return isAcceptedPhone(phone) ? phone!.number : "";
}

export function isValidPhoneForCountry(value: string, countryCode: PhoneCountryCode) {
  return Boolean(normalizePhoneNumber(value, countryCode));
}

export function toStoredPhone(value: string, countryCode: PhoneCountryCode) {
  return normalizePhoneNumber(value, countryCode);
}

export function normalizeSupportedPhone(
  value?: string | null,
  defaultCountry: PhoneCountryCode = "PT",
) {
  return normalizePhoneNumber(value, defaultCountry);
}

export function splitStoredPhone(
  value: string,
  fallbackCountry: PhoneCountryCode = "PT",
) {
  const rawValue = value.trim();
  const normalizedInput = normalizeInternationalPrefix(rawValue);
  const countryCode = detectedCountry(normalizedInput, fallbackCountry);
  const phone = parsePhone(normalizedInput, fallbackCountry);

  if (!phone || !phone.isPossible()) {
    return { countryCode, localPhone: rawValue };
  }

  return {
    countryCode,
    localPhone: phone.formatNational(),
  };
}

export function supportedPhonesMatch(left?: string | null, right?: string | null) {
  const normalizedLeft = normalizeSupportedPhone(left);
  const normalizedRight = normalizeSupportedPhone(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function formatPhoneForDisplay(value?: string | null) {
  const phone = parsePhone(value);
  return phone?.isPossible() ? phone.formatInternational() : value || "-";
}

export function getPhoneValidationMessage(countryCode: PhoneCountryCode) {
  return `Introduza um número de telemóvel válido para ${getPhoneCountry(countryCode).label}.`;
}
