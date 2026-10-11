import { expect, test } from "@playwright/test";

test("canonical invite activates once and blocks double-submit before rerender", async ({ page }) => {
  let acceptRequests = 0;
  await page.route("**/api/user-invites/validate", async (route) => {
    await route.fulfill({ json: { state: "valid", expiresAt: "2026-10-13T08:00:00.000Z" } });
  });
  await page.route("**/api/user-invites/accept", async (route) => {
    acceptRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ json: { authorized: true, role: "barber", userId: 42 } });
  });

  await page.goto("/user-invite#token=canonical-one-time-token-1234567890");
  await expect(page.getByRole("heading", { name: "Criar acesso" })).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("token=");
  await page.getByLabel("Nova palavra-passe").fill("Canonical-password-2026");
  await page.getByLabel("Confirmar palavra-passe").fill("Canonical-password-2026");

  await page.locator("form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });

  await expect.poll(() => acceptRequests).toBe(1);
  await expect(page.getByRole("button", { name: "A ativar…" })).toBeDisabled();
  await expect(page.getByText("Acesso ativado.")).toBeVisible();
  expect(acceptRequests).toBe(1);
});

for (const scenario of [
  { state: "used", message: "Este convite já foi utilizado." },
  { state: "revoked", message: "Este convite foi revogado ou substituído." },
  { state: "expired", message: "Este convite expirou." },
  { state: "invalid", message: "Este convite é inválido." },
] as const) {
  test(`canonical invite renders the ${scenario.state} state`, async ({ page }) => {
    await page.route("**/api/user-invites/validate", (route) => route.fulfill({
      json: { state: scenario.state, expiresAt: null },
    }));
    await page.goto("/user-invite#token=canonical-one-time-token-1234567890");
    await expect(page.getByRole("heading", { name: "Convite indisponível" })).toBeVisible();
    await expect(page.getByText(scenario.message)).toBeVisible();
    await expect(page.getByRole("button", { name: "Definir palavra-passe" })).toHaveCount(0);
  });
}
