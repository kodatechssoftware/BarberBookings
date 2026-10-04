import assert from "node:assert/strict";
import test from "node:test";
import {
  centsToMoneyInput,
  formatMoneyInputOnBlur,
  moneyInputToCents,
  normalizeMoneyInput,
} from "../../client/src/lib/money-input";

test("normalizes natural comma and point edits without unnecessary leading zeros", () => {
  assert.equal(normalizeMoneyInput("1"), "1");
  assert.equal(normalizeMoneyInput("1,5"), "1,5");
  assert.equal(normalizeMoneyInput("1,50"), "1,50");
  assert.equal(normalizeMoneyInput("1.50"), "1,50");
  assert.equal(normalizeMoneyInput("0,50"), "0,50");
  assert.equal(normalizeMoneyInput("021"), "21");
  assert.equal(normalizeMoneyInput("0,"), "0,");
  assert.equal(normalizeMoneyInput(",5"), "0,5");
  assert.equal(normalizeMoneyInput(""), "");
});

test("rejects edits and pasted values with more than two decimal places without truncation", () => {
  assert.equal(normalizeMoneyInput("0,558", "0,55"), "0,55");
  assert.equal(normalizeMoneyInput("12,345", "12,34"), "12,34");
  assert.equal(normalizeMoneyInput("1.9999", "1,99"), "1,99");
  assert.equal(normalizeMoneyInput("12,999", ""), "");
});

test("formats valid values on blur and keeps empty drafts editable", () => {
  assert.equal(formatMoneyInputOnBlur("21"), "21,00");
  assert.equal(formatMoneyInputOnBlur("021"), "21,00");
  assert.equal(formatMoneyInputOnBlur("5,5"), "5,50");
  assert.equal(formatMoneyInputOnBlur("0,5"), "0,50");
  assert.equal(formatMoneyInputOnBlur("36"), "36,00");
  assert.equal(formatMoneyInputOnBlur(""), "");
});

test("parses exact integer cents and enforces optional bounds", () => {
  assert.equal(moneyInputToCents("1"), 100);
  assert.equal(moneyInputToCents("1,5"), 150);
  assert.equal(moneyInputToCents("1.50"), 150);
  assert.equal(moneyInputToCents("12,99"), 1299);
  assert.equal(moneyInputToCents("0,50"), 50);
  assert.equal(moneyInputToCents("12,999"), null);
  assert.equal(moneyInputToCents("0", { minCents: 1 }), null);
  assert.equal(moneyInputToCents("100,01", { maxCents: 10_000 }), null);
  assert.equal(centsToMoneyInput(0), "0,00");
  assert.equal(centsToMoneyInput(1299), "12,99");
});
