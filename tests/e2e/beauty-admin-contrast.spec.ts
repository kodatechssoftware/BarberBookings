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
});
