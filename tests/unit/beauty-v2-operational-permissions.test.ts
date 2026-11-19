import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runtimeAccessPresetProfile } from "../../server/auth-preset-profile";

test("Beauty v2 selects the operational preset only behind its vertical kill switch", () => {
  assert.equal(runtimeAccessPresetProfile({
    BUSINESS_VERTICAL: "beauty",
    BEAUTY_V2_FEATURES_ENABLED: "true",
  }), "beauty-v2");
  assert.equal(runtimeAccessPresetProfile({
    BUSINESS_VERTICAL: "beauty",
    BEAUTY_V2_FEATURES_ENABLED: "false",
  }), "default");
  assert.equal(runtimeAccessPresetProfile({
    BUSINESS_VERTICAL: "barber",
    BEAUTY_V2_FEATURES_ENABLED: "true",
  }), "default");
});

test("own absences and consultation reads have distinct server-side guards", async () => {
  const routes = await readFile(new URL("../../server/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /ownCapability: "appointments\.block_time_own",\s*teamCapability: "appointments\.block_time"/);
  assert.equal((routes.match(/requiresBeautyV2AbsenceOwnership/g) ?? []).length, 5);
  assert.match(routes, /usesBeautyV2OperationalProfile && isBlockedTimeAppointment\(appointment\)/);
  assert.match(routes, /const requireAppointmentRequestsRead = requireAnyCapabilityAtLocation/);
  assert.match(routes, /consultation \? requests\.map\(toConsultationAppointmentRequest\) : requests/);
  assert.match(routes, /canManageAppointmentTerms[\s\S]*APPOINTMENT_TERMS_FORBIDDEN/);
});

test("consultation UI remains read-only for requests and team schedules", async () => {
  const [admin, requests, schedule] = await Promise.all([
    readFile(new URL("../../client/src/pages/Admin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/admin/AppointmentRequestsManager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/admin/BarberLocationScheduleDialog.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(admin, /readOnly=\{!canManageAppointmentRequests\}/);
  assert.match(requests, /!readOnly && \(detail\.status === "pending"/);
  assert.match(schedule, /fieldset disabled=\{save\.isPending \|\| readOnly\}/);
});
