interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_ADMIN_URL?: string;
  readonly VITE_BRAND_THEME?: string;
  readonly VITE_SHOP_NAME?: string;
  readonly VITE_SHOP_SHORT_NAME?: string;
  readonly VITE_SHOP_ADDRESS?: string;
  readonly VITE_SHOP_LOGO_URL?: string;
  readonly VITE_SHOP_HORIZONTAL_LOGO_URL?: string;
  readonly VITE_SHOP_ICON_URL?: string;
  readonly VITE_SHOP_MAP_URL?: string;
  readonly VITE_SHOP_MAP_EMBED_URL?: string;
  readonly VITE_HIDE_SHOP_MAP?: string;
  readonly VITE_USE_LEGACY_BARBER_AVATARS?: string;
  readonly VITE_INSTAGRAM_URL?: string;
  readonly VITE_HERO_TITLE?: string;
  readonly VITE_HERO_DESCRIPTION?: string;
  readonly VITE_HERO_IMAGE_URL?: string;
  readonly VITE_HERO_IMAGE_ALT?: string;
  readonly VITE_HERO_PRIMARY_CTA_LABEL?: string;
  readonly VITE_HERO_SECONDARY_CTA_LABEL?: string;
  readonly VITE_HOME_SERVICES_TITLE?: string;
  readonly VITE_HOME_TEAM_TITLE?: string;
  readonly VITE_HOME_LOCATION_TITLE?: string;
  readonly VITE_HOME_TEAM_DESCRIPTION?: string;
  readonly VITE_META_TITLE?: string;
  readonly VITE_META_DESCRIPTION?: string;
  readonly VITE_SOCIAL_IMAGE_URL?: string;
  readonly VITE_MANIFEST_NAME?: string;
  readonly VITE_MANIFEST_SHORT_NAME?: string;
  readonly VITE_MANIFEST_DESCRIPTION?: string;
  readonly VITE_MANIFEST_BACKGROUND_COLOR?: string;
  readonly VITE_MANIFEST_THEME_COLOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
