import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  appointmentRequestAvailabilitySchema,
  appointmentRequestProposalAvailabilitySchema,
  appointmentRequestProposalResponseSchema,
  createAppointmentRequestSchema,
} from "../../shared/appointment-requests";

test("appointment request contracts normalize international phones and reject malformed payloads", () => {
  const parsed = createAppointmentRequestSchema.parse({
    startTime: "2035-06-01T10:00:00.000Z",
    customerName: "Cliente",
    customerPhone: "+34 612 34 56 78",
    idempotencyKey: "request-contract-1",
    services: [{ serviceId: 1, barberId: 2 }],
  });
  assert.equal(parsed.customerPhone, "+34612345678");
  assert.equal(parsed.whatsappOptIn, false);
  assert.equal(parsed.executionMode, "sequential");
  assert.equal(appointmentRequestAvailabilitySchema.parse({
    date: "2035-06-01",
    services: [{ serviceId: 1, barberId: 2 }],
  }).executionMode, "sequential");
  assert.deepEqual(appointmentRequestProposalAvailabilitySchema.parse({
    date: "2035-06-01",
  }), { date: "2035-06-01" });
  assert.throws(() => appointmentRequestProposalAvailabilitySchema.parse({
    date: "01-06-2035",
    services: [{ serviceId: 1, barberId: 2 }],
  }));
  assert.equal(createAppointmentRequestSchema.parse({
    ...parsed,
    executionMode: "parallel",
  }).executionMode, "parallel");
  assert.throws(() => appointmentRequestAvailabilitySchema.parse({
    date: "2035-06-01",
    executionMode: "automatic",
    services: [{ serviceId: 1, barberId: 2 }],
  }));
  assert.throws(() => createAppointmentRequestSchema.parse({
    ...parsed,
    services: [],
  }));
  assert.throws(() => appointmentRequestProposalResponseSchema.parse({
    token: "short",
    decision: "accept",
  }));
});

test("every Admin appointment-request mutation is protected by the team management capability", async () => {
  const source = await readFile(new URL("../../server/routes.ts", import.meta.url), "utf8");
  for (const route of [
    "/api/admin/appointment-requests\", requireTeamAppointmentsManage",
    "/api/admin/appointment-requests/:id\", requireTeamAppointmentsManage",
    "/api/admin/appointment-requests/:id/approve\", requireTeamAppointmentsManage",
    "/api/admin/appointment-requests/:id/refuse\", requireTeamAppointmentsManage",
    "/api/admin/appointment-requests/:id/proposal-availability\", requireTeamAppointmentsManage",
    "/api/admin/appointment-requests/:id/propose\", requireTeamAppointmentsManage",
  ]) {
    assert.ok(source.includes(route), `missing protected route fragment: ${route}`);
  }
});

test("administrative request notifications are authenticated and capability scoped", async () => {
  const source = await readFile(new URL("../../server/routes.ts", import.meta.url), "utf8");
  for (const route of [
    'app.get("/api/admin/request-notifications", requireTeamAppointmentsManage',
    'app.post("/api/admin/request-notifications/read-all", requireTeamAppointmentsManage',
    'app.post("/api/admin/request-notifications/:id/read", requireTeamAppointmentsManage',
    'app.get("/api/admin/request-notification-settings", requireSettingsManage',
    'app.put("/api/admin/request-notification-settings", requireSettingsManage',
  ]) {
    assert.ok(source.includes(route), `missing protected notification route fragment: ${route}`);
  }
});

test("parallel compatibility configuration is location-scoped and capability protected", async () => {
  const source = await readFile(new URL("../../server/routes.ts", import.meta.url), "utf8");
  assert.ok(source.includes(
    'app.get("/api/admin/parallel-service-compatibilities", requireCatalogView',
  ));
  assert.ok(source.includes(
    'app.put("/api/admin/parallel-service-compatibilities", requireCatalogLocationManage',
  ));
  assert.match(source, /parallel_service_compatibilities[\s\S]*?WHERE location_id = \$1/);
  assert.match(source, /service_locations[\s\S]*?WHERE location_id = \$1 AND is_active = true/);
  assert.match(source, /parallel_service_compatibilities_updated/);
});

test("multi-service agenda and rescheduling use every professional segment safely", async () => {
  const source = await readFile(new URL("../../server/routes.ts", import.meta.url), "utf8");
  assert.match(source, /attachAppointmentServiceSegments\([\s\S]*?appointmentIncludesProfessional/);
  assert.match(source, /serviceSegments[\s\S]*?segment\.barberId === effectiveBarberId/);
  assert.match(source, /app\.post\("\/api\/appointments\/reschedule\/:token\/availability"[\s\S]*?previewMultiServiceRescheduleAvailabilityWithPool/);
  assert.match(source, /app\.post\("\/api\/appointments\/reschedule\/:token"[\s\S]*?rescheduleMultiServiceAppointmentWithPool/);
  assert.match(source, /app\.post\("\/api\/appointments\/:id\/reschedule-availability"[\s\S]*?professionalIds\.length > 1[\s\S]*?appointments\.manage_team[\s\S]*?enforceCanonicalOwnOrTeamCapability/);
  assert.match(source, /app\.patch\("\/api\/appointments\/:id"[\s\S]*?expectedRevision[\s\S]*?rescheduleMultiServiceAppointmentWithPool/);
  assert.doesNotMatch(source, /MULTI_SERVICE_RESCHEDULE_REQUIRES_ASSISTANCE/);
});

test("public appointment-request routes are no-store, rate-limited and return safe proposal errors", async () => {
  const source = await readFile(new URL("../../server/routes.ts", import.meta.url), "utf8");
  assert.match(source, /publicAppointmentRequestRateLimiter/);
  assert.match(source, /publicAppointmentProposalRateLimiter/);
  assert.match(source, /publicAppointmentAvailabilityRateLimiter/);
  assert.match(source, /app\.post\("\/api\/appointment-requests"[\s\S]*?Cache-Control", "no-store"/);
  assert.match(source, /app\.post\("\/api\/appointment-request-proposals\/respond"[\s\S]*?sendAppointmentRequestError\(res, error, true\)/);
  assert.match(source, /APPOINTMENT_REQUEST_PROPOSAL_UNAVAILABLE/);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^\n]*(?:responseToken|customerPhone|customerEmail)/);
});
