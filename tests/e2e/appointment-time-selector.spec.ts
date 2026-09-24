import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function futureThursdayLocalIso(weeksAhead: number, hour: number, minute: number) {
  const date = new Date();
  const daysUntilThursday = (4 - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilThursday + weeksAhead * 7);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

async function loginAdminRequest(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function loginAdmin(page: Page) {
  await page.goto("/admin");
  await page.getByPlaceholder("Introduza o email ou nome de utilizador").fill("admin");
  await page.locator('input[type="password"]').fill("Playwright-Test-Admin-2026!");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
}

async function openAppointmentEditor(page: Page, customerName: string) {
  await page.getByRole("button", {
    name: new RegExp(`Abrir detalhes da marca..o de ${customerName}`),
  }).click();
  const detailsDialog = page.getByRole("dialog", { name: /Detalhes da marca/ });
  await expect(detailsDialog).toBeVisible();
  await detailsDialog.getByRole("button", { name: "Editar", exact: true }).click();
  const editDialog = page.getByRole("dialog", { name: "Editar marcação" });
  await expect(editDialog).toBeVisible();
  return { detailsDialog, editDialog };
}

test("Admin time selector preserves an off-grid current time and offers only the configured grid", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  await loginAdminRequest(request);
  const [barbersResponse, servicesResponse] = await Promise.all([
    request.get("/api/barbers?includeHidden=true"),
    request.get("/api/services?includeHidden=true"),
  ]);
  expect(barbersResponse.ok(), await barbersResponse.text()).toBe(true);
  expect(servicesResponse.ok(), await servicesResponse.text()).toBe(true);
  const barbers = await barbersResponse.json();
  const services = await servicesResponse.json();
  const barber = barbers.find((candidate: any) => candidate.isVisible !== false);
  const service = services.find((candidate: any) => candidate.isVisible !== false
    && (!Array.isArray(barber?.serviceIds)
      || barber.serviceIds.length === 0
      || barber.serviceIds.includes(candidate.id)));
  expect(barber).toBeTruthy();
  expect(service).toBeTruthy();

  const timestamp = Date.now();
  const alignedCustomer = `Hora alinhada QA ${timestamp}`;
  const historicalCustomer = `Hora histórica QA ${timestamp}`;
  const alignedStart = futureThursdayLocalIso(9, 16, 0);
  const historicalStart = futureThursdayLocalIso(10, 16, 30);
  let alignedAppointment: any;
  let historicalAppointment: any;

  try {
    for (const booking of [
      { name: alignedCustomer, phone: "+351912696111", startTime: alignedStart },
      { name: historicalCustomer, phone: "+351912696112", startTime: historicalStart },
    ]) {
      const response = await request.post("/api/appointments/block", { data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: booking.startTime,
        name: booking.name,
        phone: booking.phone,
        customerEmail: "appointment-time-selector@example.test",
        isManualBooking: true,
        allowOutsideHours: false,
      } });
      expect(response.status(), await response.text()).toBe(201);
    }

    const appointmentsResponse = await request.get("/api/appointments");
    expect(appointmentsResponse.ok(), await appointmentsResponse.text()).toBe(true);
    const appointments = await appointmentsResponse.json();
    alignedAppointment = appointments.find((appointment: any) => appointment.customerName === alignedCustomer);
    historicalAppointment = appointments.find((appointment: any) => appointment.customerName === historicalCustomer);
    expect(alignedAppointment).toBeTruthy();
    expect(historicalAppointment).toBeTruthy();

    await page.route("**/api/multi-location/config", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: false, maxLocations: 1, bookingSlotIntervalMinutes: 60 }),
      });
    });
    await loginAdmin(page);

    await page.getByRole("tab", { name: "Serviços" }).click();
    await expect(page.getByRole("button", { name: "Gerir categorias", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Adicionar Serviço", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Gerir categorias", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Gerir categorias" })).toBeVisible();
    await page.getByRole("dialog", { name: "Gerir categorias" })
      .getByRole("button", { name: "Close" }).click();

    await page.getByRole("tab", { name: /Marca/ }).click();
    await page.getByRole("button", { name: /Pr.ximas/ }).click();

    let { detailsDialog, editDialog } = await openAppointmentEditor(page, alignedCustomer);
    let timeSelect = editDialog.getByRole("combobox", { name: "Hora" });
    await expect(timeSelect).toHaveText("16:00");
    await timeSelect.click();
    await expect(page.getByRole("option", { name: "15:00", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "16:00", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "17:00", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "16:15", exact: true })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "16:30", exact: true })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "16:45", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await editDialog.getByRole("button", { name: "Close" }).click();
    await detailsDialog.getByRole("button", { name: "Close" }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    ({ detailsDialog, editDialog } = await openAppointmentEditor(page, historicalCustomer));
    timeSelect = editDialog.getByRole("combobox", { name: "Hora" });
    await expect(timeSelect).toHaveText("16:30 — Hora atual");
    await timeSelect.click();
    const timeListbox = page.getByRole("listbox");
    const timeListboxBox = await timeListbox.boundingBox();
    expect(timeListboxBox).not.toBeNull();
    expect(timeListboxBox!.x).toBeGreaterThanOrEqual(0);
    expect(timeListboxBox!.x + timeListboxBox!.width).toBeLessThanOrEqual(390);
    expect(timeListboxBox!.y + timeListboxBox!.height).toBeLessThanOrEqual(844);
    await expect(page.getByRole("option", { name: "16:00", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "16:30 — Hora atual", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "17:00", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "16:30", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await editDialog.getByRole("button", { name: "Close" }).click();

    let latestAppointments = await (await request.get("/api/appointments")).json();
    expect(latestAppointments.find((item: any) => item.id === historicalAppointment.id)?.startTime)
      .toBe(historicalAppointment.startTime);

    await detailsDialog.getByRole("button", { name: "Editar", exact: true }).click();
    editDialog = page.getByRole("dialog", { name: "Editar marcação" });
    const unchangedUpdate = page.waitForResponse((response) =>
      response.url().endsWith(`/api/appointments/${historicalAppointment.id}`)
      && response.request().method() === "PATCH",
    );
    await editDialog.getByRole("button", { name: "Guardar alterações" }).click();
    expect((await unchangedUpdate).status()).toBe(200);
    latestAppointments = await (await request.get("/api/appointments")).json();
    expect(latestAppointments.find((item: any) => item.id === historicalAppointment.id)?.startTime)
      .toBe(historicalAppointment.startTime);

    await detailsDialog.getByRole("button", { name: "Close" }).click();
    ({ editDialog } = await openAppointmentEditor(page, historicalCustomer));
    await editDialog.getByRole("combobox", { name: "Hora" }).click();
    await page.getByRole("option", { name: "17:00", exact: true }).click();
    const changedUpdate = page.waitForResponse((response) =>
      response.url().endsWith(`/api/appointments/${historicalAppointment.id}`)
      && response.request().method() === "PATCH",
    );
    await editDialog.getByRole("button", { name: "Guardar alterações" }).click();
    const changedResponse = await changedUpdate;
    expect(changedResponse.status()).toBe(200);
    const submittedPayload = changedResponse.request().postDataJSON();
    const expectedStart = new Date(historicalStart);
    expectedStart.setHours(17, 0, 0, 0);
    expect(submittedPayload.startTime).toBe(expectedStart.toISOString());
    latestAppointments = await (await request.get("/api/appointments")).json();
    expect(latestAppointments.find((item: any) => item.id === historicalAppointment.id)?.startTime)
      .toBe(expectedStart.toISOString());
  } finally {
    await Promise.all([alignedAppointment, historicalAppointment]
      .filter(Boolean)
      .map((appointment) => request.patch(`/api/appointments/${appointment.id}/status`, {
        data: { status: "cancelled" },
      })));
  }
});
