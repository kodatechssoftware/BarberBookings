export type MoneyInputParseOptions = {
  minCents?: number;
  maxCents?: number;
};

const editableMoneyPattern = /^\d+(?:,\d{0,2})?$/;

function normalizeDecimalSeparator(value: string) {
  return value.replace(".", ",");
}

function stripRedundantLeadingZeros(value: string) {
  const [whole, fraction] = value.split(",");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  return fraction === undefined ? normalizedWhole : `${normalizedWhole},${fraction}`;
}

/**
 * Normalizes a user edit without guessing or rounding its monetary value.
 * Invalid edits (including a third decimal place) keep the last valid draft.
 */
export function normalizeMoneyInput(nextValue: string, previousValue = "") {
  const trimmed = nextValue.trim();
  if (!trimmed) return "";

  const withDecimalComma = normalizeDecimalSeparator(trimmed);
  const withLeadingZero = withDecimalComma.startsWith(",")
    ? `0${withDecimalComma}`
    : withDecimalComma;

  if (!editableMoneyPattern.test(withLeadingZero)) return previousValue;
  return stripRedundantLeadingZeros(withLeadingZero);
}

/** Parses a decimal draft into integer cents without using floating-point money. */
export function moneyInputToCents(value: string, options: MoneyInputParseOptions = {}) {
  const normalized = normalizeDecimalSeparator(value.trim());
  const match = /^(\d+)(?:,(\d{0,2}))?$/.exec(normalized);
  if (!match) return null;

  const centsValue = BigInt(match[1]) * BigInt(100)
    + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (centsValue > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const cents = Number(centsValue);
  if (options.minCents !== undefined && cents < options.minCents) return null;
  if (options.maxCents !== undefined && cents > options.maxCents) return null;
  return cents;
}

export function centsToMoneyInput(cents: number | null | undefined) {
  if (cents === null || cents === undefined || !Number.isSafeInteger(cents) || cents < 0) return "";
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole},${fraction}`;
}

/** Formats a valid draft on blur, while leaving an empty/invalid draft editable. */
export function formatMoneyInputOnBlur(value: string, options: MoneyInputParseOptions = {}) {
  if (!value.trim()) return "";
  const cents = moneyInputToCents(value, options);
  return cents === null ? value : centsToMoneyInput(cents);
}
