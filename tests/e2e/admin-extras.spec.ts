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

async function expectOpaqueSelectContent(page: Page) {
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await expect.poll(async () => listbox.evaluate((element) => {
    const content = element.closest<HTMLElement>(".bg-popover");
    return content ? Number(getComputedStyle(content).opacity) : 0;
  })).toBe(1);
  const appearance = await listbox.evaluate((element) => {
    const content = element.closest<HTMLElement>(".bg-popover");
    if (!content) return null;
    const styles = getComputedStyle(content);
    const wrapperStyles = content.parentElement ? getComputedStyle(content.parentElement) : null;
    const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const background = channels(styles.backgroundColor);
    const foreground = channels(styles.color);
    const luminance = ([red, green, blue]: number[]) => {
      const linear = [red, green, blue].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const backgroundLuminance = luminance(background);
    const foregroundLuminance = luminance(foreground);
    const contrastRatio = (Math.max(backgroundLuminance, foregroundLuminance) + 0.05)
      / (Math.min(backgroundLuminance, foregroundLuminance) + 0.05);
    const rect = content.getBoundingClientRect();
    const centerElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const submitButton = document.querySelector<HTMLElement>('[role="dialog"] button[type="submit"]');
    const submitRect = submitButton?.getBoundingClientRect();
    const overlap = submitRect ? {
      left: Math.max(rect.left, submitRect.left),
      right: Math.min(rect.right, submitRect.right),
      top: Math.max(rect.top, submitRect.top),
      bottom: Math.min(rect.bottom, submitRect.bottom),
    } : null;
    const hasSubmitOverlap = Boolean(overlap && overlap.right > overlap.left && overlap.bottom > overlap.top);
    const overlapElement = hasSubmitOverlap && overlap
      ? document.elementFromPoint((overlap.left + overlap.right) / 2, (overlap.top + overlap.bottom) / 2)
      : null;
    return {
      backgroundAlpha: background[3] ?? 1,
      contrastRatio,
      opacity: Number(styles.opacity),
      ownsCenterPoint: centerElement === content || (centerElement ? content.contains(centerElement) : false),
      ownsSubmitOverlap: !hasSubmitOverlap
        || overlapElement === content
        || (overlapElement ? content.contains(overlapElement) : false),
      wrapperZIndex: Number.parseInt(wrapperStyles?.zIndex ?? "", 10),
      zIndex: Number.parseInt(styles.zIndex, 10),
    };
  });
  expect(appearance).not.toBeNull();
  expect(appearance!.backgroundAlpha).toBe(1);
  expect(appearance!.contrastRatio).toBeGreaterThanOrEqual(4.5);
  expect(appearance!.opacity).toBe(1);
  expect(appearance!.ownsCenterPoint).toBe(true);
  expect(appearance!.ownsSubmitOverlap).toBe(true);
  expect(appearance!.wrapperZIndex).toBeGreaterThan(50);
  expect(appearance!.zIndex).toBeGreaterThan(50);
}

test.describe.serial("Admin Extras catalogue", () => {
  test("validates CRUD-without-delete, permissions, lifecycle and audit events", async ({ request, playwright, baseURL }) => {
    test.setTimeout(90_000);
    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      expect((await anonymous.get("/api/admin/extras")).status()).toBe(401);
      expect((await anonymous.post("/api/admin/extras", {
        data: { name: "Sem sessão", pricingMode: "fixed", amountCents: 100, financialRule: "barber", sortOrder: 0 },
      })).status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }

    await loginAdminRequest(request);
    const emptyCatalogue = await request.get("/api/admin/extras");
    expect(emptyCatalogue.status(), await emptyCatalogue.text()).toBe(200);
    expect(await emptyCatalogue.json()).toEqual([]);

    const invalidPayloads = [
      { name: "   ", pricingMode: "fixed", amountCents: 500, financialRule: "follow_compensation", sortOrder: 0 },
      { name: "Fixo sem valor", pricingMode: "fixed", financialRule: "follow_compensation", sortOrder: 0 },
      { name: "Valor zero", pricingMode: "fixed", amountCents: 0, financialRule: "follow_compensation", sortOrder: 0 },
      { name: "Valor negativo", pricingMode: "fixed", amountCents: -100, financialRule: "follow_compensation", sortOrder: 0 },
      { name: "Modo inválido", pricingMode: "distance", amountCents: 500, financialRule: "barber", sortOrder: 0 },
      { name: "Regra inválida", pricingMode: "fixed", amountCents: 500, financialRule: "percentage", sortOrder: 0 },
      { name: "Ordem negativa", pricingMode: "fixed", amountCents: 500, financialRule: "barber", sortOrder: -1 },
      { name: "Ordem decimal", pricingMode: "fixed", amountCents: 500, financialRule: "barber", sortOrder: 1.5 },
      { name: "Ordem demasiado elevada", pricingMode: "fixed", amountCents: 500, financialRule: "barber", sortOrder: 2_147_483_648 },
    ];
    for (const payload of invalidPayloads) {
      const response = await request.post("/api/admin/extras", { data: payload });
      expect(response.status(), `${payload.name}: ${await response.text()}`).toBe(400);
    }

    const createResponse = await request.post("/api/admin/extras", {
      data: {
        locationId: 999999,
        name: "  Tratamento premium Extras QA  ",
        pricingMode: "fixed",
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
      pricingMode: "fixed",
      amountCents: 650,
      financialRule: "follow_compensation",
      isActive: true,
      sortOrder: 2,
      locationId: 1,
    });

    const duplicateResponse = await request.post("/api/admin/extras", {
      data: {
        name: "  TRATAMENTO PREMIUM EXTRAS QA ",
        pricingMode: "fixed",
        amountCents: 700,
        financialRule: "barber",
      },
    });
    expect(duplicateResponse.status(), await duplicateResponse.text()).toBe(409);

    for (const invalidPatch of [
      { name: "   " },
      { amountCents: 0 },
      { amountCents: -1 },
      { pricingMode: "distance" },
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
      pricingMode: "fixed",
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
      pricingMode: "fixed",
      amountCents: 650,
      financialRule: "follow_compensation",
    });

    const emptyPatch = await request.patch(`/api/admin/extras/${apiExtraId}`, { data: {} });
    expect(emptyPatch.status(), await emptyPatch.text()).toBe(400);

    const variableResponse = await request.patch(`/api/admin/extras/${apiExtraId}`, {
      data: { pricingMode: "variable", amountCents: 999 },
    });
    expect(variableResponse.status(), await variableResponse.text()).toBe(200);
    expect(await variableResponse.json()).toMatchObject({ pricingMode: "variable", amountCents: null });
    const variableAudit = await getAuditEvent(request, "extra.updated", apiExtraId);
    const variableMetadata = JSON.parse(variableAudit.metadata);
    expect(variableMetadata.changedFields).toEqual(expect.arrayContaining(["pricingMode", "amountCents"]));
    expect(variableMetadata.changes.pricingMode).toEqual({ previous: "fixed", next: "variable" });
    expect(variableMetadata.changes.amountCents).toEqual({ previous: 650, next: null });

    const fixedWithoutAmount = await request.patch(`/api/admin/extras/${apiExtraId}`, {
      data: { pricingMode: "fixed" },
    });
    expect(fixedWithoutAmount.status(), await fixedWithoutAmount.text()).toBe(400);

    const updateResponse = await request.patch(`/api/admin/extras/${apiExtraId}`, {
      data: {
        name: "  Tratamento premium editado Extras QA  ",
        pricingMode: "fixed",
        amountCents: 775,
        financialRule: "establishment",
        sortOrder: 3,
      },
    });
    expect(updateResponse.status(), await updateResponse.text()).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      id: apiExtraId,
      name: "Tratamento premium editado Extras QA",
      pricingMode: "fixed",
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
      "name", "pricingMode", "amountCents", "financialRule", "sortOrder",
    ]));
    expect(updateMetadata.changes.pricingMode).toEqual({ previous: "variable", next: "fixed" });
    expect(updateMetadata.changes.amountCents).toEqual({ previous: null, next: 775 });
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
          data: { name: "Extra indevido", pricingMode: "fixed", amountCents: 100, financialRule: "barber", sortOrder: 0 },
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
    await expect(existingCard.getByText("Valor fixo", { exact: true })).toBeVisible();
    await expect(existingCard.getByText("100% para o estabelecimento", { exact: true })).toBeVisible();
    await expect(existingCard.getByText("Inativo", { exact: true }).first()).toBeVisible();
    await expect(existingCard.getByText(/follow_compensation|establishment|barber/, { exact: false })).toHaveCount(0);

    await existingCard.getByRole("switch", { name: "Ativar Tratamento premium editado Extras QA" }).click();
    await expect(existingCard.getByText("Ativo", { exact: true }).first()).toBeVisible();

    await existingCard.getByRole("button", { name: "Editar Tratamento premium editado Extras QA" }).click();
    let dialog = page.getByRole("dialog", { name: "Editar Extra" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "Variável por marcação" }).click();
    await expect(dialog.getByLabel("Valor (€)")).toHaveCount(0);
    await expect(dialog.getByText("Valor definido na marcação", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Guardar alterações" }).click();
    await expect(dialog).toHaveCount(0);
    existingCard = manager.getByTestId(`extra-card-${apiExtraId}`);
    await expect(existingCard.getByText("Variável por marcação", { exact: true })).toBeVisible();
    await expect(existingCard.getByText("Valor definido na marcação", { exact: true })).toBeVisible();

    await existingCard.getByRole("button", { name: "Editar Tratamento premium editado Extras QA" }).click();
    dialog = page.getByRole("dialog", { name: "Editar Extra" });
    await dialog.getByRole("radio", { name: "Fixo", exact: true }).click();
    await dialog.getByLabel("Nome").fill("Tratamento premium UI Extras QA");
    const editAmountInput = dialog.getByLabel("Valor (€)");
    await editAmountInput.fill("1.50");
    await expect(editAmountInput).toHaveValue("1,50");
    await editAmountInput.fill("0,558");
    await expect(editAmountInput).toHaveValue("1,50");
    await editAmountInput.fill("8,75");
    await editAmountInput.blur();
    await expect(editAmountInput).toHaveValue("8,75");
    await dialog.getByLabel("Ordem").fill("4");
    await dialog.getByLabel("Regra financeira").click();
    await expectOpaqueSelectContent(page);
    await page.screenshot({ path: "test-results/admin-extras-select-edit-desktop.png" });
    await page.getByRole("option", { name: "100% para o barbeiro", exact: true }).click();
    await dialog.getByRole("button", { name: "Guardar alterações" }).click();
    await expect(dialog).toHaveCount(0);

    existingCard = manager.getByTestId(`extra-card-${apiExtraId}`);
    await expect(existingCard.getByText("Tratamento premium UI Extras QA", { exact: true })).toBeVisible();
    await expect(existingCard.getByText("8,75 €", { exact: true })).toBeVisible();
    await expect(existingCard.getByText("Valor fixo", { exact: true })).toBeVisible();
    await expect(existingCard.getByText("100% para o barbeiro", { exact: true })).toBeVisible();
    await expect(existingCard.getByText("Ordem: 4", { exact: true })).toBeVisible();
    await manager.screenshot({ path: "test-results/admin-extras-desktop.png" });

    await manager.getByRole("button", { name: "Novo Extra" }).click();
    dialog = page.getByRole("dialog", { name: "Novo Extra" });
    await dialog.getByLabel("Nome").fill("Toalha quente UI Extras QA");
    const createAmountInput = dialog.getByLabel("Valor (€)");
    await createAmountInput.fill("021");
    await expect(createAmountInput).toHaveValue("21");
    await createAmountInput.blur();
    await expect(createAmountInput).toHaveValue("21,00");
    await createAmountInput.fill("12,345");
    await expect(createAmountInput).toHaveValue("21,00");
    await createAmountInput.fill("");
    await expect(createAmountInput).toHaveValue("");
    await createAmountInput.pressSequentially("5,");
    await expect(createAmountInput).toHaveValue("5,");
    await createAmountInput.pressSequentially("5");
    await createAmountInput.blur();
    await expect(createAmountInput).toHaveValue("5,50");
    await createAmountInput.fill("3,50");
    await dialog.getByLabel("Regra financeira").click();
    await expectOpaqueSelectContent(page);
    await page.screenshot({ path: "test-results/admin-extras-select-create-desktop.png" });
    await page.getByRole("option", { name: "Segue a regra de compensação do barbeiro", exact: true }).click();
    await dialog.getByRole("button", { name: "Criar Extra" }).click();
    await expect(dialog).toHaveCount(0);
    const uiExtraCard = manager.locator('[data-testid^="extra-card-"]').filter({
      hasText: "Toalha quente UI Extras QA",
    });
    await expect(uiExtraCard).toBeVisible();
    await expect(uiExtraCard.getByText("3,50 €", { exact: true })).toBeVisible();
    await expect(uiExtraCard.getByText("Valor fixo", { exact: true })).toBeVisible();
    await expect(uiExtraCard.getByText("Segue a regra de compensação do barbeiro", { exact: true })).toBeVisible();

    await manager.getByRole("button", { name: "Novo Extra" }).click();
    dialog = page.getByRole("dialog", { name: "Novo Extra" });
    await dialog.getByLabel("Nome").fill("Deslocação variável UI Extras QA");
    await dialog.getByRole("radio", { name: "Variável por marcação" }).click();
    await expect(dialog.getByLabel("Valor (€)")).toHaveCount(0);
    await dialog.getByLabel("Regra financeira").click();
    await page.getByRole("option", { name: "100% para o barbeiro", exact: true }).click();
    await dialog.getByRole("button", { name: "Criar Extra" }).click();
    await expect(dialog).toHaveCount(0);
    const variableExtraCard = manager.locator('[data-testid^="extra-card-"]').filter({
      hasText: "Deslocação variável UI Extras QA",
    });
    await expect(variableExtraCard.getByText("Valor definido na marcação", { exact: true })).toBeVisible();
    await expect(variableExtraCard.getByText("Variável por marcação", { exact: true })).toBeVisible();
    await expect(variableExtraCard.getByText("100% para o barbeiro", { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const managerBox = await manager.boundingBox();
    expect(managerBox).not.toBeNull();
    expect(managerBox!.x).toBeGreaterThanOrEqual(0);
    expect(managerBox!.x + managerBox!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await expect(uiExtraCard.getByRole("button", { name: "Editar Toalha quente UI Extras QA" })).toBeVisible();
    await expect(variableExtraCard.getByRole("button", { name: "Editar Deslocação variável UI Extras QA" })).toBeVisible();
    await uiExtraCard.getByRole("switch", { name: "Desativar Toalha quente UI Extras QA" }).click();
    await expect(uiExtraCard.getByText("Inativo", { exact: true }).first()).toBeVisible();
    await manager.screenshot({ path: "test-results/admin-extras-mobile.png" });

    await uiExtraCard.getByRole("button", { name: "Editar Toalha quente UI Extras QA" }).click();
    dialog = page.getByRole("dialog", { name: "Editar Extra" });
    await expect(dialog.getByRole("radio", { name: "Fixo", exact: true })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Variável por marcação" })).toBeVisible();
    await dialog.getByLabel("Regra financeira").click();
    await expectOpaqueSelectContent(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: "test-results/admin-extras-select-edit-mobile.png" });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    const catalogue = await (await page.request.get("/api/admin/extras")).json();
    expect(catalogue.find((extra: any) => extra.name === "Toalha quente UI Extras QA")).toMatchObject({
      amountCents: 350,
      pricingMode: "fixed",
      financialRule: "follow_compensation",
      isActive: false,
    });
    expect(catalogue.find((extra: any) => extra.name === "Deslocação variável UI Extras QA")).toMatchObject({
      amountCents: null,
      pricingMode: "variable",
      financialRule: "barber",
      isActive: true,
    });
  });
});
