import { expect, test } from "@playwright/test";

// Valid 1px PNG: transport must preserve the upload byte for byte.
const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6bpIAAAAASUVORK5CYII=";
const password = "Playwright-Test-Admin-2026!";

test("compact barber catalogue preserves uploads, legacy clients and access restrictions", async ({ request, playwright, baseURL }) => {
  expect((await request.post("/api/admin/login", { data: { username: "admin", password } })).ok()).toBe(true);
  const created = await request.post("/api/barbers", { data: {
    name: "Avatar transport QA", specialty: "Corte", avatar: photo, isVisible: true, serviceIds: [],
  } });
  expect(created.status()).toBe(201);
  const barber = await created.json();
  const anonymous = await playwright.request.newContext({ baseURL });
  const path = `/api/barbers/${barber.id}`;
  try {
    const legacy = await (await anonymous.get("/api/barbers")).json();
    expect(legacy.find((item: any) => item.id === barber.id).avatar).toBe(photo);
    const compact = await (await anonymous.get("/api/barbers?avatarMode=reference")).json();
    const record = compact.find((item: any) => item.id === barber.id);
    expect(record.avatar).toMatch(new RegExp(`^${path}/avatar\\?v=[a-f0-9]{32}&locationId=\\d+$`));
    expect(record).not.toHaveProperty("password");
    expect(record).not.toHaveProperty("email");
    const response = await anonymous.get(record.avatar);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.body()).toEqual(Buffer.from(photo.split(",")[1], "base64"));
    // Whole-record clients must not overwrite uploads with read references.
    expect((await request.patch(path, { data: { bio: "Updated bio", avatar: record.avatar } })).ok()).toBe(true);
    expect((await (await request.get(path)).json()).avatar).toBe(photo);
    expect((await request.patch(path, { data: { avatar: "/api/barbers/999999/avatar?v=x" } })).status()).toBe(400);
    const replacement = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    expect((await request.patch(path, { data: { avatar: replacement } })).ok()).toBe(true);
    const updatedRecords = await (await anonymous.get("/api/barbers?avatarMode=reference")).json();
    const updatedReference = updatedRecords.find((item: any) => item.id === barber.id).avatar;
    expect(updatedReference).not.toBe(record.avatar);
    const updatedImage = await anonymous.get(updatedReference);
    expect(updatedImage.headers()["content-type"]).toContain("image/gif");
    expect(await updatedImage.body()).toEqual(Buffer.from(replacement.split(",")[1], "base64"));
    // A stale editor cannot restore the previous upload by sending its old reference.
    await request.patch(path, { data: { avatar: record.avatar, bio: "Stale editor" } });
    expect((await (await request.get(path)).json()).avatar).toBe(replacement);
    expect((await request.patch(path, { data: { isVisible: false } })).ok()).toBe(true);
    expect((await anonymous.get(record.avatar)).status()).toBe(404);
    expect((await request.get(record.avatar)).status()).toBe(200);
    expect((await request.patch(path, { data: { avatar: null } })).ok()).toBe(true);
    expect((await request.get(record.avatar)).status()).toBe(404);
    expect((await request.patch(path, { data: { avatar: "/images/demo-logo.svg" } })).ok()).toBe(true);
    const external = await (await request.get("/api/barbers?includeHidden=true&avatarMode=reference")).json();
    expect(external.find((item: any) => item.id === barber.id).avatar).toBe("/images/demo-logo.svg");
  } finally {
    await request.delete(path);
    await anonymous.dispose();
  }
});

test("Agenda skips photo bytes; team, edit, homepage and booking retain usable photos", async ({ page }) => {
  expect((await page.request.post("/api/admin/login", { data: { username: "admin", password } })).ok()).toBe(true);
  const barbers = await (await page.request.get("/api/barbers?includeHidden=true")).json();
  const barber = barbers.find((item: any) => item.isVisible);
  const path = `/api/barbers/${barber.id}`;
  await page.request.patch(path, { data: { avatar: photo } });
  const imageRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/barbers\/\d+\/avatar\?/.test(request.url())) imageRequests.push(request.url());
  });
  try {
    const catalogue = page.waitForResponse((response) => response.url().includes("/api/barbers?") && response.ok());
    await page.goto("/admin");
    expect(JSON.stringify(await (await catalogue).json())).not.toContain("data:image");
    await expect(page.getByRole("tab", { name: "Agenda", exact: true })).toBeVisible();
    expect(imageRequests).toHaveLength(0);
    await page.getByRole("tab", { name: "Equipa", exact: true }).click();
    const card = page.getByTestId("team-barber-card").filter({ hasText: barber.name });
    await expect.poll(() => card.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await card.getByRole("button", { name: "Editar", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Editar Barbeiro" });
    const update = page.waitForRequest((request) => request.method() === "PATCH" && new URL(request.url()).pathname === path);
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    expect((await update).postDataJSON()).not.toHaveProperty("avatar");
    await expect(dialog).not.toBeVisible();
    expect((await (await page.request.get(path)).json()).avatar).toBe(photo);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const teamImage = page.locator(`#team img[src*="/barbers/${barber.id}/avatar?"]`);
      await teamImage.scrollIntoViewIfNeeded();
      await expect.poll(() => teamImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    await page.goto("/booking");
    const bookingImage = page.locator(`img[src*="/barbers/${barber.id}/avatar?"]`).first();
    await expect(bookingImage).toBeVisible();
    await expect.poll(() => bookingImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  } finally {
    await page.request.patch(path, { data: { avatar: barber.avatar } });
  }
});
