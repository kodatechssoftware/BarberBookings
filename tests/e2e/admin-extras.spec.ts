import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const adminPassword = "Playwright-Test-Admin-2026!";
const apiExtraName = "Tratamento premium Extras QA";
let apiExtraId = 0;

async function loginAdminRequest(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: adminPassword },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function loginAdmin(page: Page) {
  await page.goto("/admin");
  await page.getByPlaceholder("Introduza o email ou nome de utilizador").fill("admin");
  await page.locator('input[type="password"]').fill(adminPassword);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
}

async function getAuditEvent(request: APIRequestContext, action: string, entityId: number) {
  await expect.poll(async () => {
    const response = await request.get("/api/admin/audit-logs?limit=100");
    if (!response.ok()) return false;
    const logs = await response.json();
    return logs.some((log: any) => log.action === action && log.entityId === entityId);
  }).toBe(true);

  const logs = await (await request.get("/api/admin/audit-logs?limit=100")).json();
  return logs.find((log: any) => log.action === action && log.entityId === entityId);
}

test.describe.serial("Admin Extras catalogue", () => {
  test("validates CRUD-without-delete, permissions, lifecycle and audit events", async ({ request, playwright, baseURL }) => {
    test.setTimeout(90_000);
    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      expect((await anonymous.get("/api/admin/extras")).status()).toBe(401);
      expect((await anonymous.post("/api/admin/extras", {
        data: { name: "Sem sessão", amountCents: 100, financialRule: "barber", sortOrder: 0 },
      })).status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }

    await loginAdminRequest(request);
    const emptyCatalogue = await request.get("/api/admin/extras");
    expect(emptyCatalogue.status(), await emptyCatalogue.text()).toBe(200);
    expect(await emptyCatalogue.json()).toEqual([]);

    const invalidPayloads = [
      { name: "   ", amountCents: 500, financialRule: "follow_compensation", sortOrder: 0 },
      { name: "Valor zero", amountCents: 0, financialRule: "follow_compensation", sortOrder: 0 },
      { name: "Valor negativo", amountCents: -100, financialRule: "follow_compensation", sortOrder: 0 },
      { name: "Regra inválida", amountCents: 500, financialRule: "percentage", sortOrder: 0 },
      { name: "Ordem negativa", amountCents: 500, financialRule: "barber", sortOrder: -1 },
      { name: "Ordem decimal", amountCents: 500, financialRule: "barber", sortOrder: 1.5 },
      { name: "Ordem demasiado elevada", amountCents: 500, financialRule: "barber", sortOrder: 2_147_483_648 },
    ];
    for (const payload of invalidPayloads) {
      const response = await request.post("/api/admin/extras", { data: payload });
      expect(response.status(), `${payload.name}: ${await response.text()}`).toBe(400);
    }

    const createResponse = await request.post("/api/admin/extras", {
      data: {
        locationId: 999999,
        name: "  Tratamento premium Extras QA  ",
        amountCents: 650,
        financialRule: "follow_compensation",
        sortOrder: 2,
      },
    });
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    const created = await createResponse.json();
    apiExtraId = created.id;
    expect(created).toMatchObject({
      name: "Tratamento premium Extras QA",
      amountCents: 650,
      financialRule: "follow_compensation",
      isActive: true,
      sortOrder: 2,
      locationId: 1,
    });

    const duplicateResponse = await request.post("/api/admin/extras", {
      data: {
        name: "  TRATAMENTO PREMIUM EXTRAS QA ",
        amountCents: 700,
        financialRule: "barber",
      },
    });
    expect(duplicateResponse.status(), await duplicateResponse.text()).toBe(409);

    for (const invalidPatch of [
      { name: "   " },
      { amountCents: 0 },
      { amountCents: -1 },
      { financialRule: "percentage" },
      { sortOrder: -1 },
      { sortOrder: 1.5 },
      { sortOrder: 2_147_483_648 },
    ]) {
      const response = await request.patch(`/api/admin/extras/${apiExtraId}`, { data: invalidPatch });
      expect(response.status(), `${JSON.stringify(invalidPatch)}: ${await response.text()}`).toBe(400);
    }
    expect((await (await request.get("/api/admin/extras")).json())[0]).toMatchObject({
      id: apiExtraId,
      name: apiExtraName,
      amountCents: 650,
      financialRule: "follow_compensation",
      sortOrder: 2,
    });

    const createAudit = await getAuditEvent(request, "extra.created", apiExtraId);
    expect(createAudit.summary).toContain(apiExtraName);
    expect(JSON.parse(createAudit.metadata)).toMatchObject({
      extraId: apiExtraId,
      locationId: 1,
      name: apiExtraName,
      amountCents: 650,
      financialRule: "follow_compensation",
    });

    const emptyPatch = await request.patch(`/api/admin/extras/${apiExtraId}`, { data: {} });
    expect(emptyPatch.status(), await emptyPatch.text()).toBe(400);

    const updateResponse = await request.patch(`/api/admin/extras/${apiExtraId}`, {
      data: {
        name: "  Tratamento premium editado Extras QA  ",
        amountCents: 775,
        financialRule: "establishment",
        sortOrder: 3,
      },
    });
    expect(updateResponse.status(), await updateResponse.text()).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      id: apiExtraId,
      name: "Tratamento premium editado Extras QA",
      amountCents: 775,
      financialRule: "establishment",
      sortOrder: 3,
      isActive: true,
    });

    const updateAudit = await getAuditEvent(request, "extra.updated", apiExtraId);
    const updateMetadata = JSON.parse(updateAudit.metadata);
    expect(updateMetadata).toMatchObject({
      extraId: apiExtraId,
      locationId: 1,
      name: "Tratamento premium editado Extras QA",
    });
    expect(updateMetadata.changedFields).toEqual(expect.arrayContaining([
      "name", "amountCents", "financialRule", "sortOrder",
    ]));
    expect(updateMetadata.changes.amountCents).toEqual({ previous: 650, next: 775 });
    expect(updateMetadata.changes.financialRule).toEqual({
      previous: "follow_compensation",
      next: "establishment",
    });

    const deactivateResponse = await request.patch(`/api/admin/extras/${apiExtraId}`, {
      data: { isActive: false },
    });
    expect(deactivateResponse.status(), await deactivateResponse.text()).toBe(200);
    expect((await deactivateResponse.json()).isActive).toBe(false);
    const deactivateAudit = await getAuditEvent(request, "extra.deactivated", apiExtraId);
    expect(JSON.parse(deactivateAudit.metadata).changes.isActive).toEqual({ previous: true, next: false });

    const reactivateResponse = await request.patch(`/api/admin/extras/${apiExtraId}`, {
      data: { isActive: true },
    });
    expect(reactivateResponse.status(), await reactivateResponse.text()).toBe(200);
    expect((await reactivateResponse.json()).isActive).toBe(true);
    const activateAudit = await getAuditEvent(request, "extra.activated", apiExtraId);
    expect(JSON.parse(activateAudit.metadata).changes.isActive).toEqual({ previous: false, next: true });

    const listed = await (await request.get("/api/admin/extras")).json();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: apiExtraId, isActive: true });
    expect((await request.delete(`/api/admin/extras/${apiExtraId}`)).status()).toBe(404);

    const suffix = Date.now();
    const barberEmail = `extras-barber-${suffix}@example.test`;
    const barberResponse = await request.post("/api/barbers", {
      data: {
        name: `Barbeiro Extras ${suffix}`,
        specialty: "QA",
        email: barberEmail,
        color: "#0EA5E9",
        isVisible: true,
        serviceIds: [],
      },
    });
    expect(barberResponse.status(), await barberResponse.text()).toBe(201);
    const barber = await barberResponse.json();
    try {
      const inviteResponse = await request.post(`/api/barbers/${barber.id}/invite`, { data: {} });
      expect(inviteResponse.status(), await inviteResponse.text()).toBe(201);
      const invite = await inviteResponse.json();
      const token = new URL(invite.inviteUrl).pathname.split("/").pop();
      expect(token).toBeTruthy();

      const barberContext = await playwright.request.newContext({ baseURL });
      try {
        const acceptResponse = await barberContext.post(`/api/barber-invites/${token}/accept`, {
          data: { password: `Extras-Barber-${suffix}!` },
        });
        expect(acceptResponse.status(), await acceptResponse.text()).toBe(200);
        expect((await barberContext.get("/api/admin/extras")).status()).toBe(401);
        expect((await barberContext.post("/api/admin/extras", {
          data: { name: "Extra indevido", amountCents: 100, financialRule: "barber", sortOrder: 0 },
        })).status()).toBe(401);
        expect((await barberContext.patch(`/api/admin/extras/${apiExtraId}`, {
          data: { isActive: false },
        })).status()).toBe(401);
      } finally {
        await barberContext.dispose();
      }
    } finally {
      const removeBarber = await request.delete(`/api/barbers/${barber.id}`);
      expect(removeBarber.status(), await removeBarber.text()).toBe(200);
    }

    const finalDeactivate = await request.patch(`/api/admin/extras/${apiExtraId}`, {
      data: { isActive: false },
    });
    expect(finalDeactivate.status(), await finalDeactivate.text()).toBe(200);
  });

  test("keeps the catalogue usable and explicit on desktop and mobile", async ({ page }) => {
    test.setTimeout(90_000);
    expect(apiExtraId).toBeGreaterThan(0);
    await loginAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("tab", { name: "Extras", exact: true }).click();

    const manager = page.getByTestId("extras-manager");
    await expect(manager.getByText("Catálogo de Extras", { exact: true })).toBeVisible();
    let existingCard = manager.getByTestId(`extra-card-${apiExtraId}`);
    await expect(existingCard.getByText("Tratamento premium editado Extras QA", { exact: true })).toBeVisible();
    await expect(existingCard.getByText("7,75 €", { exact: true })).toBeVisible();
    await expect(existingCard.getByText("100% para o estabelecimento", { exact: true })).toBeVisible();
    await expect(existingCard.getByText("Inativo", { exact: true }).first()).toBeVisible();
    await expect(existingCard.getByText(/follow_compensation|establishment|barber/, { exact: false })).toHaveCount(0);

    await existingCard.getByRole("switch", { name: "Ativar Tratamento premium editado Extras QA" }).click();
    await expect(existingCard.getByText("Ativo", { exact: true }).first()).toBeVisible();

    await existingCard.getByRole("button", { name: "Editar Tratamento premium editado Extras QA" }).click();
    let dialog = page.getByRole("dialog", { name: "Editar Extra" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Nome").fill("Tratamento premium UI Extras QA");
    await dialog.getByLabel("Valor (€)").fill("8,75");
    await dialog.getByLabel("Ordem").fill("4");
    await dialog.getByLabel("Regra financeira").click();
    await page.getByRole("option", { name: "100% para o barbeiro", exact: true }).click();
    await dialog.getByRole("button", { name: "Guardar alterações" }).click();
    await expect(dialog).toHaveCount(0);

    existingCard = manager.getByTestId(`extra-card-${apiExtraId}`);
    await expect(existingCard.getByText("Tratamento premium UI Extras QA", { exact: true })).toBeVisible();
    await expect(existingCard.getByText("8,75 €", { exact: true })).toBeVisible();
    await expect(existingCard.getByText("100% para o barbeiro", { exact: true })).toBeVisible();
    await expect(existingCard.getByText("Ordem: 4", { exact: true })).toBeVisible();
    await manager.screenshot({ path: "test-results/admin-extras-desktop.png" });

    await manager.getByRole("button", { name: "Novo Extra" }).click();
    dialog = page.getByRole("dialog", { name: "Novo Extra" });
    await dialog.getByLabel("Nome").fill("Toalha quente UI Extras QA");
    await dialog.getByLabel("Valor (€)").fill("3,50");
    await dialog.getByLabel("Regra financeira").click();
    await page.getByRole("option", { name: "Segue a regra de compensação do barbeiro", exact: true }).click();
    await dialog.getByRole("button", { name: "Criar Extra" }).click();
    await expect(dialog).toHaveCount(0);
    const uiExtraCard = manager.locator('[data-testid^="extra-card-"]').filter({
      hasText: "Toalha quente UI Extras QA",
    });
    await expect(uiExtraCard).toBeVisible();
    await expect(uiExtraCard.getByText("3,50 €", { exact: true })).toBeVisible();
    await expect(uiExtraCard.getByText("Segue a regra de compensação do barbeiro", { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const managerBox = await manager.boundingBox();
    expect(managerBox).not.toBeNull();
    expect(managerBox!.x).toBeGreaterThanOrEqual(0);
    expect(managerBox!.x + managerBox!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await expect(uiExtraCard.getByRole("button", { name: "Editar Toalha quente UI Extras QA" })).toBeVisible();
    await uiExtraCard.getByRole("switch", { name: "Desativar Toalha quente UI Extras QA" }).click();
    await expect(uiExtraCard.getByText("Inativo", { exact: true }).first()).toBeVisible();
    await manager.screenshot({ path: "test-results/admin-extras-mobile.png" });

    const catalogue = await (await page.request.get("/api/admin/extras")).json();
    expect(catalogue.find((extra: any) => extra.name === "Toalha quente UI Extras QA")).toMatchObject({
      amountCents: 350,
      financialRule: "follow_compensation",
      isActive: false,
    });
  });
});
