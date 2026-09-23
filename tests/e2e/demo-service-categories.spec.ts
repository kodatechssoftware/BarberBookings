import { expect, test } from "@playwright/test";

test("[demo categories] seeds explicit real categories only in DEMO_MODE", async ({ page, request }) => {
  test.skip(process.env.DEMO_MODE !== "true", "Only applies to the isolated Powerhouse demo runtime.");

  const servicesResponse = await request.get("/api/services");
  expect(servicesResponse.ok(), await servicesResponse.text()).toBe(true);
  const services = await servicesResponse.json();
  expect(services).toHaveLength(12);
  expect(new Set(services.map((service: any) => service.category?.name))).toEqual(new Set([
    "Serviços",
    "Tratamentos",
    "Só à quarta-feira · Estudantes",
  ]));
  expect(services.every((service: any) => Number.isInteger(service.categoryId))).toBe(true);

  const login = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const categories = await (await request.get("/api/service-categories")).json();
  expect(categories.map((category: any) => ({ name: category.name, serviceCount: category.serviceCount, isActive: category.isActive }))).toEqual([
    { name: "Serviços", serviceCount: 8, isActive: true },
    { name: "Tratamentos", serviceCount: 3, isActive: true },
    { name: "Só à quarta-feira · Estudantes", serviceCount: 1, isActive: true },
  ]);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Serviços", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tratamentos", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Só à quarta-feira · Estudantes", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Outros serviços", exact: true })).toHaveCount(0);
});
