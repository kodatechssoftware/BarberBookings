import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const adminPassword = "Playwright-Test-Admin-2026!";

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: adminPassword },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function loginAdminPage(page: Page) {
  await page.goto("/admin");
  await page.getByPlaceholder("Introduza o email ou nome de utilizador").fill("admin");
  await page.locator('input[type="password"]').fill(adminPassword);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Painel Administrativo" })).toBeVisible();
}

function futureStart(daysAhead: number, hour: number, minute = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + daysAhead);
  value.setUTCHours(hour, minute, 0, 0);
  return value;
}

const openEveryDay = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  startTime: "08:00",
  endTime: "20:00",
  isOpen: true,
}));

const workingEveryDay = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  startTime: "08:00",
  endTime: "20:00",
  isWorking: true,
}));

test.describe.serial("Beauty service-first and operational service buffers", () => {
  let service: any;
  let eligibleProfessional: any;
  let ineligibleProfessional: any;

  test("keeps open public booking ranges finite and rejects the former sentinel safely", async ({ request }) => {
    const windowResponse = await request.get("/api/public-booking-window");
    expect(windowResponse.ok(), await windowResponse.text()).toBe(true);
    const bookingWindow = await windowResponse.json();
    expect(bookingWindow.enabled).toBe(false);
    expect(bookingWindow.maxDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(bookingWindow.maxDate).not.toBe("9999-12-31");

    const supportedRange = await request.get(
      `/api/appointments/public?startDate=${bookingWindow.today}&endDate=${bookingWindow.maxDate}`,
    );
    expect(supportedRange.ok(), await supportedRange.text()).toBe(true);

    const formerSentinel = await request.get(
      `/api/appointments/public?startDate=${bookingWindow.today}&endDate=9999-12-31`,
    );
    expect(formerSentinel.ok(), await formerSentinel.text()).toBe(true);
    expect(await formerSentinel.json()).toEqual(await supportedRange.json());
  });

  test("renders a local Beauty Home and beauty-clean theme at responsive widths", async ({ page }) => {
    const documentResponse = await page.request.get("/");
    expect(documentResponse.ok()).toBe(true);
    const documentHtml = await documentResponse.text();
    expect(documentHtml).toContain('<title>Beauty Studio</title>');
    expect(documentHtml).toContain('property="og:title" content="Beauty Studio"');
    expect(documentHtml).toContain('property="og:image" content="/images/beauty-hero.svg"');
    expect(documentHtml).not.toContain("__BUSINESS_");

    const manifestResponse = await page.request.get("/manifest.webmanifest");
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();
    expect(manifest).toMatchObject({
      name: "Beauty Studio",
      short_name: "Beauty",
      background_color: "#fbf8f4",
      theme_color: "#d6a1ad",
      icons: [{ src: "/images/beauty-logo.svg", type: "image/svg+xml" }],
    });
    expect(JSON.stringify(manifest).toLowerCase()).not.toMatch(/barber|baptista|powerhouse/);

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 820, height: 1180 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page).toHaveTitle("Beauty Studio");
      await expect(page.locator("html")).toHaveAttribute("data-brand-theme", "beauty-clean");
      await expect(page.getByRole("heading", { name: "Beleza e cuidado à sua medida" })).toBeVisible();
      await expect(page.getByText("Serviços personalizados de beleza e bem-estar, com atenção a cada detalhe.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Marcar agora" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Ver serviços" })).toBeVisible();
      await expect(page.locator('img[src="/images/beauty-hero.svg"]')).toBeVisible();
      await expect(page.locator('img[src="/images/beauty-logo.svg"]').first()).toBeVisible();
      await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/images/beauty-logo.svg");
      await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/images/beauty-logo.svg");
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Serviços personalizados de beleza e bem-estar com marcação online.");
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Beauty Studio");
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "/images/beauty-hero.svg");
      const primaryCta = page.getByRole("link", { name: "Marcar agora" });
      const ctaStyle = await primaryCta.evaluate((element) => {
        const style = getComputedStyle(element);
        return { height: element.getBoundingClientRect().height, radius: style.borderRadius };
      });
      expect(ctaStyle.height).toBeGreaterThanOrEqual(52);
      expect(Number.parseFloat(ctaStyle.radius)).toBeGreaterThanOrEqual(24);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    }

    const colors = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        primary: root.getPropertyValue("--primary").trim(),
        background: root.getPropertyValue("--background").trim(),
      };
    });
    expect(colors).toEqual({ primary: "348 42% 68%", background: "35 38% 97%" });

    const baptistaCard = page.locator("#team article").filter({ hasText: "Fábio Baptista" });
    if (await baptistaCard.count()) {
      await expect(baptistaCard.locator("img")).toHaveAttribute("src", "/images/beauty-logo.svg");
    }
    await expect(page.getByText("Corte e barba com hora marcada", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Baptista Barber Shop", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Ana Isabel|Nail Art/i)).toHaveCount(0);
  });

  test("applies buffers to public/manual/edit/reschedule/recurrence and preserves snapshots", async ({ request }) => {
    await loginAdmin(request);
    expect((await request.patch("/api/shop/availability", { data: openEveryDay })).ok()).toBe(true);

    const suffix = Date.now();
    const serviceResponse = await request.post("/api/services", { data: {
      name: `Tratamento buffer ${suffix}`,
      description: "Serviço Beauty com preparação e limpeza",
      price: 4500,
      duration: 60,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      isVisible: true,
    } });
    expect(serviceResponse.status(), await serviceResponse.text()).toBe(201);
    service = await serviceResponse.json();
    expect(service).toMatchObject({
      duration: 60,
      price: 4500,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
    });

    const professionalResponse = await request.post("/api/barbers", { data: {
      name: `Profissional Beauty ${suffix}`,
      specialty: "Tratamentos",
      color: "#8B5CF6",
      isVisible: true,
      serviceIds: [service.id],
    } });
    expect(professionalResponse.status(), await professionalResponse.text()).toBe(201);
    eligibleProfessional = await professionalResponse.json();
    expect((await request.patch(`/api/barbers/${eligibleProfessional.id}/availability`, { data: workingEveryDay })).ok()).toBe(true);

    const ineligibleResponse = await request.post("/api/barbers", { data: {
      name: `Profissional sem tratamento ${suffix}`,
      specialty: "Outra área",
      color: "#64748B",
      isVisible: true,
      serviceIds: [],
    } });
    expect(ineligibleResponse.status(), await ineligibleResponse.text()).toBe(201);
    ineligibleProfessional = await ineligibleResponse.json();
    expect((await request.patch(`/api/barbers/${ineligibleProfessional.id}/availability`, { data: workingEveryDay })).ok()).toBe(true);

    const firstStart = futureStart(60, 10);
    const firstResponse = await request.post("/api/appointments", { data: {
      barberId: eligibleProfessional.id,
      serviceId: service.id,
      startTime: firstStart.toISOString(),
      customerName: "Cliente buffer inicial",
      customerPhone: "+351912640001",
    } });
    expect(firstResponse.status(), await firstResponse.text()).toBe(201);
    const first = await firstResponse.json();
    expect(first).toMatchObject({
      durationMinutes: 60,
      bufferBeforeMinutesSnapshot: 15,
      bufferAfterMinutesSnapshot: 15,
    });

    const conflictResponse = await request.post("/api/appointments", { data: {
      barberId: eligibleProfessional.id,
      serviceId: service.id,
      startTime: new Date(firstStart.getTime() + 60 * 60_000).toISOString(),
      customerName: "Conflito apenas operacional",
      customerPhone: "+351912640002",
    } });
    expect(conflictResponse.status()).toBe(409);

    const boundaryResponse = await request.post("/api/appointments", { data: {
      barberId: eligibleProfessional.id,
      serviceId: service.id,
      startTime: new Date(firstStart.getTime() + 90 * 60_000).toISOString(),
      customerName: "Limite operacional exato",
      customerPhone: "+351912640003",
    } });
    expect(boundaryResponse.status(), await boundaryResponse.text()).toBe(201);

    const ineligibleResponseBooking = await request.post("/api/appointments", { data: {
      barberId: ineligibleProfessional.id,
      serviceId: service.id,
      startTime: futureStart(61, 10).toISOString(),
      customerName: "Profissional incompatível",
      customerPhone: "+351912640004",
    } });
    expect(ineligibleResponseBooking.status()).toBe(400);

    const anyProfessionalResponse = await request.post("/api/appointments", { data: {
      barberId: 0,
      serviceId: service.id,
      startTime: futureStart(62, 10).toISOString(),
      customerName: "Sem preferência",
      customerPhone: "+351912640005",
    } });
    expect(anyProfessionalResponse.status(), await anyProfessionalResponse.text()).toBe(201);
    expect(await anyProfessionalResponse.json()).toMatchObject({ barberId: eligibleProfessional.id });

    const updateServiceResponse = await request.patch(`/api/services/${service.id}`, { data: {
      bufferBeforeMinutes: 20,
      bufferAfterMinutes: 25,
    } });
    expect(updateServiceResponse.status(), await updateServiceResponse.text()).toBe(200);

    const editedStart = futureStart(63, 13);
    const editResponse = await request.patch(`/api/appointments/${first.id}`, { data: {
      startTime: editedStart.toISOString(),
    } });
    expect(editResponse.status(), await editResponse.text()).toBe(200);
    expect(await editResponse.json()).toMatchObject({
      bufferBeforeMinutesSnapshot: 15,
      bufferAfterMinutesSnapshot: 15,
    });

    const rescheduledStart = futureStart(64, 14);
    const rescheduleResponse = await request.post(`/api/appointments/reschedule/${first.cancelToken}`, { data: {
      startTime: rescheduledStart.toISOString(),
    } });
    expect(rescheduleResponse.status(), await rescheduleResponse.text()).toBe(200);
    expect(await rescheduleResponse.json()).toMatchObject({
      bufferBeforeMinutesSnapshot: 15,
      bufferAfterMinutesSnapshot: 15,
    });

    const manualResponse = await request.post("/api/appointments/block", { data: {
      barberId: eligibleProfessional.id,
      serviceId: service.id,
      serviceMode: "existing",
      startTime: futureStart(65, 6).toISOString(),
      name: "Manual Beauty fora de horas",
      phone: "+351912640006",
      customerEmail: "",
      isManualBooking: true,
      isRecurring: false,
      allowOutsideHours: true,
    } });
    expect(manualResponse.status(), await manualResponse.text()).toBe(201);
    expect((await manualResponse.json()).appointments[0]).toMatchObject({
      bufferBeforeMinutesSnapshot: 20,
      bufferAfterMinutesSnapshot: 25,
      manualOutsideHours: true,
    });

    const recurringResponse = await request.post("/api/appointments/block", { data: {
      barberId: eligibleProfessional.id,
      serviceId: service.id,
      serviceMode: "existing",
      startTime: futureStart(70, 12).toISOString(),
      name: "Recorrência Beauty",
      phone: "+351912640007",
      customerEmail: "",
      isManualBooking: true,
      isRecurring: true,
      recurringWeeks: 1,
      recurringMonths: 1,
      allowOutsideHours: true,
    } });
    expect(recurringResponse.status(), await recurringResponse.text()).toBe(201);
    const recurringAppointments = (await recurringResponse.json()).appointments;
    expect(recurringAppointments.length).toBeGreaterThan(1);
    expect(recurringAppointments.every((appointment: any) =>
      appointment.bufferBeforeMinutesSnapshot === 20
      && appointment.bufferAfterMinutesSnapshot === 25)).toBe(true);
  });

  test("returns only occupancy intersecting the requested Lisbon calendar date", async ({ request }) => {
    await loginAdmin(request);
    const nextYear = new Date().getUTCFullYear() + 1;
    const appointmentStart = new Date(Date.UTC(nextYear, 0, 15, 10, 0));
    const appointmentDate = `${nextYear}-01-15`;
    const previousDate = `${nextYear}-01-14`;
    const unrelatedDate = `${nextYear}-01-13`;
    const createResponse = await request.post("/api/appointments/block", { data: {
      barberId: eligibleProfessional.id,
      serviceId: service.id,
      serviceMode: "existing",
      startTime: appointmentStart.toISOString(),
      name: "Date filter QA",
      phone: "+351912640099",
      customerEmail: "",
      isManualBooking: true,
      allowOutsideHours: true,
    } });
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    const appointment = (await createResponse.json()).appointments[0];

    const onAppointmentDate = await request.get(
      `/api/appointments/public?barberId=${eligibleProfessional.id}&date=${appointmentDate}`,
    );
    const onPreviousDate = await request.get(
      `/api/appointments/public?barberId=${eligibleProfessional.id}&date=${previousDate}`,
    );
    const onUnrelatedDate = await request.get(
      `/api/appointments/public?barberId=${eligibleProfessional.id}&date=${unrelatedDate}`,
    );
    expect((await onAppointmentDate.json()).some((item: any) => item.id === appointment.id)).toBe(true);
    expect((await onPreviousDate.json()).some((item: any) => item.id === appointment.id)).toBe(false);
    expect((await onUnrelatedDate.json()).some((item: any) => item.id === appointment.id)).toBe(false);
  });

  test("opens concrete availability windows for public/manual booking and preserves them safely", async ({ request }) => {
    await loginAdmin(request);
    expect((await request.patch("/api/shop/availability", { data: openEveryDay })).ok()).toBe(true);
    const suffix = Date.now();
    const nestedServiceResponse = await request.post("/api/services", { data: {
      name: `Serviço encaixado ${suffix}`,
      description: "Serviço de teste dentro de uma janela",
      price: 2000,
      duration: 60,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      isVisible: true,
    } });
    expect(nestedServiceResponse.status(), await nestedServiceResponse.text()).toBe(201);
    const nestedService = await nestedServiceResponse.json();
    const professionalResponse = await request.post("/api/barbers", { data: {
      name: `Profissional janelas ${suffix}`,
      specialty: "Serviços longos",
      color: "#B76E79",
      isVisible: true,
      serviceIds: [nestedService.id],
    } });
    expect(professionalResponse.status(), await professionalResponse.text()).toBe(201);
    const professional = await professionalResponse.json();
    expect((await request.patch(`/api/barbers/${professional.id}/availability`, { data: workingEveryDay })).ok()).toBe(true);

    const parentStart = futureStart(90, 10);
    const windowStart = new Date(parentStart.getTime() + 60 * 60_000);
    const windowEnd = new Date(parentStart.getTime() + 120 * 60_000);
    const parentResponse = await request.post("/api/appointments/block", { data: {
      barberId: professional.id,
      serviceId: null,
      serviceMode: "custom",
      customServiceName: "Coloração longa com pausa",
      customDurationMinutes: 180,
      servicePriceCents: 8000,
      hasSpecialTerms: true,
      startTime: parentStart.toISOString(),
      name: "Cliente janela principal",
      phone: "+351912650001",
      customerEmail: "",
      isManualBooking: true,
      isRecurring: false,
      allowOutsideHours: true,
      availabilityWindows: [{ startTime: windowStart.toISOString(), endTime: windowEnd.toISOString() }],
    } });
    expect(parentResponse.status(), await parentResponse.text()).toBe(201);
    const parent = (await parentResponse.json()).appointments[0];
    expect(parent.availabilityWindows).toEqual([{
      startTime: windowStart.toISOString(),
      endTime: windowEnd.toISOString(),
    }]);

    const publicAppointments = await (await request.get(`/api/appointments/public?barberId=${professional.id}`)).json();
    expect(publicAppointments.find((appointment: any) => appointment.id === parent.id)?.availabilityWindows).toEqual([{
      startTime: windowStart.toISOString(),
      endTime: windowEnd.toISOString(),
    }]);

    const nestedResponse = await request.post("/api/appointments", { data: {
      barberId: professional.id,
      serviceId: nestedService.id,
      startTime: windowStart.toISOString(),
      customerName: "Cliente encaixada",
      customerPhone: "+351912650002",
    } });
    expect(nestedResponse.status(), await nestedResponse.text()).toBe(201);
    const nested = await nestedResponse.json();

    const removeUnsafeWindow = await request.patch(`/api/appointments/${parent.id}`, { data: {
      availabilityWindows: [],
    } });
    expect(removeUnsafeWindow.status()).toBe(409);

    expect((await request.patch(`/api/appointments/${nested.id}`, { data: { status: "cancelled" } })).ok()).toBe(true);
    const editedStart = new Date(parentStart.getTime() + 24 * 60 * 60_000);
    const shiftedByEdit = await request.patch(`/api/appointments/${parent.id}`, { data: {
      startTime: editedStart.toISOString(),
    } });
    expect(shiftedByEdit.status(), await shiftedByEdit.text()).toBe(200);
    expect((await shiftedByEdit.json()).availabilityWindows).toEqual([{
      startTime: new Date(windowStart.getTime() + 24 * 60 * 60_000).toISOString(),
      endTime: new Date(windowEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }]);

    const rescheduledStart = new Date(editedStart.getTime() + 24 * 60 * 60_000);
    const rescheduled = await request.post(`/api/appointments/reschedule/${parent.cancelToken}`, { data: {
      startTime: rescheduledStart.toISOString(),
    } });
    expect(rescheduled.status(), await rescheduled.text()).toBe(200);
    expect((await rescheduled.json()).availabilityWindows).toEqual([{
      startTime: new Date(windowStart.getTime() + 48 * 60 * 60_000).toISOString(),
      endTime: new Date(windowEnd.getTime() + 48 * 60 * 60_000).toISOString(),
    }]);

    const recurringWithWindow = await request.post("/api/appointments/block", { data: {
      barberId: professional.id,
      serviceId: nestedService.id,
      serviceMode: "existing",
      startTime: futureStart(100, 10).toISOString(),
      name: "Recorrência com janela inválida",
      phone: "+351912650003",
      customerEmail: "",
      isManualBooking: true,
      isRecurring: true,
      recurringWeeks: 1,
      recurringMonths: 1,
      allowOutsideHours: true,
      availabilityWindows: [{
        startTime: futureStart(100, 10, 15).toISOString(),
        endTime: futureStart(100, 10, 30).toISOString(),
      }],
    } });
    expect(recurringWithWindow.status()).toBe(400);
  });

  test("keeps availability-window controls usable on mobile and desktop", async ({ page }) => {
    await loginAdminPage(page);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.getByRole("tab", { name: "Agenda" }).click();
      await page.getByRole("button", { name: "Marcação manual" }).click();
      const dialog = page.getByRole("dialog", { name: "Marcação manual" });
      const section = dialog.getByTestId("manual-booking-availability-windows");
      await expect(section).toBeVisible();
      const availabilitySwitch = section.getByRole("switch", { name: "Abrir disponibilidade durante o serviço" });
      await expect(availabilitySwitch).toBeDisabled();
      await dialog.getByTestId("manual-booking-barber").click();
      await page.getByRole("option", { name: eligibleProfessional.name }).click();
      await dialog.getByTestId("manual-booking-service").click();
      await page.getByRole("option", { name: service.name }).click();
      const firstAvailableTime = dialog.locator('button[data-availability="available"]').first();
      await expect(firstAvailableTime).toBeEnabled();
      const nextAvailableTime = dialog.locator('button[data-availability="available"]').nth(1);
      await expect(nextAvailableTime).toBeEnabled();
      const firstTime = (await firstAvailableTime.innerText()).trim();
      const selectedTime = (await nextAvailableTime.innerText()).trim();
      await firstAvailableTime.click();
      await availabilitySwitch.click();
      const startPicker = section.getByRole("button", { name: /^Início: / });
      await expect(startPicker).toBeVisible();
      const endPicker = section.getByRole("button", { name: /^Fim: / });
      await expect(endPicker).toBeVisible();
      const [initialStart, initialEnd] = await Promise.all([startPicker.innerText(), endPicker.innerText()]);
      const shiftMinutes = (Number(selectedTime.slice(0, 2)) * 60 + Number(selectedTime.slice(3)))
        - (Number(firstTime.slice(0, 2)) * 60 + Number(firstTime.slice(3)));
      const shiftClock = (value: string) => {
        const [hours, minutes] = value.split(":").map(Number);
        const total = hours * 60 + minutes + shiftMinutes;
        return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
      };
      await nextAvailableTime.click();
      await expect(startPicker).toContainText(shiftClock(initialStart));
      await expect(endPicker).toContainText(shiftClock(initialEnd));
      await startPicker.click();
      const hours = page.getByRole("group", { name: "Horas" });
      const minutes = page.getByRole("group", { name: "Minutos" });
      const selectedHour = selectedTime.slice(0, 2);
      const firstMinute = selectedTime.slice(3);
      const secondMinute = String(Number(firstMinute) + 1).padStart(2, "0");
      await expect(hours.getByRole("button", { name: `${selectedHour} horas` })).toBeVisible();
      await expect(hours.getByRole("button", { name: `${String(Number(selectedHour) - 1).padStart(2, "0")} horas` })).toHaveCount(0);
      await minutes.evaluate((list) => { list.scrollTop = 0; });
      const firstMinuteBox = await minutes.getByRole("button", { name: `${firstMinute} minutos` }).boundingBox();
      const secondMinuteBox = await minutes.getByRole("button", { name: `${secondMinute} minutos` }).boundingBox();
      expect(firstMinuteBox).not.toBeNull();
      expect(secondMinuteBox).not.toBeNull();
      expect(secondMinuteBox!.y - firstMinuteBox!.y).toBeCloseTo(firstMinuteBox!.height, 1);
      await minutes.hover();
      await page.mouse.wheel(0, 10_000);
      await expect.poll(() => minutes.evaluate((list) => list.scrollTop)).toBe(
        await minutes.evaluate((list) => list.scrollHeight - list.clientHeight),
      );
      await page.mouse.wheel(0, 10_000);
      expect(await minutes.evaluate((list) => list.scrollTop)).toBe(
        await minutes.evaluate((list) => list.scrollHeight - list.clientHeight),
      );
      await minutes.getByRole("button", { name: "59 minutos" }).click();
      await expect(startPicker).toContainText(`${selectedHour}:59`);
      await startPicker.click();
      const serviceEndMinutes = Number(selectedHour) * 60 + Number(firstMinute) + service.duration;
      const lastHour = String(Math.floor(serviceEndMinutes / 60)).padStart(2, "0");
      const lastMinute = String(serviceEndMinutes % 60).padStart(2, "0");
      await hours.getByRole("button", { name: `${lastHour} horas` }).click();
      await expect(minutes.getByRole("button", { name: `${lastMinute} minutos` })).toBeVisible();
      if (lastMinute !== "59") {
        const nextMinute = String(Number(lastMinute) + 1).padStart(2, "0");
        await expect(minutes.getByRole("button", { name: `${nextMinute} minutos` })).toHaveCount(0);
      }
      await minutes.getByRole("button", { name: `${lastMinute} minutos` }).click();
      await expect(startPicker).toContainText(`${lastHour}:${lastMinute}`);
      await section.getByRole("button", { name: "Adicionar janela" }).click();
      await expect(section.getByRole("button", { name: /^Início: / })).toHaveCount(2);
      await expect(section.getByRole("button", { name: /^Fim: / })).toHaveCount(2);
      await expect(section.getByRole("button", { name: "Remover janela 1" })).toBeVisible();
      expect(await dialog.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
        Math.ceil(await dialog.evaluate((element) => element.clientWidth)) + 1,
      );
      await dialog.getByRole("button", { name: "Close" }).click();
      await expect(dialog).not.toBeVisible();
    }
  });

  test("renders service-first responsively and filters incompatible professionals", async ({ page }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 820, height: 1180 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/booking");
      await expect(page.getByRole("heading", { name: "Selecione o Serviço" })).toBeVisible();
      await expect(page.getByTestId("public-booking-header").locator("img")).toHaveAttribute(
        "src",
        "/images/beauty-logo.svg",
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    }

    await page.getByText(service.name, { exact: true }).click();
    await page.getByRole("button", { name: "Seguinte" }).click();
    await expect(page.getByRole("heading", { name: "Selecione o profissional" })).toBeVisible();
    await expect(page.getByText(eligibleProfessional.name, { exact: true })).toBeVisible();
    await expect(page.getByText(ineligibleProfessional.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText("Qualquer profissional disponível", { exact: true })).toBeVisible();
  });
});
