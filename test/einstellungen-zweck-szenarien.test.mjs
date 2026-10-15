// Szenarien aus Plan #1710 (Fachplan #1705): Einstellungen nach Zweck und mit englischen Namen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalisiereConfig } from "../kit/board/config-namen.mjs";
import { vorgeschichteAktiv } from "../kit/board/vorgeschichte.mjs";

test("Szenario: Ältere Datei mit deutschen Namen", () => {
  // Angenommen auf einem älteren Zweig steht die Vorgeschichte noch unter ihrem deutschen Namen eingeschaltet
  const { config } = normalisiereConfig({ vorgeschichte: true, mainBranch: "main" });
  // Wenn auf diesem Zweig ein Fachplan entsteht, dann wirkt die Vorgeschichte wie eingeschaltet
  assert.equal(vorgeschichteAktiv(config), true);
});
