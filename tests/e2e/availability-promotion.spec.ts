import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

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

function calendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatCalendarMonth(value: string) {
  return new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric" })
    .format(calendarDate(value))
    .replace(" de ", " ");
}

function calendarDay(calendar: Locator, value: string, enabled = true) {
  const dayNumber = String(Number(value.slice(-2)));
  return calendar
    .locator(`button[role="gridcell"]:not(.day-outside)${enabled ? ":not([disabled])" : "[disabled]"}`)
    .filter({ hasText: new RegExp(`^${dayNumber}$`) });
}

async function showCalendarMonth(calendar: Locator, value: string) {
  const targetDate = calendarDate(value);
  const targetIndex = targetDate.getFullYear() * 12 + targetDate.getMonth();
  const monthNames = Array.from({ length: 12 }, (_, month) =>
    new Intl.DateTimeFormat("pt-PT", { month: "long" }).format(new Date(2026, month, 1)),
  );
  for (let attempts = 0; attempts < 24; attempts += 1) {
    const label = (await calendar.locator('[role="presentation"]').first().textContent())?.trim().toLocaleLowerCase("pt-PT") ?? "";
    const year = Number(label.match(/\d{4}/)?.[0]);
    const month = monthNames.findIndex((name) => label.startsWith(name));
    if (!Number.isFinite(year) || month < 0) throw new Error(`Unrecognized calendar month: ${label}`);
    const currentIndex = year * 12 + month;
    if (currentIndex === targetIndex) return;
    const navigation = calendar.getByRole("button", { name: currentIndex < targetIndex ? /next month/i : /previous month/i });
    if (await navigation.isDisabled()) {
      throw new Error(`Calendar navigation is disabled: ${label} -> ${value} (${currentIndex} -> ${targetIndex})`);
    }
    await navigation.click();
  }
  throw new Error(`Could not navigate the calendar to ${value}`);
}

async function selectPromotionDate(page: Page, value: string) {
  await page.getByRole("button", { name: "Escolher data" }).click();
  const calendar = page.locator(".rdp").last();
  await expect(calendar).toBeVisible();
  await showCalendarMonth(calendar, value);
  const day = calendarDay(calendar, value);
  await expect(day).toBeVisible();
  await day.click();
  await expect(calendar).toBeHidden();
  await expect(page.getByTestId("promotion-selected-date")).toContainText(
    new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "long", year: "numeric" }).format(calendarDate(value)),
  );
}

async function selectFirstSlots(slotCheckboxes: Locator, count: number) {
  const total = await slotCheckboxes.count();
  for (let index = count; index < total; index += 1) {
    if (await slotCheckboxes.nth(index).isChecked()) await slotCheckboxes.nth(index).click();
  }
  for (let index = 0; index < Math.min(count, total); index += 1) {
    if (!(await slotCheckboxes.nth(index).isChecked())) await slotCheckboxes.nth(index).click();
  }
}

async function selectedSlotLabels(slotCheckboxes: Locator) {
  const selected: string[] = [];
  for (let index = 0; index < await slotCheckboxes.count(); index += 1) {
    const checkbox = slotCheckboxes.nth(index);
    if (await checkbox.isChecked()) selected.push((await checkbox.getAttribute("aria-label")) ?? "");
  }
  return selected;
}

async function loginAdmin(page: Page) {
  await page.goto("/admin");
  await page.getByPlaceholder("Introduza o email ou nome de utilizador").fill("admin");
  await page.locator('input[type="password"]').fill("Playwright-Test-Admin-2026!");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
}

async function getDefaultLocationSlug(page: Page) {
  const response = await page.request.get("/api/admin/locations");
  expect(response.ok(), await response.text()).toBe(true);
  const locations = await response.json() as Array<{ slug: string; isDefault?: boolean }>;
  const location = locations.find((candidate) => candidate.isDefault) ?? locations[0];
  expect(location?.slug).toBeTruthy();
  return location.slug;
}

async function configureActiveLocationBranding(page: Page, name: string, logoUrl: string) {
  const locationsResponse = await page.request.get("/api/admin/locations");
  expect(locationsResponse.ok(), await locationsResponse.text()).toBe(true);
  const locations = await locationsResponse.json() as Array<{ id: number; isDefault?: boolean }>;
  const location = locations.find((candidate) => candidate.isDefault) ?? locations[0];
  expect(location).toBeTruthy();
  const updateResponse = await page.request.patch(`/api/admin/locations/${location.id}`, {
    data: { name, logoUrl },
  });
  expect(updateResponse.ok(), await updateResponse.text()).toBe(true);
  await page.reload();
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
  const futureOpenDate = nextDateMatching(bookingWindow.today, (date) => date.getDay() >= 2 && date.getDay() <= 5);
  await selectPromotionDate(page, futureOpenDate);

  const serviceTrigger = page.locator("#promotion-service");
  await expect(serviceTrigger).not.toContainText("Escolher serviço");
  await expect(page.getByText(/A duração do serviço determina/)).toBeVisible();

  const barberTrigger = page.locator("#promotion-barber");
  await expect(barberTrigger).toContainText("Todos os barbeiros");
  await expect(page.getByLabel("Vagas disponíveis").locator("label").first()).toBeVisible();
  const imageDescription = page.locator('[aria-live="polite"].sr-only');
  await expect(imageDescription).not.toContainText("Todos os profissionais");
  await expect(imageDescription).not.toContainText("· .");

  const canvas = page.getByLabel("Pré-visualização Story vertical");
  await expect(canvas).toHaveAttribute("width", "1080");
  await expect(canvas).toHaveAttribute("height", "1920");
  await expect(canvas).toHaveAttribute("data-template", "classic");
  await expect(canvas).toHaveAttribute("data-slot-count", /[1-8]/);

  const slotCheckboxes = page.getByLabel("Vagas disponíveis").getByRole("checkbox");
  expect(await slotCheckboxes.count()).toBeGreaterThanOrEqual(8);
  await selectFirstSlots(slotCheckboxes, 8);
  await expect(canvas).toHaveAttribute("data-slot-count", "8");
  await selectFirstSlots(slotCheckboxes, 1);
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
  expect(storyDownload.suggestedFilename()).toMatch(/^[a-z0-9-]+-vagas-.*-story\.png$/);
  const storyPath = await storyDownload.path();
  expect(storyPath).not.toBeNull();
  expect(await pngDimensions(storyPath!)).toEqual({ width: 1080, height: 1920 });
  const previewStory = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL("image/png").split(",")[1]);
  expect((await readFile(storyPath!)).toString("base64")).toBe(previewStory);

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
  await expect(imageDescription).toContainText(individualName || "");
  await expect(page.getByLabel("Vagas disponíveis").locator("label").first()).toBeVisible();

  await page.getByRole("button", { name: "Atualizar vagas" }).click();
  await expect(page.getByText("Vagas atualizadas", { exact: true }).first()).toBeVisible();
});

test("all visual models render atomically across both formats and representative slot counts", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    const renderedText: string[] = [];
    Object.defineProperty(window, "__availabilitySocialCanvasText", { configurable: true, value: renderedText });
    CanvasRenderingContext2D.prototype.fillText = function fillText(text, x, y, maxWidth) {
      renderedText.push(String(text));
      return maxWidth === undefined
        ? originalFillText.call(this, text, x, y)
        : originalFillText.call(this, text, x, y, maxWidth);
    };
  });
  let delayedLogoRequests = 0;
  await page.route(/\/images\/(?:logo\.jpg|demo-logo\.svg)$/, async (route) => {
    delayedLogoRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, delayedLogoRequests === 1 ? 350 : 40));
    await route.continue();
  });
  await loginAdmin(page);
  await configureActiveLocationBranding(page, "POWERHOUSE BARBERSHOP", "/images/demo-logo.svg");
  await page.getByRole("tab", { name: "Divulgar vagas" }).click();
  const bookingWindow = await (await page.request.get("/api/public-booking-window")).json();
  const futureOpenDate = nextDateMatching(bookingWindow.today, (date) => date.getDay() >= 2 && date.getDay() <= 5);
  await selectPromotionDate(page, futureOpenDate);
  const slotCheckboxes = page.getByLabel("Vagas disponíveis").getByRole("checkbox");
  await expect(slotCheckboxes.nth(7)).toBeVisible();

  await page.getByRole("button", { name: /Moderno/ }).click();
  await page.getByRole("button", { name: /Premium/ }).click();
  const canvas = page.locator("canvas[aria-label^='Pré-visualização']");
  await expect(canvas).toHaveAttribute("data-business-name", "POWERHOUSE BARBERSHOP");
  await expect(canvas).toHaveAttribute("data-location-logo-url", "/images/demo-logo.svg");
  await expect(canvas).toHaveAttribute("data-template", "premium");
  await expect(page.getByRole("button", { name: "Descarregar PNG" })).toBeEnabled();
  const rapidPremium = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL("image/png"));
  await page.getByRole("button", { name: /Clássico/ }).click();
  await expect(canvas).toHaveAttribute("data-template", "classic");
  await expect(page.getByRole("button", { name: "Descarregar PNG" })).toBeEnabled();
  await page.getByRole("button", { name: /Premium/ }).click();
  await expect(canvas).toHaveAttribute("data-template", "premium");
  await expect(page.getByRole("button", { name: "Descarregar PNG" })).toBeEnabled();
  const stablePremium = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL("image/png"));
  expect(rapidPremium).toBe(stablePremium);

  await page.getByTestId("availability-social-customizer").locator("summary").click();
  await page.getByLabel("Importar imagem de fundo").setInputFiles(join(process.cwd(), "client/public/images/powerhouse-hero.jpg"));
  await expect(canvas).toHaveAttribute("data-custom-background", "true");
  await page.getByLabel("Cor de destaque").fill("#E5C15A");
  await page.getByLabel("Cor secundária").fill("#7A2030");

  const samples = [
    { template: "Clássico", templateKey: "classic", layout: "Equilibrado", layoutKey: "balanced", format: "Story vertical", formatKey: "story", count: 8, file: "classic-custom-story-8.png" },
    { template: "Moderno", templateKey: "modern", layout: "Compacto", layoutKey: "compact", format: "Story vertical", formatKey: "story", count: 3, file: "modern-custom-story-3.png" },
    { template: "Premium", templateKey: "premium", layout: "Em lista", layoutKey: "stacked", format: "Story vertical", formatKey: "story", count: 1, file: "premium-custom-story-1.png" },
    { template: "Premium", templateKey: "premium", layout: "Em lista", layoutKey: "stacked", format: "Publicação quadrada", formatKey: "square", count: 1, file: "premium-custom-square-1.png" },
    { template: "Clássico", templateKey: "classic", layout: "Em lista", layoutKey: "stacked", format: "Publicação quadrada", formatKey: "square", count: 4, file: "classic-custom-square-4.png" },
    { template: "Moderno", templateKey: "modern", layout: "Compacto", layoutKey: "compact", format: "Publicação quadrada", formatKey: "square", count: 2, file: "modern-custom-square-2.png" },
    { template: "Premium", templateKey: "premium", layout: "Equilibrado", layoutKey: "balanced", format: "Publicação quadrada", formatKey: "square", count: 8, file: "premium-custom-square-8.png" },
  ] as const;
  const artifactDir = process.env.AVAILABILITY_SOCIAL_ARTIFACT_DIR;
  if (artifactDir) await mkdir(artifactDir, { recursive: true });

  for (const sample of samples) {
    await selectFirstSlots(slotCheckboxes, sample.count);
    await page.getByRole("button", { name: new RegExp(sample.template) }).click();
    await page.getByRole("button", { name: new RegExp(sample.layout) }).click();
    await page.getByRole("button", { name: new RegExp(sample.format) }).click();
    await expect(canvas).toHaveAttribute("data-template", sample.templateKey);
    await expect(canvas).toHaveAttribute("data-format", sample.formatKey);
    await expect(canvas).toHaveAttribute("data-schedule-layout", sample.layoutKey);
    await expect(canvas).toHaveAttribute("data-slot-count", String(sample.count));
    await expect(page.getByRole("button", { name: "Descarregar PNG" })).toBeEnabled();
    const preview = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL("image/png").split(",")[1]);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Descarregar PNG" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    expect((await readFile(path!)).toString("base64")).toBe(preview);
    expect(await pngDimensions(path!)).toEqual(sample.formatKey === "story" ? { width: 1080, height: 1920 } : { width: 1080, height: 1080 });
    if (artifactDir) await download.saveAs(join(artifactDir, sample.file));
  }

  const renderedText = await page.evaluate(
    () => (window as Window & { __availabilitySocialCanvasText: string[] }).__availabilitySocialCanvasText,
  );
  expect(renderedText.some((value) => value.includes("MARCA JÁ"))).toBe(false);
  expect(renderedText.some((value) => value.toUpperCase().includes("STICKER"))).toBe(false);
  expect(renderedText.some((value) => value.includes("/booking"))).toBe(false);
});

test("empty dates, mobile preview and download fallback remain safe", async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole("tab", { name: "Divulgar vagas" }).click();
  const customizer = page.getByTestId("availability-social-customizer");
  await expect(customizer).not.toHaveAttribute("open", "");
  const bookingWindow = await (await page.request.get("/api/public-booking-window")).json();
  const futureOpenDate = nextDateMatching(bookingWindow.today, (date) => date.getDay() >= 2 && date.getDay() <= 5);
  const futureSunday = nextDateMatching(bookingWindow.today, (date) => date.getDay() === 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await selectPromotionDate(page, futureOpenDate);
  await expect(page.getByLabel("Vagas disponíveis").locator("label").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  const shareDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Partilhar" }).click();
  const shareDownload = await shareDownloadPromise;
  expect(shareDownload.suggestedFilename()).toContain("-story.png");

  await selectPromotionDate(page, futureSunday);
  await expect(page.getByText("Não existem vagas para esta combinação de data, serviço e profissional.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Descarregar PNG" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Partilhar" })).toBeDisabled();
});

test("visual date picker is localized, mobile safe and preserves only valid selected slots", async ({ page }) => {
  const appointmentRequests = new Map<string, number>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname !== "/api/appointments/public") return;
    const date = url.searchParams.get("date");
    if (date) appointmentRequests.set(date, (appointmentRequests.get(date) ?? 0) + 1);
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await loginAdmin(page);
  await page.getByRole("tab", { name: "Divulgar vagas" }).click();

  const bookingWindow = await (await page.request.get("/api/public-booking-window")).json();
  const yesterday = addDaysToDateKey(bookingWindow.today, -1);
  const firstOpenDate = nextDateMatching(bookingWindow.today, (date) => date.getDay() >= 2 && date.getDay() <= 5);
  const firstOpenWeekday = calendarDate(firstOpenDate).getDay();
  const secondOpenDate = nextDateMatching(firstOpenDate, (date) => date.getDay() === firstOpenWeekday);
  const futureSunday = nextDateMatching(secondOpenDate, (date) => date.getDay() === 0);

  await expect(page.getByRole("button", { name: "Hoje", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Amanhã", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Escolher data" }).click();
  const calendar = page.locator(".rdp").last();
  await expect(calendar).toBeVisible();
  await expect(calendar.getByText(formatCalendarMonth(bookingWindow.today), { exact: true })).toBeVisible();
  await expect(calendarDay(calendar, yesterday, false)).toBeDisabled();
  const calendarBox = await calendar.boundingBox();
  expect(calendarBox).not.toBeNull();
  expect(calendarBox!.x).toBeGreaterThanOrEqual(0);
  expect(calendarBox!.x + calendarBox!.width).toBeLessThanOrEqual(390);

  await showCalendarMonth(calendar, firstOpenDate);
  await calendarDay(calendar, firstOpenDate).click();
  await expect(calendar).toBeHidden();
  await expect(page.getByTestId("promotion-selected-date")).toContainText(
    new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "long", year: "numeric" }).format(calendarDate(firstOpenDate)),
  );
  const slotCheckboxes = page.getByLabel("Vagas disponíveis").getByRole("checkbox");
  await expect(slotCheckboxes.nth(1)).toBeVisible();
  await selectFirstSlots(slotCheckboxes, 2);
  const firstSelection = await selectedSlotLabels(slotCheckboxes);
  expect(firstSelection).toHaveLength(2);

  await page.getByRole("button", { name: "Escolher data" }).click();
  await expect(calendarDay(calendar, firstOpenDate)).toHaveAttribute("aria-selected", "true");
  await showCalendarMonth(calendar, secondOpenDate);
  await calendarDay(calendar, secondOpenDate).click();
  await expect(slotCheckboxes.nth(1)).toBeVisible();
  await expect.poll(() => selectedSlotLabels(slotCheckboxes)).toEqual(firstSelection);

  await selectPromotionDate(page, futureSunday);
  await expect(page.getByText("Não existem vagas para esta combinação de data, serviço e profissional.")).toBeVisible();
  await expect.poll(() => selectedSlotLabels(slotCheckboxes)).toEqual([]);

  await selectPromotionDate(page, firstOpenDate);
  await expect(slotCheckboxes.first()).toBeVisible();
  await expect.poll(() => appointmentRequests.get(firstOpenDate) ?? 0).toBe(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test("visual customization imports an optimized background and reuses a named local preset", async ({ page }) => {
  await loginAdmin(page);
  const unexpectedWrites: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) unexpectedWrites.push(`${request.method()} ${request.url()}`);
  });
  await page.getByRole("tab", { name: "Divulgar vagas" }).click();
  const customizer = page.getByTestId("availability-social-customizer");
  await expect(customizer).not.toHaveAttribute("open", "");
  const bookingWindow = await (await page.request.get("/api/public-booking-window")).json();
  const futureOpenDate = nextDateMatching(bookingWindow.today, (date) => date.getDay() >= 2 && date.getDay() <= 5);
  await selectPromotionDate(page, futureOpenDate);
  await expect(page.getByLabel("Vagas disponíveis").getByRole("checkbox").first()).toBeVisible();

  const canvas = page.locator("canvas[aria-label^='Pré-visualização']");
  const originalPreview = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL("image/png"));
  await customizer.locator("summary").click();
  const backgroundInput = page.getByLabel("Importar imagem de fundo");
  await backgroundInput.setInputFiles({
    name: "unsafe.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
  });
  await expect(page.getByText("Escolha uma imagem JPG, PNG ou WebP.", { exact: true })).toBeVisible();

  await backgroundInput.setInputFiles(join(process.cwd(), "client/public/images/powerhouse-hero.jpg"));
  await expect(page.getByText("powerhouse-hero.jpg", { exact: true })).toBeVisible();
  await expect(canvas).toHaveAttribute("data-custom-background", "true");
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL("image/png"))).not.toBe(originalPreview);

  await page.getByRole("button", { name: /Compacto/ }).click();
  await expect(canvas).toHaveAttribute("data-schedule-layout", "compact");
  await page.getByLabel("Cor de destaque").fill("#6ED5C2");
  await page.getByLabel("Escurecimento").press("ArrowRight");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.getByLabel("Nome do modelo").fill("Modelo QA personalizado");
  await page.getByRole("button", { name: "Guardar novo" }).click();
  await expect(page.getByText("Modelo QA personalizado", { exact: true })).toBeVisible();
  await expect(page.getByText(/Predefinido/)).toBeVisible();

  await page.getByLabel("Cor secundária").fill("#315A7D");
  await page.getByLabel("Nome do modelo").fill("Modelo QA atualizado");
  await page.getByRole("button", { name: "Atualizar selecionado" }).click();
  await expect(page.getByText("Modelo QA atualizado", { exact: true })).toBeVisible();
  const [activeLocation] = await (await page.request.get("/api/account/locations")).json();
  const presetStorageKeys = await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith("barberbookings:availability-social-presets:")));
  expect(presetStorageKeys).toEqual([`barberbookings:availability-social-presets:v2:location-${activeLocation.id}`]);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descarregar PNG" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const preview = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL("image/png").split(",")[1]);
  expect((await readFile(path!)).toString("base64")).toBe(preview);

  await page.reload();
  await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
  await page.getByRole("tab", { name: "Divulgar vagas" }).click();
  await expect(page.getByText("Modelo QA atualizado", { exact: true })).toBeVisible();
  await expect(customizer).not.toHaveAttribute("open", "");
  await customizer.locator("summary").click();
  await expect(page.getByText("powerhouse-hero.jpg", { exact: true })).toBeVisible();
  await expect(page.locator("canvas[aria-label^='Pré-visualização']")).toHaveAttribute("data-custom-background", "true");
  await expect(page.locator("canvas[aria-label^='Pré-visualização']")).toHaveAttribute("data-schedule-layout", "compact");

  await page.getByRole("button", { name: "Repor modelo original" }).click();
  await expect(page.locator("canvas[aria-label^='Pré-visualização']")).toHaveAttribute("data-custom-background", "false");
  await page.getByLabel("Eliminar modelo Modelo QA atualizado").click();
  await expect(page.getByRole("alertdialog")).toContainText("Modelo QA atualizado");
  await page.getByRole("button", { name: "Eliminar modelo", exact: true }).click();
  await expect(page.getByText("Modelo QA atualizado", { exact: true })).toHaveCount(0);
  expect(unexpectedWrites).toEqual([]);
});

test("visual presets fail closed when browser image or settings storage is unavailable", async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole("tab", { name: "Divulgar vagas" }).click();
  await page.getByTestId("availability-social-customizer").locator("summary").click();

  await page.evaluate(() => {
    Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
  });
  await page.getByLabel("Importar imagem de fundo").setInputFiles(join(process.cwd(), "client/public/images/powerhouse-hero.jpg"));
  await expect(page.getByText("Não foi possível importar a imagem", { exact: true })).toBeVisible();
  await expect(page.getByText("Não foi possível guardar a imagem neste navegador. Verifique o espaço e as permissões de armazenamento.", { exact: true })).toBeVisible();
  await expect(page.locator("canvas[aria-label^='Pré-visualização']")).toHaveAttribute("data-custom-background", "false");

  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      value(key: string, value: string) {
        if (key.startsWith("barberbookings:availability-social-presets:")) {
          throw new DOMException("Storage unavailable", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      },
    });
  });
  await page.getByLabel("Nome do modelo").fill("Modelo sem armazenamento");
  await page.getByRole("button", { name: "Guardar novo" }).click();
  await expect(page.getByText("Não foi possível guardar", { exact: true })).toBeVisible();
  await expect(page.getByText("Não foi possível guardar o modelo neste navegador. Verifique o espaço e as permissões de armazenamento.", { exact: true })).toBeVisible();
  await expect(page.getByText("Modelo sem armazenamento", { exact: true })).toHaveCount(0);
});

test("Instagram preparation keeps download and canonical booking-link copy as separate mobile-safe actions", async ({ page, context }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await loginAdmin(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await page.getByRole("tab", { name: "Divulgar vagas" }).click();
  const bookingWindow = await (await page.request.get("/api/public-booking-window")).json();
  const futureOpenDate = nextDateMatching(bookingWindow.today, (date) => date.getDay() >= 2 && date.getDay() <= 5);
  await selectPromotionDate(page, futureOpenDate);
  await expect(page.getByLabel("Vagas disponíveis").getByRole("checkbox").first()).toBeVisible();

  await page.getByRole("button", { name: /Publicação quadrada/ }).click();
  await page.getByRole("button", { name: "Preparar Story para Instagram" }).click();
  const dialog = page.getByRole("dialog", { name: "Preparar Story para Instagram" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("está pronto para personalizar no Instagram");
  await expect(dialog).toContainText("Posicione o sticker onde preferir");
  await expect(dialog).not.toContainText("zona marcada");
  await expect(page.locator("canvas[aria-label='Pré-visualização Story vertical']")).toHaveAttribute("data-format", "story");

  const expectedBookingUrl = `${new URL(page.url()).origin}/booking?location=${await getDefaultLocationSlug(page)}`;
  await expect(dialog.getByLabel("Link público de marcação")).toHaveValue(expectedBookingUrl);
  await dialog.getByRole("button", { name: "Copiar link de marcação" }).click();
  await expect(dialog.getByRole("button", { name: "Link copiado" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedBookingUrl);

  const publicBookingPage = await context.newPage();
  await publicBookingPage.goto(expectedBookingUrl);
  await expect(publicBookingPage).toHaveURL(expectedBookingUrl);
  await expect(publicBookingPage.getByRole("heading", { name: "Seleciona o barbeiro" })).toBeVisible();
  await publicBookingPage.close();

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Descarregar Story PNG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("-story.png");
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await pngDimensions(path!)).toEqual({ width: 1080, height: 1920 });
  await expect(dialog.getByRole("button", { name: "Story descarregado" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Abrir Instagram" })).toHaveAttribute("href", "https://www.instagram.com/");
});

test("Instagram preparation exposes a manual copy fallback without mobile overflow", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Document.prototype.execCommand = () => false;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAdmin(page);
  await page.getByRole("tab", { name: "Divulgar vagas" }).click();
  const bookingWindow = await (await page.request.get("/api/public-booking-window")).json();
  const futureOpenDate = nextDateMatching(bookingWindow.today, (date) => date.getDay() >= 2 && date.getDay() <= 5);
  await selectPromotionDate(page, futureOpenDate);
  await expect(page.getByLabel("Vagas disponíveis").getByRole("checkbox").first()).toBeVisible();
  await page.getByRole("button", { name: "Preparar Story para Instagram" }).click();
  const dialog = page.getByRole("dialog", { name: "Preparar Story para Instagram" });
  const bookingLink = dialog.getByLabel("Link público de marcação");
  await expect(bookingLink).toHaveValue(
    `${new URL(page.url()).origin}/booking?location=${await getDefaultLocationSlug(page)}`,
  );
  await dialog.getByRole("button", { name: "Copiar link de marcação" }).click();
  await expect(page.getByText("Copie o link manualmente", { exact: true })).toBeVisible();
  await expect(bookingLink).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
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
