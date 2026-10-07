export const businessVerticals = ["barber", "beauty"] as const;

export type BusinessVertical = (typeof businessVerticals)[number];

export function parseBusinessVertical(
  value: string | null | undefined,
): BusinessVertical | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;

  if (businessVerticals.includes(normalized as BusinessVertical)) {
    return normalized as BusinessVertical;
  }

  throw new Error(
    `BUSINESS_VERTICAL must be one of: ${businessVerticals.join(", ")}.`,
  );
}
