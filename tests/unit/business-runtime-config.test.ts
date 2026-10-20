import assert from "node:assert/strict";
import test from "node:test";
import { resolveBusinessRuntimeConfig } from "../../server/business-runtime-config";
import { businessCapabilityRegistry } from "../../shared/business/features";
import { parseBusinessVertical } from "../../shared/business/vertical";

test("business vertical parser normalizes supported values and treats blank as absent", () => {
  assert.equal(parseBusinessVertical(" barber "), "barber");
  assert.equal(parseBusinessVertical("BEAUTY"), "beauty");
  assert.equal(parseBusinessVertical("  "), undefined);
  assert.equal(parseBusinessVertical(undefined), undefined);
  assert.throws(() => parseBusinessVertical("beauty2"), /BUSINESS_VERTICAL/);
});

test("Production requires an explicit vertical while Development/Test defaults with a warning", () => {
  assert.throws(
    () => resolveBusinessRuntimeConfig({}, { productionDeployment: true }),
    /BUSINESS_VERTICAL is required in Production/,
  );

  const development = resolveBusinessRuntimeConfig({}, { productionDeployment: false });
  assert.equal(development.config.vertical, "barber");
  assert.deepEqual(development.warnings, [
    "BUSINESS_VERTICAL is not configured; using barber for Development/Test.",
  ]);

  assert.throws(
    () => resolveBusinessRuntimeConfig(
      { BUSINESS_VERTICAL: "beauty2" },
      { productionDeployment: false },
    ),
    /BUSINESS_VERTICAL/,
  );
});

test("resolved Barber and Beauty profiles expose declarations without enabling future capabilities", () => {
  const barber = resolveBusinessRuntimeConfig(
    { BUSINESS_VERTICAL: "barber", MULTI_LOCATION_ENABLED: "false" },
    { productionDeployment: true },
  ).config;
  const beauty = resolveBusinessRuntimeConfig(
    { BUSINESS_VERTICAL: " BEAUTY ", MULTI_LOCATION_ENABLED: "true", MAX_LOCATIONS: "3" },
    { productionDeployment: true },
  ).config;

  assert.equal(barber.schemaVersion, 2);
  assert.deepEqual(barber.booking.flow, ["professional", "service", "datetime", "customer"]);
  assert.equal(barber.copy.booking.professional.heading, "Seleciona o barbeiro");
  assert.equal(barber.copy.admin.team.heading, "Equipa de Barbeiros");
  assert.equal(barber.copy.agenda.professional.allFilter, "Todos os barbeiros");
  assert.equal(barber.theme.id, "classic-gold");
  assert.equal(barber.branding.defaultName, "Baptista Barber Shop");
  assert.equal(barber.branding.hero.title, "Corte e barba com hora marcada");
  assert.equal(barber.branding.defaultLogoUrl, "/images/logo.jpg");
  assert.equal(barber.branding.defaultHorizontalLogoUrl, "/images/logo.jpg");
  assert.equal(barber.branding.defaultIconUrl, "/images/logo.jpg");
  assert.equal(barber.branding.professionalFallbackMode, "legacy-barber-avatars");
  assert.equal(barber.branding.manifest.name, "BarberBookings");
  assert.equal(barber.branding.metadata.description, "Marcações online de Baptista Barber Shop.");
  assert.deepEqual(
    barber.branding.manifest.icons.map(({ src }) => src),
    ["/icons/icon-192.png", "/icons/icon-512.png"],
  );
  assert.equal(barber.features.workspaceRent, true);
  assert.equal(barber.features.multiLocation, false);
  assert.equal(barber.features.preparationBuffers, false);
  assert.equal(barber.features.appointmentAvailabilityWindows, false);
  assert.equal(barber.features.recurringExpenses, false);

  assert.deepEqual(beauty.booking.flow, ["service", "professional", "datetime", "customer"]);
  assert.equal(beauty.copy.booking.professional.heading, "Selecione o profissional");
  assert.equal(beauty.copy.booking.professional.anyAvailable, "Qualquer profissional disponível");
  assert.equal(beauty.copy.admin.team.heading, "Equipa de Profissionais");
  assert.equal(beauty.copy.agenda.professional.allFilter, "Todos os profissionais");
  assert.equal(beauty.theme.id, "beauty-clean");
  assert.equal(beauty.branding.defaultName, "Beauty Studio");
  assert.equal(beauty.branding.defaultShortName, "Beauty");
  assert.equal(beauty.branding.defaultLogoUrl, "/images/beauty-logo.svg");
  assert.equal(beauty.branding.defaultHorizontalLogoUrl, "/images/beauty-logo.svg");
  assert.equal(beauty.branding.defaultIconUrl, "/images/beauty-logo.svg");
  assert.equal(beauty.branding.hero.title, "Beleza e cuidado à sua medida");
  assert.equal(beauty.branding.hero.description, "Serviços personalizados de beleza e bem-estar, com atenção a cada detalhe.");
  assert.equal(beauty.branding.hero.imageUrl, "/images/beauty-hero.svg");
  assert.equal(beauty.branding.professionalFallbackMode, "brand-logo");
  assert.equal(beauty.branding.manifest.name, "Beauty Studio");
  assert.equal(beauty.branding.manifest.icons[0]?.src, "/images/beauty-logo.svg");
  assert.doesNotMatch(JSON.stringify(beauty.branding), /Ana Isabel|Nail Art|Baptista|Powerhouse|barbeiro|barbearia|corte e barba/i);
  assert.deepEqual(beauty.runtime.multiLocation, { enabled: true, maxLocations: 3 });
  assert.equal(beauty.features.multiLocation, true);
  assert.equal(beauty.features.preparationBuffers, true);
  assert.equal(beauty.features.appointmentAvailabilityWindows, true);
  assert.equal(beauty.features.recurringExpenses, true);
  assert.equal(businessCapabilityRegistry.preparationBuffers.implemented, true);
  assert.equal(businessCapabilityRegistry.appointmentAvailabilityWindows.implemented, true);
  assert.equal(businessCapabilityRegistry.recurringExpenses.implemented, true);

  for (const feature of [
    "clientProfile",
    "consentForms",
    "treatmentContraindications",
    "resources",
    "deposits",
    "treatmentPhotos",
    "packages",
    "giftCardLedger",
  ] as const) {
    assert.equal(businessCapabilityRegistry[feature].implemented, false);
    assert.equal(beauty.features[feature], false);
  }
});

test("Ana Isabel is an explicit Beauty deployment profile rather than a vertical default", () => {
  const genericBeauty = resolveBusinessRuntimeConfig(
    { BUSINESS_VERTICAL: "beauty" },
    { productionDeployment: true },
  ).config;
  const anaIsabel = resolveBusinessRuntimeConfig(
    { BUSINESS_VERTICAL: "beauty", BUSINESS_BRANDING_PROFILE: "ana-isabel" },
    { productionDeployment: true },
  ).config;

  assert.doesNotMatch(JSON.stringify(genericBeauty.branding), /Ana Isabel|Nail Art/i);
  assert.equal(anaIsabel.branding.defaultName, "Ana Isabel Nail Art & Design");
  assert.equal(anaIsabel.branding.defaultShortName, "Ana Isabel");
  assert.equal(anaIsabel.branding.hero.title, "Unhas com detalhe, elegância e personalidade");
  assert.equal(anaIsabel.branding.hero.description, "Cuidados personalizados, nail art e beleza com atenção a cada detalhe.");
  assert.equal(anaIsabel.branding.defaultLogoUrl, "/images/beauty-brand/ana-isabel-logo.svg");
  assert.equal(anaIsabel.branding.defaultHorizontalLogoUrl, "/images/beauty-brand/ana-isabel-logo-horizontal.svg");
  assert.equal(anaIsabel.branding.defaultIconUrl, "/images/beauty-brand/ana-isabel-icon.svg");
  assert.equal(anaIsabel.branding.manifest.name, "Ana Isabel Nail Art & Design");
  assert.equal(anaIsabel.branding.manifest.icons[0]?.src, "/images/beauty-brand/ana-isabel-icon.svg");
  assert.equal(anaIsabel.branding.metadata.description, "Nail art e cuidados de beleza com atenção a cada detalhe.");
});

test("deployment branding overrides keep runtime config, metadata and manifest aligned", () => {
  const custom = resolveBusinessRuntimeConfig({
    BUSINESS_VERTICAL: "beauty",
    VITE_SHOP_NAME: "Estúdio Aurora",
    VITE_SHOP_SHORT_NAME: "Aurora",
    VITE_SHOP_ICON_URL: "/images/aurora.svg",
    VITE_HERO_TITLE: "Cuidado pensado para si",
    VITE_HERO_DESCRIPTION: "Serviços de beleza personalizados.",
    VITE_HERO_IMAGE_URL: "/images/aurora-hero.webp",
    VITE_HOME_SERVICES_TITLE: "Os nossos serviços",
    VITE_META_DESCRIPTION: "Estúdio Aurora — beleza e bem-estar.",
    VITE_MANIFEST_SHORT_NAME: "Aurora App",
  }, { productionDeployment: true }).config;

  assert.equal(custom.branding.defaultName, "Estúdio Aurora");
  assert.equal(custom.branding.hero.title, "Cuidado pensado para si");
  assert.equal(custom.branding.home.servicesTitle, "Os nossos serviços");
  assert.equal(custom.branding.metadata.title, "Estúdio Aurora");
  assert.equal(custom.branding.metadata.description, "Estúdio Aurora — beleza e bem-estar.");
  assert.equal(custom.branding.metadata.socialImageUrl, "/images/aurora-hero.webp");
  assert.equal(custom.branding.manifest.name, "Estúdio Aurora");
  assert.equal(custom.branding.manifest.shortName, "Aurora App");
  assert.equal(custom.branding.manifest.description, "Estúdio Aurora — beleza e bem-estar.");
  assert.deepEqual(custom.branding.manifest.icons, [{
    src: "/images/aurora.svg",
    sizes: "any",
    type: "image/svg+xml",
    purpose: "any maskable",
  }]);

  assert.throws(
    () => resolveBusinessRuntimeConfig(
      { BUSINESS_VERTICAL: "beauty", BUSINESS_BRANDING_PROFILE: "unknown" },
      { productionDeployment: true },
    ),
    /BUSINESS_BRANDING_PROFILE/,
  );
  assert.throws(
    () => resolveBusinessRuntimeConfig(
      { BUSINESS_VERTICAL: "barber", BUSINESS_BRANDING_PROFILE: "ana-isabel" },
      { productionDeployment: true },
    ),
    /not compatible/,
  );
});

test("unsupported or unknown feature activation fails fast", () => {
  assert.throws(
    () => resolveBusinessRuntimeConfig({
      BUSINESS_VERTICAL: "beauty",
      BUSINESS_FEATURE_CLIENT_PROFILE_ENABLED: "true",
    }, { productionDeployment: false }),
    /not implemented/,
  );
  assert.throws(
    () => resolveBusinessRuntimeConfig({
      BUSINESS_VERTICAL: "barber",
      BUSINESS_FEATURE_UNKNOWN_ENABLED: "true",
    }, { productionDeployment: false }),
    /Unknown business feature flag/,
  );

  const explicitlyDisabled = resolveBusinessRuntimeConfig({
    BUSINESS_VERTICAL: "beauty",
    BUSINESS_FEATURE_CLIENT_PROFILE_ENABLED: "false",
  }, { productionDeployment: false });
  assert.equal(explicitlyDisabled.config.features.clientProfile, false);
});

test("public runtime DTO contains no environment secrets or private configuration", () => {
  const secretValues = [
    "postgresql://private.example/database",
    "private-session-secret",
    "private-meta-token",
    "private-resend-key",
  ];
  const config = resolveBusinessRuntimeConfig({
    BUSINESS_VERTICAL: "barber",
    DATABASE_URL: secretValues[0],
    SESSION_SECRET: secretValues[1],
    META_WHATSAPP_ACCESS_TOKEN: secretValues[2],
    RESEND_API_KEY: secretValues[3],
  }, { productionDeployment: true }).config;
  const serialized = JSON.stringify(config);

  for (const forbidden of [
    ...secretValues,
    "DATABASE_URL",
    "SESSION_SECRET",
    "META_WHATSAPP_ACCESS_TOKEN",
    "RESEND_API_KEY",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
