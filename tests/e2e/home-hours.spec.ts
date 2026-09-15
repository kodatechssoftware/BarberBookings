import { expect, test, type Page } from "@playwright/test";

const openTuesday = [{ dayOfWeek: 2, startTime: "09:00", endTime: "20:00", isOpen: true }];
const card = (page: Page) => page.getByTestId("home-opening-card");
const skeleton = (page: Page) => page.getByTestId("home-opening-skeleton");

for (const [time, title] of [
  ["08:00", "Abre hoje às 9h"],
  ["13:30", "Reabre hoje às 14h"],
  ["21:00", "Fechado agora"],
] as const) {
  test(`loaded hours retain the existing '${title}' calculation`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(`2026-09-15T${time}:00+01:00`));
    await page.route("**/api/shop/availability", (route) => route.fulfill({ json: [
      { dayOfWeek: 2, startTime: "09:00", endTime: "13:00", isOpen: true },
      { dayOfWeek: 2, startTime: "14:00", endTime: "20:00", isOpen: true },
    ] }));
    await page.goto("/");
    await expect(card(page).getByText(title, { exact: true })).toBeVisible();
    await expect(skeleton(page)).toHaveCount(0);
  });
}

for (const width of [320, 1280]) {
  test(`homepage waits for real opening hours without layout shift at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.clock.setFixedTime(new Date("2026-09-15T10:00:00+01:00"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/shop/availability", async (route) => {
      await gate;
      await route.fulfill({ json: openTuesday });
    });
    try {
      await page.goto("/");
      await expect(skeleton(page)).toBeVisible();
      await expect(card(page)).toHaveAttribute("aria-busy", "true");
      await expect(card(page).getByText("Consulte os horários")).toHaveCount(0);
      const before = await card(page).boundingBox();
      expect(before).toBeTruthy();
      release();
      await expect(card(page).getByText("Aberto hoje até às 20h")).toBeVisible();
      await expect(skeleton(page)).toHaveCount(0);
      await expect(card(page)).toHaveAttribute("aria-busy", "false");
      const after = await card(page).boundingBox();
      expect(after).toBeTruthy();
      expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(2);
      expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      release();
    }
  });
}

test("a valid empty response completes loading and retains the existing Sunday-closed rule", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.clock.setFixedTime(new Date("2026-09-20T12:00:00+01:00"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/shop/availability", async (route) => {
    await gate;
    await route.fulfill({ json: [] });
  });
  try {
    await page.goto("/");
    await expect(skeleton(page)).toBeVisible();
    const before = await card(page).boundingBox();
    release();
    await expect(card(page).getByText("Fechado hoje", { exact: true })).toBeVisible();
    await expect(skeleton(page)).toHaveCount(0);
    await expect(card(page)).toHaveAttribute("aria-busy", "false");
    const after = await card(page).boundingBox();
    expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(2);
  } finally {
    release();
  }
});

test("an empty response on a weekday still uses the legacy default hours", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-15T10:00:00+01:00"));
  await page.route("**/api/shop/availability", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await expect(card(page).getByText("Aberto hoje até às 13h", { exact: true })).toBeVisible();
  await expect(skeleton(page)).toHaveCount(0);
});

test("a failed first request shows neutral fallback instead of endless loading", async ({ page }) => {
  await page.route("**/api/shop/availability", (route) => route.fulfill({ status: 500, json: { message: "indisponível" } }));
  await page.goto("/");
  await expect(card(page).getByText("Consulte os horários", { exact: true })).toBeVisible();
  await expect(card(page).getByText("Atendimento por hora marcada.", { exact: true })).toBeVisible();
  await expect(skeleton(page)).toHaveCount(0);
  await expect(card(page)).toHaveAttribute("aria-busy", "false");
});

test("background refetch keeps the last known opening status and does not show skeleton", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-15T10:00:00+01:00"));
  let blockRefetch = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/api/shop/availability", async (route) => {
    requests += 1;
    if (blockRefetch) await gate;
    await route.fulfill({ json: openTuesday });
  });
  try {
    await page.goto("/");
    await expect(card(page).getByText("Aberto hoje até às 20h")).toBeVisible();
    const initialRequests = requests;
    blockRefetch = true;
    await page.evaluate(async () => {
      const { queryClient } = await import("/src/lib/queryClient.ts");
      void queryClient.invalidateQueries({ queryKey: ["/api/shop/availability"] });
    });
    await expect.poll(() => requests).toBeGreaterThan(initialRequests);
    await expect(card(page).getByText("Aberto hoje até às 20h")).toBeVisible();
    await expect(skeleton(page)).toHaveCount(0);
    await expect(card(page)).toHaveAttribute("aria-busy", "false");
    const completed = page.waitForResponse((response) => response.url().endsWith("/api/shop/availability") && response.ok());
    release();
    await completed;
    await expect(card(page).getByText("Aberto hoje até às 20h")).toBeVisible();
    await expect(skeleton(page)).toHaveCount(0);
  } finally {
    release();
  }
});

test("a failed background refetch retains the last usable hours instead of the neutral fallback", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-15T10:00:00+01:00"));
  let failRefetch = false;
  await page.route("**/api/shop/availability", (route) => failRefetch
    ? route.fulfill({ status: 500, json: { message: "indisponível" } })
    : route.fulfill({ json: openTuesday }));
  await page.goto("/");
  await expect(card(page).getByText("Aberto hoje até às 20h")).toBeVisible();
  failRefetch = true;
  const failed = page.waitForResponse((response) => response.url().endsWith("/api/shop/availability") && response.status() === 500);
  await page.evaluate(async () => {
    const { queryClient } = await import("/src/lib/queryClient.ts");
    void queryClient.invalidateQueries({ queryKey: ["/api/shop/availability"] });
  });
  await failed;
  await expect(card(page).getByText("Aberto hoje até às 20h")).toBeVisible();
  await expect(card(page).getByText("Consulte os horários")).toHaveCount(0);
  await expect(skeleton(page)).toHaveCount(0);
});
