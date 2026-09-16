import { expect, test, type Page } from "@playwright/test";

const section = (page: Page) => page.locator("#services");
const skeleton = (page: Page) => page.getByTestId("home-services-skeleton");

for (const width of [320, 1280]) {
  test(`initial services use shaped skeleton cards without empty content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/services", async (route) => {
      await gate;
      await route.continue();
    });

    try {
      await page.goto("/");
      await expect(skeleton(page)).toBeVisible();
      await expect(section(page)).toHaveAttribute("aria-busy", "true");
      await expect(page.getByTestId("home-service-skeleton-card")).toHaveCount(3);
      expect(await page.getByTestId("home-service-skeleton-card").first().locator("span").count()).toBeGreaterThan(3);
      await expect(section(page).locator("article")).toHaveCount(0);
      const before = await page.getByTestId("home-service-skeleton-card").first().boundingBox();
      expect(before).toBeTruthy();

      release();
      await expect(section(page).locator("article").first()).toBeVisible();
      await expect(skeleton(page)).toHaveCount(0);
      await expect(section(page)).toHaveAttribute("aria-busy", "false");
      const after = await section(page).locator("article").first().boundingBox();
      expect(after).toBeTruthy();
      expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(24);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      release();
    }
  });
}

test("a valid empty services list finishes loading without invented cards", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/services", async (route) => {
    await gate;
    await route.fulfill({ json: [] });
  });
  try {
    await page.goto("/");
    await expect(skeleton(page)).toBeVisible();
    release();
    await expect(skeleton(page)).toHaveCount(0);
    await expect(section(page)).toHaveAttribute("aria-busy", "false");
    await expect(section(page).locator("article")).toHaveCount(0);
    await expect(section(page).getByText("Não foi possível carregar os serviços")).toHaveCount(0);
  } finally {
    release();
  }
});

test("an initial services error ends loading with a neutral fallback", async ({ page }) => {
  await page.route("**/api/services", (route) => route.fulfill({ status: 500, json: { message: "indisponível" } }));
  await page.goto("/");
  await expect(section(page).getByText("Não foi possível carregar os serviços neste momento.")).toBeVisible();
  await expect(skeleton(page)).toHaveCount(0);
  await expect(section(page)).toHaveAttribute("aria-busy", "false");
  await expect(section(page).locator("article")).toHaveCount(0);
});

test("background services refetch keeps existing cards instead of showing skeletons", async ({ page }) => {
  let blockRefetch = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/api/services", async (route) => {
    requests += 1;
    if (blockRefetch) await gate;
    await route.continue();
  });
  try {
    await page.goto("/");
    await expect(section(page).locator("article").first()).toBeVisible();
    const initialCards = await section(page).locator("article").count();
    const initialRequests = requests;
    blockRefetch = true;
    await page.evaluate(async () => {
      const { queryClient } = await import("/src/lib/queryClient.ts");
      void queryClient.invalidateQueries({ queryKey: ["/api/services"] });
    });
    await expect.poll(() => requests).toBeGreaterThan(initialRequests);
    await expect(section(page).locator("article")).toHaveCount(initialCards);
    await expect(skeleton(page)).toHaveCount(0);
    await expect(section(page)).toHaveAttribute("aria-busy", "false");
    release();
    await expect(section(page).locator("article")).toHaveCount(initialCards);
    await expect(skeleton(page)).toHaveCount(0);
  } finally {
    release();
  }
});

test("a failed background services refetch retains the last usable cards", async ({ page }) => {
  let failRefetch = false;
  await page.route("**/api/services", (route) => failRefetch
    ? route.fulfill({ status: 500, json: { message: "indisponível" } })
    : route.continue());
  await page.goto("/");
  await expect(section(page).locator("article").first()).toBeVisible();
  const initialCards = await section(page).locator("article").count();
  failRefetch = true;
  const failed = page.waitForResponse((response) => response.url().endsWith("/api/services") && response.status() === 500);
  await page.evaluate(async () => {
    const { queryClient } = await import("/src/lib/queryClient.ts");
    void queryClient.invalidateQueries({ queryKey: ["/api/services"] });
  });
  await failed;
  await expect(section(page).locator("article")).toHaveCount(initialCards);
  await expect(skeleton(page)).toHaveCount(0);
  await expect(section(page).getByText("Não foi possível carregar os serviços")).toHaveCount(0);
});

test("services start independently of locations and are requested once on initial render", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let serviceRequests = 0;
  await page.route("**/api/locations", async (route) => {
    await gate;
    await route.continue();
  });
  await page.route("**/api/services", async (route) => {
    serviceRequests += 1;
    await route.continue();
  });
  try {
    await page.goto("/");
    await expect(section(page).locator("article").first()).toBeVisible();
    expect(serviceRequests).toBe(1);
    const locationsLoaded = page.waitForResponse((response) => response.url().endsWith("/api/locations") && response.ok());
    release();
    await locationsLoaded;
    expect(serviceRequests).toBe(1);
  } finally {
    release();
  }
});
