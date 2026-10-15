import { expect, test, type Page } from "@playwright/test";

async function loginAdmin(page: Page) {
  const response = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function mockReports(page: Page) {
  await page.route("**/api/admin/dashboard?**", (route) => route.fulfill({
    json: {
      range: { startDate: "2026-10-01", endDate: "2026-10-30", days: 30, barberId: "all" },
      summary: { appointments: 0, completed: 0, booked: 0, cancellations: 0, noShows: 0, revenueCents: 0, nominalCompletedCents: 0, receivedCents: 0, cashCents: 0, cardCents: 0, voucherCents: 0, giftCents: 0, pendingPaymentCents: 0, projectedRevenueCents: 0, extrasRevenueCents: 0, barberRevenueCents: 0, establishmentRevenueCents: 0, commissionCents: 0, chairRentCents: 0, averageTicketCents: 0, completionRate: 0, noShowRate: 0, upcomingWeek: 0, inactiveCustomers: 0, busiestHour: null },
      daily: [], barbers: [], services: [], inactiveCustomers: [],
    },
  }));
  await page.route("**/api/admin/export/barbers?**", (route) => route.fulfill({ json: { active: [], historical: [] } }));
}

test("Beauty manages recurring series and scoped occurrence edits on mobile and desktop", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockReports(page);
  let seriesState: "active" | "paused" | "ended" = "active";
  const mutationBodies: Array<{ url: string; body: any }> = [];
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 28);
  const scheduledDate = futureDate.toISOString().slice(0, 10);

  await page.route("**/api/admin/expenses?**", (route) => route.fulfill({
    json: [{
      id: 71,
      locationId: 1,
      category: "rent",
      description: "Renda do espaço",
      amountCents: 45000,
      expenseDate: `${scheduledDate}T00:00:00.000Z`,
      recurrence: "monthly",
      notes: "Contrato principal",
      recurringSeriesId: 9,
      recurringVersionId: 12,
      scheduledDate,
      isOccurrenceOverride: false,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    }],
  }));
  await page.route("**/api/admin/expense-series**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      mutationBodies.push({ url: request.url(), body: request.postDataJSON() });
      if (request.url().endsWith("/state")) seriesState = request.postDataJSON().action === "pause" ? "paused" : "active";
      await route.fulfill({ status: 200, json: { ok: true } });
      return;
    }
    await route.fulfill({ json: [{
      id: 9,
      locationId: 1,
      status: seriesState,
      anchorDate: "2026-10-01",
      endedOn: null,
      nextOccurrenceDate: scheduledDate,
      currentVersion: { id: 12, effectiveFrom: "2026-10-01", category: "rent", description: "Renda do espaço", amountCents: 45000, recurrence: "monthly", weekday: null, monthDay: 1, notes: "Contrato principal", createdAt: "2026-10-01T09:00:00.000Z" },
      versions: [{ id: 12, effectiveFrom: "2026-10-01", category: "rent", description: "Renda do espaço", amountCents: 45000, recurrence: "monthly", weekday: null, monthDay: 1, notes: "Contrato principal", createdAt: "2026-10-01T09:00:00.000Z" }],
      pauses: [],
      occurrences: [{ id: 71, scheduledDate, category: "rent", description: "Renda do espaço", amountCents: 45000, recurrence: "monthly", notes: "Contrato principal", isOccurrenceOverride: false, updatedAt: "2026-10-01T09:00:00.000Z" }],
    }] });
  });

  await loginAdmin(page);
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Relatórios", exact: true }).click();
  await expect(page.getByTestId("recurring-expenses-manager")).toBeVisible();
  await expect(page.getByTestId("recurring-expense-series-9")).toContainText("Renda do espaço");
  await expect(page.getByText("Ativa", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pausar" }).click();
  await expect.poll(() => mutationBodies.some((entry) => entry.url.endsWith("/api/admin/expense-series/9/state") && entry.body.action === "pause")).toBe(true);

  await page.getByRole("button", { name: "Editar ocorrência Renda do espaço" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar despesa recorrente" });
  await expect(dialog.getByLabel("Âmbito da alteração")).toContainText("Apenas esta ocorrência");
  await dialog.getByLabel("Âmbito da alteração").click();
  await page.getByRole("option", { name: "Esta e as seguintes" }).click();
  await dialog.getByLabel("Valor da ocorrência").fill("475,00");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect.poll(() => mutationBodies.some((entry) => entry.url.endsWith("/api/admin/expense-series/9/versions") && entry.body.amountCents === 47500)).toBe(true);

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByTestId("recurring-expenses-manager")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test("Beauty recurrence selector creates a canonical series instead of a labelled one-off", async ({ page }) => {
  await mockReports(page);
  const mutations: any[] = [];
  await page.route("**/api/admin/expenses?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/expense-series**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    mutations.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { series: { id: 1 }, version: { id: 1 } } });
  });
  await loginAdmin(page);
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Relatórios", exact: true }).click();
  await page.getByPlaceholder("Ex.: renda de julho, materiais, eletricidade").fill("Subscrição mensal");
  await page.getByPlaceholder("Ex.: 125,50").fill("29,90");
  await page.getByRole("combobox").filter({ hasText: "Única" }).click();
  await page.getByRole("option", { name: "Mensal", exact: true }).click();
  await page.getByRole("button", { name: "Registar despesa" }).click();
  await expect.poll(() => mutations.length).toBe(1);
  expect(mutations[0]).toMatchObject({ description: "Subscrição mensal", amountCents: 2990, recurrence: "monthly" });
  expect(mutations[0].startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(mutations[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(mutations[0].expenseDate).toBeUndefined();
});
