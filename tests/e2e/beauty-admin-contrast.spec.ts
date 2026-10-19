import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";

const adminPassword = "Playwright-Test-Admin-2026!";

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: adminPassword },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function contrastRatio(foreground: Locator, background: Locator) {
  return foreground.evaluate((element, backgroundElement) => {
    const parseRgb = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error(`Unsupported colour: ${value}`);
      return channels;
    };
    const luminance = (value: string) => {
      const channels = parseRgb(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const foregroundColor = getComputedStyle(element).color;
    const backgroundColor = getComputedStyle(backgroundElement as Element).backgroundColor;
    const lighter = Math.max(luminance(foregroundColor), luminance(backgroundColor));
    const darker = Math.min(luminance(foregroundColor), luminance(backgroundColor));
    return {
      foregroundColor,
      backgroundColor,
      ratio: (lighter + 0.05) / (darker + 0.05),
    };
  }, await background.elementHandle());
}

async function placeholderContrastRatio(control: Locator) {
  return control.evaluate((element) => {
    const parseRgb = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error(`Unsupported colour: ${value}`);
      return channels;
    };
    const luminance = (value: string) => {
      const channels = parseRgb(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const foregroundColor = getComputedStyle(element, "::placeholder").color;
    const backgroundColor = getComputedStyle(element).backgroundColor;
    const lighter = Math.max(luminance(foregroundColor), luminance(backgroundColor));
    const darker = Math.min(luminance(foregroundColor), luminance(backgroundColor));
    return {
      foregroundColor,
      backgroundColor,
      ratio: (lighter + 0.05) / (darker + 0.05),
    };
  });
}

async function expectFormSurfaceLegible(surface: Locator) {
  await expect(surface).toBeVisible();

  const labels = surface.locator("label:visible");
  expect(await labels.count()).toBeGreaterThan(0);
  for (let index = 0; index < Math.min(await labels.count(), 10); index += 1) {
    expect((await contrastRatio(labels.nth(index), surface)).ratio).toBeGreaterThanOrEqual(4.5);
  }

  const helper = surface.locator(".text-gray-400:visible, .text-gray-500:visible, .text-muted-foreground:visible").first();
  if (await helper.count()) {
    expect((await contrastRatio(helper, surface)).ratio).toBeGreaterThanOrEqual(4.5);
  }

  const control = surface.locator('input:visible:not([type="checkbox"]):not([type="radio"]), textarea:visible').first();
  if (await control.count()) {
    expect((await contrastRatio(control, control)).ratio).toBeGreaterThanOrEqual(7);
    await control.evaluate((element) => element.setAttribute("placeholder", "Texto de exemplo"));
    expect((await placeholderContrastRatio(control)).ratio).toBeGreaterThanOrEqual(4.5);
    await control.evaluate((element) => element.setAttribute("disabled", ""));
    expect((await contrastRatio(control, control)).ratio).toBeGreaterThanOrEqual(4.5);
    await control.evaluate((element) => element.removeAttribute("disabled"));
  }

  const select = surface.locator('button[role="combobox"]:visible').first();
  if (await select.count()) {
    expect((await contrastRatio(select, select)).ratio).toBeGreaterThanOrEqual(4.5);
  }
}

test.describe("Beauty Admin contrast", () => {
  test("keeps dashboard, agenda and controls legible on desktop and mobile", async ({ page }) => {
    const runtimeConfigResponse = await page.request.get("/api/runtime-config");
    expect(runtimeConfigResponse.ok(), await runtimeConfigResponse.text()).toBe(true);
    const runtimeConfig = await runtimeConfigResponse.json();
    test.skip(runtimeConfig.vertical !== "beauty", "Beauty-only visual contract");

    await loginAdmin(page.request);

    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/admin");
      await expect(page.locator("html")).toHaveAttribute("data-brand-theme", "beauty-clean");
      await expect(page.locator("html")).toHaveAttribute("data-admin-surface", "true");

      const shell = page.locator(".admin-shell");
      const heading = page.getByRole("heading", { name: "Painel Administrativo" });
      const headingContrast = await contrastRatio(heading, shell);
      expect(headingContrast.ratio).toBeGreaterThanOrEqual(7);

      const agenda = page.getByTestId("weekly-agenda");
      await expect(agenda).toBeVisible();
      const agendaStyle = await agenda.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          border: style.borderTopColor,
          shadow: style.boxShadow,
        };
      });
      expect(agendaStyle.border).not.toBe(agendaStyle.background);
      expect(agendaStyle.shadow).not.toBe("none");

      for (const metricName of ["Total do dia", "Receita concluída"]) {
        const metricLabel = page.getByText(metricName, { exact: true }).first();
        const metricCard = metricLabel.locator("..");
        await expect(metricLabel).toBeVisible();
        const metricContrast = await contrastRatio(metricLabel, metricCard);
        expect(metricContrast.ratio).toBeGreaterThanOrEqual(4.5);
        const metricSurface = await metricCard.evaluate((element) => {
          const style = getComputedStyle(element);
          return { background: style.backgroundColor, border: style.borderTopColor };
        });
        expect(metricSurface.border).not.toBe(metricSurface.background);
      }

      const activeTab = page.getByRole("tab", { name: "Agenda" });
      const inactiveTab = page.getByRole("tab", { name: "Marcações" });
      const tabStyles = await Promise.all([activeTab, inactiveTab].map((tab) => tab.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      })));
      expect(tabStyles[0].background).not.toBe(tabStyles[1].background);
      expect(tabStyles[0].color).not.toBe(tabStyles[1].color);

      const filter = agenda.getByRole("combobox").first();
      await expect(filter).toBeVisible();
      const filterStyle = await filter.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          border: style.borderTopColor,
          color: style.color,
        };
      });
      expect(filterStyle.border).not.toBe(filterStyle.background);
      expect(filterStyle.color).not.toBe(filterStyle.background);

      const primaryAction = page.getByRole("button", { name: "Marcação manual" });
      await expect(primaryAction).toBeVisible();
      const primaryContrast = await contrastRatio(primaryAction, primaryAction);
      expect(primaryContrast.ratio).toBeGreaterThanOrEqual(4.5);

      const secondaryAction = page.getByRole("button", { name: "Ausência" });
      const secondaryStyle = await secondaryAction.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, border: style.borderTopColor };
      });
      expect(secondaryStyle.border).not.toBe(secondaryStyle.background);

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    }
  });

  test("does not apply the Beauty legibility layer to the Barber Admin", async ({ page }) => {
    const runtimeConfigResponse = await page.request.get("/api/runtime-config");
    expect(runtimeConfigResponse.ok(), await runtimeConfigResponse.text()).toBe(true);
    const runtimeConfig = await runtimeConfigResponse.json();
    test.skip(runtimeConfig.vertical !== "barber", "Barber-only isolation contract");

    await loginAdmin(page.request);
    await page.goto("/admin");

    await expect(page.locator("html")).not.toHaveAttribute("data-brand-theme", "beauty-clean");
    const heading = page.getByRole("heading", { name: "Painel Administrativo" });
    await expect(heading).toHaveCSS("color", "rgb(255, 255, 255)");

    const agenda = page.getByTestId("weekly-agenda");
    await expect(agenda).toBeVisible();
    const agendaBackground = await agenda.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(agendaBackground).not.toBe("rgb(255, 253, 251)");
  });

  test("keeps Beauty form labels, helpers, placeholders and disabled controls legible", async ({ page }) => {
    const runtimeConfigResponse = await page.request.get("/api/runtime-config");
    expect(runtimeConfigResponse.ok(), await runtimeConfigResponse.text()).toBe(true);
    const runtimeConfig = await runtimeConfigResponse.json();
    test.skip(runtimeConfig.vertical !== "beauty", "Beauty-only form contrast contract");

    await loginAdmin(page.request);

    const accountLocations = await (await page.request.get("/api/account/locations")).json();
    const locationHeaders = accountLocations[0]?.id
      ? { "X-Location-Id": String(accountLocations[0].id) }
      : undefined;
    const professionals = await (await page.request.get("/api/barbers", { headers: locationHeaders })).json();
    const services = await (await page.request.get("/api/services", { headers: locationHeaders })).json();
    const professional = professionals.find((candidate: any) => candidate.isVisible !== false);
    const service = services.find((candidate: any) => (
      candidate.isVisible !== false
      && (!Array.isArray(professional?.serviceIds) || professional.serviceIds.includes(candidate.id))
    ));
    expect(professional).toBeTruthy();
    expect(service).toBeTruthy();
    const appointmentName = `Contraste formulários ${Date.now()}`;
    const appointmentResponse = await page.request.post("/api/appointments/block", {
      headers: locationHeaders,
      data: {
        locationId: accountLocations[0]?.id,
        barberId: professional.id,
        serviceId: service.id,
        serviceMode: "existing",
        startTime: "2037-06-18T11:00:00.000Z",
        name: appointmentName,
        phone: "+351912690001",
        isManualBooking: true,
        isRecurring: false,
        allowOutsideHours: true,
      },
    });
    expect(appointmentResponse.status(), await appointmentResponse.text()).toBe(201);

    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/admin");

      await page.getByRole("button", { name: /Marca.*o manual/ }).click();
      await expectFormSurfaceLegible(page.getByRole("dialog", { name: /Marca.*o manual/ }));
      await page.keyboard.press("Escape");

      await page.getByRole("tab", { name: /Marca/ }).click();
      await page.getByRole("button", { name: /Pr.*ximas/ }).click();
      await page.getByRole("button", { name: new RegExp(`Abrir detalhes da marca.*o de ${appointmentName}`) }).click();
      await expectFormSurfaceLegible(page.getByRole("dialog", { name: /Detalhes da marca/i }));
      await page.keyboard.press("Escape");

      await page.getByRole("tab", { name: /Servi/ }).click();
      await page.getByRole("button", { name: /Adicionar Servi/, exact: true }).click();
      await expectFormSurfaceLegible(page.getByRole("dialog", { name: /Novo Servi/ }));
      await page.keyboard.press("Escape");

      const serviceCard = page.locator('[data-testid^="admin-service-card-"]').first();
      if (await serviceCard.count()) {
        await serviceCard.getByRole("button", { name: "Editar", exact: true }).click();
        await expectFormSurfaceLegible(page.getByRole("dialog", { name: "Editar Serviço" }));
        await page.keyboard.press("Escape");
      }

      await page.getByRole("button", { name: "Gerir categorias", exact: true }).click();
      const categoriesDialog = page.getByRole("dialog", { name: "Gerir categorias" });
      await expect(categoriesDialog).toBeVisible();
      const categoryInput = categoriesDialog.getByLabel("Nome da nova categoria");
      expect((await contrastRatio(categoryInput, categoryInput)).ratio).toBeGreaterThanOrEqual(7);
      await page.keyboard.press("Escape");

      await page.getByRole("tab", { name: "Extras", exact: true }).click();
      await page.getByRole("button", { name: "Novo Extra", exact: true }).click();
      await expectFormSurfaceLegible(page.getByRole("dialog", { name: "Novo Extra" }));
      await page.keyboard.press("Escape");

      await page.getByRole("tab", { name: "Custos / Consumos", exact: true }).click();
      await page.getByRole("button", { name: "Novo custo", exact: true }).click();
      await expectFormSurfaceLegible(page.getByRole("dialog", { name: "Novo custo/consumo" }));
      await page.keyboard.press("Escape");

      await page.getByRole("tab", { name: "Equipa", exact: true }).click();
      await page.getByRole("button", { name: "Adicionar Profissional", exact: true }).click();
      await expectFormSurfaceLegible(page.getByRole("dialog", { name: /Adicionar Profissional/ }));
      await page.keyboard.press("Escape");

      await page.getByRole("tab", { name: "Horário", exact: true }).click();
      const schedule = page.getByRole("tabpanel");
      const scheduleLabels = schedule.locator("label:visible");
      expect(await scheduleLabels.count()).toBeGreaterThan(0);
      expect((await contrastRatio(scheduleLabels.first(), page.locator(".admin-shell"))).ratio).toBeGreaterThanOrEqual(4.5);

      const locationsTab = page.getByRole("tab", { name: /Localiza/ });
      if (await locationsTab.count()) {
        await locationsTab.click();
        await page.getByRole("button", { name: /Nova localiza/ }).click();
        await expectFormSurfaceLegible(page.getByRole("dialog", { name: /Nova localiza/ }));
        await page.keyboard.press("Escape");
      }

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    }
  });
});
