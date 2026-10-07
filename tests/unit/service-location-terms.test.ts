import assert from "node:assert/strict";
import test from "node:test";
import { resolveServiceLocationTerms } from "../../shared/service-location-terms";

const service = {
  id: 7,
  name: "Corte clássico",
  price: 1500,
  duration: 30,
};

test("service location terms inherit the global base when overrides are null", () => {
  assert.deepEqual(resolveServiceLocationTerms(1, service, {
    serviceId: 7,
    locationId: 1,
    isActive: true,
    priceOverride: null,
    durationOverride: null,
  }), {
    serviceId: 7,
    locationId: 1,
    name: "Corte clássico",
    isActive: true,
    priceCents: 1500,
    durationMinutes: 30,
    priceOverride: null,
    durationOverride: null,
    basePrice: 1500,
    baseDuration: 30,
  });
});

test("service location terms use the local price and duration overrides", () => {
  const terms = resolveServiceLocationTerms(2, service, {
    serviceId: 7,
    locationId: 2,
    isActive: true,
    priceOverride: 1800,
    durationOverride: 45,
  });

  assert.equal(terms?.priceCents, 1800);
  assert.equal(terms?.durationMinutes, 45);
  assert.equal(terms?.basePrice, 1500);
  assert.equal(terms?.baseDuration, 30);
});

test("service location terms reject a missing or mismatched association", () => {
  assert.equal(resolveServiceLocationTerms(1, service, undefined), null);
  assert.equal(resolveServiceLocationTerms(1, service, {
    serviceId: 7,
    locationId: 2,
    isActive: true,
    priceOverride: 1800,
    durationOverride: 45,
  }), null);
  assert.equal(resolveServiceLocationTerms(1, service, {
    serviceId: 8,
    locationId: 1,
    isActive: true,
    priceOverride: 1800,
    durationOverride: 45,
  }), null);
});
