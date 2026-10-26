import { expect, test } from "@playwright/test";

const service = {
  id: 901,
  name: "Serviço preload QA",
  description: "Resposta pública antecipada",
  price: 1800,
  duration: 30,
  isVisible: true,
  categoryId: null,
};

const barber = {
  id: 902,
  name: "Profissional preload QA",
  specialty: "Barbeiro",
  bio: null,
  avatar: null,
  color: "#d4af37",
  isVisible: true,
  locationCount: 1,
  serviceIds: [service.id],
  allServicesAllowed: true,
};

const hours = [{ dayOfWeek: 2, startTime: "09:00", endTime: "20:00", isOpen: true }];

test("the early homepage reads are consumed once and later invalidations stay fresh", async ({ page }) => {
  const requests = { services: 0, barbers: 0, availability: 0 };
  await page.clock.setFixedTime(new Date("2026-09-15T10:00:00+01:00"));
  await page.route("**/api/services", async (route) => {
    requests.services += 1;
    await route.fulfill({ json: [service] });
  });
  await page.route("**/api/barbers?avatarMode=reference", async (route) => {
    requests.barbers += 1;
    await route.fulfill({ json: [barber] });
  });
  await page.route("**/api/shop/availability", async (route) => {
    requests.availability += 1;
    await route.fulfill({ json: hours });
  });

  await page.goto("/");
  await expect(page.getByText(service.name, { exact: true })).toBeVisible();
  await expect(page.getByText(barber.name, { exact: true })).toBeVisible();
  await expect(page.getByTestId("home-opening-card").getByText("Aberto hoje até às 20h")).toBeVisible();
  expect(requests).toEqual({ services: 1, barbers: 1, availability: 1 });

  await page.evaluate(async () => {
    const { queryClient } = await import("/src/lib/queryClient.ts");
    await queryClient.invalidateQueries({ queryKey: ["/api/services"] });
  });
  await expect.poll(() => requests.services).toBe(2);
  expect(requests.barbers).toBe(1);
  expect(requests.availability).toBe(1);
});

test("the preload preserves the selected location on every location-sensitive read", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("barberbookings:location-id", "7"));
  const observedHeaders: string[] = [];
  const fulfill = (data: unknown) => async (route: Parameters<Parameters<typeof page.route>[1]>[0]) => {
    observedHeaders.push(route.request().headers()["x-location-id"] || "");
    await route.fulfill({ json: data });
  };
  await page.route("**/api/services", fulfill([service]));
  await page.route("**/api/barbers?avatarMode=reference", fulfill([barber]));
  await page.route("**/api/shop/availability", fulfill(hours));
  await page.route("**/api/locations", (route) => route.fulfill({ json: [{
    id: 7,
    name: "Location QA",
    slug: "location-qa",
    address: "Rua QA",
    logoUrl: null,
    mapUrl: null,
    mapEmbedUrl: null,
    phone: null,
    email: null,
    timezone: "Europe/Lisbon",
    isActive: true,
    isDefault: true,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }] }));

  await page.goto("/");
  await expect(page.getByText(service.name, { exact: true })).toBeVisible();
  await expect(page.getByText(barber.name, { exact: true })).toBeVisible();
  await expect.poll(() => observedHeaders.length).toBe(3);
  expect(observedHeaders).toEqual(["7", "7", "7"]);
});
