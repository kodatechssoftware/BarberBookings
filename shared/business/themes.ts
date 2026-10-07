import type { BusinessVertical } from "./vertical";

export const businessThemeIds = ["classic-gold", "beauty-clean"] as const;

export type BusinessThemeId = (typeof businessThemeIds)[number];

export const defaultBusinessThemes = {
  barber: "classic-gold",
  beauty: "beauty-clean",
} as const satisfies Record<BusinessVertical, BusinessThemeId>;

export function parseBusinessThemeId(
  value: string | null | undefined,
): BusinessThemeId | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;

  if (businessThemeIds.includes(normalized as BusinessThemeId)) {
    return normalized as BusinessThemeId;
  }

  throw new Error(`BUSINESS_THEME must be one of: ${businessThemeIds.join(", ")}.`);
}
