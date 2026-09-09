import { expect, test } from "@playwright/test";

test("o teste Meta exige admin e mantem WhatsApp desativado por defeito", async ({ request }) => {
  const unauthenticated = await request.post("/api/admin/dev/whatsapp/meta/test", {
    data: { recipient: "+351911111111" },
  });
  expect(unauthenticated.status()).toBe(401);

  const login = await request.post("/api/admin/login", {
    data: {
      username: "admin",
      password: "Playwright-Test-Admin-2026!",
    },
  });
  expect(login.ok()).toBe(true);

  const disabled = await request.post("/api/admin/dev/whatsapp/meta/test", {
    data: { recipient: "+351911111111" },
  });
  expect(disabled.status()).toBe(400);
  expect(await disabled.json()).toEqual({
    message: "As notificacoes WhatsApp estao desativadas em Development.",
  });

  const missingRecord = await request.get("/api/admin/dev/whatsapp/meta/test/999999");
  expect(missingRecord.status()).toBe(404);
});
