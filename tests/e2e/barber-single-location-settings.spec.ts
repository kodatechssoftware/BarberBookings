import { expect, test } from "@playwright/test";

const adminPassword = "Playwright-Test-Admin-2026!";

test("Barber DEV permite gerir apenas o estabelecimento principal", async ({ page, request }) => {
  expect((await request.get("/api/admin/locations")).status()).toBe(401);

  const login = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: adminPassword },
  });
  expect(login.ok(), await login.text()).toBe(true);

  const runtime = await (await page.request.get("/api/multi-location/config")).json();
  expect(runtime).toMatchObject({
    enabled: false,
    maxLocations: 1,
    singleLocationManagementEnabled: true,
  });

  const locationsResponse = await page.request.get("/api/admin/locations");
  expect(locationsResponse.ok(), await locationsResponse.text()).toBe(true);
  const locations = await locationsResponse.json();
  expect(locations).toHaveLength(1);
  const initialLocation = locations[0];
  expect(initialLocation).toMatchObject({ isDefault: true, isActive: true });

  const create = await page.request.post("/api/admin/locations", {
    data: { name: "Segunda localização", address: "Rua B, 2", timezone: "Europe/Lisbon" },
  });
  expect(create.status()).toBe(404);

  const deactivate = await page.request.patch(`/api/admin/locations/${initialLocation.id}`, {
    data: { isActive: false },
  });
  expect(deactivate.status()).toBe(409);

  await page.goto("/admin");
  await page.getByRole("tab", { name: "Estabelecimento" }).click();
  await expect(page.getByRole("tab", { name: "Localizações" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nova localização" })).toHaveCount(0);

  await page.getByRole("button", { name: new RegExp(`Editar ${initialLocation.name}`) }).click();
  const dialog = page.getByRole("dialog");
  const advanced = dialog.locator("details");
  await expect(advanced).not.toHaveAttribute("open", "");
  await expect(dialog.getByLabel("Logótipo da localização")).not.toBeVisible();

  await dialog.getByText("Opções avançadas (opcional)", { exact: true }).click();
  await dialog.getByLabel("Logótipo da localização").fill("/images/barber-logo.svg");
  const customMap = dialog.getByRole("switch", { name: "Utilizar localização personalizada" });
  await expect(customMap).not.toBeChecked();
  await customMap.click();
  await dialog.getByLabel("Link do Google Maps").fill("https://www.google.com/maps/search/?api=1&query=Baptista");
  await dialog.getByLabel("Link de incorporação do mapa").fill("https://www.google.com/maps?q=Baptista&output=embed");
  await dialog.getByText("Opções avançadas", { exact: false }).click();
  await expect(advanced).not.toHaveAttribute("open", "");

  await dialog.getByLabel("Nome da localização").fill("Baptista DEV — Principal");
  await dialog.getByLabel("Morada completa").fill("Rua de Camões, 100, 4000-143 Porto");
  await expect(dialog.getByRole("status")).toContainText("podem continuar a apontar para a morada anterior");
  await dialog.getByLabel("Telefone").fill("+351 912 345 678");
  await dialog.getByLabel("Email").fill("contacto@example.test");
  await dialog.getByRole("button", { name: "Guardar localização" }).click();
  await expect(page.getByText("As informações da localização foram guardadas.", { exact: true })).toBeVisible();

  const [customLocation] = await (await page.request.get("/api/locations")).json();
  expect(customLocation).toMatchObject({
    id: initialLocation.id,
    name: "Baptista DEV — Principal",
    address: "Rua de Camões, 100, 4000-143 Porto",
    logoUrl: "/images/barber-logo.svg",
    mapUrl: "https://www.google.com/maps/search/?api=1&query=Baptista",
    mapEmbedUrl: "https://www.google.com/maps?q=Baptista&output=embed",
    isDefault: true,
    isActive: true,
  });

  await page.getByRole("button", { name: /Editar Baptista DEV — Principal/ }).click();
  const reopened = page.getByRole("dialog");
  await expect(reopened.locator("details")).not.toHaveAttribute("open", "");
  expect(await reopened.getByLabel("Logótipo da localização").inputValue()).toBe("/images/barber-logo.svg");
  await reopened.getByText("Opções avançadas", { exact: false }).click();
  const reopenedSwitch = reopened.getByRole("switch", { name: "Utilizar localização personalizada" });
  await reopenedSwitch.click();
  const firstConfirmation = page.getByRole("alertdialog");
  await firstConfirmation.getByRole("button", { name: "Manter localização personalizada" }).click();
  await expect(reopenedSwitch).toBeChecked();

  await reopened.getByRole("button", { name: "Usar mapa automático" }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Os dois links personalizados serão limpos");
  await confirmation.getByRole("button", { name: "Usar mapa automático" }).click();
  expect(await reopened.getByLabel("Logótipo da localização").inputValue()).toBe("/images/barber-logo.svg");
  await expect(reopenedSwitch).not.toBeChecked();
  await reopened.getByRole("button", { name: "Guardar localização" }).click();

  const [automaticLocation] = await (await page.request.get("/api/locations")).json();
  expect(automaticLocation).toMatchObject({
    logoUrl: "/images/barber-logo.svg",
    mapUrl: null,
    mapEmbedUrl: null,
  });

  await expect.poll(async () => {
    const audit = await (await page.request.get("/api/admin/audit-logs")).json();
    return audit.find((entry: { action: string }) => entry.action === "location.updated");
  }).toMatchObject({
    action: "location.updated",
    entityType: "location",
    entityId: initialLocation.id,
    locationId: initialLocation.id,
  });

  await page.goto("/");
  await expect(page.getByText("Rua de Camões, 100, 4000-143 Porto", { exact: false }).first()).toBeVisible();
  await expect(page.locator("footer")).toContainText("Rua de Camões, 100, 4000-143 Porto");
  const directions = page.getByRole("link", { name: "Obter direções no Google Maps" });
  await expect(directions).toBeVisible();
  expect(new URL((await directions.getAttribute("href"))!).searchParams.get("query"))
    .toBe("Rua de Camões, 100, 4000-143 Porto");

  await page.getByTestId("location-map-container").scrollIntoViewIfNeeded();
  const mapFrame = page.locator('iframe[title="Mapa de Baptista DEV — Principal"]');
  await expect(mapFrame).toBeVisible();
  expect(new URL((await mapFrame.getAttribute("src"))!).searchParams.get("q"))
    .toBe("Baptista DEV — Principal, Rua de Camões, 100, 4000-143 Porto");
  await expect(directions).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Estabelecimento" }).click();
  await page.getByRole("button", { name: /Editar Baptista DEV — Principal/ }).click();
  const mobileDialog = page.getByRole("dialog");
  await expect(mobileDialog.getByLabel("Nome da localização")).toBeVisible();
  await expect(mobileDialog.locator("details")).not.toHaveAttribute("open", "");
  expect(await mobileDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
