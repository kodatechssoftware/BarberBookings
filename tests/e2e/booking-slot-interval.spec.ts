import { expect, test } from "@playwright/test";

function futureThursdayIso(weeksAhead: number, hour: number, minute = 0) {
  const date = new Date();
  const daysUntilThursday = (4 - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilThursday + weeksAhead * 7);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

test("60-minute runtime config governs public, Admin, reschedule and recurring temporal choices", async ({ page, request }) => {
  const configResponse = await request.get("/api/multi-location/config");
  expect(configResponse.ok(), await configResponse.text()).toBe(true);
  expect(await configResponse.json()).toMatchObject({
    enabled: false,
    bookingSlotIntervalMinutes: 60,
  });

  const [barbersResponse, servicesResponse] = await Promise.all([
    request.get("/api/barbers"),
    request.get("/api/services"),
  ]);
  const [barber] = await barbersResponse.json();
  const [service] = await servicesResponse.json();
  expect(barber?.id).toBeTruthy();
  expect(service?.id).toBeTruthy();

  const uiDate = futureThursdayIso(8, 15).slice(0, 10);
  await page.goto(`/book?barberId=${barber.id}&serviceId=${service.id}&date=${uiDate}&time=15:30`);
  await expect(page.getByRole("heading", { name: "Horários disponíveis", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "15:30h", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /15:00h|16:00h/, exact: true }).first()).toBeVisible();

  const invalidPublic = await request.post("/api/appointments", { data: {
    barberId: barber.id,
    serviceId: service.id,
    startTime: futureThursdayIso(3, 15, 30),
    customerName: "Intervalo público inválido",
    customerPhone: "+351912610001",
    customerEmail: "intervalo-invalido@example.test",
  } });
  expect(invalidPublic.status(), await invalidPublic.text()).toBe(400);
  expect(await invalidPublic.json()).toMatchObject({ field: "startTime" });

  const validPublic = await request.post("/api/appointments", { data: {
    barberId: barber.id,
    serviceId: service.id,
    startTime: futureThursdayIso(3, 15),
    customerName: "Intervalo público válido",
    customerPhone: "+351912610002",
    customerEmail: "intervalo-valido@example.test",
  } });
  expect(validPublic.status(), await validPublic.text()).toBe(201);
  const publicAppointment = await validPublic.json();

  const invalidReschedule = await request.post(`/api/appointments/reschedule/${publicAppointment.cancelToken}`, {
    data: { startTime: futureThursdayIso(4, 15, 30) },
  });
  expect(invalidReschedule.status(), await invalidReschedule.text()).toBe(400);

  const validRescheduleStart = futureThursdayIso(4, 15);
  const validReschedule = await request.post(`/api/appointments/reschedule/${publicAppointment.cancelToken}`, {
    data: { startTime: validRescheduleStart },
  });
  expect(validReschedule.status(), await validReschedule.text()).toBe(200);

  const login = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(login.ok(), await login.text()).toBe(true);

  const invalidManual = await request.post("/api/appointments/block", { data: {
    barberId: barber.id,
    serviceId: service.id,
    startTime: futureThursdayIso(5, 16, 30),
    name: "Manual inválida",
    phone: "+351912610003",
    customerEmail: "manual-invalida@example.test",
    isManualBooking: true,
    allowOutsideHours: false,
  } });
  expect(invalidManual.status(), await invalidManual.text()).toBe(400);

  const validManual = await request.post("/api/appointments/block", { data: {
    barberId: barber.id,
    serviceId: service.id,
    startTime: futureThursdayIso(5, 16),
    name: "Manual válida",
    phone: "+351912610004",
    customerEmail: "manual-valida@example.test",
    isManualBooking: true,
    allowOutsideHours: false,
  } });
  expect(validManual.status(), await validManual.text()).toBe(201);

  const invalidRecurring = await request.post("/api/appointments/block", { data: {
    barberId: barber.id,
    serviceId: service.id,
    startTime: futureThursdayIso(6, 17, 30),
    name: "Recorrência inválida",
    phone: "+351912610005",
    customerEmail: "recorrencia-invalida@example.test",
    isManualBooking: true,
    isRecurring: true,
    recurringWeeks: 2,
    recurringMonths: 1,
    allowOutsideHours: false,
  } });
  expect(invalidRecurring.status(), await invalidRecurring.text()).toBe(400);

  const validRecurring = await request.post("/api/appointments/block", { data: {
    barberId: barber.id,
    serviceId: service.id,
    startTime: futureThursdayIso(6, 17),
    name: "Recorrência válida",
    phone: "+351912610006",
    customerEmail: "recorrencia-valida@example.test",
    isManualBooking: true,
    isRecurring: true,
    recurringWeeks: 2,
    recurringMonths: 1,
    allowOutsideHours: false,
  } });
  expect(validRecurring.status(), await validRecurring.text()).toBe(201);

  const sameTimeUpdate = await request.patch(`/api/appointments/${publicAppointment.id}`, { data: {
    startTime: validRescheduleStart,
    barberId: barber.id,
    serviceId: service.id,
  } });
  expect(sameTimeUpdate.status(), await sameTimeUpdate.text()).toBe(200);

  const invalidAdminMove = await request.patch(`/api/appointments/${publicAppointment.id}`, { data: {
    startTime: futureThursdayIso(7, 15, 30),
  } });
  expect(invalidAdminMove.status(), await invalidAdminMove.text()).toBe(400);

  const cancellation = await request.patch(`/api/appointments/${publicAppointment.id}/status`, { data: {
    status: "cancelled",
    expectedStatus: "booked",
  } });
  expect(cancellation.status(), await cancellation.text()).toBe(200);
});
