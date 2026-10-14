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

const barberHeroImageUrl =
  "https://images.unsplash.com/photo-1585747860715-2ba37e788b70?q=80&w=2074&auto=format&fit=crop";

export const businessBrandingProfiles = {
  barber: {
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
    professionalFallbackMode: "legacy-barber-avatars",
    manifest: {
      name: "BarberBookings",
      shortName: "BarberBookings",
      description: "Marcações e painel móvel para barbearias.",
      backgroundColor: "#090909",
      themeColor: "#d4af37",
      icons: [
        {
          src: "/icons/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any maskable",
        },
        {
          src: "/icons/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable",
        },
      ],
    },
  },
  beauty: {
    defaultName: "Ana Isabel Nail Art & Design",
    defaultShortName: "Ana Isabel",
    defaultAddress: "Morada a definir",
    defaultLogoUrl: "/images/beauty-brand/ana-isabel-logo.svg",
    defaultHorizontalLogoUrl: "/images/beauty-brand/ana-isabel-logo-horizontal.svg",
    defaultIconUrl: "/images/beauty-brand/ana-isabel-icon.svg",
    defaultMapUrl: "",
    defaultMapEmbedUrl: "",
    hero: {
      title: "Unhas com detalhe, elegância e personalidade",
      description: "Cuidados personalizados, nail art e beleza com atenção a cada detalhe.",
      imageUrl: "/images/beauty-brand/ana-isabel-hero.svg",
      imageAlt: "Composição delicada de nail art em tons blush, marfim e dourado",
      primaryCtaLabel: "Marcar agora",
      secondaryCtaLabel: "Ver serviços",
    },
    home: {
      servicesTitle: "Nail art e cuidados personalizados",
      teamTitle: "Cuidado em cada detalhe",
      locationTitle: "Um espaço pensado para ti",
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
      teamDescription: "Profissionais dedicados a realçar a tua personalidade com técnica, delicadeza e atenção.",
    },
    professionalFallbackMode: "brand-logo",
    manifest: {
      name: "Ana Isabel Nail Art & Design",
      shortName: "Ana Isabel",
      description: "Nail art e cuidados de beleza com atenção a cada detalhe.",
      backgroundColor: "#fbf8f4",
      themeColor: "#d6a1ad",
      icons: [
        {
          src: "/images/beauty-brand/ana-isabel-icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any maskable",
        },
      ],
    },
  },
} as const satisfies Record<BusinessVertical, BusinessBrandingProfile>;
