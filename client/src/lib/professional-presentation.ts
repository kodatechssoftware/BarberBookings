import fabioAvatar from "@assets/fabio-baptista-avatar.jpg";
import brunoAvatar from "@assets/bruno-santos-avatar.jpg";
import type { ResolvedShopBranding } from "./branding";
import { getProfessionalAvatarFallback } from "./professional-fallback-policy";

const classicPalette = ["#38BDF8", "#22C55E", "#F97316", "#D4AF37", "#A78BFA", "#F43F5E", "#14B8A6", "#EAB308"];
const barberPolePalette = ["#9F2638", "#6B7280", "#374151", "#7F1D1D", "#52525B", "#A85555", "#475569", "#78716C"];
const beautyPalette = ["#D6A1AD", "#B98591", "#C9A96E", "#9C8278", "#B49AAF", "#B87586", "#8FA5A1", "#C79A88"];

export function getProfessionalColorOptions(branding: ResolvedShopBranding) {
  if (branding.theme === "barber-pole") {
    return { defaultColor: "#9F2638", palette: barberPolePalette };
  }
  if (branding.theme === "beauty-clean") {
    return { defaultColor: "#D6A1AD", palette: beautyPalette };
  }
  return { defaultColor: "#D4AF37", palette: classicPalette };
}

export function normalizeProfessionalColor(color: string | null | undefined, fallback: string) {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback;
}

export function getProfessionalAvatar(
  professional: { name: string; avatar?: string | null },
  branding: ResolvedShopBranding,
  fallbackLogoUrl = branding.logoUrl,
) {
  if (professional.avatar) return professional.avatar;
  const fallback = getProfessionalAvatarFallback(professional.name, branding.useLegacyBarberAvatars);
  if (fallback === "baptista") return fabioAvatar;
  if (fallback === "bruno") return brunoAvatar;
  return fallbackLogoUrl;
}
