import { expect, test, type Page } from "@playwright/test";

async function loginAdmin(page: Page) {
  const response = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function mockReports(page: Page) {
  await page.route("**/api/multi-location/config", (route) => route.fulfill({
    json: { enabled: false, maxLocations: 1, bookingSlotIntervalMinutes: 30, recurringExpensesEnabled: true },
  }));
  await page.route("**/api/admin/dashboard?**", (route) => route.fulfill({
    json: {
      range: { startDate: "2026-10-01", endDate: "2026-10-30", days: 30, barberId: "all" },
      summary: { appointments: 0, completed: 0, booked: 0, cancellations: 0, noShows: 0, revenueCents: 0, nominalCompletedCents: 0, receivedCents: 0, cashCents: 0, cardCents: 0, voucherCents: 0, giftCents: 0, pendingPaymentCents: 0, projectedRevenueCents: 0, extrasRevenueCents: 0, barberRevenueCents: 0, establishmentRevenueCents: 0, commissionCents: 0, chairRentCents: 0, averageTicketCents: 0, completionRate: 0, noShowRate: 0, upcomingWeek: 0, inactiveCustomers: 0, busiestHour: null },
      daily: [], barbers: [], services: [], inactiveCustomers: [],
    },
  }));
  await page.route("**/api/admin/export/barbers?**", (route) => route.fulfill({ json: { active: [], historical: [] } }));
}

test("Barber manages recurring series and scoped occurrence edits on mobile and desktop", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockReports(page);
  let seriesState: "active" | "paused" = "active";
  let draftSeriesVisible = true;
  const mutationBodies: Array<{ method: string; url: string; body: any }> = [];
  const locationDate = new Date();
  const locationToday = locationDate.toISOString().slice(0, 10);
  const scheduledDate = locationToday;
  locationDate.setUTCDate(locationDate.getUTCDate() + 1);
  const minimumFutureEffectiveFrom = locationDate.toISOString().slice(0, 10);
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 28);
  const futureEffectiveDate = futureDate.toISOString().slice(0, 10);

  await page.route("**/api/admin/expenses?**", (route) => route.fulfill({
    json: [{
      id: 71, locationId: 1, category: "rent", description: "Renda da barbearia", amountCents: 45000,
      expenseDate: `${scheduledDate}T00:00:00.000Z`, recurrence: "monthly", notes: "Contrato principal",
      recurringSeriesId: 9, recurringVersionId: 12, scheduledDate, isOccurrenceOverride: false,
      createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    }],
  }));
  await page.route("**/api/admin/expenses/*/occurrence", async (route) => {
    mutationBodies.push({ method: route.request().method(), url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  await page.route("**/api/admin/expense-series**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      const body = request.postData() ? request.postDataJSON() : null;
      mutationBodies.push({ method: request.method(), url: request.url(), body });
      if (request.url().endsWith("/state")) seriesState = body.action === "pause" ? "paused" : "active";
      if (request.method() === "DELETE" && request.url().endsWith("/10")) draftSeriesVisible = false;
      await route.fulfill({ status: 200, json: { ok: true } });
      return;
    }
    await route.fulfill({ json: [{
      id: 9, locationId: 1, status: seriesState, anchorDate: "2026-10-01", endedOn: null,
      occurrenceCount: 1, hasOccurrences: true, locationToday, minimumFutureEffectiveFrom,
      nextOccurrenceDate: futureEffectiveDate,
      currentVersion: { id: 12, effectiveFrom: "2026-10-01", category: "rent", description: "Renda da barbearia", amountCents: 45000, recurrence: "monthly", weekday: null, monthDay: 1, notes: "Contrato principal", createdAt: "2026-10-01T09:00:00.000Z" },
      versions: [{ id: 12, effectiveFrom: "2026-10-01", category: "rent", description: "Renda da barbearia", amountCents: 45000, recurrence: "monthly", weekday: null, monthDay: 1, notes: "Contrato principal", createdAt: "2026-10-01T09:00:00.000Z" }],
      pauses: [],
      occurrences: [{ id: 71, scheduledDate, category: "rent", description: "Renda da barbearia", amountCents: 45000, recurrence: "monthly", notes: "Contrato principal", isOccurrenceOverride: false, updatedAt: "2026-10-01T09:00:00.000Z" }],
    }, ...(draftSeriesVisible ? [{
      id: 10, locationId: 1, status: "active", anchorDate: futureEffectiveDate, endedOn: null,
      occurrenceCount: 0, hasOccurrences: false, locationToday, minimumFutureEffectiveFrom,
      nextOccurrenceDate: futureEffectiveDate,
      currentVersion: { id: 13, effectiveFrom: futureEffectiveDate, category: "internet", description: "Subscrição futura", amountCents: 2990, recurrence: "monthly", weekday: null, monthDay: 1, notes: null, createdAt: "2026-10-01T09:00:00.000Z" },
      versions: [{ id: 13, effectiveFrom: futureEffectiveDate, category: "internet", description: "Subscrição futura", amountCents: 2990, recurrence: "monthly", weekday: null, monthDay: 1, notes: null, createdAt: "2026-10-01T09:00:00.000Z" }],
      pauses: [], occurrences: [],
    }] : [])] });
  });

  await loginAdmin(page);
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Relatórios", exact: true }).click();
  await expect(page.getByTestId("recurring-expenses-manager")).toBeVisible();
  await page.getByRole("button", { name: "Pausar" }).click();
  const pauseDialog = page.getByRole("dialog", { name: "Pausar recorrência" });
  await expect(pauseDialog.getByLabel("Data de início da pausa")).toHaveValue(minimumFutureEffectiveFrom);
  await pauseDialog.getByRole("button", { name: "Confirmar pausa" }).click();
  await expect.poll(() => mutationBodies.some((entry) => entry.url.endsWith("/api/admin/expense-series/9/state")
    && entry.body.action === "pause" && entry.body.effectiveFrom === minimumFutureEffectiveFrom)).toBe(true);

  await page.getByRole("button", { name: "Editar ocorrência Renda da barbearia" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar despesa recorrente" });
  await dialog.getByLabel("Âmbito da alteração").click();
  await expect(page.getByRole("option", { name: "Esta e as seguintes" })).toHaveAttribute("data-disabled");
  await page.keyboard.press("Escape");
  await dialog.getByLabel("Valor da ocorrência").fill("475,00");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect.poll(() => mutationBodies.some((entry) => entry.url.endsWith("/api/admin/expenses/71/occurrence")
    && entry.body.amountCents === 47500)).toBe(true);

  await page.getByTestId("recurring-expense-series-9").getByRole("button", { name: "Editar futuro" }).click();
  const futureDialog = page.getByRole("dialog", { name: "Alterar esta e as ocorrências seguintes" });
  await futureDialog.getByLabel("Data de efeito da série").fill(futureEffectiveDate);
  await futureDialog.getByLabel("Valor da série").fill("500,00");
  await futureDialog.getByRole("button", { name: "Guardar alteração futura" }).click();
  await expect.poll(() => mutationBodies.some((entry) => entry.url.endsWith("/api/admin/expense-series/9/versions")
    && entry.body.effectiveFrom === futureEffectiveDate && entry.body.amountCents === 50000)).toBe(true);

  const draftCard = page.getByTestId("recurring-expense-series-10");
  await expect(draftCard.getByRole("button", { name: "Editar", exact: true })).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await draftCard.getByRole("button", { name: "Apagar", exact: true }).click();
  await expect.poll(() => mutationBodies.some((entry) => entry.method === "DELETE"
    && entry.url.endsWith("/api/admin/expense-series/10"))).toBe(true);

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByTestId("recurring-expenses-manager")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test("enabled recurrence selector creates a recurring series instead of a labelled one-off", async ({ page }) => {
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
  await page.getByPlaceholder("Ex.: renda de julho, lâminas, eletricidade").fill("Subscrição mensal");
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
