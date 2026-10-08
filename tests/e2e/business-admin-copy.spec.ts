import { expect, test, type APIRequestContext } from "@playwright/test";
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

test("Barber Admin and Agenda preserve the existing copy", async ({ page }) => {
  await loginAdmin(page.request);
  await page.goto("/admin");

  await expect(page.getByLabel("Filtrar barbeiro")).toBeVisible();

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
  await loginAdmin(page.request);
  await page.goto("/admin");

  await expect(page.getByLabel("Filtrar profissional")).toBeVisible();

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

  const updateResponse = await request.patch("/api/barbers/not-a-number", { data: {} });
  expect(updateResponse.status()).toBe(400);
  expect(await updateResponse.json()).toMatchObject({ message: expectedInvalid });

  const scheduleResponse = await request.get("/api/barbers/not-a-number/availability");
  expect(scheduleResponse.status()).toBe(400);
  expect(await scheduleResponse.json()).toMatchObject({ message: expectedInvalid });

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
