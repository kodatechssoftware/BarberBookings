import { expect, test, type APIRequestContext } from "@playwright/test";
import ExcelJS from "exceljs";
import {
  capabilityRegistry,
  professionalCapabilityCodes,
  type CapabilityCode,
} from "../../shared/auth";

const password = "Canonical-Test-Password-2026!";
const localCapabilities = (Object.entries(capabilityRegistry) as Array<[
  CapabilityCode,
  (typeof capabilityRegistry)[CapabilityCode],
]>).filter(([, definition]) => definition.locationGrantAllowed).map(([code]) => code);
const professionalCapabilitySet = new Set<CapabilityCode>(professionalCapabilityCodes);
const professionalAdditionalCapabilities = localCapabilities.filter((code) => !professionalCapabilitySet.has(code));

type Location = { id: number; name: string };
type Professional = { id: number; name: string };
type Service = { id: number; name: string };
type Extra = { id: number; name: string };
type Appointment = {
  id: number;
  customerName: string;
  locationId: number;
  barberId: number;
  startTime: string;
  bufferBeforeMinutesSnapshot?: number;
  bufferAfterMinutesSnapshot?: number;
  extras?: Array<{ extraDefinitionId: number }>;
};

type Fixture = {
  locationA: Location;
  locationB: Location;
  professionalA: Professional;
  teamProfessionalA: Professional;
  serviceA: Service;
  serviceB: Service;
  extraA: Extra;
  extraB: Extra;
  appointmentA: Appointment;
  teamAppointmentA: Appointment;
  appointmentB: Appointment;
  userA: APIRequestContext;
  userAB: APIRequestContext;
  administrator: APIRequestContext;
  userAId: number;
  userABId: number;
  blacklistAId: number;
  blacklistBId: number;
};

let fixture: Fixture;

test.describe.configure({ mode: "serial" });

const headersFor = (locationId: number) => ({ "X-Location-Id": String(locationId) });

async function expectOk(response: Awaited<ReturnType<APIRequestContext["get"]>>) {
  expect(response.ok(), await response.text()).toBe(true);
  return response;
}

function inviteToken(inviteUrl: string) {
  const token = new URL(inviteUrl).hash.match(/^#token=(.+)$/)?.[1];
  if (!token) throw new Error("Canonical invite did not contain a fragment token.");
  return decodeURIComponent(token);
}

async function createCanonicalSession(
  administrator: APIRequestContext,
  browserContext: APIRequestContext,
  input: Record<string, unknown>,
) {
  const create = await administrator.post("/api/admin/users", { data: input });
  expect(create.status(), await create.text()).toBe(201);
  const created = await create.json();
  const accept = await browserContext.post("/api/user-invites/accept", {
    data: { token: inviteToken(created.inviteUrl), password },
  });
  expect(accept.ok(), await accept.text()).toBe(true);
  return { user: created.user, session: await accept.json() };
}

async function createManualAppointment(
  context: APIRequestContext,
  locationId: number,
  professionalId: number,
  serviceId: number,
  customerName: string,
  phone: string,
  hoursFromNow: number,
  extras: Array<{ extraId: number; amountCents?: number }> = [],
) {
  const startTime = new Date();
  startTime.setUTCDate(startTime.getUTCDate() + Math.ceil(hoursFromNow / 24));
  startTime.setUTCHours(10 + (hoursFromNow % 8), 0, 0, 0);
  const response = await context.post("/api/appointments/block", {
    headers: headersFor(locationId),
    data: {
      barberId: professionalId,
      serviceId,
      startTime: startTime.toISOString(),
      name: customerName,
      phone,
      customerEmail: `${customerName.toLowerCase().replaceAll(" ", ".")}@example.test`,
      isManualBooking: true,
      allowOutsideHours: true,
      isRecurring: false,
      extras,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).appointments[0] as Appointment;
}

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(120_000);
  const administrator = await playwright.request.newContext({ baseURL });
  const login = await administrator.post("/api/admin/login", {
    data: { username: "canonical-admin", password },
  });
  expect(login.ok(), await login.text()).toBe(true);

  const locationsResponse = await expectOk(await administrator.get("/api/account/locations"));
  const [locationA] = await locationsResponse.json() as Location[];
  const createLocation = await administrator.post("/api/admin/locations", {
    data: { name: "Loja B", address: "Morada B", timezone: "Europe/Lisbon" },
  });
  expect(createLocation.status(), await createLocation.text()).toBe(201);
  const locationB = await createLocation.json() as Location;
  await expectOk(await administrator.patch(`/api/admin/locations/${locationB.id}`, { data: { isActive: true } }));

  const createService = async (location: Location, name: string) => {
    const response = await administrator.post("/api/services", {
      headers: headersFor(location.id),
      data: {
        name,
        description: `${name} local`,
        price: 1_500,
        duration: 30,
        bufferBeforeMinutes: 10,
        bufferAfterMinutes: 10,
        isVisible: true,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return response.json() as Promise<Service>;
  };
  const serviceA = await createService(locationA, "Serviço canónico A");
  const serviceB = await createService(locationB, "Serviço canónico B");

  const createProfessional = async (name: string, service: Service) => {
    const response = await administrator.post("/api/barbers", {
      headers: headersFor(locationA.id),
      data: {
        name,
        specialty: "Teste de isolamento",
        color: "#336699",
        isVisible: true,
        serviceIds: [service.id],
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return response.json() as Promise<Professional>;
  };
  const professionalA = await createProfessional("Profissional canonical A", serviceA);
  const teamProfessionalA = await createProfessional("Equipa canonical A", serviceA);
  const openEveryDay = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    startTime: "08:00",
    endTime: "22:00",
    isOpen: true,
  }));
  const workingEveryDay = openEveryDay.map(({ isOpen: _isOpen, ...row }) => ({
    ...row,
    isWorking: true,
  }));
  await expectOk(await administrator.patch("/api/shop/availability", {
    headers: headersFor(locationA.id),
    data: openEveryDay,
  }));
  await expectOk(await administrator.patch(`/api/barbers/${professionalA.id}/availability`, {
    headers: headersFor(locationA.id),
    data: workingEveryDay,
  }));
  await expectOk(await administrator.post("/api/admin/location-barbers", {
    headers: headersFor(locationB.id),
    data: { barberId: professionalA.id },
  }));
  await expectOk(await administrator.patch(`/api/barbers/${professionalA.id}/services`, {
    headers: headersFor(locationB.id),
    data: { serviceIds: [serviceB.id] },
  }));

  const createExtra = async (location: Location, name: string) => {
    const response = await administrator.post("/api/admin/extras", {
      headers: headersFor(location.id),
      data: {
        name,
        pricingMode: "fixed",
        amountCents: 300,
        financialRule: "follow_compensation",
        isActive: true,
        sortOrder: 0,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return response.json() as Promise<Extra>;
  };
  const extraA = await createExtra(locationA, "Extra canonical A");
  const extraB = await createExtra(locationB, "Extra canonical B");

  const appointmentA = await createManualAppointment(
    administrator, locationA.id, professionalA.id, serviceA.id,
    "Cliente exclusivo A", "+351910000101", 240,
  );
  const teamAppointmentA = await createManualAppointment(
    administrator, locationA.id, teamProfessionalA.id, serviceA.id,
    "Cliente equipa A", "+351910000102", 242,
  );
  const appointmentB = await createManualAppointment(
    administrator, locationB.id, professionalA.id, serviceB.id,
    "Cliente exclusivo B", "+351910000201", 244,
  );

  const blacklistA = await administrator.post("/api/admin/blacklist", {
    headers: headersFor(locationA.id),
    data: { phone: "+351910009901", reason: "Bloqueio exclusivo Loja A" },
  });
  expect(blacklistA.status(), await blacklistA.text()).toBe(201);
  const blacklistB = await administrator.post("/api/admin/blacklist", {
    headers: headersFor(locationB.id),
    data: { phone: "+351910009902", reason: "Bloqueio exclusivo Loja B" },
  });
  expect(blacklistB.status(), await blacklistB.text()).toBe(201);

  const userA = await playwright.request.newContext({ baseURL });
  const createdA = await createCanonicalSession(administrator, userA, {
    displayName: "User A",
    email: "user-a@example.test",
    professionalId: professionalA.id,
    access: [{
      kind: "location",
      locationId: locationA.id,
      preset: "professional",
      capabilities: professionalAdditionalCapabilities,
    }],
  });
  const userAB = await playwright.request.newContext({ baseURL });
  const createdAB = await createCanonicalSession(administrator, userAB, {
    displayName: "User AB",
    email: "user-ab@example.test",
    access: [locationA, locationB].map((location) => ({
      kind: "location",
      locationId: location.id,
      capabilities: localCapabilities,
    })),
  });

  fixture = {
    locationA,
    locationB,
    professionalA,
    teamProfessionalA,
    serviceA,
    serviceB,
    extraA,
    extraB,
    appointmentA,
    teamAppointmentA,
    appointmentB,
    userA,
    userAB,
    administrator,
    userAId: createdA.user.id,
    userABId: createdAB.user.id,
    blacklistAId: Number((await blacklistA.json()).id),
    blacklistBId: Number((await blacklistB.json()).id),
  };
});

test.afterAll(async () => {
  await Promise.all([
    fixture?.userA.dispose(),
    fixture?.userAB.dispose(),
    fixture?.administrator.dispose(),
  ]);
});

test("canonical scopes restrict location context and Professional linkage grants nothing implicitly", async () => {
  const { userA, administrator, locationA, locationB, professionalA } = fixture;
  const me = await (await expectOk(await userA.get("/api/admin/me"))).json();
  expect(me).toMatchObject({ authorized: true, professionalId: professionalA.id });
  expect(me.access.globalCapabilities).toEqual([]);

  const accessible = await (await expectOk(await userA.get("/api/account/locations"))).json() as Location[];
  expect(accessible.map((location) => location.id)).toEqual([locationA.id]);
  expect([401, 403]).toContain((await userA.get("/api/admin/locations")).status());

  const forbidden = await userA.get("/api/appointments?scope=team", { headers: headersFor(locationB.id) });
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toEqual({ message: "Não tem acesso a esta localização." });

  const expensePayload = {
    category: "other",
    description: "Não deve ser criada",
    amountCents: 100,
    expenseDate: new Date().toISOString().slice(0, 10),
    recurrence: "once",
  };
  const missingLocation = await userA.post("/api/admin/expenses", { data: expensePayload });
  expect(missingLocation.status()).toBe(400);
  expect(await missingLocation.json()).toMatchObject({ code: "LOCATION_REQUIRED" });
  expect((await userA.post("/api/admin/expenses", {
    headers: { "X-Location-Id": "invalid" },
    data: expensePayload,
  })).status()).toBe(400);
  expect((await userA.post("/api/admin/expenses", {
    headers: { "X-Location-Id": "999999" },
    data: expensePayload,
  })).status()).toBe(404);

  const adminMe = await (await expectOk(await administrator.get("/api/admin/me"))).json();
  expect(adminMe).toMatchObject({ role: "admin", professionalId: null });
  const adminLocations = await (await expectOk(await administrator.get("/api/account/locations"))).json() as Location[];
  expect(adminLocations.map((location) => location.id)).toEqual(expect.arrayContaining([locationA.id, locationB.id]));
});

test("appointments, customers and notes do not leak across canonical location scopes", async () => {
  const {
    userA, locationA, locationB, professionalA, teamProfessionalA,
    serviceA, appointmentA, teamAppointmentA, appointmentB,
  } = fixture;
  const own = await (await expectOk(await userA.get(`/api/appointments?barberId=${professionalA.id}`, {
    headers: headersFor(locationA.id),
  }))).json() as Appointment[];
  expect(own.some((appointment) => appointment.id === appointmentA.id)).toBe(true);
  expect(JSON.stringify(own)).not.toContain("Cliente exclusivo B");

  const team = await (await expectOk(await userA.get("/api/appointments?scope=team", {
    headers: headersFor(locationA.id),
  }))).json() as Appointment[];
  expect(team.map((appointment) => appointment.id)).toEqual(expect.arrayContaining([
    appointmentA.id,
    teamAppointmentA.id,
  ]));
  expect(team.some((appointment) => appointment.id === appointmentB.id)).toBe(false);

  const created = await createManualAppointment(
    userA, locationA.id, professionalA.id, serviceA.id,
    "Cliente criado User A", "+351910000103", 246,
  );
  const otherProfessional = await createManualAppointment(
    userA, locationA.id, teamProfessionalA.id, serviceA.id,
    "Cliente equipa criado User A", "+351910000104", 248,
  );
  expect(created.locationId).toBe(locationA.id);
  expect(otherProfessional.locationId).toBe(locationA.id);

  const crossCreate = await userA.post("/api/appointments/block", {
    headers: headersFor(locationB.id),
    data: {
      barberId: professionalA.id,
      serviceId: fixture.serviceB.id,
      startTime: new Date(Date.now() + 250 * 3_600_000).toISOString(),
      name: "Não criar B",
      phone: "+351910000299",
      isManualBooking: true,
      allowOutsideHours: true,
      isRecurring: false,
    },
  });
  expect(crossCreate.status()).toBe(403);

  const statusUpdate = await userA.patch(`/api/appointments/${created.id}/status`, {
    headers: headersFor(locationA.id),
    data: { status: "cancelled", expectedStatus: "booked" },
  });
  expect(statusUpdate.ok(), await statusUpdate.text()).toBe(true);
  expect((await userA.patch(`/api/appointments/${appointmentB.id}/status`, {
    headers: headersFor(locationB.id),
    data: { status: "cancelled", expectedStatus: "booked" },
  })).status()).toBe(403);
  expect((await userA.patch(`/api/appointments/${appointmentB.id}/status`, {
    headers: headersFor(locationA.id),
    data: { status: "cancelled", expectedStatus: "booked" },
  })).status()).toBe(404);

  const note = await userA.patch("/api/admin/customers/notes", {
    headers: headersFor(locationA.id),
    data: { appointmentId: appointmentA.id, notes: "Nota exclusiva da Loja A" },
  });
  expect(note.ok(), await note.text()).toBe(true);
  const history = await (await expectOk(await userA.get(
    `/api/admin/customers/history?appointmentId=${appointmentA.id}`,
    { headers: headersFor(locationA.id) },
  ))).json();
  expect(history.notes.notes).toBe("Nota exclusiva da Loja A");
  expect((await userA.get(`/api/admin/customers/history?appointmentId=${appointmentB.id}`, {
    headers: headersFor(locationA.id),
  })).status()).toBe(404);
  expect((await userA.get(`/api/admin/customers/history?appointmentId=${appointmentB.id}`, {
    headers: headersFor(locationB.id),
  })).status()).toBe(403);
});

test("finance, reports, Extras and blacklist remain local under canonical authorization", async () => {
  const {
    userA, administrator, locationA, locationB, professionalA, serviceA, extraA, extraB,
    appointmentA, blacklistAId,
  } = fixture;
  const runtimeConfig = await (await expectOk(await userA.get("/api/runtime-config"))).json();
  expect(runtimeConfig).toMatchObject({
    vertical: "beauty",
    booking: { flow: ["service", "professional", "datetime", "customer"] },
    features: {
      preparationBuffers: true,
      appointmentAvailabilityWindows: true,
      multiLocation: true,
    },
  });
  const dashboardA = await (await expectOk(await userA.get("/api/admin/dashboard?days=180", {
    headers: headersFor(locationA.id),
  }))).json();
  expect(JSON.stringify(dashboardA)).not.toContain("Cliente exclusivo B");
  expect((await userA.get("/api/admin/dashboard?days=180", {
    headers: headersFor(locationB.id),
  })).status()).toBe(403);

  const today = new Date().toISOString().slice(0, 10);
  const expense = await userA.post("/api/admin/expenses", {
    headers: headersFor(locationA.id),
    data: {
      category: "other",
      description: "Despesa exclusiva A",
      amountCents: 500,
      expenseDate: today,
      recurrence: "once",
    },
  });
  expect(expense.status(), await expense.text()).toBe(201);
  expect((await userA.post("/api/admin/expenses", {
    headers: headersFor(locationB.id),
    data: {
      category: "other",
      description: "Não criar B",
      amountCents: 500,
      expenseDate: today,
      recurrence: "once",
    },
  })).status()).toBe(403);

  const compensationA = await userA.patch(`/api/barbers/${professionalA.id}`, {
    headers: headersFor(locationA.id),
    data: { compensationModel: "commission", commissionPercent: 50 },
  });
  expect(compensationA.ok(), await compensationA.text()).toBe(true);
  expect((await userA.patch(`/api/barbers/${professionalA.id}`, {
    headers: headersFor(locationB.id),
    data: { compensationModel: "commission", commissionPercent: 60 },
  })).status()).toBe(403);

  const exportResponse = await userA.get(
    `/api/admin/export?startDate=${today}&endDate=${new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10)}`,
    { headers: headersFor(locationA.id) },
  );
  expect(exportResponse.ok(), await exportResponse.text()).toBe(true);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportResponse.body());
  const exportedText = workbook.worksheets.flatMap((sheet) => {
    const values: string[] = [];
    sheet.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value ?? ""))));
    return values;
  }).join(" ");
  expect(exportedText).toContain("Serviço canónico A");
  expect(exportedText).not.toContain("Serviço canónico B");
  expect((await userA.get(`/api/admin/export?startDate=${today}&endDate=${today}`, {
    headers: headersFor(locationB.id),
  })).status()).toBe(403);

  const extrasA = await (await expectOk(await userA.get("/api/admin/extras", {
    headers: headersFor(locationA.id),
  }))).json() as Extra[];
  expect(extrasA.map((extra) => extra.id)).toContain(extraA.id);
  expect(extrasA.map((extra) => extra.id)).not.toContain(extraB.id);
  expect((await userA.get("/api/admin/extras", { headers: headersFor(locationB.id) })).status()).toBe(403);
  const withLocalExtra = await createManualAppointment(
    userA, locationA.id, professionalA.id, serviceA.id,
    "Extra local válido", "+351910000106", 251, [{ extraId: extraA.id }],
  );
  expect(withLocalExtra.locationId).toBe(locationA.id);
  expect(withLocalExtra).toMatchObject({
    bufferBeforeMinutesSnapshot: 10,
    bufferAfterMinutesSnapshot: 10,
    extras: [expect.objectContaining({ extraDefinitionId: extraA.id })],
  });
  const extraEventsResponse = await expectOk(await administrator.get(
    `/api/admin/dev/notifications/appointment/${withLocalExtra.id}`,
  ));
  const extraEvents = await extraEventsResponse.json() as Array<{
    eventType: string;
    eventKey: string;
    availableAt: string;
  }>;
  const reminders = extraEvents.filter((event) => event.eventType === "appointment_reminder_day_before");
  expect(reminders).toHaveLength(1);
  expect(reminders[0]).toMatchObject({
    eventKey: `appointment:${withLocalExtra.id}:reminder_day_before:1`,
  });
  expect(new Date(reminders[0].availableAt).getTime()).toBeGreaterThan(Date.now());
  const localDate = withLocalExtra.startTime.slice(0, 10);
  expect((await administrator.get(
    `/api/appointments/public?barberId=${professionalA.id}&date=${localDate}`,
    { headers: headersFor(locationA.id) },
  )).ok()).toBe(true);
  const extraEventsAfterRead = await (await expectOk(await administrator.get(
    `/api/admin/dev/notifications/appointment/${withLocalExtra.id}`,
  ))).json();
  expect(extraEventsAfterRead.map((event: { eventKey: string }) => event.eventKey))
    .toEqual(extraEvents.map((event) => event.eventKey));

  const parentStart = new Date();
  parentStart.setUTCDate(parentStart.getUTCDate() + 14);
  parentStart.setUTCHours(10, 0, 0, 0);
  const windowStart = new Date(parentStart.getTime() + 50 * 60_000);
  const windowEnd = new Date(parentStart.getTime() + 100 * 60_000);
  const parentResponse = await userA.post("/api/appointments/block", {
    headers: headersFor(locationA.id),
    data: {
      barberId: professionalA.id,
      serviceId: null,
      serviceMode: "custom",
      customServiceName: "Tratamento longo com janela",
      customDurationMinutes: 180,
      servicePriceCents: 5_000,
      hasSpecialTerms: true,
      startTime: parentStart.toISOString(),
      name: "Cliente principal janela canonical",
      phone: "+351910000107",
      isManualBooking: true,
      isRecurring: false,
      allowOutsideHours: true,
      availabilityWindows: [{
        startTime: windowStart.toISOString(),
        endTime: windowEnd.toISOString(),
      }],
    },
  });
  expect(parentResponse.status(), await parentResponse.text()).toBe(201);
  const parent = (await parentResponse.json()).appointments[0];
  expect(parent.availabilityWindows).toEqual([{
    startTime: windowStart.toISOString(),
    endTime: windowEnd.toISOString(),
  }]);
  const nestedResponse = await administrator.post("/api/appointments", {
    headers: headersFor(locationA.id),
    data: {
      barberId: professionalA.id,
      serviceId: serviceA.id,
      startTime: new Date(parentStart.getTime() + 60 * 60_000).toISOString(),
      customerName: "Cliente encaixada canonical",
      customerPhone: "+351910000108",
      customerEmail: "canonical-window@example.test",
      whatsappOptIn: true,
    },
  });
  expect(nestedResponse.status(), await nestedResponse.text()).toBe(201);
  expect(await nestedResponse.json()).toMatchObject({
    locationId: locationA.id,
    bufferBeforeMinutesSnapshot: 10,
    bufferAfterMinutesSnapshot: 10,
  });
  const invalidCrossExtra = await userA.post("/api/appointments/block", {
    headers: headersFor(locationA.id),
    data: {
      barberId: professionalA.id,
      serviceId: serviceA.id,
      startTime: new Date(Date.now() + 252 * 3_600_000).toISOString(),
      name: "Extra cruzado",
      phone: "+351910000105",
      isManualBooking: true,
      allowOutsideHours: true,
      isRecurring: false,
      extras: [{ extraId: extraB.id }],
    },
  });
  expect([400, 404]).toContain(invalidCrossExtra.status());

  const blacklistA = await (await expectOk(await userA.get("/api/admin/blacklist", {
    headers: headersFor(locationA.id),
  }))).json() as Array<{ id: number; reason: string }>;
  expect(blacklistA.some((entry) => entry.id === blacklistAId)).toBe(true);
  expect(JSON.stringify(blacklistA)).not.toContain("Bloqueio exclusivo Loja B");
  expect((await userA.post("/api/admin/blacklist", {
    headers: headersFor(locationB.id),
    data: { phone: "+351910009999", reason: "Não criar B" },
  })).status()).toBe(403);
  const removable = await userA.post("/api/admin/blacklist", {
    headers: headersFor(locationA.id),
    data: { phone: "+351910009903", reason: "Remoção exclusiva Loja A" },
  });
  expect(removable.status(), await removable.text()).toBe(201);
  const remove = await userA.delete(`/api/admin/blacklist/${Number((await removable.json()).id)}`, {
    headers: headersFor(locationA.id),
  });
  expect(remove.ok(), await remove.text()).toBe(true);
  expect((await userA.delete(`/api/admin/blacklist/${fixture.blacklistBId}`, {
    headers: headersFor(locationB.id),
  })).status()).toBe(403);

  const history = await (await expectOk(await userA.get(
    `/api/admin/customers/history?appointmentId=${appointmentA.id}`,
    { headers: headersFor(locationA.id) },
  ))).json();
  expect(JSON.stringify(history)).not.toContain("Cliente exclusivo B");
});

test("two-location User and global Administrator see both contexts without mixed responses", async ({ page }) => {
  const { userAB, administrator, locationA, locationB, appointmentA, appointmentB } = fixture;
  const accessible = await (await expectOk(await userAB.get("/api/account/locations"))).json() as Location[];
  expect(accessible.map((location) => location.id)).toEqual(expect.arrayContaining([locationA.id, locationB.id]));

  for (const context of [userAB, administrator]) {
    const appointmentsA = await (await expectOk(await context.get("/api/appointments?scope=team", {
      headers: headersFor(locationA.id),
    }))).json() as Appointment[];
    const appointmentsB = await (await expectOk(await context.get("/api/appointments?scope=team", {
      headers: headersFor(locationB.id),
    }))).json() as Appointment[];
    expect(appointmentsA.some((appointment) => appointment.id === appointmentA.id)).toBe(true);
    expect(appointmentsA.some((appointment) => appointment.id === appointmentB.id)).toBe(false);
    expect(appointmentsB.some((appointment) => appointment.id === appointmentB.id)).toBe(true);
    expect(appointmentsB.some((appointment) => appointment.id === appointmentA.id)).toBe(false);
  }

  const login = await page.request.post("/api/admin/login", {
    data: { username: "user-ab@example.test", password },
  });
  expect(login.ok(), await login.text()).toBe(true);
  await page.addInitScript((locationId) => {
    localStorage.setItem("barberbookings:location-id", String(locationId));
  }, locationA.id);
  await page.goto("/admin");
  await expect(page.getByLabel("Estabelecimento em gestão")).toContainText(locationA.name);
  await page.getByRole("tab", { name: "Bloqueados", exact: true }).click();
  await expect(page.getByText("+351 910 009 901", { exact: true })).toBeVisible();
  await expect(page.getByText("+351 910 009 902", { exact: true })).toHaveCount(0);

  await page.getByLabel("Estabelecimento em gestão").click();
  await page.getByRole("option", { name: locationB.name, exact: true }).click();
  await expect(page.getByLabel("Estabelecimento em gestão")).toContainText(locationB.name);
  await expect(page.getByText("+351 910 009 902", { exact: true })).toBeVisible();
  await expect(page.getByText("+351 910 009 901", { exact: true })).toHaveCount(0);
});

