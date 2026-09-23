import { expect, test, type APIRequestContext } from "@playwright/test";
import ExcelJS from "exceljs";
import { calendarTimeInTimeZone, getAvailableTimeSlots } from "../../client/src/lib/availability";

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

const embed = (city: string) => `https://www.google.com/maps/embed?pb=${city}`;

async function ensureLocations(request: APIRequestContext, count: number) {
  await loginAdmin(request);
  const locations = await (await request.get("/api/admin/locations")).json();
  while (locations.length < count) {
    const response = await request.post("/api/admin/locations", { data: {
      name: `Loja de teste ${locations.length + 1}`, address: "Morada de teste",
      timezone: "Europe/Lisbon",
    } });
    expect(response.status(), await response.text()).toBe(201);
    locations.push(await response.json());
  }
  return locations;
}

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
        ...(city === "Braga" ? {} : {
          mapUrl: `https://www.google.com/maps?q=${city}`,
          mapEmbedUrl: embed(city),
        }),
        timezone: "Europe/Lisbon",
        isActive: true,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    const location = await response.json();
    expect(location.isActive).toBe(false);
    if (city === "Braga") expect(location).toMatchObject({ mapUrl: null, mapEmbedUrl: null });
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
  await expect(locationSection.locator("iframe")).toHaveAttribute("src", `https://www.google.com/maps?q=${encodeURIComponent(created[1].address)}&output=embed`);
  await expect(locationSection.getByRole("link", { name: "Abrir no Google Maps" })).toHaveAttribute("href", `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(created[1].address)}`);
  // A shop change from another tab must update the map and the public catalogue together.
  await page.evaluate((id) => {
    localStorage.setItem("barberbookings:location-id", String(id));
    window.dispatchEvent(new StorageEvent("storage", { key: "barberbookings:location-id", newValue: String(id) }));
  }, created[0].id);
  await expect(locationSection.locator("iframe")).toHaveAttribute("title", "Mapa de Loja Porto");
  await expect(locationSection.locator("iframe")).toHaveAttribute("src", embed("Porto"));
  await expect(locationSection.getByRole("link", { name: "Abrir no Google Maps" })).toHaveAttribute("href", "https://www.google.com/maps?q=Porto");
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

  // Editing existing custom links must not discard them merely because advanced fields are collapsed.
  await page.getByRole("button", { name: "Editar Loja Porto", exact: true }).click();
  const locationDialog = page.getByRole("dialog", { name: "Editar localização" });
  await expect(locationDialog.getByLabel("Link do Google Maps", { exact: true })).not.toBeVisible();
  await locationDialog.getByRole("button", { name: "Guardar localização" }).click();
  await expect(locationDialog).not.toBeVisible();
  const preservedLocations = await (await request.get("/api/admin/locations")).json();
  expect(preservedLocations.find((location: any) => location.id === created[0].id)).toMatchObject({
    mapUrl: "https://www.google.com/maps?q=Porto", mapEmbedUrl: embed("Porto"),
  });

  // The default shop can also use address-only maps, even with legacy environment links configured.
  await page.getByRole("button", { name: `Editar ${initial[0].name}`, exact: true }).click();
  const updatedAddress = "Praça do Comércio, 25, 1100-148 Lisboa";
  await locationDialog.getByLabel("Morada completa").fill(updatedAddress);
  await locationDialog.locator("summary").click();
  await expect(locationDialog.getByLabel("Link do Google Maps", { exact: true })).toBeVisible();
  expect(await locationDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await locationDialog.getByRole("button", { name: "Usar apenas a morada" }).click();
  await expect(locationDialog.getByLabel("Link do Google Maps", { exact: true })).toHaveValue("");
  await expect(locationDialog.getByLabel("Link de incorporação do mapa")).toHaveValue("");
  await locationDialog.getByRole("button", { name: "Guardar localização" }).click();
  await expect(locationDialog).not.toBeVisible();
  const addressOnlyLocations = await (await request.get("/api/admin/locations")).json();
  expect(addressOnlyLocations.find((location: any) => location.id === initial[0].id)).toMatchObject({
    address: updatedAddress, mapUrl: null, mapEmbedUrl: null,
  });
  await page.goto("/");
  await locationSection.getByRole("button", { name: new RegExp(initial[0].name) }).click();
  await expect(locationSection.locator("iframe")).toHaveAttribute("src", `https://www.google.com/maps?q=${encodeURIComponent(updatedAddress)}&output=embed`);
  await expect(locationSection.getByRole("link", { name: "Abrir no Google Maps" })).toHaveAttribute("href", `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(updatedAddress)}`);
  // Keep the remainder of the isolation tests managing Porto.
  await locationSection.getByRole("button", { name: /Loja Porto/ }).click();
  await page.goto("/admin");

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

test("[multi-location] dropdown opaco sobre os tabs, viewport e nomes longos com 1/2/3 lojas", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const locations = await ensureLocations(request, 3);
  await loginAdmin(page.request);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const count of [1, 2, 3]) {
      const visible = locations.slice(0, count).map((location: any, index: number) => ({
        ...location, name: `Loja ${index + 1} — Avenida com um nome especialmente longo para testar o seletor no telemóvel`,
      }));
      await page.route("**/api/account/locations", (route) => route.fulfill({ json: visible }));
      await page.goto("/admin");
      await page.getByRole("tab", { name: "Localizações", exact: true }).click();
      const trigger = page.getByRole("combobox").first();
      await trigger.click();
      const dropdown = page.getByRole("listbox");
      await expect(dropdown).toBeVisible();
      await expect(dropdown).toHaveCSS("opacity", "1");
      await expect(dropdown.getByRole("option")).toHaveCount(count);
      const layout = await dropdown.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor, zIndex: style.zIndex,
          portalled: !document.getElementById("root")?.contains(element),
          topmost: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
          fits: rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      await page.screenshot({ path: testInfo.outputPath(`dropdown-${width}-${count}.png`), animations: "disabled" });
      expect(layout.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(layout).toMatchObject({ portalled: true, topmost: true, fits: true, overflow: false });
      expect(Number(layout.zIndex)).toBeGreaterThan(30);
      await dropdown.getByRole("option").last().click();
      await expect(trigger).toContainText(visible[count - 1].name);
      await expect(dropdown).not.toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.unroute("**/api/account/locations");
    }
  }
});

test("[multi-location] horário semanal por loja: UI, cache, público, manual e conflito global", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const [shopA, shopB] = await ensureLocations(request, 2);
  await loginAdmin(page.request);
  const headersFor = (id: number) => ({ "X-Location-Id": String(id) });
  const shopHours = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "20:00", isOpen: true }));
  const services: any[] = [];
  for (const shop of [shopA, shopB]) {
    expect((await request.patch(`/api/admin/locations/${shop.id}`, { data: { isActive: true } })).ok()).toBe(true);
    expect((await request.patch("/api/shop/availability", { headers: headersFor(shop.id), data: shopHours })).ok()).toBe(true);
    const response = await request.post("/api/services", { headers: headersFor(shop.id), data: {
      name: `Corte horário ${shop.id}`, description: "Teste de horário semanal", duration: 30, price: 1500, isVisible: true,
    } });
    expect(response.status(), await response.text()).toBe(201);
    services.push(await response.json());
  }
  const response = await request.post("/api/barbers", { headers: headersFor(shopA.id), data: {
    name: "Barbeiro semanal QA", specialty: "Horários por loja", bio: "Teste", color: "#336699", isVisible: true, serviceIds: [services[0].id],
  } });
  expect(response.status(), await response.text()).toBe(201);
  const barber = await response.json();
  expect((await request.post("/api/admin/location-barbers", { headers: headersFor(shopB.id), data: { barberId: barber.id } })).status()).toBe(201);
  expect((await request.patch(`/api/barbers/${barber.id}/services`, { headers: headersFor(shopB.id), data: { serviceIds: [services[1].id] } })).ok()).toBe(true);
  const path = `/api/barbers/${barber.id}/availability`;
  const read = async (shop: any) => (await request.get(path, { headers: headersFor(shop.id) })).json();
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Equipa", exact: true }).click();
  const selectShop = async (shop: any) => {
    await page.getByLabel("Loja em gestão").click();
    await page.getByRole("option", { name: shop.name, exact: true }).click();
    await expect(page.getByLabel("Loja em gestão")).toContainText(shop.name);
  };
  const dialog = page.getByRole("dialog", { name: `Horário de ${barber.name}`, exact: true });
  const open = async () => {
    await page.getByRole("button", { name: `Horário de ${barber.name} nesta loja` }).click();
    await expect(dialog.getByRole("button", { name: "Guardar horário nesta loja", exact: true })).toBeVisible();
  };
  const days = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
  const configure = async (workingDays: number[], shop: any) => {
    for (const [index, day] of days.entries()) {
      const toggle = dialog.getByRole("switch", { name: `Trabalha ${day}`, exact: true });
      const working = workingDays.includes(index);
      if ((await toggle.getAttribute("aria-checked") === "true") !== working) await toggle.click();
      if (working) {
        await dialog.getByLabel(`Início ${day} 1`, { exact: true }).fill(shop.id === shopB.id && index !== 6 ? "10:00" : "09:00");
        await dialog.getByLabel(`Fim ${day} 1`, { exact: true }).fill(shop.id === shopA.id ? "19:00" : index === 6 ? "18:00" : "20:00");
      }
    }
  };
  const save = async (shop: any) => {
    const saved = page.waitForResponse((res) => res.url().endsWith(path) && res.request().method() === "PATCH");
    await dialog.getByRole("button", { name: "Guardar horário nesta loja", exact: true }).click();
    const res = await saved;
    expect(res.ok(), await res.text()).toBe(true);
    expect(res.request().headers()["x-location-id"]).toBe(String(shop.id));
    await expect(dialog).not.toBeVisible();
  };
  await selectShop(shopA);
  await open();
  await expect(dialog).toContainText("Sem horário próprio");
  await configure([1, 2, 3], shopA);
  await save(shopA);
  const savedA = await read(shopA);
  expect(savedA).toHaveLength(7);
  expect(await read(shopB)).toEqual([]);

  await selectShop(shopB);
  await open();
  await expect(dialog).toContainText("Sem horário próprio");
  await configure([4, 5, 6], shopB);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect.poll(() => dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x), right: Math.round(rect.right), width: Math.round(rect.width) };
  })).toEqual({ x: 8, right: 312, width: 304 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.evaluate((element) => { element.scrollTop = 0; });
  await expect(page.getByText("Horário guardado", { exact: true })).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("barber-schedule-mobile.png"), animations: "disabled" });
  await save(shopB);
  const savedB = await read(shopB);
  expect(await read(shopA)).toEqual(savedA);
  await selectShop(shopA);
  await open();
  await expect(dialog.getByLabel("Início Segunda-feira 1", { exact: true })).toHaveValue("09:00");
  await expect(dialog.getByRole("switch", { name: "Trabalha Quinta-feira", exact: true })).not.toBeChecked();
  // Existing server validation is used unchanged; an invalid edit must leave both shops intact.
  await dialog.getByRole("region", { name: "Segunda-feira", exact: true }).getByRole("button", { name: "Adicionar período" }).click();
  await dialog.getByRole("button", { name: "Guardar horário nesta loja", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("sobrepostos");
  expect(await read(shopA)).toEqual(savedA);
  expect(await read(shopB)).toEqual(savedB);
  await dialog.getByRole("button", { name: "Remover período 2 Segunda-feira", exact: true }).click();
  await dialog.getByLabel("Início Segunda-feira 1", { exact: true }).fill("10:00");
  await save(shopA);
  expect(await read(shopB)).toEqual(savedB);
  await open();
  await expect(dialog.getByLabel("Início Segunda-feira 1", { exact: true })).toHaveValue("10:00");
  await configure([], shopA);
  await save(shopA);
  expect(await read(shopA)).toHaveLength(7);
  expect((await read(shopA)).every((row: any) => row.isWorking === false)).toBe(true);
  await open();
  await expect(dialog.getByRole("switch", { name: "Trabalha Segunda-feira", exact: true })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Usar horário da loja", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await read(shopA)).toEqual([]);
  expect(await read(shopB)).toEqual(savedB);
  await open();
  await configure([1, 2, 3], shopA);
  await save(shopA);

  // A late response for A must never initialise the B editor, even with the same barber ID.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reached!: () => void;
  const delayed = new Promise<void>((resolve) => { reached = resolve; });
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "GET" || route.request().headers()["x-location-id"] !== String(shopA.id)) return route.continue();
    const result = await route.fetch();
    reached();
    await gate;
    await route.fulfill({ response: result }).catch(() => {}); // Request can be aborted on unmount.
  });
  await page.getByRole("button", { name: `Horário de ${barber.name} nesta loja` }).click();
  await delayed;
  await page.evaluate((id) => {
    localStorage.setItem("barberbookings:location-id", String(id));
    window.dispatchEvent(new StorageEvent("storage", { key: "barberbookings:location-id", newValue: String(id) }));
  }, shopB.id);
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("Loja em gestão")).toContainText(shopB.name);
  await open();
  release();
  await expect(dialog.getByLabel("Início Quinta-feira 1", { exact: true })).toHaveValue("10:00");
  await expect(dialog.getByRole("switch", { name: "Trabalha Segunda-feira", exact: true })).not.toBeChecked();
  await page.keyboard.press("Escape");
  await page.unroute(`**${path}`);

  // An unsuccessful load cannot turn cached data into a saveable blank/default week.
  await page.route(`**${path}`, (route) => route.fulfill({ status: 500, json: { message: "Teste: indisponível" } }));
  await page.getByRole("button", { name: `Horário de ${barber.name} nesta loja` }).click();
  await expect(dialog.getByRole("alert")).toContainText("Não foi possível carregar");
  await expect(dialog.getByRole("button", { name: "Guardar horário nesta loja", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.unroute(`**${path}`);

  const monday = new Date(Date.now() + 28 * 86400000);
  monday.setDate(monday.getDate() + (8 - monday.getDay()) % 7);
  monday.setHours(12, 0, 0, 0);
  // Keep the calendar fixture in a single month (the last week can straddle two months).
  const saturday = new Date(monday);
  saturday.setDate(saturday.getDate() + 5);
  if (saturday.getMonth() !== monday.getMonth()) monday.setDate(monday.getDate() + 7);
  const iso = (day: Date, time: string) => calendarTimeInTimeZone(day, time, "Europe/Lisbon").toISOString();
  const dateKey = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  for (let weekday = 1; weekday <= 6; weekday++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + weekday - 1);
    for (const [index, shop] of [shopA, shopB].entries()) {
      const working = index === 0 ? weekday <= 3 : weekday >= 4;
      const headers = headersFor(shop.id);
      const rows = await (await request.get("/api/barbers/availability", { headers })).json();
      const slots = getAvailableTimeSlots({
        selectedService: services[index], selectedDate: day, selectedBarberId: barber.id,
        visibleBarbers: [await (await request.get(`/api/barbers/${barber.id}`, { headers })).json()],
        availabilityRows: rows, shopAvailabilityRows: shopHours, existingAppointments: [], timeZone: "Europe/Lisbon",
      }).filter((slot) => slot.available);
      if (working) {
        expect(slots[0].time).toBe(index === 0 || weekday === 6 ? "09:00" : "10:00");
        expect(slots.at(-1)?.time).toBe(index === 0 ? "18:30" : weekday === 6 ? "17:30" : "19:30");
      } else expect(slots).toEqual([]);
      const publicResult = await request.post("/api/appointments", { headers, data: {
        barberId: barber.id, serviceId: services[index].id, startTime: iso(day, "12:00"),
        customerName: "Horário semanal público QA", customerPhone: "+351912000081",
      } });
      expect(publicResult.status(), await publicResult.text()).toBe(working ? 201 : 400);
      const manualResult = await request.post("/api/appointments/block", { headers, data: {
        barberId: barber.id, serviceId: services[index].id, startTime: iso(day, "13:00"),
        name: "Horário semanal manual QA", phone: "+351912000082", customerEmail: "",
        isManualBooking: true, isRecurring: false, allowOutsideHours: false,
      } });
      expect(manualResult.status(), await manualResult.text()).toBe(working ? 201 : 400);
    }
  }
  // Browser step 3 uses the saved location-specific schedule (including the closed weekdays).
  for (const [index, shop] of [shopA, shopB].entries()) {
    const day = new Date(monday);
    day.setDate(day.getDate() + (index === 0 ? 0 : 3));
    await page.evaluate((id) => localStorage.setItem("barberbookings:location-id", String(id)), shop.id);
    await page.goto(`/book?barberId=${barber.id}&serviceId=${services[index].id}&date=${dateKey(day)}`);
    await expect(page.getByRole("heading", { name: "Selecione a Data" })).toBeVisible();
    // The existing booking flow auto-selects the first available date. Select our test date afterwards.
    await page.waitForLoadState("networkidle");
    const month = new Intl.DateTimeFormat("pt-PT", { month: "long" }).format(day);
    const targetMonth = page.getByRole("grid", { name: new RegExp(`${month}.*${day.getFullYear()}`) });
    for (let next = 0; next < 3 && !await targetMonth.count(); next++) {
      await page.getByRole("button", { name: "Go to next month" }).click();
    }
    await expect(targetMonth).toBeVisible();
    await targetMonth.locator("[role='gridcell']:not(.day-outside)")
      .filter({ hasText: new RegExp(`^${day.getDate()}$`) })
      .click();
    await expect(page.locator("button[aria-selected='true']")).toHaveText(String(day.getDate()));
    await expect(page.getByRole("button", { name: index === 0 ? "09:00h" : "10:00h", exact: true })).toBeEnabled();
    if (index === 1) await expect(page.getByRole("button", { name: "09:00h", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "12:00h", exact: true })).toBeDisabled();
    const closedDay = new Date(monday);
    closedDay.setDate(closedDay.getDate() + (index === 0 ? 3 : 0));
    await targetMonth.locator("[role='gridcell']:not(.day-outside)")
      .filter({ hasText: new RegExp(`^${closedDay.getDate()}$`) })
      .click();
    await expect(page.getByRole("button", { name: /^\d{2}:\d{2}h$/ })).toHaveCount(0);
  }
  for (const shop of [shopA, shopB]) {
    const persisted = (await (await request.get("/api/appointments", { headers: headersFor(shop.id) })).json())
      .filter((appointment: any) => appointment.barberId === barber.id);
    expect(persisted).toHaveLength(6); // 3 working days x public + manual, none on closed days.
  }
  // Even deliberately overlapping schedules must not allow cross-location double booking.
  expect((await request.patch(path, { headers: headersFor(shopB.id), data: [
    { dayOfWeek: 1, startTime: "09:00", endTime: "20:00", isWorking: true },
  ] })).ok()).toBe(true);
  // One-hour services allow a partial overlap using the public 30-minute start grid.
  for (const [index, shop] of [shopA, shopB].entries()) {
    expect((await request.patch(`/api/services/${services[index].id}`, {
      headers: headersFor(shop.id), data: { duration: 60 },
    })).ok()).toBe(true);
  }
  const attempts = await Promise.all([shopA, shopB].map((shop, index) => request.post("/api/appointments", {
    headers: headersFor(shop.id), data: {
      barberId: barber.id, serviceId: services[index].id, startTime: iso(monday, "15:00"),
      customerName: "Conflito global semanal QA", customerPhone: `+35191200008${index + 3}`,
    },
  })));
  expect(attempts.map((result) => result.status()).sort()).toEqual([201, 409]);
  const acrossShops = (await Promise.all([shopA, shopB].map(async (shop) => (await request.get("/api/appointments", { headers: headersFor(shop.id) })).json()))).flat()
    .filter((appointment: any) => appointment.barberId === barber.id && appointment.startTime === iso(monday, "15:00"));
  expect(acrossShops).toHaveLength(1);
  const otherIndex = attempts[0].status() === 201 ? 1 : 0;
  const partialOverlap = await request.post("/api/appointments", {
    headers: headersFor([shopA, shopB][otherIndex].id), data: {
      barberId: barber.id, serviceId: services[otherIndex].id, startTime: iso(monday, "15:30"),
      customerName: "Sobreposição parcial noutra loja QA", customerPhone: "+351912000085",
    },
  });
  expect(partialOverlap.status()).toBe(409);
  expect((await partialOverlap.json()).message).toBe("Este horário já está reservado.");
  for (const shop of [shopA, shopB]) {
    const busy = await (await request.get(`/api/appointments/public?barberId=${barber.id}&date=${dateKey(monday)}`, { headers: headersFor(shop.id) })).json();
    expect(busy.filter((appointment: any) => appointment.startTime === iso(monday, "15:00"))).toHaveLength(1);
    expect(busy.some((appointment: any) => appointment.startTime === iso(monday, "15:30"))).toBe(false);
  }
});

test("[multi-location] photo references carry shop context and enforce visibility", async ({ request, playwright, baseURL }) => {
  const locations = await ensureLocations(request, 2);
  const location = locations[1];
  await request.patch(`/api/admin/locations/${location.id}`, { data: { isActive: true } });
  const headers = { "X-Location-Id": String(location.id) };
  const avatar = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6bpIAAAAASUVORK5CYII=";
  const create = await request.post("/api/barbers", { headers, data: {
    name: "Scoped image QA", specialty: "Corte", avatar, isVisible: true, serviceIds: [],
  } });
  expect(create.status()).toBe(201);
  const barber = await create.json();
  const anonymous = await playwright.request.newContext({ baseURL });
  try {
    const records = await (await anonymous.get("/api/barbers?avatarMode=reference", { headers })).json();
    const reference = records.find((item: any) => item.id === barber.id).avatar;
    expect(reference).toContain(`locationId=${location.id}`);
    // An image cannot send X-Location-Id; the URL alone must select the right shop.
    expect((await anonymous.get(reference)).status()).toBe(200);
    expect((await anonymous.get(reference.replace(`locationId=${location.id}`, `locationId=${locations[0].id}`))).status()).toBe(404);
    expect((await anonymous.get(reference.replace(`locationId=${location.id}`, "locationId=invalid"))).status()).toBe(400);
    await request.patch(`/api/barbers/${barber.id}`, { headers, data: { isVisible: false } });
    expect((await anonymous.get(reference)).status()).toBe(404);
    expect((await request.get(reference)).status()).toBe(200);
  } finally {
    await request.delete(`/api/barbers/${barber.id}`, { headers });
    await anonymous.dispose();
  }
});
