// Jede Modell-ID der Config-Vorlage braucht einen Eintrag in der Preistabelle (Issue #1337).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preisFuer } from "../kit/preise.mjs";

const VORLAGE = new URL("../templates/workflow.config.json", import.meta.url);

function modellIds(wert, pfad = "$") {
  if (typeof wert === "string") return wert.startsWith("claude-") ? [{ id: wert, pfad }] : [];
  if (Array.isArray(wert)) return wert.flatMap((w, i) => modellIds(w, `${pfad}[${i}]`));
  if (wert && typeof wert === "object") {
    return Object.entries(wert).flatMap(([k, w]) => modellIds(w, `${pfad}.${k}`));
  }
  return [];
}

function unbepreist(config) {
  return modellIds(config).filter(({ id }) => preisFuer(id) === null);
}

function meldung(funde) {
  return funde.map(({ id, pfad }) => `${pfad}: ${id} fehlt in kit/preise.mjs`).join("\n");
}

test("jede Modell-ID der Vorlage steht in der Preistabelle", () => {
  const config = JSON.parse(readFileSync(VORLAGE, "utf8"));
  assert.ok(modellIds(config).length > 0, "Vorlage traegt keine Modell-ID");
  const funde = unbepreist(config);
  assert.deepEqual(funde, [], meldung(funde));
});

test("Gegenprobe: eine erfundene ID wird mit Pfad gemeldet", () => {
  const config = { reviewModel: "claude-gibtsnicht-1", rollen: { a: { model: "claude-opus-5" } } };
  const funde = unbepreist(config);
  assert.deepEqual(funde, [{ id: "claude-gibtsnicht-1", pfad: "$.reviewModel" }]);
  assert.match(meldung(funde), /\$\.reviewModel: claude-gibtsnicht-1/);
});
