import { expect, test } from "@playwright/test";

test("applies environment-specific branding without leaking production identity", async ({ page }) => {
  const shopName = process.env.VITE_SHOP_NAME || "Baptista Barber Shop";
  const shortName = process.env.VITE_SHOP_SHORT_NAME || "Baptista";
  const address = process.env.VITE_SHOP_ADDRESS || "Rua Comandante Agatão Lança Nº28";
  const logoUrl = process.env.VITE_SHOP_LOGO_URL || "/images/logo.jpg";
  const hideMap = process.env.VITE_HIDE_SHOP_MAP === "true";

  await page.goto("/");

  await expect(page).toHaveTitle(shopName);
  await expect(page.getByText(shopName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(shortName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(new RegExp(address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).first()).toBeVisible();
  await expect(page.locator(`img[src="${logoUrl}"]`).first()).toBeVisible();

  if (hideMap) {
    await expect(page.getByRole("button", { name: "Abrir no Google Maps" })).toHaveCount(0);
    await expect(page.locator('iframe[src*="google.com/maps"]')).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Abrir no Google Maps" })).toBeVisible();
    await expect(page.locator('iframe[src*="google.com/maps"]')).toBeVisible();
  }

  if (shopName !== "Baptista Barber Shop") {
    await expect(page.getByText("Baptista Barber Shop", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Rua Comandante Agatão Lança/)).toHaveCount(0);
  }

  if (process.env.DEMO_MODE === "true") {
    const response = await page.request.get("/api/barbers");
    expect(response.ok(), await response.text()).toBe(true);
    const barbers = await response.json();
    for (const name of ["Tiago Martins", "Miguel Rocha", "Luís Carvalho", "Rafael Mendes"]) {
      const barber = barbers.find((candidate: any) => candidate.name === name);
      expect(barber, `Perfil de demonstração em falta: ${name}`).toBeTruthy();
      expect(barber.avatar).toMatch(/^\/images\/demo-barbers\/.+\.jpg$/);
    }
  }
});
