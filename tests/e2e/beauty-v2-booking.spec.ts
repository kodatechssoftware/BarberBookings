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

test.beforeEach(async ({ page }) => {
  await page.route("**/api/admin/request-notifications**", (route) => route.fulfill({
    json: { items: [], unreadCount: 0, pendingDecisionCount: 0 },
  }));
});

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
  await page.route("**/api/beauty-v2/features", (route) => route.fulfill({ json: { enabled: true, appointmentRequests: true, multiServiceAppointments: true, parallelServiceScheduling: true } }));
  await page.route("**/api/locations", (route) => route.fulfill({ json: [location] }));
  await page.route("**/api/services", (route) => route.fulfill({ json: services }));
  await page.route("**/api/barbers?avatarMode=reference", (route) => route.fulfill({ json: professionals }));
  await page.route("**/api/public-booking-window**", (route) => route.fulfill({ json: { enabled: false, today: "2030-06-01", maxDate: "2030-07-31", openDay: 1 } }));
  await page.route("**/api/appointment-requests/availability", async (route) => {
    const body = route.request().postDataJSON() as {
      date: string;
      executionMode: "sequential" | "parallel";
      services: Array<{ serviceId: number; barberId: number }>;
    };
    let elapsed = 0;
    const segments = body.services.map((selection, position) => {
      const service = services.find((item) => item.id === selection.serviceId)!;
      const startOffsetMinutes = body.executionMode === "parallel" ? 0 : elapsed;
      if (body.executionMode === "sequential") elapsed += service.duration;
      return {
        position,
        executionStage: body.executionMode === "parallel" ? 0 : position,
        serviceId: service.id,
        barberId: selection.barberId,
        durationMinutes: service.duration,
        serviceName: service.name,
        priceCents: service.price,
        startOffsetMinutes,
      };
    });
    const sequentialDurationMinutes = segments.reduce((total, segment) => total + segment.durationMinutes, 0);
    const parallelDurationMinutes = Math.max(...segments.map((segment) => segment.durationMinutes));
    await route.fulfill({ json: {
      date: body.date, timeZone: "Europe/Lisbon", starts: ["09:00", "10:30", "12:00", "14:00", "15:30", "17:00"].map((time) => `${body.date}T${time}:00.000Z`),
      executionMode: body.executionMode,
      parallelEligible: segments.length > 1,
      sequentialDurationMinutes,
      parallelDurationMinutes,
      durationMinutes: body.executionMode === "parallel" ? parallelDurationMinutes : sequentialDurationMinutes,
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
    await expect(page.getByText("Duração prevista: 75 min")).toBeVisible();
    const parallelChoice = page.getByRole("radio", { name: /Em simultâneo/ });
    await expect(parallelChoice).toBeVisible();
    await parallelChoice.click();
    await expect(page.getByText("Duração prevista: 45 min")).toBeVisible();
    await expect(page.getByTestId("parallel-service-plan").getByText("Ao mesmo tempo", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /10:00/ }).click();
    await page.getByLabel("Nome *").fill("Cliente QA");
    await page.getByLabel("Telemóvel *").fill("912345678");
    await page.getByRole("button", { name: "Enviar pedido de marcação" }).click();
    await expect(page.getByRole("heading", { name: "Pedido enviado com sucesso!" })).toBeVisible();
    await expect(page.getByText(/só ficará confirmada depois de o pedido ser aprovado/i)).toBeVisible();
    await expect(page.getByText(/receberá uma atualização/i)).toHaveCount(0);
  }
  expect(submitted).toHaveLength(2);
  expect(submitted[0]).toMatchObject({
    executionMode: "parallel",
    services: [{ serviceId: 11, barberId: 21 }, { serviceId: 12, barberId: 22 }],
  });
});

test("public multi-service rescheduling moves the complete parallel plan on desktop and mobile", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date("2030-06-01T08:00:00+01:00"));
  await mockBeautyV2(page);
  const token = "multi-reschedule-qa";
  const appointment = {
    id: 901,
    locationId: 1,
    locationName: "Beauty Studio QA",
    locationAddress: "Rua QA",
    locationTimeZone: "Europe/Lisbon",
    barberId: 21,
    serviceId: 11,
    startTime: "2030-06-10T09:00:00.000Z",
    status: "booked",
    customerName: "Cliente QA",
    depositRequired: false,
    depositReason: null,
    cancellationPolicyHours: 4,
    isLateCancellation: false,
    barberName: "Ana",
    serviceName: "Manicure + Pedicure spa",
    duration: 60,
    price: 5700,
    extras: [],
    totalPrice: 5700,
    manualOutsideHours: false,
    rescheduleRevision: 3,
    requiresAssistedReschedule: false,
    supportsMultiServiceReschedule: true,
    serviceSegments: [
      {
        id: 9101, appointmentId: 901, position: 0, executionStage: 0,
        serviceId: 11, barberId: 21, barberName: "Ana", startTime: "2030-06-10T09:00:00.000Z",
        durationMinutes: 45, bufferBeforeMinutesSnapshot: 5, bufferAfterMinutesSnapshot: 5,
        serviceNameSnapshot: "Manicure", servicePriceCentsSnapshot: 2500,
      },
      {
        id: 9102, appointmentId: 901, position: 1, executionStage: 0,
        serviceId: 13, barberId: 23, barberName: "Carolina", startTime: "2030-06-10T09:00:00.000Z",
        durationMinutes: 60, bufferBeforeMinutesSnapshot: 10, bufferAfterMinutesSnapshot: 10,
        serviceNameSnapshot: "Pedicure spa", servicePriceCentsSnapshot: 3200,
      },
    ],
  };
  await page.route(`**/api/appointments/token/${token}`, (route) => route.fulfill({ json: appointment }));
  const availabilityRequests: unknown[] = [];
  const mutationRequests: unknown[] = [];
  await page.route(`**/api/appointments/reschedule/${token}/availability`, async (route) => {
    const body = route.request().postDataJSON();
    availabilityRequests.push(body);
    await route.fulfill({ json: {
      date: body.date,
      timeZone: "Europe/Lisbon",
      starts: [`${body.date}T14:00:00.000Z`, `${body.date}T16:00:00.000Z`],
      durationMinutes: 60,
      totalPriceCents: 5700,
      segments: [
        { position: 0, executionStage: 0, serviceId: 11, barberId: 21, startOffsetMinutes: 0, durationMinutes: 45, serviceName: "Manicure", priceCents: 2500 },
        { position: 1, executionStage: 0, serviceId: 13, barberId: 23, startOffsetMinutes: 0, durationMinutes: 60, serviceName: "Pedicure spa", priceCents: 3200 },
      ],
    } });
  });
  await page.route(`**/api/appointments/reschedule/${token}`, async (route) => {
    const body = route.request().postDataJSON();
    mutationRequests.push(body);
    await route.fulfill({ json: { ...appointment, startTime: body.startTime, rescheduleRevision: 4 } });
  });

  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1366, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/reschedule/${token}`);
    const plan = page.getByTestId("multi-service-reschedule-plan");
    await expect(plan).toContainText("Marcação completa");
    await expect(plan).toContainText("Em simultâneo");
    await expect(plan).toContainText("Manicure · Ana · 45 min");
    await expect(plan).toContainText("Pedicure spa · Carolina · 60 min");
    await expect(page.getByRole("button", { name: "15:00h" })).toBeVisible();
    await page.getByRole("button", { name: "15:00h" }).click();
    await page.getByRole("button", { name: /Confirmar nova data/i }).click();
    await expect(page.getByRole("heading", { name: /reagendada/i })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`multi-service-reschedule-${viewport.name}.png`), fullPage: true });
  }
  expect(availabilityRequests).toHaveLength(2);
  expect(availabilityRequests).toEqual([
    { date: "2030-06-10", expectedRevision: 3 },
    { date: "2030-06-10", expectedRevision: 3 },
  ]);
  expect(mutationRequests).toHaveLength(2);
  expect(mutationRequests).toEqual([
    { startTime: "2030-06-10T14:00:00.000Z", expectedRevision: 3 },
    { startTime: "2030-06-10T14:00:00.000Z", expectedRevision: 3 },
  ]);
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
    expect(await contrastRatio(page.getByRole("button", { name: "Enviar pedido de marcação" }))).toBeGreaterThanOrEqual(4.5);

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
  await expect(page.getByText("A consultar os horários disponíveis...")).toBeVisible();
  releaseAvailability();
  await expect(page.getByText("Sem horários disponíveis")).toBeVisible();

  await page.unroute("**/api/appointment-requests/availability");
  await page.route("**/api/appointment-requests/availability", (route) => route.fulfill({ status: 503, json: { message: "Unavailable" } }));
  await page.locator(".booking-calendar-day").filter({ hasText: /^2$/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Não foi possível consultar os horários" })).toBeVisible();
});

test("home call to action follows the effective request or immediate-confirmation flow", async ({ page }) => {
  await mockBeautyV2(page);
  await page.goto("/");
  const requestAction = page.getByRole("link", { name: "Pedir marcação", exact: true });
  await expect(requestAction).toBeVisible();
  await requestAction.click();
  await expect(page.getByRole("heading", { name: "Faça o seu pedido de marcação" })).toBeVisible();

  await page.unroute("**/api/beauty-v2/features");
  await page.route("**/api/beauty-v2/features", (route) => route.fulfill({ json: {
    enabled: true,
    appointmentRequests: false,
    multiServiceAppointments: false,
    appointmentRequestsAvailable: false,
  } }));
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Marcar agora", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pedir marcação", exact: true })).toHaveCount(0);
});

test("proposal response keeps the token in the URL fragment and communicates each state accurately", async ({ page }) => {
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
  await expect(page.getByRole("heading", { name: "Proposta de novo horário" })).toBeVisible();
  await expect(page.getByText(/a marcação só fica confirmada se o horário continuar disponível/i)).toBeVisible();
  await page.getByRole("button", { name: "Aceitar novo horário" }).click();
  await expect(page.getByRole("heading", { name: "Marcação confirmada" })).toBeVisible();
  await expect(page.getByText(/a sua marcação ficou confirmada/i)).toBeVisible();
  await expect(page.getByText(/receberá os detalhes/i)).toHaveCount(0);
  expect(accepted).toBe(true);
});

test("invalid proposal links and submit failures use safe public copy", async ({ page }) => {
  await page.goto("/appointment-request/proposal");
  await expect(page.getByRole("heading", { name: "Ligação indisponível" })).toBeVisible();
  await expect(page.getByText(/não é válida, expirou ou já não está disponível/i)).toBeVisible();

  await page.clock.setFixedTime(new Date("2030-06-01T08:00:00+01:00"));
  await mockBeautyV2(page);
  await page.route("**/api/appointment-requests", (route) => route.fulfill({
    status: 500,
    json: { code: "INTERNAL_ERROR", message: "database relation and private details" },
  }));
  await page.goto("/booking");
  await page.getByRole("button", { name: /Manicure/ }).click();
  await page.getByRole("combobox", { name: "Profissional para Manicure" }).click();
  await page.getByRole("option", { name: "Ana" }).click();
  await page.locator(".booking-time-slot-available").first().click();
  await page.getByLabel("Nome *").fill("Cliente QA");
  await page.getByLabel("Telemóvel *").fill("912345678");
  await page.getByRole("button", { name: "Enviar pedido de marcação" }).click();
  await expect(page.getByText("Não foi possível enviar o pedido")).toBeVisible();
  await expect(page.getByText("Verifique os dados e tente novamente.")).toBeVisible();
  await expect(page.getByText(/database relation/i)).toHaveCount(0);

  await page.unroute("**/api/appointment-requests");
  await page.route("**/api/appointment-requests", (route) => route.fulfill({
    status: 409,
    json: { code: "MULTI_SERVICE_APPOINTMENT_CONFLICT", message: "internal provider wording" },
  }));
  await page.getByRole("button", { name: "Enviar pedido de marcação" }).click();
  await expect(page.getByText("Um dos profissionais já tem uma marcação neste período. Escolha outro horário.")).toBeVisible();
  await expect(page.getByText(/internal provider wording/i)).toHaveCount(0);
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
    segments: [
      { position: 0, executionStage: 0, serviceId: 11, barberId: 21, barberName: "Mariana Silva", startTime: "2030-06-02T09:00:00.000Z", durationMinutes: 45, serviceNameSnapshot: "Manicure", servicePriceCentsSnapshot: 2500 },
      { position: 1, executionStage: 0, serviceId: 12, barberId: 22, barberName: "Beatriz Costa", startTime: "2030-06-02T09:00:00.000Z", durationMinutes: 30, serviceNameSnapshot: "Nail art", servicePriceCentsSnapshot: 900 },
    ],
    history: [{ id: 1, event_type: "request_created", actor_type: "client", actor_name: null, from_status: null, to_status: "pending", reason: null, created_at: "2030-06-01T08:00:00.000Z" }],
  };
  let currentRequest = request;
  let approvalCount = 0;
  let rejectedProposalCount = 0;
  await page.route("**/api/admin/appointment-requests**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/propose")) {
      rejectedProposalCount += 1;
      return route.fulfill({
        status: 409,
        json: {
          code: "APPOINTMENT_REQUEST_TIME_UNAVAILABLE",
          message: "O horário proposto não está disponível para todos os profissionais. Escolha outro horário.",
        },
      });
    }
    if (route.request().method() === "POST" && url.pathname.endsWith("/approve")) {
      approvalCount += 1;
      currentRequest = {
        ...currentRequest,
        status: "approved",
        appointmentId: 99,
        history: [
          ...currentRequest.history,
          { id: 2, event_type: "request_approved", actor_type: "admin", actor_name: "Admin QA", from_status: "pending", to_status: "approved", reason: null, created_at: "2030-06-01T08:01:00.000Z" },
        ],
      };
      return route.fulfill({ json: { request: currentRequest, appointment: { id: 99 } } });
    }
    if (url.pathname === "/api/admin/appointment-requests/44") return route.fulfill({ json: currentRequest });
    const requestedStatus = url.searchParams.get("status");
    return route.fulfill({ json: !requestedStatus || requestedStatus === currentRequest.status ? [currentRequest] : [] });
  });
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Pedidos" }).click();
  await expect(page.getByTestId("appointment-requests-manager")).toBeVisible();

  // Cache empty/composite views before the transition. Approval must invalidate
  // every status list, not only the list that happened to be open.
  await page.getByRole("button", { name: "Aprovado" }).click();
  await expect(page.getByText("Não existem pedidos neste estado.")).toBeVisible();
  await page.getByRole("button", { name: "Todos" }).click();
  await expect(page.getByText("Cliente QA")).toBeVisible();
  await page.getByRole("button", { name: "Pendente" }).click();
  await page.getByRole("button", { name: "Ver e decidir" }).click();
  const requestDialog = page.getByRole("dialog", { name: "Pedido de marcação" });
  await expect(page.getByText("Pedido recebido — aguarda aprovação do estabelecimento.")).toBeVisible();
  await expect(requestDialog).toContainText("Manicure");
  await expect(requestDialog).toContainText("Mariana Silva");
  await expect(requestDialog).toContainText("Nail art");
  await expect(requestDialog).toContainText("Beatriz Costa");
  await expect(page.getByRole("list", { name: "Histórico do pedido" })).toContainText("Pedido recebido");
  await expect(page.getByRole("list", { name: "Histórico do pedido" })).toContainText("Enviado pelo cliente");
  await expect(page.getByText("Em simultâneo")).toBeVisible();
  await page.getByRole("button", { name: "Propor horário" }).click();
  const proposalDialog = page.getByRole("dialog", { name: "Propor outro horário" });
  await expect(proposalDialog).toContainText("Confirmamos agora a disponibilidade de todos os profissionais");
  await proposalDialog.getByLabel("Data").fill("2030-06-03");
  await proposalDialog.getByLabel("Hora").fill("10:00");
  await proposalDialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("Horário indisponível", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Notifications (F8)").getByText(
    "O horário proposto não está disponível para todos os profissionais. Escolha outro horário.",
  )).toBeVisible();
  expect(rejectedProposalCount).toBe(1);
  await proposalDialog.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Aprovar" }).click();
  await expect.poll(() => approvalCount).toBe(1);
  await expect(page.getByText("Pedido aprovado — marcação confirmada.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Histórico do pedido" })).toContainText("Marcação aprovada");
  await expect(page.getByRole("list", { name: "Histórico do pedido" })).toContainText("Aprovada por Admin QA");
  await expect(page.getByText("A marcação foi criada e a disponibilidade voltou a ser validada.", { exact: true })).toBeVisible();
  await requestDialog.getByRole("button", { name: "Close" }).click();
  await expect(requestDialog).toBeHidden();

  await page.getByRole("button", { name: "Aprovado" }).click();
  await expect(page.getByText("Cliente QA")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver detalhe" })).toBeVisible();
  await page.getByRole("button", { name: "Todos" }).click();
  await expect(page.getByText("Cliente QA")).toBeVisible();
  expect(approvalCount).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Ver detalhe" }).click();
  await expect(requestDialog).toBeVisible();
  await expect(requestDialog).toContainText("Mariana Silva");
  await expect(requestDialog.getByRole("list", { name: "Histórico do pedido" })).toBeVisible();
  expect(await requestDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("Admin notifications keep unread and pending counters separate and open a secure location-scoped deep-link", async ({ page }, testInfo) => {
  const login = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Beauty-v2-Admin-2026!" },
  });
  expect(login.ok()).toBe(true);
  await page.route("**/api/beauty-v2/features", (route) => route.fulfill({
    json: { enabled: true, appointmentRequests: true, multiServiceAppointments: true },
  }));
  const request = {
    id: 44, locationId: 1, status: "pending", revision: 1, customerName: "Cliente Notificação",
    customerPhone: "+351912345678", customerEmail: "notificacao@example.test",
    requestedStartTime: "2030-06-02T09:00:00.000Z", appointmentId: null, refusalReason: null,
    createdAt: "2030-06-01T08:00:00.000Z", activeProposal: null,
    segments: [{ position: 0, executionStage: 0, serviceId: 11, barberId: 21, barberName: "Mariana Silva", startTime: "2030-06-02T09:00:00.000Z", durationMinutes: 45, serviceNameSnapshot: "Manicure", servicePriceCentsSnapshot: 2500 }],
    history: [{ id: 1, event_type: "request_created", actor_type: "client", actor_name: null, from_status: null, to_status: "pending", reason: null, created_at: "2030-06-01T08:00:00.000Z" }],
  };
  let readAt: string | null = null;
  let readCalls = 0;
  await page.route("**/api/admin/request-notifications**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/77/read")) {
      readCalls += 1;
      readAt = "2030-06-01T08:02:00.000Z";
      return route.fulfill({ json: { read: true } });
    }
    if (route.request().method() === "POST" && url.pathname.endsWith("/read-all")) {
      readAt = "2030-06-01T08:02:00.000Z";
      return route.fulfill({ json: { updated: 1 } });
    }
    return route.fulfill({ json: {
      unreadCount: readAt ? 0 : 1,
      pendingDecisionCount: 1,
      items: [{
        id: 77, locationId: 1, requestId: 44, type: "new_request",
        customerName: "Cliente Notificação", requestedStartTime: "2030-06-02T09:00:00.000Z",
        services: [{ name: "Manicure", professionalName: "Mariana Silva" }],
        availableAt: "2030-06-01T08:00:00.000Z", createdAt: "2030-06-01T08:00:00.000Z", readAt,
      }],
    } });
  });
  await page.route("**/api/admin/request-notification-settings", async (route) => {
    const response = {
      emailEnabled: false, reminderEnabled: false, reminderDelayMinutes: 30,
      respectOpeningHours: true, externalEmailRuntimeEnabled: false,
      recipients: [
        { userId: 1, displayName: "Admin QA", email: "admin@example.test", eligible: true, configured: true, isActive: true, newRequestEmail: true, pendingReminderEmail: true },
        { userId: 2, displayName: "Sem acesso", email: "sem-acesso@example.test", eligible: false, configured: false, isActive: false, newRequestEmail: true, pendingReminderEmail: true },
      ],
    };
    return route.fulfill({ json: response });
  });
  await page.route("**/api/admin/appointment-requests**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/44")) return route.fulfill({ json: request });
    return route.fulfill({ json: [request] });
  });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/admin?tab=appointment-requests&locationId=1&requestId=44");
  const requestDialog = page.getByRole("dialog", { name: "Pedido de marcação" });
  await expect(requestDialog).toBeVisible();
  await expect(requestDialog).toContainText("Cliente Notificação");
  await requestDialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("pending-request-count")).toHaveText("1");
  await page.getByTestId("admin-notification-bell").click();
  const notificationPanel = page.getByTestId("admin-notification-panel");
  await expect(notificationPanel).toContainText("Novo pedido de marcação");
  await expect(notificationPanel).toContainText("Cliente Notificação");
  await page.screenshot({ path: testInfo.outputPath("admin-notifications-desktop.png"), fullPage: true });
  await page.getByTestId("admin-notification-77").click();
  await expect(requestDialog).toBeVisible();
  await expect.poll(() => readCalls).toBe(1);
  await requestDialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("admin-notification-bell")).toHaveAttribute("aria-label", "Notificações");
  await expect(page.getByTestId("pending-request-count")).toHaveText("1");

  await page.getByRole("button", { name: "Configurar alertas" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Alertas de novos pedidos" });
  await expect(settingsDialog).toContainText("O envio externo está desligado nesta instalação");
  await expect(settingsDialog.getByText("Sem acesso ativo a esta localização")).toBeVisible();
  await settingsDialog.getByRole("button", { name: "Cancelar" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("admin-notification-bell").click();
  await expect(notificationPanel).toBeVisible();
  expect(await notificationPanel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("admin-notifications-mobile.png"), fullPage: true });
});

test("Admin presents proposed and refused requests with state-aware PT-PT history", async ({ page }) => {
  const login = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Beauty-v2-Admin-2026!" },
  });
  expect(login.ok()).toBe(true);
  await page.route("**/api/beauty-v2/features", (route) => route.fulfill({
    json: { enabled: true, appointmentRequests: true, multiServiceAppointments: true },
  }));
  const baseRequest = {
    locationId: 1, revision: 2, customerPhone: "+351912345678", customerEmail: null,
    requestedStartTime: "2030-06-02T09:00:00.000Z", appointmentId: null,
    createdAt: "2030-06-01T08:00:00.000Z",
    segments: [{
      position: 0, executionStage: 0, serviceId: 11, barberId: 21, barberName: "Mariana Silva",
      startTime: "2030-06-02T09:00:00.000Z", durationMinutes: 45,
      serviceNameSnapshot: "Manicure", servicePriceCentsSnapshot: 2500,
    }],
  };
  const proposed = {
    ...baseRequest, id: 45, status: "proposed", customerName: "Cliente Proposta", refusalReason: null,
    activeProposal: { proposedStartTime: "2030-06-02T11:00:00.000Z", expiresAt: "2030-06-04T08:01:00.000Z", status: "active" },
    history: [
      { id: 1, event_type: "request_created", actor_type: "client", actor_name: null, from_status: null, to_status: "pending", reason: null, created_at: "2030-06-01T08:00:00.000Z" },
      { id: 2, event_type: "proposal_created", actor_type: "admin", actor_name: "Admin QA", from_status: "pending", to_status: "proposed", reason: null, created_at: "2030-06-01T08:01:00.000Z" },
    ],
  };
  const refused = {
    ...baseRequest, id: 46, status: "refused", customerName: "Cliente Recusado",
    refusalReason: "Agenda indisponível", activeProposal: null,
    history: [
      { id: 3, event_type: "request_created", actor_type: "client", actor_name: null, from_status: null, to_status: "pending", reason: null, created_at: "2030-06-01T09:00:00.000Z" },
      { id: 4, event_type: "request_refused", actor_type: "professional", actor_name: "Carla Ferreira", from_status: "pending", to_status: "refused", reason: "Agenda indisponível", created_at: "2030-06-01T09:01:00.000Z" },
    ],
  };
  await page.route("**/api/admin/appointment-requests**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/45")) return route.fulfill({ json: proposed });
    if (url.pathname.endsWith("/46")) return route.fulfill({ json: refused });
    const requestedStatus = url.searchParams.get("status");
    const items = [proposed, refused].filter((item) => !requestedStatus || item.status === requestedStatus);
    return route.fulfill({ json: items });
  });

  await page.goto("/admin");
  await page.getByRole("tab", { name: "Pedidos" }).click();
  await page.getByRole("button", { name: "Proposta enviada" }).click();
  await page.getByRole("button", { name: "Ver e decidir" }).click();
  let dialog = page.getByRole("dialog", { name: "Pedido de marcação" });
  await expect(dialog).toContainText("Foi proposta uma alteração ao horário. Aguarda resposta do cliente.");
  await expect(dialog).toContainText("Novo horário proposto");
  await expect(dialog).toContainText("Proposto por Admin QA");
  await dialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Recusado" }).click();
  await page.getByRole("button", { name: "Ver detalhe" }).click();
  dialog = page.getByRole("dialog", { name: "Pedido de marcação" });
  await expect(dialog).toContainText("Pedido recusado pelo estabelecimento.");
  await expect(dialog).toContainText("Pedido recusado");
  await expect(dialog).toContainText("Recusado por Carla Ferreira");
  await expect(dialog).toContainText("1 de junho de 2030, às 10:01");
  await expect(dialog).not.toContainText("request_refused");
});

test("Admin appointment list keeps one row and filters multi-service appointments by every professional", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date("2030-06-01T08:00:00+01:00"));
  const login = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Beauty-v2-Admin-2026!" },
  });
  expect(login.ok()).toBe(true);

  const listProfessionals = [
    { id: 21, name: "Mariana Silva", specialty: "Unhas", color: "#d6a1ad", isVisible: true },
    { id: 22, name: "Carla Ferreira", specialty: "Estética", color: "#b98ba4", isVisible: true },
    { id: 23, name: "Beatriz Costa", specialty: "Pestanas", color: "#c9a17e", isVisible: true },
  ];
  const listServices = [
    { id: 11, name: "Manicure gel", price: 3500, duration: 60, isVisible: true },
    { id: 12, name: "Limpeza de pele", price: 4500, duration: 60, isVisible: true },
    { id: 13, name: "Extensão de pestanas", price: 3300, duration: 90, isVisible: true },
  ];
  const segment = (
    id: number,
    position: number,
    executionStage: number,
    serviceId: number,
    barberId: number,
    startTime: string,
    durationMinutes: number,
    serviceNameSnapshot: string,
    servicePriceCentsSnapshot: number,
  ) => ({
    id, appointmentId: 103, position, executionStage, serviceId, barberId, startTime,
    durationMinutes, bufferBeforeMinutesSnapshot: 0, bufferAfterMinutesSnapshot: 0,
    serviceNameSnapshot, servicePriceCentsSnapshot,
  });
  const common = {
    locationId: 1, customerPhone: "+351912345678", customerEmail: null,
    bufferBeforeMinutesSnapshot: 0, bufferAfterMinutesSnapshot: 0,
    manualOutsideHours: false, paymentMethod: "pending", canManage: true,
    rescheduleRevision: 0, notificationRevision: 0,
  };
  const appointments = [
    {
      ...common, id: 100, barberId: 21, serviceId: 11, startTime: "2030-06-01T08:00:00.000Z",
      durationMinutes: 60, serviceNameSnapshot: "Manicure gel", servicePriceCentsSnapshot: 3500,
      status: "completed", customerName: "Cliente Legacy", serviceSegments: [],
    },
    {
      ...common, id: 101, barberId: 21, serviceId: 11, startTime: "2030-06-01T10:00:00.000Z",
      durationMinutes: 120, serviceNameSnapshot: "Manicure gel + Nail art", servicePriceCentsSnapshot: 5000,
      status: "booked", customerName: "Cliente Mesmo Profissional",
      serviceSegments: [
        { ...segment(1011, 0, 0, 11, 21, "2030-06-01T10:00:00.000Z", 60, "Manicure gel", 3500), appointmentId: 101 },
        { ...segment(1012, 1, 1, 11, 21, "2030-06-01T11:00:00.000Z", 60, "Nail art", 1500), appointmentId: 101 },
      ],
    },
    {
      ...common, id: 103, barberId: 21, serviceId: 11, startTime: "2030-06-01T13:30:00.000Z",
      durationMinutes: 210, serviceNameSnapshot: "Manicure gel + Limpeza de pele + Extensão de pestanas",
      servicePriceCentsSnapshot: 11300, status: "booked", customerName: "Cliente Multi Profissional",
      serviceSegments: [
        segment(1031, 0, 0, 11, 21, "2030-06-01T13:30:00.000Z", 60, "Manicure gel", 3500),
        segment(1032, 1, 1, 12, 22, "2030-06-01T14:30:00.000Z", 60, "Limpeza de pele", 4500),
        segment(1033, 2, 2, 13, 23, "2030-06-01T15:30:00.000Z", 90, "Extensão de pestanas", 3300),
      ],
    },
    {
      ...common, id: 104, barberId: 21, serviceId: 11, startTime: "2030-06-01T17:00:00.000Z",
      durationMinutes: 60, serviceNameSnapshot: "Manicure gel + Limpeza de pele", servicePriceCentsSnapshot: 8000,
      status: "booked", customerName: "Cliente Serviços Simultâneos",
      serviceSegments: [
        { ...segment(1041, 0, 0, 11, 21, "2030-06-01T17:00:00.000Z", 60, "Manicure gel", 3500), appointmentId: 104 },
        { ...segment(1042, 1, 0, 12, 23, "2030-06-01T17:00:00.000Z", 60, "Limpeza de pele", 4500), appointmentId: 104 },
      ],
    },
  ];
  const requestedProfessionalIds: Array<string | null> = [];
  const adminRescheduleAvailabilityRequests: unknown[] = [];
  const adminRescheduleMutations: unknown[] = [];
  await page.route("**/api/beauty-v2/features", (route) => route.fulfill({
    json: { enabled: true, appointmentRequests: true, multiServiceAppointments: true, parallelServiceScheduling: true },
  }));
  await page.route("**/api/barbers?*", (route) => route.fulfill({ json: listProfessionals }));
  await page.route("**/api/services?*", (route) => route.fulfill({ json: listServices }));
  await page.route("**/api/appointments*", (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.continue();
    const professionalId = url.searchParams.get("barberId");
    if (url.searchParams.get("scope") !== "team") requestedProfessionalIds.push(professionalId);
    const filtered = professionalId
      ? appointments.filter((appointment) => appointment.barberId === Number(professionalId)
        || appointment.serviceSegments.some((item) => item.barberId === Number(professionalId)))
      : appointments;
    return route.fulfill({ json: filtered });
  });
  await page.route("**/api/appointments/103/reschedule-availability", (route) => {
    const body = route.request().postDataJSON();
    adminRescheduleAvailabilityRequests.push(body);
    return route.fulfill({ json: {
      date: body.date,
      timeZone: "Europe/Lisbon",
      starts: ["2030-06-01T13:30:00.000Z", "2030-06-01T15:30:00.000Z"],
      durationMinutes: 210,
      totalPriceCents: 11300,
      segments: [
        { position: 0, executionStage: 0, serviceId: 11, barberId: 21, startOffsetMinutes: 0, durationMinutes: 60, serviceName: "Manicure gel", priceCents: 3500 },
        { position: 1, executionStage: 1, serviceId: 12, barberId: 22, startOffsetMinutes: 60, durationMinutes: 60, serviceName: "Limpeza de pele", priceCents: 4500 },
        { position: 2, executionStage: 2, serviceId: 13, barberId: 23, startOffsetMinutes: 120, durationMinutes: 90, serviceName: "Extensão de pestanas", priceCents: 3300 },
      ],
    } });
  });
  await page.route("**/api/appointments/103", (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    adminRescheduleMutations.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...appointments[2], startTime: "2030-06-01T15:30:00.000Z", rescheduleRevision: 1 } });
  });

  await page.goto("/admin");
  await page.getByRole("tab", { name: "Marcações" }).click();
  await expect(page.getByText("4 registos")).toBeVisible();
  await expect(page.getByRole("button", { name: /Cliente Legacy/ })).toHaveCount(1);
  const legacyAssignments = page.getByTestId("appointment-100-service-assignment");
  await expect(legacyAssignments).toHaveCount(1);
  await expect(legacyAssignments).toContainText("Manicure gel");
  await expect(legacyAssignments).toContainText("Mariana Silva");
  const sameProfessionalRow = page.getByRole("button", { name: /Cliente Mesmo Profissional/ });
  await expect(sameProfessionalRow).toHaveCount(1);
  await expect(page.getByTestId("appointment-101-service-assignment")).toHaveCount(2);
  let multiRow = page.getByRole("button", { name: /Cliente Multi Profissional/ });
  await expect(multiRow).toHaveCount(1);
  await expect(multiRow).toContainText("14:30–18:00");
  await expect(multiRow).toContainText("210 min");
  const multiAssignments = page.getByTestId("appointment-103-service-assignment");
  await expect(multiAssignments).toHaveCount(3);
  await expect(multiAssignments.nth(0)).toHaveAttribute("title", "Manicure gel — Mariana Silva");
  await expect(multiAssignments.nth(1)).toHaveAttribute("title", "Limpeza de pele — Carla Ferreira");
  await expect(multiAssignments.nth(2)).toHaveAttribute("title", "Extensão de pestanas — Beatriz Costa");
  await page.getByTestId("appointments-list").screenshot({ path: testInfo.outputPath("appointments-multi-professional-desktop.png") });

  const professionalFilter = page.getByRole("combobox", { name: "Filtrar profissional" });
  for (const professional of listProfessionals) {
    await professionalFilter.click();
    await page.getByRole("option", { name: professional.name }).click();
    multiRow = page.getByRole("button", { name: /Cliente Multi Profissional/ });
    await expect(multiRow).toHaveCount(1);
    const filteredAssignments = page.getByTestId("appointment-103-service-assignment");
    const highlightedAssignment = filteredAssignments.filter({ hasText: professional.name });
    await expect(highlightedAssignment).toHaveAttribute("data-filter-match", "true");
    const highlightedText = highlightedAssignment.locator("span:not([aria-hidden='true'])");
    expect(await contrastRatio(highlightedText.first())).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(highlightedText.last())).toBeGreaterThanOrEqual(4.5);
    await expect(filteredAssignments.filter({ hasNotText: professional.name })).toHaveCount(2);
  }
  await page.getByTestId("appointments-list").screenshot({ path: testInfo.outputPath("appointments-filtered-professional-desktop.png") });
  expect(requestedProfessionalIds).toEqual(expect.arrayContaining(["21", "22", "23"]));

  await multiRow.click();
  let details = page.getByRole("dialog", { name: "Detalhes da marcação" });
  await expect(details).toContainText("14:30–18:00 · 210 min");
  await expect(details).toContainText("Manicure gel · Mariana Silva");
  await expect(details).toContainText("14:30–15:30 · 60 min");
  await expect(details).toContainText("35,00 €");
  await expect(details).toContainText("Limpeza de pele · Carla Ferreira");
  await expect(details).toContainText("15:30–16:30 · 60 min");
  await expect(details).toContainText("45,00 €");
  await expect(details).toContainText("Extensão de pestanas · Beatriz Costa");
  await expect(details).toContainText("16:30–18:00 · 90 min");
  await expect(details).toContainText("33,00 €");
  await details.getByTestId("appointment-action-edit").click();
  const editor = page.getByRole("dialog", { name: "Editar marcação" });
  await expect(editor.getByTestId("multi-service-reschedule-editor")).toContainText("Reagendar a marcação completa");
  await expect(editor.getByTestId("multi-service-reschedule-editor")).toContainText("Manicure gel · Mariana Silva · 60 min");
  await expect(editor.getByText("Permitir horários fora do horário normal")).toHaveCount(0);
  await editor.getByRole("combobox", { name: "Hora" }).click();
  await page.getByRole("option", { name: "16:30" }).click();
  await editor.getByTestId("edit-appointment-save").click();
  await expect(editor).toBeHidden();
  expect(adminRescheduleAvailabilityRequests).toContainEqual({ date: "2030-06-01", expectedRevision: 0 });
  expect(adminRescheduleMutations).toEqual([{
    startTime: "2030-06-01T15:30:00.000Z",
    expectedRevision: 0,
  }]);
  await details.getByRole("button", { name: "Close" }).click();

  await professionalFilter.click();
  await page.getByRole("option", { name: "Todos os profissionais" }).click();
  await page.getByRole("button", { name: "Próximas" }).click();
  await expect(page.getByText("4 registos")).toBeVisible();
  await expect(page.getByRole("button", { name: /Cliente Multi Profissional/ })).toHaveCount(1);

  const statusFilter = page.getByRole("combobox", { name: "Filtrar por estado" });
  await statusFilter.click();
  await page.getByRole("option", { name: "Concluídas" }).click();
  await expect(page.getByText("1 de 4 registos")).toBeVisible();
  await expect(page.getByRole("button", { name: /Cliente Legacy/ })).toHaveCount(1);

  await statusFilter.click();
  await page.getByRole("option", { name: "Todos os estados" }).click();
  await page.getByRole("button", { name: /Cliente Serviços Simultâneos/ }).click();
  details = page.getByRole("dialog", { name: "Detalhes da marcação" });
  await expect(details).toContainText("Em simultâneo");
  await expect(details).toContainText("18:00–19:00 · 60 min");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await details.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await details.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("appointments-list")).toBeVisible();
  expect(await page.getByTestId("appointments-list").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByTestId("appointments-list").screenshot({ path: testInfo.outputPath("appointments-multi-professional-mobile.png") });
});

test("Admin appointment calendar keeps every Beauty day state readable", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2030-06-01T08:00:00+01:00"));
  const login = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Beauty-v2-Admin-2026!" },
  });
  expect(login.ok()).toBe(true);

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/admin");
    await page.getByRole("tab", { name: /Marca/ }).click();
    await page.getByRole("button", { name: /01 de junho/i }).click();

    const calendar = page.locator(".appointments-filter-calendar");
    await expect(calendar).toBeVisible();

    const selectedToday = calendar.locator(
      ".appointments-filter-calendar-day-today.appointments-filter-calendar-day-selected",
    );
    await expect(selectedToday).toHaveCount(1);
    await expect(selectedToday).toHaveAttribute("aria-selected", "true");
    expect(await contrastRatio(selectedToday)).toBeGreaterThanOrEqual(4.5);

    const nextDay = calendar
      .locator(".appointments-filter-calendar-day:not(.appointments-filter-calendar-day-outside)")
      .filter({ hasText: /^2$/ });
    await nextDay.click();

    const selectedNotToday = calendar.locator(
      ".appointments-filter-calendar-day-selected:not(.appointments-filter-calendar-day-today)",
    );
    const todayNotSelected = calendar.locator(
      ".appointments-filter-calendar-day-today:not(.appointments-filter-calendar-day-selected)",
    );
    await expect(selectedNotToday).toHaveCount(1);
    await expect(todayNotSelected).toHaveCount(1);
    expect(await contrastRatio(selectedNotToday)).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(todayNotSelected)).toBeGreaterThanOrEqual(4.5);

    const normalDay = calendar.locator(
      ".appointments-filter-calendar-day:not(.appointments-filter-calendar-day-selected):not(.appointments-filter-calendar-day-today):not(.appointments-filter-calendar-day-outside):not(:disabled)",
    ).first();
    await expect(normalDay).toBeVisible();
    expect(await contrastRatio(normalDay)).toBeGreaterThanOrEqual(4.5);
    await normalDay.hover();
    expect(await contrastRatio(normalDay)).toBeGreaterThanOrEqual(4.5);
    await selectedNotToday.focus();
    await page.keyboard.press("ArrowRight");
    const keyboardFocusedDay = calendar.locator(".appointments-filter-calendar-day:focus-visible");
    await expect(keyboardFocusedDay).toHaveCount(1);
    const focusStyle = await keyboardFocusedDay.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
    });
    expect(focusStyle.outlineStyle).toBe("solid");
    expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);

    const outsideDay = calendar.locator(".appointments-filter-calendar-day-outside").first();
    await expect(outsideDay).toBeVisible();
    expect(await contrastRatio(outsideDay)).toBeGreaterThanOrEqual(4.5);

    const disabledState = calendar.locator(
      ".appointments-filter-calendar-day:not(.appointments-filter-calendar-day-selected):not(.appointments-filter-calendar-day-today):not(.appointments-filter-calendar-day-outside)",
    ).last();
    await disabledState.evaluate((element) => {
      element.classList.add("appointments-filter-calendar-day-disabled");
      (element as HTMLButtonElement).disabled = true;
    });
    await expect(disabledState).toBeDisabled();
    expect(await contrastRatio(disabledState)).toBeGreaterThanOrEqual(4.5);

    expect(await calendar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
});
