// Schalter `vorgeschichte` (Issue #1537, Plan #1534 A7): an nur bei echtem `true`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { vorgeschichteAktiv } from "../kit/board/vorgeschichte.mjs";

test("Schalter fehlt: aus", () => {
  assert.equal(vorgeschichteAktiv({}), false);
});

test("Schalter true: an", () => {
  assert.equal(vorgeschichteAktiv({ vorgeschichte: true }), true);
});

test("Schalter als Zeichenkette \"true\": aus", () => {
  assert.equal(vorgeschichteAktiv({ vorgeschichte: "true" }), false);
});

test("Schalter als Zahl 1: aus", () => {
  assert.equal(vorgeschichteAktiv({ vorgeschichte: 1 }), false);
});
