import { expect, test } from "@playwright/test";

const password = "Playwright-Test-Admin-2026!";

test("browser reuses a versioned avatar and fetches a changed photo immediately", async ({ page }) => {
  expect((await page.request.post("/api/admin/login", {
    data: { username: "admin", password },
  })).ok()).toBe(true);

  const bytes = Buffer.alloc(256 * 1024, 0x61);
  const avatar = `data:image/png;base64,${bytes.toString("base64")}`;
  const created = await page.request.post("/api/barbers", {
    data: {
      name: "Avatar cache measurement",
      specialty: "QA",
      avatar,
      isVisible: true,
      serviceIds: [],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const barber = await created.json();

  try {
    const catalogue = await (await page.request.get("/api/barbers?avatarMode=reference")).json();
    const reference = catalogue.find((item: any) => item.id === barber.id).avatar as string;
    await page.goto("/");
    const metrics = await page.evaluate(async (url) => {
      performance.clearResourceTimings();
      const samples = [];
      for (let index = 0; index < 3; index += 1) {
        const startedAt = performance.now();
        const response = await fetch(url);
        const body = await response.arrayBuffer();
        samples.push({
          index,
          status: response.status,
          cacheControl: response.headers.get("cache-control"),
          bytes: body.byteLength,
          durationMs: performance.now() - startedAt,
        });
      }
      const resources = performance.getEntriesByName(new URL(url, location.href).href)
        .map((entry) => {
          const resource = entry as PerformanceResourceTiming;
          return {
            durationMs: resource.duration,
            transferSize: resource.transferSize,
            encodedBodySize: resource.encodedBodySize,
            decodedBodySize: resource.decodedBodySize,
          };
        });
      return { samples, resources };
    }, reference);
    expect(metrics.samples).toHaveLength(3);
    expect(metrics.samples.every((sample) => sample.status === 200)).toBe(true);
    expect(metrics.samples.every((sample) => sample.cacheControl === "private, max-age=86400, immutable")).toBe(true);
    expect(metrics.samples.every((sample) => sample.bytes === bytes.byteLength)).toBe(true);
    expect(metrics.resources).toHaveLength(3);
    expect(metrics.resources[0].transferSize).toBeGreaterThanOrEqual(bytes.byteLength);
    expect(metrics.resources[1].transferSize).toBe(0);
    expect(metrics.resources[2].transferSize).toBe(0);

    await page.reload();
    const reloadMetric = await page.evaluate(async (url) => {
      performance.clearResourceTimings();
      const response = await fetch(url);
      await response.arrayBuffer();
      const resource = performance.getEntriesByName(new URL(url, location.href).href)[0] as PerformanceResourceTiming;
      return { cacheControl: response.headers.get("cache-control"), transferSize: resource.transferSize };
    }, reference);
    expect(reloadMetric).toEqual({
      cacheControl: "private, max-age=86400, immutable",
      transferSize: 0,
    });

    const replacementBytes = Buffer.alloc(256 * 1024, 0x62);
    const replacement = `data:image/png;base64,${replacementBytes.toString("base64")}`;
    expect((await page.request.patch(`/api/barbers/${barber.id}`, { data: { avatar: replacement } })).ok()).toBe(true);
    const updatedCatalogueResponse = await page.request.get("/api/barbers?avatarMode=reference");
    const updatedCatalogueText = await updatedCatalogueResponse.text();
    expect(Buffer.byteLength(updatedCatalogueText)).toBeLessThan(10_000);
    expect(updatedCatalogueText).not.toContain("data:image");
    const updatedReference = JSON.parse(updatedCatalogueText)
      .find((item: any) => item.id === barber.id).avatar as string;
    expect(updatedReference).not.toBe(reference);
    const changedPhoto = await page.evaluate(async (url) => {
      performance.clearResourceTimings();
      const response = await fetch(url);
      const body = new Uint8Array(await response.arrayBuffer());
      const resource = performance.getEntriesByName(new URL(url, location.href).href)[0] as PerformanceResourceTiming;
      return { firstByte: body[0], transferSize: resource.transferSize };
    }, updatedReference);
    expect(changedPhoto.firstByte).toBe(0x62);
    expect(changedPhoto.transferSize).toBeGreaterThanOrEqual(replacementBytes.byteLength);
  } finally {
    await page.request.delete(`/api/barbers/${barber.id}`);
  }
});
