import { expect, test, type Page } from "@playwright/test";

const location = {
  id: 1, name: "Beauty Studio QA", slug: "beauty-qa", address: "Rua QA", logoUrl: null,
  mapUrl: null, mapEmbedUrl: null, phone: null, email: null, timezone: "Europe/Lisbon",
  isActive: true, isDefault: true, sortOrder: 0,
  createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z",
};
const services = [
  { id: 11, name: "Manicure", description: "Cuidado completo", price: 2500, duration: 45, isVisible: true, categoryId: null },
  { id: 12, name: "Nail art", description: "Decoração", price: 900, duration: 30, isVisible: true, categoryId: null },
];
const professionals = [
  { id: 21, name: "Ana", specialty: "Manicure", bio: null, avatar: null, color: "#d6a1ad", isVisible: true, locationCount: 1, serviceIds: [11], allServicesAllowed: false },
  { id: 22, name: "Beatriz", specialty: "Nail art", bio: null, avatar: null, color: "#d6a1ad", isVisible: true, locationCount: 1, serviceIds: [12], allServicesAllowed: false },
];

async function mockBeautyV2(page: Page) {
  await page.route("**/api/beauty-v2/features", (route) => route.fulfill({ json: { enabled: true, appointmentRequests: true, multiServiceAppointments: true } }));
  await page.route("**/api/locations", (route) => route.fulfill({ json: [location] }));
  await page.route("**/api/services", (route) => route.fulfill({ json: services }));
  await page.route("**/api/barbers?avatarMode=reference", (route) => route.fulfill({ json: professionals }));
  await page.route("**/api/booking-window", (route) => route.fulfill({ json: { enabled: false, today: "2030-06-01", maxDate: "2030-07-31", openDay: 1 } }));
  await page.route("**/api/appointment-requests/availability", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: {
      date: body.date, timeZone: "Europe/Lisbon", starts: [`${body.date}T09:00:00.000Z`],
      durationMinutes: 75, totalPriceCents: 3400,
      segments: [
        { position: 0, serviceId: 11, barberId: 21, durationMinutes: 45, serviceName: "Manicure", priceCents: 2500 },
        { position: 1, serviceId: 12, barberId: 22, durationMinutes: 30, serviceName: "Nail art", priceCents: 900 },
      ],
    } });
  });
}

test("Beauty v2 public flow submits a multi-service request without claiming confirmation on desktop and mobile", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2030-06-01T08:00:00+01:00"));
  await mockBeautyV2(page);
  const submitted: unknown[] = [];
  await page.route("**/api/appointment-requests", async (route) => {
    if (route.request().url().endsWith("/availability")) return route.fallback();
    submitted.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { request: { id: 44, status: "pending" }, reused: false } });
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/booking");
    await expect(page.getByTestId("beauty-v2-booking")).toBeVisible();
    await page.getByRole("button", { name: /Manicure/ }).click();
    await page.getByRole("button", { name: /Nail art/ }).click();
    await page.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: "Ana" }).click();
    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Beatriz" }).click();
    await expect(page.getByText("Duração total: 75 min")).toBeVisible();
    await page.getByRole("button", { name: /10:00/ }).click();
    await page.getByLabel("Nome *").fill("Cliente QA");
    await page.getByLabel("Telemóvel *").fill("912345678");
    await page.getByRole("button", { name: "Enviar pedido" }).click();
    await expect(page.getByRole("heading", { name: "Pedido recebido" })).toBeVisible();
    await expect(page.getByText(/ainda não é uma marcação confirmada/i)).toBeVisible();
  }
  expect(submitted).toHaveLength(2);
  expect(submitted[0]).toMatchObject({ services: [{ serviceId: 11, barberId: 21 }, { serviceId: 12, barberId: 22 }] });
});

test("proposal response keeps the token in the URL fragment and handles unavailable clipboard-free links", async ({ page }) => {
  const token = "a".repeat(43);
  let accepted = false;
  await page.route("**/api/appointment-request-proposals/inspect", (route) => route.fulfill({ json: {
    status: "active", requestStatus: "proposed", proposedStartTime: "2030-06-02T09:00:00.000Z",
    expiresAt: "2030-06-03T09:00:00.000Z", services: [{ position: 0, name: "Manicure", durationMinutes: 45, priceCents: 2500 }],
  } }));
  await page.route("**/api/appointment-request-proposals/respond", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token, decision: "accept" });
    accepted = true;
    await route.fulfill({ json: { decision: "accepted", reused: false } });
  });
  await page.goto(`/appointment-request/proposal#token=${token}`);
  expect(page.url()).toContain(`#token=${token}`);
  await expect(page.getByRole("heading", { name: "Novo horário sugerido" })).toBeVisible();
  await page.getByRole("button", { name: "Aceitar horário" }).click();
  await expect(page.getByRole("heading", { name: "Novo horário aceite" })).toBeVisible();
  expect(accepted).toBe(true);
});

test("authorized Admin can review and approve a request from the location-scoped inbox", async ({ page }) => {
  const login = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Beauty-v2-Admin-2026!" },
  });
  expect(login.ok()).toBe(true);
  await page.route("**/api/beauty-v2/features", (route) => route.fulfill({ json: { enabled: true, appointmentRequests: true, multiServiceAppointments: true } }));
  const request = {
    id: 44, locationId: 1, status: "pending", revision: 1, customerName: "Cliente QA",
    customerPhone: "+351912345678", customerEmail: "qa@example.test",
    requestedStartTime: "2030-06-02T09:00:00.000Z", appointmentId: null, refusalReason: null,
    createdAt: "2030-06-01T08:00:00.000Z", activeProposal: null,
    segments: [{ position: 0, serviceId: 11, barberId: 21, startTime: "2030-06-02T09:00:00.000Z", durationMinutes: 45, serviceNameSnapshot: "Manicure", servicePriceCentsSnapshot: 2500 }],
    history: [{ id: 1, event_type: "request_created", actor_type: "client", from_status: null, to_status: "pending", reason: null, created_at: "2030-06-01T08:00:00.000Z" }],
  };
  let approved = false;
  await page.route("**/api/admin/appointment-requests**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/approve")) {
      approved = true;
      return route.fulfill({ json: { request: { ...request, status: "approved" }, appointment: { id: 99 } } });
    }
    if (url.pathname === "/api/admin/appointment-requests/44") return route.fulfill({ json: request });
    return route.fulfill({ json: [request] });
  });
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Pedidos" }).click();
  await expect(page.getByTestId("appointment-requests-manager")).toBeVisible();
  await page.getByRole("button", { name: "Ver e decidir" }).click();
  await expect(page.getByText("Pedido recebido — ainda não é uma marcação confirmada.")).toBeVisible();
  await page.getByRole("button", { name: "Aprovar" }).click();
  await expect.poll(() => approved).toBe(true);
});
