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

  assert.equal(barber.schemaVersion, 1);
  assert.deepEqual(barber.booking.flow, ["professional", "service", "datetime", "customer"]);
  assert.equal(barber.copy.booking.professional.heading, "Seleciona o barbeiro");
  assert.equal(barber.copy.admin.team.heading, "Equipa de Barbeiros");
  assert.equal(barber.copy.agenda.professional.allFilter, "Todos os barbeiros");
  assert.equal(barber.theme.id, "classic-gold");
  assert.equal(barber.features.workspaceRent, true);
  assert.equal(barber.features.multiLocation, false);

  assert.deepEqual(beauty.booking.flow, ["service", "professional", "datetime", "customer"]);
  assert.equal(beauty.copy.booking.professional.heading, "Selecione o profissional");
  assert.equal(beauty.copy.booking.professional.anyAvailable, "Qualquer profissional disponível");
  assert.equal(beauty.copy.admin.team.heading, "Equipa de Profissionais");
  assert.equal(beauty.copy.agenda.professional.allFilter, "Todos os profissionais");
  assert.equal(beauty.theme.id, "beauty-clean");
  assert.deepEqual(beauty.runtime.multiLocation, { enabled: true, maxLocations: 3 });
  assert.equal(beauty.features.multiLocation, true);

  for (const feature of [
    "clientProfile",
    "consentForms",
    "treatmentContraindications",
    "preparationBuffers",
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
