import { expect, test, type Page } from "@playwright/test";

async function expectTeamImagesToFillCards(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");

  const cards = page.locator("#team article");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  await cards.first().scrollIntoViewIfNeeded();

  await expect.poll(async () => cards.evaluateAll((elements) => elements.every((card) => {
    const image = card.querySelector("img");
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  }))).toBe(true);

  const gaps = await cards.evaluateAll((elements) => elements.map((card) => {
    const image = card.querySelector("img");
    if (!(image instanceof HTMLImageElement)) return Number.POSITIVE_INFINITY;
    return Math.abs(card.getBoundingClientRect().bottom - image.getBoundingClientRect().bottom);
  }));

  for (const gap of gaps) expect(gap).toBeLessThanOrEqual(1);
}

test("barber photos fill equal-height team cards on desktop", async ({ page }) => {
  await expectTeamImagesToFillCards(page, 1280);
});

test("barber photos continue to fill team cards on mobile", async ({ page }) => {
  await expectTeamImagesToFillCards(page, 390);
});
