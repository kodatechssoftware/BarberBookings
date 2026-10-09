import { expect, test } from "@playwright/test";
import { professionalCapabilityCodes } from "../../shared/auth";

test("canonical Professional UI exposes operational access without administrator controls", async ({ page }) => {
  const login = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(login.ok(), await login.text()).toBe(true);

  const [locationsResponse, barbersResponse] = await Promise.all([
    page.request.get("/api/account/locations"),
    page.request.get("/api/barbers?includeHidden=true"),
  ]);
  expect(locationsResponse.ok(), await locationsResponse.text()).toBe(true);
  expect(barbersResponse.ok(), await barbersResponse.text()).toBe(true);
  const [location] = await locationsResponse.json();
  const [professional] = await barbersResponse.json();
  expect(location).toBeTruthy();
  expect(professional).toBeTruthy();

  await page.route("**/api/admin/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authorized: true,
        role: "barber",
        id: 9001,
        userId: 9001,
        professionalId: professional.id,
        name: professional.name,
        email: professional.email,
        access: {
          globalCapabilities: [],
          locationCapabilities: [{
            locationId: location.id,
            capabilities: professionalCapabilityCodes,
          }],
          presetLabels: ["Profissional"],
        },
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await expect(page.getByRole("tab", { name: "Agenda", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Marcação manual" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ausência" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Relatórios", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Equipa", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Serviços", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Extras", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Localizações", exact: true })).toHaveCount(0);

  const hasBodyOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(hasBodyOverflow).toBe(false);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole("button", { name: "Marcação manual" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ausência" })).toHaveCount(0);
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth + 1,
  )).toBe(false);
});

test("canonical location grants expose only their P4B Admin surfaces", async ({ page }) => {
  const login = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(login.ok(), await login.text()).toBe(true);

  const locationsResponse = await page.request.get("/api/account/locations");
  expect(locationsResponse.ok(), await locationsResponse.text()).toBe(true);
  const [location] = await locationsResponse.json();
  expect(location).toBeTruthy();

  await page.route("**/api/admin/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authorized: true,
        role: "barber",
        id: 9002,
        userId: 9002,
        professionalId: null,
        name: "Operações Loja",
        email: "operations@example.test",
        access: {
          globalCapabilities: [],
          locationCapabilities: [{
            locationId: location.id,
            capabilities: [
              "team.view",
              "catalog.manage_location",
              "hours.manage_establishment",
              "extras.manage",
              "finance.manage_expenses",
              "finance.manage_compensation",
              "customers.block",
              "audit.view",
            ],
          }],
          presetLabels: [],
        },
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await expect(page.getByRole("tab", { name: "Equipa", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Serviços", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Extras", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Horário", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Bloqueados", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Localizações", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Relatórios", exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "Equipa", exact: true }).click();
  await expect(page.getByRole("button", { name: /Adicionar (barbeiro|profissional)/i })).toHaveCount(0);

  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth + 1,
  )).toBe(false);
});
