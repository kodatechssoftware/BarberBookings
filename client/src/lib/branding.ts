const env = import.meta.env;

export const shopBranding = {
  name: env.VITE_SHOP_NAME?.trim() || "Baptista Barber Shop",
  shortName: env.VITE_SHOP_SHORT_NAME?.trim() || "Baptista",
  address: env.VITE_SHOP_ADDRESS?.trim() || "Rua Comandante Agatão Lança Nº28",
  logoUrl: env.VITE_SHOP_LOGO_URL?.trim() || "/images/logo.jpg",
  mapUrl: env.VITE_SHOP_MAP_URL?.trim() || "https://www.google.com/maps/search/?api=1&query=Rua%20Comandante%20Agat%C3%A3o%20Lan%C3%A7a%20N%C2%BA28",
  mapEmbedUrl: env.VITE_SHOP_MAP_EMBED_URL?.trim() || "",
  showMap: env.VITE_HIDE_SHOP_MAP !== "true",
  useLegacyBarberAvatars: env.VITE_USE_LEGACY_BARBER_AVATARS !== "false",
  instagramUrl: env.VITE_INSTAGRAM_URL?.trim() || "",
};

export function applyShopBrandingToDocument() {
  document.title = shopBranding.name;
  document.querySelector('meta[name="application-name"]')?.setAttribute("content", shopBranding.name);
  document.querySelector('meta[name="description"]')?.setAttribute("content", `Marcações online da ${shopBranding.name}.`);
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", shopBranding.shortName);
  document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute("href", shopBranding.logoUrl);
}
