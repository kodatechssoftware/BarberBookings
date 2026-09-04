import { expect, test, type APIRequestContext } from "@playwright/test";

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

const embed = (city: string) => `https://www.google.com/maps/embed?pb=${city}`;

test("[multi-location] gere quatro localizações com rascunhos e apresenta um único mapa selecionável", async ({ page, request }) => {
  expect((await request.get("/api/admin/locations")).status()).toBe(401);
  await loginAdmin(request);

  const initial = await (await request.get("/api/admin/locations")).json();
  expect(initial).toHaveLength(1);
  expect(initial[0]).toMatchObject({ isDefault: true, isActive: true });

  const created: any[] = [];
  for (const [name, city] of [["Porto", "Porto"], ["Braga", "Braga"], ["Coimbra", "Coimbra"]]) {
    const response = await request.post("/api/admin/locations", {
      data: {
        name: `Loja ${name}`,
        address: `Avenida Central, ${city}`,
        mapUrl: `https://www.google.com/maps?q=${city}`,
        mapEmbedUrl: embed(city),
        timezone: "Europe/Lisbon",
        isActive: true,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    const location = await response.json();
    expect(location.isActive).toBe(false);
    created.push(location);
  }

  expect(await (await request.get("/api/locations")).json()).toHaveLength(1);

  const overLimit = await request.post("/api/admin/locations", {
    data: { name: "Loja Faro", address: "Avenida Central, Faro", timezone: "Europe/Lisbon" },
  });
  expect(overLimit.status()).toBe(409);

  for (const location of created) {
    const response = await request.patch(`/api/admin/locations/${location.id}`, { data: { isActive: true } });
    expect(response.ok(), await response.text()).toBe(true);
  }

  const deactivateDefault = await request.patch(`/api/admin/locations/${initial[0].id}`, { data: { isActive: false } });
  expect(deactivateDefault.status()).toBe(409);
  expect(await (await request.get("/api/locations")).json()).toHaveLength(4);

  await page.goto("/");
  const locationSection = page.locator("#location");
  await expect(locationSection.getByRole("button", { name: /Loja Braga/ })).toBeVisible();
  await locationSection.getByRole("button", { name: /Loja Braga/ }).click();
  await expect(locationSection.locator("iframe")).toHaveCount(1);
  await expect(locationSection.locator("iframe")).toHaveAttribute("title", "Mapa de Loja Braga");
  await expect(locationSection.locator("iframe")).toHaveAttribute("src", embed("Braga"));

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const invalidEmbed = await request.patch(`/api/admin/locations/${created[0].id}`, {
    data: { mapEmbedUrl: "https://example.com/not-a-map" },
  });
  expect(invalidEmbed.status()).toBe(400);

  await loginAdmin(page.request);
  await page.goto("/admin");
  const locationsTab = page.getByRole("tab", { name: "Localizações" });
  await expect(locationsTab).toBeVisible();
  await locationsTab.click();
  await expect(page.getByText("4 de 4 localizações utilizadas neste plano.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova localização" })).toBeDisabled();
});
