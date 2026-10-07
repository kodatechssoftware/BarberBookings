import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { calendarTimeInTimeZone, getAvailableTimeSlots } from "../../client/src/lib/availability";

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

const embed = (city: string) => `https://www.google.com/maps/embed?pb=${city}`;

function getHeaderRow(sheet: ExcelJS.Worksheet, firstHeader: string) {
  let headerRow: ExcelJS.Row | undefined;
  sheet.eachRow((row) => {
    if (!headerRow && row.getCell(1).value === firstHeader) headerRow = row;
  });
  if (!headerRow) throw new Error(`Header ${firstHeader} not found in ${sheet.name}`);
  return headerRow;
}

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

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function selectAgendaDay(page: Page, isoDate: string) {
  const dayKey = localDateKey(new Date(isoDate));
  const targetDay = () => page.getByTestId(`weekly-agenda-day-${dayKey}`).filter({ visible: true }).first();

  if (await targetDay().count()) {
    await targetDay().click();
    return;
  }

  await page.getByRole("button", { name: "Hoje" }).click();
  const targetDate = new Date(`${dayKey}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const directionButton = targetDate >= today ? "Semana seguinte" : "Semana anterior";

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await targetDay().count()) {
      await targetDay().click();
      return;
    }
    await page.getByRole("button", { name: directionButton }).click();
  }

  throw new Error(`Could not navigate weekly agenda to ${dayKey}`);
}

test("[multi-location] isola quatro lojas, mapas, equipa, reservas, permissões e relatórios", async ({ page, request, playwright, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  expect((await request.get("/api/admin/locations")).status()).toBe(401);
  await loginAdmin(request);

  const initial = await (await request.get("/api/admin/locations")).json();
  expect(initial).toHaveLength(1);
  expect(initial[0]).toMatchObject({ isDefault: true, isActive: true });
  await page.goto("/book");
  await expect(page.getByRole("heading", { name: "Seleciona o barbeiro" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Onde quer marcar?" })).toHaveCount(0);

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

  const activateLocation = async (location: any) => {
    const response = await request.patch(`/api/admin/locations/${location.id}`, { data: { isActive: true } });
    expect(response.ok(), await response.text()).toBe(true);
  };
  const assertPublicLocationLayout = async (expectedCount: number, label: string) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 820, height: 1180 },
      { width: 1024, height: 900 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/book");
      await expect(page.getByRole("heading", { name: "Onde quer marcar?" })).toBeVisible();
      const grid = page.getByTestId("booking-location-grid");
      const cards = grid.locator("button");
      await expect(cards).toHaveCount(expectedCount);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      const firstCard = await cards.nth(0).boundingBox();
      const secondCard = await cards.nth(1).boundingBox();
      expect(firstCard).not.toBeNull();
      expect(secondCard).not.toBeNull();
      if (viewport.width === 390) expect(secondCard!.y).toBeGreaterThan(firstCard!.y);
      if (viewport.width >= 1024) expect(Math.abs(secondCard!.y - firstCard!.y)).toBeLessThanOrEqual(2);

      if ([390, 820, 1920].includes(viewport.width)) {
        await page.screenshot({
          path: testInfo.outputPath(`location-choice-${label}-${viewport.width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
  };

  await activateLocation(created[0]);
  await assertPublicLocationLayout(2, "two");
  for (const location of created.slice(1)) {
    await activateLocation(location);
  }
  await assertPublicLocationLayout(4, "four");

  const deactivateDefault = await request.patch(`/api/admin/locations/${initial[0].id}`, { data: { isActive: false } });
  expect(deactivateDefault.status()).toBe(409);
  expect(await (await request.get("/api/locations")).json()).toHaveLength(4);
  expect(await (await request.get("/api/locations?purpose=booking")).json()).toHaveLength(4);
  expect(await (await request.get("/api/account/locations")).json()).toHaveLength(4);

  const portoHeaders = { "X-Location-Id": String(created[0].id) };
  const serviceResponse = await request.post("/api/services", {
    headers: portoHeaders,
    data: { name: "Corte Porto", description: "Exclusivo Porto", price: 1700, duration: 30, isVisible: true },
  });
  expect(serviceResponse.status(), await serviceResponse.text()).toBe(201);
  const portoService = await serviceResponse.json();
  const categoryResponse = await request.post("/api/service-categories", { data: { name: "Categoria Porto QA" } });
  expect(categoryResponse.status(), await categoryResponse.text()).toBe(201);
  const portoCategory = await categoryResponse.json();
  const categorizePortoService = await request.patch(`/api/services/${portoService.id}`, {
    headers: portoHeaders,
    data: { categoryId: portoCategory.id },
  });
  expect(categorizePortoService.ok(), await categorizePortoService.text()).toBe(true);

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

  const noServiceBarberResponse = await request.post("/api/barbers", {
    headers: { "X-Location-Id": String(created[2].id) },
    data: {
      name: "Barbeiro sem serviços QA",
      specialty: "Catálogo em preparação",
      bio: "Teste visual do estado vazio",
      color: "#5B6472",
      isVisible: true,
      serviceIds: [],
    },
  });
  expect(noServiceBarberResponse.status(), await noServiceBarberResponse.text()).toBe(201);
  const noServiceBarber = await noServiceBarberResponse.json();

  const portoServices = await (await request.get("/api/services", { headers: portoHeaders })).json();
  const portoBarbers = await (await request.get("/api/barbers", { headers: portoHeaders })).json();
  expect(portoServices.some((service: any) => service.id === portoService.id)).toBe(true);
  expect(portoServices.find((service: any) => service.id === portoService.id)?.category).toMatchObject({
    id: portoCategory.id,
    name: "Categoria Porto QA",
  });
  expect(portoBarbers.some((barber: any) => barber.id === portoBarber.id)).toBe(true);

  const defaultServices = await (await request.get("/api/services")).json();
  const defaultBarbers = await (await request.get("/api/barbers")).json();
  const defaultVisibleBarber = defaultBarbers.find((barber: any) => barber.isVisible !== false);
  expect(defaultVisibleBarber).toBeTruthy();
  expect(defaultServices.some((service: any) => service.id === portoService.id)).toBe(false);
  expect(defaultServices.every((service: any) => service.category?.id !== portoCategory.id)).toBe(true);
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
  expect(await (await request.get("/api/locations?purpose=booking")).json()).toHaveLength(4);

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
  expect(await crossLocationBooking.json()).toMatchObject({ code: "LOCATION_REQUIRED" });

  await page.goto("/");
  const locationSection = page.locator("#location");
  await expect(locationSection.getByRole("button", { name: /Loja Braga/ })).toBeVisible();
  await locationSection.getByRole("button", { name: /Loja Braga/ }).click();
  await expect(locationSection.locator("iframe")).toHaveCount(1);
  await expect(locationSection.locator("iframe")).toHaveAttribute("title", "Mapa de Loja Braga");
  const bragaEmbedUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${created[1].name}, ${created[1].address}`)}&output=embed`;
  await expect(locationSection.locator("iframe")).toHaveAttribute("src", bragaEmbedUrl);
  await expect(locationSection.getByRole("link", { name: "Abrir no Google Maps" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(locationSection.locator("iframe")).toHaveAttribute("src", bragaEmbedUrl);
  const mobileMap = await locationSection.getByTestId("location-map-container").boundingBox();
  expect(mobileMap).not.toBeNull();
  expect(mobileMap!.x).toBeGreaterThanOrEqual(0);
  expect(mobileMap!.x + mobileMap!.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 900 });
  // A shop change from another tab must update the map and the public catalogue together.
  await page.evaluate((id) => {
    localStorage.setItem("barberbookings:location-id", String(id));
    window.dispatchEvent(new StorageEvent("storage", { key: "barberbookings:location-id", newValue: String(id) }));
  }, created[0].id);
  await expect(locationSection.locator("iframe")).toHaveAttribute("title", "Mapa de Loja Porto");
  await expect(locationSection.locator("iframe")).toHaveAttribute("src", embed("Porto"));
  await expect(page.getByText("Rui Porto", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Categoria Porto QA", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.evaluate(() => localStorage.removeItem("barberbookings:location-id"));
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`/book?barberId=${portoBarber.id}&serviceId=${portoService.id}`);
  await expect(page.getByRole("heading", { name: "Onde quer marcar?" })).toBeVisible();
  await page.getByRole("button", { name: /Loja Braga/ }).click();
  const barberEmptyState = page.getByTestId("booking-empty-state");
  await expect(barberEmptyState).toContainText("não tem barbeiros disponíveis");
  await expect(page.getByTestId("booking-actions").getByRole("button", { name: "Seguinte" })).toBeDisabled();
  const barberEmptyBounds = await barberEmptyState.boundingBox();
  expect(barberEmptyBounds).not.toBeNull();
  await page.screenshot({ path: testInfo.outputPath("empty-barbers-1024.png"), fullPage: true, animations: "disabled" });

  await page.getByRole("button", { name: "Mudar loja" }).click();
  await page.getByRole("button", { name: /Loja Coimbra/ }).click();
  await page.getByText(noServiceBarber.name, { exact: true }).click();
  await page.getByRole("button", { name: "Seguinte" }).click();
  const serviceEmptyState = page.getByTestId("booking-empty-state");
  await expect(serviceEmptyState).toContainText("não tem serviços disponíveis");
  await expect(page.getByTestId("booking-actions").getByRole("button", { name: "Seguinte" })).toBeDisabled();
  const serviceEmptyBounds = await serviceEmptyState.boundingBox();
  expect(serviceEmptyBounds).not.toBeNull();
  expect(Math.abs(serviceEmptyBounds!.width - barberEmptyBounds!.width)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath("empty-services-1024.png"), fullPage: true, animations: "disabled" });

  await page.getByRole("button", { name: "Mudar loja" }).click();
  await page.getByRole("button", { name: /Loja Porto/ }).click();
  await expect(page.getByRole("heading", { name: "Seleciona o barbeiro" })).toBeVisible();
  await expect(page.getByText("Rui Porto", { exact: true })).toBeVisible();
  await expect(page.getByText("Tiago Martins", { exact: true })).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const changeLocation = await page.getByRole("button", { name: "Mudar loja" }).boundingBox();
  expect(changeLocation).toBeTruthy();
  expect(changeLocation!.x + changeLocation!.width).toBeLessThanOrEqual(390);
  await page.getByText("Rui Porto", { exact: true }).click();
  await page.getByRole("button", { name: "Seguinte" }).click();
  await expect(page.getByRole("heading", { name: "Categoria Porto QA", exact: true })).toBeVisible();
  await page.getByText(portoService.name, { exact: true }).click();
  await page.getByRole("button", { name: "Seguinte" }).click();
  await expect(page.getByRole("heading", { name: "Selecione a Data" })).toBeVisible();
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.screenshot({ path: testInfo.outputPath("multi-date-time-820.png"), fullPage: true, animations: "disabled" });
  const enabledTimeSlot = page.locator("button:not(:disabled)").filter({ hasText: /^\d{2}:\d{2}h$/ }).first();
  await expect(enabledTimeSlot).toBeVisible();
  await enabledTimeSlot.click();
  await page.getByRole("button", { name: "Seguinte" }).click();
  await expect(page.getByText("Resumo da Marcação", { exact: true })).toBeVisible();
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`multi-details-${viewport.width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Mudar loja" }).click();
  await page.getByRole("button", { name: initial[0].name }).click();
  await expect(page.getByRole("heading", { name: "Seleciona o barbeiro" })).toBeVisible();
  await expect(page.getByText("Rui Porto", { exact: true })).toHaveCount(0);
  await expect(page.getByText(defaultVisibleBarber.name, { exact: true })).toBeVisible();
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  expect((await request.delete(`/api/service-categories/${portoCategory.id}`)).ok()).toBe(true);

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
  await expect(locationSection.locator("iframe")).toHaveAttribute("src", `https://www.google.com/maps?q=${encodeURIComponent(`${initial[0].name}, ${updatedAddress}`)}&output=embed`);
  // Keep the remainder of the isolation tests managing Porto.
  await locationSection.getByRole("button", { name: /Loja Porto/ }).click();
  await page.goto("/admin");

  const primaryHeaders = { "X-Location-Id": String(initial[0].id) };
  const sharedBarber = defaultBarbers[0];
  const primaryService = defaultServices.find((service: any) => sharedBarber.serviceIds.includes(service.id));
  expect(primaryService).toBeTruthy();

  // Associate through the UI, retaining the barber's services in the original shop.
  await page.getByRole("tab", { name: "Equipa", exact: true }).click();
  await page.getByRole("button", { name: "Associar barbeiro existente" }).click();
  const associateDialog = page.getByRole("dialog", { name: "Associar barbeiro a esta loja" });
  await associateDialog.getByRole("combobox").click();
  await page.getByRole("option", { name: sharedBarber.name, exact: true }).click();
  await associateDialog.getByRole("button", { name: "Associar à loja", exact: true }).click();
  await expect(associateDialog).not.toBeVisible();
  const initiallyInPorto = await (await request.get(`/api/barbers/${sharedBarber.id}`, { headers: portoHeaders })).json();
  const inPrimary = await (await request.get(`/api/barbers/${sharedBarber.id}`, { headers: primaryHeaders })).json();
  expect(initiallyInPorto.serviceIds).toEqual([]);
  const configurePortoServices = await request.patch(`/api/barbers/${sharedBarber.id}/services`, {
    headers: portoHeaders,
    data: { serviceIds: [portoService.id] },
  });
  expect(configurePortoServices.ok(), await configurePortoServices.text()).toBe(true);

  // The Admin picker edits only the active shop and explicitly supports zero services.
  await page.reload();
  await page.getByRole("tab", { name: "Equipa", exact: true }).click();
  const sharedBarberCard = page.locator(`[data-testid="team-barber-card"][data-barber-id="${sharedBarber.id}"]`);
  await sharedBarberCard.getByRole("button", { name: "Editar", exact: true }).click();
  const editSharedBarberDialog = page.getByRole("dialog", { name: "Editar Barbeiro" });
  const portoServiceOption = editSharedBarberDialog.locator("label").filter({ hasText: portoService.name });
  await expect(portoServiceOption.getByRole("checkbox")).toBeChecked();
  await portoServiceOption.getByRole("checkbox").click();
  await editSharedBarberDialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(editSharedBarberDialog).not.toBeVisible();
  expect((await (await request.get(`/api/barbers/${sharedBarber.id}`, { headers: portoHeaders })).json()).serviceIds).toEqual([]);
  expect((await (await request.get(`/api/barbers/${sharedBarber.id}`, { headers: primaryHeaders })).json()).serviceIds)
    .toContain(primaryService.id);
  const restorePortoServices = await request.patch(`/api/barbers/${sharedBarber.id}/services`, {
    headers: portoHeaders,
    data: { serviceIds: [portoService.id] },
  });
  expect(restorePortoServices.ok(), await restorePortoServices.text()).toBe(true);

  const inPorto = await (await request.get(`/api/barbers/${sharedBarber.id}`, { headers: portoHeaders })).json();
  expect(inPorto.serviceIds).toEqual([portoService.id]);
  expect(inPrimary.serviceIds).toContain(primaryService.id);
  expect(inPrimary.serviceIds).not.toContain(portoService.id);
  const barberFilterDate = new Date().toISOString().slice(0, 10);
  const primaryExportBarbers = await (await request.get(
    `/api/admin/export/barbers?startDate=${barberFilterDate}&endDate=${barberFilterDate}`,
    { headers: primaryHeaders },
  )).json();
  const portoExportBarbers = await (await request.get(
    `/api/admin/export/barbers?startDate=${barberFilterDate}&endDate=${barberFilterDate}`,
    { headers: portoHeaders },
  )).json();
  expect(primaryExportBarbers.active.map((item: any) => item.id)).toContain(sharedBarber.id);
  expect(primaryExportBarbers.active.map((item: any) => item.id)).not.toContain(portoBarber.id);
  expect(portoExportBarbers.active.map((item: any) => item.id)).toEqual(expect.arrayContaining([
    sharedBarber.id,
    portoBarber.id,
  ]));
  expect((await request.patch(`/api/barbers/${sharedBarber.id}/services`, {
    headers: portoHeaders, data: { serviceIds: [primaryService.id] },
  })).status()).toBe(400);

  const missingLocationMutation = await request.patch("/api/admin/customers/+351912345680/notes", {
    data: { customerName: "Cliente multi loja", email: "multi@example.test", notes: "Não deve ser gravada" },
  });
  expect(missingLocationMutation.status()).toBe(400);
  expect(await missingLocationMutation.json()).toMatchObject({ code: "LOCATION_REQUIRED" });
  expect((await request.patch("/api/admin/customers/+351912345680/notes", {
    headers: { "X-Location-Id": "invalid" },
    data: { customerName: "Cliente multi loja", email: "multi@example.test", notes: "Não deve ser gravada" },
  })).status()).toBe(400);
  expect((await request.patch("/api/admin/customers/+351912345680/notes", {
    headers: { "X-Location-Id": "999999" },
    data: { customerName: "Cliente multi loja", email: "multi@example.test", notes: "Não deve ser gravada" },
  })).status()).toBe(404);
  expect((await request.patch("/api/admin/customers/notes", {
    data: { appointmentId: 1, notes: "Não deve ser gravada" },
  })).status()).toBe(400);

  const guest = await playwright.request.newContext({ baseURL });
  try {
    const monday = new Date(Date.now() + 28 * 86400000);
    monday.setUTCDate(monday.getUTCDate() + (8 - monday.getUTCDay()) % 7);

    const customerPhone = "+351912345680";
    const customerName = "Cliente multi loja";
    const noteStart = new Date(monday);
    noteStart.setUTCDate(noteStart.getUTCDate() + 1);
    noteStart.setUTCHours(13, 0, 0, 0);
    for (const [headers, serviceId, hour] of [
      [primaryHeaders, primaryService.id, 13],
      [portoHeaders, portoService.id, 14],
    ] as const) {
      noteStart.setUTCHours(hour, 0, 0, 0);
      const response = await request.post("/api/appointments/block", { headers, data: {
        barberId: sharedBarber.id, serviceId, startTime: noteStart.toISOString(),
        name: customerName, phone: customerPhone, customerEmail: "multi@example.test",
        isManualBooking: true, allowOutsideHours: true, isRecurring: false,
      } });
      expect(response.status(), await response.text()).toBe(201);
    }
    const customerPath = `/api/admin/customers/${encodeURIComponent(customerPhone)}`;
    const customerQuery = "?email=multi%40example.test&name=Cliente%20multi%20loja";
    const primaryNote = "Prefere máquina 0 nas laterais";
    const portoNote = "Alérgico ao produto X";
    expect((await request.patch(`${customerPath}/notes`, { headers: primaryHeaders, data: {
      customerName, email: "multi@example.test", notes: primaryNote,
    } })).ok()).toBe(true);
    expect((await (await request.get(`${customerPath}/history${customerQuery}`, { headers: primaryHeaders })).json()).notes.notes).toBe(primaryNote);
    expect((await request.get(`${customerPath}/history${customerQuery}`, { headers: portoHeaders })).status()).toBe(200);
    expect((await (await request.get(`${customerPath}/history${customerQuery}`, { headers: portoHeaders })).json()).notes.notes).toBe("");
    expect((await request.patch(`${customerPath}/notes`, { headers: portoHeaders, data: {
      customerName, email: "multi@example.test", notes: portoNote,
    } })).ok()).toBe(true);
    expect((await (await request.get(`${customerPath}/history${customerQuery}`, { headers: primaryHeaders })).json()).notes.notes).toBe(primaryNote);
    expect((await (await request.get(`${customerPath}/history${customerQuery}`, { headers: portoHeaders })).json()).notes.notes).toBe(portoNote);
    expect((await (await request.get(`${customerPath}/history${customerQuery}`, { headers: primaryHeaders })).json()).notes.notes).toBe(primaryNote);
    const customerAppointmentIds: number[] = [];
    for (const headers of [primaryHeaders, portoHeaders]) {
      const appointments = await (await request.get("/api/appointments", { headers })).json();
      const customerAppointment = appointments.find((appointment: any) => appointment.customerName === customerName);
      expect(customerAppointment).toBeTruthy();
      customerAppointmentIds.push(customerAppointment.id);
      expect((await request.patch(`/api/appointments/${customerAppointment.id}`, {
        headers, data: { status: "cancelled" },
      })).ok()).toBe(true);
    }
    expect((await request.get(`/api/admin/customers/history?appointmentId=${customerAppointmentIds[0]}`, {
      headers: primaryHeaders,
    })).status()).toBe(200);
    expect((await request.get(`/api/admin/customers/history?appointmentId=${customerAppointmentIds[0]}`, {
      headers: portoHeaders,
    })).status()).toBe(404);
    const appointmentNotesUpdate = await request.patch("/api/admin/customers/notes", {
      headers: primaryHeaders,
      data: { appointmentId: customerAppointmentIds[0], notes: primaryNote },
    });
    expect(appointmentNotesUpdate.ok(), await appointmentNotesUpdate.text()).toBe(true);
    expect((await request.patch("/api/admin/customers/notes", {
      headers: portoHeaders,
      data: { appointmentId: customerAppointmentIds[0], notes: "Não deve atravessar lojas" },
    })).status()).toBe(404);

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
    expect(refused.status()).toBe(409);
    expect((await refused.json()).message).toContain("indisponível");

    const missingBusyBarber = await request.get("/api/appointments?scope=busy", { headers: primaryHeaders });
    expect(missingBusyBarber.status()).toBe(400);
    expect(await missingBusyBarber.json()).toEqual({
      code: "BARBER_ID_REQUIRED",
      message: "Indique um barbeiro para consultar os horários ocupados.",
    });

    for (const headers of [primaryHeaders, portoHeaders]) {
      const busy = await (await guest.get(`/api/appointments/public?barberId=${sharedBarber.id}&date=${monday.toISOString().slice(0, 10)}`, { headers })).json();
      expect(busy).toHaveLength(1);
      expect(busy[0]).not.toHaveProperty("customerName");
      expect(busy[0]).not.toHaveProperty("cancelToken");
      const adminBusyResponse = await request.get(`/api/appointments?scope=busy&barberId=${sharedBarber.id}&date=${monday.toISOString().slice(0, 10)}`, { headers });
      expect(adminBusyResponse.ok(), await adminBusyResponse.text()).toBe(true);
      const adminBusy = await adminBusyResponse.json();
      expect(adminBusy).toHaveLength(1);
      expect(Object.keys(adminBusy[0]).sort()).toEqual(["barberId", "durationMinutes", "startTime", "status"]);
      for (const forbidden of [
        "id", "locationId", "serviceId", "customerName", "customerEmail", "customerPhone",
        "paymentMethod", "depositRequired", "seriesId", "notificationRevision", "createdAt", "cancelToken",
      ]) expect(adminBusy[0]).not.toHaveProperty(forbidden);
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
      expect(JSON.stringify(workbook.getWorksheet("Resumo Financeiro")?.getSheetValues()).includes("Material apenas Porto")).toBe(hasExpense);
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
    expect((await (await page.request.get(`${customerPath}/history${customerQuery}`, { headers: primaryHeaders })).json()).notes.notes).toBe(primaryNote);
    expect((await (await page.request.get(`${customerPath}/history${customerQuery}`, { headers: portoHeaders })).json()).notes.notes).toBe(portoNote);
    expect((await page.request.patch("/api/admin/customers/notes", {
      headers: primaryHeaders,
      data: { appointmentId: customerAppointmentIds[0], notes: primaryNote },
    })).ok()).toBe(true);
    expect((await page.request.get("/api/appointments", { headers: { "X-Location-Id": String(created[1].id) } })).status()).toBe(403);
    const forbiddenHistory = await page.request.get(`${customerPath}/history${customerQuery}`, {
      headers: { "X-Location-Id": String(created[1].id) },
    });
    expect(forbiddenHistory.status()).toBe(403);
    expect(await forbiddenHistory.json()).toEqual({ message: "Não tem acesso a esta localização." });
    expect((await page.request.patch(`${customerPath}/notes`, {
      headers: { "X-Location-Id": String(created[1].id) },
      data: { customerName, email: "multi@example.test", notes: "Sem acesso" },
    })).status()).toBe(403);
    expect((await page.request.get("/api/admin/expenses", { headers: portoHeaders })).status()).toBe(401);
    expect((await page.request.get("/api/admin/locations", { headers: portoHeaders })).status()).toBe(401);
    await page.goto("/admin");
    await expect(page.getByRole("tab", { name: "Agenda", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Localizações" })).not.toBeVisible();
    await expect(page.getByRole("tab", { name: "Equipa", exact: true })).not.toBeVisible();
    await page.getByRole("tab", { name: "Relatórios" }).click();
    await expect(page.getByText("Despesas da Barbearia", { exact: true })).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const inactiveLocationId = created[2].id;
    expect((await request.patch(`/api/admin/locations/${inactiveLocationId}`, { data: { isActive: false } })).ok()).toBe(true);
    const inactiveHeaders = { "X-Location-Id": String(inactiveLocationId) };
    expect((await guest.post("/api/appointments", { headers: inactiveHeaders, data: {
      barberId: sharedBarber.id, serviceId: primaryService.id, startTime: monday.toISOString(),
      customerName: "Cliente loja inativa", customerPhone: "+351912345699",
    } })).status()).toBe(404);
    const inactiveManual = await request.post("/api/appointments/block", { headers: inactiveHeaders, data: {
      barberId: sharedBarber.id, serviceId: primaryService.id, startTime: monday.toISOString(),
      name: "Cliente loja inativa", phone: "+351912345699", customerEmail: "",
      isManualBooking: true, allowOutsideHours: true, isRecurring: false,
    } });
    expect(inactiveManual.status()).toBe(409);
    expect(await inactiveManual.json()).toMatchObject({ code: "APPOINTMENT_LOCATION_INACTIVE" });
    expect((await request.post("/api/appointments/block", { headers: inactiveHeaders, data: {
      barberId: sharedBarber.id, serviceId: primaryService.id, startTime: monday.toISOString(),
      name: "Cliente recorrente loja inativa", phone: "+351912345698", customerEmail: "",
      isManualBooking: true, allowOutsideHours: true, isRecurring: true, recurringWeeks: 1, recurringMonths: 2,
    } })).status()).toBe(409);
    expect((await request.get("/api/appointments", { headers: inactiveHeaders })).status()).toBe(200);
    expect((await request.patch(`/api/admin/locations/${inactiveLocationId}`, { data: { isActive: true } })).ok()).toBe(true);
  } finally {
    await guest.dispose();
  }
});

test("[multi-location] exporta movimentos históricos após retirar o barbeiro da loja", async ({ request }) => {
  const locations = await ensureLocations(request, 2);
  if (!locations[1].isActive) {
    const activateResponse = await request.patch(`/api/admin/locations/${locations[1].id}`, {
      data: { isActive: true },
    });
    expect(activateResponse.ok(), await activateResponse.text()).toBe(true);
  }
  const primaryHeaders = { "X-Location-Id": String(locations[0].id) };
  const secondaryHeaders = { "X-Location-Id": String(locations[1].id) };
  const services = await (await request.get("/api/services", { headers: primaryHeaders })).json();
  const service = services[0];
  expect(service).toBeTruthy();
  const suffix = Date.now();
  const barberResponse = await request.post("/api/barbers", { headers: primaryHeaders, data: {
    name: `Historico removido ${suffix}`,
    specialty: "Historico",
    color: "#475569",
    isVisible: true,
    serviceIds: [service.id],
  } });
  expect(barberResponse.status(), await barberResponse.text()).toBe(201);
  const barber = await barberResponse.json();
  const startTime = new Date(Date.now() - 14 * 86400000);
  startTime.setUTCHours(10, 0, 0, 0);
  const reportDate = startTime.toISOString().slice(0, 10);
  const customerName = `Historico removido ${suffix}`;
  const appointmentResponse = await request.post("/api/appointments/block", { headers: primaryHeaders, data: {
    barberId: barber.id,
    serviceId: service.id,
    startTime: startTime.toISOString(),
    name: customerName,
    phone: "+351912697230",
    isManualBooking: true,
    allowOutsideHours: true,
  } });
  expect(appointmentResponse.status(), await appointmentResponse.text()).toBe(201);
  const appointments = await (await request.get(
    `/api/appointments?barberId=${barber.id}&date=${reportDate}`,
    { headers: primaryHeaders },
  )).json();
  const appointment = appointments.find((item: any) => item.customerName === customerName);
  expect(appointment).toBeTruthy();

  const removeResponse = await request.delete(`/api/barbers/${barber.id}`, { headers: primaryHeaders });
  expect(removeResponse.ok(), await removeResponse.text()).toBe(true);
  const options = await (await request.get(
    `/api/admin/export/barbers?startDate=${reportDate}&endDate=${reportDate}`,
    { headers: primaryHeaders },
  )).json();
  expect(options.active.map((item: any) => item.id)).not.toContain(barber.id);
  expect(options.historical).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: barber.id, name: barber.name }),
  ]));
  const secondaryOptions = await (await request.get(
    `/api/admin/export/barbers?startDate=${reportDate}&endDate=${reportDate}`,
    { headers: secondaryHeaders },
  )).json();
  expect(secondaryOptions.historical.map((item: any) => item.id)).not.toContain(barber.id);

  const exportResponse = await request.get(
    `/api/admin/export?startDate=${reportDate}&endDate=${reportDate}&barberId=${barber.id}`,
    { headers: primaryHeaders },
  );
  expect(exportResponse.ok(), await exportResponse.text()).toBe(true);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportResponse.body());
  const detail = workbook.getWorksheet("Detalhe dos Movimentos")!;
  const headers = getHeaderRow(detail, "Data do serviço").values as unknown[];
  const appointmentIdColumn = headers.indexOf("ID da marcação");
  expect(detail.getColumn(appointmentIdColumn).values).toContain(appointment.id);
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
    await expect(page.getByRole("heading", { name: "Onde quer marcar?" })).toBeVisible();
    await page.getByRole("button", { name: shop.name }).click();
    await expect(page.getByRole("heading", { name: "Seleciona o barbeiro" })).toBeVisible();
    await page.getByText(barber.name, { exact: true }).click();
    await page.getByRole("button", { name: "Seguinte" }).click();
    await page.getByText(services[index].name, { exact: true }).click();
    await page.getByRole("button", { name: "Seguinte" }).click();
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

test("[multi-location] isolates the Extras catalogue and rejects cross-location updates", async ({ page, request }) => {
  const [shopA, shopB] = await ensureLocations(request, 2);
  for (const shop of [shopA, shopB]) {
    if (!shop.isActive) {
      const activate = await request.patch(`/api/admin/locations/${shop.id}`, { data: { isActive: true } });
      expect(activate.ok(), await activate.text()).toBe(true);
    }
  }

  const headersA = { "X-Location-Id": String(shopA.id) };
  const headersB = { "X-Location-Id": String(shopB.id) };
  const createA = await request.post("/api/admin/extras", {
    headers: headersA,
    data: {
      name: "Extra Loja A QA",
      pricingMode: "fixed",
      amountCents: 400,
      financialRule: "follow_compensation",
      sortOrder: 0,
    },
  });
  const createB = await request.post("/api/admin/extras", {
    headers: headersB,
    data: {
      name: "Extra Loja B QA",
      pricingMode: "fixed",
      amountCents: 900,
      financialRule: "barber",
      sortOrder: 0,
    },
  });
  expect(createA.status(), await createA.text()).toBe(201);
  expect(createB.status(), await createB.text()).toBe(201);
  const extraA = await createA.json();
  const extraB = await createB.json();
  expect(extraA).toMatchObject({ locationId: shopA.id, amountCents: 400 });
  expect(extraB).toMatchObject({ locationId: shopB.id, amountCents: 900 });

  const catalogueA = await (await request.get("/api/admin/extras", { headers: headersA })).json();
  const catalogueB = await (await request.get("/api/admin/extras", { headers: headersB })).json();
  expect(catalogueA.some((extra: any) => extra.id === extraA.id)).toBe(true);
  expect(catalogueA.some((extra: any) => extra.id === extraB.id)).toBe(false);
  expect(catalogueB.some((extra: any) => extra.id === extraB.id)).toBe(true);
  expect(catalogueB.some((extra: any) => extra.id === extraA.id)).toBe(false);

  const crossLocationEdit = await request.patch(`/api/admin/extras/${extraA.id}`, {
    headers: headersB,
    data: { amountCents: 999 },
  });
  expect(crossLocationEdit.status(), await crossLocationEdit.text()).toBe(404);
  const crossLocationToggle = await request.patch(`/api/admin/extras/${extraA.id}`, {
    headers: headersB,
    data: { isActive: false },
  });
  expect(crossLocationToggle.status(), await crossLocationToggle.text()).toBe(404);

  const unchangedA = (await (await request.get("/api/admin/extras", { headers: headersA })).json())
    .find((extra: any) => extra.id === extraA.id);
  expect(unchangedA).toMatchObject({ amountCents: 400, isActive: true });

  await page.goto("/admin");
  await page.getByPlaceholder("Introduza o email ou nome de utilizador").fill("admin");
  await page.locator('input[type="password"]').fill("Playwright-Test-Admin-2026!");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
  await page.getByLabel("Loja em gestão").click();
  await page.getByRole("option", { name: shopA.name, exact: true }).click();
  await page.getByRole("tab", { name: "Extras", exact: true }).click();
  const extrasManager = page.getByTestId("extras-manager");
  await expect(extrasManager.getByText("Extra Loja A QA", { exact: true })).toBeVisible();
  await expect(extrasManager.getByText("Extra Loja B QA", { exact: true })).toHaveCount(0);

  await page.getByLabel("Loja em gestão").click();
  await page.getByRole("option", { name: shopB.name, exact: true }).click();
  await expect(extrasManager.getByText("Extra Loja B QA", { exact: true })).toBeVisible();
  await expect(extrasManager.getByText("Extra Loja A QA", { exact: true })).toHaveCount(0);

  const serviceBResponse = await request.post("/api/services", {
    headers: headersB,
    data: {
      name: "Serviço Extra Loja B QA",
      description: "Validação de isolamento de Extras",
      price: 1800,
      duration: 30,
      isVisible: true,
    },
  });
  expect(serviceBResponse.status(), await serviceBResponse.text()).toBe(201);
  const serviceB = await serviceBResponse.json();
  const barberBResponse = await request.post("/api/barbers", {
    headers: headersB,
    data: {
      name: "Barbeiro Extra Loja B QA",
      specialty: "Isolamento de Extras",
      isVisible: true,
      serviceIds: [serviceB.id],
    },
  });
  expect(barberBResponse.status(), await barberBResponse.text()).toBe(201);
  const barberB = await barberBResponse.json();
  const bookingStart = new Date(Date.now() + 300 * 86400000);
  bookingStart.setUTCHours(11, 0, 0, 0);
  const bookingData = {
    barberId: barberB.id,
    serviceId: serviceB.id,
    serviceMode: "existing",
    startTime: bookingStart.toISOString(),
    name: "Cliente isolamento Extra",
    phone: "+351912650101",
    customerEmail: "extras-location@example.test",
    isManualBooking: true,
    isRecurring: false,
    allowOutsideHours: true,
  };
  const crossLocationBooking = await request.post("/api/appointments/block", {
    headers: headersB,
    data: { ...bookingData, extras: [{ extraId: extraA.id }] },
  });
  expect(crossLocationBooking.status(), await crossLocationBooking.text()).toBe(409);
  expect(await crossLocationBooking.json()).toMatchObject({ code: "APPOINTMENT_EXTRA_UNAVAILABLE" });

  const localBooking = await request.post("/api/appointments/block", {
    headers: headersB,
    data: { ...bookingData, extras: [{ extraId: extraB.id }] },
  });
  expect(localBooking.status(), await localBooking.text()).toBe(201);
  const localBookingBody = await localBooking.json();
  expect(localBookingBody.appointments[0].extras).toEqual([
    expect.objectContaining({ extraDefinitionId: extraB.id, nameSnapshot: extraB.name }),
  ]);

  const crossLocationAppointmentPatch = await request.patch(
    `/api/appointments/${localBookingBody.appointments[0].id}`,
    {
      headers: headersB,
      data: { extras: [{ extraId: extraA.id }] },
    },
  );
  expect(crossLocationAppointmentPatch.status(), await crossLocationAppointmentPatch.text()).toBe(409);
  expect(await crossLocationAppointmentPatch.json()).toMatchObject({ code: "APPOINTMENT_EXTRA_UNAVAILABLE" });
  const unchangedLocalAppointment = (await (await request.get(
    `/api/appointments?barberId=${barberB.id}&date=${bookingStart.toISOString().slice(0, 10)}`,
    { headers: headersB },
  )).json()).find((appointment: any) => appointment.id === localBookingBody.appointments[0].id);
  expect(unchangedLocalAppointment.extras).toEqual([
    expect.objectContaining({ extraDefinitionId: extraB.id, amountCentsSnapshot: 900 }),
  ]);

  const historicalStart = new Date(Date.now() - 300 * 86400000);
  historicalStart.setUTCHours(11, 0, 0, 0);
  const directCompletedBooking = await request.post("/api/appointments/block", {
    headers: headersB,
    data: {
      ...bookingData,
      startTime: historicalStart.toISOString(),
      name: "Cliente retroativo Extra Loja B",
      extras: [{ extraId: extraB.id }],
      isAlreadyCompleted: true,
      paymentMethod: "voucher",
    },
  });
  expect(directCompletedBooking.status(), await directCompletedBooking.text()).toBe(201);
  const directCompletedAppointment = (await directCompletedBooking.json()).appointments[0];
  expect(directCompletedAppointment).toMatchObject({
    locationId: shopB.id,
    status: "completed",
    paymentMethod: "voucher",
    extras: [expect.objectContaining({ extraDefinitionId: extraB.id })],
  });
  expect((await request.patch(`/api/appointments/${directCompletedAppointment.id}/status`, {
    headers: headersA,
    data: { status: "completed", paymentMethod: "cash" },
  })).status()).toBe(404);
  expect((await request.patch(`/api/appointments/${directCompletedAppointment.id}`, {
    headers: headersA,
    data: { status: "completed", paymentMethod: "cash" },
  })).status()).toBe(404);
  const historicalDate = historicalStart.toISOString().slice(0, 10);
  const historicalDashboardB = await request.get(
    `/api/admin/dashboard?startDate=${historicalDate}&endDate=${historicalDate}&barberId=${barberB.id}`,
    { headers: headersB },
  );
  expect(historicalDashboardB.ok(), await historicalDashboardB.text()).toBe(true);
  expect((await historicalDashboardB.json()).summary).toMatchObject({
    appointments: 1,
    nominalCompletedCents: 2700,
    revenueCents: 2700,
    receivedCents: 0,
    voucherCents: 2700,
    extrasRevenueCents: 900,
  });
  const historicalDashboardA = await request.get(
    `/api/admin/dashboard?startDate=${historicalDate}&endDate=${historicalDate}&barberId=${barberB.id}`,
    { headers: headersA },
  );
  expect(historicalDashboardA.ok(), await historicalDashboardA.text()).toBe(true);
  expect((await historicalDashboardA.json()).summary).toMatchObject({
    appointments: 0,
    revenueCents: 0,
    voucherCents: 0,
  });
  const historicalVoucherExportB = await request.get(
    `/api/admin/export?startDate=${historicalDate}&endDate=${historicalDate}&barberId=${barberB.id}`,
    { headers: headersB },
  );
  expect(historicalVoucherExportB.ok(), await historicalVoucherExportB.text()).toBe(true);
  const historicalVoucherWorkbookB = new ExcelJS.Workbook();
  await historicalVoucherWorkbookB.xlsx.load(await historicalVoucherExportB.body());
  const historicalVoucherSummaryB = new Map<string, unknown>();
  historicalVoucherWorkbookB.getWorksheet("Resumo Financeiro")!.eachRow((row) => {
    historicalVoucherSummaryB.set(String(row.getCell(1).value), row.getCell(2).value);
  });
  expect(historicalVoucherSummaryB.get("Valor coberto por Vale/Cupão")).toBe(27);
  expect(historicalVoucherSummaryB.get("Recebimentos confirmados")).toBe(0);

  const historicalVoucherExportA = await request.get(
    `/api/admin/export?startDate=${historicalDate}&endDate=${historicalDate}`,
    { headers: headersA },
  );
  expect(historicalVoucherExportA.ok(), await historicalVoucherExportA.text()).toBe(true);
  const historicalVoucherWorkbookA = new ExcelJS.Workbook();
  await historicalVoucherWorkbookA.xlsx.load(await historicalVoucherExportA.body());
  const historicalVoucherSummaryA = new Map<string, unknown>();
  historicalVoucherWorkbookA.getWorksheet("Resumo Financeiro")!.eachRow((row) => {
    historicalVoucherSummaryA.set(String(row.getCell(1).value), row.getCell(2).value);
  });
  expect(historicalVoucherSummaryA.get("Valor coberto por Vale/Cupão")).toBe(0);

  const bookingDate = bookingStart.toISOString().slice(0, 10);
  const dashboardBResponse = await request.get(
    `/api/admin/dashboard?startDate=${bookingDate}&endDate=${bookingDate}&barberId=${barberB.id}`,
    { headers: headersB },
  );
  expect(dashboardBResponse.ok(), await dashboardBResponse.text()).toBe(true);
  expect((await dashboardBResponse.json()).summary).toMatchObject({
    appointments: 1,
    revenueCents: 0,
    projectedRevenueCents: 2700,
  });
  const dashboardAResponse = await request.get(
    `/api/admin/dashboard?startDate=${bookingDate}&endDate=${bookingDate}&barberId=${barberB.id}`,
    { headers: headersA },
  );
  expect(dashboardAResponse.ok(), await dashboardAResponse.text()).toBe(true);
  expect((await dashboardAResponse.json()).summary).toMatchObject({ appointments: 0, projectedRevenueCents: 0 });

  const exportBResponse = await request.get(
    `/api/admin/export?startDate=${bookingDate}&endDate=${bookingDate}&barberId=${barberB.id}`,
    { headers: headersB },
  );
  expect(exportBResponse.ok(), await exportBResponse.text()).toBe(true);
  const extrasWorkbook = new ExcelJS.Workbook();
  await extrasWorkbook.xlsx.load(await exportBResponse.body());
  const movementsSheet = extrasWorkbook.getWorksheet("Detalhe dos Movimentos")!;
  const movementsHeader = getHeaderRow(movementsSheet, "Data do serviço");
  const movementHeaders = movementsHeader.values as unknown[];
  const movementIdColumn = movementHeaders.indexOf("ID da marcação");
  const movementExtrasColumn = movementHeaders.indexOf("Extras");
  const movementExtrasValueColumn = movementHeaders.indexOf("Valor extras (€)");
  const movementTotalColumn = movementHeaders.indexOf("Valor final (€)");
  let localMovement: ExcelJS.Row | undefined;
  movementsSheet.eachRow((row, rowNumber) => {
    if (rowNumber > movementsHeader.number
      && row.getCell(movementIdColumn).value === localBookingBody.appointments[0].id) localMovement = row;
  });
  expect(localMovement?.getCell(movementExtrasColumn).value).toBe(`${extraB.name} (9,00 €)`);
  expect(localMovement?.getCell(movementExtrasValueColumn).value).toBe(9);
  expect(localMovement?.getCell(movementTotalColumn).value).toBe(27);

  await page.reload();
  await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
  await page.getByRole("tab", { name: "Agenda" }).click();
  await page.getByRole("button", { name: "Marcação manual" }).click();
  const bookingDialog = page.getByRole("dialog", { name: "Marcação manual" });
  await expect(bookingDialog.getByTestId("manual-booking-location")).toContainText(shopB.name);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect.poll(async () => {
      const dialogBounds = await bookingDialog.boundingBox();
      return Boolean(
        dialogBounds
        && dialogBounds.x >= 0
        && dialogBounds.x + dialogBounds.width <= viewport.width,
      );
    }).toBe(true);
  }
  await bookingDialog.getByTestId("manual-booking-extras-trigger").click();
  await expect(bookingDialog.getByLabel(`Selecionar Extra ${extraB.name}`)).toBeVisible();
  await expect(bookingDialog.getByLabel(`Selecionar Extra ${extraA.name}`)).toHaveCount(0);
  await bookingDialog.getByTestId("manual-booking-barber").click();
  await page.getByRole("option", { name: barberB.name, exact: true }).click();
  await bookingDialog.getByTestId("manual-booking-service").click();
  await page.getByRole("option", { name: serviceB.name, exact: true }).click();
  await bookingDialog.getByLabel("Nome do cliente", { exact: true }).fill("Cliente mantido entre lojas");
  await bookingDialog.locator("#manual-booking-phone").fill("912345678");
  await bookingDialog.getByLabel("Email (opcional)").fill("cliente-mantido@example.test");
  await bookingDialog.getByLabel("Condições especiais desta marcação").click();
  await bookingDialog.locator("#manual-booking-special-price").fill("24,00");
  await bookingDialog.getByRole("button", { name: "Serviço personalizado" }).click();
  await bookingDialog.locator("#manual-booking-custom-service").fill("Draft da localização B");
  await bookingDialog.locator("#manual-booking-custom-duration").fill("45");
  await bookingDialog.locator("#manual-booking-custom-price").fill("30,00");
  await bookingDialog.getByLabel(`Selecionar Extra ${extraB.name}`).click();
  await expect(bookingDialog.getByLabel(`Selecionar Extra ${extraB.name}`)).toBeChecked();
  await bookingDialog.getByTestId("manual-booking-location").click();
  await page.getByRole("option", { name: shopA.name, exact: true }).click();
  await expect(bookingDialog.getByTestId("manual-booking-barber")).toContainText("Selecione");
  await expect(bookingDialog.getByTestId("manual-booking-service")).toContainText("Selecione");
  await expect(bookingDialog.getByLabel("Nome do cliente", { exact: true })).toHaveValue("Cliente mantido entre lojas");
  await expect(bookingDialog.locator("#manual-booking-phone")).toHaveValue("912345678");
  await expect(bookingDialog.getByLabel("Email (opcional)")).toHaveValue("cliente-mantido@example.test");
  await expect(bookingDialog.getByLabel(`Selecionar Extra ${extraA.name}`)).toBeVisible();
  await expect(bookingDialog.getByLabel(`Selecionar Extra ${extraA.name}`)).not.toBeChecked();
  await expect(bookingDialog.getByLabel(`Selecionar Extra ${extraB.name}`)).toHaveCount(0);
  await expect(bookingDialog.getByLabel("Condições especiais desta marcação")).not.toBeChecked();
  await expect(bookingDialog.getByLabel("Permitir horários fora do horário normal")).not.toBeChecked();
  await bookingDialog.getByTestId("manual-booking-location").click();
  await page.getByRole("option", { name: shopB.name, exact: true }).click();
  await bookingDialog.getByTestId("manual-booking-barber").click();
  await page.getByRole("option", { name: barberB.name, exact: true }).click();
  await bookingDialog.getByTestId("manual-booking-service").click();
  await page.getByRole("option", { name: serviceB.name, exact: true }).click();
  await bookingDialog.getByLabel("Permitir horários fora do horário normal").click();
  const availableManualTime = bookingDialog.locator('button[data-availability="available"]').first();
  await expect(availableManualTime).toBeEnabled();
  await availableManualTime.click();
  await bookingDialog.getByTestId("appointment-block-submit").click();
  await expect(bookingDialog).toHaveCount(0);
  const uiCreatedInB = (await (await request.get("/api/appointments", { headers: headersB })).json())
    .find((appointment: any) => appointment.customerName === "Cliente mantido entre lojas");
  expect(uiCreatedInB).toMatchObject({ locationId: shopB.id, barberId: barberB.id, serviceId: serviceB.id });
  expect((await (await request.get("/api/appointments", { headers: headersA })).json())
    .some((appointment: any) => appointment.customerName === "Cliente mantido entre lojas")).toBe(false);

  expect((await request.patch(`/api/appointments/${localBookingBody.appointments[0].id}/status`, {
    headers: headersB,
    data: { status: "cancelled" },
  })).ok()).toBe(true);
  expect((await request.patch(`/api/barbers/${barberB.id}`, {
    headers: headersB,
    data: { isVisible: false },
  })).ok()).toBe(true);
  expect((await request.patch(`/api/services/${serviceB.id}`, {
    headers: headersB,
    data: { isVisible: false },
  })).ok()).toBe(true);

  const deactivateB = await request.patch(`/api/admin/extras/${extraB.id}`, {
    headers: headersB,
    data: { isActive: false },
  });
  expect(deactivateB.status(), await deactivateB.text()).toBe(200);
  expect((await deactivateB.json()).isActive).toBe(false);
  expect((await (await request.get("/api/admin/extras", { headers: headersB })).json())
    .find((extra: any) => extra.id === extraB.id)).toMatchObject({ isActive: false });

  const missingLocation = await request.post("/api/admin/extras", {
    data: {
      name: "Sem localização explícita",
      pricingMode: "fixed",
      amountCents: 100,
      financialRule: "establishment",
    },
  });
  expect(missingLocation.status(), await missingLocation.text()).toBe(400);
  expect(await missingLocation.json()).toMatchObject({ code: "LOCATION_REQUIRED" });
});

test("[multi-location] pending loader uses the appointment location logo and updates between shops", async ({ page, request }) => {
  test.setTimeout(120_000);
  const [shopA, shopB] = await ensureLocations(request, 2);
  const logoA = "/images/demo-logo.svg";
  const logoB = "/images/logo.jpg";
  const headersFor = (locationId: number) => ({ "X-Location-Id": String(locationId) });

  for (const [shop, logoUrl] of [[shopA, logoA], [shopB, logoB]] as const) {
    const response = await request.patch(`/api/admin/locations/${shop.id}`, {
      data: { isActive: true, logoUrl },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }

  const locationsResponse = await request.get("/api/account/locations");
  expect(locationsResponse.ok(), await locationsResponse.text()).toBe(true);
  const configuredLocations = await locationsResponse.json();
  expect(configuredLocations.find((location: any) => location.id === shopA.id)?.logoUrl).toBe(logoA);
  expect(configuredLocations.find((location: any) => location.id === shopB.id)?.logoUrl).toBe(logoB);

  const appointmentFixtures: Array<{ appointment: any; customerName: string; logoUrl: string; shop: any; startTime: string }> = [];
  for (const [index, fixture] of [{ shop: shopA, logoUrl: logoA }, { shop: shopB, logoUrl: logoB }].entries()) {
    const headers = headersFor(fixture.shop.id);
    const suffix = `${Date.now()}-${index}`;
    const serviceResponse = await request.post("/api/services", {
      headers,
      data: {
        name: `Branding service ${suffix}`,
        description: "Pending loader multi-location branding test",
        duration: 30,
        price: 1500,
        isVisible: true,
      },
    });
    expect(serviceResponse.status(), await serviceResponse.text()).toBe(201);
    const service = await serviceResponse.json();

    const barberResponse = await request.post("/api/barbers", {
      headers,
      data: {
        name: `Branding barber ${suffix}`,
        specialty: "Branding QA",
        bio: "Pending loader multi-location branding test",
        color: index === 0 ? "#2563EB" : "#9333EA",
        isVisible: true,
        serviceIds: [service.id],
      },
    });
    expect(barberResponse.status(), await barberResponse.text()).toBe(201);
    const barber = await barberResponse.json();

    const start = new Date();
    start.setDate(start.getDate() - 14 - index);
    start.setHours(9 + index, 0, 0, 0);
    const customerName = `Branding customer ${suffix}`;
    const appointmentResponse = await request.post("/api/appointments/block", {
      headers,
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: start.toISOString(),
        name: customerName,
        phone: `+35191268${String(index).padStart(4, "0")}`,
        customerEmail: "",
        isManualBooking: true,
        allowOutsideHours: true,
        isRecurring: false,
      },
    });
    expect(appointmentResponse.status(), await appointmentResponse.text()).toBe(201);
    const appointmentBody = await appointmentResponse.json();
    appointmentFixtures.push({
      appointment: appointmentBody.appointments[0],
      customerName,
      logoUrl: fixture.logoUrl,
      shop: fixture.shop,
      startTime: start.toISOString(),
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/book");
  await expect(page.getByRole("heading", { name: "Onde quer marcar?" })).toBeVisible();
  await page.getByRole("button", { name: shopA.name }).click();
  const publicBookingLogo = page.locator("nav img").first();
  await expect(publicBookingLogo).toHaveAttribute("src", logoA);
  await page.getByRole("button", { name: "Mudar loja" }).click();
  await page.getByRole("button", { name: shopB.name }).click();
  await expect(publicBookingLogo).toHaveAttribute("src", logoB);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAdmin(page.request);
  await page.goto("/admin");
  await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();

  const selectShop = async (shop: any) => {
    await page.getByLabel(/Loja em gest/).click();
    await page.getByRole("option", { name: shop.name, exact: true }).click();
    await expect(page.getByLabel(/Loja em gest/)).toContainText(shop.name);
  };

  const assertAppointmentPendingLogo = async (fixture: typeof appointmentFixtures[number], expectedLogoUrl: string) => {
    await selectShop(fixture.shop);
    await selectAgendaDay(page, fixture.startTime);
    await page.getByRole("button", {
      name: new RegExp(`Abrir detalhes da marca.*o de ${fixture.customerName}`),
    }).first().click();

    const detailsDialog = page.getByRole("dialog", { name: /Detalhes da marca/ });
    await expect(detailsDialog).toBeVisible();
    const statusPath = `/api/appointments/${fixture.appointment.id}/status`;
    await page.route((url) => url.pathname === statusPath, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 650));
      await route.fulfill({ status: 500, json: { message: "Expected branding test failure" } });
    });

    await detailsDialog.getByRole("button", { name: "Feita" }).click();
    const paymentDialog = page.getByRole("alertdialog", { name: "Como foi pago?" });
    await paymentDialog.locator('[data-payment-method="cash"]').click();
    const pendingOverlay = paymentDialog.getByRole("status", { name: "A processar pagamento..." });
    await expect(pendingOverlay).toBeVisible();
    await expect(pendingOverlay.locator("img")).toHaveAttribute("src", expectedLogoUrl);
    await expect.poll(() => pendingOverlay.locator("img").evaluate((image: HTMLImageElement) => (
      !image.hidden && image.complete && image.naturalWidth > 0
    ))).toBe(true);
    await expect(paymentDialog.locator('[data-payment-method="cash"]')).toBeEnabled();
    await paymentDialog.getByRole("button", { name: "Voltar" }).click();
    await detailsDialog.getByRole("button", { name: "Close" }).click();
    await page.unroute((url) => url.pathname === statusPath);
  };

  for (const fixture of appointmentFixtures) {
    await assertAppointmentPendingLogo(fixture, fixture.logoUrl);
  }

  const invalidLogoUrl = "/images/missing-location-logo.png";
  const invalidLogoResponse = await request.patch(`/api/admin/locations/${shopA.id}`, {
    data: { logoUrl: invalidLogoUrl },
  });
  expect(invalidLogoResponse.ok(), await invalidLogoResponse.text()).toBe(true);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
  await assertAppointmentPendingLogo(appointmentFixtures[0], "/images/logo.jpg");
});

test("[multi-location] o mesmo serviço usa preço e duração efetivos por loja", async ({ page, request, playwright, baseURL }) => {
  test.setTimeout(120_000);
  const [shopA, shopB] = await ensureLocations(request, 2);
  if (!shopB.isActive) {
    const activation = await request.patch(`/api/admin/locations/${shopB.id}`, { data: { isActive: true } });
    expect(activation.ok(), await activation.text()).toBe(true);
  }
  const headersA = { "X-Location-Id": String(shopA.id) };
  const headersB = { "X-Location-Id": String(shopB.id) };
  const suffix = Date.now();
  const serviceName = `Serviço partilhado ${suffix}`;

  const createServiceResponse = await request.post("/api/services", {
    headers: headersA,
    data: {
      name: serviceName,
      description: "Identidade global com oferta local",
      price: 1500,
      duration: 30,
      isVisible: true,
    },
  });
  expect(createServiceResponse.status(), await createServiceResponse.text()).toBe(201);
  const service = await createServiceResponse.json();
  expect(service).toMatchObject({
    name: serviceName,
    locationId: shopA.id,
    price: 1500,
    duration: 30,
    priceOverride: null,
    durationOverride: null,
  });

  // The small Admin flow associates the existing global identity with shop B.
  await loginAdmin(page.request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await page.evaluate((locationId) => {
    localStorage.setItem("barberbookings:location-id", String(locationId));
    window.dispatchEvent(new StorageEvent("storage", {
      key: "barberbookings:location-id",
      newValue: String(locationId),
    }));
  }, shopB.id);
  await page.getByRole("tab", { name: "Serviços", exact: true }).click();
  await page.getByRole("button", { name: "Associar serviço existente" }).click();
  const associationDialog = page.getByRole("dialog", { name: new RegExp("Associar serviço") });
  await associationDialog.getByRole("combobox").click();
  await page.getByRole("option", { name: serviceName, exact: true }).click();
  await expect(associationDialog.getByLabel("Preço nesta loja (€)")).toHaveValue("15,00");
  await expect(associationDialog.getByLabel("Duração nesta loja (min)")).toHaveValue("30");
  await associationDialog.getByLabel("Preço nesta loja (€)").fill("18,00");
  await associationDialog.getByLabel("Duração nesta loja (min)").fill("45");
  await associationDialog.getByRole("button", { name: "Associar nesta loja", exact: true }).click();
  await expect(associationDialog).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 });
  const adminServiceCard = page.getByTestId(`admin-service-card-${service.id}`);
  await expect(adminServiceCard).toContainText("18.00€");
  await expect(adminServiceCard).toContainText("45 min");
  await adminServiceCard.getByRole("button", { name: "Editar", exact: true }).click();
  const editDialog = page.getByRole("dialog", { name: "Editar Serviço" });
  await expect(editDialog.getByText("Dados globais", { exact: true })).toBeVisible();
  await expect(editDialog.getByText("Nesta loja", { exact: true })).toBeVisible();
  await expect(editDialog.locator(`#edit-service-price-${service.id}`)).toHaveValue("18");
  await expect(editDialog.locator(`#edit-service-dur-${service.id}`)).toHaveValue("45");
  await page.keyboard.press("Escape");
  await expect(editDialog).not.toBeVisible();

  const catalogueA = await (await request.get("/api/services?includeHidden=true", { headers: headersA })).json();
  const catalogueB = await (await request.get("/api/services?includeHidden=true", { headers: headersB })).json();
  const serviceA = catalogueA.find((item: any) => item.id === service.id);
  const serviceB = catalogueB.find((item: any) => item.id === service.id);
  expect(serviceA).toMatchObject({ locationId: shopA.id, price: 1500, duration: 30, isActive: true });
  expect(serviceB).toMatchObject({
    locationId: shopB.id,
    price: 1800,
    duration: 45,
    priceOverride: 1800,
    durationOverride: 45,
    basePrice: 1500,
    baseDuration: 30,
    isActive: true,
  });

  const barberResponse = await request.post("/api/barbers", {
    headers: headersA,
    data: {
      name: `Barbeiro serviço partilhado ${suffix}`,
      specialty: "Serviços por localização",
      color: "#315A7D",
      isVisible: true,
      serviceIds: [service.id],
    },
  });
  expect(barberResponse.status(), await barberResponse.text()).toBe(201);
  const barber = await barberResponse.json();
  const associateBarber = await request.post("/api/admin/location-barbers", {
    headers: headersB,
    data: { barberId: barber.id },
  });
  expect(associateBarber.status(), await associateBarber.text()).toBe(201);
  expect((await (await request.get(`/api/barbers/${barber.id}`, { headers: headersA })).json()).serviceIds)
    .toContain(service.id);
  expect((await (await request.get(`/api/barbers/${barber.id}`, { headers: headersB })).json()).serviceIds)
    .not.toContain(service.id);

  const guest = await playwright.request.newContext({ baseURL });
  try {
    const publicCatalogueA = await (await guest.get("/api/services", { headers: headersA })).json();
    const publicCatalogueB = await (await guest.get("/api/services", { headers: headersB })).json();
    expect(publicCatalogueA.find((item: any) => item.id === service.id)).toMatchObject({ price: 1500, duration: 30 });
    expect(publicCatalogueB.find((item: any) => item.id === service.id)).toMatchObject({ price: 1800, duration: 45 });
  } finally {
    await guest.dispose();
  }

  const publicDate = new Date(Date.now() + 600 * 86400000);
  publicDate.setUTCHours(9, 0, 0, 0);
  const publicWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Lisbon",
    weekday: "short",
  }).format(publicDate);
  const weekdayNumber = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[publicWeekday];
  for (const headers of [headersA, headersB]) {
    const shopSchedule = await request.patch("/api/shop/availability", {
      headers,
      data: [{ dayOfWeek: weekdayNumber, startTime: "08:00", endTime: "18:00", isOpen: true }],
    });
    expect(shopSchedule.ok(), await shopSchedule.text()).toBe(true);
    const barberSchedule = await request.patch(`/api/barbers/${barber.id}/availability`, {
      headers,
      data: [{ dayOfWeek: weekdayNumber, startTime: "08:00", endTime: "18:00", isWorking: true }],
    });
    expect(barberSchedule.ok(), await barberSchedule.text()).toBe(true);
  }
  const deniedDirectB = await request.post("/api/appointments", { headers: headersB, data: {
    barberId: barber.id,
    serviceId: service.id,
    startTime: new Date(publicDate.getTime() + 60 * 60000).toISOString(),
    customerName: `Booking B negado ${suffix}`,
    customerPhone: "+351912650209",
  } });
  expect(deniedDirectB.status()).toBe(400);
  expect(await deniedDirectB.json()).toMatchObject({ message: "Este barbeiro não executa o serviço escolhido." });
  const deniedAnyB = await request.post("/api/appointments", { headers: headersB, data: {
    barberId: 0,
    serviceId: service.id,
    startTime: new Date(publicDate.getTime() + 60 * 60000).toISOString(),
    customerName: `Booking qualquer B negado ${suffix}`,
    customerPhone: "+351912650208",
  } });
  expect(deniedAnyB.status()).toBe(409);

  const configureBarberB = await request.patch(`/api/barbers/${barber.id}/services`, {
    headers: headersB,
    data: { serviceIds: [service.id] },
  });
  expect(configureBarberB.ok(), await configureBarberB.text()).toBe(true);
  const publicBookingA = await request.post("/api/appointments", { headers: headersA, data: {
    barberId: barber.id,
    serviceId: service.id,
    startTime: publicDate.toISOString(),
    customerName: `Booking A ${suffix}`,
    customerPhone: "+351912650201",
  } });
  expect(publicBookingA.status(), await publicBookingA.text()).toBe(201);
  const publicAppointmentA = await publicBookingA.json();
  expect(publicAppointmentA).toMatchObject({
    servicePriceCentsSnapshot: 1500,
    durationMinutes: 30,
  });
  const publicBookingB = await request.post("/api/appointments", { headers: headersB, data: {
    barberId: barber.id,
    serviceId: service.id,
    startTime: new Date(publicDate.getTime() + 2 * 3600000).toISOString(),
    customerName: `Booking B ${suffix}`,
    customerPhone: "+351912650202",
  } });
  expect(publicBookingB.status(), await publicBookingB.text()).toBe(201);
  expect(await publicBookingB.json()).toMatchObject({
    servicePriceCentsSnapshot: 1800,
    durationMinutes: 45,
  });

  // Booking renders the same identity with each shop's commercial terms.
  for (const [shop, expectedPrice, expectedDuration] of [
    [shopA, "15.00€", "30 min"],
    [shopB, "18.00€", "45 min"],
  ] as const) {
    await page.goto("/book");
    await page.getByRole("button", { name: shop.name }).click();
    await page.getByText(barber.name, { exact: true }).click();
    await page.getByRole("button", { name: "Seguinte", exact: true }).click();
    const serviceCard = page.getByText(serviceName, { exact: true }).locator("xpath=ancestor::div[contains(@class,'items-stretch')]");
    await expect(serviceCard).toContainText(expectedDuration);
    await expect(serviceCard).toContainText(expectedPrice);
  }

  const availabilityDate = new Date(Date.now() + 40 * 86400000);
  const dayOfWeek = availabilityDate.getDay();
  const availabilityRows = [{
    barberId: barber.id,
    dayOfWeek,
    startTime: "09:00",
    endTime: "10:30",
    isWorking: true,
  }];
  const shopAvailabilityRows = [{ dayOfWeek, startTime: "09:00", endTime: "10:30", isOpen: true }];
  const availableStartsA = getAvailableTimeSlots({
    selectedService: serviceA,
    selectedDate: availabilityDate,
    selectedBarberId: barber.id,
    visibleBarbers: [barber],
    availabilityRows,
    shopAvailabilityRows,
    existingAppointments: [],
    now: new Date(0),
    timeZone: "Europe/Lisbon",
  }).filter((slot) => slot.available).map((slot) => slot.time);
  const availableStartsB = getAvailableTimeSlots({
    selectedService: serviceB,
    selectedDate: availabilityDate,
    selectedBarberId: barber.id,
    visibleBarbers: [barber],
    availabilityRows,
    shopAvailabilityRows,
    existingAppointments: [],
    now: new Date(0),
    timeZone: "Europe/Lisbon",
  }).filter((slot) => slot.available).map((slot) => slot.time);
  expect(availableStartsA).toContain("10:00");
  expect(availableStartsB).not.toContain("10:00");

  const createManual = async (
    headers: Record<string, string>,
    startTime: Date,
    name: string,
    completed = false,
  ) => {
    const response = await request.post("/api/appointments/block", { headers, data: {
      barberId: barber.id,
      serviceId: service.id,
      startTime: startTime.toISOString(),
      name,
      phone: `+35191${String(Math.abs(startTime.getTime())).slice(-7)}`,
      customerEmail: "",
      isManualBooking: true,
      isRecurring: false,
      allowOutsideHours: true,
      ...(completed ? { isAlreadyCompleted: true, paymentMethod: "cash" } : {}),
    } });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()).appointments[0];
  };

  const futureA = new Date(Date.now() + 500 * 86400000);
  futureA.setUTCHours(9, 0, 0, 0);
  const futureB = new Date(futureA.getTime() + 2 * 3600000);
  const bookedA = await createManual(headersA, futureA, `Cliente A ${suffix}`);
  const bookedB = await createManual(headersB, futureB, `Cliente B ${suffix}`);
  expect(bookedA).toMatchObject({
    locationId: shopA.id,
    serviceId: service.id,
    serviceNameSnapshot: serviceName,
    servicePriceCentsSnapshot: 1500,
    durationMinutes: 30,
  });
  expect(bookedB).toMatchObject({
    locationId: shopB.id,
    serviceId: service.id,
    serviceNameSnapshot: serviceName,
    servicePriceCentsSnapshot: 1800,
    durationMinutes: 45,
  });

  const historicalAStart = new Date("2020-04-14T08:00:00.000Z");
  const historicalBStart = new Date("2020-04-14T10:00:00.000Z");
  const historicalA = await createManual(headersA, historicalAStart, `Histórico A ${suffix}`, true);
  const historicalB = await createManual(headersB, historicalBStart, `Histórico B ${suffix}`, true);

  const updateA = await request.patch(`/api/services/${service.id}`, {
    headers: headersA,
    data: { priceOverride: 1600, durationOverride: 35 },
  });
  expect(updateA.ok(), await updateA.text()).toBe(true);
  expect(await updateA.json()).toMatchObject({ price: 1600, duration: 35 });
  expect((await (await request.get("/api/services", { headers: headersB })).json())
    .find((item: any) => item.id === service.id)).toMatchObject({ price: 1800, duration: 45 });

  const removeBarberServiceA = await request.patch(`/api/barbers/${barber.id}/services`, {
    headers: headersA,
    data: { serviceIds: [] },
  });
  expect(removeBarberServiceA.ok(), await removeBarberServiceA.text()).toBe(true);
  expect((await (await request.get(`/api/barbers/${barber.id}`, { headers: headersA })).json()).serviceIds).toEqual([]);
  expect((await (await request.get(`/api/barbers/${barber.id}`, { headers: headersB })).json()).serviceIds)
    .toContain(service.id);
  const rejectedManualA = await request.post("/api/appointments/block", { headers: headersA, data: {
    barberId: barber.id,
    serviceId: service.id,
    startTime: new Date(futureA.getTime() + 4 * 3600000).toISOString(),
    name: `Manual A negado ${suffix}`,
    phone: "+351912650207",
    customerEmail: "",
    isManualBooking: true,
    isRecurring: false,
    allowOutsideHours: true,
  } });
  expect(rejectedManualA.status()).toBe(400);
  expect(await rejectedManualA.json()).toMatchObject({ message: "Este barbeiro não executa o serviço escolhido." });
  const rejectedEditA = await request.patch(`/api/appointments/${bookedA.id}`, {
    headers: headersA,
    data: { startTime: new Date(futureA.getTime() + 5 * 3600000).toISOString() },
  });
  expect(rejectedEditA.status()).toBe(400);

  const unqualifiedBarberResponse = await request.post("/api/barbers", {
    headers: headersA,
    data: {
      name: `Barbeiro sem servicos ${suffix}`,
      specialty: "Sem servicos nesta loja",
      color: "#4A5568",
      isVisible: true,
      serviceIds: [],
    },
  });
  expect(unqualifiedBarberResponse.status(), await unqualifiedBarberResponse.text()).toBe(201);
  const unqualifiedBarber = await unqualifiedBarberResponse.json();
  expect(unqualifiedBarber.serviceIds).toEqual([]);
  const rejectedReassignmentA = await request.patch(`/api/appointments/${bookedA.id}`, {
    headers: headersA,
    data: { barberId: unqualifiedBarber.id },
  });
  expect(rejectedReassignmentA.status()).toBe(400);

  const allLocalServiceIdsA = catalogueA.map((item: any) => item.id);
  const selectAllServicesA = await request.patch(`/api/barbers/${unqualifiedBarber.id}/services`, {
    headers: headersA,
    data: { serviceIds: allLocalServiceIdsA },
  });
  expect(selectAllServicesA.ok(), await selectAllServicesA.text()).toBe(true);
  expect(await (await request.get(`/api/barbers/${unqualifiedBarber.id}`, { headers: headersA })).json())
    .toMatchObject({ serviceIds: expect.arrayContaining(allLocalServiceIdsA), allServicesAllowed: true });
  const restoreNoServicesA = await request.patch(`/api/barbers/${unqualifiedBarber.id}/services`, {
    headers: headersA,
    data: { serviceIds: [] },
  });
  expect(restoreNoServicesA.ok(), await restoreNoServicesA.text()).toBe(true);

  const rejectedTokenRescheduleA = await request.post(`/api/appointments/reschedule/${publicAppointmentA.cancelToken}`, {
    data: { startTime: new Date(publicDate.getTime() + 5 * 3600000).toISOString() },
  });
  expect(rejectedTokenRescheduleA.status()).toBe(400);

  const restoreBarberServiceA = await request.patch(`/api/barbers/${barber.id}/services`, {
    headers: headersA,
    data: { serviceIds: [service.id] },
  });
  expect(restoreBarberServiceA.ok(), await restoreBarberServiceA.text()).toBe(true);

  const historyA = await request.get(`/api/admin/customers/history?appointmentId=${historicalA.id}`, { headers: headersA });
  expect(historyA.ok(), await historyA.text()).toBe(true);
  expect((await historyA.json()).appointments.find((item: any) => item.id === historicalA.id)).toMatchObject({
    serviceName: serviceName,
    servicePrice: 1500,
    durationMinutes: 30,
  });

  for (const [headers, expectedRevenue] of [[headersA, 1500], [headersB, 1800]] as const) {
    const dashboardResponse = await request.get(
      "/api/admin/dashboard?startDate=2020-04-14&endDate=2020-04-14",
      { headers },
    );
    expect(dashboardResponse.ok(), await dashboardResponse.text()).toBe(true);
    expect((await dashboardResponse.json()).summary).toMatchObject({
      appointments: 1,
      completed: 1,
      revenueCents: expectedRevenue,
    });

    const exportResponse = await request.get(
      "/api/admin/export?startDate=2020-04-14&endDate=2020-04-14",
      { headers },
    );
    expect(exportResponse.ok(), await exportResponse.text()).toBe(true);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exportResponse.body());
    const detail = workbook.getWorksheet("Detalhe dos Movimentos")!;
    const headersRow = getHeaderRow(detail, "Data do serviço").values as unknown[];
    const serviceValueColumn = headersRow.indexOf("Valor serviço (€)");
    expect(detail.getColumn(serviceValueColumn).values).toContain(expectedRevenue / 100);
  }

  const hideA = await request.patch(`/api/services/${service.id}`, {
    headers: headersA,
    data: { isActive: false },
  });
  expect(hideA.ok(), await hideA.text()).toBe(true);
  expect((await (await request.get("/api/services", { headers: headersA })).json()).some((item: any) => item.id === service.id)).toBe(false);
  expect((await (await request.get("/api/services", { headers: headersB })).json()).some((item: any) => item.id === service.id)).toBe(true);
  expect((await (await request.get(`/api/barbers/${barber.id}`, { headers: headersA })).json()).serviceIds)
    .toContain(service.id);
  const inactiveGuest = await playwright.request.newContext({ baseURL });
  try {
    const publicBarberA = await (await inactiveGuest.get(`/api/barbers/${barber.id}`, { headers: headersA })).json();
    expect(publicBarberA.serviceIds).toEqual([]);
  } finally {
    await inactiveGuest.dispose();
  }
  const reactivateA = await request.patch(`/api/admin/service-locations/${service.id}`, {
    headers: headersA,
    data: { isActive: true },
  });
  expect(reactivateA.ok(), await reactivateA.text()).toBe(true);
  expect((await (await request.get(`/api/barbers/${barber.id}`, { headers: headersA })).json()).serviceIds)
    .toContain(service.id);

  const removeA = await request.delete(`/api/services/${service.id}`, { headers: headersA });
  expect(removeA.ok(), await removeA.text()).toBe(true);
  expect(await removeA.json()).toMatchObject({ mode: "deactivated" });
  expect((await (await request.get("/api/services", { headers: headersA })).json()).some((item: any) => item.id === service.id)).toBe(false);
  expect((await (await request.get("/api/services", { headers: headersB })).json()).some((item: any) => item.id === service.id)).toBe(true);
  expect(historicalB).toMatchObject({ servicePriceCentsSnapshot: 1800, durationMinutes: 45 });
});

test("[multi-location] compensation is configured independently for each shop", async ({ request }) => {
  const locations = await ensureLocations(request, 2);
  const locationA = locations.find((location: any) => location.isDefault) ?? locations[0];
  const locationB = locations.find((location: any) => location.id !== locationA.id);
  expect(locationB).toBeTruthy();
  if (!locationB.isActive) {
    const activation = await request.patch(`/api/admin/locations/${locationB.id}`, { data: { isActive: true } });
    expect(activation.ok(), await activation.text()).toBe(true);
  }

  const suffix = Date.now();
  const createResponse = await request.post("/api/barbers", {
    headers: { "X-Location-Id": String(locationA.id) },
    data: {
      name: `Compensação local QA ${suffix}`,
      specialty: "Financeiro multi-location",
      color: "#345678",
      isVisible: true,
      compensationModel: "commission",
      commissionPercent: 50,
    },
  });
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const barber = await createResponse.json();

  const associateResponse = await request.post("/api/admin/location-barbers", {
    headers: { "X-Location-Id": String(locationB.id) },
    data: { barberId: barber.id },
  });
  expect(associateResponse.status(), await associateResponse.text()).toBe(201);
  const initialB = await (await request.get(`/api/barbers/${barber.id}`, {
    headers: { "X-Location-Id": String(locationB.id) },
  })).json();
  expect(initialB).toMatchObject({ compensationModel: "none", commissionPercent: null });

  const chairResponse = await request.patch(`/api/barbers/${barber.id}`, {
    headers: { "X-Location-Id": String(locationB.id) },
    data: {
      compensationModel: "chair_rent",
      chairRentCents: 25000,
      chairRentPeriod: "month",
    },
  });
  expect(chairResponse.ok(), await chairResponse.text()).toBe(true);

  const updateA = await request.patch(`/api/barbers/${barber.id}`, {
    headers: { "X-Location-Id": String(locationA.id) },
    data: { compensationModel: "commission", commissionPercent: 60 },
  });
  expect(updateA.ok(), await updateA.text()).toBe(true);

  const [configuredA, configuredB] = await Promise.all([
    request.get(`/api/barbers/${barber.id}`, { headers: { "X-Location-Id": String(locationA.id) } }),
    request.get(`/api/barbers/${barber.id}`, { headers: { "X-Location-Id": String(locationB.id) } }),
  ]);
  expect(configuredA.ok(), await configuredA.text()).toBe(true);
  expect(configuredB.ok(), await configuredB.text()).toBe(true);
  expect(await configuredA.json()).toMatchObject({
    compensationModel: "commission",
    commissionPercent: 60,
    chairRentCents: null,
  });
  expect(await configuredB.json()).toMatchObject({
    compensationModel: "chair_rent",
    commissionPercent: null,
    chairRentCents: 25000,
    chairRentPeriod: "month",
  });

  expect((await request.patch(`/api/barbers/${barber.id}`, {
    headers: { "X-Location-Id": String(locationB.id) }, data: { isVisible: false },
  })).ok()).toBe(true);
  expect((await request.patch(`/api/barbers/${barber.id}`, {
    headers: { "X-Location-Id": String(locationA.id) }, data: { isVisible: false },
  })).ok()).toBe(true);
});
