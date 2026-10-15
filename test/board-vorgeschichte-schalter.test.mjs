// Schalter `vorgeschichte` (Issue #1537, Plan #1534 A7): an, außer er steht auf `false`
// (Issue #1727, Plan #1710).
import { test } from "node:test";
import assert from "node:assert/strict";
import { vorgeschichteAktiv } from "../kit/board/vorgeschichte.mjs";

test("Schalter fehlt: an", () => {
  assert.equal(vorgeschichteAktiv({}), true);
});

test("Schalter true: an", () => {
  assert.equal(vorgeschichteAktiv({ vorgeschichte: true }), true);
});

test("Schalter false: aus", () => {
  assert.equal(vorgeschichteAktiv({ vorgeschichte: false }), false);
});

test("Schalter als Zeichenkette \"false\": an, aus nur mit false", () => {
  assert.equal(vorgeschichteAktiv({ vorgeschichte: "false" }), true);
});

test("ohne Config: an", () => {
  assert.equal(vorgeschichteAktiv(undefined), true);
});
