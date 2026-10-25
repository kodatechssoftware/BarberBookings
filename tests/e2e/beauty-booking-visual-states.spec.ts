import { expect, test, type Locator } from "@playwright/test";

type Rgb = { r: number; g: number; b: number; a: number };

function parseRgb(value: string): Rgb {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) throw new Error(`Unsupported colour: ${value}`);
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function luminance({ r, g, b }: Rgb) {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground: Rgb, background: Rgb) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

async function expectReadable(locator: Locator, minimum = 4.5) {
  const colours = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      className: element.className,
      color: style.color,
      backgroundColor: style.backgroundColor,
    };
  });
  expect(parseRgb(colours.backgroundColor).a).toBeGreaterThan(0);
  const ratio = contrastRatio(parseRgb(colours.color), parseRgb(colours.backgroundColor));
  expect(
    ratio,
    `${colours.className}: ${colours.color} on ${colours.backgroundColor}`,
  ).toBeGreaterThanOrEqual(minimum);
}

async function expectKeyboardFocus(locator: Locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  const focus = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focus.outlineStyle).toBe("solid");
  expect(Number.parseFloat(focus.outlineWidth)).toBeGreaterThanOrEqual(2);
}

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

test.describe("Beauty public visual state contract", () => {
  test("keeps calendar and time-slot states readable on desktop", async ({ page }, testInfo) => {
    const today = localDateKey(new Date());
    await page.goto(`/book?barberId=1&serviceId=1&date=${today}`);

    await expect(page.locator("html")).toHaveAttribute("data-brand-theme", "beauty-clean");
    await expect(page.locator(".booking-shell")).toBeVisible();
    await expect(page.locator(".booking-calendar-card")).toBeVisible();

    const selectedDay = page.locator(".booking-calendar-day[aria-selected='true']");
    await expect(selectedDay).toHaveCount(1);
    await expectReadable(selectedDay);

    const anotherAvailableDay = page.locator(
      ".booking-day-available.booking-calendar-day:not([aria-selected='true']):not(:disabled)",
    ).first();
    await expect(anotherAvailableDay).toBeVisible();
    await expectReadable(anotherAvailableDay);
    await anotherAvailableDay.hover();
    await expectReadable(anotherAvailableDay);
    await expectKeyboardFocus(anotherAvailableDay);
    await anotherAvailableDay.click();

    const todayButton = page.locator(".booking-calendar-day-today");
    await expect(todayButton).toBeVisible();
    await expectReadable(todayButton);

    const unavailableDay = page.locator(
      ".booking-calendar-day-unavailable.booking-calendar-day-disabled",
    ).first();
    await expect(unavailableDay).toBeVisible();
    await expect(unavailableDay).toBeDisabled();
    await expectReadable(unavailableDay);

    const pastDay = page.locator(".booking-calendar-day-past.booking-calendar-day-disabled").first();
    await expect(pastDay).toBeVisible();
    await expect(pastDay).toBeDisabled();
    await expectReadable(pastDay);

    const outsideDay = page.locator(".booking-calendar-day-outside").first();
    await expect(outsideDay).toBeVisible();
    await expectReadable(outsideDay);

    const availableSlot = page.locator(".booking-time-slot[data-slot-state='available']").first();
    await expect(availableSlot).toBeVisible();
    await expect(availableSlot).toBeEnabled();
    await expectReadable(availableSlot);
    await expect(availableSlot).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");

    await availableSlot.hover();
    await expectReadable(availableSlot);
    await expectKeyboardFocus(availableSlot);
    await availableSlot.click();

    const chosenSlot = page.locator(".booking-time-slot[data-slot-state='selected']");
    await expect(chosenSlot).toHaveCount(1);
    await expect(chosenSlot).toHaveAttribute("aria-pressed", "true");
    await expectReadable(chosenSlot);

    const disabledSlots = page.locator(".booking-time-slot:disabled");
    for (let index = 0; index < await disabledSlots.count(); index += 1) {
      await expect(disabledSlots.nth(index)).toHaveAttribute("data-slot-state", "unavailable");
      await expectReadable(disabledSlots.nth(index), 3);
    }

    await page.screenshot({ path: testInfo.outputPath("beauty-booking-date-time-desktop.png"), fullPage: true });
  });

  test("keeps calendar states readable without horizontal overflow on mobile", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const today = localDateKey(new Date());
    await page.goto(`/book?barberId=1&serviceId=1&date=${today}`);

    await expect(page.locator("html")).toHaveAttribute("data-brand-theme", "beauty-clean");
    const selectedDay = page.locator(".booking-calendar-day[aria-selected='true']");
    const availableDay = page.locator(
      ".booking-day-available.booking-calendar-day:not([aria-selected='true']):not(:disabled)",
    ).first();
    const unavailableDay = page.locator(
      ".booking-calendar-day-unavailable.booking-calendar-day-disabled",
    ).first();
    const pastDay = page.locator(".booking-calendar-day-past.booking-calendar-day-disabled").first();
    const outsideDay = page.locator(".booking-calendar-day-outside").first();

    for (const calendarDay of [selectedDay, availableDay, unavailableDay, pastDay, outsideDay]) {
      await expect(calendarDay).toBeVisible();
      await expectReadable(calendarDay);
    }
    await expectKeyboardFocus(availableDay);

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasOverflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("beauty-booking-calendar-mobile.png"), fullPage: true });
  });

  test("keeps the phone country selector readable and usable on mobile", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const date = new Date();
    date.setDate(date.getDate() + 8);
    await page.goto(`/book?barberId=1&serviceId=1&date=${localDateKey(date)}&time=15:30`);

    const countrySelect = page.getByRole("combobox", { name: "País do telemóvel" });
    await expect(countrySelect).toBeVisible();
    await expect(countrySelect).toContainText("+351");

    await countrySelect.focus();
    const phoneField = countrySelect.locator("xpath=..");
    await expectReadable(phoneField);
    await expect.poll(() => phoneField.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");

    const phoneInput = page.locator("#phone");
    const portuguesePlaceholder = await phoneInput.getAttribute("placeholder");
    await countrySelect.click();
    await expect(page.getByRole("option")).toHaveCount(245);
    await page.getByRole("combobox", { name: "Pesquisar país ou indicativo" }).fill("Espanha");
    await page.getByRole("option", { name: /Espanha.*\+34/ }).click();
    await expect(countrySelect).toContainText("+34");
    await expect(phoneInput).not.toHaveAttribute("placeholder", portuguesePlaceholder || "");

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasOverflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("beauty-booking-phone-mobile.png"), fullPage: true });
  });
});
