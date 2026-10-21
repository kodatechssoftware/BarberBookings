import { expect, test } from "@playwright/test";

test("publishes the privacy draft and links it from the public site", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Política de Privacidade" }).click();

  await expect(page).toHaveURL(/\/privacidade$/);
  await expect(page.getByRole("heading", { name: "Política de Privacidade" })).toBeVisible();
  await expect(page.getByText("Rascunho — não publicar antes da validação do negócio.")).toBeVisible();
  await expect(page.getByText(/Responsável pelo tratamento:\s*Baptista Barber Shop\./)).toBeVisible();
  await expect(page.getByText(/Morada:\s*R\. Cmte\. Agatão Lança 28, 4640-142 Baião, Portugal\./)).toBeVisible();
  await expect(page.getByRole("link", { name: "+351 916 852 841" }).first()).toHaveAttribute("href", "tel:+351916852841");
  await expect(page.getByText(/Subcontratante tecnológico:\s*KodaTechs\./)).toBeVisible();
  await expect(page.getByText("Não utiliza os dados dos clientes para finalidades próprias.", { exact: false })).toBeVisible();
  await expect(page.getByText("anonimização após 24 meses", { exact: false })).toBeVisible();
  await expect(page.getByText("backups operacionais: 14 dias", { exact: false })).toBeVisible();
  await expect(page.getByText("payloads e respostas técnicas de notificações: proposta de 90 dias", { exact: false })).toBeVisible();
  await expect(page.getByText("DPA, regiões e garantias de transferência:")).toBeVisible();
  await expect(page.getByText("GitHub Actions")).toHaveCount(0);
});

test("shows a privacy notice in booking and removes health-data suggestions", async ({ page }) => {
  const requestedDate = new Date();
  requestedDate.setDate(requestedDate.getDate() + 7);
  const date = [
    requestedDate.getFullYear(),
    String(requestedDate.getMonth() + 1).padStart(2, "0"),
    String(requestedDate.getDate()).padStart(2, "0"),
  ].join("-");
  await page.goto(`/book?barberId=1&serviceId=1&date=${date}&time=10:00`);
  await expect(page.getByRole("link", { name: "Política de Privacidade" })).toBeVisible();

  const source = await page.locator("body").innerText();
  expect(source).not.toContain("alergias");
});
