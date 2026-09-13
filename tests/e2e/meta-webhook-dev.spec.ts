import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

test("Meta webhook DEV performs challenge and validates signed status payloads", async ({ request }) => {
  const valid = await request.get("/api/webhooks/whatsapp/meta?hub.mode=subscribe&hub.verify_token=playwright-verify-token&hub.challenge=challenge-123");
  expect(valid.status()).toBe(200);
  expect(await valid.text()).toBe("challenge-123");
  expect((await request.get("/api/webhooks/whatsapp/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x")).status()).toBe(403);

  const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "playwright-waba", changes: [{ field: "messages", value: {
    metadata: { phone_number_id: "playwright-phone" }, statuses: [{ id: "wamid.e2e.orphan", status: "sent", timestamp: "1893456000", recipient_id: "351910000000" }],
  } }] }] });
  const signature = `sha256=${createHmac("sha256", "playwright-app-secret").update(Buffer.from(payload)).digest("hex")}`;
  const accepted = await request.post("/api/webhooks/whatsapp/meta", { data: payload, headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature } });
  expect(accepted.status(), await accepted.text()).toBe(200);
  expect(await accepted.json()).toMatchObject({ received: true, recorded: 1, orphans: 1 });

  expect((await request.post("/api/webhooks/whatsapp/meta", { data: payload, headers: { "Content-Type": "application/json" } })).status()).toBe(401);
  expect((await request.post("/api/webhooks/whatsapp/meta", { data: payload, headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=bad" } })).status()).toBe(401);
});
