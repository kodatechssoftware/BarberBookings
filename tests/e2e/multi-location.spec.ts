import { expect, test, type APIRequestContext } from "@playwright/test";
import ExcelJS from "exceljs";

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

const embed = (city: string) => `https://www.google.com/maps/embed?pb=${city}`;

test("[multi-location] isola quatro lojas, mapas, equipa, reservas, permissões e relatórios", async ({ page, request, playwright, baseURL }) => {
  test.setTimeout(120_000);
  expect((await request.get("/api/admin/locations")).status()).toBe(401);
  await loginAdmin(request);

  const initial = await (await request.get("/api/admin/locations")).json();
  expect(initial).toHaveLength(1);
  expect(initial[0]).toMatchObject({ isDefault: true, isActive: true });

  const created: any[] = [];
  for (const [name, city] of [["Porto", "Porto"], ["Braga", "Braga"], ["Coimbra", "Coimbra"]]) {
    const response = await request.post("/api/admin/locations", {
      data: {
        name: `Loja ${name}`,
        address: `Avenida Central, ${city}`,
        mapUrl: `https://www.google.com/maps?q=${city}`,
        mapEmbedUrl: embed(city),
        timezone: "Europe/Lisbon",
        isActive: true,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    const location = await response.json();
    expect(location.isActive).toBe(false);
    created.push(location);
  }

  expect(await (await request.get("/api/locations")).json()).toHaveLength(1);

  const overLimit = await request.post("/api/admin/locations", {
    data: { name: "Loja Faro", address: "Avenida Central, Faro", timezone: "Europe/Lisbon" },
  });
  expect(overLimit.status()).toBe(409);

  for (const location of created) {
    const response = await request.patch(`/api/admin/locations/${location.id}`, { data: { isActive: true } });
    expect(response.ok(), await response.text()).toBe(true);
  }

  const deactivateDefault = await request.patch(`/api/admin/locations/${initial[0].id}`, { data: { isActive: false } });
  expect(deactivateDefault.status()).toBe(409);
  expect(await (await request.get("/api/locations")).json()).toHaveLength(4);
  expect(await (await request.get("/api/locations?purpose=booking")).json()).toHaveLength(1);
  expect(await (await request.get("/api/account/locations")).json()).toHaveLength(4);

  const portoHeaders = { "X-Location-Id": String(created[0].id) };
  const serviceResponse = await request.post("/api/services", {
    headers: portoHeaders,
    data: { name: "Corte Porto", description: "Exclusivo Porto", price: 1700, duration: 30, isVisible: true },
  });
  expect(serviceResponse.status(), await serviceResponse.text()).toBe(201);
  const portoService = await serviceResponse.json();

  const barberResponse = await request.post("/api/barbers", {
    headers: portoHeaders,
    data: {
      name: "Rui Porto",
      specialty: "Barbeiro",
      bio: "Equipa do Porto",
      color: "#336699",
      isVisible: true,
      serviceIds: [portoService.id],
    },
  });
  expect(barberResponse.status(), await barberResponse.text()).toBe(201);
  const portoBarber = await barberResponse.json();

  const portoServices = await (await request.get("/api/services", { headers: portoHeaders })).json();
  const portoBarbers = await (await request.get("/api/barbers", { headers: portoHeaders })).json();
  expect(portoServices.some((service: any) => service.id === portoService.id)).toBe(true);
  expect(portoBarbers.some((barber: any) => barber.id === portoBarber.id)).toBe(true);

  const defaultServices = await (await request.get("/api/services")).json();
  const defaultBarbers = await (await request.get("/api/barbers")).json();
  expect(defaultServices.some((service: any) => service.id === portoService.id)).toBe(false);
  expect(defaultBarbers.some((barber: any) => barber.id === portoBarber.id)).toBe(false);
  expect((await request.get(`/api/barbers/${portoBarber.id}`)).status()).toBe(404);
  expect((await request.get(`/api/barbers/${portoBarber.id}/availability`)).status()).toBe(404);
  expect((await request.get(`/api/barbers/${portoBarber.id}`, { headers: portoHeaders })).status()).toBe(200);

  const portoHours = [
    { dayOfWeek: 1, startTime: "10:00", endTime: "18:00", isOpen: true },
  ];
  const updatePortoHours = await request.patch("/api/shop/availability", {
    headers: portoHeaders,
    data: portoHours,
  });
  expect(updatePortoHours.ok(), await updatePortoHours.text()).toBe(true);
  expect(await (await request.get("/api/shop/availability", { headers: portoHeaders })).json()).toMatchObject(portoHours);
  expect(await (await request.get("/api/shop/availability")).json()).not.toMatchObject(portoHours);
  expect(await (await request.get("/api/locations?purpose=booking")).json()).toHaveLength(2);

  const startTime = new Date(Date.now() + 14 * 86400000);
  startTime.setUTCHours(10, 0, 0, 0);
  const manualBooking = await request.post("/api/appointments/block", {
    headers: portoHeaders,
    data: {
      barberId: portoBarber.id,
      serviceId: portoService.id,
      startTime: startTime.toISOString(),
      name: "Cliente Porto",
      phone: "+351912345678",
      customerEmail: "",
      isManualBooking: true,
      allowOutsideHours: true,
      isRecurring: false,
    },
  });
  expect(manualBooking.status(), await manualBooking.text()).toBe(201);
  const portoAppointments = await (await request.get("/api/appointments", { headers: portoHeaders })).json();
  const defaultAppointments = await (await request.get("/api/appointments")).json();
  expect(portoAppointments.some((appointment: any) => appointment.customerName === "Cliente Porto")).toBe(true);
  expect(defaultAppointments.some((appointment: any) => appointment.customerName === "Cliente Porto")).toBe(false);

  const crossLocationBooking = await request.post("/api/appointments/block", {
    data: {
      barberId: portoBarber.id,
      serviceId: portoService.id,
      startTime: new Date(startTime.getTime() + 3600000).toISOString(),
      name: "Cliente indevido",
      phone: "+351912345679",
      customerEmail: "",
      isManualBooking: true,
      allowOutsideHours: true,
      isRecurring: false,
    },
  });
  expect(crossLocationBooking.status()).toBe(400);

  await page.goto("/");
  const locationSection = page.locator("#location");
  await expect(locationSection.getByRole("button", { name: /Loja Braga/ })).toBeVisible();
  await locationSection.getByRole("button", { name: /Loja Braga/ }).click();
  await expect(locationSection.locator("iframe")).toHaveCount(1);
  await expect(locationSection.locator("iframe")).toHaveAttribute("title", "Mapa de Loja Braga");
  await expect(locationSection.locator("iframe")).toHaveAttribute("src", embed("Braga"));
  // A shop change from another tab must update the map and the public catalogue together.
  await page.evaluate((id) => {
    localStorage.setItem("barberbookings:location-id", String(id));
    window.dispatchEvent(new StorageEvent("storage", { key: "barberbookings:location-id", newValue: String(id) }));
  }, created[0].id);
  await expect(locationSection.locator("iframe")).toHaveAttribute("title", "Mapa de Loja Porto");
  await expect(page.getByText("Rui Porto", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.evaluate(() => localStorage.removeItem("barberbookings:location-id"));
  await page.goto("/book");
  await expect(page.getByRole("heading", { name: "Escolhe a localização" })).toBeVisible();
  await page.getByRole("button", { name: /Loja Porto/ }).click();
  await expect(page.getByText("Rui Porto", { exact: true })).toBeVisible();
  await expect(page.getByText("Tiago Martins", { exact: true })).not.toBeVisible();
  const changeLocation = await page.getByRole("button", { name: "Mudar loja" }).boundingBox();
  expect(changeLocation).toBeTruthy();
  expect(changeLocation!.x + changeLocation!.width).toBeLessThanOrEqual(390);

  const invalidEmbed = await request.patch(`/api/admin/locations/${created[0].id}`, {
    data: { mapEmbedUrl: "https://example.com/not-a-map" },
  });
  expect(invalidEmbed.status()).toBe(400);

  await loginAdmin(page.request);
  await page.goto("/admin");
  const locationsTab = page.getByRole("tab", { name: "Localizações" });
  await expect(locationsTab).toBeVisible();
  await locationsTab.click();
  await expect(page.getByText("4 de 4 localizações utilizadas neste plano.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova localização" })).toBeDisabled();

  const primaryHeaders = { "X-Location-Id": String(initial[0].id) };
  const sharedBarber = defaultBarbers[0];
  const primaryService = defaultServices.find((service: any) => !sharedBarber.serviceIds.length || sharedBarber.serviceIds.includes(service.id));
  expect(primaryService).toBeTruthy();

  // Associate through the UI, retaining the barber's services in the original shop.
  await page.getByRole("tab", { name: "Equipa", exact: true }).click();
  await page.getByRole("button", { name: "Associar barbeiro existente" }).click();
  const associateDialog = page.getByRole("dialog", { name: "Associar barbeiro a esta loja" });
  await associateDialog.getByRole("combobox").click();
  await page.getByRole("option", { name: sharedBarber.name, exact: true }).click();
  await associateDialog.getByRole("button", { name: "Associar à loja", exact: true }).click();
  await expect(associateDialog).not.toBeVisible();
  const inPorto = await (await request.get(`/api/barbers/${sharedBarber.id}`, { headers: portoHeaders })).json();
  const inPrimary = await (await request.get(`/api/barbers/${sharedBarber.id}`, { headers: primaryHeaders })).json();
  expect(inPorto.serviceIds).toContain(portoService.id);
  expect(inPrimary.serviceIds).toContain(primaryService.id);
  expect(inPrimary.serviceIds).not.toContain(portoService.id);
  expect((await request.patch(`/api/barbers/${sharedBarber.id}/services`, {
    headers: portoHeaders, data: { serviceIds: [primaryService.id] },
  })).status()).toBe(400);

  const guest = await playwright.request.newContext({ baseURL });
  try {
    const monday = new Date(Date.now() + 28 * 86400000);
    monday.setUTCDate(monday.getUTCDate() + (8 - monday.getUTCDay()) % 7);
    monday.setUTCHours(14, 0, 0, 0);
    // Same barber, same instant, different shops and different booking entry points.
    const simultaneous = await Promise.all([
      guest.post("/api/appointments", { headers: portoHeaders, data: {
        barberId: sharedBarber.id, serviceId: portoService.id, startTime: monday.toISOString(),
        customerName: "Cliente concorrente Porto", customerPhone: "+351912345671",
      } }),
      request.post("/api/appointments/block", { headers: primaryHeaders, data: {
        barberId: sharedBarber.id, serviceId: primaryService.id, startTime: monday.toISOString(),
        name: "Cliente concorrente principal", phone: "+351912345672", customerEmail: "",
        isManualBooking: true, allowOutsideHours: true, isRecurring: false,
      } }),
    ]);
    expect(simultaneous.filter((response) => response.status() === 201)).toHaveLength(1);
    const refused = simultaneous.find((response) => response.status() !== 201)!;
    expect([400, 409]).toContain(refused.status());
    expect((await refused.json()).message).toContain("indisponível");
    for (const headers of [primaryHeaders, portoHeaders]) {
      const busy = await (await guest.get(`/api/appointments/public?barberId=${sharedBarber.id}&date=${monday.toISOString().slice(0, 10)}`, { headers })).json();
      expect(busy).toHaveLength(1);
      expect(busy[0]).not.toHaveProperty("customerName");
      expect(busy[0]).not.toHaveProperty("cancelToken");
      const adminBusyResponse = await request.get(`/api/appointments?scope=busy&barberId=${sharedBarber.id}&date=${monday.toISOString().slice(0, 10)}`, { headers });
      expect(adminBusyResponse.ok(), await adminBusyResponse.text()).toBe(true);
      expect(await adminBusyResponse.json()).toHaveLength(1);
    }

    // A token keeps the original location even with another shop selected in the browser.
    monday.setUTCHours(11, 0, 0, 0);
    const booked = await guest.post("/api/appointments", { headers: portoHeaders, data: {
      barberId: portoBarber.id, serviceId: portoService.id, startTime: monday.toISOString(),
      customerName: "Cliente reagendamento Porto", customerPhone: "+351912345673", customerEmail: "qa@example.com",
    } });
    expect(booked.status(), await booked.text()).toBe(201);
    const appointment = await booked.json();
    const tokenDetails = await (await guest.get(`/api/appointments/token/${appointment.cancelToken}`, { headers: primaryHeaders })).json();
    expect(tokenDetails).toMatchObject({ locationId: created[0].id, locationName: "Loja Porto" });
    monday.setUTCHours(12, 0, 0, 0);
    const rescheduled = await guest.post(`/api/appointments/reschedule/${appointment.cancelToken}`, {
      headers: primaryHeaders, data: { startTime: monday.toISOString() },
    });
    expect(rescheduled.ok(), await rescheduled.text()).toBe(true);
    expect((await rescheduled.json()).locationId).toBe(created[0].id);
    expect((await request.patch(`/api/appointments/${appointment.id}`, { headers: primaryHeaders, data: { status: "cancelled" } })).status()).toBe(404);

    const today = new Date().toISOString().slice(0, 10);
    const expenseResponse = await request.post("/api/admin/expenses", { headers: portoHeaders, data: {
      category: "materials", description: "Material apenas Porto", amountCents: 4275, expenseDate: today, recurrence: "once",
    } });
    expect(expenseResponse.status(), await expenseResponse.text()).toBe(201);
    const expense = await expenseResponse.json();
    expect((await request.delete(`/api/admin/expenses/${expense.id}`, { headers: primaryHeaders })).status()).toBe(404);
    for (const [headers, hasExpense] of [[primaryHeaders, false], [portoHeaders, true]] as const) {
      const expenses = await (await request.get("/api/admin/expenses", { headers })).json();
      expect(expenses.some((row: any) => row.id === expense.id)).toBe(hasExpense);
      const exported = await request.get(`/api/admin/export?startDate=${today}&endDate=${today}&barberId=all`, { headers });
      expect(exported.ok(), await exported.text()).toBe(true);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await exported.body());
      expect(JSON.stringify(workbook.getWorksheet("Despesas")?.getSheetValues()).includes("Material apenas Porto")).toBe(hasExpense);
    }
    await page.reload();
    await page.getByRole("tab", { name: "Relatórios" }).click();
    await expect(page.getByText("Material apenas Porto", { exact: true })).toBeVisible();
    await expect(page.getByTestId("business-expenses-total")).toHaveText("42,75 €");

    // Removing a shared barber in a shop without bookings must not disable the other shop.
    const noBookingLocationHeaders = simultaneous[0].status() === 201 ? primaryHeaders : portoHeaders;
    const bookingLocationHeaders = simultaneous[0].status() === 201 ? portoHeaders : primaryHeaders;
    expect((await request.delete(`/api/barbers/${sharedBarber.id}`, { headers: bookingLocationHeaders })).status()).toBe(409);
    expect((await request.delete(`/api/barbers/${sharedBarber.id}`, { headers: noBookingLocationHeaders })).ok()).toBe(true);
    expect((await request.get(`/api/barbers/${sharedBarber.id}`, { headers: bookingLocationHeaders })).ok()).toBe(true);
    expect((await request.patch(`/api/barbers/${sharedBarber.id}`, { headers: noBookingLocationHeaders, data: { isVisible: true } })).ok()).toBe(true);

    // A staff login sees assigned locations only; financial data and configuration remain protected.
    expect((await request.patch(`/api/barbers/${sharedBarber.id}`, { headers: portoHeaders, data: { email: "shared-barber@example.com" } })).ok()).toBe(true);
    const inviteResponse = await request.post(`/api/barbers/${sharedBarber.id}/invite`, { headers: portoHeaders });
    expect(inviteResponse.status()).toBe(201);
    const inviteToken = new URL((await inviteResponse.json()).inviteUrl).pathname.split("/").pop();
    expect((await page.request.post(`/api/barber-invites/${inviteToken}/accept`, { data: { password: "Barber-Test-2026!" } })).ok()).toBe(true);
    const staffLocations = await (await page.request.get("/api/account/locations")).json();
    expect(staffLocations.map((location: any) => location.id).sort()).toEqual([initial[0].id, created[0].id].sort());
    expect((await page.request.get("/api/appointments", { headers: { "X-Location-Id": String(created[1].id) } })).status()).toBe(403);
    expect((await page.request.get("/api/admin/expenses", { headers: portoHeaders })).status()).toBe(401);
    expect((await page.request.get("/api/admin/locations", { headers: portoHeaders })).status()).toBe(401);
    await page.goto("/admin");
    await expect(page.getByRole("tab", { name: "Agenda", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Localizações" })).not.toBeVisible();
    await expect(page.getByRole("tab", { name: "Equipa", exact: true })).not.toBeVisible();
    await page.getByRole("tab", { name: "Relatórios" }).click();
    await expect(page.getByText("Despesas da Barbearia", { exact: true })).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    await guest.dispose();
  }
});
