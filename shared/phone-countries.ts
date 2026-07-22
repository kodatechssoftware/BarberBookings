export const PHONE_COUNTRIES = [
  { code: "PT", label: "Portugal", flag: "🇵🇹", dialCode: "+351", minDigits: 9, maxDigits: 9, placeholder: "912 345 678" },
  { code: "ES", label: "Espanha", flag: "🇪🇸", dialCode: "+34", minDigits: 9, maxDigits: 9, placeholder: "612 345 678" },
  { code: "DE", label: "Alemanha", flag: "🇩🇪", dialCode: "+49", minDigits: 7, maxDigits: 13, placeholder: "151 23456789" },
  { code: "FR", label: "França", flag: "🇫🇷", dialCode: "+33", minDigits: 9, maxDigits: 9, placeholder: "6 12 34 56 78" },
  { code: "GB", label: "Reino Unido", flag: "🇬🇧", dialCode: "+44", minDigits: 10, maxDigits: 10, placeholder: "7700 900123" },
  { code: "BR", label: "Brasil", flag: "🇧🇷", dialCode: "+55", minDigits: 10, maxDigits: 11, placeholder: "11 91234 5678" },
  { code: "AO", label: "Angola", flag: "🇦🇴", dialCode: "+244", minDigits: 9, maxDigits: 9, placeholder: "923 456 789" },
  { code: "NL", label: "Países Baixos", flag: "🇳🇱", dialCode: "+31", minDigits: 9, maxDigits: 9, placeholder: "6 12345678" },
  { code: "IT", label: "Itália", flag: "🇮🇹", dialCode: "+39", minDigits: 9, maxDigits: 11, placeholder: "312 345 6789" },
] as const;

export type PhoneCountryCode = typeof PHONE_COUNTRIES[number]["code"];

export const DEFAULT_PHONE_COUNTRY = PHONE_COUNTRIES[0];

export const supportedPhoneValidationMessage =
  "Introduza um telemóvel válido para o país e indicativo selecionados.";

export function formatPhoneInput(value: string, maxLength = 16) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

export function isDigitsOnly(value: string) {
  return /^\d*$/.test(value);
}

export function getPhoneCountry(countryCode: PhoneCountryCode) {
  return PHONE_COUNTRIES.find((country) => country.code === countryCode) ?? DEFAULT_PHONE_COUNTRY;
}

function toInternationalValue(value: string) {
  const trimmed = value.trim();

  if (trimmed.startsWith("00")) {
    return `+${trimmed.replace(/\D/g, "").slice(2)}`;
  }

  if (trimmed.startsWith("+")) {
    return `+${trimmed.replace(/\D/g, "")}`;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("351") && /^9\d{8}$/.test(digits.slice(3))) {
    return `+${digits}`;
  }

  return trimmed;
}

export function splitStoredPhone(value: string) {
  const normalizedValue = toInternationalValue(value);
  const matchedCountry = PHONE_COUNTRIES.find((country) => normalizedValue.startsWith(country.dialCode));

  if (!matchedCountry) {
    return {
      countryCode: DEFAULT_PHONE_COUNTRY.code as PhoneCountryCode,
      localPhone: formatPhoneInput(normalizedValue, DEFAULT_PHONE_COUNTRY.maxDigits),
    };
  }

  return {
    countryCode: matchedCountry.code as PhoneCountryCode,
    localPhone: formatPhoneInput(
      normalizedValue.slice(matchedCountry.dialCode.length),
      matchedCountry.maxDigits,
    ),
  };
}

export function isValidPhoneForCountry(value: string, countryCode: PhoneCountryCode) {
  const country = getPhoneCountry(countryCode);
  const digits = value.replace(/\D/g, "");

  if (digits !== value.trim()) return false;
  if (countryCode === "PT") return /^9\d{8}$/.test(digits);
  return digits.length >= country.minDigits && digits.length <= country.maxDigits;
}

export function toStoredPhone(value: string, countryCode: PhoneCountryCode) {
  const country = getPhoneCountry(countryCode);
  return `${country.dialCode}${formatPhoneInput(value, country.maxDigits)}`;
}

export function normalizeSupportedPhone(value?: string | null) {
  const rawValue = (value || "").trim();
  if (!rawValue) return "";

  const explicitlyInternational = rawValue.startsWith("+") || rawValue.startsWith("00");
  const normalizedValue = toInternationalValue(rawValue);
  const matchedCountry = PHONE_COUNTRIES.find((country) => normalizedValue.startsWith(country.dialCode));

  if (explicitlyInternational && !matchedCountry) return "";

  const { countryCode, localPhone } = splitStoredPhone(rawValue);
  if (!isValidPhoneForCountry(localPhone, countryCode)) return "";

  return toStoredPhone(localPhone, countryCode);
}

export function supportedPhonesMatch(left?: string | null, right?: string | null) {
  const normalizedLeft = normalizeSupportedPhone(left);
  const normalizedRight = normalizeSupportedPhone(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function formatLocalPhoneForDisplay(localPhone: string, placeholder: string) {
  const groups = placeholder.split(/\s+/).map((group) => group.length);
  if (groups.reduce((total, length) => total + length, 0) !== localPhone.length) {
    return localPhone;
  }

  let cursor = 0;
  return groups.map((length) => {
    const group = localPhone.slice(cursor, cursor + length);
    cursor += length;
    return group;
  }).join(" ");
}

export function formatPhoneForDisplay(value?: string | null) {
  const normalizedPhone = normalizeSupportedPhone(value);
  if (!normalizedPhone) return value || "-";

  const { countryCode, localPhone } = splitStoredPhone(normalizedPhone);
  const country = getPhoneCountry(countryCode);
  return `${country.dialCode} ${formatLocalPhoneForDisplay(localPhone, country.placeholder)}`;
}
