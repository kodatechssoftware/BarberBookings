import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAgendaServiceLabel } from "../../shared/agenda-service-label";

test("Agenda uses the configured agendaLabel for the current catalog service", () => {
  const service = { name: "Tratamento facial completo", agendaLabel: "Facial" };

  assert.equal(getAgendaServiceLabel(service), "Facial");
  assert.equal(getAgendaServiceLabel(service, "Tratamento facial completo"), "Facial");
});

test("Agenda falls back to the service name without domain heuristics", () => {
  assert.equal(
    getAgendaServiceLabel({ name: "Corte degradê + barba", agendaLabel: null }),
    "Corte degradê + barba",
  );
  assert.equal(
    getAgendaServiceLabel({ name: "Massagem relaxante", agendaLabel: "  " }),
    "Massagem relaxante",
  );
  assert.equal(getAgendaServiceLabel(undefined), "Serviço");
});

test("Agenda preserves an appointment snapshot instead of relabeling it with current catalog copy", () => {
  assert.equal(
    getAgendaServiceLabel(
      { name: "Serviço atual", agendaLabel: "Atual" },
      "Serviço histórico",
    ),
    "Serviço histórico",
  );
});

test("Weekly Agenda no longer contains haircut or beard name heuristics", () => {
  const source = readFileSync("client/src/components/admin/WeeklyAgenda.tsx", "utf8");

  assert.doesNotMatch(source, /includes\(["'](?:corte|cabelo|degrade|barba|simples)["']\)/i);
  assert.match(source, /getAgendaServiceLabel/);
});
