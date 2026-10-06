// Der Config-Schlüssel `pushPruefung` (Issue #1216, Plan #1199 E14).
//
// Er sagt, wo der volle Lauf vor `push main` stattfindet: `"lokal"` (Vorgabe) oder im
// Build-Dienst über einen Prüfzweig, `{ "ort": "buildDienst", "zweig": "<name>" }`. Die
// Pflicht ist in beiden Fällen dieselbe (W3) — nur der Ort wechselt. `checks.mjs plan
// --stufe push` gibt den Wert aus, damit `/push-main` die Config nicht selbst lesen muss.
//
// Das Schema wird mit dem Mini-Validator geprüft wie in test/config-schema-checks.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { pruefe } from "./helpers/mini-validator.mjs";
import { mitRepo, plan, checks } from "./helpers/checks-repo.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(repoRoot, "templates", "workflow.config.schema.json"), "utf-8"));
const feld = schema.properties.pushPruefung;
const BUILDDIENST = { ort: "buildDienst", zweig: "pruefung/push" };

// --- Schema ---

test("pushPruefung: das Schema kennt den Schlüssel mit der Vorgabe lokal", () => {
  assert.ok(feld, "pushPruefung fehlt im Schema");
  assert.equal(feld.default, "lokal");
  assert.equal(schema.defaults.pushPruefung, "lokal", "der defaults-Block nennt die Vorgabe nicht");
  assert.ok(
    feld.description.endsWith("Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert."),
    "die Beschreibung endet nicht mit der Standardformel"
  );
});

test("pushPruefung: das Schema nimmt \"lokal\" und das Build-Dienst-Objekt an", () => {
  assert.deepEqual(pruefe(feld, "lokal"), []);
  assert.deepEqual(pruefe(feld, BUILDDIENST), []);
});

test("pushPruefung: das Schema weist anderes ab", () => {
  for (const wert of [
    "buildDienst",
    "",
    true,
    { ort: "buildDienst" },
    { zweig: "pruefung/push" },
    { ort: "lokal", zweig: "x" },
    { ort: "buildDienst", zweig: "" },
    { ort: "buildDienst", zweig: "mit leerzeichen" },
    { ...BUILDDIENST, frist: 30 },
  ]) {
    assert.notDeepEqual(pruefe(feld, wert), [], `${JSON.stringify(wert)} wurde angenommen`);
  }
});

test("pushPruefung: die Vorlage trägt die Vorgabe lokal", () => {
  const vorlage = JSON.parse(readFileSync(join(repoRoot, "templates", "workflow.config.json"), "utf-8"));
  assert.equal(vorlage.pushPruefung, "lokal");
});

test("pushPruefung: die Einstellungs-Referenz kennt den Schlüssel, seine Werte und seine Unterfelder", () => {
  // Die Referenz entsteht mit tools/config-referenz.mjs aus dem Schema; dass die Doku
  // dem Werkzeug entspricht, hält test/ablauf-docs-einstellungen.test.mjs fest.
  const doku = readFileSync(join(repoRoot, "docs", "dokumentation.md"), "utf-8");
  assert.match(doku, /### `pushPruefung`\n\n[^\n]*\(gültig: `lokal`\)/, "Abschnitt oder Wert lokal fehlt");
  assert.match(doku, /- `pushPruefung\.ort` — [^\n]*\(gültig: `buildDienst`\)/, "Unterfeld ort fehlt");
  assert.match(doku, /- `pushPruefung\.zweig` — /, "Unterfeld zweig fehlt");
});

// --- checks.mjs plan ---

test("plan --stufe push: ohne Schlüssel steht pushPruefung auf lokal", () => {
  mitRepo({ config: { buildChecks: ["node -e 0"] } }, (dir) => {
    assert.equal(plan(dir, "--stufe", "push").pushPruefung, "lokal");
  });
});

test("plan --stufe push: der Build-Dienst-Wert geht unverändert ins JSON", () => {
  mitRepo({ config: { buildChecks: ["node -e 0"], pushPruefung: BUILDDIENST } }, (dir) => {
    assert.deepEqual(plan(dir, "--stufe", "push").pushPruefung, BUILDDIENST);
  });
});

test("plan ohne Stufe push: kein pushPruefung im JSON", () => {
  mitRepo({ config: { buildChecks: ["node -e 0"], pushPruefung: BUILDDIENST } }, (dir) => {
    assert.equal(plan(dir).pushPruefung, undefined);
    assert.equal(plan(dir, "--stufe", "merge").pushPruefung, undefined);
  });
});

test("plan --stufe push: ein ungültiger Wert ist ein Fehler, der den Schlüssel nennt", () => {
  for (const wert of ["buildDienst", { ort: "buildDienst" }, { ort: "irgendwo", zweig: "x" }]) {
    mitRepo({ config: { buildChecks: ["node -e 0"], pushPruefung: wert } }, (dir) => {
      const res = checks(dir, "plan", "--stufe", "push");
      assert.equal(res.status, 1, `${JSON.stringify(wert)} wurde angenommen: ${res.stdout}`);
      assert.match(res.stderr, /pushPruefung/);
    });
  }
});

test("plan --stufe push: der Prüfzweig darf nicht mainBranch oder productionBranch sein", () => {
  for (const zweig of ["main", "production"]) {
    mitRepo({ config: { buildChecks: ["node -e 0"], pushPruefung: { ort: "buildDienst", zweig } } }, (dir) => {
      const res = checks(dir, "plan", "--stufe", "push");
      assert.equal(res.status, 1, `Prüfzweig '${zweig}' wurde angenommen`);
      assert.match(res.stderr, new RegExp(`pushPruefung[^\\n]*'${zweig}'`));
    });
  }
});
