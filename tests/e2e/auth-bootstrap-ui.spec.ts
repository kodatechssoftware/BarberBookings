import { expect, test } from "@playwright/test";

test("canonical bootstrap creates the first administrator once on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const posts: Array<Record<string, unknown>> = [];
  await page.route("**/api/auth/bootstrap/status", (route) => route.fulfill({
    json: { available: true, configured: true },
  }));
  await page.route("**/api/auth/bootstrap", async (route) => {
    posts.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 201, json: {
      message: "Primeiro administrador criado com sucesso.",
      authorized: true,
      role: "admin",
      id: 1,
      userId: 1,
      professionalId: null,
      name: "Root Admin",
      email: "root@example.test",
      access: { globalCapabilities: [], locationCapabilities: [], presetLabels: ["Administrador"] },
    } });
  });
  await page.goto("/setup");
  await page.getByLabel("Nome").fill("Root Admin");
  await page.getByLabel("Email").fill("root@example.test");
  await page.getByLabel("Palavra-passe", { exact: true }).fill("Secure-password-2026");
  await page.getByLabel("Confirmar palavra-passe").fill("Secure-password-2026");
  await page.getByLabel("Token de configuração").fill("bootstrap-token-with-at-least-32-characters");
  await page.getByRole("button", { name: "Criar primeiro administrador" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    displayName: "Root Admin",
    email: "root@example.test",
    password: "Secure-password-2026",
  });
});

test("bootstrap page reports a permanently closed installation on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/auth/bootstrap/status", (route) => route.fulfill({
    json: { available: false, configured: true },
  }));
  await page.goto("/setup");
  await expect(page.getByText("A configuração inicial já foi concluída.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ir para o acesso administrativo" })).toBeVisible();
  await expect(page.locator("main")).toHaveCSS("overflow-x", "visible");
});

test("legacy runtime does not expose canonical bootstrap", async ({ request }) => {
  const response = await request.get("/api/auth/bootstrap/status");
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ message: "Endpoint indisponível." });
});
