import { expect, test, type Page } from "@playwright/test";
import { resolveBusinessRuntimeConfig } from "../../server/business-runtime-config";

const beautyRuntimeConfig = resolveBusinessRuntimeConfig({
  BUSINESS_VERTICAL: "beauty",
  MULTI_LOCATION_ENABLED: "false",
}, { productionDeployment: false }).config;

async function loginAdmin(page: Page) {
  const response = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok()).toBe(true);
}

test("Barber Admin and Agenda preserve the existing copy", async ({ page }) => {
  await loginAdmin(page);
  await page.goto("/admin");

  await expect(page.getByLabel("Filtrar barbeiro")).toBeVisible();

  await page.getByRole("tab", { name: "Equipa", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Equipa de Barbeiros" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Adicionar Barbeiro" })).toBeVisible();
});

test("Beauty Admin and Agenda use neutral copy on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/runtime-config", async (route) => {
    await route.fulfill({ json: beautyRuntimeConfig });
  });
  await loginAdmin(page);
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

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});
