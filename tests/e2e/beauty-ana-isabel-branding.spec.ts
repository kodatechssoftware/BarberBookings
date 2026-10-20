import { expect, test } from "@playwright/test";

test("Ana Isabel deployment profile preserves its Home, metadata and manifest", async ({ page }) => {
  const documentResponse = await page.request.get("/");
  expect(documentResponse.ok()).toBe(true);
  const documentHtml = await documentResponse.text();
  expect(documentHtml).toContain('<title>Ana Isabel Nail Art &amp; Design</title>');
  expect(documentHtml).toContain('property="og:title" content="Ana Isabel Nail Art &amp; Design"');
  expect(documentHtml).toContain('property="og:image" content="/images/beauty-brand/ana-isabel-hero.svg"');
  expect(documentHtml).not.toContain("__BUSINESS_");

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  await expect(manifestResponse.json()).resolves.toMatchObject({
    name: "Ana Isabel Nail Art & Design",
    short_name: "Ana Isabel",
    description: "Nail art e cuidados de beleza com atenção a cada detalhe.",
    background_color: "#fbf8f4",
    theme_color: "#d6a1ad",
    icons: [{
      src: "/images/beauty-brand/ana-isabel-icon.svg",
      type: "image/svg+xml",
    }],
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page).toHaveTitle("Ana Isabel Nail Art & Design");
    await expect(page.locator("html")).toHaveAttribute("data-brand-theme", "beauty-clean");
    await expect(page.getByRole("heading", { name: "Unhas com detalhe, elegância e personalidade" })).toBeVisible();
    await expect(page.getByText("Cuidados personalizados, nail art e beleza com atenção a cada detalhe.")).toBeVisible();
    await expect(page.locator('img[src="/images/beauty-brand/ana-isabel-hero.svg"]')).toBeVisible();
    await expect(page.locator('img[src="/images/beauty-brand/ana-isabel-logo-horizontal.svg"]').first()).toBeVisible();
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/images/beauty-brand/ana-isabel-icon.svg");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Nail art e cuidados de beleza com atenção a cada detalhe.");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Ana Isabel Nail Art & Design");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "/images/beauty-brand/ana-isabel-hero.svg");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
  }
});
