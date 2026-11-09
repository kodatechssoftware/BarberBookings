import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentIncludesProfessional,
  getAppointmentProfessionalIds,
} from "../../shared/appointment-participants";

test("legacy and multi-service appointments expose every professional exactly once", () => {
  const legacy = { barberId: 4 };
  assert.deepEqual(getAppointmentProfessionalIds(legacy), [4]);
  assert.equal(appointmentIncludesProfessional(legacy, 4), true);
  assert.equal(appointmentIncludesProfessional(legacy, 5), false);

  const sameProfessional = {
    barberId: 4,
    serviceSegments: [{ barberId: 4 }, { barberId: 4 }],
  };
  assert.deepEqual(getAppointmentProfessionalIds(sameProfessional), [4]);

  const multiProfessional = {
    barberId: 4,
    serviceSegments: [{ barberId: 4 }, { barberId: 6 }, { barberId: 5 }, { barberId: 6 }],
  };
  assert.deepEqual(getAppointmentProfessionalIds(multiProfessional), [4, 6, 5]);
  assert.equal(appointmentIncludesProfessional(multiProfessional, 4), true);
  assert.equal(appointmentIncludesProfessional(multiProfessional, 6), true);
  assert.equal(appointmentIncludesProfessional(multiProfessional, 5), true);
  assert.equal(appointmentIncludesProfessional(multiProfessional, 7), false);
});
