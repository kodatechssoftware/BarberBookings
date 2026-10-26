import { expect, test } from "@playwright/test";

const adminPassword = "Playwright-Test-Admin-2026!";

test("Beauty single-location permite gerir apenas o estabelecimento principal", async ({ page, request }) => {
  expect((await request.get("/api/admin/locations")).status()).toBe(401);

  const login = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: adminPassword },
  });
  expect(login.ok(), await login.text()).toBe(true);

  const locationsResponse = await page.request.get("/api/admin/locations");
  expect(locationsResponse.ok(), await locationsResponse.text()).toBe(true);
  const [initialLocation] = await locationsResponse.json();
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
  const locationDialog = page.getByRole("dialog");
  const advancedOptions = locationDialog.locator("details");
  await expect(advancedOptions).not.toHaveAttribute("open", "");
  await expect(locationDialog.getByLabel("Logótipo da localização")).not.toBeVisible();

  await locationDialog.getByText("Opções avançadas", { exact: false }).click();
  await locationDialog.getByLabel("Logótipo da localização").fill("/images/beauty-logo.svg");
  await locationDialog.getByLabel("Link do Google Maps").fill("https://www.google.com/maps/search/?api=1&query=Ana+Isabel");
  await locationDialog.getByLabel("Link de incorporação do mapa").fill("https://www.google.com/maps?q=Ana+Isabel&output=embed");
  await locationDialog.getByText("Opções avançadas", { exact: false }).click();
  await expect(advancedOptions).not.toHaveAttribute("open", "");
  expect(await locationDialog.getByLabel("Logótipo da localização").inputValue()).toBe("/images/beauty-logo.svg");

  await page.getByLabel("Nome da localização").fill("Ana Isabel — Principal");
  await page.getByLabel("Morada completa").fill("Avenida dos Aliados, 100, 4000-064 Porto");
  await page.getByLabel("Telefone").fill("+351 912 345 678");
  await page.getByLabel("Email").fill("contacto@example.test");
  await page.getByRole("button", { name: "Guardar localização" }).click();
  await expect(page.getByText("As informações da localização foram guardadas.", { exact: true })).toBeVisible();

  const [updatedLocation] = await (await page.request.get("/api/locations")).json();
  expect(updatedLocation).toMatchObject({
    id: initialLocation.id,
    name: "Ana Isabel — Principal",
    address: "Avenida dos Aliados, 100, 4000-064 Porto",
    phone: "+351 912 345 678",
    email: "contacto@example.test",
    logoUrl: "/images/beauty-logo.svg",
    mapUrl: "https://www.google.com/maps/search/?api=1&query=Ana+Isabel",
    mapEmbedUrl: "https://www.google.com/maps?q=Ana+Isabel&output=embed",
    isDefault: true,
    isActive: true,
  });

  await page.getByRole("button", { name: /Editar Ana Isabel — Principal/ }).click();
  const reopenedDialog = page.getByRole("dialog");
  await expect(reopenedDialog.locator("details")).not.toHaveAttribute("open", "");
  expect(await reopenedDialog.getByLabel("Logótipo da localização").inputValue()).toBe("/images/beauty-logo.svg");
  expect(await reopenedDialog.getByLabel("Link do Google Maps").inputValue()).toContain("query=Ana+Isabel");
  await reopenedDialog.getByLabel("Telefone").fill("+351 911 222 333");
  await reopenedDialog.getByRole("button", { name: "Guardar localização" }).click();
  await expect(page.getByText("As informações da localização foram guardadas.", { exact: true })).toBeVisible();

  const [preservedLocation] = await (await page.request.get("/api/locations")).json();
  expect(preservedLocation).toMatchObject({
    phone: "+351 911 222 333",
    logoUrl: "/images/beauty-logo.svg",
    mapUrl: "https://www.google.com/maps/search/?api=1&query=Ana+Isabel",
    mapEmbedUrl: "https://www.google.com/maps?q=Ana+Isabel&output=embed",
  });

  await page.getByRole("button", { name: /Editar Ana Isabel — Principal/ }).click();
  const finalDialog = page.getByRole("dialog");
  await finalDialog.getByText("Opções avançadas", { exact: false }).click();
  await finalDialog.getByLabel("Logótipo da localização").fill("");
  await finalDialog.getByLabel("Link do Google Maps").fill("");
  await finalDialog.getByLabel("Link de incorporação do mapa").fill("");
  await finalDialog.getByRole("button", { name: "Guardar localização" }).click();
  await expect(page.getByText("As informações da localização foram guardadas.", { exact: true })).toBeVisible();

  const [automaticMapLocation] = await (await page.request.get("/api/locations")).json();
  expect(automaticMapLocation).toMatchObject({ logoUrl: null, mapUrl: null, mapEmbedUrl: null });

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
  await expect(page.getByText("Avenida dos Aliados, 100, 4000-064 Porto", { exact: false }).first()).toBeVisible();
  await expect(page.locator("footer")).toContainText("Avenida dos Aliados, 100, 4000-064 Porto");
  await expect(page.getByText("Ana Isabel Nail Art & Design", { exact: true }).first()).toBeVisible();

  const directions = page.getByRole("link", { name: "Obter direções no Google Maps" });
  await expect(directions).toBeVisible();
  const directionsUrl = new URL((await directions.getAttribute("href"))!);
  expect(directionsUrl.hostname).toBe("www.google.com");
  expect(directionsUrl.searchParams.get("query")).toBe("Avenida dos Aliados, 100, 4000-064 Porto");

  await page.getByTestId("location-map-container").scrollIntoViewIfNeeded();
  const mapFrame = page.locator('iframe[title="Mapa de Ana Isabel — Principal"]');
  await expect(mapFrame).toBeVisible();
  const mapUrl = new URL((await mapFrame.getAttribute("src"))!);
  expect(mapUrl.searchParams.get("q")).toBe("Ana Isabel — Principal, Avenida dos Aliados, 100, 4000-064 Porto");

  await page.goto("/book");
  await expect(page.getByRole("heading", { name: "Onde quer marcar?" })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Estabelecimento" }).click();
  await page.getByRole("button", { name: /Editar Ana Isabel — Principal/ }).click();
  const mobileDialog = page.getByRole("dialog");
  await expect(mobileDialog.getByLabel("Nome da localização")).toBeVisible();
  await expect(mobileDialog.getByLabel("Morada completa")).toBeVisible();
  await expect(mobileDialog.getByLabel("Telefone")).toBeVisible();
  await expect(mobileDialog.getByLabel("Email")).toBeVisible();
  await expect(mobileDialog.locator("details")).not.toHaveAttribute("open", "");
  expect(await mobileDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
