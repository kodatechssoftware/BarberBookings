import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const adminPassword = "Playwright-Test-Admin-2026!";

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

test.describe("service categories", () => {
  test("preserves the legacy catalogue contract and Admin UI with zero categories", async ({ page, request }) => {
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

    await loginAdmin(page);
    await page.getByRole("tab", { name: "Serviços" }).click();
    await expect(page.getByTestId("service-categories-manager")).toBeVisible();
    await expect(page.getByText("Organize a apresentação no site e no formulário de marcação. É opcional.")).toBeVisible();
    await page.getByLabel("Nome da nova categoria").fill("Categoria Admin UI QA");
    await page.getByRole("button", { name: "Criar categoria" }).click();
    await expect(page.getByText("Categoria Admin UI QA", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Eliminar Categoria Admin UI QA" }).click();
    await page.getByRole("button", { name: "Eliminar categoria", exact: true }).click();
    await expect(page.getByText("Categoria Admin UI QA", { exact: true })).toHaveCount(0);
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
