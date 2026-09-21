import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";
import type { StartupRecord } from "../../server/startup-timings";

// Run after npm run build. All requests/data remain in a fresh local memory store.
for (const [appEnv, flag, expected] of [
  ["development", "true", true], ["development", "false", false], ["production", "true", false],
] as const) {
  test(`release startup ${appEnv}/${flag}: diagnostics=${expected}, HTTP and auth unchanged`, { timeout: 30_000 }, async () => {
    const socket = net.createServer();
    await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const port = (socket.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    const base = `http://127.0.0.1:${port}`;
    const records: StartupRecord[] = [];
    let buffer = "";
    const child = spawn(process.execPath, ["dist/index.cjs"], { cwd: process.cwd(), windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"], env: {
        ...process.env, NODE_ENV: "production", APP_ENV: appEnv, PERFORMANCE_TIMINGS_ENABLED: flag,
        PORT: String(port), USE_MEMORY_STORAGE: "true", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
        DEMO_MODE: "false", MULTI_LOCATION_ENABLED: "false", MAX_LOCATIONS: "1", DATABASE_POOL_MAX: "4",
        PUBLIC_URL: "https://bookings.example.test", ALLOWED_ORIGINS: base,
        SESSION_SECRET: "local-startup-test-secret-more-than-32-characters", ADMIN_INITIAL_PASSWORD: "Startup-Test-Only-2026!",
        APPOINTMENT_NOTIFICATION_EVENTS_ENABLED: "false", NOTIFICATION_OUTBOX_WORKER_ENABLED: "false",
        WHATSAPP_NOTIFICATIONS_ENABLED: "false", META_WHATSAPP_WEBHOOK_ENABLED: "false", MESSAGING_PROVIDER: "none",
        META_WHATSAPP_RECURRING_NOTIFICATIONS_ENABLED: "false", META_WHATSAPP_INBOUND_AUTO_REPLY_ENABLED: "false",
        RESEND_API_KEY: "", RESEND_FROM_EMAIL: "", META_WHATSAPP_ACCESS_TOKEN: "",
      } });
    const exited = once(child, "exit");
    child.stderr.on("data", () => {});
    child.stdout.on("data", (data) => {
      buffer += String(data);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        if (line.startsWith("[startup] ")) records.push(JSON.parse(line.slice(10)));
      }
    });
    try {
      let ready = false;
      // Readiness deadline, not a latency assertion: shared CI hosts may be busy.
      const readyDeadline = Date.now() + 20_000;
      while (Date.now() < readyDeadline) {
        assert.equal(child.exitCode, null, "local server exited before listen");
        try { ready = (await fetch(`${base}/health`)).ok; } catch {}
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(ready, "local server must listen after startup");
      const services = await fetch(`${base}/api/services`);
      assert.equal(services.status, 200);
      assert.ok((await services.json() as unknown[]).length > 0);
      const login = await fetch(`${base}/api/admin/login`, { method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
        body: JSON.stringify({ username: "admin", password: "Startup-Test-Only-2026!" }),
      });
      assert.equal(login.status, 200);
      assert.equal((await login.json() as { authorized: boolean }).authorized, true);
      if (!expected) { assert.deepEqual(records, []); return; }
      const names = records.map((r) => r.phase);
      for (const phase of ["process-origin", "db-pool-configuration", "runtime-validation",
        "ensureServiceAgendaLabelColumn", "ensureAppointmentPaymentMethodColumn", "ensureBarberServicesTable",
        "ensureBarberCompensationRulesTable", "ensureBusinessExpensesTable", "ensureAppointmentOverlapProtection",
        "repairKnownTextEncodingArtifacts", "session-store-initialization", "seedDatabase", "registerRoutes",
        "workers", "static-setup", "http-configuration", "http-final-configuration", "total-before-listen",
        "http-listen", "starting-to-listen", "listening"] as const) assert.ok(names.includes(phase), phase);
      assert.ok(names.indexOf("repairKnownTextEncodingArtifacts") < names.indexOf("registerRoutes"));
      assert.ok(names.indexOf("registerRoutes") < names.indexOf("total-before-listen"));
      assert.ok(names.indexOf("total-before-listen") < names.indexOf("http-listen"));
      assert.equal(records.find((r) => r.phase === "workers")?.status, "skipped");
      assert.equal(records.find((r) => r.phase === "session-store-initialization")?.parent, "registerRoutes");
      assert.equal(records.find((r) => r.phase === "seedDatabase")?.parent, "registerRoutes");
      assert.ok(records.every((r) => r.durationMs >= 0 && r.status !== "error"));
      const encoded = JSON.stringify(records);
      for (const forbidden of ["password", "postgresql://", "Startup-Test-Only", "local-startup-test-secret", "customerPhone"]) {
        assert.equal(encoded.includes(forbidden), false);
      }
      console.log(JSON.stringify({ measurement: "local-memory-startup", phases: records.map(({ phase, durationMs, parent }) => ({ phase, durationMs, parent })) }));
    } finally {
      if (child.exitCode === null) child.kill();
      await exited;
    }
  });
}
