const portugueseMobilePattern = /^9\d{8}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const phoneValidationMessage =
  "Introduza um telemóvel português com 9 dígitos, por exemplo 912 345 678.";

export const emailValidationMessage =
  "Introduza um email válido, por exemplo cliente@email.com.";

export function normalizePortuguesePhone(value?: string | null) {
  const digits = (value || "").replace(/\D/g, "");

  if (digits.startsWith("00351") && digits.length === 14) {
    return digits.slice(5);
  }

  if (digits.startsWith("351") && digits.length === 12) {
    return digits.slice(3);
  }

  return digits;
}

export function isValidPortugueseMobile(value?: string | null) {
  return portugueseMobilePattern.test(normalizePortuguesePhone(value));
}

export function normalizeEmail(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

export function isValidOptionalEmail(value?: string | null) {
  const email = normalizeEmail(value);
  return email === "" || emailPattern.test(email);
}
