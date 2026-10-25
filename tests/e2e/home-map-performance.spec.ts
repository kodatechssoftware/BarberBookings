import { expect, test, type Page } from "@playwright/test";

type MapObserverHarness = {
  rootMargin: string;
  observed: boolean;
  idleScheduled: boolean;
  trigger: () => void;
  triggerIdle: () => void;
};

async function installMapObserverHarness(page: Page) {
  await page.addInitScript(() => {
    const harness: MapObserverHarness = {
      rootMargin: "",
      observed: false,
      idleScheduled: false,
      trigger: () => {},
      triggerIdle: () => {},
    };

    class MapIntersectionObserver {
      private readonly callback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.callback = callback;
        harness.rootMargin = options?.rootMargin ?? "";
        harness.trigger = () => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }

      observe() { harness.observed = true; }
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = harness.rootMargin;
      thresholds = [0];
    }

    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: MapIntersectionObserver,
    });
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: (callback: () => void) => {
        harness.idleScheduled = true;
        harness.triggerIdle = callback;
        return 1;
      },
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: () => {},
    });
    Object.defineProperty(window, "__mapObserverHarness", {
      configurable: true,
      value: harness,
    });
  });
}

test("starts the map after initial work becomes idle even when it remains far below the viewport", async ({ page }) => {
  await installMapObserverHarness(page);
  await page.route("https://www.google.com/maps**", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>Mapa</title>",
  }));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("location-map-container")).toBeAttached();
  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __mapObserverHarness?: MapObserverHarness }).__mapObserverHarness?.idleScheduled
  ))).toBe(true);
  await page.evaluate(() => {
    (window as Window & { __mapObserverHarness?: MapObserverHarness }).__mapObserverHarness?.triggerIdle();
  });

  await expect(page.locator("iframe[title^='Mapa de']")).toHaveAttribute("loading", "eager");
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`preloads the map before it reaches the viewport and keeps a useful placeholder on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installMapObserverHarness(page);

    let releaseMap!: () => void;
    const mapGate = new Promise<void>((resolve) => { releaseMap = resolve; });
    await page.route("https://www.google.com/maps**", async (route) => {
      await mapGate;
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Mapa</title>" });
    });

    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const container = page.getByTestId("location-map-container");
      const placeholder = page.getByTestId("location-map-placeholder");
      await expect(container).toBeAttached();
      await expect(placeholder).toBeVisible();
      await expect(placeholder).toContainText("A preparar o mapa");

      const before = await container.boundingBox();
      expect(before).toBeTruthy();
      expect(before!.height).toBeGreaterThan(200);
      expect(await page.locator("iframe[title^='Mapa de']").count()).toBe(0);

      await expect.poll(() => page.evaluate(() => {
        const harness = (window as Window & { __mapObserverHarness?: MapObserverHarness }).__mapObserverHarness;
        return { rootMargin: harness?.rootMargin, observed: harness?.observed };
      })).toEqual({ rootMargin: "200% 0px", observed: true });

      await page.evaluate(() => {
        (window as Window & { __mapObserverHarness?: MapObserverHarness }).__mapObserverHarness?.trigger();
      });

      const frame = page.locator("iframe[title^='Mapa de']");
      await expect(frame).toHaveAttribute("loading", "eager");
      await expect(frame).toHaveAttribute("src", /https:\/\/www\.google\.com\/maps/);
      await expect(placeholder).toBeVisible();
      expect(await placeholder.evaluate((element) => getComputedStyle(element).zIndex)).toBe("10");

      const during = await container.boundingBox();
      expect(during?.width).toBe(before!.width);
      expect(during?.height).toBe(before!.height);

      releaseMap();
      await expect(placeholder).toHaveCount(0);
      await expect(frame).toBeVisible();
      expect(await frame.evaluate((element) => getComputedStyle(element).position)).toBe("absolute");

      const after = await container.boundingBox();
      expect(after?.width).toBe(before!.width);
      expect(after?.height).toBe(before!.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      releaseMap();
    }
  });
}
