import { expect, test, type Page } from "@playwright/test";
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
});

test.describe("admin navigation", () => {
  test("shows agenda only in Agenda and appointment list only in Marcações", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAdmin(page);

    await page.getByRole("tab", { name: "Agenda" }).click();
    await expect(page.getByText("Agenda semanal")).toBeVisible();
    await expect(page.getByText("Agenda do dia")).not.toBeVisible();
    await expect(page.getByText("Lista de marcações")).not.toBeVisible();
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
});

test.describe("booking rules", () => {
  test("blocks a blacklisted Portuguese phone even with another country prefix", async ({ request }) => {
    const loginResponse = await request.post("/api/admin/login", {
      data: { username: "admin", password: "baptista2026" },
    });
    expect(loginResponse.ok()).toBe(true);

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
