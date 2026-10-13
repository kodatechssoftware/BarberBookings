import type { BusinessVertical } from "./vertical";

export type BusinessBrandingProfile = {
  defaultName: string;
  defaultShortName: string;
  defaultAddress: string;
  defaultLogoUrl: string;
  defaultMapUrl: string;
  defaultMapEmbedUrl: string;
  hero: {
    title: string;
    description: string;
    imageUrl: string;
    imageAlt: string;
  };
  home: {
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
    defaultMapUrl: "https://www.google.com/maps/search/?api=1&query=Rua%20Comandante%20Agat%C3%A3o%20Lan%C3%A7a%20N%C2%BA28",
    defaultMapEmbedUrl: "",
    hero: {
      title: "Corte e barba com hora marcada",
      description: "Cortes, barba e acabamentos cuidados, com atenção ao detalhe.",
      imageUrl: barberHeroImageUrl,
      imageAlt: "Interior de barbearia",
    },
    home: {
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
    defaultName: "Beauty Salon",
    defaultShortName: "Beauty",
    defaultAddress: "Morada a definir",
    defaultLogoUrl: "/images/beauty-logo.svg",
    defaultMapUrl: "",
    defaultMapEmbedUrl: "",
    hero: {
      title: "Beleza e cuidado com hora marcada",
      description: "Serviços personalizados num ambiente tranquilo, cuidado e profissional.",
      imageUrl: "/images/beauty-hero.svg",
      imageAlt: "Ambiente sereno de cuidados de beleza",
    },
    home: {
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
      teamDescription: "Profissionais dedicados a um atendimento personalizado, confortável e cuidado.",
    },
    professionalFallbackMode: "brand-logo",
    manifest: {
      name: "Beauty Salon",
      shortName: "Beauty",
      description: "Marcações e gestão para profissionais de beleza.",
      backgroundColor: "#20151c",
      themeColor: "#2f2029",
      icons: [
        {
          src: "/images/beauty-logo.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any maskable",
        },
      ],
    },
  },
} as const satisfies Record<BusinessVertical, BusinessBrandingProfile>;
