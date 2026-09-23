import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import test from "node:test";

async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForServer(baseUrl: string, output: () => string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // The child process has not opened the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out waiting for slot interval test server:\n${output()}`);
}

function futureThursdayIso(weeksAhead: number, hour: number, minute: number) {
  const date = new Date();
  const daysUntilThursday = (4 - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilThursday + weeksAhead * 7);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

test("HTTP creation enforces 15/30/60 and preserves 30 when the env is absent", { timeout: 90_000 }, async () => {
  const cases = [
    { raw: undefined, expected: 30, validMinute: 30, invalidMinute: 15 },
    { raw: "15", expected: 15, validMinute: 15, invalidMinute: 7 },
    { raw: "30", expected: 30, validMinute: 30, invalidMinute: 15 },
    { raw: "60", expected: 60, validMinute: 0, invalidMinute: 30 },
  ] as const;

  for (const [index, scenario] of cases.entries()) {
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    let output = "";
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "development",
      APP_ENV: "development",
      USE_MEMORY_STORAGE: "true",
      MULTI_LOCATION_ENABLED: "false",
      PUBLIC_BOOKING_MONTHLY_WINDOW_ENABLED: "false",
      APPOINTMENT_NOTIFICATION_EVENTS_ENABLED: "false",
      NOTIFICATION_OUTBOX_WORKER_ENABLED: "false",
      WHATSAPP_NOTIFICATIONS_ENABLED: "false",
      MESSAGING_PROVIDER: "none",
      RESEND_API_KEY: "",
      RESEND_FROM_EMAIL: "",
      DEMO_MODE: "false",
      SESSION_SECRET: "slot-runtime-http-test-secret",
      ADMIN_INITIAL_PASSWORD: "Slot-Runtime-HTTP-Test-Admin-2026!",
      PORT: String(port),
      BOOKING_SLOT_INTERVAL_MINUTES: scenario.raw,
    };
    const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      cwd: process.cwd(), env: environment, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });

    try {
      await waitForServer(baseUrl, () => output);
      const config = await (await fetch(`${baseUrl}/api/multi-location/config`)).json() as {
        bookingSlotIntervalMinutes: number;
      };
      assert.equal(config.bookingSlotIntervalMinutes, scenario.expected);

      const [barber] = await (await fetch(`${baseUrl}/api/barbers`)).json() as Array<{ id: number }>;
      const [service] = await (await fetch(`${baseUrl}/api/services`)).json() as Array<{ id: number }>;
      assert.ok(barber?.id && service?.id);

      const create = (minute: number, suffix: string) => fetch(`${baseUrl}/api/appointments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          barberId: barber.id,
          serviceId: service.id,
          startTime: futureThursdayIso(20 + index, 15, minute),
          customerName: `HTTP interval ${scenario.expected} ${suffix}`,
          customerPhone: `+351913${scenario.expected}${index}${suffix === "valid" ? "001" : "002"}`,
          customerEmail: `interval-${scenario.expected}-${suffix}@example.test`,
        }),
      });

      const invalidResponse = await create(scenario.invalidMinute, "invalid");
      assert.equal(invalidResponse.status, 400, await invalidResponse.text());
      const validResponse = await create(scenario.validMinute, "valid");
      assert.equal(validResponse.status, 201, await validResponse.text());
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      }
    }
  }
});
