const env = import.meta.env;

declare const __DEMO_MODE__: boolean;

const requestedTheme = env.VITE_BRAND_THEME?.trim() || "classic-gold";
const isPowerhouseDemo = __DEMO_MODE__;
const resolvedTheme = isPowerhouseDemo
  ? "barber-pole"
  : requestedTheme === "barber-pole"
    ? "classic-gold"
    : requestedTheme;
const powerhouseAddress = "Rua Adelino de Oliveira 85, 4470-025 Maia";
const defaultHeroImageUrl =
  "https://images.unsplash.com/photo-1585747860715-2ba37e788b70?q=80&w=2074&auto=format&fit=crop";

export const shopBranding = {
  theme: resolvedTheme,
  name: isPowerhouseDemo ? "Powerhouse barbershop" : env.VITE_SHOP_NAME?.trim() || "Baptista Barber Shop",
  shortName: isPowerhouseDemo ? "Powerhouse" : env.VITE_SHOP_SHORT_NAME?.trim() || "Baptista",
  address: isPowerhouseDemo ? powerhouseAddress : env.VITE_SHOP_ADDRESS?.trim() || "Rua Comandante Agatão Lança Nº28",
  logoUrl: isPowerhouseDemo ? "/images/demo-logo.svg" : env.VITE_SHOP_LOGO_URL?.trim() || "/images/logo.jpg",
  mapUrl: isPowerhouseDemo
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(powerhouseAddress)}`
    : env.VITE_SHOP_MAP_URL?.trim() || "https://www.google.com/maps/search/?api=1&query=Rua%20Comandante%20Agat%C3%A3o%20Lan%C3%A7a%20N%C2%BA28",
  mapEmbedUrl: isPowerhouseDemo ? "" : env.VITE_SHOP_MAP_EMBED_URL?.trim() || "",
  showMap: env.VITE_HIDE_SHOP_MAP !== "true",
  useLegacyBarberAvatars: isPowerhouseDemo ? false : env.VITE_USE_LEGACY_BARBER_AVATARS !== "false",
  instagramUrl: env.VITE_INSTAGRAM_URL?.trim() || "",
  heroTitle: isPowerhouseDemo ? "Estilo, precisão e atitude" : "Corte e barba com hora marcada",
  heroDescription: isPowerhouseDemo
    ? "Barbearia masculina na Maia, com cortes, barba e tratamentos feitos ao detalhe."
    : "Cortes, barba e acabamentos cuidados, com atenção ao detalhe.",
  heroImageUrl: isPowerhouseDemo ? "/images/powerhouse-hero.jpg" : defaultHeroImageUrl,
};

export function applyShopBrandingToDocument() {
  document.documentElement.dataset.brandTheme = shopBranding.theme;
  document.title = shopBranding.name;
  document.querySelector('meta[name="application-name"]')?.setAttribute("content", shopBranding.name);
  document.querySelector('meta[name="description"]')?.setAttribute("content", `Marcações online da ${shopBranding.name}.`);
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", shopBranding.shortName);
  document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute("href", shopBranding.logoUrl);
}
