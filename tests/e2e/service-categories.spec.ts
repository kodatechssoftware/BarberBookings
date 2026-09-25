import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const adminPassword = "Playwright-Test-Admin-2026!";

function futureThursdayIso(weeksAhead: number, hour: number, minute = 0) {
  const date = new Date();
  const daysUntilThursday = (4 - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilThursday + weeksAhead * 7);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

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

async function focusedInputStyle(input: Locator) {
  await input.focus();
  return input.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
    };
  });
}

test.describe("service categories", () => {
  test("category name inputs preserve the complete Admin focus ring", async ({ page }) => {
    test.setTimeout(60_000);
    await loginAdmin(page);
    const createdResponse = await page.request.post("/api/service-categories", {
      data: { name: "Categoria Focus QA" },
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const category = await createdResponse.json();

    try {
      await page.getByRole("tab", { name: /Servi/ }).click();

      await page.getByRole("button", { name: /Adicionar Servi/, exact: true }).click();
      const serviceDialog = page.getByRole("dialog", { name: /Novo Servi/ });
      const referenceStyle = await focusedInputStyle(serviceDialog.locator("input").first());
      await serviceDialog.getByRole("button", { name: "Close" }).click();

      await page.getByRole("button", { name: "Gerir categorias", exact: true }).click();
      const categoriesDialog = page.getByRole("dialog", { name: "Gerir categorias" });
      const manager = categoriesDialog.getByTestId("service-categories-manager");
      const newCategoryInput = categoriesDialog.getByLabel("Nome da nova categoria");
      expect(await focusedInputStyle(newCategoryInput)).toEqual(referenceStyle);

      const assertRingFitsScrollableArea = async () => {
        const [managerBox, inputBox] = await Promise.all([manager.boundingBox(), newCategoryInput.boundingBox()]);
        expect(managerBox).not.toBeNull();
        expect(inputBox).not.toBeNull();
        expect(inputBox!.x - managerBox!.x).toBeGreaterThanOrEqual(3.5);
        expect(inputBox!.y - managerBox!.y).toBeGreaterThanOrEqual(3.5);
        expect(managerBox!.x + managerBox!.width - inputBox!.x - inputBox!.width).toBeGreaterThanOrEqual(3.5);
      };
      await assertRingFitsScrollableArea();

      const categoryRow = categoriesDialog.getByTestId(`service-category-${category.id}`);
      await categoryRow.getByRole("button", { name: "Editar Categoria Focus QA" }).click();
      const editDialog = page.getByRole("dialog", { name: "Editar categoria" });
      expect(await focusedInputStyle(editDialog.getByLabel("Nome da categoria"))).toEqual(referenceStyle);
      await editDialog.getByRole("button", { name: "Cancelar", exact: true }).click();

      await page.setViewportSize({ width: 390, height: 844 });
      await newCategoryInput.focus();
      await assertRingFitsScrollableArea();
      const dialogBox = await categoriesDialog.boundingBox();
      expect(dialogBox).not.toBeNull();
      expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390);
    } finally {
      await page.request.delete(`/api/service-categories/${category.id}`);
    }
  });

  test("preserves the legacy catalogue contract and Admin UI with zero categories", async ({ page, request }) => {
    test.setTimeout(60_000);
    expect((await request.get("/api/service-categories")).status()).toBe(401);
    expect((await request.post("/api/service-categories", { data: { name: "Não autorizada" } })).status()).toBe(401);
    await loginAdminRequest(request);
    expect(await (await request.get("/api/service-categories")).json()).toEqual([]);

    const legacyServices = await (await request.get("/api/services")).json();
    expect(legacyServices.length).toBeGreaterThan(0);
    for (const service of legacyServices) {
      expect(service).not.toHaveProperty("categoryId");
      expect(service).not.toHaveProperty("category");
    }

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Serviços e preços" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Outros serviços" })).toHaveCount(0);
    for (const service of legacyServices) {
      await expect(page.getByRole("heading", { name: service.name, exact: true })).toHaveCount(1);
    }

    const [barber] = await (await request.get("/api/barbers")).json();
    expect(barber?.id).toBeTruthy();
    await page.goto(`/book?barberId=${barber.id}`);
    await expect(page.getByRole("heading", { name: "Selecione o Serviço" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Outros serviços", exact: true })).toHaveCount(0);
    expect(await page.getByRole("heading", { level: 3 }).allTextContents())
      .toEqual(legacyServices.map((service: any) => service.name));

    await loginAdmin(page);
    await page.getByRole("tab", { name: "Serviços" }).click();
    await expect(page.getByRole("heading", { name: "Serviços Disponíveis" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Gerir categorias", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Adicionar Serviço", exact: true })).toBeVisible();
    await expect(page.getByTestId("service-categories-manager")).toHaveCount(0);

    await page.getByRole("button", { name: "Gerir categorias", exact: true }).click();
    let manageCategoriesDialog = page.getByRole("dialog", { name: "Gerir categorias" });
    await expect(manageCategoriesDialog).toBeVisible();
    await expect(manageCategoriesDialog.getByText(
      "Organize os serviços por categorias para facilitar a escolha nas marcações online.",
      { exact: true },
    )).toBeVisible();
    await manageCategoriesDialog.getByLabel("Nome da nova categoria").fill("Categoria Admin UI QA");
    await manageCategoriesDialog.getByRole("button", { name: "Criar categoria" }).click();
    await expect(manageCategoriesDialog.getByText("Categoria Admin UI QA", { exact: true })).toBeVisible();
    await manageCategoriesDialog.getByLabel("Nome da nova categoria").fill("Categoria Duplicada Admin UI QA");
    await manageCategoriesDialog.getByRole("button", { name: "Criar categoria" }).click();
    await expect(manageCategoriesDialog.getByText("Categoria Duplicada Admin UI QA", { exact: true })).toBeVisible();

    const categoriesAfterCreation = await (await request.get("/api/service-categories")).json();
    const category = categoriesAfterCreation.find((item: any) => item.name === "Categoria Admin UI QA");
    const duplicateCategory = categoriesAfterCreation.find((item: any) => item.name === "Categoria Duplicada Admin UI QA");
    expect(category).toMatchObject({ isActive: true, serviceCount: 0 });
    expect(duplicateCategory).toMatchObject({ isActive: true, serviceCount: 0 });

    let categoryRow = manageCategoriesDialog.getByTestId(`service-category-${category.id}`);
    await categoryRow.getByRole("button", { name: "Mover Categoria Admin UI QA para baixo" }).click();
    await expect.poll(async () => (await (await request.get("/api/service-categories")).json())
      .map((item: any) => item.id)).toEqual([duplicateCategory.id, category.id]);
    await categoryRow.getByRole("button", { name: "Mover Categoria Admin UI QA para cima" }).click();
    await expect.poll(async () => (await (await request.get("/api/service-categories")).json())
      .map((item: any) => item.id)).toEqual([category.id, duplicateCategory.id]);

    await categoryRow.getByRole("switch", { name: "Desativar Categoria Admin UI QA" }).click();
    await expect.poll(async () => (await (await request.get("/api/service-categories")).json())
      .find((item: any) => item.id === category.id)?.isActive).toBe(false);
    await categoryRow.getByRole("switch", { name: "Ativar Categoria Admin UI QA" }).click();
    await expect.poll(async () => (await (await request.get("/api/service-categories")).json())
      .find((item: any) => item.id === category.id)?.isActive).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileManagerBox = await manageCategoriesDialog.boundingBox();
    expect(mobileManagerBox).not.toBeNull();
    expect(mobileManagerBox!.x).toBeGreaterThanOrEqual(0);
    expect(mobileManagerBox!.x + mobileManagerBox!.width).toBeLessThanOrEqual(390);
    expect(mobileManagerBox!.height).toBeLessThanOrEqual(844 * 0.85 + 1);
    await expect(manageCategoriesDialog.getByTestId("service-categories-manager"))
      .toHaveCSS("overflow-y", "auto");
    await manageCategoriesDialog.getByRole("button", { name: "Close" }).click();
    await expect(manageCategoriesDialog).toHaveCount(0);
    await expect(page.getByTestId("service-categories-manager")).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });

    const serviceCard = page.getByTestId(`admin-service-card-${legacyServices[0].id}`);
    await expect(serviceCard).toBeVisible();
    await serviceCard.getByRole("button", { name: "Editar", exact: true }).click();
    const editServiceDialog = page.getByRole("dialog").filter({ hasText: "Editar Serviço" });
    const categorySelect = editServiceDialog.getByRole("combobox");
    await categorySelect.click();

    const categoryListbox = page.getByRole("listbox");
    await expect(categoryListbox).toBeVisible();
    const listboxStyle = await categoryListbox.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, zIndex: Number(style.zIndex) };
    });
    expect(listboxStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(listboxStyle.backgroundColor).not.toBe("transparent");
    expect(listboxStyle.zIndex).toBeGreaterThanOrEqual(100);
    const selectedEmptyOption = page.getByRole("option", { name: "Sem categoria", exact: true });
    await expect(selectedEmptyOption).toHaveAttribute("aria-selected", "true");
    const selectedOptionBackground = await selectedEmptyOption.evaluate((element) => window.getComputedStyle(element).backgroundColor);
    expect(selectedOptionBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(selectedOptionBackground).not.toBe("transparent");
    await page.getByRole("option", { name: "Categoria Admin UI QA", exact: true }).click();
    await expect(categorySelect).toContainText("Categoria Admin UI QA");

    await page.setViewportSize({ width: 390, height: 844 });
    await categorySelect.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("option", { name: "Categoria Admin UI QA", exact: true })).toHaveAttribute("aria-selected", "true");
    const mobileListboxBox = await page.getByRole("listbox").boundingBox();
    expect(mobileListboxBox).not.toBeNull();
    expect(mobileListboxBox!.x).toBeGreaterThanOrEqual(0);
    expect(mobileListboxBox!.x + mobileListboxBox!.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1280, height: 900 });
    await editServiceDialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(editServiceDialog).toHaveCount(0);

    const categoryAfterAssignment = (await (await request.get("/api/service-categories")).json())
      .find((item: any) => item.id === category.id);
    expect(categoryAfterAssignment).toMatchObject({ isActive: true, serviceCount: 1 });

    const createAppointment = await request.post("/api/appointments", { data: {
      barberId: barber.id,
      serviceId: legacyServices[0].id,
      startTime: futureThursdayIso(30, 15),
      customerName: "Categoria rename appointment QA",
      customerPhone: "+351912640001",
      customerEmail: "categoria-rename@example.test",
    } });
    expect(createAppointment.status(), await createAppointment.text()).toBe(201);
    const appointment = await createAppointment.json();
    const appointmentSnapshot = {
      id: appointment.id,
      barberId: appointment.barberId,
      serviceId: appointment.serviceId,
      startTime: appointment.startTime,
      durationMinutes: appointment.durationMinutes,
      status: appointment.status,
      cancelToken: appointment.cancelToken,
    };

    await page.getByRole("button", { name: "Gerir categorias", exact: true }).click();
    manageCategoriesDialog = page.getByRole("dialog", { name: "Gerir categorias" });
    categoryRow = manageCategoriesDialog.getByTestId(`service-category-${category.id}`);
    await expect(categoryRow.getByRole("button", { name: "Editar Categoria Admin UI QA" })).toBeVisible();
    await expect(categoryRow.getByTitle("Mover para cima")).toHaveAttribute("aria-label", "Mover Categoria Admin UI QA para cima");
    await expect(categoryRow.getByTitle("Mover para baixo")).toHaveAttribute("aria-label", "Mover Categoria Admin UI QA para baixo");

    await categoryRow.getByRole("button", { name: "Editar Categoria Admin UI QA" }).click();
    let editCategoryDialog = page.getByRole("dialog", { name: "Editar categoria" });
    await expect(editCategoryDialog).toBeVisible();
    await expect(editCategoryDialog.getByLabel("Nome da categoria")).toHaveValue("Categoria Admin UI QA");
    await editCategoryDialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(editCategoryDialog).toHaveCount(0);
    await expect(categoryRow.getByText("Categoria Admin UI QA", { exact: true })).toBeVisible();

    await categoryRow.getByRole("button", { name: "Editar Categoria Admin UI QA" }).click();
    editCategoryDialog = page.getByRole("dialog", { name: "Editar categoria" });
    await editCategoryDialog.getByLabel("Nome da categoria").fill("  categoria duplicada admin ui qa  ");
    await editCategoryDialog.getByRole("button", { name: "Guardar alterações", exact: true }).click();
    await expect(page.getByText("Já existe uma categoria com este nome.", { exact: true })).toBeVisible();
    await expect(editCategoryDialog).toBeVisible();
    await editCategoryDialog.getByLabel("Nome da categoria").fill("  Categoria Renomeada Admin UI QA  ");
    await editCategoryDialog.getByRole("button", { name: "Guardar alterações", exact: true }).click();
    await expect(editCategoryDialog).toHaveCount(0);
    await expect(categoryRow.getByText("Categoria Renomeada Admin UI QA", { exact: true })).toBeVisible();

    const renamedCategory = (await (await request.get("/api/service-categories")).json())
      .find((item: any) => item.id === category.id);
    expect(renamedCategory).toMatchObject({
      id: category.id,
      name: "Categoria Renomeada Admin UI QA",
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      serviceCount: 1,
    });
    const serviceAfterRename = (await (await request.get("/api/services?includeHidden=true")).json())
      .find((item: any) => item.id === legacyServices[0].id);
    expect(serviceAfterRename.categoryId).toBe(category.id);

    await manageCategoriesDialog.getByRole("button", { name: "Close" }).click();
    await expect(manageCategoriesDialog).toHaveCount(0);
    await page.getByRole("button", { name: "Gerir categorias", exact: true }).click();
    manageCategoriesDialog = page.getByRole("dialog", { name: "Gerir categorias" });
    await expect(manageCategoriesDialog.getByTestId(`service-category-${category.id}`)
      .getByText("Categoria Renomeada Admin UI QA", { exact: true })).toBeVisible();
    await manageCategoriesDialog.getByRole("button", { name: "Close" }).click();

    await page.goto("/");
    await expect(page.locator("#services").getByRole("heading", {
      name: "Categoria Renomeada Admin UI QA",
      exact: true,
    })).toBeVisible();
    await page.goto(`/book?barberId=${barber.id}`);
    await expect(page.getByRole("heading", { name: "Categoria Renomeada Admin UI QA", exact: true })).toBeVisible();

    await page.goto("/admin");
    await page.getByRole("tab", { name: "Serviços" }).click();
    await page.getByRole("button", { name: "Gerir categorias", exact: true }).click();
    manageCategoriesDialog = page.getByRole("dialog", { name: "Gerir categorias" });
    const renamedRow = manageCategoriesDialog.getByTestId(`service-category-${category.id}`);
    await renamedRow.getByRole("button", { name: "Eliminar Categoria Renomeada Admin UI QA" }).click();
    const deleteDialog = page.getByRole("alertdialog");
    await expect(deleteDialog.getByRole("heading", {
      name: "Eliminar a categoria “Categoria Renomeada Admin UI QA”?",
      exact: true,
    })).toBeVisible();
    await expect(deleteDialog.getByText(
      "Esta ação elimina apenas a categoria. Os serviços associados mantêm-se e ficam sem categoria.",
      { exact: true },
    )).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(renamedRow).toBeVisible();

    await renamedRow.getByRole("button", { name: "Eliminar Categoria Renomeada Admin UI QA" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Eliminar categoria", exact: true }).click();
    await expect(renamedRow).toHaveCount(0);

    const serviceAfterDelete = (await (await request.get("/api/services?includeHidden=true")).json())
      .find((item: any) => item.id === legacyServices[0].id);
    expect(serviceAfterDelete).toBeTruthy();
    expect(serviceAfterDelete).not.toHaveProperty("categoryId");
    const appointmentAfterCategoryChanges = (await (await request.get(`/api/appointments?barberId=${barber.id}`)).json())
      .find((item: any) => item.id === appointment.id);
    expect({
      id: appointmentAfterCategoryChanges.id,
      barberId: appointmentAfterCategoryChanges.barberId,
      serviceId: appointmentAfterCategoryChanges.serviceId,
      startTime: appointmentAfterCategoryChanges.startTime,
      durationMinutes: appointmentAfterCategoryChanges.durationMinutes,
      status: appointmentAfterCategoryChanges.status,
      cancelToken: appointmentAfterCategoryChanges.cancelToken,
    }).toEqual(appointmentSnapshot);

    const removeDuplicate = await request.delete(`/api/service-categories/${duplicateCategory.id}`);
    expect(removeDuplicate.status(), await removeDuplicate.text()).toBe(200);
    await request.patch(`/api/appointments/${appointment.id}/status`, { data: { status: "cancelled" } });
  });

  test("supports atomic CRUD, inactive associations, deterministic order and delete set-null", async ({ request }) => {
    await loginAdminRequest(request);
    const servicesBefore = await (await request.get("/api/services?includeHidden=true")).json();
    const service = servicesBefore[0];
    expect(service).toBeTruthy();

    const emptyName = await request.post("/api/service-categories", { data: { name: "   " } });
    expect(emptyName.status()).toBe(400);

    const firstResponse = await request.post("/api/service-categories", { data: { name: "Cortes E2E" } });
    expect(firstResponse.status(), await firstResponse.text()).toBe(201);
    const first = await firstResponse.json();

    const secondResponse = await request.post("/api/service-categories", { data: { name: "Tratamentos E2E" } });
    expect(secondResponse.status(), await secondResponse.text()).toBe(201);
    const second = await secondResponse.json();

    const duplicate = await request.post("/api/service-categories", { data: { name: "  cortes e2e  " } });
    expect(duplicate.status()).toBe(409);

    const duplicateRename = await request.patch(`/api/service-categories/${second.id}`, {
      data: { name: "  CORTES E2E  " },
    });
    expect(duplicateRename.status()).toBe(409);

    const reorder = await request.put("/api/service-categories/order", {
      data: { categoryIds: [second.id, first.id] },
    });
    expect(reorder.status(), await reorder.text()).toBe(200);
    expect((await reorder.json()).map((category: any) => category.id)).toEqual([second.id, first.id]);

    const staleReorder = await request.put("/api/service-categories/order", {
      data: { categoryIds: [first.id] },
    });
    expect(staleReorder.status()).toBe(409);

    const assign = await request.patch(`/api/services/${service.id}`, { data: { categoryId: first.id } });
    expect(assign.status(), await assign.text()).toBe(200);
    let publicService = (await (await request.get("/api/services")).json()).find((item: any) => item.id === service.id);
    expect(publicService).toMatchObject({
      categoryId: first.id,
      category: { id: first.id, name: "Cortes E2E" },
    });

    const counts = await (await request.get("/api/service-categories")).json();
    expect(counts.find((category: any) => category.id === first.id).serviceCount).toBe(1);

    const deactivate = await request.patch(`/api/service-categories/${first.id}`, { data: { isActive: false } });
    expect(deactivate.status(), await deactivate.text()).toBe(200);
    publicService = (await (await request.get("/api/services")).json()).find((item: any) => item.id === service.id);
    expect(publicService).not.toHaveProperty("categoryId");
    expect(publicService).not.toHaveProperty("category");
    const adminService = (await (await request.get("/api/services?includeHidden=true")).json()).find((item: any) => item.id === service.id);
    expect(adminService).toMatchObject({ categoryId: first.id });
    expect(adminService).not.toHaveProperty("category");

    const blockedAssignment = await request.patch(`/api/services/${servicesBefore[1].id}`, { data: { categoryId: first.id } });
    expect(blockedAssignment.status()).toBe(400);
    const unrelatedUpdate = await request.patch(`/api/services/${service.id}`, { data: { description: service.description } });
    expect(unrelatedUpdate.status(), await unrelatedUpdate.text()).toBe(200);

    const reactivate = await request.patch(`/api/service-categories/${first.id}`, { data: { isActive: true } });
    expect(reactivate.status(), await reactivate.text()).toBe(200);
    publicService = (await (await request.get("/api/services")).json()).find((item: any) => item.id === service.id);
    expect(publicService.category).toMatchObject({ id: first.id, name: "Cortes E2E" });

    const remove = await request.delete(`/api/service-categories/${first.id}`);
    expect(remove.status(), await remove.text()).toBe(200);
    const serviceAfterDelete = (await (await request.get("/api/services?includeHidden=true")).json()).find((item: any) => item.id === service.id);
    expect(serviceAfterDelete).not.toHaveProperty("categoryId");
    expect(serviceAfterDelete.name).toBe(service.name);

    const removeSecond = await request.delete(`/api/service-categories/${second.id}`);
    expect(removeSecond.status(), await removeSecond.text()).toBe(200);
    expect(await (await request.get("/api/service-categories")).json()).toEqual([]);

    const servicesAfter = await (await request.get("/api/services?includeHidden=true")).json();
    expect(servicesAfter.map((item: any) => ({ id: item.id, name: item.name, price: item.price, duration: item.duration, isVisible: item.isVisible })))
      .toEqual(servicesBefore.map((item: any) => ({ id: item.id, name: item.name, price: item.price, duration: item.duration, isVisible: item.isVisible })));
  });
});
