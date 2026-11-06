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
  { id: 13, name: "Pedicure spa", description: "Cuidado e hidratação dos pés", price: 3200, duration: 60, isVisible: true, categoryId: null },
  { id: 14, name: "Design de sobrancelhas", description: "Definição personalizada", price: 1800, duration: 30, isVisible: true, categoryId: null },
  { id: 15, name: "Lifting de pestanas", description: "Curvatura e definição natural", price: 3800, duration: 75, isVisible: true, categoryId: null },
  { id: 16, name: "Limpeza de pele", description: "Tratamento facial completo", price: 4500, duration: 90, isVisible: true, categoryId: null },
  { id: 17, name: "Massagem relaxante", description: "Massagem corporal localizada", price: 3500, duration: 60, isVisible: true, categoryId: null },
  { id: 18, name: "Coloração", description: "Coloração e finalização", price: 5000, duration: 120, isVisible: true, categoryId: null },
];
const professionals = [
  { id: 21, name: "Ana", specialty: "Unhas e pedicure", bio: null, avatar: null, color: "#d6a1ad", isVisible: true, locationCount: 1, serviceIds: [11, 13, 18], allServicesAllowed: false },
  { id: 22, name: "Beatriz", specialty: "Nail art e pestanas", bio: null, avatar: null, color: "#d6a1ad", isVisible: true, locationCount: 1, serviceIds: [12, 15], allServicesAllowed: false },
  { id: 23, name: "Carolina", specialty: "Rosto e bem-estar", bio: null, avatar: null, color: "#d6a1ad", isVisible: true, locationCount: 1, serviceIds: [14, 16, 17], allServicesAllowed: false },
];

async function contrastRatio(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((element) => {
    const parse = (value: string) => {
      const match = value.match(/rgba?\((\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)(?:[,\s/]+(\d+(?:\.\d+)?))?\)/);
      if (!match) throw new Error(`Unsupported computed color: ${value}`);
      return { red: Number(match[1]), green: Number(match[2]), blue: Number(match[3]), alpha: match[4] === undefined ? 1 : Number(match[4]) };
    };
    const foreground = parse(getComputedStyle(element).color);
    let background = { red: 255, green: 255, blue: 255, alpha: 1 };
    let current: Element | null = element;
    while (current) {
      const candidate = parse(getComputedStyle(current).backgroundColor);
      if (candidate.alpha > 0.98) {
        background = candidate;
        break;
      }
      current = current.parentElement;
    }
    const channel = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (color: typeof background) => 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    return (light + 0.05) / (dark + 0.05);
  });
}

async function mockBeautyV2(page: Page) {
  await page.route("**/api/beauty-v2/features", (route) => route.fulfill({ json: { enabled: true, appointmentRequests: true, multiServiceAppointments: true } }));
  await page.route("**/api/locations", (route) => route.fulfill({ json: [location] }));
  await page.route("**/api/services", (route) => route.fulfill({ json: services }));
  await page.route("**/api/barbers?avatarMode=reference", (route) => route.fulfill({ json: professionals }));
  await page.route("**/api/public-booking-window**", (route) => route.fulfill({ json: { enabled: false, today: "2030-06-01", maxDate: "2030-07-31", openDay: 1 } }));
  await page.route("**/api/appointment-requests/availability", async (route) => {
    const body = route.request().postDataJSON() as { date: string; services: Array<{ serviceId: number; barberId: number }> };
    const segments = body.services.map((selection, position) => {
      const service = services.find((item) => item.id === selection.serviceId)!;
      return {
        position,
        serviceId: service.id,
        barberId: selection.barberId,
        durationMinutes: service.duration,
        serviceName: service.name,
        priceCents: service.price,
      };
    });
    await route.fulfill({ json: {
      date: body.date, timeZone: "Europe/Lisbon", starts: ["09:00", "10:30", "12:00", "14:00", "15:30", "17:00"].map((time) => `${body.date}T${time}:00.000Z`),
      durationMinutes: segments.reduce((total, segment) => total + segment.durationMinutes, 0),
      totalPriceCents: segments.reduce((total, segment) => total + segment.priceCents, 0),
      segments,
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

test("Beauty v2 booking keeps Beauty contrast, hierarchy and selection states on desktop and mobile", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2030-06-01T08:00:00+01:00"));
  await mockBeautyV2(page);

  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1366, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/booking");

    await expect(page.getByRole("heading", { name: "Serviços" })).toBeVisible();
    await expect(page.getByText("Escolha um serviço", { exact: true }).last()).toBeVisible();
    await expect(page.locator(".beauty-v2-calendar-caption")).toBeVisible();
    await expect(page.locator(".booking-calendar-day-selected")).toHaveCount(1);
    await expect(page.locator(".booking-calendar-day-disabled").first()).toBeVisible();
    await expect(page.locator("label[for=request-name]")).toBeVisible();

    const serviceName = page.getByRole("button", { name: /Manicure/ }).locator("strong");
    expect(await contrastRatio(serviceName)).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(page.locator(".beauty-v2-calendar-caption"))).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(page.locator("label[for=request-name]"))).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(page.getByRole("button", { name: "Enviar pedido" }))).toBeGreaterThanOrEqual(4.5);

    await page.getByRole("button", { name: /Manicure/ }).focus();
    await expect(page.getByRole("button", { name: /Manicure/ })).toBeFocused();
    await page.getByRole("button", { name: /Manicure/ }).click();
    await expect(page.getByText("Escolha os profissionais")).toBeVisible();
    await page.getByRole("combobox", { name: "Profissional para Manicure" }).click();
    await page.getByRole("option", { name: "Ana" }).click();

    const availableSlot = page.locator(".booking-time-slot-available").first();
    await expect(availableSlot).toBeVisible();
    expect(await contrastRatio(availableSlot)).toBeGreaterThanOrEqual(4.5);
    await availableSlot.click();
    const selectedSlot = page.locator(".booking-time-slot-selected");
    await expect(selectedSlot).toHaveAttribute("aria-pressed", "true");
    expect(await contrastRatio(selectedSlot)).toBeGreaterThanOrEqual(4.5);

    await page.screenshot({ path: `test-results/beauty-v2-booking-${viewport.name}.png`, fullPage: true });
  }
});

test("Beauty v2 booking exposes loading, empty and error availability states", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2030-06-01T08:00:00+01:00"));
  await mockBeautyV2(page);
  await page.unroute("**/api/appointment-requests/availability");

  let releaseAvailability: () => void = () => undefined;
  const availabilityGate = new Promise<void>((resolve) => { releaseAvailability = resolve; });
  await page.route("**/api/appointment-requests/availability", async (route) => {
    const body = route.request().postDataJSON() as { date: string };
    await availabilityGate;
    await route.fulfill({ json: {
      date: body.date,
      timeZone: "Europe/Lisbon",
      starts: [],
      durationMinutes: 45,
      totalPriceCents: 2500,
      segments: [],
    } });
  });

  await page.goto("/booking");
  await page.getByRole("button", { name: /Manicure/ }).click();
  await page.getByRole("combobox", { name: "Profissional para Manicure" }).click();
  await page.getByRole("option", { name: "Ana" }).click();
  await expect(page.getByText("A calcular horários...")).toBeVisible();
  releaseAvailability();
  await expect(page.getByText("Sem horários disponíveis")).toBeVisible();

  await page.unroute("**/api/appointment-requests/availability");
  await page.route("**/api/appointment-requests/availability", (route) => route.fulfill({ status: 503, json: { message: "Unavailable" } }));
  await page.locator(".booking-calendar-day").filter({ hasText: /^2$/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Não foi possível consultar os horários" })).toBeVisible();
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
