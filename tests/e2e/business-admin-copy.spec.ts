import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { resolveBusinessRuntimeConfig } from "../../server/business-runtime-config";

const beautyRuntimeConfig = resolveBusinessRuntimeConfig({
  BUSINESS_VERTICAL: "beauty",
  MULTI_LOCATION_ENABLED: "false",
}, { productionDeployment: false }).config;

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok()).toBe(true);
}

async function mockDashboardAndReports(page: Page) {
  await page.route("**/api/admin/audit-logs**", async (route) => {
    await route.fulfill({
      json: [{
        id: 101,
        action: "barber.services_updated",
        actorType: "barber",
        actorName: "Bruno Santos",
        summary: "Serviços do barbeiro atualizados: Bruno Santos",
        createdAt: "2026-10-19T10:00:00.000Z",
      }],
    });
  });
  await page.route("**/api/admin/dashboard?**", async (route) => {
    await route.fulfill({
      json: {
        range: { startDate: "2026-10-01", endDate: "2026-10-30", days: 30, barberId: "all" },
        summary: {
          appointments: 4,
          completed: 2,
          booked: 2,
          cancellations: 0,
          noShows: 0,
          revenueCents: 5000,
          nominalCompletedCents: 5000,
          receivedCents: 5000,
          cashCents: 2500,
          cardCents: 2500,
          voucherCents: 0,
          giftCents: 0,
          pendingPaymentCents: 0,
          projectedRevenueCents: 4000,
          extrasRevenueCents: 0,
          barberRevenueCents: 2500,
          establishmentRevenueCents: 2500,
          commissionCents: 2500,
          chairRentCents: 0,
          businessExpensesIncluded: true,
          businessExpensesCents: 750,
          establishmentResultCents: 1750,
          nominalServiceRevenueCents: 4500,
          nominalExtrasRevenueCents: 500,
          directCostCents: 400,
          directMarginCents: 4600,
          averageTicketCents: 2500,
          completionRate: 50,
          noShowRate: 0,
          upcomingWeek: 2,
          inactiveCustomers: 0,
          busiestHour: "10:00",
        },
        daily: [],
        barbers: [{
          id: 1,
          name: "Ana",
          appointments: 4,
          completed: 2,
          booked: 2,
          noShows: 0,
          revenueCents: 5000,
        }],
        services: [{ key: "1", id: 1, name: "Tratamento", count: 4, revenueCents: 5000 }],
        inactiveCustomers: [],
      },
    });
  });
  await page.route("**/api/admin/export/barbers?**", async (route) => {
    await route.fulfill({ json: { active: [{ id: 1, name: "Ana" }], historical: [] } });
  });
  await page.route("**/api/admin/expenses?**", async (route) => {
    await route.fulfill({ json: [] });
  });
}

test("Barber Admin and Agenda preserve the existing copy", async ({ page }) => {
  await mockDashboardAndReports(page);
  await loginAdmin(page.request);
  await page.goto("/admin");

  await expect(page.getByLabel("Filtrar barbeiro")).toBeVisible();
  await expect(page.getByText("Barbeiro mais ocupado", { exact: true })).toBeVisible();
  await expect(page.getByText("Parte dos barbeiros", { exact: true })).toBeVisible();
  await expect(page.getByTestId("dashboard-establishment-result")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-direct-margin")).toHaveCount(0);
  await expect(page.getByLabel("Período", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mostrar atividade recente" }).click();
  await expect(page.getByText("Serviços do barbeiro atualizados: Bruno Santos", { exact: true })).toBeVisible();
  await expect(page.getByText(/Barbeiro: Bruno Santos/)).toBeVisible();

  await page.getByRole("tab", { name: "Relatórios", exact: true }).click();
  await expect(page.getByText("Exportar Relatório Excel", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Selecione o barbeiro")).toBeVisible();
  await expect(page.getByText("Despesas da Barbearia", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Equipa", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Equipa de Barbeiros" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Adicionar Barbeiro" })).toBeVisible();

  await page.getByRole("tab", { name: "Serviços", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Serviços Disponíveis" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Adicionar Serviço" })).toBeVisible();
  await page.getByRole("button", { name: "Gerir categorias", exact: true }).click();
  const categoriesDialog = page.getByRole("dialog", { name: "Gerir categorias" });
  await expect(categoriesDialog.getByLabel("Nome da nova categoria")).toBeVisible();
  await expect(categoriesDialog.getByRole("button", { name: "Criar categoria" })).toBeVisible();
  await categoriesDialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("tab", { name: "Horário", exact: true }).click();
  await expect(page.getByText("Horário base da barbearia", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar horário" }).first()).toBeVisible();
  await expect(page.getByLabel("Barbearia aberta à Segunda")).toBeVisible();
});

test("Beauty Admin and Agenda use neutral copy on mobile", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/runtime-config", async (route) => {
    await route.fulfill({ json: beautyRuntimeConfig });
  });
  await page.route("**/api/multi-location/config", async (route) => {
    await route.fulfill({
      json: { enabled: true, maxLocations: 4, bookingSlotIntervalMinutes: 30 },
    });
  });
  await page.route("**/api/admin/available-barbers", async (route) => {
    await route.fulfill({ json: [{ id: 999, name: "Profissional disponível", specialty: "Bem-estar" }] });
  });
  await page.route("**/api/admin/services/available", async (route) => {
    await route.fulfill({
      json: [{ id: 999, name: "Tratamento", price: 2500, duration: 45, basePrice: 2500, baseDuration: 45 }],
    });
  });
  await mockDashboardAndReports(page);
  await loginAdmin(page.request);
  await page.goto("/admin");

  await expect(page.getByLabel("Filtrar profissional")).toBeVisible();
  await expect(page.getByText("Profissional mais ocupado", { exact: true })).toBeVisible();
  await expect(page.getByText("Parte dos profissionais", { exact: true })).toBeVisible();
  await expect(page.getByTestId("dashboard-establishment-result")).toContainText(
    "Resultado do estabelecimento após profissionais e despesas",
  );
  await expect(page.getByTestId("dashboard-establishment-result")).toContainText("7,50 €");
  await expect(page.getByTestId("dashboard-establishment-result")).toContainText("17,50 €");
  await expect(page.getByTestId("dashboard-direct-margin")).toContainText("Margem analítica dos serviços");
  await expect(page.getByTestId("dashboard-direct-margin")).toContainText("46,00 €");
  await expect(page.getByLabel("Profissional", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mostrar atividade recente" }).click();
  await expect(page.getByText("Serviços do profissional atualizados: Bruno Santos", { exact: true })).toBeVisible();
  await expect(page.getByText(/Profissional: Bruno Santos/)).toBeVisible();
  await expect(page.getByText(/Serviços do barbeiro atualizados|Barbeiro: Bruno Santos/)).toHaveCount(0);

  await page.getByRole("tab", { name: "Relatórios", exact: true }).click();
  await expect(page.getByLabel("Selecione o profissional")).toBeVisible();
  await expect(page.getByText("Despesas do Estabelecimento", { exact: true })).toBeVisible();
  await expect(page.getByText(/pagamentos estimados aos profissionais/i)).toBeVisible();
  await expect(page.getByText("Produtos, materiais e consumíveis", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Equipa", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Equipa de Profissionais" })).toBeVisible();
  await expect(page.getByText("Profissionais ativos aparecem no site, na agenda e nas reservas.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Adicionar Profissional" }).click();
  await expect(page.getByRole("button", { name: "Criar Profissional" })).toBeVisible();
  await page.getByRole("combobox").filter({ hasText: "Sem cálculo financeiro" }).click();
  await expect(page.getByRole("option", { name: "Renda fixa de espaço", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Comissão percentual", exact: true }).click();
  await expect(page.getByText("Percentagem do profissional (%)", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("button", { name: "Associar profissional existente" })).toBeVisible();
  await page.getByRole("button", { name: "Associar profissional existente" }).click();
  const professionalAssociationDialog = page.getByRole("dialog", { name: "Associar profissional a este estabelecimento" });
  await expect(professionalAssociationDialog).toBeVisible();
  await expect(professionalAssociationDialog).toContainText("O perfil, o acesso e as condições financeiras são comuns aos estabelecimentos.");
  await expect(professionalAssociationDialog.getByLabel("Profissional a associar")).toBeVisible();
  await professionalAssociationDialog.getByRole("button", { name: "Close" }).click();

  const locationScheduleButton = page.getByRole("button", { name: /Horário de .* neste estabelecimento/ }).first();
  await expect(locationScheduleButton).toBeVisible();
  await locationScheduleButton.click();
  const professionalScheduleDialog = page.getByRole("dialog", { name: /^Horário de / });
  await expect(professionalScheduleDialog).toContainText("Horário semanal fixo, apenas neste estabelecimento.");
  await professionalScheduleDialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("tab", { name: "Serviços", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Serviços Disponíveis" })).toBeVisible();
  await page.getByRole("button", { name: "Associar serviço existente" }).click();
  const serviceAssociationDialog = page.getByRole("dialog", { name: /^Associar serviço a / });
  await expect(serviceAssociationDialog).toContainText("Configure o preço e a duração aplicáveis apenas neste estabelecimento.");
  await expect(serviceAssociationDialog.getByLabel("Serviço a associar")).toBeVisible();
  await serviceAssociationDialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Gerir categorias", exact: true }).click();
  const categoriesDialog = page.getByRole("dialog", { name: "Gerir categorias" });
  await expect(categoriesDialog.getByLabel("Nome da nova categoria")).toBeVisible();
  await categoriesDialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("tab", { name: "Horário", exact: true }).click();
  await expect(page.getByText("Horário base do estabelecimento", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Estabelecimento aberto à Segunda")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("Admin team and schedule API errors follow the resolved backend vertical", async ({ request }) => {
  await loginAdmin(request);
  const runtimeResponse = await request.get("/api/runtime-config");
  expect(runtimeResponse.ok()).toBe(true);
  const runtime = await runtimeResponse.json() as { vertical: "barber" | "beauty" };
  const expectedInvalid = runtime.vertical === "beauty" ? "Profissional inválido." : "Barbeiro inválido.";
  const expectedName = runtime.vertical === "beauty"
    ? "Indique o nome do profissional."
    : "Indique o nome do barbeiro.";
  const expectedSpecialty = runtime.vertical === "beauty"
    ? "Indique a especialidade do profissional."
    : "Indique a especialidade do barbeiro.";
  const expectedBusyProfessional = runtime.vertical === "beauty"
    ? "Indique um profissional para consultar os horários ocupados."
    : "Indique um barbeiro para consultar os horários ocupados.";

  const updateResponse = await request.patch("/api/barbers/not-a-number", { data: {} });
  expect(updateResponse.status()).toBe(400);
  expect(await updateResponse.json()).toMatchObject({ message: expectedInvalid });

  const scheduleResponse = await request.get("/api/barbers/not-a-number/availability");
  expect(scheduleResponse.status()).toBe(400);
  expect(await scheduleResponse.json()).toMatchObject({ message: expectedInvalid });

  const resetResponse = await request.patch("/api/barbers/not-a-number/reset-password", { data: {} });
  expect(resetResponse.status()).toBe(400);
  expect(await resetResponse.json()).toMatchObject({ message: expectedInvalid });

  const busyResponse = await request.get("/api/appointments?scope=busy");
  expect(busyResponse.status()).toBe(400);
  expect(await busyResponse.json()).toMatchObject({ message: expectedBusyProfessional });

  const createResponse = await request.post("/api/barbers", {
    data: { name: "", specialty: "" },
  });
  expect(createResponse.status()).toBe(400);
  expect(await createResponse.json()).toMatchObject({ message: expectedName, field: "name" });

  const specialtyResponse = await request.post("/api/barbers", {
    data: { name: "Nome válido", specialty: "" },
  });
  expect(specialtyResponse.status()).toBe(400);
  expect(await specialtyResponse.json()).toMatchObject({ message: expectedSpecialty, field: "specialty" });
});

test("Excel report headings follow the resolved backend vertical without changing its structure", async ({ request }) => {
  await loginAdmin(request);
  const runtimeResponse = await request.get("/api/runtime-config");
  expect(runtimeResponse.ok()).toBe(true);
  const runtime = await runtimeResponse.json() as { vertical: "barber" | "beauty" };
  const exportResponse = await request.get(
    "/api/admin/export?startDate=2026-10-01&endDate=2026-10-02&barberId=all",
  );
  expect(exportResponse.ok()).toBe(true);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportResponse.body());
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    "Resumo Financeiro",
    "Detalhe dos Movimentos",
  ]);
  const summary = workbook.getWorksheet("Resumo Financeiro");
  const movements = workbook.getWorksheet("Detalhe dos Movimentos");
  expect(summary).toBeTruthy();
  expect(movements).toBeTruthy();

  const visibleText = workbook.worksheets.flatMap((sheet) => {
    const values: string[] = [];
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (typeof cell.value === "string") values.push(cell.value);
    }));
    return values;
  }).join("\n");

  if (runtime.vertical === "beauty") {
    expect(summary!.getCell("A3").value).toBe("Estabelecimento");
    expect(summary!.getCell("A5").value).toBe("Profissional");
    expect(movements!.getCell("D3").value).toBe("Profissional");
    expect(visibleText).not.toMatch(/Baptista|Powerhouse|barbeiro|barbeiros|barbearia|aluguer de cadeira/i);
  } else {
    expect(summary!.getCell("A3").value).toBe("Barbearia");
    expect(summary!.getCell("A5").value).toBe("Barbeiro");
    expect(movements!.getCell("D3").value).toBe("Barbeiro");
  }
});

test("chair rent calculations keep their values while report labels follow the backend vertical", async ({ request }) => {
  await loginAdmin(request);
  const runtime = await (await request.get("/api/runtime-config")).json() as { vertical: "barber" | "beauty" };
  const suffix = Date.now();
  const serviceResponse = await request.post("/api/services", {
    data: {
      name: `Serviço B4 ${suffix}`,
      agendaLabel: "B4",
      description: "Validação de labels B4",
      price: 10000,
      duration: 60,
    },
  });
  expect(serviceResponse.ok(), await serviceResponse.text()).toBe(true);
  const service = await serviceResponse.json();
  const professionalResponse = await request.post("/api/barbers", {
    data: {
      name: `Profissional B4 ${suffix}`,
      specialty: "Teste B4",
      color: "#7C3AED",
      isVisible: true,
      serviceIds: [service.id],
      compensationModel: "chair_rent",
      chairRentCents: 2500,
      chairRentPeriod: "month",
    },
  });
  expect(professionalResponse.ok(), await professionalResponse.text()).toBe(true);
  const professional = await professionalResponse.json();
  const appointmentResponse = await request.post("/api/appointments/block", {
    data: {
      barberId: professional.id,
      serviceId: service.id,
      startTime: "2026-10-01T10:00:00.000Z",
      name: `Cliente B4 ${suffix}`,
      phone: "+351912697411",
      isManualBooking: true,
      allowOutsideHours: true,
      isAlreadyCompleted: true,
      paymentMethod: "cash",
    },
  });
  expect(appointmentResponse.status(), await appointmentResponse.text()).toBe(201);

  const exportResponse = await request.get(
    `/api/admin/export?startDate=2026-10-01&endDate=2026-10-01&barberId=${professional.id}`,
  );
  expect(exportResponse.ok(), await exportResponse.text()).toBe(true);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportResponse.body());
  const expectedSheet = runtime.vertical === "beauty" ? "Acertos com Profissionais" : "Acertos com Barbeiros";
  const expectedProfessional = runtime.vertical === "beauty" ? "Profissional" : "Barbeiro";
  const expectedRent = runtime.vertical === "beauty" ? "Renda de espaço (€)" : "Aluguer de cadeira (€)";
  const expectedModel = runtime.vertical === "beauty" ? "Renda fixa de espaço" : "Aluguer fixo de cadeira";
  const settlement = workbook.getWorksheet(expectedSheet);
  expect(settlement).toBeTruthy();
  expect(settlement!.getRow(5).values).toEqual([
    undefined,
    expectedProfessional,
    "Modelo aplicado",
    "Serviços concluídos",
    "Base de acerto (€)",
    runtime.vertical === "beauty" ? "Comissões do profissional (€)" : "Comissões do barbeiro (€)",
    expectedRent,
    runtime.vertical === "beauty" ? "Valor do profissional (€)" : "Valor do barbeiro (€)",
    runtime.vertical === "beauty" ? "Valor do estabelecimento (€)" : "Valor da barbearia (€)",
  ]);
  expect(settlement!.getCell("B6").value).toBe(expectedModel);
  expect(settlement!.getCell("F6").value).toBe(25);
  expect(settlement!.getCell("G6").value).toBe(75);
  expect(settlement!.getCell("H6").value).toBe(25);
});
