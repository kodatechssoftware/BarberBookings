import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

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
    expect(outside.body.appointments[0]).toMatchObject({ manualOutsideHours: true });
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

  test("keeps public booking unaware of injected Extras", async ({ request }) => {
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
});
