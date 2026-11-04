import { expect, test, type APIRequestContext } from "@playwright/test";

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.status(), await response.text()).toBe(200);
}

test("the Beauty legibility layer remains isolated from the Barber Admin", async ({ page }) => {
  const runtimeConfigResponse = await page.request.get("/api/runtime-config");
  expect(runtimeConfigResponse.ok(), await runtimeConfigResponse.text()).toBe(true);
  expect((await runtimeConfigResponse.json()).vertical).toBe("barber");

  await loginAdmin(page.request);
  await page.goto("/admin");

  await expect(page.locator("html")).not.toHaveAttribute("data-brand-theme", "beauty-clean");
  await expect(page.getByRole("heading", { name: "Painel Administrativo" }))
    .toHaveCSS("color", "rgb(255, 255, 255)");

  const agenda = page.getByTestId("weekly-agenda");
  await expect(agenda).toBeVisible();
  expect(await agenda.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe("rgb(255, 253, 251)");
});
