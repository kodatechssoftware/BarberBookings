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
    isDefault: true,
    isActive: true,
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
});
