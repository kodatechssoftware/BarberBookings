import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";

const adminPassword = "Playwright-Test-Admin-2026!";
const day = "2025-06-05";

function summaryValues(sheet: ExcelJS.Worksheet) {
  const values = new Map<string, unknown>();
  sheet.eachRow((row) => values.set(String(row.getCell(1).value), row.getCell(2).value));
  return values;
}

test("Beauty keeps global result separate from direct service margin", async ({ request }) => {
  test.setTimeout(90_000);
  const login = await request.post("/api/admin/login", {
    data: { username: "admin", password: adminPassword },
  });
  expect(login.ok(), await login.text()).toBe(true);

  const suffix = Date.now();
  const serviceResponse = await request.post("/api/services", { data: {
    name: `Serviço margem QA ${suffix}`,
    description: "Cenário financeiro Beauty",
    price: 2000,
    duration: 30,
    isVisible: true,
  } });
  expect(serviceResponse.status(), await serviceResponse.text()).toBe(201);
  const service = await serviceResponse.json();

  const professionalResponse = await request.post("/api/barbers", { data: {
    name: `Profissional margem QA ${suffix}`,
    specialty: "QA",
    isVisible: true,
    serviceIds: [service.id],
  } });
  expect(professionalResponse.status(), await professionalResponse.text()).toBe(201);
  const professional = await professionalResponse.json();

  const costResponse = await request.post("/api/admin/internal-costs", { data: {
    name: `Material QA ${suffix}`,
    description: "Consumo direto de teste",
    defaultUnitCostCents: 300,
    unitLabel: "dose",
  } });
  expect(costResponse.status(), await costResponse.text()).toBe(201);
  const cost = await costResponse.json();

  const appointmentResponse = await request.post("/api/appointments/block", { data: {
    barberId: professional.id,
    serviceId: service.id,
    serviceMode: "existing",
    startTime: `${day}T10:00:00.000Z`,
    name: `Cliente margem QA ${suffix}`,
    phone: "+351912650099",
    customerEmail: "margin.qa@example.test",
    isManualBooking: true,
    isRecurring: false,
    allowOutsideHours: true,
  } });
  expect(appointmentResponse.status(), await appointmentResponse.text()).toBe(201);
  const appointment = (await appointmentResponse.json()).appointments[0];

  const completionResponse = await request.post(`/api/appointments/${appointment.id}/complete`, { data: {
    expectedRevision: appointment.notificationRevision,
    paymentMethod: "cash",
    extras: [],
    internalCosts: [{ internalCostId: cost.id, quantity: 1 }],
  } });
  expect(completionResponse.ok(), await completionResponse.text()).toBe(true);

  const expenseResponse = await request.post("/api/admin/expenses", { data: {
    category: "materials",
    description: `Compra materiais QA ${suffix}`,
    amountCents: 10000,
    expenseDate: day,
    recurrence: "once",
    notes: "QA",
  } });
  expect(expenseResponse.status(), await expenseResponse.text()).toBe(201);
  const expense = await expenseResponse.json();

  const dashboardResponse = await request.get(`/api/admin/dashboard?startDate=${day}&endDate=${day}`);
  expect(dashboardResponse.ok(), await dashboardResponse.text()).toBe(true);
  expect((await dashboardResponse.json()).summary).toMatchObject({
    revenueCents: 2000,
    barberRevenueCents: 0,
    businessExpensesIncluded: true,
    businessExpensesCents: 10000,
    establishmentResultCents: -8000,
    nominalServiceRevenueCents: 2000,
    nominalExtrasRevenueCents: 0,
    directCostCents: 300,
    directMarginCents: 1700,
  });

  const runtime = await (await request.get("/api/runtime-config")).json();
  const workbookCopy = runtime.copy.admin.reports.workbook;
  const exportResponse = await request.get(`/api/admin/export?startDate=${day}&endDate=${day}`);
  expect(exportResponse.ok(), await exportResponse.text()).toBe(true);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportResponse.body());
  const summary = summaryValues(workbook.getWorksheet("Resumo Financeiro")!);
  expect(summary.get(workbookCopy.nominalServiceRevenue)).toBe(20);
  expect(summary.get(workbookCopy.commercialExtrasRevenue)).toBe(0);
  expect(summary.get(workbookCopy.nominalTotalRevenue)).toBe(20);
  expect(summary.get(workbookCopy.directCosts)).toBe(3);
  expect(summary.get(workbookCopy.directMargin)).toBe(17);
  expect(summary.get("Despesas registadas")).toBe(100);
  expect(summary.get(workbookCopy.establishmentResult)).toBe(-80);

  const movements = workbook.getWorksheet("Detalhe dos Movimentos")!;
  const header = movements.findRow(movements.getColumn(1).values.findIndex((value) => value === "Data do serviço"))!;
  const headers = header.values as unknown[];
  const directCostColumn = headers.indexOf(workbookCopy.directCosts);
  const directMarginColumn = headers.indexOf(workbookCopy.directMargin);
  const appointmentIdColumn = headers.indexOf("ID da marcação");
  let row: ExcelJS.Row | undefined;
  movements.eachRow((candidate, rowNumber) => {
    if (rowNumber > header.number && candidate.getCell(appointmentIdColumn).value === appointment.id) row = candidate;
  });
  expect(row?.getCell(directCostColumn).value).toBe(3);
  expect(row?.getCell(directMarginColumn).value).toBe(17);

  expect((await request.delete(`/api/admin/expenses/${expense.id}`)).ok()).toBe(true);
  await request.patch(`/api/barbers/${professional.id}`, { data: { isVisible: false } });
  await request.patch(`/api/services/${service.id}`, { data: { isVisible: false } });
});
