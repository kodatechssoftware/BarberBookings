import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

const adminPassword = "Playwright-Test-Admin-2026!";

function futureThursdayIso(weeksAhead: number, hour: number, minute = 0) {
  const date = new Date();
  const currentDay = date.getDay();
  const daysUntilThursday = (4 - currentDay + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilThursday + weeksAhead * 7);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function dateKey(iso: string) {
  const date = new Date(iso);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

const shopHours = () => Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  startTime: "09:00",
  endTime: "20:00",
  isOpen: true,
}));

const barberHours = () => Array.from({ length: 7 }, (_, dayOfWeek) => [
  { dayOfWeek, startTime: "10:00", endTime: "12:00", isWorking: true },
  { dayOfWeek, startTime: "14:00", endTime: "18:00", isWorking: true },
]).flat();

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: adminPassword },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function loginAdminPage(page: Page) {
  await page.goto("/admin");
  await page.getByPlaceholder("Introduza o email ou nome de utilizador").fill("admin");
  await page.locator('input[type="password"]').fill(adminPassword);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Painel Administrativo" })).toBeVisible();
}

async function selectDialogOption(page: Page, dialog: Locator, index: number, label: string) {
  await dialog.getByRole("combobox").nth(index).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function clickFirstEnabledManualTime(dialog: Locator) {
  const timeButtons = dialog.getByRole("button", { name: /^\d{2}:\d{2}$/ });
  await expect.poll(() => timeButtons.count()).toBeGreaterThan(0);
  for (let index = 0; index < await timeButtons.count(); index += 1) {
    const button = timeButtons.nth(index);
    if (await button.isEnabled()) {
      await button.click();
      return;
    }
  }
  throw new Error("No enabled manual booking time was found");
}

function getHeaderRow(sheet: ExcelJS.Worksheet, firstHeader: string) {
  const row = sheet.findRow(sheet.getColumn(1).values.findIndex((value) => value === firstHeader));
  if (!row) throw new Error(`Header ${firstHeader} not found in ${sheet.name}`);
  return row;
}

function getSummaryValues(sheet: ExcelJS.Worksheet) {
  const values = new Map<string, unknown>();
  sheet.eachRow((row) => values.set(String(row.getCell(1).value), row.getCell(2).value));
  return values;
}

test.describe.serial("manual booking Extras", () => {
  let barber: any;
  let service: any;
  let alternateService: any;
  let travelExtra: any;
  let specialExtra: any;
  let inactiveExtra: any;
  let originalShopAvailability: any[] = [];
  const createdAppointmentIds = new Set<number>();

  async function createManual(
    request: APIRequestContext,
    name: string,
    startTime: string,
    overrides: Record<string, unknown> = {},
  ) {
    const response = await request.post("/api/appointments/block", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        serviceMode: "existing",
        startTime,
        name,
        phone: "+351912650001",
        customerEmail: `${name.replace(/[^a-z0-9]/gi, "").toLowerCase()}@example.test`,
        isManualBooking: true,
        isRecurring: false,
        ...overrides,
      },
    });
    if (response.status() === 201) {
      const body = await response.json();
      for (const appointment of body.appointments ?? []) createdAppointmentIds.add(appointment.id);
      return { response, body };
    }
    return { response, body: await response.json() };
  }

  async function findAppointments(request: APIRequestContext, name: string, startTime: string) {
    const response = await request.get(`/api/appointments?barberId=${barber.id}&date=${dateKey(startTime)}`);
    expect(response.status(), await response.text()).toBe(200);
    const appointments = (await response.json()).filter((appointment: any) => appointment.customerName === name);
    for (const appointment of appointments) createdAppointmentIds.add(appointment.id);
    return appointments;
  }

  test.beforeAll(async ({ request }) => {
    await loginAdmin(request);
    originalShopAvailability = await (await request.get("/api/shop/availability")).json();
    expect((await request.patch("/api/shop/availability", { data: shopHours() })).ok()).toBe(true);

    const suffix = Date.now();
    const serviceResponse = await request.post("/api/services", { data: {
      name: `Corte Extras QA ${suffix}`,
      description: "Serviço base para Extras",
      price: 1500,
      duration: 60,
      isVisible: true,
    } });
    expect(serviceResponse.status(), await serviceResponse.text()).toBe(201);
    service = await serviceResponse.json();

    const alternateResponse = await request.post("/api/services", { data: {
      name: `Barba Extras QA ${suffix}`,
      description: "Serviço alternativo para Extras",
      price: 2000,
      duration: 60,
      isVisible: true,
    } });
    expect(alternateResponse.status(), await alternateResponse.text()).toBe(201);
    alternateService = await alternateResponse.json();

    const barberResponse = await request.post("/api/barbers", { data: {
      name: `Barbeiro Extras booking QA ${suffix}`,
      specialty: "Testes de Extras",
      isVisible: true,
      serviceIds: [service.id, alternateService.id],
    } });
    expect(barberResponse.status(), await barberResponse.text()).toBe(201);
    barber = await barberResponse.json();
    expect((await request.patch(`/api/barbers/${barber.id}/availability`, { data: barberHours() })).ok()).toBe(true);

    const createExtra = async (
      name: string,
      pricingMode: "fixed" | "variable",
      amountCents: number | null,
      financialRule: string,
    ) => {
      const response = await request.post("/api/admin/extras", { data: {
        name: `${name} ${suffix}`,
        pricingMode,
        amountCents,
        financialRule,
      } });
      expect(response.status(), await response.text()).toBe(201);
      return response.json();
    };
    travelExtra = await createExtra("Deslocação Extras booking QA", "variable", null, "barber");
    specialExtra = await createExtra("Atendimento especial Extras booking QA", "fixed", 500, "establishment");
    inactiveExtra = await createExtra("Extra inativo booking QA", "fixed", 300, "follow_compensation");
    expect((await request.patch(`/api/admin/extras/${inactiveExtra.id}`, { data: { isActive: false } })).ok()).toBe(true);
  });

  test.beforeEach(async ({ request }) => {
    await loginAdmin(request);
  });

  test.afterAll(async ({ request }) => {
    await loginAdmin(request);
    for (const id of createdAppointmentIds) {
      await request.patch(`/api/appointments/${id}/status`, { data: { status: "cancelled" } });
    }
    if (barber?.id) await request.patch(`/api/barbers/${barber.id}`, { data: { isVisible: false } });
    if (service?.id) await request.patch(`/api/services/${service.id}`, { data: { isVisible: false } });
    if (alternateService?.id) await request.patch(`/api/services/${alternateService.id}`, { data: { isVisible: false } });
    if (originalShopAvailability.length > 0) {
      await request.patch("/api/shop/availability", { data: originalShopAvailability });
    }
  });

  test("creates no, one and multiple Extras with authoritative snapshots", async ({ request }) => {
    const noExtrasStart = futureThursdayIso(240, 10);
    const noExtrasName = `Manual sem Extras ${Date.now()}`;
    const noExtras = await createManual(request, noExtrasName, noExtrasStart);
    expect(noExtras.response.status(), JSON.stringify(noExtras.body)).toBe(201);
    expect(noExtras.body.appointments).toHaveLength(1);
    expect(noExtras.body.appointments[0].extras).toEqual([]);
    expect((await findAppointments(request, noExtrasName, noExtrasStart))[0].extras).toEqual([]);

    const oneExtraStart = futureThursdayIso(241, 10);
    const oneExtraName = `Manual um Extra ${Date.now()}`;
    const oneExtra = await createManual(request, oneExtraName, oneExtraStart, {
      extras: [{ extraId: travelExtra.id, amountCents: 1000 }],
    });
    expect(oneExtra.response.status(), JSON.stringify(oneExtra.body)).toBe(201);
    expect(oneExtra.body.appointments[0].extras).toEqual([expect.objectContaining({
      extraDefinitionId: travelExtra.id,
      nameSnapshot: travelExtra.name,
      amountCentsSnapshot: 1000,
      financialRuleSnapshot: "barber",
      position: 0,
    })]);

    const multipleStart = futureThursdayIso(242, 10);
    const multipleName = `Manual vários Extras ${Date.now()}`;
    const multiple = await createManual(request, multipleName, multipleStart, {
      extras: [
        { extraId: specialExtra.id },
        { extraId: travelExtra.id, amountCents: 1750 },
      ],
    });
    expect(multiple.response.status(), JSON.stringify(multiple.body)).toBe(201);
    expect(multiple.body.appointments[0].extras).toEqual([
      expect.objectContaining({
        extraDefinitionId: specialExtra.id,
        nameSnapshot: specialExtra.name,
        amountCentsSnapshot: 500,
        financialRuleSnapshot: "establishment",
        position: 0,
      }),
      expect.objectContaining({
        extraDefinitionId: travelExtra.id,
        nameSnapshot: travelExtra.name,
        amountCentsSnapshot: 1750,
        financialRuleSnapshot: "barber",
        position: 1,
      }),
    ]);
    const refreshed = (await findAppointments(request, multipleName, multipleStart))[0];
    expect(refreshed.extras).toEqual(multiple.body.appointments[0].extras);
  });

  test("combines Extras independently with special, custom, inside and outside-hours terms", async ({ request }) => {
    const specialStart = futureThursdayIso(243, 10);
    const specialName = `Preço especial com Extra ${Date.now()}`;
    const special = await createManual(request, specialName, specialStart, {
      hasSpecialTerms: true,
      servicePriceCents: 2000,
      extras: [{ extraId: travelExtra.id, amountCents: 1000 }],
    });
    expect(special.response.status(), JSON.stringify(special.body)).toBe(201);
    expect(special.body.appointments[0]).toMatchObject({
      serviceId: service.id,
      servicePriceCentsSnapshot: 2000,
      durationMinutes: 60,
      manualOutsideHours: false,
    });
    expect(special.body.appointments[0].extras).toHaveLength(1);

    const customStart = futureThursdayIso(244, 10);
    const customName = `Serviço custom com Extra ${Date.now()}`;
    const custom = await createManual(request, customName, customStart, {
      serviceId: null,
      serviceMode: "custom",
      hasSpecialTerms: true,
      customServiceName: "Produção personalizada com Extra",
      customDurationMinutes: 45,
      servicePriceCents: 3000,
      extras: [{ extraId: specialExtra.id, amountCents: 9999 }],
    });
    expect(custom.response.status(), JSON.stringify(custom.body)).toBe(201);
    expect(custom.body.appointments[0]).toMatchObject({
      serviceId: null,
      serviceNameSnapshot: "Produção personalizada com Extra",
      durationMinutes: 45,
      servicePriceCentsSnapshot: 3000,
      manualOutsideHours: false,
    });
    expect(custom.body.appointments[0].extras[0]).toMatchObject({
      extraDefinitionId: specialExtra.id,
      amountCentsSnapshot: 500,
    });

    const outsideStart = futureThursdayIso(245, 18);
    const outsideName = `Fora do horário com Extra ${Date.now()}`;
    const outside = await createManual(request, outsideName, outsideStart, {
      allowOutsideHours: true,
      extras: [{ extraId: travelExtra.id, amountCents: 1700 }],
    });
    expect(outside.response.status(), JSON.stringify(outside.body)).toBe(201);
    expect(outside.body.appointments[0]).toMatchObject({
      durationMinutes: 60,
      manualOutsideHours: true,
    });
    expect(outside.body.appointments[0].extras).toHaveLength(1);
  });

  test("applies identical Extras to atomic batches, including mixed schedule intervals", async ({ request }) => {
    const batchStart = futureThursdayIso(246, 10);
    const batchSecond = futureThursdayIso(246, 11);
    const batchName = `Batch um Extra ${Date.now()}`;
    const batch = await createManual(request, batchName, batchStart, {
      startTimes: [batchStart, batchSecond],
      extras: [{ extraId: travelExtra.id, amountCents: 1000 }],
    });
    expect(batch.response.status(), JSON.stringify(batch.body)).toBe(201);
    expect(batch.body.appointments).toHaveLength(2);
    expect(batch.body.appointments.map((appointment: any) => appointment.extras.map((extra: any) => extra.extraDefinitionId)))
      .toEqual([[travelExtra.id], [travelExtra.id]]);
    expect(batch.body.appointments.map((appointment: any) => appointment.extras[0].amountCentsSnapshot))
      .toEqual([1000, 1000]);
    expect(batch.body.appointments[0].extras[0].appointmentId).toBeUndefined();

    const multipleStart = futureThursdayIso(247, 10);
    const multipleSecond = futureThursdayIso(247, 11);
    const multipleName = `Batch vários Extras ${Date.now()}`;
    const multiple = await createManual(request, multipleName, multipleStart, {
      startTimes: [multipleStart, multipleSecond],
      extras: [
        { extraId: travelExtra.id, amountCents: 1750 },
        { extraId: specialExtra.id },
      ],
    });
    expect(multiple.response.status(), JSON.stringify(multiple.body)).toBe(201);
    expect(multiple.body.appointments.map((appointment: any) => appointment.extras.map((extra: any) => extra.extraDefinitionId)))
      .toEqual([
        [travelExtra.id, specialExtra.id],
        [travelExtra.id, specialExtra.id],
      ]);
    expect(multiple.body.appointments.map((appointment: any) =>
      appointment.extras.map((extra: any) => extra.amountCentsSnapshot)))
      .toEqual([
        [1750, 500],
        [1750, 500],
      ]);

    const mixedInside = futureThursdayIso(248, 10);
    const mixedOutside = futureThursdayIso(248, 18);
    const mixedName = `Batch misto Extras ${Date.now()}`;
    const mixed = await createManual(request, mixedName, mixedInside, {
      startTimes: [mixedInside, mixedOutside],
      allowOutsideHours: true,
      extras: [
        { extraId: travelExtra.id, amountCents: 1850 },
        { extraId: specialExtra.id },
      ],
    });
    expect(mixed.response.status(), JSON.stringify(mixed.body)).toBe(201);
    expect(mixed.body.appointments.map((appointment: any) => appointment.manualOutsideHours)).toEqual([false, true]);
    expect(mixed.body.appointments.map((appointment: any) => appointment.extras.map((extra: any) => ({
      id: extra.extraDefinitionId,
      amount: extra.amountCentsSnapshot,
    }))))
      .toEqual([
        [{ id: travelExtra.id, amount: 1850 }, { id: specialExtra.id, amount: 500 }],
        [{ id: travelExtra.id, amount: 1850 }, { id: specialExtra.id, amount: 500 }],
      ]);
  });

  test("rejects invalid, duplicate, inactive and recurring Extra selections without partial writes", async ({ request }) => {
    const invalidStart = futureThursdayIso(249, 10);
    const invalidSecond = futureThursdayIso(249, 11);
    const invalidName = `Batch rollback Extra inválido ${Date.now()}`;
    const invalid = await createManual(request, invalidName, invalidStart, {
      startTimes: [invalidStart, invalidSecond],
      extras: [{ extraId: 999_999_999 }],
    });
    expect(invalid.response.status(), JSON.stringify(invalid.body)).toBe(409);
    expect(invalid.body.code).toBe("APPOINTMENT_EXTRA_UNAVAILABLE");
    expect(await findAppointments(request, invalidName, invalidStart)).toHaveLength(0);

    const duplicate = await createManual(request, `Extra duplicado ${Date.now()}`, futureThursdayIso(250, 10), {
      extras: [
        { extraId: travelExtra.id, amountCents: 1000 },
        { extraId: travelExtra.id, amountCents: 1500 },
      ],
    });
    expect(duplicate.response.status(), JSON.stringify(duplicate.body)).toBe(400);
    expect(duplicate.body.code).toBe("APPOINTMENT_EXTRA_IDS_INVALID");

    const inactive = await createManual(request, `Extra inativo ${Date.now()}`, futureThursdayIso(251, 10), {
      extras: [{ extraId: inactiveExtra.id }],
    });
    expect(inactive.response.status(), JSON.stringify(inactive.body)).toBe(409);
    expect(inactive.body.code).toBe("APPOINTMENT_EXTRA_UNAVAILABLE");

    const modalRaceCreate = await request.post("/api/admin/extras", { data: {
      name: `Extra desativado durante modal ${Date.now()}`,
      pricingMode: "fixed",
      amountCents: 425,
      financialRule: "establishment",
    } });
    expect(modalRaceCreate.status(), await modalRaceCreate.text()).toBe(201);
    const modalRaceExtra = await modalRaceCreate.json();
    const modalRaceDeactivate = await request.patch(`/api/admin/extras/${modalRaceExtra.id}`, {
      data: { isActive: false },
    });
    expect(modalRaceDeactivate.status(), await modalRaceDeactivate.text()).toBe(200);
    const modalRace = await createManual(
      request,
      `Extra desativado no submit ${Date.now()}`,
      futureThursdayIso(251, 16),
      { extras: [{ extraId: modalRaceExtra.id }] },
    );
    expect(modalRace.response.status(), JSON.stringify(modalRace.body)).toBe(409);
    expect(modalRace.body.code).toBe("APPOINTMENT_EXTRA_UNAVAILABLE");

    for (const [label, extra] of [
      ["ausente", { extraId: travelExtra.id }],
      ["zero", { extraId: travelExtra.id, amountCents: 0 }],
      ["negativo", { extraId: travelExtra.id, amountCents: -100 }],
    ] as const) {
      const invalidVariable = await createManual(
        request,
        `Extra variável ${label} ${Date.now()}`,
        futureThursdayIso(251, label === "ausente" ? 11 : label === "zero" ? 14 : 15),
        { extras: [extra] },
      );
      expect(invalidVariable.response.status(), JSON.stringify(invalidVariable.body)).toBe(400);
      expect(invalidVariable.body.code).toBe("APPOINTMENT_EXTRA_AMOUNT_INVALID");
    }

    const recurringName = `Recorrência com Extra ${Date.now()}`;
    const recurring = await createManual(request, recurringName, futureThursdayIso(252, 10), {
      isRecurring: true,
      recurringWeeks: 1,
      recurringMonths: 1,
      extras: [{ extraId: travelExtra.id, amountCents: 1000 }],
    });
    expect(recurring.response.status(), JSON.stringify(recurring.body)).toBe(400);
    expect(recurring.body.code).toBe("APPOINTMENT_EXTRAS_NOT_ALLOWED_FOR_RECURRING");
    expect(await findAppointments(request, recurringName, futureThursdayIso(252, 10))).toHaveLength(0);
  });

  test("keeps public booking and no-Extras token UI unchanged", async ({ request, page }) => {
    const startTime = futureThursdayIso(253, 10);
    const customerName = `Public sem Extras ${Date.now()}`;
    const response = await request.post("/api/appointments", { data: {
      barberId: barber.id,
      serviceId: service.id,
      startTime,
      customerName,
      customerPhone: "+351912650002",
      customerEmail: "public-extras@example.test",
      extras: [{ extraId: travelExtra.id, amountCents: 1000 }],
    } });
    expect(response.status(), await response.text()).toBe(201);
    const publicAppointment = await response.json();
    createdAppointmentIds.add(publicAppointment.id);
    expect(publicAppointment).not.toHaveProperty("extras");
    const [adminAppointment] = await findAppointments(request, customerName, startTime);
    expect(adminAppointment.extras).toEqual([]);
    const tokenResponse = await request.get(`/api/appointments/token/${publicAppointment.cancelToken}`);
    expect(tokenResponse.status(), await tokenResponse.text()).toBe(200);
    expect(await tokenResponse.json()).toMatchObject({ extras: [], totalPrice: service.price });
    await page.goto(`/cancel/${publicAppointment.cancelToken}`);
    await expect(page.getByText(customerName)).toHaveCount(0);
    await expect(page.getByTestId("customer-appointment-commercial-summary")).toHaveCount(0);
  });

  test("edits booked Extras atomically and exposes only commercial snapshots in history and token", async ({ request }) => {
    test.setTimeout(120_000);
    const suffix = Date.now();
    const createExtra = async (payload: Record<string, unknown>) => {
      const response = await request.post("/api/admin/extras", { data: payload });
      expect(response.status(), await response.text()).toBe(201);
      return response.json();
    };
    const editableVariable = await createExtra({
      name: `Deslocação editável ${suffix}`,
      pricingMode: "variable",
      amountCents: null,
      financialRule: "barber",
      sortOrder: 50,
    });
    const editableFixed = await createExtra({
      name: `Extra fixo editável ${suffix}`,
      pricingMode: "fixed",
      amountCents: 500,
      financialRule: "establishment",
      sortOrder: 51,
    });
    const newVariable = await createExtra({
      name: `Variável nova ${suffix}`,
      pricingMode: "variable",
      amountCents: null,
      financialRule: "follow_compensation",
      sortOrder: 52,
    });

    const startTime = futureThursdayIso(254, 10);
    const customerName = `Editor Extras ${suffix}`;
    const created = await createManual(request, customerName, startTime, {
      hasSpecialTerms: true,
      servicePriceCents: 2500,
      extras: [
        { extraId: editableVariable.id, amountCents: 1000 },
        { extraId: editableFixed.id },
      ],
    });
    expect(created.response.status(), JSON.stringify(created.body)).toBe(201);
    const appointment = created.body.appointments[0];
    expect(appointment.extras.map((extra: any) => extra.amountCentsSnapshot)).toEqual([1000, 500]);

    const preserve = await request.patch(`/api/appointments/${appointment.id}`, {
      data: { servicePriceCents: 2600 },
    });
    expect(preserve.status(), await preserve.text()).toBe(200);
    expect((await preserve.json()).extras.map((extra: any) => extra.amountCentsSnapshot)).toEqual([1000, 500]);

    expect((await request.patch(`/api/admin/extras/${editableVariable.id}`, {
      data: { name: `Deslocação atual ${suffix}`, financialRule: "follow_compensation" },
    })).ok()).toBe(true);
    expect((await request.patch(`/api/admin/extras/${editableFixed.id}`, {
      data: { name: `Extra fixo atual ${suffix}`, amountCents: 750 },
    })).ok()).toBe(true);

    const unchanged = await request.patch(`/api/appointments/${appointment.id}`, {
      data: {
        extras: [
          { extraId: editableVariable.id, amountCents: 1000 },
          { extraId: editableFixed.id },
        ],
      },
    });
    expect(unchanged.status(), await unchanged.text()).toBe(200);
    expect((await unchanged.json()).extras).toEqual([
      expect.objectContaining({ nameSnapshot: editableVariable.name, amountCentsSnapshot: 1000 }),
      expect.objectContaining({ nameSnapshot: editableFixed.name, amountCentsSnapshot: 500 }),
    ]);

    const changed = await request.patch(`/api/appointments/${appointment.id}`, {
      data: {
        extras: [
          { extraId: editableVariable.id, amountCents: 1800 },
          { extraId: editableFixed.id },
        ],
      },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const changedBody = await changed.json();
    expect(changedBody.extras).toEqual([
      expect.objectContaining({ nameSnapshot: `Deslocação atual ${suffix}`, amountCentsSnapshot: 1800 }),
      expect.objectContaining({ nameSnapshot: editableFixed.name, amountCentsSnapshot: 500 }),
    ]);

    const beforeRollback = (await findAppointments(request, customerName, startTime))[0];
    const invalidRollback = await request.patch(`/api/appointments/${appointment.id}`, {
      data: {
        servicePriceCents: 4000,
        extras: [{ extraId: 999_999_999 }],
      },
    });
    expect(invalidRollback.status(), await invalidRollback.text()).toBe(409);
    const afterInvalidRollback = (await findAppointments(request, customerName, startTime))[0];
    expect(afterInvalidRollback.servicePriceCentsSnapshot).toBe(beforeRollback.servicePriceCentsSnapshot);
    expect(afterInvalidRollback.extras).toEqual(beforeRollback.extras);

    const variableRollback = await request.patch(`/api/appointments/${appointment.id}`, {
      data: {
        servicePriceCents: 4100,
        extras: [{ extraId: newVariable.id }],
      },
    });
    expect(variableRollback.status(), await variableRollback.text()).toBe(400);
    const afterVariableRollback = (await findAppointments(request, customerName, startTime))[0];
    expect(afterVariableRollback.servicePriceCentsSnapshot).toBe(beforeRollback.servicePriceCentsSnapshot);
    expect(afterVariableRollback.extras).toEqual(beforeRollback.extras);

    const historyResponse = await request.get(`/api/admin/customers/history?appointmentId=${appointment.id}`);
    expect(historyResponse.status(), await historyResponse.text()).toBe(200);
    const historyAppointment = (await historyResponse.json()).appointments.find((item: any) => item.id === appointment.id);
    expect(historyAppointment).toMatchObject({ servicePrice: 2600, totalPrice: 4900, status: "booked" });
    expect(historyAppointment.extras).toEqual([
      expect.objectContaining({ nameSnapshot: `Deslocação atual ${suffix}`, amountCentsSnapshot: 1800 }),
      expect.objectContaining({ nameSnapshot: editableFixed.name, amountCentsSnapshot: 500 }),
    ]);
    expect(JSON.stringify(historyAppointment)).not.toContain("financialRuleSnapshot");

    const tokenResponse = await request.get(`/api/appointments/token/${appointment.cancelToken}`);
    expect(tokenResponse.status(), await tokenResponse.text()).toBe(200);
    const tokenBody = await tokenResponse.json();
    expect(tokenBody).toMatchObject({ price: 2600, totalPrice: 4900 });
    expect(tokenBody.extras).toEqual(historyAppointment.extras.map((extra: any) => ({
      nameSnapshot: extra.nameSnapshot,
      amountCentsSnapshot: extra.amountCentsSnapshot,
      position: extra.position,
    })));
    expect(JSON.stringify(tokenBody)).not.toContain("financialRuleSnapshot");
    expect(JSON.stringify(tokenBody)).not.toContain("extraDefinitionId");

    const logs = await (await request.get("/api/admin/audit-logs?limit=100")).json();
    const extrasAudit = logs.find((log: any) => log.action === "appointment.updated"
      && log.entityId === appointment.id
      && JSON.parse(log.metadata).fields.includes("extras"));
    expect(extrasAudit).toBeTruthy();
    const auditMetadata = JSON.parse(extrasAudit.metadata);
    expect(auditMetadata).toMatchObject({ previousTotalCents: 4100, newTotalCents: 4900 });
    expect(auditMetadata.previousExtras).toBeInstanceOf(Array);
    expect(auditMetadata.newExtras).toBeInstanceOf(Array);
    expect(JSON.stringify(auditMetadata)).not.toContain("financialRuleSnapshot");

    expect((await request.patch(`/api/admin/extras/${editableFixed.id}`, { data: { isActive: false } })).ok()).toBe(true);
    const removeInactive = await request.patch(`/api/appointments/${appointment.id}`, {
      data: { extras: [{ extraId: editableVariable.id, amountCents: 1800 }] },
    });
    expect(removeInactive.status(), await removeInactive.text()).toBe(200);
    const readdInactive = await request.patch(`/api/appointments/${appointment.id}`, {
      data: {
        extras: [
          { extraId: editableVariable.id, amountCents: 1800 },
          { extraId: editableFixed.id },
        ],
      },
    });
    expect(readdInactive.status(), await readdInactive.text()).toBe(409);
    expect((await findAppointments(request, customerName, startTime))[0].extras).toHaveLength(1);

    const removeAll = await request.patch(`/api/appointments/${appointment.id}`, { data: { extras: [] } });
    expect(removeAll.status(), await removeAll.text()).toBe(200);
    expect((await removeAll.json()).extras).toEqual([]);

    for (const [index, status] of ["completed", "cancelled", "late_cancelled", "no_show"].entries()) {
      const stateStart = status === "completed" || status === "no_show"
        ? futureThursdayIso(-270 - index, 10)
        : futureThursdayIso(255 + index, 10);
      const stateCreated = await createManual(request, `Estado Extra ${status} ${suffix}`, stateStart, {
        allowOutsideHours: status === "completed" || status === "no_show",
        extras: [{ extraId: editableVariable.id, amountCents: 900 }],
      });
      expect(stateCreated.response.status(), JSON.stringify(stateCreated.body)).toBe(201);
      const stateAppointment = stateCreated.body.appointments[0];
      if (stateAppointment.status !== status) {
        const stateResponse = status === "no_show"
          ? await request.patch(`/api/appointments/${stateAppointment.id}`, { data: { status } })
          : await request.patch(`/api/appointments/${stateAppointment.id}/status`, {
              data: { status, ...(status === "completed" ? { paymentMethod: "cash" } : {}) },
            });
        expect(stateResponse.status(), `${status}: ${await stateResponse.text()}`).toBe(200);
      }
      const editHistorical = await request.patch(`/api/appointments/${stateAppointment.id}`, { data: { extras: [] } });
      expect(editHistorical.status(), `${status}: ${await editHistorical.text()}`).toBe(409);
      expect((await findAppointments(request, `Estado Extra ${status} ${suffix}`, stateStart))[0].extras).toHaveLength(1);
    }
  });

  test("renders and edits snapshot Extras coherently on desktop, mobile, history and customer token", async ({ page, request }) => {
    test.setTimeout(120_000);
    const suffix = Date.now();
    const variableResponse = await request.post("/api/admin/extras", { data: {
      name: `Extra UI variável ${suffix}`,
      pricingMode: "variable",
      amountCents: null,
      financialRule: "barber",
      sortOrder: 60,
    } });
    expect(variableResponse.status(), await variableResponse.text()).toBe(201);
    const variable = await variableResponse.json();
    const fixedResponse = await request.post("/api/admin/extras", { data: {
      name: `Extra UI fixo ${suffix}`,
      pricingMode: "fixed",
      amountCents: 500,
      financialRule: "establishment",
      sortOrder: 61,
    } });
    expect(fixedResponse.status(), await fixedResponse.text()).toBe(201);
    const fixed = await fixedResponse.json();
    const startTime = futureThursdayIso(6, 10);
    const customerName = `Detalhe Extras UI ${suffix}`;
    const created = await createManual(request, customerName, startTime, {
      hasSpecialTerms: true,
      servicePriceCents: 2500,
      extras: [
        { extraId: variable.id, amountCents: 1000 },
        { extraId: fixed.id },
      ],
    });
    expect(created.response.status(), JSON.stringify(created.body)).toBe(201);
    const appointment = created.body.appointments[0];
    expect((await request.patch(`/api/admin/extras/${fixed.id}`, { data: { isActive: false } })).ok()).toBe(true);

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdminPage(page);
    await page.getByRole("tab", { name: /Marca/ }).click();
    await page.getByRole("button", { name: /Pr.ximas/ }).click();
    const appointmentButton = page.getByRole("button", {
      name: new RegExp(`Abrir detalhes da marca..o de ${customerName}`),
    }).first();
    await expect(appointmentButton).toBeVisible();
    await appointmentButton.click();

    let details = page.getByRole("dialog", { name: /Detalhes da marca/ });
    const breakdown = details.getByTestId("appointment-price-breakdown");
    await expect(breakdown).toContainText(variable.name);
    await expect(breakdown).toContainText(fixed.name);
    await expect(breakdown.getByText("40,00 €", { exact: true })).toBeVisible();
    await details.screenshot({ path: "test-results/appointment-extras-detail-desktop.png" });

    await details.getByRole("button", { name: "Editar", exact: true }).click();
    let editor = page.getByRole("dialog", { name: /Editar marca/ });
    const extrasEditor = editor.getByTestId("appointment-extras-editor");
    await expect(extrasEditor.getByLabel(`Selecionar Extra ${variable.name}`)).toBeChecked();
    await expect(extrasEditor.getByLabel(`Selecionar Extra ${fixed.name}`)).toBeChecked();
    await expect(extrasEditor.getByText("Inativo · pode remover, mas não voltar a adicionar")).toBeVisible();
    await expect(extrasEditor.getByLabel(`Valor do Extra ${fixed.name}`)).toHaveCount(0);
    await extrasEditor.getByLabel(`Valor do Extra ${variable.name}`).fill("18,00");
    await extrasEditor.getByLabel(`Selecionar Extra ${fixed.name}`).click();
    await expect(editor.getByTestId("appointment-edit-total")).toContainText("43,00 €");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(editor).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await editor.screenshot({ path: "test-results/appointment-extras-editor-mobile.png" });
    await editor.getByRole("button", { name: "Guardar alterações" }).click();
    await expect(editor).not.toBeVisible();

    details = page.getByRole("dialog", { name: /Detalhes da marca/ });
    await expect(details.getByTestId("appointment-price-breakdown")).toContainText("43,00 €");
    await expect(details.getByTestId("appointment-price-breakdown")).toContainText(variable.name);
    await expect(details.getByTestId("appointment-price-breakdown")).not.toContainText(fixed.name);
    await details.getByRole("button", { name: "Histórico" }).click();
    const history = page.getByRole("dialog", { name: "Histórico do cliente" });
    const historyAppointment = history.getByTestId("customer-history-appointment").filter({ hasText: variable.name }).first();
    await expect(historyAppointment).toContainText(variable.name);
    await expect(historyAppointment).toContainText("18,00 €");
    await expect(historyAppointment).toContainText("43,00 €");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await page.goto(`/cancel/${appointment.cancelToken}`);
    const customerSummary = page.getByTestId("customer-appointment-commercial-summary");
    await expect(customerSummary).toContainText(service.name);
    await expect(customerSummary).toContainText(variable.name);
    await expect(customerSummary).toContainText("18,00 €");
    await expect(customerSummary).toContainText("43,00 €");
    await expect(customerSummary).not.toContainText("barber");
    await expect(customerSummary).not.toContainText("establishment");
  });

  test("preserves selections across service and special-term changes, resets recurrence and renders totals responsively", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAdminPage(page);
    await page.getByRole("button", { name: "Marcação manual" }).click();
    let dialog = page.getByRole("dialog", { name: "Marcação manual" });
    const extrasSection = dialog.getByTestId("manual-booking-extras");
    await expect(extrasSection).toBeVisible();
    await expect(extrasSection.getByLabel(`Selecionar Extra ${travelExtra.name}`)).not.toBeChecked();
    await expect(extrasSection.getByLabel(`Selecionar Extra ${specialExtra.name}`)).not.toBeChecked();
    await expect(extrasSection.getByLabel(`Selecionar Extra ${inactiveExtra.name}`)).toHaveCount(0);

    await selectDialogOption(page, dialog, 0, barber.name);
    await selectDialogOption(page, dialog, 1, service.name);
    await extrasSection.getByLabel(`Selecionar Extra ${travelExtra.name}`).click();
    await extrasSection.getByLabel(`Selecionar Extra ${specialExtra.name}`).click();
    await extrasSection.getByLabel(`Valor do Extra ${travelExtra.name}`).fill("10,00");
    await expect(extrasSection.getByLabel(`Valor do Extra ${specialExtra.name}`)).toHaveCount(0);

    let summary = dialog.getByTestId("manual-booking-summary");
    await expect(summary.getByText("Serviço", { exact: true })).toBeVisible();
    await expect(summary.getByText("15,00 €", { exact: true })).toBeVisible();
    await expect(summary.getByText("Total", { exact: true })).toBeVisible();
    await expect(summary.getByText("30,00 €", { exact: true })).toBeVisible();
    await dialog.screenshot({ path: "test-results/manual-booking-extras-desktop.png" });

    await selectDialogOption(page, dialog, 1, alternateService.name);
    await expect(extrasSection.getByLabel(`Selecionar Extra ${travelExtra.name}`)).toBeChecked();
    await expect(extrasSection.getByLabel(`Selecionar Extra ${specialExtra.name}`)).toBeChecked();
    await expect(extrasSection.getByLabel(`Valor do Extra ${travelExtra.name}`)).toHaveValue("10,00");
    await expect(summary.getByText("35,00 €", { exact: true })).toBeVisible();

    const specialTermsSwitch = dialog.getByLabel("Condições especiais desta marcação");
    await specialTermsSwitch.click();
    await dialog.locator("#manual-booking-special-price").fill("22,00");
    await expect(extrasSection.getByLabel(`Selecionar Extra ${travelExtra.name}`)).toBeChecked();
    await expect(summary.getByText("Preço especial", { exact: true })).toBeVisible();
    await expect(summary.getByText("37,00 €", { exact: true })).toBeVisible();
    await specialTermsSwitch.click();
    await expect(extrasSection.getByLabel(`Selecionar Extra ${travelExtra.name}`)).toBeChecked();
    await expect(extrasSection.getByLabel(`Selecionar Extra ${specialExtra.name}`)).toBeChecked();

    await specialTermsSwitch.click();
    await dialog.getByRole("button", { name: "Serviço personalizado" }).click();
    await dialog.locator("#manual-booking-custom-service").fill("Serviço custom UI com Extras");
    await dialog.locator("#manual-booking-custom-duration").fill("45");
    await dialog.locator("#manual-booking-custom-price").fill("30,00");
    await expect(extrasSection.getByLabel(`Selecionar Extra ${travelExtra.name}`)).toBeChecked();
    await expect(extrasSection.getByLabel(`Selecionar Extra ${specialExtra.name}`)).toBeChecked();
    await expect(summary.getByText("45,00 €", { exact: true })).toBeVisible();

    await dialog.getByLabel("Repetir marcação").click();
    await expect(dialog.getByTestId("manual-booking-extras")).toHaveCount(0);
    await expect(specialTermsSwitch).not.toBeChecked();
    await dialog.getByLabel("Repetir marcação").click();
    await expect(dialog.getByTestId("manual-booking-extras")).toBeVisible();
    await expect(dialog.getByLabel(`Selecionar Extra ${travelExtra.name}`)).not.toBeChecked();
    await expect(dialog.getByLabel(`Selecionar Extra ${specialExtra.name}`)).not.toBeChecked();

    await dialog.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Marcação manual" }).click();
    dialog = page.getByRole("dialog", { name: "Marcação manual" });
    await expect(dialog.getByLabel(`Selecionar Extra ${travelExtra.name}`)).not.toBeChecked();
    await selectDialogOption(page, dialog, 0, barber.name);
    await selectDialogOption(page, dialog, 1, service.name);
    await dialog.getByLabel(`Selecionar Extra ${travelExtra.name}`).click();
    await dialog.getByLabel(`Selecionar Extra ${specialExtra.name}`).click();
    await dialog.getByLabel(`Valor do Extra ${travelExtra.name}`).fill("10,00");
    await dialog.getByLabel("Nome do cliente", { exact: true }).fill(`Payload Extras UI ${Date.now()}`);
    await clickFirstEnabledManualTime(dialog);

    let submittedPayload: Record<string, unknown> | undefined;
    await page.route("**/api/appointments/block", async (route) => {
      submittedPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ message: "1 marcação criada.", appointments: [] }),
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    summary = dialog.getByTestId("manual-booking-summary");
    await expect(summary.getByText("30,00 €", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await dialog.screenshot({ path: "test-results/manual-booking-extras-mobile.png" });
    await dialog.getByRole("button", { name: "Criar marcação" }).click();
    await expect(dialog).not.toBeVisible();
    expect(submittedPayload).toMatchObject({
      isManualBooking: true,
      serviceId: service.id,
      extras: [
        { extraId: travelExtra.id, amountCents: 1000 },
        { extraId: specialExtra.id },
      ],
    });
  });

  test("normalizes money drafts and preserves independent existing and custom service drafts", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAdminPage(page);
    await page.getByRole("button", { name: "Marcação manual" }).click();

    let dialog = page.getByRole("dialog", { name: "Marcação manual" });
    await selectDialogOption(page, dialog, 0, barber.name);
    await selectDialogOption(page, dialog, 1, service.name);
    await dialog.getByLabel("Condições especiais desta marcação").click();

    const existingPrice = dialog.locator("#manual-booking-special-price");
    await expect(existingPrice).toHaveValue("15,00");
    await existingPrice.fill("021");
    await expect(existingPrice).toHaveValue("21");
    await existingPrice.blur();
    await expect(existingPrice).toHaveValue("21,00");
    await existingPrice.fill("12,345");
    await expect(existingPrice).toHaveValue("21,00");

    await dialog.getByLabel(`Selecionar Extra ${travelExtra.name}`).click();
    const variableExtraAmount = dialog.getByLabel(`Valor do Extra ${travelExtra.name}`);
    await variableExtraAmount.fill("0.50");
    await expect(variableExtraAmount).toHaveValue("0,50");
    await variableExtraAmount.fill("0,558");
    await expect(variableExtraAmount).toHaveValue("0,50");
    await variableExtraAmount.fill("");
    await variableExtraAmount.pressSequentially("5,");
    await expect(variableExtraAmount).toHaveValue("5,");
    await variableExtraAmount.pressSequentially("5");
    await variableExtraAmount.blur();
    await expect(variableExtraAmount).toHaveValue("5,50");

    await dialog.getByRole("button", { name: "Serviço personalizado" }).click();
    await dialog.locator("#manual-booking-custom-service").fill("Produção custom draft QA");
    await dialog.locator("#manual-booking-custom-duration").fill("45");
    const customPrice = dialog.locator("#manual-booking-custom-price");
    await customPrice.fill("36");
    await customPrice.blur();
    await expect(customPrice).toHaveValue("36,00");
    await customPrice.fill("1,9999");
    await expect(customPrice).toHaveValue("36,00");

    await dialog.getByRole("button", { name: "Serviço existente" }).click();
    await expect(dialog.getByRole("combobox").nth(1)).toContainText(service.name);
    await expect(dialog.getByText(`${service.duration} min`, { exact: true })).toBeVisible();
    await expect(dialog.getByText("15,00 €", { exact: true }).first()).toBeVisible();
    await expect(existingPrice).toHaveValue("21,00");

    await dialog.getByRole("button", { name: "Serviço personalizado" }).click();
    await expect(dialog.locator("#manual-booking-custom-service")).toHaveValue("Produção custom draft QA");
    await expect(dialog.locator("#manual-booking-custom-duration")).toHaveValue("45");
    await expect(customPrice).toHaveValue("36,00");

    await dialog.getByRole("button", { name: "Serviço existente" }).click();
    await dialog.getByLabel("Nome do cliente", { exact: true }).fill(`Draft payload QA ${Date.now()}`);
    await clickFirstEnabledManualTime(dialog);

    const submittedPayloads: Array<Record<string, unknown>> = [];
    await page.route("**/api/appointments/block", async (route) => {
      submittedPayloads.push(route.request().postDataJSON());
      if (submittedPayloads.length === 1) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ message: "Falha controlada para validar o segundo modo." }),
        });
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ message: "1 marcação criada.", appointments: [] }),
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await dialog.getByRole("button", { name: "Criar marcação" }).click();
    await expect.poll(() => submittedPayloads.length).toBe(1);
    expect(submittedPayloads[0]).toMatchObject({
      serviceId: service.id,
      serviceMode: "existing",
      hasSpecialTerms: true,
      servicePriceCents: 2100,
      extras: [{ extraId: travelExtra.id, amountCents: 550 }],
    });
    expect(submittedPayloads[0]).not.toHaveProperty("customServiceName");
    expect(submittedPayloads[0]).not.toHaveProperty("customDurationMinutes");

    await dialog.getByRole("button", { name: "Serviço personalizado" }).click();
    await expect(dialog.locator("#manual-booking-custom-service")).toHaveValue("Produção custom draft QA");
    await expect(dialog.locator("#manual-booking-custom-duration")).toHaveValue("45");
    await expect(customPrice).toHaveValue("36,00");
    await dialog.getByRole("button", { name: "Criar marcação" }).click();
    await expect(dialog).not.toBeVisible();
    expect(submittedPayloads[1]).toMatchObject({
      serviceId: null,
      serviceMode: "custom",
      hasSpecialTerms: true,
      customServiceName: "Produção custom draft QA",
      customDurationMinutes: 45,
      servicePriceCents: 3600,
      extras: [{ extraId: travelExtra.id, amountCents: 550 }],
    });

    await page.getByRole("button", { name: "Marcação manual" }).click();
    dialog = page.getByRole("dialog", { name: "Marcação manual" });
    await expect(dialog.getByLabel("Condições especiais desta marcação")).not.toBeChecked();
    await expect(dialog.getByRole("combobox").nth(1)).toContainText("Selecione");
    await expect(dialog.getByLabel(`Selecionar Extra ${travelExtra.name}`)).not.toBeChecked();

    await selectDialogOption(page, dialog, 0, barber.name);
    await selectDialogOption(page, dialog, 1, service.name);
    await dialog.getByLabel("Condições especiais desta marcação").click();
    await dialog.getByRole("button", { name: "Serviço personalizado" }).click();
    await dialog.locator("#manual-booking-custom-service").fill("Draft que deve ser limpo");
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Marcação manual" }).click();
    dialog = page.getByRole("dialog", { name: "Marcação manual" });
    await expect(dialog.getByLabel("Condições especiais desta marcação")).not.toBeChecked();
    await expect(dialog.getByRole("combobox").nth(1)).toContainText("Selecione");
  });

  test("uses the central finance engine in dashboard, rankings and the accounting workbook", async ({ request }) => {
    test.setTimeout(120_000);
    const suffix = Date.now();
    const financeBarberResponse = await request.post("/api/barbers", { data: {
      name: `Barbeiro Finance Extras QA ${suffix}`,
      specialty: "Financeiro de Extras",
      isVisible: true,
      serviceIds: [service.id],
      compensationModel: "commission",
      commissionPercent: 40,
    } });
    expect(financeBarberResponse.status(), await financeBarberResponse.text()).toBe(201);
    const financeBarber = await financeBarberResponse.json();

    const createFixedExtra = async (name: string, financialRule: "follow_compensation" | "establishment") => {
      const response = await request.post("/api/admin/extras", { data: {
        name: `${name} ${suffix}`,
        pricingMode: "fixed",
        amountCents: 1000,
        financialRule,
      } });
      expect(response.status(), await response.text()).toBe(201);
      return response.json();
    };
    const followExtra = await createFixedExtra("Extra comissão finance QA", "follow_compensation");
    const establishmentExtra = await createFixedExtra("Extra estabelecimento finance QA", "establishment");

    const createCompleted = async (
      weeksAhead: number,
      extras: Array<{ extraId: number; amountCents?: number }>,
      paymentMethod: "cash" | "card" | "gift" = "cash",
      creationMode: "transition" | "direct" = "transition",
      overrides: Record<string, unknown> = {},
    ) => {
      const startTime = futureThursdayIso(weeksAhead, 10);
      const created = await createManual(request, `Finance Extras ${weeksAhead} ${suffix}`, startTime, {
        barberId: financeBarber.id,
        allowOutsideHours: true,
        extras,
        ...(creationMode === "direct" ? { isAlreadyCompleted: true, paymentMethod } : {}),
        ...overrides,
      });
      expect(created.response.status(), JSON.stringify(created.body)).toBe(201);
      const appointment = created.body.appointments[0];
      if (creationMode === "transition") {
        const completed = await request.patch(`/api/appointments/${appointment.id}/status`, {
          data: { status: "completed", paymentMethod },
        });
        expect(completed.ok(), await completed.text()).toBe(true);
      } else {
        expect(appointment).toMatchObject({ status: "completed", paymentMethod });
      }
      return { appointment, startTime };
    };
    const dashboardFor = async (startTime: string, selectedBarberId = financeBarber.id) => {
      const day = dateKey(startTime);
      const response = await request.get(
        `/api/admin/dashboard?startDate=${day}&endDate=${day}&barberId=${selectedBarberId}`,
      );
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };

    const barberCase = await createCompleted(-260, [{ extraId: travelExtra.id, amountCents: 1000 }]);
    const barberDashboard = await dashboardFor(barberCase.startTime);
    expect(barberDashboard.summary).toMatchObject({
      revenueCents: 2500,
      extrasRevenueCents: 1000,
      barberRevenueCents: 1600,
      establishmentRevenueCents: 900,
      commissionCents: 600,
      chairRentCents: 0,
    });
    expect(barberDashboard.daily).toEqual(expect.arrayContaining([
      expect.objectContaining({ revenueCents: 2500 }),
    ]));
    expect(barberDashboard.barbers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: financeBarber.id, revenueCents: 2500 }),
    ]));
    expect(barberDashboard.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: service.id, count: 1, revenueCents: 1500 }),
    ]));

    const followCase = await createCompleted(-261, [{ extraId: followExtra.id }], "card");
    expect((await dashboardFor(followCase.startTime)).summary).toMatchObject({
      revenueCents: 2500,
      barberRevenueCents: 1000,
      establishmentRevenueCents: 1500,
      commissionCents: 1000,
    });

    const establishmentCase = await createCompleted(-262, [{ extraId: establishmentExtra.id }]);
    expect((await dashboardFor(establishmentCase.startTime)).summary).toMatchObject({
      revenueCents: 2500,
      barberRevenueCents: 600,
      establishmentRevenueCents: 1900,
      commissionCents: 600,
    });

    const multipleCase = await createCompleted(-263, [
      { extraId: travelExtra.id, amountCents: 1000 },
      { extraId: followExtra.id },
      { extraId: establishmentExtra.id },
    ]);
    expect((await dashboardFor(multipleCase.startTime)).summary).toMatchObject({
      revenueCents: 4500,
      extrasRevenueCents: 3000,
      barberRevenueCents: 2000,
      establishmentRevenueCents: 2500,
      commissionCents: 1000,
    });

    const equivalenceExtras = [
      { extraId: travelExtra.id, amountCents: 1000 },
      { extraId: followExtra.id },
      { extraId: establishmentExtra.id },
    ];
    const transitionedEquivalent = await createCompleted(
      -266,
      equivalenceExtras,
      "cash",
      "transition",
      { hasSpecialTerms: true, servicePriceCents: 3000 },
    );
    const directEquivalent = await createCompleted(
      -267,
      equivalenceExtras,
      "cash",
      "direct",
      { hasSpecialTerms: true, servicePriceCents: 3000 },
    );
    const transitionedSummary = (await dashboardFor(transitionedEquivalent.startTime)).summary;
    const directSummary = (await dashboardFor(directEquivalent.startTime)).summary;
    for (const field of [
      "revenueCents",
      "serviceRevenueCents",
      "extrasRevenueCents",
      "barberRevenueCents",
      "establishmentRevenueCents",
      "commissionCents",
      "chairRentCents",
    ]) {
      expect(directSummary[field], `${field} must match normal completion`).toBe(transitionedSummary[field]);
    }

    const createCustomCompleted = async (weeksAhead: number, direct: boolean) => {
      const startTime = futureThursdayIso(weeksAhead, 10);
      const created = await createManual(request, `Custom finance ${weeksAhead} ${suffix}`, startTime, {
        barberId: financeBarber.id,
        serviceId: null,
        serviceMode: "custom",
        hasSpecialTerms: true,
        customServiceName: "Serviço personalizado financeiro",
        customDurationMinutes: 45,
        servicePriceCents: 3000,
        allowOutsideHours: true,
        extras: [{ extraId: travelExtra.id, amountCents: 1000 }],
        ...(direct ? { isAlreadyCompleted: true, paymentMethod: "cash" } : {}),
      });
      expect(created.response.status(), JSON.stringify(created.body)).toBe(201);
      const appointment = created.body.appointments[0];
      if (!direct) {
        const completed = await request.patch(`/api/appointments/${appointment.id}/status`, {
          data: { status: "completed", paymentMethod: "cash" },
        });
        expect(completed.ok(), await completed.text()).toBe(true);
      }
      return { appointment, startTime };
    };
    const transitionedCustom = await createCustomCompleted(-268, false);
    const directCustom = await createCustomCompleted(-269, true);
    expect(directCustom.appointment).toMatchObject({
      serviceId: null,
      durationMinutes: 45,
      serviceNameSnapshot: "Serviço personalizado financeiro",
      servicePriceCentsSnapshot: 3000,
      status: "completed",
      paymentMethod: "cash",
    });
    const transitionedCustomSummary = (await dashboardFor(transitionedCustom.startTime)).summary;
    const directCustomSummary = (await dashboardFor(directCustom.startTime)).summary;
    expect(directCustomSummary).toMatchObject({
      revenueCents: 4000,
      extrasRevenueCents: 1000,
      barberRevenueCents: 2200,
      establishmentRevenueCents: 1800,
      commissionCents: 1200,
    });
    for (const field of [
      "revenueCents",
      "extrasRevenueCents",
      "barberRevenueCents",
      "establishmentRevenueCents",
      "commissionCents",
    ]) {
      expect(directCustomSummary[field], `${field} custom must match normal completion`)
        .toBe(transitionedCustomSummary[field]);
    }

    const multipleDay = dateKey(multipleCase.startTime);
    const multipleExportResponse = await request.get(
      `/api/admin/export?startDate=${multipleDay}&endDate=${multipleDay}&barberId=${financeBarber.id}`,
    );
    expect(multipleExportResponse.ok(), await multipleExportResponse.text()).toBe(true);
    const multipleWorkbook = new ExcelJS.Workbook();
    await multipleWorkbook.xlsx.load(await multipleExportResponse.body());
    const multipleDetail = multipleWorkbook.getWorksheet("Detalhe dos Movimentos")!;
    const multipleHeader = getHeaderRow(multipleDetail, "Data do serviço");
    const multipleHeaders = multipleHeader.values as unknown[];
    const multipleIdColumn = multipleHeaders.indexOf("ID da marcação");
    const multipleExtrasColumn = multipleHeaders.indexOf("Extras");
    const multipleExtrasValueColumn = multipleHeaders.indexOf("Valor extras (€)");
    const multipleTotalColumn = multipleHeaders.indexOf("Valor final (€)");
    let multipleMovement: ExcelJS.Row | undefined;
    multipleDetail.eachRow((row, rowNumber) => {
      if (rowNumber > multipleHeader.number
        && row.getCell(multipleIdColumn).value === multipleCase.appointment.id) multipleMovement = row;
    });
    expect(multipleMovement?.getCell(multipleExtrasColumn).value).toBe(
      `${travelExtra.name} (10,00 €); ${followExtra.name} (10,00 €); ${establishmentExtra.name} (10,00 €)`,
    );
    expect(multipleMovement?.getCell(multipleExtrasValueColumn).value).toBe(30);
    expect(multipleMovement?.getCell(multipleTotalColumn).value).toBe(45);

    const day = dateKey(barberCase.startTime);
    const exportResponse = await request.get(
      `/api/admin/export?startDate=${day}&endDate=${day}&barberId=${financeBarber.id}`,
    );
    expect(exportResponse.ok(), await exportResponse.text()).toBe(true);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exportResponse.body());
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Resumo Financeiro",
      "Detalhe dos Movimentos",
      "Acertos com Barbeiros",
    ]);

    const summary = getSummaryValues(workbook.getWorksheet("Resumo Financeiro")!);
    expect(summary.get("Receita de serviços concluídos")).toBe(15);
    expect(summary.get("Receita de Extras concluídos")).toBe(10);
    expect(summary.get("Receita total concluída")).toBe(25);
    expect(summary.get("Receita realizada")).toBe(25);
    expect(summary.get("Total atribuído aos barbeiros")).toBe(16);
    expect(summary.get("Total atribuído ao estabelecimento")).toBe(9);

    const detail = workbook.getWorksheet("Detalhe dos Movimentos")!;
    const detailHeader = getHeaderRow(detail, "Data do serviço");
    const headers = detailHeader.values as unknown[];
    const idColumn = headers.indexOf("ID da marcação");
    const serviceValueColumn = headers.indexOf("Valor serviço (€)");
    const extrasColumn = headers.indexOf("Extras");
    const extrasValueColumn = headers.indexOf("Valor extras (€)");
    const totalColumn = headers.indexOf("Valor final (€)");
    const receivedColumn = headers.indexOf("Valor recebido (€)");
    const realizedColumn = headers.indexOf("Valor realizado (€)");
    const barberColumn = headers.indexOf("Parte barbeiro (€)");
    const establishmentColumn = headers.indexOf("Parte estabelecimento (€)");
    let movement: ExcelJS.Row | undefined;
    detail.eachRow((row, rowNumber) => {
      if (rowNumber > detailHeader.number && row.getCell(idColumn).value === barberCase.appointment.id) movement = row;
    });
    expect(movement).toBeTruthy();
    expect(movement!.getCell(serviceValueColumn).value).toBe(15);
    expect(movement!.getCell(extrasColumn).value).toBe(`${travelExtra.name} (10,00 €)`);
    expect(movement!.getCell(extrasValueColumn).value).toBe(10);
    expect(movement!.getCell(totalColumn).value).toBe(25);
    expect(movement!.getCell(receivedColumn).value).toBe(25);
    expect(movement!.getCell(realizedColumn).value).toBe(25);
    expect(movement!.getCell(barberColumn).value).toBe(16);
    expect(movement!.getCell(establishmentColumn).value).toBe(9);
    for (const column of [serviceValueColumn, extrasValueColumn, totalColumn, receivedColumn, realizedColumn, barberColumn, establishmentColumn]) {
      expect(typeof movement!.getCell(column).value).toBe("number");
    }

    const settlements = workbook.getWorksheet("Acertos com Barbeiros")!;
    const settlementHeader = getHeaderRow(settlements, "Barbeiro");
    const settlementHeaders = settlementHeader.values as unknown[];
    const settlementBarberColumn = settlementHeaders.indexOf("Barbeiro");
    const settlementBaseColumn = settlementHeaders.indexOf("Base de acerto (€)");
    const settlementCommissionColumn = settlementHeaders.indexOf("Comissões do barbeiro (€)");
    const settlementBarberValueColumn = settlementHeaders.indexOf("Valor do barbeiro (€)");
    const settlementShopValueColumn = settlementHeaders.indexOf("Valor da barbearia (€)");
    let settlement: ExcelJS.Row | undefined;
    settlements.eachRow((row, rowNumber) => {
      if (rowNumber > settlementHeader.number && row.getCell(settlementBarberColumn).value === financeBarber.name) settlement = row;
    });
    expect(settlement!.getCell(settlementBaseColumn).value).toBe(25);
    expect(settlement!.getCell(settlementCommissionColumn).value).toBe(6);
    expect(settlement!.getCell(settlementBarberValueColumn).value).toBe(16);
    expect(settlement!.getCell(settlementShopValueColumn).value).toBe(9);

    const chairBarberResponse = await request.post("/api/barbers", { data: {
      name: `Barbeiro Chair Extras QA ${suffix}`,
      specialty: "Aluguer de cadeira com Extras",
      isVisible: true,
      serviceIds: [service.id],
      compensationModel: "chair_rent",
      chairRentCents: 2500,
      chairRentPeriod: "month",
    } });
    expect(chairBarberResponse.status(), await chairBarberResponse.text()).toBe(201);
    const chairBarber = await chairBarberResponse.json();
    const chairStart = futureThursdayIso(-265, 10);
    const chairCreated = await createManual(request, `Gift chair Extras ${suffix}`, chairStart, {
      barberId: chairBarber.id,
      allowOutsideHours: true,
      extras: [{ extraId: travelExtra.id, amountCents: 1000 }],
    });
    expect(chairCreated.response.status(), JSON.stringify(chairCreated.body)).toBe(201);
    const chairAppointment = chairCreated.body.appointments[0];
    const chairGift = await request.patch(`/api/appointments/${chairAppointment.id}/status`, {
      data: { status: "completed", paymentMethod: "gift" },
    });
    expect(chairGift.ok(), await chairGift.text()).toBe(true);
    expect((await dashboardFor(chairStart, chairBarber.id)).summary).toMatchObject({
      revenueCents: 0,
      extrasRevenueCents: 0,
      barberRevenueCents: -2500,
      establishmentRevenueCents: 2500,
      chairRentCents: 2500,
    });
    const chairDay = dateKey(chairStart);
    const chairExportResponse = await request.get(
      `/api/admin/export?startDate=${chairDay}&endDate=${chairDay}&barberId=${chairBarber.id}`,
    );
    expect(chairExportResponse.ok(), await chairExportResponse.text()).toBe(true);
    const chairWorkbook = new ExcelJS.Workbook();
    await chairWorkbook.xlsx.load(await chairExportResponse.body());
    const chairSummary = getSummaryValues(chairWorkbook.getWorksheet("Resumo Financeiro")!);
    expect(chairSummary.get("Ofertas (valor dos serviços, sem recebimento)")).toBe(15);
    expect(chairSummary.get("Ofertas (valor dos Extras, sem recebimento)")).toBe(10);
    expect(chairSummary.get("Ofertas (valor total, sem recebimento)")).toBe(25);
    expect(chairSummary.get("Receita realizada")).toBe(0);
    const chairSettlements = chairWorkbook.getWorksheet("Acertos com Barbeiros")!;
    const chairSettlementHeader = getHeaderRow(chairSettlements, "Barbeiro");
    const chairHeaders = chairSettlementHeader.values as unknown[];
    const chairRentColumn = chairHeaders.indexOf("Aluguer de cadeira (€)");
    const chairBarberValueColumn = chairHeaders.indexOf("Valor do barbeiro (€)");
    const chairShopValueColumn = chairHeaders.indexOf("Valor da barbearia (€)");
    const chairSettlement = chairSettlements.getRow(chairSettlementHeader.number + 1);
    expect(chairSettlement.getCell(chairRentColumn).value).toBe(25);
    expect(chairSettlement.getCell(chairBarberValueColumn).value).toBe(-25);
    expect(chairSettlement.getCell(chairShopValueColumn).value).toBe(25);

    const directChairStart = futureThursdayIso(-275, 10);
    const directChairCreated = await createManual(request, `Gift chair direto Extras ${suffix}`, directChairStart, {
      barberId: chairBarber.id,
      allowOutsideHours: true,
      extras: [{ extraId: travelExtra.id, amountCents: 1000 }],
      isAlreadyCompleted: true,
      paymentMethod: "gift",
    });
    expect(directChairCreated.response.status(), JSON.stringify(directChairCreated.body)).toBe(201);
    expect(directChairCreated.body.appointments[0]).toMatchObject({
      status: "completed",
      paymentMethod: "gift",
    });
    expect((await dashboardFor(directChairStart, chairBarber.id)).summary).toMatchObject({
      revenueCents: 0,
      extrasRevenueCents: 0,
      barberRevenueCents: -2500,
      establishmentRevenueCents: 2500,
      chairRentCents: 2500,
    });

    const stateDay = futureThursdayIso(-264, 10);
    const stateAppointments: any[] = [];
    for (let index = 0; index < 6; index += 1) {
      const startTime = futureThursdayIso(-264, 10 + index);
      const created = await createManual(request, `Estado finance ${index} ${suffix}`, startTime, {
        barberId: financeBarber.id,
        allowOutsideHours: true,
        extras: [{ extraId: travelExtra.id, amountCents: 1000 }],
      });
      expect(created.response.status(), JSON.stringify(created.body)).toBe(201);
      stateAppointments.push(created.body.appointments[0]);
    }
    expect((await request.patch(`/api/appointments/${stateAppointments[0].id}`, {
      data: { status: "booked" },
    })).ok()).toBe(true);
    expect((await request.patch(`/api/appointments/${stateAppointments[1].id}/status`, {
      data: { status: "completed", paymentMethod: "cash" },
    })).ok()).toBe(true);
    expect((await request.patch(`/api/appointments/${stateAppointments[2].id}/status`, {
      data: { status: "completed", paymentMethod: "gift" },
    })).ok()).toBe(true);
    for (const [index, status] of [[3, "cancelled"], [4, "late_cancelled"], [5, "no_show"]] as const) {
      const response = await request.patch(`/api/appointments/${stateAppointments[index].id}`, { data: { status } });
      expect(response.ok(), await response.text()).toBe(true);
    }
    const stateDashboard = await dashboardFor(stateDay);
    expect(stateDashboard.summary).toMatchObject({
      revenueCents: 2500,
      projectedRevenueCents: 2500,
      extrasRevenueCents: 1000,
      barberRevenueCents: 1600,
      establishmentRevenueCents: 900,
    });
    expect(stateDashboard.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: service.id, count: 6, revenueCents: 1500 }),
    ]));
    expect((await request.patch(`/api/barbers/${chairBarber.id}`, { data: { isVisible: false } })).ok()).toBe(true);
    expect((await request.patch(`/api/barbers/${financeBarber.id}`, { data: { isVisible: false } })).ok()).toBe(true);
  });
});
