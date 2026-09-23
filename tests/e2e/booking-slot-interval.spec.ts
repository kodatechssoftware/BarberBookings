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

  const categoryLogin = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(categoryLogin.ok(), await categoryLogin.text()).toBe(true);

  const createCategory = async (name: string) => {
    const response = await request.post("/api/service-categories", { data: { name } });
    expect(response.status(), await response.text()).toBe(201);
    return response.json();
  };
  const createService = async (name: string, categoryId: number | null) => {
    const response = await request.post("/api/services", {
      data: {
        name,
        description: `${name} descrição`,
        price: 1500,
        duration: 30,
        isVisible: true,
        categoryId,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return response.json();
  };
  const createBarber = async (name: string, serviceIds: number[]) => {
    const response = await request.post("/api/barbers", {
      data: {
        name,
        specialty: "Categorias QA",
        bio: "Teste de categorias no Booking",
        color: "#4f46e5",
        isVisible: true,
        serviceIds,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return response.json();
  };

  const categoryA = await createCategory("Categoria A booking QA");
  const categoryB = await createCategory("Categoria B booking QA");
  const service1 = await createService("Serviço 1 categorias QA", categoryA.id);
  const service = await createService("Serviço 2 categorias QA", categoryA.id);
  const service3 = await createService("Serviço 3 categorias QA", categoryB.id);
  const uncategorizedService = await createService("Serviço 4 categorias QA", null);

  await page.goto("/admin");
  await page.getByPlaceholder("Introduza o email ou nome de utilizador").fill("admin");
  await page.locator('input[type="password"]').fill("Playwright-Test-Admin-2026!");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("tab", { name: "Serviços" }).click();
  const unassignedServiceCard = page.getByTestId(`admin-service-card-${service.id}`);
  await expect(unassignedServiceCard.getByText("Para este serviço aparecer nas marcações online,", { exact: false })).toBeVisible();

  await createBarber("Barbeiro categorias completas QA", [service1.id, service.id, service3.id, uncategorizedService.id]);
  const barber = await createBarber("Barbeiro categorias parciais QA", [service1.id, service.id, uncategorizedService.id]);

  await page.reload();
  await page.getByRole("tab", { name: "Serviços" }).click();
  const assignedServiceCard = page.getByTestId(`admin-service-card-${service.id}`);
  await expect(assignedServiceCard.getByText("Para este serviço aparecer nas marcações online,", { exact: false })).toHaveCount(0);

  const catalogue = await (await request.get("/api/services")).json();
  expect(catalogue.find((item: any) => item.id === service.id)).toMatchObject({
    categoryId: categoryA.id,
    category: { id: categoryA.id, name: "Categoria A booking QA" },
  });
  expect(catalogue.find((item: any) => item.id === service3.id)).toMatchObject({
    categoryId: categoryB.id,
    category: { id: categoryB.id, name: "Categoria B booking QA" },
  });
  expect(catalogue.find((item: any) => item.id === uncategorizedService.id)).not.toHaveProperty("category");

  await page.goto("/");
  const homeServices = page.locator("#services");
  await expect(homeServices.getByRole("heading", { name: categoryA.name, exact: true })).toBeVisible();
  await expect(homeServices.getByRole("heading", { name: categoryB.name, exact: true })).toBeVisible();
  await expect(homeServices.getByRole("heading", { name: "Outros serviços", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Marcar agora", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Seleciona o barbeiro" })).toBeVisible();
  await page.getByRole("heading", { name: "Sem preferência", exact: true }).click();
  await page.getByRole("button", { name: "Seguinte" }).click();
  await expect(page.getByRole("heading", { name: "Selecione o Serviço" })).toBeVisible();
  await expect(page.getByRole("heading", { name: categoryA.name, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: categoryB.name, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Outros serviços", exact: true })).toBeVisible();

  await page.goto("/book");
  await page.getByRole("heading", { name: barber.name, exact: true }).click();
  await page.getByRole("button", { name: "Seguinte" }).click();
  await expect(page.getByRole("heading", { name: categoryA.name, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: categoryB.name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: service3.name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Outros serviços", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: uncategorizedService.name, exact: true })).toBeVisible();
  await page.getByRole("heading", { name: service.name, exact: true }).click();
  await page.getByRole("button", { name: "Seguinte" }).click();
  await expect(page.getByRole("heading", { name: "Selecione a Data" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^\d{2}:(15|30|45)h$/ })).toHaveCount(0);
  const firstHourlySlot = page.locator("button:not([disabled])").filter({ hasText: /^\d{2}:00h$/ }).first();
  await expect(firstHourlySlot).toBeVisible();
  await firstHourlySlot.click();
  await page.getByRole("button", { name: "Seguinte" }).click();
  await expect(page.getByText("Resumo da Marcação")).toBeVisible();
  await page.getByPlaceholder("O seu nome").fill("Categorias e intervalo 60 QA");
  await page.getByPlaceholder("912 345 678").fill("912610000");
  await page.getByPlaceholder("exemplo@email.com").fill("categorias-intervalo@example.test");
  const categorizedBookingResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/appointments") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirmar" }).click();
  const categorizedBooking = await categorizedBookingResponse;
  expect(categorizedBooking.status(), await categorizedBooking.text()).toBe(201);
  expect(await categorizedBooking.json()).toMatchObject({ serviceId: service.id, barberId: barber.id });
  await expect(page.getByRole("heading", { name: "Marcação Confirmada!" })).toBeVisible();

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
