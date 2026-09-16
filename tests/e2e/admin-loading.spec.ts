import { expect, test } from "@playwright/test";

for (const failAgenda of [false, true]) {
  test(`admin prioritizes initial agenda reads and releases secondary panels after ${failAgenda ? "error" : "success"}`, async ({ page }) => {
    const login = await page.request.post("/api/admin/login", {
      data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
    });
    expect(login.ok()).toBe(true);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "GET") requests.push(new URL(request.url()).pathname);
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held = 0;
    await page.route("**/api/appointments{,?*}", async (route) => {
      if (new URL(route.request().url()).searchParams.has("date")) return route.continue();
      held += 1;
      await gate;
      if (failAgenda) return route.fulfill({ status: 500, json: { message: "Synthetic test failure" } });
      return route.continue();
    });
    const catalogueReady = Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/barbers" && response.ok()),
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/services" && response.ok()),
    ]);
    try {
      await page.goto("/admin");
      await expect(page.getByRole("tab", { name: "Agenda", exact: true })).toBeVisible();
      await catalogueReady;
      await expect.poll(() => held).toBeGreaterThan(0);
      expect(requests).not.toContain("/api/admin/dashboard");
      expect(requests).not.toContain("/api/admin/audit-logs");
      expect(requests).not.toContain("/api/admin/expenses");
      // Blacklist remains available to the manual booking form from the start.
      await expect.poll(() => requests.includes("/api/admin/blacklist")).toBe(true);
      release();
      await expect.poll(() => requests.includes("/api/admin/dashboard")).toBe(true);
      await expect.poll(() => requests.includes("/api/admin/audit-logs")).toBe(true);
      expect(requests).not.toContain("/api/admin/expenses");
      await page.getByRole("tab", { name: "Relatórios", exact: true }).click();
      await expect.poll(() => requests.includes("/api/admin/expenses")).toBe(true);
      await expect(page.getByTestId("business-expenses-total")).toBeVisible();
    } finally {
      release();
    }
  });
}

test("background agenda refresh does not pause secondary requests with existing data", async ({ page }) => {
  const login = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(login.ok()).toBe(true);
  const initialPanels = Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/dashboard" && response.ok()),
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/audit-logs" && response.ok()),
  ]);
  await page.goto("/admin");
  await initialPanels;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let held = 0;
  await page.route("**/api/appointments{,?*}", async (route) => {
    held += 1;
    await gate;
    return route.continue();
  });
  try {
    await page.evaluate(async () => {
      const { queryClient } = await import("/src/lib/queryClient.ts");
      void queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
    });
    await expect.poll(() => held).toBeGreaterThan(0);
    const refreshedPanels = Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/dashboard" && response.ok()),
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/audit-logs" && response.ok()),
    ]);
    await page.evaluate(async () => {
      const { queryClient } = await import("/src/lib/queryClient.ts");
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
    });
    // These must finish while the appointments refresh is still held.
    await refreshedPanels;
    await expect(page.getByRole("tab", { name: "Agenda", exact: true })).toBeVisible();
  } finally {
    release();
  }
});
