import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  getPublicBookingWindow,
  isDateWithinPublicBookingWindow,
  normalizePublicBookingOpenDay,
  PUBLIC_BOOKING_WINDOW_CLOSED_CODE,
} from "../../shared/public-booking-window";

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

function futureThursdaySeveralMonthsAhead(hour = 10) {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + 4, 1);
  while (date.getUTCDay() !== 4) date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

test.describe("janela mensal de marcações públicas", () => {
  test("mantém apenas o mês atual aberto antes do dia 20", () => {
    const window = getPublicBookingWindow(new Date("2026-09-19T22:59:59Z"), "Europe/Lisbon", 20);
    expect(window).toMatchObject({
      today: "2026-09-19",
      maxDate: "2026-09-30",
      nextMonthAvailable: false,
      nextOpeningDate: "2026-09-20",
    });
  });

  test("abre o mês seguinte à meia-noite do dia 20 em Lisboa", () => {
    const beforeMidnight = getPublicBookingWindow(new Date("2026-09-19T22:59:59Z"), "Europe/Lisbon", 20);
    const atMidnight = getPublicBookingWindow(new Date("2026-09-19T23:00:00Z"), "Europe/Lisbon", 20);
    expect(beforeMidnight.maxDate).toBe("2026-09-30");
    expect(atMidnight).toMatchObject({
      today: "2026-09-20",
      maxDate: "2026-10-31",
      nextMonthAvailable: true,
      nextOpeningDate: "2026-10-20",
    });
  });

  test("trata corretamente a passagem de dezembro para janeiro", () => {
    expect(getPublicBookingWindow(new Date("2026-12-20T12:00:00Z"), "Europe/Lisbon", 20)).toMatchObject({
      maxDate: "2027-01-31",
      nextOpeningDate: "2027-01-20",
    });
  });

  test("aceita apenas dias de abertura seguros e compara datas no fuso da loja", () => {
    expect(normalizePublicBookingOpenDay("15")).toBe(15);
    expect(normalizePublicBookingOpenDay("31")).toBe(20);
    const window = getPublicBookingWindow(new Date("2026-09-10T12:00:00Z"), "Europe/Lisbon", 20);
    expect(isDateWithinPublicBookingWindow(new Date("2026-09-30T20:00:00Z"), window, "Europe/Lisbon")).toBe(true);
    expect(isDateWithinPublicBookingWindow(new Date("2026-10-01T10:00:00Z"), window, "Europe/Lisbon")).toBe(false);
  });

  test("expõe a mesma janela usada pelo servidor", async ({ request }) => {
    const response = await request.get("/api/public-booking-window");
    expect(response.ok(), await response.text()).toBe(true);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.json();
    expect(body.openDay).toBe(20);
    expect(body.enabled).toBe(true);
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.maxDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("não deixa um URL manipulado avançar para uma data ainda fechada", async ({ page, request }) => {
    const [windowResponse, barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/public-booking-window"),
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    const bookingWindow = await windowResponse.json();
    const barber = (await barbersResponse.json()).find((item: any) => item.isVisible !== false);
    const service = (await servicesResponse.json()).find((item: any) =>
      !Array.isArray(barber.serviceIds) || barber.serviceIds.length === 0 || barber.serviceIds.includes(item.id),
    );
    const lockedDate = new Date(`${bookingWindow.maxDate}T12:00:00Z`);
    lockedDate.setUTCDate(lockedDate.getUTCDate() + 1);

    await page.goto(`/booking?barberId=${barber.id}&serviceId=${service.id}&date=${lockedDate.toISOString().slice(0, 10)}&time=10:00`);
    await expect(page.getByText("Selecione a Data")).toBeVisible();
    await expect(page.getByText("Resumo da Marcação")).not.toBeVisible();
    await expect(page.getByText(`As marcações para o próximo mês ficam disponíveis a partir do dia ${bookingWindow.openDay}.`)).toBeVisible();
  });

  test("bloqueia criação e reagendamento públicos fora da janela, mas permite administração e cancelamento", async ({ request }) => {
    await loginAdmin(request);
    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    const barber = (await barbersResponse.json()).find((item: any) => item.isVisible !== false);
    const services = await servicesResponse.json();
    const service = services.find((item: any) =>
      !Array.isArray(barber.serviceIds) || barber.serviceIds.length === 0 || barber.serviceIds.includes(item.id),
    );
    const lockedStart = futureThursdaySeveralMonthsAhead(10);

    const publicCreate = await request.post("/api/appointments", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: lockedStart.toISOString(),
        customerName: "Janela Pública QA",
        customerPhone: "+351912695799",
        customerEmail: null,
      },
    });
    expect(publicCreate.status()).toBe(400);
    expect((await publicCreate.json()).code).toBe(PUBLIC_BOOKING_WINDOW_CLOSED_CODE);

    const hiddenAvailability = await request.get(`/api/appointments/public?barberId=${barber.id}&date=${lockedStart.toISOString().slice(0, 10)}`);
    expect(hiddenAvailability.ok(), await hiddenAvailability.text()).toBe(true);
    expect(await hiddenAvailability.json()).toEqual([]);

    const manualCreate = await request.post("/api/appointments/block", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: lockedStart.toISOString(),
        name: "Janela Manual QA",
        phone: "+351912695798",
        customerEmail: null,
        isManualBooking: true,
      },
    });
    expect(manualCreate.status(), await manualCreate.text()).toBe(201);

    const dateKey = lockedStart.toISOString().slice(0, 10);
    const appointmentsResponse = await request.get(`/api/appointments?barberId=${barber.id}&date=${dateKey}`);
    const appointment = (await appointmentsResponse.json()).find((item: any) => item.customerName === "Janela Manual QA");
    expect(appointment?.cancelToken).toBeTruthy();

    const tokenResponse = await request.get(`/api/appointments/token/${appointment.cancelToken}`);
    expect(tokenResponse.ok(), await tokenResponse.text()).toBe(true);

    const rescheduleStart = new Date(lockedStart);
    rescheduleStart.setUTCDate(rescheduleStart.getUTCDate() + 1);
    const rescheduleResponse = await request.post(`/api/appointments/reschedule/${appointment.cancelToken}`, {
      data: { startTime: rescheduleStart.toISOString() },
    });
    expect(rescheduleResponse.status()).toBe(400);
    expect((await rescheduleResponse.json()).code).toBe(PUBLIC_BOOKING_WINDOW_CLOSED_CODE);

    const cancelResponse = await request.post(`/api/appointments/cancel/${appointment.cancelToken}`);
    expect(cancelResponse.ok(), await cancelResponse.text()).toBe(true);
  });
});
