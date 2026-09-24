// Haelt die Bedeutung der drei Plan-Review-Ausdruecke aus kit/night.mjs fest, die
// SonarQube als super-linear meldet (S8786, Issue #877).
//
// Es war dreimal derselbe Ausdruck an drei Stellen: zweimal als blosse Marker-Probe
// (`\S` hinter dem Doppelpunkt), einmal als Wert-Auslese fuer den Bericht. Der Fund ist
// derselbe, den Issue #496 fuer REVIEW_MARKER_ZEILE behoben hat — das fuehrende `\s*`
// hinter `^` mit m-Flag —, und er wird auf demselben Weg behoben: Der Ausdruck sieht nur
// noch die getrimmte Zeile, den Leerraum am Zeilenanfang raeumt die Funktion ab.
//
// Bis auf drei Stellen liefen diese Tests gegen den Stand VOR dem Umbau gruen. Die drei
// sind die gewollte Verhaltensaenderung und stehen unten unter ihrer Ueberschrift.
//
// Die Laufzeitproben am Ende waren schon vorher gruen: Gemessen ist der alte Ausdruck
// linear (unter 1 ms bei 256 KiB), genau wie #496 es fuer REVIEW_MARKER_ZEILE fand.
// Umgebaut wird er trotzdem — SonarQube meldet ihn statisch —, und die Proben laufen
// weiter, damit die Umschrift die Linearitaet nicht kippt.

import { test } from "node:test";
import assert from "node:assert/strict";

import { hatPlanReviewMarker, planReviewWert } from "../kit/night.mjs";

test("planReviewWert liest den Pruefer aus der Zeile", () => {
  assert.equal(planReviewWert("Plan-Review: fable"), "fable");
  assert.equal(planReviewWert("Plan-Review: codex (2026-09-07)"), "codex (2026-09-07)");
  assert.equal(planReviewWert("## Kontext\nText\nPlan-Review: fable\n\n## Aufgabe\n"), "fable");
  assert.equal(planReviewWert("  Plan-Review: fable"), "fable", "Einrueckung ist erlaubt");
  assert.equal(planReviewWert("\tPlan-Review: fable"), "fable", "Tabs zaehlen als Leerraum");
});

test("planReviewWert stutzt den Leerraum um den Wert, nicht den darin", () => {
  assert.equal(planReviewWert("Plan-Review:   fable   "), "fable");
  assert.equal(planReviewWert("Plan-Review:\tfable\t"), "fable");
  assert.equal(planReviewWert("Plan-Review: opus und fable"), "opus und fable",
    "innen liegender Leerraum gehoert zum Wert");
  assert.equal(planReviewWert("Plan-Review:fable"), "fable");
  // Der Wert endet am Zeilenende, nicht am Bodyende.
  assert.equal(planReviewWert("Plan-Review: fable\nText\n"), "fable");
});

test("planReviewWert: ohne Wert und ohne Zeile ist die Antwort null", () => {
  assert.equal(planReviewWert("Plan-Review:"), null);
  assert.equal(planReviewWert("## Kontext\nkein Marker\n"), null);
  assert.equal(planReviewWert("Der Plan-Review: fable"), null, "nur am Zeilenanfang");
  assert.equal(planReviewWert(""), null);
  assert.equal(planReviewWert(null), null);
  assert.equal(planReviewWert(undefined), null);
});

test("planReviewWert findet den Marker auch bei CRLF-Zeilenenden", () => {
  // night.mjs entfernt vor dieser Pruefung kein `\r` — derselbe Punkt wie bei
  // hasReviewMarker (Issue #496). Ein `[ \t]` waere hier zu eng gewesen.
  assert.equal(planReviewWert("## Kontext\r\nPlan-Review: fable\r\n"), "fable");
  assert.equal(planReviewWert("  \r\n  Plan-Review: codex\r\n"), "codex");
  assert.equal(planReviewWert("Plan-Review:\r"), null, String.raw`ein \r ist kein Wert`);
});

test("hatPlanReviewMarker antwortet auf dieselbe Frage wie planReviewWert", () => {
  for (const body of [
    "Plan-Review: fable",
    "  Plan-Review: codex (2026-09-07)",
    "## Kontext\r\nPlan-Review: fable\r\n",
    "Plan-Review:",
    "Plan-Review:    ",
    "kein Marker",
    "",
    null,
  ]) {
    assert.equal(hatPlanReviewMarker(body), planReviewWert(body) !== null,
      `Body ${JSON.stringify(body)}`);
  }
});

// --- Die gewollten Verhaltensaenderungen ------------------------------------
//
// Zwei Stellen antworten nach dem Umbau anders als vorher. Beide Male, weil die zwei
// alten Ausdruecke — die Marker-Probe und die Wert-Auslese — sich UNEINIG waren: Sie
// standen fuer dieselbe Frage an drei Stellen und beantworteten sie verschieden. Nach
// dem Umbau tragen beide Funktionen denselben Ausdruck, und damit muss eine der beiden
// Antworten gewinnen. Es gewinnt jeweils die des Markers, denn an ihm haengt die
// Entscheidung des Nachtlaufs; die Wert-Auslese fuellt nur eine Berichtszeile.

test("eine Zeile aus lauter Leerraum hinter dem Doppelpunkt traegt keinen Pruefer", () => {
  // Vorher: Die Wert-Auslese `\s*(.+?)\s*$` gab hier ' ' zurueck — der Bericht haette
  // ein Leerzeichen als Pruefer gedruckt —, waehrend die Marker-Probe `\s*\S` schon
  // damals `false` sagte. Jetzt sagen beide dasselbe.
  assert.equal(planReviewWert("Plan-Review:    "), null);
  assert.equal(hatPlanReviewMarker("Plan-Review:    "), false);
});

test("ein Marker ueber Zeilengrenzen zaehlt nicht", () => {
  // Vorher: Die Wert-Auslese las 'fable' aus der Folgezeile, weil `\s*` den Umbruch
  // mitnahm; die Marker-Probe tat dasselbe. Dieselbe Entscheidung wie in Issue #496 fuer
  // hasReviewMarker: Nur eine Zeile, die mit 'Plan-Review:' beginnt und DANACH auf
  // derselben Zeile etwas traegt, zaehlt.
  assert.equal(planReviewWert("Plan-Review:\nfable"), null);
  assert.equal(hatPlanReviewMarker("Plan-Review:\nfable"), false);
});

// --- Laufzeitproben ---------------------------------------------------------

const SEHR_GROSS = 256 * 1024;
const GRENZE_MS = 100;

function dauer(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

// Dieselben drei Formen, mit denen Issue #496 REVIEW_MARKER_ZEILE vermessen hat: Das
// fuehrende `\s*` ist der teure Teil, also braucht die Eingabe Leerraum VOR dem Kopf.
const FORMEN = [
  ["Leerraum, dann Kopf ohne Wert", (n) => `${" ".repeat(n)}Plan-Review:`],
  ["viele eingerueckte Zeilen ohne Wert", (n) => "   Plan-Review:\n".repeat(n / 17)],
  ["Kopf, dann Leerraum, dann ein Zeichen", (n) => `Plan-Review:${" ".repeat(n)}x\ny`],
];

for (const [name, lauf] of [["planReviewWert", planReviewWert], ["hatPlanReviewMarker", hatPlanReviewMarker]]) {
  test(`${name} bleibt bei 256 KiB in jeder Form unter ${GRENZE_MS} ms`, (t) => {
    for (const [was, bau] of FORMEN) {
      const text = bau(SEHR_GROSS);
      const ms = dauer(() => lauf(text));
      t.diagnostic(`${name}, ${was}: ${ms.toFixed(2)} ms`);
      assert.ok(ms < GRENZE_MS, `${name}, ${was}: ${ms.toFixed(1)} ms — erwartet unter ${GRENZE_MS} ms`);
    }
  });
}
