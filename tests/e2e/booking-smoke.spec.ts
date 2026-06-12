import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
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

async function createManualAppointmentForCurrentWeek(request: APIRequestContext) {
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
      startTime: currentWeekThursdayIso(10, 0),
      name: "Agenda Click QA",
      phone: "912695705",
      isManualBooking: true,
    },
  });
  expect(createResponse.ok()).toBe(true);
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

  test("shows inline validation in the customer details step", async ({ page }) => {
    await page.goto("/book?barberId=1&serviceId=1&date=2026-06-11&time=15:30");

    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Indique o nome para a marcação.")).toBeVisible();
    await expect(page.getByText("Indique o telemóvel para confirmarmos a marcação.")).toBeVisible();

    await page.getByPlaceholder("O seu nome").fill("Pedro Faria");
    await page.getByPlaceholder("912 345 678").fill("123");
    await page.getByPlaceholder("exemplo@email.com").fill("email-invalido");

    await expect(page.getByText("Indique o nome para a marcação.")).not.toBeVisible();
    await expect(page.getByText(/Confirme que o número tem 9 dígitos/)).toBeVisible();
    await expect(page.getByText("Indique um email válido ou deixe o campo vazio.")).toBeVisible();

    await page.getByPlaceholder("912 345 678").fill("912695704");
    await page.getByPlaceholder("exemplo@email.com").fill("");

    await expect(page.getByText(/Confirme que o número tem 9 dígitos/)).not.toBeVisible();
    await expect(page.getByText("Indique um email válido ou deixe o campo vazio.")).not.toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("admin navigation", () => {
  test("shows agenda only in Agenda and appointment list only in Marcações", async ({ page, request }) => {
    await createManualAppointmentForCurrentWeek(request);

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);

    await page.getByRole("tab", { name: "Agenda" }).click();
    await expect(page.getByText("Agenda semanal")).toBeVisible();
    await expect(page.getByText("Agenda do dia")).not.toBeVisible();
    await expect(page.getByText("Lista de marcações")).not.toBeVisible();
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
      await expectNoHorizontalOverflow(page);
    }
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

    const groupedSlot = page.getByRole("button", { name: "Ver 3 marcações às 11:00" });
    await expect(groupedSlot).toBeVisible();
    await expect(page.getByText("Grupo Agenda 1")).not.toBeVisible();

    await groupedSlot.click();
    const groupedDialog = page.getByRole("dialog");
    await expect(groupedDialog.getByRole("heading", { name: "3 marcações às 11:00" })).toBeVisible();
    await expect(groupedDialog.getByText("Grupo Agenda 1")).toBeVisible();
    await expect(groupedDialog.getByText("Grupo Agenda 2")).toBeVisible();
    await expect(groupedDialog.getByText("Grupo Agenda 3")).toBeVisible();
    await page.keyboard.press("Escape");
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByText("11:00 · 3 marcações").first()).toBeVisible();
    await expect(page.getByText("Grupo Agenda 1")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("booking rules", () => {
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
