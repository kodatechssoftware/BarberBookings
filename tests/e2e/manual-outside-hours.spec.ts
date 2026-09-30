import { expect, test, type APIRequestContext } from "@playwright/test";
import ExcelJS from "exceljs";

const adminPassword = "Playwright-Test-Admin-2026!";

function futureThursdayIso(weeksAhead: number, hour: number, minute = 0) {
  const date = new Date();
  const currentDay = date.getDay();
  const daysUntilThursday = (4 - currentDay + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilThursday + weeksAhead * 7);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function dateKey(iso: string) {
  const date = new Date(iso);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getHeaderRow(sheet: ExcelJS.Worksheet, firstHeader: string) {
  let headerRow: ExcelJS.Row | undefined;
  sheet.eachRow((row) => {
    if (!headerRow && row.getCell(1).value === firstHeader) headerRow = row;
  });
  if (!headerRow) throw new Error(`Header ${firstHeader} not found in ${sheet.name}`);
  return headerRow;
}

const standardShopHours = () => Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  startTime: "09:00",
  endTime: "20:00",
  isOpen: true,
}));

const standardBarberHours = () => Array.from({ length: 7 }, (_, dayOfWeek) => [
  { dayOfWeek, startTime: "10:00", endTime: "12:00", isWorking: true },
  { dayOfWeek, startTime: "14:00", endTime: "18:00", isWorking: true },
]).flat();

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: adminPassword },
  });
  expect(response.status(), await response.text()).toBe(200);
}

test.describe.serial("manual outside-hours appointment terms", () => {
  let barber: any;
  let service: any;
  let originalShopAvailability: any[] = [];
  const createdAppointmentIds: number[] = [];

  async function listAppointment(request: APIRequestContext, name: string, startTime: string) {
    const response = await request.get(
      `/api/appointments?barberId=${barber.id}&date=${dateKey(startTime)}`,
    );
    expect(response.status(), await response.text()).toBe(200);
    const appointment = (await response.json()).find((item: any) => item.customerName === name);
    expect(appointment, `appointment ${name}`).toBeTruthy();
    if (!createdAppointmentIds.includes(appointment.id)) createdAppointmentIds.push(appointment.id);
    return appointment;
  }

  async function createManual(
    request: APIRequestContext,
    name: string,
    startTime: string,
    extra: Record<string, unknown> = {},
  ) {
    const response = await request.post("/api/appointments/block", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        serviceMode: "existing",
        startTime,
        name,
        phone: "+351912600001",
        customerEmail: `${name.replace(/[^a-z0-9]/gi, "").toLowerCase()}@example.test`,
        isManualBooking: true,
        isRecurring: false,
        ...extra,
      },
    });
    return response;
  }

  test.beforeAll(async ({ request }) => {
    await loginAdmin(request);
    const shopResponse = await request.get("/api/shop/availability");
    expect(shopResponse.status(), await shopResponse.text()).toBe(200);
    originalShopAvailability = await shopResponse.json();
    const shopPatch = await request.patch("/api/shop/availability", { data: standardShopHours() });
    expect(shopPatch.status(), await shopPatch.text()).toBe(200);

    const suffix = Date.now();
    const serviceResponse = await request.post("/api/services", {
      data: {
        name: `Corte snapshot QA ${suffix}`,
        description: "Serviço isolado para termos extraordinários",
        price: 1500,
        duration: 60,
        isVisible: true,
      },
    });
    expect(serviceResponse.status(), await serviceResponse.text()).toBe(201);
    service = await serviceResponse.json();

    const barberResponse = await request.post("/api/barbers", {
      data: {
        name: `Barbeiro extraordinário QA ${suffix}`,
        specialty: "Testes de horários extraordinários",
        isVisible: true,
        serviceIds: [service.id],
        compensationModel: "commission",
        commissionPercent: 40,
      },
    });
    expect(barberResponse.status(), await barberResponse.text()).toBe(201);
    barber = await barberResponse.json();
    const hoursResponse = await request.patch(`/api/barbers/${barber.id}/availability`, {
      data: standardBarberHours(),
    });
    expect(hoursResponse.status(), await hoursResponse.text()).toBe(200);
  });

  test.beforeEach(async ({ request }) => {
    await loginAdmin(request);
  });

  test.afterAll(async ({ request }) => {
    await loginAdmin(request);
    for (const id of createdAppointmentIds) {
      await request.patch(`/api/appointments/${id}/status`, { data: { status: "cancelled" } });
    }
    if (barber?.id) await request.patch(`/api/barbers/${barber.id}`, { data: { isVisible: false } });
    if (service?.id) await request.patch(`/api/services/${service.id}`, { data: { isVisible: false } });
    if (originalShopAvailability.length > 0) {
      await request.patch("/api/shop/availability", { data: originalShopAvailability });
    }
  });

  test("stores normal and extraordinary terms from the authoritative server context", async ({ request }) => {
    const normalStart = futureThursdayIso(210, 10);
    const normalName = `Normal snapshot ${Date.now()}`;
    const normalResponse = await createManual(request, normalName, normalStart);
    expect(normalResponse.status(), await normalResponse.text()).toBe(201);
    const normal = await listAppointment(request, normalName, normalStart);
    expect(normal).toMatchObject({
      serviceId: service.id,
      serviceNameSnapshot: service.name,
      servicePriceCentsSnapshot: 1500,
      durationMinutes: 60,
      manualOutsideHours: false,
    });

    const outsideStart = futureThursdayIso(211, 6);
    const outsideName = `Existing override ${Date.now()}`;
    const outsideResponse = await createManual(request, outsideName, outsideStart, {
      allowOutsideHours: true,
      servicePriceCents: 2500,
    });
    expect(outsideResponse.status(), await outsideResponse.text()).toBe(201);
    const outside = await listAppointment(request, outsideName, outsideStart);
    expect(outside).toMatchObject({
      serviceId: service.id,
      serviceNameSnapshot: service.name,
      servicePriceCentsSnapshot: 2500,
      durationMinutes: 60,
      manualOutsideHours: true,
    });

    const defaultOutsideStart = futureThursdayIso(212, 6);
    const defaultOutsideName = `Existing base price ${Date.now()}`;
    const defaultOutsideResponse = await createManual(request, defaultOutsideName, defaultOutsideStart, {
      allowOutsideHours: true,
    });
    expect(defaultOutsideResponse.status(), await defaultOutsideResponse.text()).toBe(201);
    const defaultOutside = await listAppointment(request, defaultOutsideName, defaultOutsideStart);
    expect(defaultOutside.servicePriceCentsSnapshot).toBe(1500);
    expect(defaultOutside.manualOutsideHours).toBe(true);

    const customStart = futureThursdayIso(213, 6);
    const customName = `Custom casamento ${Date.now()}`;
    const customResponse = await createManual(request, customName, customStart, {
      serviceId: null,
      serviceMode: "custom",
      customServiceName: "Lavar e pentear – casamento",
      customDurationMinutes: 45,
      servicePriceCents: 3000,
      allowOutsideHours: true,
    });
    expect(customResponse.status(), await customResponse.text()).toBe(201);
    const custom = await listAppointment(request, customName, customStart);
    expect(custom).toMatchObject({
      serviceId: null,
      serviceNameSnapshot: "Lavar e pentear – casamento",
      servicePriceCentsSnapshot: 3000,
      durationMinutes: 45,
      manualOutsideHours: true,
    });
    const auditResponse = await request.get("/api/admin/audit-logs?limit=100");
    expect(auditResponse.status(), await auditResponse.text()).toBe(200);
    const customAudit = (await auditResponse.json()).find((log: any) =>
      log.action === "appointment.created_manual" && log.entityId === custom.id,
    );
    expect(customAudit).toBeTruthy();
    const auditPayload = JSON.stringify(customAudit);
    expect(auditPayload).not.toContain("Lavar e pentear");
    expect(auditPayload).not.toContain(customName);
    expect(auditPayload).not.toContain("+351912600001");
    expect(auditPayload).not.toContain("3000");

    const freeStart = futureThursdayIso(214, 7);
    const freeName = `Custom zero ${Date.now()}`;
    const freeResponse = await createManual(request, freeName, freeStart, {
      serviceId: null,
      serviceMode: "custom",
      customServiceName: "Corte oferta extraordinária",
      customDurationMinutes: 30,
      servicePriceCents: 0,
      allowOutsideHours: true,
    });
    expect(freeResponse.status(), await freeResponse.text()).toBe(201);
    expect(await listAppointment(request, freeName, freeStart)).toMatchObject({
      serviceId: null,
      servicePriceCentsSnapshot: 0,
      manualOutsideHours: true,
    });
  });

  test("rejects fake exception privileges, partial schedule overlaps and recurring specials", async ({ request }) => {
    const insideStart = futureThursdayIso(215, 10);
    const customInside = await createManual(request, `Custom inside ${Date.now()}`, insideStart, {
      serviceId: null,
      serviceMode: "custom",
      customServiceName: "Não permitido",
      customDurationMinutes: 30,
      servicePriceCents: 1000,
      allowOutsideHours: true,
    });
    expect(customInside.status()).toBe(400);
    expect(await customInside.text()).toMatch(/realmente fora do horário/i);

    const priceInside = await createManual(request, `Price inside ${Date.now()}`, futureThursdayIso(216, 14), {
      servicePriceCents: 2200,
      allowOutsideHours: true,
    });
    expect(priceInside.status()).toBe(400);

    const publicOutside = await request.post("/api/appointments", {
      data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: futureThursdayIso(216, 6),
        customerName: `Public bypass ${Date.now()}`,
        customerPhone: "+351912600099",
        customerEmail: null,
        allowOutsideHours: true,
        customServiceName: "Não autorizado",
        servicePriceCents: 1,
      },
    });
    expect(publicOutside.status()).toBe(400);

    const barberOnlyOutside = futureThursdayIso(216, 9);
    expect((await createManual(request, `Before barber ${Date.now()}`, barberOnlyOutside)).status()).toBe(400);
    const barberOnlyAcceptedName = `Before barber accepted ${Date.now()}`;
    expect((await createManual(request, barberOnlyAcceptedName, barberOnlyOutside, {
      allowOutsideHours: true,
    })).status()).toBe(201);
    expect((await listAppointment(request, barberOnlyAcceptedName, barberOnlyOutside)).manualOutsideHours).toBe(true);

    const pauseStart = futureThursdayIso(216, 13);
    expect((await createManual(request, `Pause rejected ${Date.now()}`, pauseStart)).status()).toBe(400);
    const pauseAcceptedName = `Pause accepted ${Date.now()}`;
    expect((await createManual(request, pauseAcceptedName, pauseStart, {
      allowOutsideHours: true,
    })).status()).toBe(201);
    expect((await listAppointment(request, pauseAcceptedName, pauseStart)).manualOutsideHours).toBe(true);

    const closedDayHours = standardShopHours().map((row) => row.dayOfWeek === 4
      ? { ...row, isOpen: false }
      : row);
    const closeThursday = await request.patch("/api/shop/availability", { data: closedDayHours });
    expect(closeThursday.status(), await closeThursday.text()).toBe(200);
    try {
      const closedStart = futureThursdayIso(232, 10);
      expect((await createManual(request, `Closed day rejected ${Date.now()}`, closedStart)).status()).toBe(400);
      const closedAcceptedName = `Closed day accepted ${Date.now()}`;
      expect((await createManual(request, closedAcceptedName, closedStart, {
        allowOutsideHours: true,
      })).status()).toBe(201);
      expect((await listAppointment(request, closedAcceptedName, closedStart)).manualOutsideHours).toBe(true);
    } finally {
      const reopen = await request.patch("/api/shop/availability", { data: standardShopHours() });
      expect(reopen.status(), await reopen.text()).toBe(200);
    }

    for (const [weeks, hour, minute] of [[217, 11, 30], [218, 17, 30]] as const) {
      const startTime = futureThursdayIso(weeks, hour, minute);
      const rejected = await createManual(request, `Partial outside ${weeks}`, startTime);
      expect(rejected.status()).toBe(400);
      expect(await rejected.text()).toMatch(/horário|não está disponível/i);
      const accepted = await createManual(request, `Partial outside accepted ${weeks}`, startTime, {
        allowOutsideHours: true,
      });
      expect(accepted.status(), await accepted.text()).toBe(201);
      expect((await listAppointment(request, `Partial outside accepted ${weeks}`, startTime)).manualOutsideHours).toBe(true);
    }

    const customRecurring = await createManual(request, `Custom recurring ${Date.now()}`, futureThursdayIso(219, 6), {
      serviceId: null,
      serviceMode: "custom",
      customServiceName: "Recorrente custom",
      customDurationMinutes: 30,
      servicePriceCents: 1000,
      allowOutsideHours: true,
      isRecurring: true,
      recurringWeeks: 1,
      recurringMonths: 1,
    });
    expect(customRecurring.status()).toBe(400);
    expect(await customRecurring.text()).toMatch(/recorrente/i);

    const pricedRecurring = await createManual(request, `Priced recurring ${Date.now()}`, futureThursdayIso(220, 6), {
      servicePriceCents: 2200,
      allowOutsideHours: true,
      isRecurring: true,
      recurringWeeks: 1,
      recurringMonths: 1,
    });
    expect(pricedRecurring.status()).toBe(400);
    expect(await pricedRecurring.text()).toMatch(/recorrente/i);

    const overlapStart = futureThursdayIso(231, 6);
    const overlapBaseName = `Custom overlap base ${Date.now()}`;
    expect((await createManual(request, overlapBaseName, overlapStart, {
      serviceId: null,
      serviceMode: "custom",
      customServiceName: "Serviço base",
      customDurationMinutes: 45,
      servicePriceCents: 1000,
      allowOutsideHours: true,
    })).status()).toBe(201);
    await listAppointment(request, overlapBaseName, overlapStart);
    const overlapByDuration = await createManual(
      request,
      `Custom overlap rejected ${Date.now()}`,
      futureThursdayIso(231, 5, 30),
      {
        serviceId: null,
        serviceMode: "custom",
        customServiceName: "Serviço sobreposto",
        customDurationMinutes: 60,
        servicePriceCents: 1000,
        allowOutsideHours: true,
      },
    );
    expect(overlapByDuration.status()).toBe(409);
  });

  test("preserves safe edit and reschedule transitions", async ({ request }) => {
    const start = futureThursdayIso(221, 6);
    const name = `Edit existing ${Date.now()}`;
    expect((await createManual(request, name, start, {
      allowOutsideHours: true,
      servicePriceCents: 2500,
    })).status()).toBe(201);
    let appointment = await listAppointment(request, name, start);
    const initialRevision = appointment.notificationRevision;

    const priceOnly = await request.patch(`/api/appointments/${appointment.id}`, {
      data: { servicePriceCents: 2700 },
    });
    expect(priceOnly.status(), await priceOnly.text()).toBe(200);
    appointment = await priceOnly.json();
    expect(appointment.servicePriceCentsSnapshot).toBe(2700);
    expect(appointment.notificationRevision).toBe(initialRevision);

    const outsideToOutside = futureThursdayIso(222, 7);
    const rescheduleOutside = await request.patch(`/api/appointments/${appointment.id}`, {
      data: { startTime: outsideToOutside },
    });
    expect(rescheduleOutside.status(), await rescheduleOutside.text()).toBe(200);
    expect(await rescheduleOutside.json()).toMatchObject({
      servicePriceCentsSnapshot: 2700,
      manualOutsideHours: true,
    });

    const normalStart = futureThursdayIso(223, 10);
    const outsideToNormal = await request.patch(`/api/appointments/${appointment.id}`, {
      data: { startTime: normalStart },
    });
    expect(outsideToNormal.status(), await outsideToNormal.text()).toBe(200);
    expect(await outsideToNormal.json()).toMatchObject({
      serviceNameSnapshot: service.name,
      servicePriceCentsSnapshot: 1500,
      durationMinutes: 60,
      manualOutsideHours: false,
    });

    const normalToOutside = await request.patch(`/api/appointments/${appointment.id}`, {
      data: { startTime: futureThursdayIso(224, 6), allowOutsideHours: true },
    });
    expect(normalToOutside.status(), await normalToOutside.text()).toBe(200);
    expect((await normalToOutside.json()).manualOutsideHours).toBe(true);

    const customStart = futureThursdayIso(225, 6);
    const customCustomer = `Edit custom ${Date.now()}`;
    expect((await createManual(request, customCustomer, customStart, {
      serviceId: null,
      serviceMode: "custom",
      customServiceName: "Penteado inicial",
      customDurationMinutes: 45,
      servicePriceCents: 3000,
      allowOutsideHours: true,
    })).status()).toBe(201);
    const custom = await listAppointment(request, customCustomer, customStart);
    const customUpdate = await request.patch(`/api/appointments/${custom.id}`, {
      data: {
        serviceMode: "custom",
        customServiceName: "Penteado casamento atualizado",
        customDurationMinutes: 50,
        servicePriceCents: 3200,
      },
    });
    expect(customUpdate.status(), await customUpdate.text()).toBe(200);
    expect(await customUpdate.json()).toMatchObject({
      serviceNameSnapshot: "Penteado casamento atualizado",
      durationMinutes: 50,
      servicePriceCentsSnapshot: 3200,
      manualOutsideHours: true,
    });

    const customToNormalRejected = await request.patch(`/api/appointments/${custom.id}`, {
      data: { startTime: futureThursdayIso(226, 10) },
    });
    expect(customToNormalRejected.status()).toBe(400);
    expect(await customToNormalRejected.text()).toMatch(/converta.*serviço do catálogo/i);

    const customConverted = await request.patch(`/api/appointments/${custom.id}`, {
      data: {
        startTime: futureThursdayIso(226, 10),
        serviceMode: "existing",
        serviceId: service.id,
      },
    });
    expect(customConverted.status(), await customConverted.text()).toBe(200);
    expect(await customConverted.json()).toMatchObject({
      serviceId: service.id,
      serviceNameSnapshot: service.name,
      servicePriceCentsSnapshot: 1500,
      durationMinutes: 60,
      manualOutsideHours: false,
    });
  });

  test("blocks extraordinary self-service rescheduling but keeps cancellation available", async ({ request }) => {
    const start = futureThursdayIso(227, 6);
    const name = `Self service special ${Date.now()}`;
    expect((await createManual(request, name, start, {
      allowOutsideHours: true,
      servicePriceCents: 2500,
    })).status()).toBe(201);
    const appointment = await listAppointment(request, name, start);
    const details = await request.get(`/api/appointments/token/${appointment.cancelToken}`);
    expect(details.status(), await details.text()).toBe(200);
    expect(await details.json()).toMatchObject({
      serviceName: service.name,
      price: 2500,
      manualOutsideHours: true,
    });
    const reschedule = await request.post(`/api/appointments/reschedule/${appointment.cancelToken}`, {
      data: { startTime: futureThursdayIso(228, 6) },
    });
    expect(reschedule.status()).toBe(409);
    expect(await reschedule.json()).toMatchObject({
      code: "MANUAL_OUTSIDE_HOURS_RESCHEDULE_UNAVAILABLE",
      message: "Para reagendar esta marcação, contacte a barbearia.",
    });
    const cancellation = await request.post(`/api/appointments/cancel/${appointment.cancelToken}`);
    expect(cancellation.status(), await cancellation.text()).toBe(200);
  });

  test("uses final values in dashboard, customer history and Excel", async ({ request }) => {
    const start = futureThursdayIso(-2, 6);
    const customCustomer = `Finance custom ${Date.now()}`;
    expect((await createManual(request, customCustomer, start, {
      serviceId: null,
      serviceMode: "custom",
      customServiceName: "Lavar e pentear – casamento",
      customDurationMinutes: 45,
      servicePriceCents: 3000,
      allowOutsideHours: true,
    })).status()).toBe(201);
    const custom = await listAppointment(request, customCustomer, start);
    const completeCustom = await request.patch(`/api/appointments/${custom.id}/status`, {
      data: { status: "completed", paymentMethod: "cash" },
    });
    expect(completeCustom.status(), await completeCustom.text()).toBe(200);

    const existingStart = futureThursdayIso(-2, 7);
    const existingCustomer = `Finance existing ${Date.now()}`;
    expect((await createManual(request, existingCustomer, existingStart, {
      allowOutsideHours: true,
      servicePriceCents: 2500,
    })).status()).toBe(201);
    const existing = await listAppointment(request, existingCustomer, existingStart);
    const completeExisting = await request.patch(`/api/appointments/${existing.id}/status`, {
      data: { status: "completed", paymentMethod: "card" },
    });
    expect(completeExisting.status(), await completeExisting.text()).toBe(200);

    const bookedStart = futureThursdayIso(2, 8);
    const bookedCustomer = `Finance booked ${Date.now()}`;
    expect((await createManual(request, bookedCustomer, bookedStart, {
      allowOutsideHours: true,
      servicePriceCents: 4000,
    })).status()).toBe(201);
    const booked = await listAppointment(request, bookedCustomer, bookedStart);
    expect(booked.status).toBe("booked");

    const day = dateKey(start);
    const dashboardResponse = await request.get(
      `/api/admin/dashboard?startDate=${day}&endDate=${day}&barberId=${barber.id}`,
    );
    expect(dashboardResponse.status(), await dashboardResponse.text()).toBe(200);
    const dashboard = await dashboardResponse.json();
    expect(dashboard.summary.revenueCents).toBe(5500);
    expect(dashboard.summary.averageTicketCents).toBe(2750);
    expect(dashboard.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Lavar e pentear – casamento", revenueCents: 3000 }),
      expect.objectContaining({ name: service.name, revenueCents: 2500 }),
    ]));

    const historyResponse = await request.get(
      `/api/admin/customers/${encodeURIComponent(custom.customerPhone)}/history?name=${encodeURIComponent(customCustomer)}`,
    );
    expect(historyResponse.status(), await historyResponse.text()).toBe(200);
    expect((await historyResponse.json()).appointments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: custom.id,
        serviceName: "Lavar e pentear – casamento",
        servicePrice: 3000,
        durationMinutes: 45,
      }),
    ]));

    const exportResponse = await request.get(
      `/api/admin/export?startDate=${day}&endDate=${day}&barberId=${barber.id}`,
    );
    expect(exportResponse.status(), await exportResponse.text()).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exportResponse.body());
    const summary = workbook.getWorksheet("Resumo Financeiro");
    expect(summary).toBeTruthy();
    expect(summary!.getCell("A1").value).toBe("Resumo financeiro");
    expect(summary!.getCell("A5").value).toBe("Barbeiro");
    expect(summary!.getCell("B5").value).toBe(barber.name);
    const summaryValues = new Map<string, unknown>();
    summary!.eachRow((row) => summaryValues.set(String(row.getCell(1).value), row.getCell(2).value));
    expect(summaryValues.get("Receita de serviços concluídos")).toBe(55);
    expect(summaryValues.get("Recebimentos confirmados")).toBe(55);
    const detail = workbook.getWorksheet("Detalhe dos Movimentos");
    expect(detail).toBeTruthy();
    expect(detail!.getCell("A1").value).toBe("Detalhe dos movimentos");
    expect(detail!.getCell("D3").value).toBe("Barbeiro");
    expect(detail!.getCell("E3").value).toBe(barber.name);
    const detailHeaderRow = getHeaderRow(detail!, "Data do serviço");
    const headers = detailHeaderRow.values as unknown[];
    const appointmentIdColumn = headers.indexOf("ID da marcação");
    const serviceColumn = headers.indexOf("Serviço efetivo");
    const durationColumn = headers.indexOf("Duração (min)");
    const valueColumn = headers.indexOf("Valor final (€)");
    const statusColumn = headers.indexOf("Estado");
    const receivedColumn = headers.indexOf("Valor recebido (€)");
    const rows: Record<string, unknown>[] = [];
    detail!.eachRow((row, rowNumber) => {
      if (rowNumber <= detailHeaderRow.number) return;
      rows.push({
        appointmentId: row.getCell(appointmentIdColumn).value,
        service: row.getCell(serviceColumn).value,
        duration: row.getCell(durationColumn).value,
        value: row.getCell(valueColumn).value,
        status: row.getCell(statusColumn).value,
        received: row.getCell(receivedColumn).value,
      });
    });
    expect(rows).toEqual(expect.arrayContaining([
      { appointmentId: custom.id, service: "Lavar e pentear – casamento", duration: 45, value: 30, status: "Concluída", received: 30 },
      { appointmentId: existing.id, service: service.name, duration: 60, value: 25, status: "Concluída", received: 25 },
    ]));
    expect(JSON.stringify(detail!.getSheetValues())).not.toContain("Serviço desconhecido");

    const bookedDay = dateKey(bookedStart);
    const bookedExportResponse = await request.get(
      `/api/admin/export?startDate=${bookedDay}&endDate=${bookedDay}&barberId=${barber.id}`,
    );
    expect(bookedExportResponse.status(), await bookedExportResponse.text()).toBe(200);
    const bookedWorkbook = new ExcelJS.Workbook();
    await bookedWorkbook.xlsx.load(await bookedExportResponse.body());
    const bookedSummary = bookedWorkbook.getWorksheet("Resumo Financeiro")!;
    const bookedSummaryValues = new Map<string, unknown>();
    bookedSummary.eachRow((row) => bookedSummaryValues.set(String(row.getCell(1).value), row.getCell(2).value));
    expect(bookedSummaryValues.get("Receita de serviços concluídos")).toBe(0);
    expect(bookedSummaryValues.get("Recebimentos confirmados")).toBe(0);
    const bookedDetail = bookedWorkbook.getWorksheet("Detalhe dos Movimentos")!;
    const bookedHeaderRow = getHeaderRow(bookedDetail, "Data do serviço");
    const bookedHeaders = bookedHeaderRow.values as unknown[];
    const bookedIdColumn = bookedHeaders.indexOf("ID da marcação");
    const bookedStatusColumn = bookedHeaders.indexOf("Estado");
    const bookedValueColumn = bookedHeaders.indexOf("Valor final (€)");
    const bookedReceivedColumn = bookedHeaders.indexOf("Valor recebido (€)");
    let bookedRow: ExcelJS.Row | undefined;
    bookedDetail.eachRow((row, rowNumber) => {
      if (rowNumber > bookedHeaderRow.number && row.getCell(bookedIdColumn).value === booked.id) bookedRow = row;
    });
    expect(bookedRow).toBeTruthy();
    expect(bookedRow!.getCell(bookedStatusColumn).value).toBe("Marcada");
    expect(bookedRow!.getCell(bookedValueColumn).value).toBe(40);
    expect(bookedRow!.getCell(bookedReceivedColumn).value).toBe(0);

    const compensation = workbook.getWorksheet("Acertos com Barbeiros");
    expect(compensation).toBeTruthy();
    const compensationHeaderRow = getHeaderRow(compensation!, "Barbeiro");
    const compensationHeaders = compensationHeaderRow.values as unknown[];
    const barberColumn = compensationHeaders.indexOf("Barbeiro");
    const revenueColumn = compensationHeaders.findIndex((value) => String(value).startsWith("Base de acerto"));
    const commissionColumn = compensationHeaders.findIndex((value) => String(value).startsWith("Comissões do barbeiro"));
    const barberValueColumn = compensationHeaders.findIndex((value) => String(value).startsWith("Valor do barbeiro"));
    const shopValueColumn = compensationHeaders.findIndex((value) => String(value).startsWith("Valor da barbearia"));
    let compensationRow: ExcelJS.Row | undefined;
    compensation!.eachRow((row, rowNumber) => {
      if (rowNumber > compensationHeaderRow.number && row.getCell(barberColumn).value === barber.name) compensationRow = row;
    });
    expect(compensationRow).toBeTruthy();
    expect(compensationRow!.getCell(revenueColumn).value).toBe(55);
    expect(compensationRow!.getCell(commissionColumn).value).toBe(22);
    expect(compensationRow!.getCell(barberValueColumn).value).toBe(22);
    expect(compensationRow!.getCell(shopValueColumn).value).toBe(33);
  });

  test("shows the agreed custom terms and extraordinary marker in Admin", async ({ page, request }) => {
    const start = futureThursdayIso(230, 6);
    const customer = `Admin detail custom ${Date.now()}`;
    expect((await createManual(request, customer, start, {
      serviceId: null,
      serviceMode: "custom",
      customServiceName: "Produção editorial personalizada",
      customDurationMinutes: 45,
      servicePriceCents: 3000,
      allowOutsideHours: true,
    })).status()).toBe(201);
    await listAppointment(request, customer, start);

    await page.goto("/admin");
    await page.getByPlaceholder("Introduza o email ou nome de utilizador").fill("admin");
    await page.locator('input[type="password"]').fill(adminPassword);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.getByRole("tab", { name: "Marcações" }).click();
    await page.getByRole("button", { name: "Próximas" }).click();
    const appointmentRow = page.getByRole("button", { name: new RegExp(customer) });
    await expect(appointmentRow).toBeVisible();
    await expect(appointmentRow).toContainText("Produção editorial personalizada");
    await appointmentRow.click();
    const dialog = page.getByRole("dialog", { name: "Detalhes da marcação" });
    await expect(dialog.getByText("Produção editorial personalizada")).toBeVisible();
    await expect(dialog.getByText("Preço final: 30,00 €")).toBeVisible();
    await expect(dialog.getByText("Marcação fora do horário")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
