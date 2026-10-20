import type { BusinessVertical } from "./vertical";

export type BusinessBrandingProfile = {
  defaultName: string;
  defaultShortName: string;
  defaultAddress: string;
  defaultLogoUrl: string;
  defaultHorizontalLogoUrl: string;
  defaultIconUrl: string;
  defaultMapUrl: string;
  defaultMapEmbedUrl: string;
  hero: {
    title: string;
    description: string;
    imageUrl: string;
    imageAlt: string;
    primaryCtaLabel: string;
    secondaryCtaLabel: string;
  };
  home: {
    servicesTitle: string;
    teamTitle: string;
    locationTitle: string;
    openingUnavailableTitle: string;
    appointmentOnlyDetail: string;
    closedTodayTitle: string;
    closedTodayDetail: string;
    openUntilPrefix: string;
    openDetail: string;
    reopensPrefix: string;
    opensPrefix: string;
    closedNowTitle: string;
    closedNowDetail: string;
    teamDescription: string;
  };
  metadata: {
    title: string;
    description: string;
    socialImageUrl: string;
  };
  professionalFallbackMode: "legacy-barber-avatars" | "brand-logo";
  manifest: {
    name: string;
    shortName: string;
    description: string;
    backgroundColor: string;
    themeColor: string;
    icons: ReadonlyArray<{
      src: string;
      sizes: string;
      type: string;
      purpose: string;
    }>;
  };
};

export type BusinessBrandingProfileId = "ana-isabel";

type DeploymentBusinessBrandingProfile = {
  vertical: BusinessVertical;
  branding: BusinessBrandingProfile;
};

const barberHeroImageUrl =
  "https://images.unsplash.com/photo-1585747860715-2ba37e788b70?q=80&w=2074&auto=format&fit=crop";

const barberBranding: BusinessBrandingProfile = {
  defaultName: "Baptista Barber Shop",
  defaultShortName: "Baptista",
  defaultAddress: "Rua Comandante Agatão Lança Nº28",
  defaultLogoUrl: "/images/logo.jpg",
  defaultHorizontalLogoUrl: "/images/logo.jpg",
  defaultIconUrl: "/images/logo.jpg",
  defaultMapUrl: "https://www.google.com/maps/search/?api=1&query=Rua%20Comandante%20Agat%C3%A3o%20Lan%C3%A7a%20N%C2%BA28",
  defaultMapEmbedUrl: "",
  hero: {
    title: "Corte e barba com hora marcada",
    description: "Cortes, barba e acabamentos cuidados, com atenção ao detalhe.",
    imageUrl: barberHeroImageUrl,
    imageAlt: "Interior de barbearia",
    primaryCtaLabel: "Marcar agora",
    secondaryCtaLabel: "Ver serviços",
  },
  home: {
    servicesTitle: "Serviços e preços",
    teamTitle: "Conhece a equipa",
    locationTitle: "Estamos à tua espera",
    openingUnavailableTitle: "Consulte os horários",
    appointmentOnlyDetail: "Atendimento por hora marcada.",
    closedTodayTitle: "Fechado hoje",
    closedTodayDetail: "Atendimento por hora marcada nos restantes dias.",
    openUntilPrefix: "Aberto hoje até às",
    openDetail: "Atendimento em curso na barbearia.",
    reopensPrefix: "Reabre hoje às",
    opensPrefix: "Abre hoje às",
    closedNowTitle: "Fechado agora",
    closedNowDetail: "Atendimento por hora marcada no próximo horário.",
    teamDescription: "Diferentes estilos, o mesmo cuidado nos detalhes e no acabamento final.",
  },
  metadata: {
    title: "Baptista Barber Shop",
    description: "Marcações online de Baptista Barber Shop.",
    socialImageUrl: barberHeroImageUrl,
  },
  professionalFallbackMode: "legacy-barber-avatars",
  manifest: {
    name: "BarberBookings",
    shortName: "BarberBookings",
    description: "Marcações e painel móvel para barbearias.",
    backgroundColor: "#090909",
    themeColor: "#d4af37",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  },
};

const genericBeautyBranding: BusinessBrandingProfile = {
  defaultName: "Beauty Studio",
  defaultShortName: "Beauty",
  defaultAddress: "Morada a definir",
  defaultLogoUrl: "/images/beauty-logo.svg",
  defaultHorizontalLogoUrl: "/images/beauty-logo.svg",
  defaultIconUrl: "/images/beauty-logo.svg",
  defaultMapUrl: "",
  defaultMapEmbedUrl: "",
  hero: {
    title: "Beleza e cuidado à sua medida",
    description: "Serviços personalizados de beleza e bem-estar, com atenção a cada detalhe.",
    imageUrl: "/images/beauty-hero.svg",
    imageAlt: "Ambiente de beleza e bem-estar em tons suaves",
    primaryCtaLabel: "Marcar agora",
    secondaryCtaLabel: "Ver serviços",
  },
  home: {
    servicesTitle: "Serviços e cuidados",
    teamTitle: "Conheça a equipa",
    locationTitle: "Um espaço pensado para si",
    openingUnavailableTitle: "Consulte os horários",
    appointmentOnlyDetail: "Atendimento por marcação.",
    closedTodayTitle: "Fechado hoje",
    closedTodayDetail: "Atendimento por marcação nos restantes dias.",
    openUntilPrefix: "Aberto hoje até às",
    openDetail: "Atendimento em curso no estabelecimento.",
    reopensPrefix: "Reabre hoje às",
    opensPrefix: "Abre hoje às",
    closedNowTitle: "Fechado agora",
    closedNowDetail: "Atendimento por marcação no próximo horário.",
    teamDescription: "Profissionais dedicados ao seu bem-estar, com cuidado, técnica e atenção personalizada.",
  },
  metadata: {
    title: "Beauty Studio",
    description: "Serviços personalizados de beleza e bem-estar com marcação online.",
    socialImageUrl: "/images/beauty-hero.svg",
  },
  professionalFallbackMode: "brand-logo",
  manifest: {
    name: "Beauty Studio",
    shortName: "Beauty",
    description: "Marcações e gestão para serviços de beleza e bem-estar.",
    backgroundColor: "#fbf8f4",
    themeColor: "#d6a1ad",
    icons: [
      { src: "/images/beauty-logo.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
    ],
  },
};

const anaIsabelBranding: BusinessBrandingProfile = {
  ...genericBeautyBranding,
  defaultName: "Ana Isabel Nail Art & Design",
  defaultShortName: "Ana Isabel",
  defaultLogoUrl: "/images/beauty-brand/ana-isabel-logo.svg",
  defaultHorizontalLogoUrl: "/images/beauty-brand/ana-isabel-logo-horizontal.svg",
  defaultIconUrl: "/images/beauty-brand/ana-isabel-icon.svg",
  hero: {
    title: "Unhas com detalhe, elegância e personalidade",
    description: "Cuidados personalizados, nail art e beleza com atenção a cada detalhe.",
    imageUrl: "/images/beauty-brand/ana-isabel-hero.svg",
    imageAlt: "Composição delicada de nail art em tons blush, marfim e dourado",
    primaryCtaLabel: "Marcar agora",
    secondaryCtaLabel: "Ver serviços",
  },
  home: {
    ...genericBeautyBranding.home,
    servicesTitle: "Nail art e cuidados personalizados",
    teamTitle: "Cuidado em cada detalhe",
    locationTitle: "Um espaço pensado para ti",
    teamDescription: "Profissionais dedicados a realçar a tua personalidade com técnica, delicadeza e atenção.",
  },
  metadata: {
    title: "Ana Isabel Nail Art & Design",
    description: "Nail art e cuidados de beleza com atenção a cada detalhe.",
    socialImageUrl: "/images/beauty-brand/ana-isabel-hero.svg",
  },
  manifest: {
    name: "Ana Isabel Nail Art & Design",
    shortName: "Ana Isabel",
    description: "Nail art e cuidados de beleza com atenção a cada detalhe.",
    backgroundColor: "#fbf8f4",
    themeColor: "#d6a1ad",
    icons: [
      { src: "/images/beauty-brand/ana-isabel-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
    ],
  },
};

export const businessBrandingProfiles = {
  barber: barberBranding,
  beauty: genericBeautyBranding,
} as const satisfies Record<BusinessVertical, BusinessBrandingProfile>;

export const deploymentBusinessBrandingProfiles = {
  "ana-isabel": { vertical: "beauty", branding: anaIsabelBranding },
} as const satisfies Record<BusinessBrandingProfileId, DeploymentBusinessBrandingProfile>;

function optionalEnvironmentValue(environment: Record<string, string | undefined>, name: string) {
  return environment[name]?.trim() || undefined;
}

function resolveManifestIcons(iconUrl: string, original: BusinessBrandingProfile["manifest"]["icons"]) {
  if (iconUrl === original[0]?.src) return original;
  const isSvg = /\.svg(?:\?|$)/i.test(iconUrl);
  return [{
    src: iconUrl,
    sizes: isSvg ? "any" : "192x192",
    type: isSvg ? "image/svg+xml" : "image/png",
    purpose: "any maskable",
  }];
}

export function resolveBusinessBrandingProfile(
  vertical: BusinessVertical,
  environment: Record<string, string | undefined>,
): BusinessBrandingProfile {
  const requestedProfile = optionalEnvironmentValue(environment, "BUSINESS_BRANDING_PROFILE")?.toLowerCase();
  let base = businessBrandingProfiles[vertical];

  if (requestedProfile) {
    const deployment = deploymentBusinessBrandingProfiles[
      requestedProfile as BusinessBrandingProfileId
    ] as DeploymentBusinessBrandingProfile | undefined;
    if (!deployment) {
      throw new Error(`BUSINESS_BRANDING_PROFILE must be one of: ${Object.keys(deploymentBusinessBrandingProfiles).join(", ")}.`);
    }
    if (deployment.vertical !== vertical) {
      throw new Error(`BUSINESS_BRANDING_PROFILE=${requestedProfile} is not compatible with BUSINESS_VERTICAL=${vertical}.`);
    }
    base = deployment.branding;
  }

  const name = optionalEnvironmentValue(environment, "VITE_SHOP_NAME") ?? base.defaultName;
  const shortName = optionalEnvironmentValue(environment, "VITE_SHOP_SHORT_NAME") ?? base.defaultShortName;
  const hasExplicitName = Boolean(optionalEnvironmentValue(environment, "VITE_SHOP_NAME"));
  const hasExplicitShortName = Boolean(optionalEnvironmentValue(environment, "VITE_SHOP_SHORT_NAME"));
  const logoUrl = optionalEnvironmentValue(environment, "VITE_SHOP_LOGO_URL") ?? base.defaultLogoUrl;
  const horizontalLogoUrl = optionalEnvironmentValue(environment, "VITE_SHOP_HORIZONTAL_LOGO_URL") ?? base.defaultHorizontalLogoUrl;
  const explicitIconUrl = optionalEnvironmentValue(environment, "VITE_SHOP_ICON_URL");
  const iconUrl = explicitIconUrl ?? base.defaultIconUrl;
  const heroImageUrl = optionalEnvironmentValue(environment, "VITE_HERO_IMAGE_URL") ?? base.hero.imageUrl;
  const metadataDescription = optionalEnvironmentValue(environment, "VITE_META_DESCRIPTION") ?? base.metadata.description;

  return {
    ...base,
    defaultName: name,
    defaultShortName: shortName,
    defaultAddress: optionalEnvironmentValue(environment, "VITE_SHOP_ADDRESS") ?? base.defaultAddress,
    defaultLogoUrl: logoUrl,
    defaultHorizontalLogoUrl: horizontalLogoUrl,
    defaultIconUrl: iconUrl,
    defaultMapUrl: optionalEnvironmentValue(environment, "VITE_SHOP_MAP_URL") ?? base.defaultMapUrl,
    defaultMapEmbedUrl: optionalEnvironmentValue(environment, "VITE_SHOP_MAP_EMBED_URL") ?? base.defaultMapEmbedUrl,
    hero: {
      title: optionalEnvironmentValue(environment, "VITE_HERO_TITLE") ?? base.hero.title,
      description: optionalEnvironmentValue(environment, "VITE_HERO_DESCRIPTION") ?? base.hero.description,
      imageUrl: heroImageUrl,
      imageAlt: optionalEnvironmentValue(environment, "VITE_HERO_IMAGE_ALT") ?? base.hero.imageAlt,
      primaryCtaLabel: optionalEnvironmentValue(environment, "VITE_HERO_PRIMARY_CTA_LABEL") ?? base.hero.primaryCtaLabel,
      secondaryCtaLabel: optionalEnvironmentValue(environment, "VITE_HERO_SECONDARY_CTA_LABEL") ?? base.hero.secondaryCtaLabel,
    },
    home: {
      ...base.home,
      servicesTitle: optionalEnvironmentValue(environment, "VITE_HOME_SERVICES_TITLE") ?? base.home.servicesTitle,
      teamTitle: optionalEnvironmentValue(environment, "VITE_HOME_TEAM_TITLE") ?? base.home.teamTitle,
      locationTitle: optionalEnvironmentValue(environment, "VITE_HOME_LOCATION_TITLE") ?? base.home.locationTitle,
      teamDescription: optionalEnvironmentValue(environment, "VITE_HOME_TEAM_DESCRIPTION") ?? base.home.teamDescription,
    },
    metadata: {
      title: optionalEnvironmentValue(environment, "VITE_META_TITLE") ?? name,
      description: metadataDescription,
      socialImageUrl: optionalEnvironmentValue(environment, "VITE_SOCIAL_IMAGE_URL") ?? heroImageUrl,
    },
    manifest: {
      ...base.manifest,
      name: optionalEnvironmentValue(environment, "VITE_MANIFEST_NAME") ?? (hasExplicitName ? name : base.manifest.name),
      shortName: optionalEnvironmentValue(environment, "VITE_MANIFEST_SHORT_NAME") ?? (hasExplicitShortName ? shortName : base.manifest.shortName),
      description: optionalEnvironmentValue(environment, "VITE_MANIFEST_DESCRIPTION") ?? metadataDescription,
      backgroundColor: optionalEnvironmentValue(environment, "VITE_MANIFEST_BACKGROUND_COLOR") ?? base.manifest.backgroundColor,
      themeColor: optionalEnvironmentValue(environment, "VITE_MANIFEST_THEME_COLOR") ?? base.manifest.themeColor,
      icons: explicitIconUrl ? resolveManifestIcons(explicitIconUrl, base.manifest.icons) : base.manifest.icons,
    },
  };
}
