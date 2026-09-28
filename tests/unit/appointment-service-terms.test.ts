import assert from "node:assert/strict";
import test from "node:test";

import {
  getAppointmentPriceCents,
  getAppointmentServiceName,
  getEffectiveAppointmentDurationMinutes,
} from "../../shared/appointment-service-terms";

const serviceNames = new Map([[1, "Nome atual"]]);
const servicePrices = new Map([[1, 1_500]]);
const serviceDurations = new Map([[1, 45]]);

test("appointment snapshots take precedence over current catalogue terms", () => {
  const appointment = {
    serviceId: 1,
    serviceNameSnapshot: "Nome acordado",
    servicePriceCentsSnapshot: 2_500,
    durationMinutes: 30,
  };

  assert.equal(getAppointmentServiceName(appointment, serviceNames), "Nome acordado");
  assert.equal(getAppointmentPriceCents(appointment, servicePrices), 2_500);
  assert.equal(getEffectiveAppointmentDurationMinutes(appointment, serviceDurations), 30);
});

test("zero-price snapshots are preserved", () => {
  assert.equal(getAppointmentPriceCents({
    serviceId: 1,
    serviceNameSnapshot: "Oferta especial",
    servicePriceCentsSnapshot: 0,
  }, servicePrices), 0);
});

test("legacy appointments retain catalogue fallbacks and duration compatibility", () => {
  const legacy = {
    serviceId: 1,
    serviceNameSnapshot: null,
    servicePriceCentsSnapshot: null,
    durationMinutes: 30,
  };

  assert.equal(getAppointmentServiceName(legacy, serviceNames), "Nome atual");
  assert.equal(getAppointmentPriceCents(legacy, servicePrices), 1_500);
  assert.equal(getEffectiveAppointmentDurationMinutes(legacy, serviceDurations), 45);
});

test("custom appointments resolve without a catalogue service", () => {
  const custom = {
    serviceId: null,
    serviceNameSnapshot: "Lavar e pentear – casamento",
    servicePriceCentsSnapshot: 3_000,
    durationMinutes: 45,
  };

  assert.equal(getAppointmentServiceName(custom, serviceNames), "Lavar e pentear – casamento");
  assert.equal(getAppointmentPriceCents(custom, servicePrices), 3_000);
  assert.equal(getEffectiveAppointmentDurationMinutes(custom, serviceDurations), 45);
});
