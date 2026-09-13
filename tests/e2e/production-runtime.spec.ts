import { expect, test, type APIRequestContext } from "@playwright/test";

async function login(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    headers: { "X-Forwarded-Proto": "https" },
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const cookie = response.headers()["set-cookie"]?.split(";", 1)[0];
  expect(cookie).toBeTruthy();
  return { Cookie: cookie! };
}

function futureThursday(weeks: number, hour: number) {
  const date = new Date();
  const days = (4 - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + days + weeks * 7);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

test("Production-equivalent runtime remains single-location and keeps external features closed", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();

  const config = await request.get("/api/multi-location/config");
  expect(await config.json()).toEqual({ enabled: false, maxLocations: 1 });
  const locations = await request.get("/api/locations");
  expect((await locations.json())).toHaveLength(1);

  const servicesDefault = await request.get("/api/services");
  const servicesSpoofed = await request.get("/api/services", { headers: { "X-Location-Id": "999" } });
  expect(await servicesSpoofed.json()).toEqual(await servicesDefault.json());

  const authHeaders = await login(request);
  for (const endpoint of [
    "/api/admin/locations",
    "/api/admin/dev/whatsapp/meta/test/1",
    "/api/webhooks/whatsapp/meta",
  ]) {
    const response = await request.get(endpoint, { headers: authHeaders });
    expect(response.status(), endpoint).toBe(404);
    expect(response.headers()["content-type"]).toContain("application/json");
  }
  const devMetaTest = await request.post("/api/admin/dev/whatsapp/meta/test", {
    headers: authHeaders, data: { recipient: "+351912000009" },
  });
  expect(devMetaTest.status()).toBe(404);
  expect(devMetaTest.headers()["content-type"]).toContain("application/json");
  const webhookPost = await request.post("/api/webhooks/whatsapp/meta", { data: {} });
  expect(webhookPost.status()).toBe(404);
  const createLocation = await request.post("/api/admin/locations", { headers: authHeaders, data: {
    name: "Blocked", address: "Blocked", timezone: "Europe/Lisbon",
  } });
  expect(createLocation.status()).toBe(404);

  const [barbersResponse, servicesResponse] = await Promise.all([
    request.get("/api/barbers"), request.get("/api/services"),
  ]);
  const barbers = await barbersResponse.json();
  const services = await servicesResponse.json();
  const barber = barbers.find((item: any) => item.isVisible !== false);
  const service = services.find((item: any) => item.isVisible !== false
    && (!barber.serviceIds?.length || barber.serviceIds.includes(item.id)));
  expect(barber).toBeTruthy();
  expect(service).toBeTruthy();

  const publicStart = futureThursday(30, 15);
  const publicBooking = await request.post("/api/appointments", { data: {
    barberId: barber.id, serviceId: service.id, startTime: publicStart,
    customerName: "Production Runtime Public", customerPhone: "+351912000001",
    customerEmail: "runtime-public@example.test", whatsappOptIn: true,
  } });
  expect(publicBooking.status(), await publicBooking.text()).toBe(201);
  const appointment = await publicBooking.json();
  expect(appointment.notificationEventId).toBeUndefined();
  expect(appointment.locationId).toBe(1);

  const rescheduledStart = futureThursday(31, 15);
  const reschedule = await request.post(`/api/appointments/reschedule/${appointment.cancelToken}`, {
    data: { startTime: rescheduledStart },
  });
  expect(reschedule.ok(), await reschedule.text()).toBe(true);
  expect((await reschedule.json()).notificationEventId).toBeUndefined();
  const cancellation = await request.post(`/api/appointments/cancel/${appointment.cancelToken}`);
  expect(cancellation.ok(), await cancellation.text()).toBe(true);

  const recurringName = `Production Runtime Recurring ${Date.now()}`;
  const recurring = await request.post("/api/appointments/block", { headers: authHeaders, data: {
    barberId: barber.id, serviceId: service.id, startTime: futureThursday(34, 16),
    name: recurringName, phone: "+351912000002", customerEmail: "runtime-recurring@example.test",
    isManualBooking: true, isRecurring: true, recurringWeeks: 2, recurringMonths: 1,
  } });
  expect(recurring.status(), await recurring.text()).toBe(201);
  expect((await recurring.json()).notificationEventId).toBeUndefined();
  const appointments = await request.get("/api/appointments", { headers: authHeaders });
  const recurringAppointments = (await appointments.json()).filter((item: any) => item.customerName === recurringName);
  expect(recurringAppointments.length).toBeGreaterThan(1);
  expect(recurringAppointments.every((item: any) => item.locationId === 1)).toBe(true);

  const bookingWindow = await request.get("/api/public-booking-window");
  expect((await bookingWindow.json()).enabled).toBe(false);
});
