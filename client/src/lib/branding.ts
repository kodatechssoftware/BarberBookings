import { businessBrandingProfiles, type BusinessBrandingProfile } from "@shared/business/branding";
import type { BusinessThemeId } from "@shared/business/themes";

const env = import.meta.env;

declare const __DEMO_MODE__: boolean;

const isPowerhouseDemo = __DEMO_MODE__;
const requestedTheme = env.VITE_BRAND_THEME?.trim().toLowerCase();
const powerhouseAddress = "Rua Adelino de Oliveira 85, 4470-025 Maia";

export type ResolvedShopBranding = {
  theme: BusinessThemeId | "barber-pole";
  name: string;
  shortName: string;
  address: string;
  logoUrl: string;
  horizontalLogoUrl: string;
  iconUrl: string;
  mapUrl: string;
  mapEmbedUrl: string;
  showMap: boolean;
  useLegacyBarberAvatars: boolean;
  professionalFallbackMode: BusinessBrandingProfile["professionalFallbackMode"];
  instagramUrl: string;
  heroTitle: string;
  heroDescription: string;
  heroImageUrl: string;
  heroImageAlt: string;
  heroPrimaryCtaLabel: string;
  heroSecondaryCtaLabel: string;
  metaTitle: string;
  metaDescription: string;
  socialImageUrl: string;
  manifestThemeColor: string;
};

function resolveTheme(profileTheme: BusinessThemeId): ResolvedShopBranding["theme"] {
  if (isPowerhouseDemo) return "barber-pole";
  if (requestedTheme === "barber-pole") return "classic-gold";
  if (requestedTheme === "classic-gold" || requestedTheme === "beauty-clean") return requestedTheme;
  return profileTheme;
}

export function resolveShopBranding(
  profile: BusinessBrandingProfile,
  profileTheme: BusinessThemeId,
): ResolvedShopBranding {
  if (isPowerhouseDemo) {
    return {
      theme: "barber-pole",
      name: "Powerhouse barbershop",
      shortName: "Powerhouse",
      address: powerhouseAddress,
      logoUrl: "/images/demo-logo.svg",
      horizontalLogoUrl: "/images/demo-logo.svg",
      iconUrl: "/images/demo-logo.svg",
      mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(powerhouseAddress)}`,
      mapEmbedUrl: "",
      showMap: env.VITE_HIDE_SHOP_MAP !== "true",
      useLegacyBarberAvatars: false,
      professionalFallbackMode: "brand-logo",
      instagramUrl: env.VITE_INSTAGRAM_URL?.trim() || "",
      heroTitle: "Estilo, precisão e atitude",
      heroDescription: "Barbearia masculina na Maia, com cortes, barba e tratamentos feitos ao detalhe.",
      heroImageUrl: "/images/powerhouse-hero.jpg",
      heroImageAlt: "Barbeiro da Powerhouse a executar um corte",
      heroPrimaryCtaLabel: "Marcar agora",
      heroSecondaryCtaLabel: "Ver serviços",
      metaTitle: "Powerhouse barbershop",
      metaDescription: "Barbearia masculina na Maia, com cortes, barba e tratamentos feitos ao detalhe.",
      socialImageUrl: "/images/powerhouse-hero.jpg",
      manifestThemeColor: "#9F2638",
    };
  }

  return {
    theme: resolveTheme(profileTheme),
    name: env.VITE_SHOP_NAME?.trim() || profile.defaultName,
    shortName: env.VITE_SHOP_SHORT_NAME?.trim() || profile.defaultShortName,
    address: env.VITE_SHOP_ADDRESS?.trim() || profile.defaultAddress,
    logoUrl: env.VITE_SHOP_LOGO_URL?.trim() || profile.defaultLogoUrl,
    horizontalLogoUrl: env.VITE_SHOP_HORIZONTAL_LOGO_URL?.trim() || profile.defaultHorizontalLogoUrl,
    iconUrl: env.VITE_SHOP_ICON_URL?.trim() || profile.defaultIconUrl,
    mapUrl: env.VITE_SHOP_MAP_URL?.trim() || profile.defaultMapUrl,
    mapEmbedUrl: env.VITE_SHOP_MAP_EMBED_URL?.trim() || profile.defaultMapEmbedUrl,
    showMap: env.VITE_HIDE_SHOP_MAP !== "true",
    useLegacyBarberAvatars:
      profile.professionalFallbackMode === "legacy-barber-avatars"
      && env.VITE_USE_LEGACY_BARBER_AVATARS !== "false",
    professionalFallbackMode: profile.professionalFallbackMode,
    instagramUrl: env.VITE_INSTAGRAM_URL?.trim() || "",
    heroTitle: env.VITE_HERO_TITLE?.trim() || profile.hero.title,
    heroDescription: env.VITE_HERO_DESCRIPTION?.trim() || profile.hero.description,
    heroImageUrl: env.VITE_HERO_IMAGE_URL?.trim() || profile.hero.imageUrl,
    heroImageAlt: env.VITE_HERO_IMAGE_ALT?.trim() || profile.hero.imageAlt,
    heroPrimaryCtaLabel: env.VITE_HERO_PRIMARY_CTA_LABEL?.trim() || profile.hero.primaryCtaLabel,
    heroSecondaryCtaLabel: env.VITE_HERO_SECONDARY_CTA_LABEL?.trim() || profile.hero.secondaryCtaLabel,
    metaTitle: env.VITE_META_TITLE?.trim() || env.VITE_SHOP_NAME?.trim() || profile.metadata.title,
    metaDescription: env.VITE_META_DESCRIPTION?.trim() || profile.metadata.description,
    socialImageUrl: env.VITE_SOCIAL_IMAGE_URL?.trim() || env.VITE_HERO_IMAGE_URL?.trim() || profile.metadata.socialImageUrl,
    manifestThemeColor: env.VITE_MANIFEST_THEME_COLOR?.trim() || profile.manifest.themeColor,
  };
}

// Compatibility export for surfaces not yet migrated to runtime branding. Its
// Barber defaults remain unchanged; Home and setup resolve the active profile.
export const shopBranding = resolveShopBranding(
  businessBrandingProfiles.barber,
  "classic-gold",
);

export function resolveLocationLogoUrl(logoUrl?: string | null, fallbackLogoUrl = shopBranding.logoUrl) {
  return logoUrl?.trim() || fallbackLogoUrl;
}

export function applyShopBrandingToDocument(branding: ResolvedShopBranding = shopBranding) {
  document.documentElement.dataset.brandTheme = branding.theme;
  document.title = branding.metaTitle;
  document.querySelector('meta[name="application-name"]')?.setAttribute("content", branding.name);
  document.querySelector('meta[name="description"]')?.setAttribute("content", branding.metaDescription);
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", branding.shortName);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", branding.manifestThemeColor);
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", branding.metaTitle);
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", branding.metaDescription);
  document.querySelector('meta[property="og:image"]')?.setAttribute("content", branding.socialImageUrl);
  document.querySelector('meta[property="og:site_name"]')?.setAttribute("content", branding.name);
  document.querySelector('meta[name="twitter:title"]')?.setAttribute("content", branding.metaTitle);
  document.querySelector('meta[name="twitter:description"]')?.setAttribute("content", branding.metaDescription);
  document.querySelector('meta[name="twitter:image"]')?.setAttribute("content", branding.socialImageUrl);
  document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute("href", branding.iconUrl);
  document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.setAttribute("href", branding.iconUrl);
}
