import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { getAvailableTimeSlots } from "../../client/src/lib/availability";

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  )).toBe(true);
}

async function expectNoBrokenImages(page: Page) {
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
  const brokenImages = await page.evaluate(() =>
    Array.from(document.images)
      .filter((image) => image.naturalWidth === 0)
      .map((image) => image.alt || image.currentSrc || image.src),
  );

  expect(brokenImages).toEqual([]);
}

async function loginAdmin(page: Page) {
  await page.goto("/admin");
  await page.getByPlaceholder("Introduza o email ou nome de utilizador").fill("admin");
  await page.locator('input[type="password"]').fill("baptista2026");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
}

async function loginAdminRequest(request: APIRequestContext) {
  const loginResponse = await request.post("/api/admin/login", {
    data: { username: "admin", password: "baptista2026" },
  });
  expect(loginResponse.ok()).toBe(true);
}

function currentWeekThursdayIso(hour = 10, minute = 0) {
  const now = new Date();
  const monday = new Date(now);
  const currentDay = now.getDay();
  const offsetToMonday = currentDay === 0 ? -6 : 1 - currentDay;
  monday.setDate(now.getDate() + offsetToMonday);

  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  thursday.setHours(hour, minute, 0, 0);
  return thursday.toISOString();
}

function futureThursdayIso(weeksAhead = 3, hour = 10, minute = 0) {
  const date = new Date(currentWeekThursdayIso(hour, minute));
  date.setDate(date.getDate() + weeksAhead * 7);
  return date.toISOString();
}

function futureWeekdayIso(dayOffsetFromThursday: number, weeksAhead = 3, hour = 10, minute = 0) {
  const date = new Date(futureThursdayIso(weeksAhead, hour, minute));
  date.setDate(date.getDate() + dayOffsetFromThursday);
  return date.toISOString();
}

function dateKeyFromIso(isoDate: string) {
  return isoDate.slice(0, 10);
}

function dateLabelFromIso(isoDate: string) {
  const date = new Date(isoDate);
  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getFullYear()),
  ].join("/");
}

async function selectAgendaDay(page: Page, isoDate = currentWeekThursdayIso()) {
  const date = new Date(isoDate);
  const weekday = new Intl.DateTimeFormat("pt-PT", { weekday: "long" }).format(date);
  const dayButton = page.getByRole("button", {
    name: new RegExp(`Escolher ${weekday}.*${date.getDate()}.*${date.getFullYear()}`, "i"),
  });
  await expect(dayButton).toBeVisible();
  await dayButton.click();
}

function lisbonDateTimeParts(isoDate: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Lisbon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(isoDate)).map((part) => [part.type, part.value]),
  );
}

async function createManualAppointmentForCurrentWeek(
  request: APIRequestContext,
  options: { name?: string; phone?: string; hour?: number; minute?: number } = {},
) {
  await loginAdminRequest(request);

  const [barbersResponse, servicesResponse] = await Promise.all([
    request.get("/api/barbers?includeHidden=true"),
    request.get("/api/services?includeHidden=true"),
  ]);
  expect(barbersResponse.ok()).toBe(true);
  expect(servicesResponse.ok()).toBe(true);

  const [barber] = await barbersResponse.json();
  const [service] = await servicesResponse.json();

  const createResponse = await request.post("/api/appointments/block", {
    data: {
      barberId: barber.id,
      serviceId: service.id,
      startTime: currentWeekThursdayIso(options.hour ?? 10, options.minute ?? 0),
      name: options.name || "Agenda Click QA",
      phone: options.phone || "912695705",
      isManualBooking: true,
    },
  });
  expect(createResponse.ok(), await createResponse.text()).toBe(true);
}

async function createExportAppointment(
  request: APIRequestContext,
  data: { name: string; phone: string; startTime: string },
) {
  const [barbersResponse, servicesResponse] = await Promise.all([
    request.get("/api/barbers?includeHidden=true"),
    request.get("/api/services?includeHidden=true"),
  ]);
  expect(barbersResponse.ok()).toBe(true);
  expect(servicesResponse.ok()).toBe(true);

  const [barber] = await barbersResponse.json();
  const [service] = await servicesResponse.json();
  expect(barber).toBeTruthy();
  expect(service).toBeTruthy();

  const createResponse = await request.post("/api/appointments/block", {
    data: {
      barberId: barber.id,
      serviceId: service.id,
      startTime: data.startTime,
      name: data.name,
      phone: data.phone,
      isManualBooking: true,
    },
  });
  expect(createResponse.ok(), await createResponse.text()).toBe(true);

  const appointmentsResponse = await request.get(`/api/appointments?date=${dateKeyFromIso(data.startTime)}`);
  expect(appointmentsResponse.ok()).toBe(true);
  const appointments = await appointmentsResponse.json();
  const appointment = appointments.find((item: any) => item.customerName === data.name);
  expect(appointment).toBeTruthy();

  return { appointment, barber, service };
}

async function createConcurrentManualAppointmentsForCurrentWeek(request: APIRequestContext) {
  await loginAdminRequest(request);

  const [barbersResponse, servicesResponse] = await Promise.all([
    request.get("/api/barbers?includeHidden=true"),
    request.get("/api/services?includeHidden=true"),
  ]);
  expect(barbersResponse.ok()).toBe(true);
  expect(servicesResponse.ok()).toBe(true);

  const barbers = await barbersResponse.json();
  const services = await servicesResponse.json();
  const defaultService = services[0];
  expect(defaultService).toBeTruthy();

  const visibleBarbers = barbers.filter((barber: any) => barber.isVisible !== false);
  const testColors = ["#2DD4BF", "#F97316", "#A855F7"];
  while (visibleBarbers.length < 3) {
    const index = visibleBarbers.length;
    const createBarberResponse = await request.post("/api/barbers", {
      data: {
        name: `Barbeiro Grupo ${index + 1}`,
        specialty: "Teste de agenda",
        color: testColors[index] || "#D4AF37",
        isVisible: true,
        serviceIds: [defaultService.id],
      },
    });
    expect(createBarberResponse.ok()).toBe(true);
    visibleBarbers.push(await createBarberResponse.json());
  }

  visibleBarbers.splice(3);
  expect(visibleBarbers.length).toBeGreaterThanOrEqual(3);

  for (const [index, barber] of visibleBarbers.entries()) {
    const service = services.find((item: any) =>
      !Array.isArray(barber.serviceIds) ||
      barber.serviceIds.length === 0 ||
      barber.serviceIds.includes(item.id),
    ) || services[0];

    const createResponse = await request.post("/api/appointments/block", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: currentWeekThursdayIso(11, 0),
        name: `Grupo Agenda ${index + 1}`,
        phone: `91269572${index}`,
        isManualBooking: true,
      },
    });
    expect(createResponse.ok()).toBe(true);
  }
}

async function openManualBookingFromAgendaSlot(page: Page, isoDate: string, time: string) {
  await selectAgendaDay(page, isoDate);
  const dateLabel = dateLabelFromIso(isoDate);
  const slotButton = page.locator(
    `button[aria-label^="Criar marcação para"][aria-label*="${dateLabel}"][aria-label$="às ${time}"]`,
  ).first();
  await expect(slotButton).toBeVisible();
  await slotButton.click();

  const dialog = page.getByRole("dialog", { name: "Marcação manual" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function selectDialogOption(page: Page, dialog: Locator, index: number, optionName: string) {
  await dialog.getByRole("combobox").nth(index).click();
  await page.getByRole("option", { name: optionName }).click();
}

test.describe("public booking flow", () => {
  test("opens /booking and stays responsive on desktop and mobile", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/booking");

    await expect(page.getByRole("heading", { name: "Seleciona o barbeiro" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoBrokenImages(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/booking");

    await expect(page.getByRole("heading", { name: "Seleciona o barbeiro" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoBrokenImages(page);
  });

  test("keeps the details step usable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/book?barberId=1&serviceId=1&date=2026-06-11&time=15:30");

    await expect(page.getByText("Total:")).toBeVisible();
    await expect(page.getByPlaceholder("O seu nome")).toBeVisible();
    await expect(page.getByPlaceholder("912 345 678")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirmar" })).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  });

  test("does not show availability dots on past calendar days", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/book?barberId=1&serviceId=1");

    await expect(page.getByText("Dias com horários disponíveis")).toBeVisible();

    const todayDayOfMonth = new Date().getDate();
    const markedPastDays = await page.evaluate((todayDay) => {
      return Array.from(document.querySelectorAll<HTMLElement>(".booking-day-available:not(.day-outside)"))
        .map((element) => Number(element.textContent?.trim()))
        .filter((day) => Number.isFinite(day) && day < todayDay);
    }, todayDayOfMonth);

    expect(markedPastDays).toEqual([]);
  });

  test("shows availability dots on next-month days visible in the calendar grid", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/book?barberId=1&serviceId=1&date=2026-07-31");

    await expect(page.getByText("julho 2026")).toBeVisible();

    await expect.poll(async () => page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>(".booking-day-available.day-outside"))
        .map((element) => Number(element.textContent?.trim()))
        .filter((day) => Number.isFinite(day));
    })).toEqual(expect.arrayContaining([1]));
  });

  test("shows inline validation in the customer details step", async ({ page }) => {
    await page.goto("/book?barberId=1&serviceId=1&date=2026-06-11&time=15:30");

    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Indique o nome para a marcação.")).toBeVisible();
    await expect(page.getByText("Indique o telemóvel para confirmarmos a marcação.")).toBeVisible();

    const phoneInput = page.getByPlaceholder("912 345 678");
    await phoneInput.fill("91--0000000");
    await expect(phoneInput).toHaveValue("");
    await phoneInput.focus();
    await page.keyboard.type("91-.2345");
    await expect(phoneInput).toHaveValue("912345");
    await phoneInput.fill("9126957000000000");
    await expect(phoneInput).toHaveValue("912695700");

    await page.getByPlaceholder("O seu nome").fill("Pedro Faria");
    await phoneInput.fill("123");
    await page.getByPlaceholder("exemplo@email.com").fill("email-invalido");

    await expect(page.getByText("Indique o nome para a marcação.")).not.toBeVisible();
    await expect(page.getByText(/Confirme que o número tem 9 dígitos/)).toBeVisible();
    await expect(page.getByText("Indique um email válido ou deixe o campo vazio.")).toBeVisible();

    await phoneInput.fill("912695704");
    await page.getByPlaceholder("exemplo@email.com").fill("");

    await expect(page.getByText(/Confirme que o número tem 9 dígitos/)).not.toBeVisible();
    await expect(page.getByText("Indique um email válido ou deixe o campo vazio.")).not.toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("admin navigation", () => {
  test("advances to the admin panel from the login response", async ({ page }) => {
    await page.route("**/api/admin/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authorized: false, role: "" }),
      });
    });

    await page.goto("/admin");
    await page.getByPlaceholder("Introduza o email ou nome de utilizador").fill("admin");
    await page.locator('input[type="password"]').fill("baptista2026");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page.getByText("Login efetuado com sucesso", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
    await expect(page.getByText("Acesso para Administradores e Barbeiros")).not.toBeVisible();
  });

  test("shows agenda only in Agenda and appointment list only in Marcações", async ({ page, request }) => {
    await createManualAppointmentForCurrentWeek(request);

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);

    await page.getByRole("tab", { name: "Agenda" }).click();
    await expect(page.getByText("Agenda diária")).toBeVisible();
    await expect(page.getByText("Agenda do dia")).not.toBeVisible();
    await expect(page.getByText("Lista de marcações")).not.toBeVisible();
    await page.getByRole("button", { name: "Marcação manual" }).click();
    const manualDialog = page.getByRole("dialog", { name: "Marcação manual" });
    await expect(manualDialog).toBeVisible();
    await expect(manualDialog.getByText("Horas afetadas")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(manualDialog).not.toBeVisible();
    await page.getByRole("button", { name: "Ausência" }).click();
    await expect(page.getByRole("dialog", { name: "Ausência na agenda" })).toBeVisible();
    await page.keyboard.press("Escape");
    await selectAgendaDay(page);
    const weeklyAppointment = page.getByRole("button", {
      name: /Abrir detalhes da marcação de Agenda Click QA/,
    }).first();
    await expect(weeklyAppointment).toBeVisible();
    await weeklyAppointment.press("Enter");
    const appointmentDialog = page.getByRole("dialog");
    await expect(appointmentDialog).toContainText("Detalhes da marcação");
    await expect(appointmentDialog.getByRole("heading", { name: "Agenda Click QA" })).toBeVisible();
    await expect(appointmentDialog.getByText("+351912695705")).toBeVisible();
    await expect(appointmentDialog.getByRole("link", { name: /Ligar/ })).toHaveAttribute("href", "tel:+351912695705");
    await page.keyboard.press("Escape");

    await expect(page.getByRole("button", { name: "Mostrar atividade recente" })).toBeVisible();
    await expect(page.getByText("appointment.created_manual")).not.toBeVisible();
    await page.getByRole("button", { name: "Mostrar atividade recente" }).click();
    await expect(page.getByText("Marcação manual criada").first()).toBeVisible();
    await expect(page.getByText("appointment.created_manual")).not.toBeVisible();

    await expectNoHorizontalOverflow(page);

    await page.getByRole("tab", { name: "Marcações" }).click();
    await expect(page.getByText("Lista de marcações")).toBeVisible();
    await expect(page.getByText("Agenda diária")).not.toBeVisible();
    await expect(page.getByText("Agenda do dia")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Ausência" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    const adminTabs = [
      { name: "Equipa", visibleText: "Equipa de Barbeiros" },
      { name: "Serviços", visibleText: "Serviços Disponíveis" },
      { name: "Horário", visibleText: "Horário base da barbearia" },
      { name: "Bloqueados", visibleText: "Clientes Bloqueados" },
      { name: "Relatórios", visibleText: "Exportar Relatório Excel" },
    ];

    for (const adminTab of adminTabs) {
      await page.getByRole("tab", { name: adminTab.name }).click();
      await expect(page.getByText(adminTab.visibleText)).toBeVisible();
      await expect(page.getByText("Agenda diária")).not.toBeVisible();
      await expect(page.getByText("Agenda do dia")).not.toBeVisible();
      await expect(page.getByText("Lista de marcações")).not.toBeVisible();
      if (adminTab.name === "Equipa") {
        await expect(page.getByRole("button", { name: "Ausências" })).toHaveCount(0);
      }
      if (adminTab.name === "Horário") {
        await expect(page.getByRole("button", { name: "Criar ausência" })).toHaveCount(0);
      }
      await expectNoHorizontalOverflow(page);
    }
  });

  test("switches between day, week and month agenda views", async ({ page, request }) => {
    if (process.env.VISUAL_QA === "true") {
      await createConcurrentManualAppointmentsForCurrentWeek(request);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);
    await selectAgendaDay(page);

    await expect(page.getByTestId("day-agenda-grid")).toBeVisible();
    await expect(page.getByText("Agenda diária")).toBeVisible();

    if (process.env.VISUAL_QA === "true") {
      await page.waitForTimeout(250);
      await page.getByTestId("agenda-calendar").screenshot({ path: "test-results/agenda-day-desktop.png" });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByTestId("day-agenda-mobile")).toBeVisible();
      await page.getByTestId("agenda-calendar").screenshot({ path: "test-results/agenda-day-mobile.png" });
      await page.setViewportSize({ width: 1440, height: 900 });
    }

    const viewControls = page.getByRole("group", { name: "Vista da agenda" });
    await viewControls.getByRole("button", { name: "Semana" }).click();
    await expect(page.getByText("Resumo semanal")).toBeVisible();
    await expect(page.getByTestId("week-agenda-summary")).toBeVisible();

    await viewControls.getByRole("button", { name: "Mês" }).click();
    await expect(page.getByText("Agenda mensal")).toBeVisible();
    await expect(page.getByTestId("month-agenda-calendar")).toBeVisible();

    if (process.env.VISUAL_QA === "true") {
      await page.getByTestId("agenda-calendar").screenshot({ path: "test-results/agenda-month-desktop.png" });
    }

    await page.getByRole("button", { name: /Abrir agenda de/i }).first().click();
    await expect(page.getByText("Agenda diária")).toBeVisible();
    await expect(page.getByTestId("day-agenda-grid")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("preselects the barber when creating from a daily column", async ({ page, request }) => {
    const barbersResponse = await request.get("/api/barbers");
    expect(barbersResponse.ok()).toBe(true);
    const [barber] = await barbersResponse.json();
    expect(barber).toBeTruthy();

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);

    const slot = page.getByRole("button", {
      name: new RegExp(`Criar marcação para ${barber.name} .* às 13:00`),
    });
    await expect(slot).toBeVisible();
    await slot.click();

    const dialog = page.getByRole("dialog", { name: "Marcação manual" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("combobox").first()).toContainText(barber.name);
  });

  test("keeps a filtered barber agenda compact and shows the time range only once", async ({ page, request }) => {
    const appointmentStart = currentWeekThursdayIso(14, 0);
    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok(), await barbersResponse.text()).toBe(true);
    expect(servicesResponse.ok(), await servicesResponse.text()).toBe(true);
    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();
    expect(barber).toBeTruthy();
    expect(service).toBeTruthy();

    await page.route(/\/api\/appointments(?:\?.*)?$/, async (route) => {
      const response = await route.fetch();
      const appointments = await response.json();
      await route.fulfill({
        response,
        json: [
          ...appointments,
          {
            id: 999_991,
            barberId: barber.id,
            serviceId: service.id,
            startTime: appointmentStart,
            durationMinutes: 110,
            status: "booked",
            customerName: "Agenda Filtered Card QA",
            customerPhone: "+351912695798",
            customerEmail: null,
            depositRequired: false,
            depositReason: null,
          },
        ],
      });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);
    await selectAgendaDay(page, appointmentStart);

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: barber.name, exact: true }).click();

    const barberHeaders = page.getByTestId("day-agenda-barber-header");
    await expect(barberHeaders).toHaveCount(1);
    const headerBox = await barberHeaders.boundingBox();
    expect(headerBox).toBeTruthy();
    expect(headerBox!.width).toBeLessThanOrEqual(520.5);

    const appointment = page.getByRole("button", { name: /Agenda Filtered Card QA/ }).first();
    await expect(appointment).toBeVisible();
    await expect(appointment).toContainText("14:00–15:50");
    const startTimeOccurrences = await appointment.evaluate((element) =>
      (element.textContent?.match(/14:00/g) || []).length,
    );
    expect(startTimeOccurrences).toBe(1);
  });

  test("adds and removes barber columns responsively across desktop, tablet and mobile", async ({ page, request }) => {
    await loginAdminRequest(request);
    const initialBarbersResponse = await request.get("/api/barbers");
    expect(initialBarbersResponse.ok(), await initialBarbersResponse.text()).toBe(true);
    const initialBarbers = await initialBarbersResponse.json();
    const initialBarberCount = initialBarbers.length;
    const barberName = `Agenda Responsiva ${Date.now()}`;

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);
    await page.getByRole("tab", { name: "Equipa" }).click();
    await page.getByRole("button", { name: "Adicionar Barbeiro" }).click();

    const addDialog = page.getByRole("dialog", { name: "Adicionar Membro à Equipa" });
    await expect(addDialog).toBeVisible();
    const addInputs = addDialog.locator("input");
    await addInputs.nth(0).fill(barberName);
    await addInputs.nth(1).fill("Teste de agenda responsiva");
    await addDialog.getByRole("button", { name: "Criar Barbeiro" }).click();
    await expect(addDialog).not.toBeVisible();

    const addedTeamCard = page.getByTestId("team-barber-card").filter({ hasText: barberName });
    await expect(addedTeamCard).toBeVisible();

    const [createdBarbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers?includeHidden=true"),
      request.get("/api/services?includeHidden=true"),
    ]);
    expect(createdBarbersResponse.ok(), await createdBarbersResponse.text()).toBe(true);
    expect(servicesResponse.ok(), await servicesResponse.text()).toBe(true);
    const createdBarber = (await createdBarbersResponse.json()).find((barber: any) => barber.name === barberName);
    const [service] = await servicesResponse.json();
    expect(createdBarber).toBeTruthy();
    expect(service).toBeTruthy();

    const historyAppointmentStart = currentWeekThursdayIso(18, 0);
    const historyAppointmentResponse = await request.post("/api/appointments/block", {
      data: {
        barberId: createdBarber.id,
        serviceId: service.id,
        startTime: historyAppointmentStart,
        name: "Agenda Responsiva Historico QA",
        phone: "912695799",
        isManualBooking: true,
      },
    });
    expect(historyAppointmentResponse.ok(), await historyAppointmentResponse.text()).toBe(true);
    const createdAppointmentsResponse = await request.get(
      `/api/appointments?barberId=${createdBarber.id}&date=${dateKeyFromIso(historyAppointmentStart)}`,
    );
    expect(createdAppointmentsResponse.ok(), await createdAppointmentsResponse.text()).toBe(true);
    const historyAppointment = (await createdAppointmentsResponse.json()).find((appointment: any) =>
      appointment.customerName === "Agenda Responsiva Historico QA"
    );
    expect(historyAppointment).toBeTruthy();
    const completeAppointmentResponse = await request.patch(`/api/appointments/${historyAppointment.id}/status`, {
      data: { status: "completed" },
    });
    expect(completeAppointmentResponse.ok(), await completeAppointmentResponse.text()).toBe(true);

    await page.getByRole("tab", { name: "Agenda" }).click();
    const desktopAgenda = page.getByTestId("day-agenda-grid");
    const desktopHeaders = page.getByTestId("day-agenda-barber-header");
    await expect(desktopAgenda).toBeVisible();
    await expect(desktopHeaders).toHaveCount(initialBarberCount + 1);
    await expect(desktopHeaders.filter({ hasText: barberName })).toBeVisible();

    const desktopColumnWidths = await desktopHeaders.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().width),
    );
    expect(desktopColumnWidths.every((width) => width >= 229)).toBe(true);
    await expectNoHorizontalOverflow(page);

    if (process.env.VISUAL_QA === "true") {
      await page.getByTestId("agenda-calendar").screenshot({ path: "test-results/agenda-dynamic-barbers-desktop.png" });
    }

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(desktopAgenda).toBeVisible();
    await expect(page.getByTestId("day-agenda-mobile")).not.toBeVisible();
    const tabletMetrics = await desktopAgenda.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
    }));
    expect(tabletMetrics.scrollWidth).toBeGreaterThanOrEqual(tabletMetrics.clientWidth);
    expect(tabletMetrics.overflowX).toBe("auto");
    await expect(desktopHeaders).toHaveCount(initialBarberCount + 1);
    await expectNoHorizontalOverflow(page);

    if (process.env.VISUAL_QA === "true") {
      await page.getByTestId("agenda-calendar").screenshot({ path: "test-results/agenda-dynamic-barbers-tablet.png" });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileAgenda = page.getByTestId("day-agenda-mobile");
    const mobileBarbers = page.getByTestId("day-agenda-mobile-barber");
    await expect(mobileAgenda).toBeVisible();
    await expect(desktopAgenda).not.toBeVisible();
    await expect(mobileBarbers).toHaveCount(initialBarberCount + 1);
    await expect(mobileBarbers.filter({ hasText: barberName })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    if (process.env.VISUAL_QA === "true") {
      await page.getByTestId("agenda-calendar").screenshot({ path: "test-results/agenda-dynamic-barbers-mobile.png" });
    }

    await page.getByRole("tab", { name: "Equipa" }).click();
    await page.getByRole("button", { name: `Remover ${barberName}` }).click();
    const removeDialog = page.getByRole("alertdialog", { name: `Remover ${barberName}?` });
    await expect(removeDialog).toBeVisible();
    await removeDialog.getByRole("button", { name: "Remover", exact: true }).click();
    await expect(addedTeamCard).not.toBeVisible();

    await page.getByRole("tab", { name: "Agenda" }).click();
    await expect(mobileBarbers).toHaveCount(initialBarberCount);
    await expect(mobileBarbers.filter({ hasText: barberName })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(desktopAgenda).toBeVisible();
    await expect(desktopHeaders).toHaveCount(initialBarberCount);
    await expect(desktopHeaders.filter({ hasText: barberName })).toHaveCount(0);
    const tabletMetricsAfterRemoval = await desktopAgenda.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(tabletMetricsAfterRemoval.scrollWidth).toBe(tabletMetricsAfterRemoval.clientWidth);
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(desktopHeaders).toHaveCount(initialBarberCount);
    const desktopColumnWidthsAfterRemoval = await desktopHeaders.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().width),
    );
    expect(desktopColumnWidthsAfterRemoval.every((width) => width > desktopColumnWidths[0])).toBe(true);
    await expectNoHorizontalOverflow(page);

    const finalBarbersResponse = await request.get("/api/barbers?includeHidden=true");
    expect(finalBarbersResponse.ok(), await finalBarbersResponse.text()).toBe(true);
    const finalBarbers = await finalBarbersResponse.json();
    expect(finalBarbers.find((barber: any) => barber.name === barberName)?.isVisible).toBe(false);
  });

  test("waits for barber and service names before showing appointment rows", async ({ page, request }) => {
    await loginAdminRequest(request);
    const createServiceResponse = await request.post("/api/services", {
      data: {
        name: `Agenda Resumo Longo ${Date.now()}`,
        description: "Teste de altura do resumo",
        price: 1200,
        duration: 60,
      },
    });
    expect(createServiceResponse.ok(), await createServiceResponse.text()).toBe(true);
    const service = await createServiceResponse.json();

    const createBarberResponse = await request.post("/api/barbers", {
      data: {
        name: "Slow Reference Barber",
        specialty: "Teste de carregamento",
        color: "#38BDF8",
        isVisible: true,
        serviceIds: [service.id],
      },
    });
    expect(createBarberResponse.ok()).toBe(true);
    const barber = await createBarberResponse.json();

    const createAppointmentResponse = await request.post("/api/appointments/block", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: currentWeekThursdayIso(17, 0),
        name: "Slow Reference QA",
        phone: "912695706",
        isManualBooking: true,
      },
    });
    expect(createAppointmentResponse.ok(), await createAppointmentResponse.text()).toBe(true);

    await page.route("**/api/barbers?includeHidden=true", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
    await page.route("**/api/services?includeHidden=true", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });

    await loginAdmin(page);
    await page.getByRole("tab", { name: "Marcações" }).click();
    await page.getByRole("button", { name: "Próximas" }).click();

    await expect(page.getByText("Lista de marcações")).not.toBeVisible();
    await expect(page.getByText("Desconhecido")).not.toBeVisible();
    await expect(page.getByText("Serviço indisponível")).not.toBeVisible();

    await expect(page.getByText("Lista de marcações")).toBeVisible();
    await expect(page.getByText("Slow Reference QA")).toBeVisible();
    await expect(page.getByText("Desconhecido")).not.toBeVisible();
    await expect(page.getByText("Serviço indisponível")).not.toBeVisible();
  });

  test("keeps recurring manual bookings to a single selected time", async ({ page, request }) => {
    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);
    await page.getByRole("button", { name: "Marcação manual" }).click();

    const dialog = page.getByRole("dialog", { name: "Marcação manual" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("+351", { exact: true })).toBeVisible();
    await dialog.locator("#manual-booking-phone").fill("912695703");
    await expect(dialog.locator("#manual-booking-phone")).toHaveValue("912695703");
    await selectDialogOption(page, dialog, 0, barber.name);
    await selectDialogOption(page, dialog, 1, service.name);
    await dialog.getByLabel("Repetir marcação").click();

    await expect(dialog.getByRole("button", { name: "Manhã" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Tarde" })).toHaveCount(0);
    await expect(dialog.getByText("Hora da marcação")).toBeVisible();

    await dialog.getByRole("button", { name: "14:00", exact: true }).click();
    await expect(dialog.getByText("1 horário selecionado")).toBeVisible();
    await dialog.getByRole("button", { name: "14:30", exact: true }).click();
    await expect(dialog.getByText("1 horário selecionado")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("warns before manually booking a blacklisted customer", async ({ page, request }) => {
    await loginAdminRequest(request);

    const blacklistedPhone = "912696001";
    const blacklistResponse = await request.post("/api/admin/blacklist", {
      data: {
        phone: blacklistedPhone,
        reason: "Teste aviso marcacao manual",
      },
    });
    expect(blacklistResponse.ok(), await blacklistResponse.text()).toBe(true);

    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);
    await page.getByRole("tab", { name: "Agenda" }).click();
    await page.getByRole("button", { name: /manual/i }).click();

    const dialog = page.getByRole("dialog", { name: /manual/i });
    await expect(dialog).toBeVisible();
    await selectDialogOption(page, dialog, 0, barber.name);
    await selectDialogOption(page, dialog, 1, service.name);
    await dialog.locator("#manual-booking-phone").fill(blacklistedPhone);
    await dialog.getByRole("button", { name: "14:00", exact: true }).click();
    await dialog.getByRole("button", { name: /Criar/i }).click();

    const warningDialog = page.getByRole("alertdialog", { name: "Cliente na blacklist" });
    await expect(warningDialog).toBeVisible();
    await expect(warningDialog).toContainText("+351912696001");
    await expect(warningDialog).toContainText("Para criar esta marcacao, remova primeiro o cliente da blacklist.");
    await expect(warningDialog.getByRole("button", { name: "Criar na mesma" })).toHaveCount(0);
    await expect(warningDialog.getByRole("button", { name: "Remover da blacklist e criar" })).toBeVisible();
    await warningDialog.getByRole("button", { name: "Remover da blacklist e criar" }).click();
    await expect(warningDialog).not.toBeVisible();
    await expect(page.getByText("Registo(s) processado(s) com sucesso.", { exact: true })).toBeVisible();

    const blacklistAfterResponse = await request.get("/api/admin/blacklist");
    expect(blacklistAfterResponse.ok()).toBe(true);
    const blacklistAfter = await blacklistAfterResponse.json();
    expect(blacklistAfter.some((entry: any) => entry.phone === blacklistedPhone)).toBe(false);

    const appointmentsResponse = await request.get(`/api/appointments?barberId=${barber.id}`);
    expect(appointmentsResponse.ok()).toBe(true);
    const appointments = await appointmentsResponse.json();
    expect(appointments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        customerPhone: "+351912696001",
        customerName: "Cliente Manual",
      }),
    ]));
  });

  test("uses manual and automatic service agenda labels", async ({ page, request }) => {
    await loginAdminRequest(request);

    const barbersResponse = await request.get("/api/barbers?includeHidden=true");
    expect(barbersResponse.ok()).toBe(true);
    const [barber] = await barbersResponse.json();
    expect(barber).toBeTruthy();

    await loginAdmin(page);
    await page.getByRole("tab", { name: "Serviços" }).click();
    await page.getByRole("button", { name: "Adicionar Serviço" }).click();

    const serviceDialog = page.getByRole("dialog", { name: "Novo Serviço" });
    const serviceInputs = serviceDialog.locator("input");
    await serviceInputs.nth(0).fill("Corte A");
    await serviceInputs.nth(1).fill("Teste de etiqueta na agenda");
    await serviceInputs.nth(2).fill("Corte B");
    await serviceInputs.nth(3).fill("10");
    await serviceInputs.nth(4).fill("30");
    await serviceDialog.getByRole("button", { name: "Criar Serviço" }).click();
    await expect(page.getByText("Agenda: Corte B")).toBeVisible();

    const servicesResponse = await request.get("/api/services?includeHidden=true");
    expect(servicesResponse.ok()).toBe(true);
    const services = await servicesResponse.json();
    const service = services.find((item: any) => item.name === "Corte A");
    expect(service).toBeTruthy();
    expect(service.agendaLabel).toBe("Corte B");

    const madeixasServiceResponse = await request.post("/api/services", {
      data: {
        name: "Madeixas QA",
        description: "Teste de etiqueta automatica",
        price: 1000,
        duration: 30,
      },
    });
    expect(madeixasServiceResponse.ok(), await madeixasServiceResponse.text()).toBe(true);
    const madeixasService = await madeixasServiceResponse.json();
    expect(madeixasService.agendaLabel ?? null).toBe(null);

    const assignedServiceIds = Array.from(new Set([
      ...services.map((item: any) => item.id),
      service.id,
      madeixasService.id,
    ]));
    const assignServicesResponse = await request.patch(`/api/barbers/${barber.id}/services`, {
      data: { serviceIds: assignedServiceIds },
    });
    expect(assignServicesResponse.ok(), await assignServicesResponse.text()).toBe(true);

    const createResponse = await request.post("/api/appointments/block", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: currentWeekThursdayIso(19, 30),
        name: "Cliente Etiqueta",
        phone: "912695733",
        isManualBooking: true,
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBe(true);

    const createMadeixasResponse = await request.post("/api/appointments/block", {
      data: {
        barberId: barber.id,
        serviceId: madeixasService.id,
        startTime: currentWeekThursdayIso(18, 30),
        name: "Cliente Madeixas",
        phone: "912695734",
        isManualBooking: true,
      },
    });
    expect(createMadeixasResponse.ok(), await createMadeixasResponse.text()).toBe(true);

    await page.reload();
    await page.getByRole("tab", { name: "Agenda" }).waitFor({ state: "visible" });
    await selectAgendaDay(page);
    const agendaAppointment = page.getByRole("button", {
      name: /Abrir detalhes da marcação de Cliente Etiqueta/,
    }).first();
    await expect(agendaAppointment).toBeVisible();
    await expect(agendaAppointment).toContainText("Corte B");
    await expect(agendaAppointment).not.toContainText("Corte A");

    const automaticAgendaAppointment = page.locator("button:visible").filter({ hasText: "Cliente Madeixas" }).first();
    await expect(automaticAgendaAppointment).toBeVisible();
    await expect(automaticAgendaAppointment).toContainText("Madeixas QA");
    await expect(automaticAgendaAppointment).not.toContainText("Serviço");

    await expect.poll(async () => agendaAppointment.evaluate((element) => {
      const column = element.parentElement;
      if (!column) return false;
      const appointmentRect = element.getBoundingClientRect();
      const columnRect = column.getBoundingClientRect();
      return appointmentRect.bottom <= columnRect.bottom + 1;
    })).toBe(true);
  });

  test("keeps the admin dashboard usable on mobile and saves internal notes", async ({ page, request }) => {
    await createManualAppointmentForCurrentWeek(request, {
      name: "Notas Internas QA",
      phone: "912695706",
      hour: 14,
      minute: 30,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await loginAdmin(page);
    await selectAgendaDay(page);

    await expect(page.getByText("Resumo do dia")).toBeVisible();
    await expect(page.getByText("Dashboard simples")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const appointmentButton = page.getByRole("button", {
      name: /Abrir detalhes da marcação de Notas Internas QA/,
    }).first();
    await expect(appointmentButton).toBeVisible();
    await appointmentButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Notas internas", { exact: true })).toBeVisible();
    const notesInput = dialog.locator("textarea").last();
    await expect(notesInput).toBeEnabled();

    const noteText = "Prefere máquina 0.5 e gosta da barba curta.";
    await notesInput.fill(noteText);
    await dialog.getByRole("button", { name: "Guardar notas" }).click();
    await expect(page.getByText("As notas internas do cliente foram atualizadas.").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.reload();
    await expect(page.getByText("Resumo do dia")).toBeVisible();
    await selectAgendaDay(page);

    const reloadedAppointmentButton = page.getByRole("button", {
      name: /Abrir detalhes da marcação de Notas Internas QA/,
    }).first();
    await expect(reloadedAppointmentButton).toBeVisible();
    await reloadedAppointmentButton.click();
    await expect(page.getByRole("dialog").locator("textarea").last()).toHaveValue(noteText);
    await expectNoHorizontalOverflow(page);
  });

  test("keeps manual and public availability in sync", async ({ page, request }) => {
    await loginAdminRequest(request);

    const appointmentStart = currentWeekThursdayIso(16, 30);
    const { appointment, barber, service } = await createExportAppointment(request, {
      name: "Disponibilidade Manual QA",
      phone: "912695707",
      startTime: appointmentStart,
    });
    const appointmentDateKey = dateKeyFromIso(appointmentStart);

    const publicBusyResponse = await request.get(`/api/appointments/public?barberId=${barber.id}&date=${appointmentDateKey}`);
    expect(publicBusyResponse.ok()).toBe(true);
    const publicBusyAppointments = await publicBusyResponse.json();
    expect(publicBusyAppointments.some((item: any) => item.id === appointment.id)).toBe(true);

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);

    let dialog = await openManualBookingFromAgendaSlot(page, appointmentStart, "09:00");
    await selectDialogOption(page, dialog, 0, barber.name);
    await selectDialogOption(page, dialog, 1, service.name);

    await expect(dialog.getByRole("button", { name: "16:30", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    const cancelResponse = await request.patch(`/api/appointments/${appointment.id}/status`, {
      data: { status: "cancelled" },
    });
    expect(cancelResponse.ok(), await cancelResponse.text()).toBe(true);

    const publicFreeResponse = await request.get(`/api/appointments/public?barberId=${barber.id}&date=${appointmentDateKey}`);
    expect(publicFreeResponse.ok()).toBe(true);
    const publicFreeAppointments = await publicFreeResponse.json();
    expect(publicFreeAppointments.some((item: any) => item.id === appointment.id)).toBe(false);

    await page.reload();
    await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
    await expect(page.getByRole("button", {
      name: /Abrir detalhes da marcação de Disponibilidade Manual QA/,
    })).toHaveCount(0);

    dialog = await openManualBookingFromAgendaSlot(page, appointmentStart, "09:00");
    await selectDialogOption(page, dialog, 0, barber.name);
    await selectDialogOption(page, dialog, 1, service.name);

    await expect(dialog.getByRole("button", { name: "16:30", exact: true })).toBeEnabled();

    const publicAppointmentStart = currentWeekThursdayIso(17, 30);
    const publicCreateResponse = await request.post("/api/appointments", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: publicAppointmentStart,
        customerName: "Publico Sincronizado QA",
        customerPhone: "912695709",
        customerEmail: null,
      },
    });
    expect(publicCreateResponse.ok(), await publicCreateResponse.text()).toBe(true);

    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();

    dialog = await openManualBookingFromAgendaSlot(page, publicAppointmentStart, "09:00");
    await selectDialogOption(page, dialog, 0, barber.name);
    await selectDialogOption(page, dialog, 1, service.name);

    await expect(dialog.getByRole("button", { name: "17:30", exact: true })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
  });

  test("reduces large barber photos before saving them", async ({ page }) => {
    await loginAdmin(page);

    await page.getByRole("tab", { name: "Equipa" }).click();
    await page.getByRole("button", { name: "Editar" }).first().click();

    const dialog = page.getByRole("dialog", { name: "Editar Barbeiro" });
    await expect(dialog).toBeVisible();

    const uploadedSize = await page.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*="image/jpeg"]');
      if (!input) throw new Error("Photo input not found");

      const canvas = document.createElement("canvas");
      canvas.width = 2200;
      canvas.height = 2200;

      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas not available");

      const imageData = context.createImageData(canvas.width, canvas.height);
      for (let offset = 0; offset < imageData.data.length; offset += 65536) {
        crypto.getRandomValues(imageData.data.subarray(offset, Math.min(offset + 65536, imageData.data.length)));
      }
      for (let alpha = 3; alpha < imageData.data.length; alpha += 4) {
        imageData.data[alpha] = 255;
      }
      context.putImageData(imageData, 0, 0);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (!result) reject(new Error("Large image was not created"));
          else resolve(result);
        }, "image/png");
      });

      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], "foto-grande.png", { type: "image/png" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return blob.size;
    });

    expect(uploadedSize).toBeGreaterThan(10 * 1024 * 1024);
    expect(uploadedSize).toBeLessThanOrEqual(25 * 1024 * 1024);
    await expect(page.getByText("A imagem deve ter no máximo 10 MB.")).not.toBeVisible();

    const preview = dialog.locator('img[src^="data:image/jpeg"]').first();
    await expect(preview).toBeVisible({ timeout: 15000 });

    const optimizedSize = await preview.evaluate((image) => {
      const src = (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src;
      const base64 = src.split(";base64,")[1] || "";
      const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
      return Math.ceil((base64.length * 3) / 4) - padding;
    });

    expect(optimizedSize).toBeLessThanOrEqual(900 * 1024);
  });

  test("shows simultaneous appointments in separate barber columns", async ({ page, request }) => {
    await createConcurrentManualAppointmentsForCurrentWeek(request);

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);
    await selectAgendaDay(page);

    const firstAppointment = page.getByRole("button", { name: /Grupo Agenda 1/ }).first();
    const secondAppointment = page.getByRole("button", { name: /Grupo Agenda 2/ }).first();
    const thirdAppointment = page.getByRole("button", { name: /Grupo Agenda 3/ }).first();

    await expect(firstAppointment).toBeVisible();
    await expect(secondAppointment).toBeVisible();
    await expect(thirdAppointment).toBeVisible();

    const boxes = await Promise.all([
      firstAppointment.boundingBox(),
      secondAppointment.boundingBox(),
      thirdAppointment.boundingBox(),
    ]);
    expect(boxes.every(Boolean)).toBe(true);
    const [firstBox, secondBox, thirdBox] = boxes as NonNullable<typeof boxes[number]>[];

    expect(firstBox.y).toBeCloseTo(secondBox.y, 0);
    expect(firstBox.y).toBeCloseTo(thirdBox.y, 0);
    expect(firstBox.height).toBeCloseTo(secondBox.height, 0);
    expect(firstBox.height).toBeCloseTo(thirdBox.height, 0);
    expect(firstBox.x).toBeLessThan(secondBox.x);
    expect(secondBox.x).toBeLessThan(thirdBox.x);
    await expectNoHorizontalOverflow(page);
  });

  test("keeps dense daily appointments aligned across barber columns", async ({ page, request }) => {
    await loginAdminRequest(request);

    const createServiceResponse = await request.post("/api/services", {
      data: {
        name: `Agenda Lanes Longo ${Date.now()}`,
        description: "Teste de lanes densos",
        price: 1200,
        duration: 60,
      },
    });
    expect(createServiceResponse.ok(), await createServiceResponse.text()).toBe(true);
    const service = await createServiceResponse.json();

    const createdBarbers = [];
    for (const [index, color] of ["#22C55E", "#38BDF8", "#8B5CF6", "#F97316"].entries()) {
      const createBarberResponse = await request.post("/api/barbers", {
        data: {
          name: `Agenda Lanes Barbeiro ${index + 1} ${Date.now()}`,
          specialty: "Teste de lanes",
          color,
          isVisible: true,
          serviceIds: [service.id],
        },
      });
      expect(createBarberResponse.ok(), await createBarberResponse.text()).toBe(true);
      createdBarbers.push(await createBarberResponse.json());
    }

    for (const [index, barber] of createdBarbers.entries()) {
      const createResponse = await request.post("/api/appointments/block", {
        data: {
          barberId: barber.id,
          serviceId: service.id,
          startTime: currentWeekThursdayIso(16, 30),
          name: `Agenda Lane Cliente ${index + 1}`,
          phone: `91269578${index}`,
          isManualBooking: true,
        },
      });
      expect(createResponse.ok(), await createResponse.text()).toBe(true);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);
    await selectAgendaDay(page);

    const sameStartBoxes = await Promise.all(
      [1, 2, 3, 4].map(async (index) => {
        const appointment = page.getByRole("button", { name: new RegExp(`Agenda Lane Cliente ${index}`) }).first();
        await expect(appointment).toBeVisible();
        const box = await appointment.boundingBox();
        expect(box).toBeTruthy();
        return box!;
      }),
    );

    const firstTop = sameStartBoxes[0].y;
    sameStartBoxes.forEach((box) => {
      expect(box.y).toBeCloseTo(firstTop, 0);
      expect(box.height).toBeCloseTo(sameStartBoxes[0].height, 0);
    });
    for (let index = 1; index < sameStartBoxes.length; index += 1) {
      expect(sameStartBoxes[index - 1].x).toBeLessThan(sameStartBoxes[index].x);
    }
    await expectNoHorizontalOverflow(page);
  });

  test("keeps overlapping daily agenda cards in separate barber columns", async ({ page, request }) => {
    await loginAdminRequest(request);

    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers?includeHidden=true"),
      request.get("/api/services?includeHidden=true"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const services = await servicesResponse.json();
    expect(services[0]).toBeTruthy();

    const createLongServiceResponse = await request.post("/api/services", {
      data: {
        name: `Agenda Lane Longo ${Date.now()}`,
        description: "Teste de lanes da agenda",
        price: 1000,
        duration: 60,
      },
    });
    expect(createLongServiceResponse.ok(), await createLongServiceResponse.text()).toBe(true);
    const longService = await createLongServiceResponse.json();

    const createShortServiceResponse = await request.post("/api/services", {
      data: {
        name: `Agenda Lane Curto ${Date.now()}`,
        description: "Teste de lanes da agenda",
        price: 800,
        duration: 30,
      },
    });
    expect(createShortServiceResponse.ok(), await createShortServiceResponse.text()).toBe(true);
    const shortService = await createShortServiceResponse.json();

    const createTinyServiceResponse = await request.post("/api/services", {
      data: {
        name: `Agenda Lane Minimo ${Date.now()}`,
        description: "Teste de lanes da agenda",
        price: 500,
        duration: 15,
      },
    });
    expect(createTinyServiceResponse.ok(), await createTinyServiceResponse.text()).toBe(true);
    const tinyService = await createTinyServiceResponse.json();

    const barbers = [];
    for (const [index, color] of ["#22C55E", "#8B5CF6"].entries()) {
      const createBarberResponse = await request.post("/api/barbers", {
        data: {
          name: `Agenda Lane Barbeiro ${index + 1} ${Date.now()}`,
          specialty: "Teste de agenda",
          color,
          isVisible: true,
          serviceIds: [longService.id, shortService.id, tinyService.id],
        },
      });
      expect(createBarberResponse.ok(), await createBarberResponse.text()).toBe(true);
      barbers.push(await createBarberResponse.json());
    }

    const appointments = [
      {
        barberId: barbers[0].id,
        serviceId: longService.id,
        startTime: currentWeekThursdayIso(11, 0),
        name: "Lane Agenda Longo QA",
        phone: "912695761",
      },
      {
        barberId: barbers[1].id,
        serviceId: shortService.id,
        startTime: currentWeekThursdayIso(11, 30),
        name: "Lane Agenda Sobreposto QA",
        phone: "912695762",
      },
      {
        barberId: barbers[1].id,
        serviceId: shortService.id,
        startTime: currentWeekThursdayIso(12, 0),
        name: "Lane Agenda Seguinte QA",
        phone: "912695763",
      },
      {
        barberId: barbers[1].id,
        serviceId: tinyService.id,
        startTime: currentWeekThursdayIso(12, 30),
        name: "Lane Agenda Minimo QA",
        phone: "912695764",
      },
    ];

    for (const appointment of appointments) {
      const createResponse = await request.post("/api/appointments/block", {
        data: {
          ...appointment,
          isManualBooking: true,
        },
      });
      expect(createResponse.ok(), await createResponse.text()).toBe(true);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);
    await selectAgendaDay(page);

    const longAppointment = page.getByRole("button", { name: /Lane Agenda Longo QA/ }).first();
    const overlappingAppointment = page.getByRole("button", { name: /Lane Agenda Sobreposto QA/ }).first();
    const nextAppointment = page.getByRole("button", { name: /Lane Agenda Seguinte QA/ }).first();
    const tinyAppointment = page.getByRole("button", { name: /Lane Agenda Minimo QA/ }).first();

    await expect(longAppointment).toBeVisible();
    await expect(overlappingAppointment).toBeVisible();
    await expect(nextAppointment).toBeVisible();
    await expect(tinyAppointment).toBeVisible();
    await expect(overlappingAppointment).toContainText(shortService.name);
    await expect(tinyAppointment).toContainText(tinyService.name);
    await expect(longAppointment).toContainText("11:00–12:00");
    await expect(overlappingAppointment).toContainText("11:30–12:00");
    await expect(nextAppointment).toContainText("12:00–12:30");
    await expect(tinyAppointment).toContainText("12:30–12:45");

    const compactServiceBox = await overlappingAppointment.getByText(shortService.name).boundingBox();
    const compactTimeRangeBox = await overlappingAppointment.getByText("11:30–12:00").boundingBox();
    expect(compactServiceBox).toBeTruthy();
    expect(compactTimeRangeBox).toBeTruthy();
    expect(compactTimeRangeBox!.y).toBeGreaterThan(compactServiceBox!.y);

    const cardContentMetrics = await Promise.all([longAppointment, overlappingAppointment, nextAppointment, tinyAppointment].map((appointment) =>
      appointment.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      })),
    ));
    cardContentMetrics.forEach(({ clientHeight, scrollHeight }) => {
      expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
    });

    if (process.env.VISUAL_QA === "true") {
      await page.getByTestId("agenda-calendar").screenshot({ path: "test-results/agenda-short-cards-desktop.png" });
    }

    const boxes = await Promise.all([
      longAppointment.boundingBox(),
      overlappingAppointment.boundingBox(),
      nextAppointment.boundingBox(),
    ]);
    expect(boxes.every(Boolean)).toBe(true);
    const [longBox, overlappingBox, nextBox] = boxes as NonNullable<typeof boxes[number]>[];

    const intersects = (first: typeof longBox, second: typeof longBox) =>
      first.x < second.x + second.width &&
      first.x + first.width > second.x &&
      first.y < second.y + second.height &&
      first.y + first.height > second.y;

    expect(intersects(longBox, overlappingBox)).toBe(false);
    expect(intersects(overlappingBox, nextBox)).toBe(false);
    expect(nextBox.width).toBeGreaterThan(80);

    await overlappingAppointment.click();
    const appointmentDialog = page.getByRole("dialog");
    await expect(appointmentDialog.getByText("Lane Agenda Sobreposto QA")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("positions daily agenda cards proportionally to their real start time and duration", async ({ page, request }) => {
    await loginAdminRequest(request);

    const timestamp = Date.now();
    const createFortyFiveMinuteServiceResponse = await request.post("/api/services", {
      data: {
        name: `Agenda Minutos 45 ${timestamp}`,
        description: "Teste de posicao da agenda",
        price: 900,
        duration: 45,
      },
    });
    expect(createFortyFiveMinuteServiceResponse.ok(), await createFortyFiveMinuteServiceResponse.text()).toBe(true);
    const fortyFiveMinuteService = await createFortyFiveMinuteServiceResponse.json();

    const createFiftyMinuteServiceResponse = await request.post("/api/services", {
      data: {
        name: `Agenda Minutos 50 ${timestamp}`,
        description: "Teste de posicao da agenda",
        price: 1000,
        duration: 50,
      },
    });
    expect(createFiftyMinuteServiceResponse.ok(), await createFiftyMinuteServiceResponse.text()).toBe(true);
    const fiftyMinuteService = await createFiftyMinuteServiceResponse.json();

    const createBarberResponse = await request.post("/api/barbers", {
      data: {
        name: `Agenda Minutos Barbeiro ${timestamp}`,
        specialty: "Teste de escala",
        color: "#38BDF8",
        isVisible: true,
        serviceIds: [fortyFiveMinuteService.id, fiftyMinuteService.id],
      },
    });
    expect(createBarberResponse.ok(), await createBarberResponse.text()).toBe(true);
    const barber = await createBarberResponse.json();

    const appointments = [
      {
        barberId: barber.id,
        serviceId: fortyFiveMinuteService.id,
        startTime: currentWeekThursdayIso(9, 30),
        name: "Agenda Minutos Meio",
        phone: "912695771",
      },
      {
        barberId: barber.id,
        serviceId: fiftyMinuteService.id,
        startTime: currentWeekThursdayIso(10, 30),
        name: "Agenda Minutos Cinquenta",
        phone: "912695772",
      },
    ];

    for (const appointment of appointments) {
      const createResponse = await request.post("/api/appointments/block", {
        data: {
          ...appointment,
          isManualBooking: true,
        },
      });
      expect(createResponse.ok(), await createResponse.text()).toBe(true);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);

    await page.getByText("Todos os barbeiros").first().click();
    await page.getByRole("option", { name: barber.name }).click();
    await selectAgendaDay(page);

    const halfHourAppointment = page.getByRole("button", { name: /Agenda Minutos Meio/ }).first();
    const fiftyMinuteAppointment = page.getByRole("button", { name: /Agenda Minutos Cinquenta/ }).first();

    await expect(halfHourAppointment).toBeVisible();
    await expect(fiftyMinuteAppointment).toBeVisible();

    const halfHourGeometry = await halfHourAppointment.evaluate((element) => {
      const htmlElement = element as HTMLElement;
      return {
        top: parseFloat(htmlElement.style.top),
        height: parseFloat(htmlElement.style.height),
      };
    });
    const fiftyMinuteGeometry = await fiftyMinuteAppointment.evaluate((element) => {
      const htmlElement = element as HTMLElement;
      return {
        top: parseFloat(htmlElement.style.top),
        height: parseFloat(htmlElement.style.height),
      };
    });

    const pixelsPerMinute = 1.8;
    expect(halfHourGeometry.top).toBeCloseTo(30 * pixelsPerMinute, 1);
    expect(halfHourGeometry.height).toBeCloseTo(45 * pixelsPerMinute, 1);
    expect(fiftyMinuteGeometry.top).toBeCloseTo(90 * pixelsPerMinute, 1);
    expect(fiftyMinuteGeometry.height).toBeCloseTo(50 * pixelsPerMinute, 1);
  });
});

test.describe("agenda interaction", () => {
  test("locks the admin navigation tabs to horizontal panning", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAdmin(page);

    const adminTabs = page.locator(".admin-tabs-horizontal-scroll");
    await expect(adminTabs).toBeVisible();
    await expect(adminTabs).toHaveCSS("overflow-x", "auto");
    await expect(adminTabs).toHaveCSS("overflow-y", "hidden");
    await expect(adminTabs).toHaveCSS("touch-action", "pan-x");
    await expect(adminTabs).toHaveCSS("height", "48px");
  });

  test("keeps horizontal agenda panning without trapping the page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await loginAdmin(page);

    const horizontalAgenda = page.locator(".day-agenda-horizontal-scroll");
    await expect(horizontalAgenda).toBeVisible();
    await expect(horizontalAgenda).toHaveCSS("overflow-x", "auto");
    await expect(horizontalAgenda).toHaveCSS("overflow-y", "hidden");

    await horizontalAgenda.hover({ position: { x: 200, y: 250 } });
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 500);

    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(scrollBefore);
  });
});

test.describe("admin list stability", () => {
  test("keeps admin lists from flashing empty while data is loading", async ({ page }) => {
    await page.route("**/api/barbers?includeHidden=true", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });

    await loginAdmin(page);
    await page.getByRole("tab", { name: "Equipa" }).click();

    await expect(page.getByText(/barbeiros ativos neste momento/)).toHaveCount(0);
    await expect(page.getByText("A carregar barbeiros...")).toBeVisible();
    await expect(page.getByText("A carregar barbeiros...")).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/barbeiros ativos neste momento/)).toHaveCount(0);
  });

  test("marks API list responses as non-cacheable", async ({ request }) => {
    await loginAdminRequest(request);

    const barbersResponse = await request.get("/api/barbers?includeHidden=true");
    const servicesResponse = await request.get("/api/services?includeHidden=true");
    const conditionalBarbersResponse = await request.get("/api/barbers?includeHidden=true", {
      headers: { "If-None-Match": '"forced-stale-etag"' },
    });

    expect(barbersResponse.ok(), await barbersResponse.text()).toBe(true);
    expect(servicesResponse.ok(), await servicesResponse.text()).toBe(true);
    expect(conditionalBarbersResponse.ok(), await conditionalBarbersResponse.text()).toBe(true);
    expect(barbersResponse.headers()["cache-control"]).toContain("no-store");
    expect(servicesResponse.headers()["cache-control"]).toContain("no-store");
    expect(barbersResponse.headers()["etag"]).toBeUndefined();
    expect(servicesResponse.headers()["etag"]).toBeUndefined();
    expect(conditionalBarbersResponse.status()).toBe(200);
  });
});

test.describe("booking rules", () => {
  test("exports a management-ready Excel report with numeric revenue", async ({ request }) => {
    await loginAdminRequest(request);

    const completedStart = futureThursdayIso(4, 9, 0);
    const bookedStart = futureThursdayIso(4, 14, 0);
    const completed = await createExportAppointment(request, {
      name: "Excel Completed QA",
      phone: "912695741",
      startTime: completedStart,
    });
    const booked = await createExportAppointment(request, {
      name: "Excel Booked QA",
      phone: "912695742",
      startTime: bookedStart,
    });

    const statusResponse = await request.patch(`/api/appointments/${completed.appointment.id}/status`, {
      data: { status: "completed" },
    });
    expect(statusResponse.ok()).toBe(true);

    const dateKey = dateKeyFromIso(completedStart);
    const exportResponse = await request.get(`/api/admin/export?startDate=${dateKey}&endDate=${dateKey}&barberId=all`);
    expect(exportResponse.ok()).toBe(true);
    expect(exportResponse.headers()["content-type"]).toContain("spreadsheetml.sheet");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exportResponse.body());

    for (const sheetName of ["Resumo Geral", "Resumo por Barbeiro", "Resumo por Serviço", "Resumo diário", "Detalhe Completo"]) {
      expect(workbook.getWorksheet(sheetName), `${sheetName} sheet`).toBeTruthy();
    }

    const completedServiceValue = completed.service.price / 100;
    const bookedServiceValue = booked.service.price / 100;
    const summarySheet = workbook.getWorksheet("Resumo Geral");
    expect(summarySheet?.getCell("B10").value).toBe(completedServiceValue);
    expect(summarySheet?.getCell("B11").value).toBe(bookedServiceValue);

    const detailSheet = workbook.getWorksheet("Detalhe Completo");
    expect(detailSheet).toBeTruthy();
    const headers = detailSheet!.getRow(1).values as unknown[];
    const customerCol = headers.indexOf("Cliente");
    const statusCol = headers.indexOf("Estado");
    const realizedCol = headers.indexOf("Receita realizada (€)");
    const projectedCol = headers.indexOf("Receita prevista (€)");
    expect(customerCol).toBeGreaterThan(0);
    expect(statusCol).toBeGreaterThan(0);
    expect(realizedCol).toBeGreaterThan(0);
    expect(projectedCol).toBeGreaterThan(0);

    let completedRow: ExcelJS.Row | undefined;
    let bookedRow: ExcelJS.Row | undefined;
    detailSheet!.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if (row.getCell(customerCol).value === "Excel Completed QA") completedRow = row;
      if (row.getCell(customerCol).value === "Excel Booked QA") bookedRow = row;
    });

    expect(completedRow).toBeTruthy();
    expect(bookedRow).toBeTruthy();
    expect(completedRow!.getCell(statusCol).value).toBe("Concluída");
    expect(completedRow!.getCell(realizedCol).value).toBe(completedServiceValue);
    expect(completedRow!.getCell(projectedCol).value).toBe(0);
    expect(bookedRow!.getCell(statusCol).value).toBe("Marcada");
    expect(bookedRow!.getCell(realizedCol).value).toBe(0);
    expect(bookedRow!.getCell(projectedCol).value).toBe(bookedServiceValue);
  });

  test("rejects malformed phone numbers sent directly to the booking API", async ({ request }) => {
    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();

    const response = await request.post("/api/appointments", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: currentWeekThursdayIso(17, 30),
        customerName: "Numero Esquisito",
        customerPhone: "91--0000000",
        customerEmail: null,
      },
    });

    expect(response.status()).toBe(400);
  });

  test("does not expose barber credentials through barber APIs", async ({ request }) => {
    const publicResponse = await request.get("/api/barbers");
    expect(publicResponse.ok()).toBe(true);
    const publicBarbers = await publicResponse.json();
    expect(publicBarbers.length).toBeGreaterThan(0);
    expect(publicBarbers[0]).not.toHaveProperty("password");
    expect(publicBarbers[0]).not.toHaveProperty("email");

    await loginAdminRequest(request);
    const privateResponse = await request.get("/api/barbers?includeHidden=true");
    expect(privateResponse.ok()).toBe(true);
    const privateBarbers = await privateResponse.json();
    expect(privateBarbers.length).toBeGreaterThan(0);
    expect(privateBarbers[0]).toHaveProperty("email");
    expect(privateBarbers[0]).not.toHaveProperty("password");
  });

  test("allows creating multiple barbers without login email", async ({ request }) => {
    await loginAdminRequest(request);

    const createPayload = (name: string) => ({
      name,
      specialty: "Teste",
      bio: "",
      avatar: null,
      email: "",
      color: "#F97316",
      serviceIds: [],
    });

    const firstResponse = await request.post("/api/barbers", {
      data: createPayload(`Sem Email A ${Date.now()}`),
    });
    expect(firstResponse.status()).toBe(201);
    expect((await firstResponse.json()).email).toBeNull();

    const secondResponse = await request.post("/api/barbers", {
      data: createPayload(`Sem Email B ${Date.now()}`),
    });
    expect(secondResponse.status()).toBe(201);
    expect((await secondResponse.json()).email).toBeNull();
  });

  test("rejects creating barbers without required profile fields", async ({ request }) => {
    await loginAdminRequest(request);

    const response = await request.post("/api/barbers", {
      data: {
        name: "   ",
        specialty: "",
        bio: "",
        avatar: null,
        email: "",
        color: "#F97316",
        serviceIds: [],
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("Indique");
  });

  test("records admin actions in the audit log", async ({ request }) => {
    await loginAdminRequest(request);

    const blacklistResponse = await request.post("/api/admin/blacklist", {
      data: { phone: "912695708", reason: "E2E audit log" },
    });
    expect(blacklistResponse.ok()).toBe(true);

    const auditResponse = await request.get("/api/admin/audit-logs?limit=10");
    expect(auditResponse.ok()).toBe(true);
    const logs = await auditResponse.json();

    expect(logs.some((log: any) =>
      log.action === "customer.blocked" &&
      String(log.summary).includes("912695708"),
    )).toBe(true);
  });

  test("blocks a blacklisted Portuguese phone even with another country prefix", async ({ request }) => {
    await loginAdminRequest(request);

    const blacklistResponse = await request.post("/api/admin/blacklist", {
      data: { phone: "912695703", reason: "E2E guard" },
    });
    expect(blacklistResponse.ok()).toBe(true);

    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();

    const createResponse = await request.post("/api/appointments", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: "2026-06-11T16:30:00.000Z",
        customerName: "QA Blacklist",
        customerPhone: "+34912695703",
        customerEmail: "qa-blacklist@example.com",
      },
    });

    expect(createResponse.status()).toBe(403);
    const createBody = await createResponse.json();
    expect(createBody.message).toContain("Não é possível realizar a marcação online");
  });

  test("preserves Portuguese country code when storing customer phone", async ({ request }) => {
    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();
    const createResponse = await request.post("/api/appointments", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: futureThursdayIso(8, 16, 30),
        customerName: "QA Indicativo",
        customerPhone: "+351912695704",
        customerEmail: "qa-indicativo@example.com",
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBe(true);

    const createdAppointment = await createResponse.json();
    expect(createdAppointment.customerPhone).toBe("+351912695704");
  });

  test("asks before cancelling future appointments when blocking a customer", async ({ request }) => {
    await loginAdminRequest(request);
    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();
    const startTime = futureThursdayIso(9, 11, 30);
    const createResponse = await request.post("/api/appointments", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime,
        customerName: "QA Blacklist Futuro",
        customerPhone: "+351912695740",
        customerEmail: "qa-blacklist-futuro@example.com",
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBe(true);

    const blockResponse = await request.post("/api/admin/blacklist", {
      data: {
        phone: "912695740",
        email: "qa-blacklist-futuro@example.com",
        reason: "Teste com marcacao futura",
      },
    });
    expect(blockResponse.status()).toBe(409);
    const blockBody = await blockResponse.json();
    expect(blockBody.code).toBe("CUSTOMER_HAS_FUTURE_APPOINTMENTS");
    expect(blockBody.futureAppointments).toHaveLength(1);
  });

  test("keeps future appointments when blocking customer without cancelling", async ({ request }) => {
    await loginAdminRequest(request);
    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();
    const startTime = futureThursdayIso(10, 16, 30);
    const createResponse = await request.post("/api/appointments", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime,
        customerName: "QA Blacklist Manter",
        customerPhone: "+351912695741",
        customerEmail: "qa-blacklist-manter@example.com",
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    const appointment = await createResponse.json();

    const blockResponse = await request.post("/api/admin/blacklist", {
      data: {
        phone: "912695741",
        email: "qa-blacklist-manter@example.com",
        reason: "Teste manter marcacao futura",
        cancelFutureAppointments: false,
      },
    });
    expect(blockResponse.ok(), await blockResponse.text()).toBe(true);
    const blockBody = await blockResponse.json();
    expect(blockBody.cancelledAppointments).toHaveLength(0);

    const appointmentsResponse = await request.get(`/api/appointments?date=${dateKeyFromIso(startTime)}`);
    expect(appointmentsResponse.ok()).toBe(true);
    const appointments = await appointmentsResponse.json();
    expect(appointments.find((item: any) => item.id === appointment.id)?.status).toBe("booked");
  });

  test("cancels future appointments when blocking customer with cancellation", async ({ request }) => {
    await loginAdminRequest(request);
    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();
    const startTime = futureThursdayIso(11, 14, 30);
    const createResponse = await request.post("/api/appointments", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime,
        customerName: "QA Blacklist Cancelar",
        customerPhone: "+351912695752",
        customerEmail: "qa-blacklist-cancelar@example.com",
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    const appointment = await createResponse.json();

    const blockResponse = await request.post("/api/admin/blacklist", {
      data: {
        phone: "912695752",
        email: "qa-blacklist-cancelar@example.com",
        reason: "Teste cancelar marcacao futura",
        cancelFutureAppointments: true,
      },
    });
    expect(blockResponse.ok(), await blockResponse.text()).toBe(true);
    const blockBody = await blockResponse.json();
    expect(blockBody.cancelledAppointments).toHaveLength(1);

    const appointmentsResponse = await request.get(`/api/appointments?date=${dateKeyFromIso(startTime)}`);
    expect(appointmentsResponse.ok()).toBe(true);
    const appointments = await appointmentsResponse.json();
    expect(appointments.find((item: any) => item.id === appointment.id)?.status).toBe("cancelled");
  });

  test("supports the full public booking reschedule and cancellation lifecycle", async ({ request }) => {
    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();
    const uniqueWeeksAhead = 18 + (Math.floor(Date.now() / 1000) % 10);
    const originalStart = futureThursdayIso(uniqueWeeksAhead, 10, 0);
    const rescheduledStart = futureWeekdayIso(1, uniqueWeeksAhead, 11, 0);

    const createResponse = await request.post("/api/appointments", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: originalStart,
        customerName: "Fluxo Completo QA",
        customerPhone: "912695753",
        customerEmail: "fluxo-completo@example.com",
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    const appointment = await createResponse.json();
    expect(appointment.cancelToken).toBeTruthy();

    const tokenDetailsResponse = await request.get(`/api/appointments/token/${appointment.cancelToken}`);
    expect(tokenDetailsResponse.ok(), await tokenDetailsResponse.text()).toBe(true);
    expect((await tokenDetailsResponse.json()).status).toBe("booked");

    const duplicateResponse = await request.post("/api/appointments", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: originalStart,
        customerName: "Duplicado QA",
        customerPhone: "912695754",
        customerEmail: null,
      },
    });
    expect(duplicateResponse.status()).toBe(409);

    const rescheduleResponse = await request.post(`/api/appointments/reschedule/${appointment.cancelToken}`, {
      data: { startTime: rescheduledStart },
    });
    expect(rescheduleResponse.ok(), await rescheduleResponse.text()).toBe(true);
    expect(new Date((await rescheduleResponse.json()).startTime).getTime()).toBe(new Date(rescheduledStart).getTime());

    const oldDateAppointmentsResponse = await request.get(
      `/api/appointments/public?barberId=${barber.id}&date=${dateKeyFromIso(originalStart)}`,
    );
    expect(oldDateAppointmentsResponse.ok()).toBe(true);
    expect((await oldDateAppointmentsResponse.json()).some((item: any) => item.id === appointment.id)).toBe(false);

    const newDateAppointmentsResponse = await request.get(
      `/api/appointments/public?barberId=${barber.id}&date=${dateKeyFromIso(rescheduledStart)}`,
    );
    expect(newDateAppointmentsResponse.ok()).toBe(true);
    expect((await newDateAppointmentsResponse.json()).some((item: any) => item.id === appointment.id)).toBe(true);

    const invalidRescheduleResponse = await request.post(`/api/appointments/reschedule/${appointment.cancelToken}`, {
      data: { startTime: "not-a-date" },
    });
    expect(invalidRescheduleResponse.status()).toBe(400);

    const outsideScheduleResponse = await request.post(`/api/appointments/reschedule/${appointment.cancelToken}`, {
      data: { startTime: futureWeekdayIso(1, uniqueWeeksAhead, 6, 0) },
    });
    expect(outsideScheduleResponse.status()).toBe(400);

    const cancelResponse = await request.post(`/api/appointments/cancel/${appointment.cancelToken}`);
    expect(cancelResponse.ok(), await cancelResponse.text()).toBe(true);
    expect(["cancelled", "late_cancelled"]).toContain((await cancelResponse.json()).status);

    const repeatedCancelResponse = await request.post(`/api/appointments/cancel/${appointment.cancelToken}`);
    expect(repeatedCancelResponse.ok(), await repeatedCancelResponse.text()).toBe(true);
    expect((await repeatedCancelResponse.json()).alreadyCancelled).toBe(true);

    const cancelledRescheduleResponse = await request.post(`/api/appointments/reschedule/${appointment.cancelToken}`, {
      data: { startTime: futureWeekdayIso(1, uniqueWeeksAhead, 13, 0) },
    });
    expect(cancelledRescheduleResponse.status()).toBe(409);

    const publicAfterCancelResponse = await request.get(
      `/api/appointments/public?barberId=${barber.id}&date=${dateKeyFromIso(rescheduledStart)}`,
    );
    expect(publicAfterCancelResponse.ok()).toBe(true);
    expect((await publicAfterCancelResponse.json()).some((item: any) => item.id === appointment.id)).toBe(false);
  });

  test("assigns no-preference bookings to the least busy available barber", async ({ request }) => {
    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const barbers = await barbersResponse.json();
    const [service] = await servicesResponse.json();
    expect(barbers.length).toBeGreaterThanOrEqual(2);
    expect(service).toBeTruthy();

    const busyBarber = barbers[0];
    const lessBusyBarber = barbers[1];
    const uniqueWeeksAhead = 16 + (Math.floor(Date.now() / 1000) % 20);

    const existingBookingResponse = await request.post("/api/appointments", {
      data: {
        barberId: busyBarber.id,
        serviceId: service.id,
        startTime: futureThursdayIso(uniqueWeeksAhead, 10, 0),
        customerName: "Carga Existente QA",
        customerPhone: "912695735",
        customerEmail: null,
      },
    });
    expect(existingBookingResponse.ok(), await existingBookingResponse.text()).toBe(true);

    const noPreferenceResponse = await request.post("/api/appointments", {
      data: {
        barberId: 0,
        serviceId: service.id,
        startTime: futureThursdayIso(uniqueWeeksAhead, 15, 0),
        customerName: "Sem Preferencia QA",
        customerPhone: "912695736",
        customerEmail: null,
      },
    });
    expect(noPreferenceResponse.ok(), await noPreferenceResponse.text()).toBe(true);
    const noPreferenceBooking = await noPreferenceResponse.json();

    expect(noPreferenceBooking.barberId).toBe(lessBusyBarber.id);
  });

  test("explains the failed time when a recurring manual booking is outside the schedule", async ({ request }) => {
    await loginAdminRequest(request);

    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();

    const response = await request.post("/api/appointments/block", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: "2026-08-06T18:30:00.000Z",
        name: "Recorrente Fora Horario QA",
        phone: "912695737",
        isManualBooking: true,
        isRecurring: true,
        recurringWeeks: 1,
        recurringMonths: 1,
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("06/08/2026 19:30");
    expect(body.message).toContain("60 min");
  });

  test("keeps recurring manual booking hours across the Lisbon daylight saving change", async ({ request }) => {
    await loginAdminRequest(request);

    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();

    const response = await request.post("/api/appointments/block", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: "2026-09-24T13:00:00.000Z",
        name: "Recorrente Hora Verao QA",
        phone: "912695738",
        isManualBooking: true,
        isRecurring: true,
        recurringWeeks: 1,
        recurringMonths: 2,
      },
    });

    expect(response.ok(), await response.text()).toBe(true);

    const appointmentsResponse = await request.get(`/api/appointments?barberId=${barber.id}&date=2026-10-29`);
    expect(appointmentsResponse.ok()).toBe(true);
    const appointments = await appointmentsResponse.json();
    const daylightSavingAppointment = appointments.find((appointment: any) =>
      appointment.customerName === "Recorrente Hora Verao QA",
    );
    expect(daylightSavingAppointment).toBeTruthy();

    const parts = lisbonDateTimeParts(daylightSavingAppointment.startTime);
    expect(`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`).toBe("2026-10-29 14:00");
  });

  test("keeps recurring manual booking hours when Lisbon enters daylight saving time", async ({ request }) => {
    await loginAdminRequest(request);

    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();

    const response = await request.post("/api/appointments/block", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: "2027-03-18T14:00:00.000Z",
        name: "Recorrente Hora Inverno QA",
        phone: "912695739",
        isManualBooking: true,
        isRecurring: true,
        recurringWeeks: 1,
        recurringMonths: 1,
      },
    });

    expect(response.ok(), await response.text()).toBe(true);

    const appointmentsResponse = await request.get(`/api/appointments?barberId=${barber.id}&date=2027-04-01`);
    expect(appointmentsResponse.ok()).toBe(true);
    const appointments = await appointmentsResponse.json();
    const daylightSavingAppointment = appointments.find((appointment: any) =>
      appointment.customerName === "Recorrente Hora Inverno QA",
    );
    expect(daylightSavingAppointment).toBeTruthy();

    const parts = lisbonDateTimeParts(daylightSavingAppointment.startTime);
    expect(`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`).toBe("2027-04-01 14:00");
  });

  test("allows only one concurrent booking for the same barber and slot", async ({ request }) => {
    const [barbersResponse, servicesResponse] = await Promise.all([
      request.get("/api/barbers"),
      request.get("/api/services"),
    ]);
    expect(barbersResponse.ok()).toBe(true);
    expect(servicesResponse.ok()).toBe(true);

    const [barber] = await barbersResponse.json();
    const [service] = await servicesResponse.json();
    const uniqueWeeksAhead = 12 + (Math.floor(Date.now() / 1000) % 20);
    const startTime = futureThursdayIso(uniqueWeeksAhead, 15, 0);

    const bookingPayload = {
      barberId: barber.id,
      serviceId: service.id,
      startTime,
      customerEmail: null,
    };

    const responses = await Promise.all([
      request.post("/api/appointments", {
        data: {
          ...bookingPayload,
          customerName: "Concorrente A",
          customerPhone: "912695731",
        },
      }),
      request.post("/api/appointments", {
        data: {
          ...bookingPayload,
          customerName: "Concorrente B",
          customerPhone: "912695732",
        },
      }),
    ]);

    const statuses = responses.map((response) => response.status()).sort();
    expect(statuses).toEqual([201, 409]);
  });

  test("marks overlapping slots unavailable using the existing appointment duration", () => {
    const selectedDate = new Date(2026, 5, 11);
    const slots = getAvailableTimeSlots({
      selectedService: { id: 1, duration: 30 },
      selectedDate,
      selectedBarberId: 1,
      visibleBarbers: [{ id: 1, serviceIds: [] }],
      availabilityRows: [],
      shopAvailabilityRows: [
        { dayOfWeek: 4, startTime: "09:00", endTime: "13:00", isOpen: true },
      ],
      existingAppointments: [
        {
          id: 1,
          barberId: 1,
          serviceId: 2,
          startTime: new Date(2026, 5, 11, 9, 0).toISOString(),
          duration: 50,
        },
      ],
      now: new Date(2026, 5, 10, 12, 0),
    });

    const byTime = new Map(slots.map((slot) => [slot.time, slot.available]));
    expect(byTime.get("09:00")).toBe(false);
    expect(byTime.get("09:30")).toBe(false);
    expect(byTime.get("10:00")).toBe(true);
  });
});
