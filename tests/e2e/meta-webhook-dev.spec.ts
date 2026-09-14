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

  const inboundPayload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "playwright-waba", changes: [{ field: "messages", value: {
    metadata: { phone_number_id: "playwright-phone", display_phone_number: "+351 210 000 000" },
    messages: [{ id: "wamid.e2e.inbound", from: "351910000000", timestamp: "1893456000", type: "text",
      text: { body: "este conteudo nao deve ser persistido" } }],
  } }] }] });
  const inboundSignature = `sha256=${createHmac("sha256", "playwright-app-secret").update(Buffer.from(inboundPayload)).digest("hex")}`;
  const inbound = await request.post("/api/webhooks/whatsapp/meta", { data: inboundPayload,
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": inboundSignature } });
  expect(inbound.status(), await inbound.text()).toBe(200);
  expect(await inbound.json()).toMatchObject({ received: true, inboundEligible: 1, autoReplies: 0 });

  expect((await request.post("/api/webhooks/whatsapp/meta", { data: payload, headers: { "Content-Type": "application/json" } })).status()).toBe(401);
  expect((await request.post("/api/webhooks/whatsapp/meta", { data: payload, headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=bad" } })).status()).toBe(401);
});
