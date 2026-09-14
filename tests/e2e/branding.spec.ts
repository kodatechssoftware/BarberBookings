import { expect, test } from "@playwright/test";

test("applies environment-specific branding without leaking production identity", async ({ page }) => {
  const requestedTheme = process.env.VITE_BRAND_THEME || "classic-gold";
  const isPowerhouseDemo = process.env.DEMO_MODE === "true";
  const brandTheme = isPowerhouseDemo
    ? "barber-pole"
    : requestedTheme === "barber-pole"
      ? "classic-gold"
      : requestedTheme;
  const shopName = isPowerhouseDemo ? "Powerhouse barbershop" : process.env.VITE_SHOP_NAME || "Baptista Barber Shop";
  const shortName = isPowerhouseDemo ? "Powerhouse" : process.env.VITE_SHOP_SHORT_NAME || "Baptista";
  const address = isPowerhouseDemo
    ? "Rua Adelino de Oliveira 85, 4470-025 Maia"
    : process.env.VITE_SHOP_ADDRESS || "Rua Comandante Agatão Lança Nº28";
  const logoUrl = isPowerhouseDemo ? "/images/demo-logo.svg" : process.env.VITE_SHOP_LOGO_URL || "/images/logo.jpg";
  const hideMap = process.env.VITE_HIDE_SHOP_MAP === "true";

  await page.goto("/");

  await expect(page).toHaveTitle(shopName);
  await expect(page.getByText(shopName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(shortName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(new RegExp(address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).first()).toBeVisible();
  await expect(page.locator(`img[src="${logoUrl}"]`).first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-brand-theme", brandTheme);

  if (brandTheme === "barber-pole") {
    const themeStyles = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const stripe = getComputedStyle(document.body, "::before");
      return {
        primary: root.getPropertyValue("--primary").trim(),
        destructive: root.getPropertyValue("--destructive").trim(),
        stripeHeight: stripe.height,
        stripeBackground: stripe.backgroundImage,
      };
    });
    expect(themeStyles.primary).toBe("350 56% 54%");
    expect(themeStyles.destructive).toBe("350 56% 54%");
    expect(themeStyles.stripeHeight).toBe("4px");
    expect(themeStyles.stripeBackground).toContain("repeating-linear-gradient");
  }

  if (hideMap) {
    await expect(page.getByRole("button", { name: "Abrir no Google Maps" })).toHaveCount(0);
    await expect(page.locator('iframe[src*="google.com/maps"]')).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Abrir no Google Maps" })).toBeVisible();
    await expect(page.getByTestId("location-map-placeholder")).toHaveCount(1);
    await page.getByTestId("location-map-container").scrollIntoViewIfNeeded();
    await expect(page.locator('iframe[src*="google.com/maps"]')).toBeVisible();
  }

  const barberImages = page.locator("#team img");
  if (await barberImages.count()) {
    await expect(barberImages.first()).toHaveAttribute("loading", "lazy");
    await expect(barberImages.first()).toHaveAttribute("decoding", "async");
  }

  if (shopName !== "Baptista Barber Shop") {
    await expect(page.getByText("Baptista Barber Shop", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Rua Comandante Agatão Lança/)).toHaveCount(0);
  }

  if (process.env.DEMO_MODE === "true") {
    const response = await page.request.get("/api/barbers");
    expect(response.ok(), await response.text()).toBe(true);
    const barbers = await response.json();
    const andre = barbers.find((candidate: any) => candidate.name === "André");
    expect(andre, "Perfil de demonstração em falta: André").toBeTruthy();
    expect(andre.avatar).toBe("/images/demo-barbers/tiago-martins.jpg");
    expect(andre.color).toBe("#9F2638");

    const servicesResponse = await page.request.get("/api/services");
    expect(servicesResponse.ok(), await servicesResponse.text()).toBe(true);
    const services = await servicesResponse.json();
    const expectedServices = [
      ["Corte + Barba (Barboterapia)", 2200],
      ["Corte", 1500],
      ["Corte 1 pente por todo + Barba (Barboterapia)", 1900],
      ["Corte 1 pente por todo", 1200],
      ["Barba (Barboterapia)", 1200],
      ["Design Sobrancelha (pinça, linha)", 1000],
      ["Sobrancelhas cera ou navalhado", 400],
      ["Corte, barba (barboterapia) e sobrancelhas", 2600],
      ["Platinar cabelo curto", 3500],
      ["Madeixas/Luzes cabelo curto", 2500],
      ["Alisamento", 1000],
      ["Corte estudante", 1200],
    ];
    for (const [name, price] of expectedServices) {
      const service = services.find((candidate: any) => candidate.name === name);
      expect(service, `Serviço de demonstração em falta: ${name}`).toBeTruthy();
      expect(service.price).toBe(price);
    }

    await expect(page.locator('img[src="/images/powerhouse-hero.jpg"]')).toBeVisible();
    await expect(page.getByText("Tratamentos", { exact: true })).toBeVisible();
    await expect(page.getByText("Só à quarta-feira · Estudantes", { exact: true })).toBeVisible();

    await page.goto("/book");
    await expect(page.getByRole("heading", { name: "Seleciona o barbeiro" })).toBeVisible();
    await expect(page.getByText("André", { exact: true })).toBeVisible();
    await page.getByText("André", { exact: true }).click();
    await page.getByRole("button", { name: "Seguinte" }).click();
    await expect(page.getByRole("heading", { name: "Selecione o Serviço" })).toBeVisible();
    await expect(page.getByText("Corte + Barba (Barboterapia)", { exact: true })).toBeVisible();

    const demoPassword = process.env.DEMO_ADMIN_PASSWORD;
    expect(demoPassword).toBeTruthy();
    const loginResponse = await page.request.post("/api/admin/login", {
      data: { username: "admin", password: demoPassword },
    });
    expect(loginResponse.ok(), await loginResponse.text()).toBe(true);
  }
});
