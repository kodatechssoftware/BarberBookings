import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { resolveBusinessRuntimeConfig } from "../../server/business-runtime-config";

const beautyRuntimeConfig = resolveBusinessRuntimeConfig({
  BUSINESS_VERTICAL: "beauty",
  MULTI_LOCATION_ENABLED: "false",
}, { productionDeployment: false }).config;

const futureAppointment = {
  id: 901,
  locationId: 1,
  locationName: "Estabelecimento Central",
  locationAddress: "Rua de Teste, 1",
  locationTimeZone: "Europe/Lisbon",
  barberId: 11,
  serviceId: 21,
  startTime: "2026-12-10T10:00:00.000Z",
  status: "booked",
  customerName: "Cliente Teste",
  depositRequired: false,
  depositReason: null,
  cancellationPolicyHours: 4,
  isLateCancellation: false,
  barberName: "Ana",
  serviceName: "Tratamento",
  duration: 30,
  price: 2500,
  extras: [],
  totalPrice: 2500,
  manualOutsideHours: false,
};

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function useBeautyConfig(page: Page) {
  await page.route("**/api/runtime-config", (route) => route.fulfill({ json: beautyRuntimeConfig }));
}

async function mockAppointment(page: Page, token: string, patch: Record<string, unknown> = {}) {
  await page.route(`**/api/appointments/token/${token}`, (route) => route.fulfill({
    json: { ...futureAppointment, ...patch },
  }));
}

test("Barber cancellation keeps its wording and exposes a failed mutation locally for retry", async ({ page }) => {
  const token = "b5a-cancel-barber";
  await mockAppointment(page, token);
  let attempts = 0;
  await page.route(`**/api/appointments/cancel/${token}`, async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 409, json: { message: "Esta marcação já não pode ser cancelada." } });
      return;
    }
    await route.fulfill({ json: { message: "Marcação cancelada com sucesso.", status: "cancelled" } });
  });

  await page.goto(`/cancel/${token}`);
  await expect(page.getByText("Barbeiro", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar marcação" }).click();
  await expect(page.getByRole("alert")).toContainText("Esta marcação já não pode ser cancelada.");
  await page.getByRole("button", { name: "Cancelar marcação" }).click();
  await expect(page.getByRole("heading", { name: "Marcação Cancelada" })).toBeVisible();
  expect(attempts).toBe(2);
});

test("Beauty cancellation uses Profissional and contains no Barber terminology", async ({ page }) => {
  const token = "b5a-cancel-beauty";
  await useBeautyConfig(page);
  await mockAppointment(page, token);

  await page.goto(`/cancel/${token}`);
  await expect(page.getByText("Profissional", { exact: true })).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/Baptista|Powerhouse|barbeiro|barbeiros|barbearia/i);
});

test("Barber and Beauty assisted reschedule use their resolved establishment wording", async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const barberContext = await browser.newContext({ baseURL });
  const barberPage = await barberContext.newPage();
  await mockAppointment(barberPage, "b5a-reschedule-barber", { manualOutsideHours: true });
  await barberPage.goto("/reschedule/b5a-reschedule-barber");
  await expect(barberPage.getByText("Para reagendar esta marcação, contacte a barbearia.")).toBeVisible();
  await barberContext.close();

  const beautyContext = await browser.newContext({ baseURL });
  const beautyPage = await beautyContext.newPage();
  await useBeautyConfig(beautyPage);
  await mockAppointment(beautyPage, "b5a-reschedule-beauty", { manualOutsideHours: true });
  await beautyPage.goto("/reschedule/b5a-reschedule-beauty");
  await expect(beautyPage.getByText("Para reagendar esta marcação, contacte o estabelecimento.")).toBeVisible();
  expect(await beautyPage.locator("body").innerText()).not.toMatch(/Baptista|Powerhouse|barbeiro|barbeiros|barbearia/i);
  await beautyContext.close();
});

test("public invite keeps Barber wording and accessible password labels", async ({ page }) => {
  await page.route("**/api/barber-invites/b5a-invite-barber", (route) => route.fulfill({
    json: { barberName: "João", barberEmail: "joao@example.test", expiresAt: "2026-12-31T00:00:00.000Z" },
  }));
  await page.goto("/barber-invite/b5a-invite-barber");

  await expect(page.getByRole("heading", { name: "Criar acesso de barbeiro" })).toBeVisible();
  await expect(page.getByText(/Não concede acesso administrativo/)).toBeVisible();
  await expect(page.getByLabel("Nova palavra-passe")).toBeVisible();
  await expect(page.getByLabel("Confirmar palavra-passe")).toBeVisible();
});

test("public invite uses Beauty wording without changing internal routes or DTOs", async ({ page }) => {
  await useBeautyConfig(page);
  await page.route("**/api/barber-invites/b5a-invite-beauty", (route) => route.fulfill({
    json: { barberName: "Ana", barberEmail: "ana@example.test", expiresAt: "2026-12-31T00:00:00.000Z" },
  }));
  await page.goto("/barber-invite/b5a-invite-beauty");

  await expect(page.getByRole("heading", { name: "Criar acesso de Profissional" })).toBeVisible();
  await expect(page.getByText(/perfil de profissional/)).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/Baptista|Powerhouse|barbeiro|barbeiros|barbearia/i);
});

test("Admin invite dialog follows Barber and Beauty copy while retaining professional-only access", async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const barberContext = await browser.newContext({ baseURL });
  const barberPage = await barberContext.newPage();
  await loginAdmin(barberPage.request);
  await barberPage.route("**/api/barbers/*/invite", (route) => route.fulfill({
    status: 201,
    json: { inviteUrl: "https://example.test/barber-invite/barber-copy", expiresAt: "2026-12-31T00:00:00.000Z" },
  }));
  await barberPage.goto("/admin");
  await barberPage.getByRole("tab", { name: "Equipa", exact: true }).click();
  await barberPage.getByRole("button", { name: /Criar convite de acesso de barbeiro para/ }).first().click();
  const barberDialog = barberPage.getByRole("alertdialog");
  await expect(barberDialog).toContainText("Este convite cria acesso de barbeiro, não acesso administrativo.");
  await barberDialog.getByRole("button", { name: "Criar convite", exact: true }).click();
  await expect(barberPage.getByText("Convite criado", { exact: true })).toBeVisible();
  await expect(barberPage.getByLabel("Notifications (F8)").getByText(/Link copiado para enviar a/)).toBeVisible();
  await barberContext.close();

  const beautyContext = await browser.newContext({ baseURL });
  const beautyPage = await beautyContext.newPage();
  await loginAdmin(beautyPage.request);
  await useBeautyConfig(beautyPage);
  await beautyPage.route("**/api/barbers/*/invite", (route) => route.fulfill({
    status: 201,
    json: { inviteUrl: "https://example.test/barber-invite/beauty-copy", expiresAt: "2026-12-31T00:00:00.000Z" },
  }));
  await beautyPage.goto("/admin");
  await beautyPage.getByRole("tab", { name: "Equipa", exact: true }).click();
  await beautyPage.getByRole("button", { name: /Criar convite de acesso de profissional para/ }).first().click();
  const beautyDialog = beautyPage.getByRole("alertdialog");
  await expect(beautyDialog).toContainText("Este convite cria acesso de profissional, não acesso administrativo.");
  expect(await beautyDialog.innerText()).not.toMatch(/barbeiro|barbearia/i);
  await beautyDialog.getByRole("button", { name: "Criar convite", exact: true }).click();
  await expect(beautyPage.getByText("Convite criado", { exact: true })).toBeVisible();
  await expect(beautyPage.getByLabel("Notifications (F8)").getByText(/Link copiado para enviar a/)).toBeVisible();
  await beautyContext.close();
});

test("public-cycle backend errors use the resolved vertical copy", async ({ request }) => {
  await loginAdmin(request);
  const runtime = await (await request.get("/api/runtime-config")).json() as { vertical: "barber" | "beauty" };
  const invalidProfessional = await request.post("/api/barbers/not-a-number/invite", { data: {} });
  expect(invalidProfessional.status()).toBe(400);
  expect(await invalidProfessional.json()).toMatchObject({
    message: runtime.vertical === "beauty" ? "Profissional inválido." : "Barbeiro inválido.",
  });

  const invalidInvite = await request.get("/api/barber-invites/unknown-b5a-token");
  expect(invalidInvite.status()).toBe(404);
  expect(await invalidInvite.json()).toMatchObject({ message: "Convite inválido ou expirado." });

  const invalidReschedule = await request.post("/api/appointments/reschedule/unknown-b5a-token", {
    data: { startTime: "2026-12-10T10:00:00.000Z" },
  });
  expect(invalidReschedule.status()).toBe(404);
  expect(await invalidReschedule.json()).toMatchObject({ message: "Marcação não encontrada" });

  const invalidCancellation = await request.post("/api/appointments/cancel/unknown-b5a-token");
  expect(invalidCancellation.status()).toBe(404);
  expect(await invalidCancellation.json()).toMatchObject({ message: "Marcação não encontrada" });
});
