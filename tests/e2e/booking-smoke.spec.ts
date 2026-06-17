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
  const dateLabel = dateLabelFromIso(isoDate);
  const slotButton = page.getByRole("button", {
    name: `Criar marcação em ${dateLabel} às ${time}`,
  }).first();
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
    await page.goto("/book?barberId=1&serviceId=1&date=2026-06-30");

    await expect(page.getByText("junho 2026")).toBeVisible();

    await expect.poll(async () => page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>(".booking-day-available.day-outside"))
        .map((element) => Number(element.textContent?.trim()))
        .filter((day) => Number.isFinite(day));
    })).toEqual(expect.arrayContaining([1, 2, 3, 4]));
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
    await expect(page.getByText("Agenda semanal")).toBeVisible();
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
    const weeklyAppointment = page.getByRole("button", {
      name: /Abrir detalhes da marcação de Agenda Click QA/,
    }).first();
    await expect(weeklyAppointment).toBeVisible();
    await weeklyAppointment.press("Enter");
    const appointmentDialog = page.getByRole("dialog");
    await expect(appointmentDialog).toContainText("Detalhes da marcação");
    await expect(appointmentDialog.getByRole("heading", { name: "Agenda Click QA" })).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("button", { name: "Mostrar atividade recente" })).toBeVisible();
    await expect(page.getByText("appointment.created_manual")).not.toBeVisible();
    await page.getByRole("button", { name: "Mostrar atividade recente" }).click();
    await expect(page.getByText("Marcação manual criada").first()).toBeVisible();
    await expect(page.getByText("appointment.created_manual")).not.toBeVisible();

    await expectNoHorizontalOverflow(page);

    await page.getByRole("tab", { name: "Marcações" }).click();
    await expect(page.getByText("Lista de marcações")).toBeVisible();
    await expect(page.getByText("Agenda semanal")).not.toBeVisible();
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
      await expect(page.getByText("Agenda semanal")).not.toBeVisible();
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

  test("groups busy weekly slots with several barbers at the same time", async ({ page, request }) => {
    await createConcurrentManualAppointmentsForCurrentWeek(request);

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);

    const firstConcurrent = page.getByRole("button", {
      name: /Abrir detalhes da marcação de Grupo Agenda 1/,
    }).first();
    const secondConcurrent = page.getByRole("button", {
      name: /Abrir detalhes da marcação de Grupo Agenda 2/,
    }).first();
    const thirdConcurrent = page.getByRole("button", {
      name: /Abrir detalhes da marcação de Grupo Agenda 3/,
    }).first();

    await expect(firstConcurrent).toBeVisible();
    await expect(secondConcurrent).toBeVisible();
    await expect(thirdConcurrent).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver 3 marcações às 11:00" })).toHaveCount(0);

    await firstConcurrent.click();
    const appointmentDialog = page.getByRole("dialog");
    await expect(appointmentDialog.getByRole("heading", { name: "Grupo Agenda 1" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByText("11:00 · 3 marcações").first()).toBeVisible();
    await expect(page.getByText("Grupo Agenda 1").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
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
