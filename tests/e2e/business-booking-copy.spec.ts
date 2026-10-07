import { expect, test } from "@playwright/test";
import { resolveBusinessRuntimeConfig } from "../../server/business-runtime-config";

const beautyRuntimeConfig = resolveBusinessRuntimeConfig({
  BUSINESS_VERTICAL: "beauty",
  MULTI_LOCATION_ENABLED: "false",
}, { productionDeployment: false }).config;

test("Barber Booking preserves its public copy", async ({ page }) => {
  await page.goto("/booking");

  await expect(page.getByRole("heading", { name: "Seleciona o barbeiro" })).toBeVisible();
  await expect(page.getByText("Qualquer barbeiro livre", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Voltar ao início")).toBeVisible();
});

test("Beauty Booking uses neutral copy on mobile without changing the flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/runtime-config", async (route) => {
    await route.fulfill({ json: beautyRuntimeConfig });
  });
  await page.route("**/api/barbers*", async (route) => {
    await route.fulfill({
      json: [{
        id: 901,
        name: "Ana Silva",
        specialty: "Estética",
        avatar: null,
        isVisible: true,
        serviceIds: [],
      }],
    });
  });

  await page.goto("/booking");

  await expect(page.getByRole("heading", { name: "Selecione o profissional" })).toBeVisible();
  await expect(page.getByText("Qualquer profissional disponível", { exact: true })).toBeVisible();
  await expect(page.getByText("Profissional", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Voltar ao início")).toBeVisible();

  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(
    /Baptista|Powerhouse|barbeiro|barbeiros|barbearia|aluguer de cadeira/i,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth + 1));

  await page.getByText("Qualquer profissional disponível", { exact: true }).click();
  await page.getByRole("button", { name: "Seguinte" }).click();
  await expect(page.getByRole("heading", { name: "Selecione o Serviço" })).toBeVisible();
});
