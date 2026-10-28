import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

function addDaysToDateKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function nextDateMatching(value: string, predicate: (date: Date) => boolean) {
  for (let offset = 1; offset <= 12; offset += 1) {
    const candidate = addDaysToDateKey(value, offset);
    const [year, month, day] = candidate.split("-").map(Number);
    if (predicate(new Date(year, month - 1, day, 12, 0, 0, 0))) return candidate;
  }
  throw new Error("No matching date in test range");
}

async function loginAdmin(page: Page) {
  await page.goto("/admin");
  await page.getByPlaceholder("Introduza o email ou nome de utilizador").fill("admin");
  await page.locator('input[type="password"]').fill("Playwright-Test-Admin-2026!");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
}

async function pngDimensions(path: string) {
  const data = await readFile(path);
  expect(data.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test("admin creates branded story and square PNGs from authoritative availability", async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole("tab", { name: "Divulgar vagas" }).click();
  await expect(page.getByRole("heading", { name: "Divulgar vagas" })).toBeVisible();

  const bookingWindow = await (await page.request.get("/api/public-booking-window")).json();
  const futureOpenDate = nextDateMatching(bookingWindow.today, (date) => date.getDay() >= 1 && date.getDay() <= 5);
  await page.getByLabel("Data específica").fill(futureOpenDate);

  const serviceTrigger = page.locator("#promotion-service");
  await expect(serviceTrigger).not.toContainText("Escolher serviço");
  await expect(page.getByText(/A duração do serviço determina/)).toBeVisible();

  const barberTrigger = page.locator("#promotion-barber");
  await expect(barberTrigger).toContainText("Todos os barbeiros");
  await expect(page.getByLabel("Vagas disponíveis").locator("label").first()).toBeVisible();

  const canvas = page.getByLabel("Pré-visualização Story vertical");
  await expect(canvas).toHaveAttribute("width", "1080");
  await expect(canvas).toHaveAttribute("height", "1920");
  await expect(canvas).toHaveAttribute("data-template", "classic");
  await expect(canvas).toHaveAttribute("data-slot-count", /[1-8]/);

  const slotCheckboxes = page.getByLabel("Vagas disponíveis").getByRole("checkbox");
  expect(await slotCheckboxes.count()).toBeGreaterThanOrEqual(8);
  for (let index = 0; index < 8; index += 1) {
    if (!(await slotCheckboxes.nth(index).isChecked())) await slotCheckboxes.nth(index).click();
  }
  await expect(canvas).toHaveAttribute("data-slot-count", "8");
  for (let index = 1; index < 8; index += 1) {
    if (await slotCheckboxes.nth(index).isChecked()) await slotCheckboxes.nth(index).click();
  }
  await expect(canvas).toHaveAttribute("data-slot-count", "1");

  const classicImage = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL("image/png"));
  await page.getByRole("button", { name: /Moderno/ }).click();
  await expect(canvas).toHaveAttribute("data-template", "modern");
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL("image/png"))).not.toBe(classicImage);
  const modernImage = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL("image/png"));
  await page.getByRole("button", { name: /Premium/ }).click();
  await expect(canvas).toHaveAttribute("data-template", "premium");
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL("image/png"))).not.toBe(modernImage);

  const longTitle = "Ainda temos horários disponíveis para cuidares do teu estilo";
  await page.getByLabel("Título").fill(longTitle);
  await expect(page.getByText(`${longTitle.length}/70`)).toBeVisible();

  const storyDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descarregar PNG" }).click();
  const storyDownload = await storyDownloadPromise;
  expect(storyDownload.suggestedFilename()).toMatch(/^baptista-barber-shop-vagas-.*-story\.png$/);
  const storyPath = await storyDownload.path();
  expect(storyPath).not.toBeNull();
  expect(await pngDimensions(storyPath!)).toEqual({ width: 1080, height: 1920 });

  await page.getByRole("button", { name: /Publicação quadrada/ }).click();
  const squareCanvas = page.getByLabel("Pré-visualização Publicação quadrada");
  await expect(squareCanvas).toHaveAttribute("width", "1080");
  await expect(squareCanvas).toHaveAttribute("height", "1080");
  const squareDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descarregar PNG" }).click();
  const squareDownload = await squareDownloadPromise;
  const squarePath = await squareDownload.path();
  expect(squarePath).not.toBeNull();
  expect(await pngDimensions(squarePath!)).toEqual({ width: 1080, height: 1080 });

  await barberTrigger.click();
  const individualOption = page.getByRole("option").filter({ hasNotText: "Todos os barbeiros" }).first();
  const individualName = (await individualOption.textContent())?.trim();
  await individualOption.click();
  await expect(barberTrigger).toContainText(individualName || "");
  await expect(page.getByLabel("Vagas disponíveis").locator("label").first()).toBeVisible();

  await page.getByRole("button", { name: "Atualizar vagas" }).click();
  await expect(page.getByText("Vagas atualizadas")).toBeVisible();
});

test("empty dates, mobile preview and download fallback remain safe", async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole("tab", { name: "Divulgar vagas" }).click();
  const bookingWindow = await (await page.request.get("/api/public-booking-window")).json();
  const futureOpenDate = nextDateMatching(bookingWindow.today, (date) => date.getDay() >= 1 && date.getDay() <= 5);
  const futureSunday = nextDateMatching(bookingWindow.today, (date) => date.getDay() === 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Data específica").fill(futureOpenDate);
  await expect(page.getByLabel("Vagas disponíveis").locator("label").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  const shareDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Partilhar" }).click();
  const shareDownload = await shareDownloadPromise;
  expect(shareDownload.suggestedFilename()).toContain("-story.png");

  await page.getByLabel("Data específica").fill(futureSunday);
  await expect(page.getByText("Não existem vagas para esta combinação de data, serviço e profissional.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Descarregar PNG" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Partilhar" })).toBeDisabled();
});

test("the availability promotion tab is restricted to administrators", async ({ page }) => {
  await loginAdmin(page);
  await expect(page.getByRole("tab", { name: "Divulgar vagas" })).toBeVisible();

  await page.route("**/api/admin/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, role: "barber" } });
  });
  await page.reload();
  await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Divulgar vagas" })).toHaveCount(0);
});
