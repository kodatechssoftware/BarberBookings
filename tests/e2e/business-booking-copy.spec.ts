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

test("Beauty Booking is service-first and only offers professionals for that service on mobile and desktop", async ({ page }) => {
  await page.route("**/api/runtime-config", async (route) => {
    await route.fulfill({ json: beautyRuntimeConfig });
  });
  await page.route("**/api/barbers*", async (route) => {
    await route.fulfill({
      json: [
        {
          id: 901,
          name: "Ana Silva",
          specialty: "Estética",
          avatar: null,
          isVisible: true,
          serviceIds: [701],
        },
        {
          id: 902,
          name: "Berta Costa",
          specialty: "Massagem",
          avatar: null,
          isVisible: true,
          serviceIds: [702],
        },
      ],
    });
  });
  await page.route("**/api/services*", async (route) => {
    await route.fulfill({
      json: [{
        id: 701,
        name: "Tratamento facial",
        description: "Cuidado de rosto",
        agendaLabel: "Facial",
        price: 3500,
        duration: 60,
        bufferBeforeMinutes: 10,
        bufferAfterMinutes: 15,
        isVisible: true,
      }],
    });
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/booking");

    await expect(page.getByRole("heading", { name: "Selecione o Serviço" })).toBeVisible();
    await page.getByText("Tratamento facial", { exact: true }).click();
    await page.getByRole("button", { name: "Seguinte" }).click();

    await expect(page.getByRole("heading", { name: "Selecione o profissional" })).toBeVisible();
    await expect(page.getByText("Qualquer profissional disponível", { exact: true })).toBeVisible();
    await expect(page.getByText("Ana Silva", { exact: true })).toBeVisible();
    await expect(page.getByText("Berta Costa", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Voltar ao passo anterior")).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(
      /Baptista|Powerhouse|barbeiro|barbeiros|barbearia|aluguer de cadeira/i,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth + 1));

    await page.getByLabel("Voltar ao passo anterior").click();
    await expect(page.getByRole("heading", { name: "Selecione o Serviço" })).toBeVisible();

    await page.goto("/booking?serviceId=701");
    await expect(page.getByRole("heading", { name: "Selecione o profissional" })).toBeVisible();
    await expect(page.getByText("Ana Silva", { exact: true })).toBeVisible();
  }
});
