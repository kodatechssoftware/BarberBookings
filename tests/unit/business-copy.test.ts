import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { barberBusinessCopy } from "../../shared/business/copy/barber.pt";
import { beautyBusinessCopy } from "../../shared/business/copy/beauty.pt";
import { formatBusinessCopy } from "../../shared/business/copy/types";

function collectShape(value: unknown): unknown {
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return value.map(collectShape);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, collectShape(child)]),
    );
  }
  return typeof value;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

test("Barber and Beauty implement the complete typed Booking copy contract", () => {
  assert.deepEqual(collectShape(beautyBusinessCopy), collectShape(barberBusinessCopy));
  assert.ok(collectStrings(barberBusinessCopy).every((value) => value.trim().length > 0));
  assert.ok(collectStrings(beautyBusinessCopy).every((value) => value.trim().length > 0));
});

test("Barber Booking keeps the existing public wording", () => {
  const copy = barberBusinessCopy.booking;
  assert.deepEqual(copy.steps, ["Barbeiro", "Serviço", "Data e hora", "Detalhes"]);
  assert.equal(copy.professional.heading, "Seleciona o barbeiro");
  assert.equal(copy.professional.description, "Escolhe com quem queres marcar.");
  assert.equal(copy.professional.anyAvailable, "Qualquer barbeiro livre");
  assert.equal(copy.service.emptyProfessional, "Este barbeiro não tem serviços disponíveis para marcação online.");
  assert.equal(copy.dateTime.establishmentClosed, "A barbearia está fechada neste dia. Escolha outro dia com horários disponíveis.");
  assert.equal(copy.confirmation.deliveryFallbackWithoutEmail,
    "Se não receber a confirmação nos próximos minutos, contacte diretamente a barbearia.");
  assert.equal(copy.navigation.backPreviousAria, "Voltar ao passo anterior");
  assert.equal(copy.validation.exposeServerErrorMessage, true);
});

test("Beauty Booking uses neutral professional and establishment wording", () => {
  const copy = beautyBusinessCopy.booking;
  assert.deepEqual(copy.steps, ["Profissional", "Serviço", "Data e hora", "Detalhes"]);
  assert.equal(copy.professional.heading, "Selecione o profissional");
  assert.equal(copy.professional.anyAvailable, "Qualquer profissional disponível");
  assert.equal(copy.locations.description,
    "Escolha o estabelecimento para consultar os profissionais, serviços e horários disponíveis.");
  assert.equal(copy.dateTime.establishmentClosed,
    "O estabelecimento está fechado neste dia. Escolha outro dia com horários disponíveis.");
  assert.equal(copy.validation.exposeServerErrorMessage, false);

  const publicCopy = JSON.stringify(beautyBusinessCopy);
  assert.doesNotMatch(
    publicCopy,
    /Baptista|Powerhouse|barbeiro|barbeiros|barbearia|aluguer de cadeira/i,
  );
});

test("Booking templates format dynamic values without assembling domain sentences", () => {
  assert.equal(
    formatBusinessCopy(beautyBusinessCopy.booking.validation.phoneInvalid, {
      phoneLengthLabel: "9 dígitos",
      countryLabel: "Portugal",
    }),
    "Confirme que o número tem 9 dígitos para Portugal.",
  );
  assert.equal(
    formatBusinessCopy(beautyBusinessCopy.booking.confirmation.reserved, {
      customerName: "Maria",
      date: "10 de outubro",
      time: "14:30",
    }),
    "Obrigado, Maria. O seu horário está reservado para 10 de outubro às 14:30h.",
  );
});

test("Booking source contains no forbidden Beauty output literals outside known internal identifiers", () => {
  const source = readFileSync("client/src/pages/Booking.tsx", "utf8");
  const withoutKnownInternalReferences = source
    .split(/\r?\n/)
    .filter((line) => ![
      "fabio-baptista-avatar.jpg",
      "baptista:lastBooking",
      "name.includes(\"baptista\")",
    ].some((allowed) => line.toLowerCase().includes(allowed.toLowerCase())))
    .join("\n");

  assert.doesNotMatch(
    withoutKnownInternalReferences,
    /Baptista|Powerhouse|barbeiro|barbeiros|barbearia|aluguer de cadeira/i,
  );
});
