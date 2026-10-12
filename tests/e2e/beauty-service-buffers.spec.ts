import { expect, test, type APIRequestContext } from "@playwright/test";

const adminPassword = "Playwright-Test-Admin-2026!";

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: adminPassword },
  });
  expect(response.status(), await response.text()).toBe(200);
}

function futureStart(daysAhead: number, hour: number, minute = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + daysAhead);
  value.setUTCHours(hour, minute, 0, 0);
  return value;
}

const openEveryDay = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  startTime: "08:00",
  endTime: "20:00",
  isOpen: true,
}));

const workingEveryDay = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  startTime: "08:00",
  endTime: "20:00",
  isWorking: true,
}));

test.describe.serial("Beauty service-first and operational service buffers", () => {
  let service: any;
  let eligibleProfessional: any;
  let ineligibleProfessional: any;

  test("applies buffers to public/manual/edit/reschedule/recurrence and preserves snapshots", async ({ request }) => {
    await loginAdmin(request);
    expect((await request.patch("/api/shop/availability", { data: openEveryDay })).ok()).toBe(true);

    const suffix = Date.now();
    const serviceResponse = await request.post("/api/services", { data: {
      name: `Tratamento buffer ${suffix}`,
      description: "Serviço Beauty com preparação e limpeza",
      price: 4500,
      duration: 60,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      isVisible: true,
    } });
    expect(serviceResponse.status(), await serviceResponse.text()).toBe(201);
    service = await serviceResponse.json();
    expect(service).toMatchObject({
      duration: 60,
      price: 4500,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
    });

    const professionalResponse = await request.post("/api/barbers", { data: {
      name: `Profissional Beauty ${suffix}`,
      specialty: "Tratamentos",
      color: "#8B5CF6",
      isVisible: true,
      serviceIds: [service.id],
    } });
    expect(professionalResponse.status(), await professionalResponse.text()).toBe(201);
    eligibleProfessional = await professionalResponse.json();
    expect((await request.patch(`/api/barbers/${eligibleProfessional.id}/availability`, { data: workingEveryDay })).ok()).toBe(true);

    const ineligibleResponse = await request.post("/api/barbers", { data: {
      name: `Profissional sem tratamento ${suffix}`,
      specialty: "Outra área",
      color: "#64748B",
      isVisible: true,
      serviceIds: [],
    } });
    expect(ineligibleResponse.status(), await ineligibleResponse.text()).toBe(201);
    ineligibleProfessional = await ineligibleResponse.json();
    expect((await request.patch(`/api/barbers/${ineligibleProfessional.id}/availability`, { data: workingEveryDay })).ok()).toBe(true);

    const firstStart = futureStart(60, 10);
    const firstResponse = await request.post("/api/appointments", { data: {
      barberId: eligibleProfessional.id,
      serviceId: service.id,
      startTime: firstStart.toISOString(),
      customerName: "Cliente buffer inicial",
      customerPhone: "+351912640001",
    } });
    expect(firstResponse.status(), await firstResponse.text()).toBe(201);
    const first = await firstResponse.json();
    expect(first).toMatchObject({
      durationMinutes: 60,
      bufferBeforeMinutesSnapshot: 15,
      bufferAfterMinutesSnapshot: 15,
    });

    const conflictResponse = await request.post("/api/appointments", { data: {
      barberId: eligibleProfessional.id,
      serviceId: service.id,
      startTime: new Date(firstStart.getTime() + 60 * 60_000).toISOString(),
      customerName: "Conflito apenas operacional",
      customerPhone: "+351912640002",
    } });
    expect(conflictResponse.status()).toBe(409);

    const boundaryResponse = await request.post("/api/appointments", { data: {
      barberId: eligibleProfessional.id,
      serviceId: service.id,
      startTime: new Date(firstStart.getTime() + 90 * 60_000).toISOString(),
      customerName: "Limite operacional exato",
      customerPhone: "+351912640003",
    } });
    expect(boundaryResponse.status(), await boundaryResponse.text()).toBe(201);

    const ineligibleResponseBooking = await request.post("/api/appointments", { data: {
      barberId: ineligibleProfessional.id,
      serviceId: service.id,
      startTime: futureStart(61, 10).toISOString(),
      customerName: "Profissional incompatível",
      customerPhone: "+351912640004",
    } });
    expect(ineligibleResponseBooking.status()).toBe(400);

    const anyProfessionalResponse = await request.post("/api/appointments", { data: {
      barberId: 0,
      serviceId: service.id,
      startTime: futureStart(62, 10).toISOString(),
      customerName: "Sem preferência",
      customerPhone: "+351912640005",
    } });
    expect(anyProfessionalResponse.status(), await anyProfessionalResponse.text()).toBe(201);
    expect(await anyProfessionalResponse.json()).toMatchObject({ barberId: eligibleProfessional.id });

    const updateServiceResponse = await request.patch(`/api/services/${service.id}`, { data: {
      bufferBeforeMinutes: 20,
      bufferAfterMinutes: 25,
    } });
    expect(updateServiceResponse.status(), await updateServiceResponse.text()).toBe(200);

    const editedStart = futureStart(63, 13);
    const editResponse = await request.patch(`/api/appointments/${first.id}`, { data: {
      startTime: editedStart.toISOString(),
    } });
    expect(editResponse.status(), await editResponse.text()).toBe(200);
    expect(await editResponse.json()).toMatchObject({
      bufferBeforeMinutesSnapshot: 15,
      bufferAfterMinutesSnapshot: 15,
    });

    const rescheduledStart = futureStart(64, 14);
    const rescheduleResponse = await request.post(`/api/appointments/reschedule/${first.cancelToken}`, { data: {
      startTime: rescheduledStart.toISOString(),
    } });
    expect(rescheduleResponse.status(), await rescheduleResponse.text()).toBe(200);
    expect(await rescheduleResponse.json()).toMatchObject({
      bufferBeforeMinutesSnapshot: 15,
      bufferAfterMinutesSnapshot: 15,
    });

    const manualResponse = await request.post("/api/appointments/block", { data: {
      barberId: eligibleProfessional.id,
      serviceId: service.id,
      serviceMode: "existing",
      startTime: futureStart(65, 6).toISOString(),
      name: "Manual Beauty fora de horas",
      phone: "+351912640006",
      customerEmail: "",
      isManualBooking: true,
      isRecurring: false,
      allowOutsideHours: true,
    } });
    expect(manualResponse.status(), await manualResponse.text()).toBe(201);
    expect((await manualResponse.json()).appointments[0]).toMatchObject({
      bufferBeforeMinutesSnapshot: 20,
      bufferAfterMinutesSnapshot: 25,
      manualOutsideHours: true,
    });

    const recurringResponse = await request.post("/api/appointments/block", { data: {
      barberId: eligibleProfessional.id,
      serviceId: service.id,
      serviceMode: "existing",
      startTime: futureStart(70, 12).toISOString(),
      name: "Recorrência Beauty",
      phone: "+351912640007",
      customerEmail: "",
      isManualBooking: true,
      isRecurring: true,
      recurringWeeks: 1,
      recurringMonths: 1,
      allowOutsideHours: true,
    } });
    expect(recurringResponse.status(), await recurringResponse.text()).toBe(201);
    const recurringAppointments = (await recurringResponse.json()).appointments;
    expect(recurringAppointments.length).toBeGreaterThan(1);
    expect(recurringAppointments.every((appointment: any) =>
      appointment.bufferBeforeMinutesSnapshot === 20
      && appointment.bufferAfterMinutesSnapshot === 25)).toBe(true);
  });

  test("renders service-first responsively and filters incompatible professionals", async ({ page }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 820, height: 1180 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/booking");
      await expect(page.getByRole("heading", { name: "Selecione o Serviço" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    }

    await page.getByText(service.name, { exact: true }).click();
    await page.getByRole("button", { name: "Seguinte" }).click();
    await expect(page.getByRole("heading", { name: "Selecione o profissional" })).toBeVisible();
    await expect(page.getByText(eligibleProfessional.name, { exact: true })).toBeVisible();
    await expect(page.getByText(ineligibleProfessional.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText("Qualquer profissional disponível", { exact: true })).toBeVisible();
  });
});
