// Ablauf-Pruefung: Die Meldung nach jeder Stufe geht ueber das Board-Werkzeug als eigenen Prozess (laufMelden ruft board.mjs nightrun melden); nur dessen Mitschnitt zeigt, was das Haus verliesse.
//
// Der Kettenlauf meldet sich nach jeder Stufe (Issue #794).
//
// kanban-kit erklaert einen nicht abgeschlossenen Lauf fuer verstummt, wenn laenger als
// die Stillefrist keine neue Meldung kam; als Lebenszeichen zaehlt allein eine Meldung
// (kanban-kit #1086 AK 6). Zwischen der Startmeldung (Issue #743) und der ersten
// Paket-Meldung lag bis hierher die ganze Planungsphase — mit den Budgets dieses Repos
// bis zu 95 Minuten. Gemessen wird darum: Nach jeder erreichten Stufe genau eine
// Meldung, gleich mit welchem Ausgang die Stufe endet.
//
// Die Meldungen fangt `meldeCaptureInstallieren` ab. Weil der gemeldete Rumpf die Stufe
// nicht nennt, ordnet der Mitschnitt jede Meldung ueber die Zahl der bis dahin
// gelaufenen Fake-Sessions zu: 0 ist der Start, 1 steht hinter plan, 2 hinter review,
// 3 hinter pakete, 4 hinter abdeckung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import {
  repoRoot, run, mitProjekt, setupProjekt, fachplan, umgebung, stand,
  meldeCaptureInstallieren, PLAN_ANLEGEN, REVIEW_MARKER, REVIEW_HALT, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG, durchziehen,
} from "./helpers/kette-ablauf.mjs";

/** Ein Fixture-Projekt mit dem meldung-abfangenden Board-Umweg; die Capture-Datei liegt daneben. */
function mitCapture(fn, kette = {}) {
  const dir = setupProjekt(kette, "night-kette-melden-");
  const capture = join(dir, "..", `melde-capture-${basename(dir)}.jsonl`);
  meldeCaptureInstallieren(dir);
  try {
    fn(dir, capture);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(capture, { force: true });
  }
}

function meldungen(capture) {
  if (!existsSync(capture)) return [];
  return readFileSync(capture, "utf-8").trim().split("\n").filter(Boolean).map((z) => JSON.parse(z));
}

/** Die Umgebung eines Kettenlaufs mit erzwungener, mitgeschnittener Einlieferung. */
function meldeUmgebung(dir, capture, stufen, zusatz = {}) {
  return { ...umgebung(dir, { stufen }), NIGHT_MELDEN_ERZWINGEN: "1", KETTE_MELDE_CAPTURE: capture, ...zusatz };
}

const GLATT = { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN };

test("[night-61] ein Kettenlauf meldet nach dem Start und danach nach jeder erreichten Stufe genau einmal", () => {
  mitCapture((dir, capture) => {
    const F = fachplan(dir);
    const res = run(dir, ["--kette"], meldeUmgebung(dir, capture, GLATT));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(stand(dir).einheiten.find((e) => e.id === F).ausgang, "fertig");

    // Start (noch keine Session), dann je eine Meldung hinter plan, review, pakete und
    // abdeckung; danach der Ausgang der Ketten-Einheit und der Abschluss des Laufs.
    assert.deepEqual(meldungen(capture).map((m) => m.sessions), [0, 1, 2, 3, 4, 4, 4]);
    const g = meldungen(capture);
    assert.equal(g[0].meldung.complete, false, "die Startmeldung gilt nicht als abgeschlossen");
    assert.equal(g.at(-1).meldung.complete, true, "die Endmeldung eines regulaeren Laufs ist abgeschlossen");
  });
});

test("[night-61] unter Variante B folgen den vier Stufen die Meldungen der einzelnen Pakete", () => {
  mitCapture((dir, capture) => {
    const F = fachplan(dir);
    durchziehen(dir, F);
    const res = run(dir, ["--kette"], meldeUmgebung(dir, capture, { ...GLATT, umsetzung: UMSETZUNG_ERFOLG }));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(stand(dir).einheiten.find((e) => e.id === F).ausgang, "fertig");

    // Hinter den vier Stufen meldet jedes fertige Paket (Bestand seit Issue #669) —
    // zwei Umsetzungs-Sessions, danach der Ausgang der Kette und der Abschluss.
    assert.deepEqual(meldungen(capture).map((m) => m.sessions), [0, 1, 2, 3, 4, 5, 6, 6, 6]);
  });
});

test("[night-61] bricht eine Stufe ab, wird nach dieser Stufe gemeldet und danach folgt die Abschlussmeldung", () => {
  mitCapture((dir, capture) => {
    const F = fachplan(dir);
    const res = run(dir, ["--kette"], meldeUmgebung(dir, capture, { plan: PLAN_ANLEGEN, review: REVIEW_HALT }));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(stand(dir).einheiten.find((e) => e.id === F).ausgang, "angehalten");

    // Start, plan, review (angehalten) — danach keine Stufe mehr, dafuer der Ausgang der
    // Ketten-Einheit und der Abschluss des Laufs.
    assert.deepEqual(meldungen(capture).map((m) => m.sessions), [0, 1, 2, 2, 2]);
  });
});

test("[night-61] auch eine abgebrochene erste Stufe meldet, bevor die Kette endet", () => {
  mitCapture((dir, capture) => {
    const F = fachplan(dir);
    // Die Plan-Session legt keinen Plan an: die Stufe endet abgebrochen.
    const res = run(dir, ["--kette"], meldeUmgebung(dir, capture, {}));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(stand(dir).einheiten.find((e) => e.id === F).ausgang, "abgebrochen");

    assert.deepEqual(meldungen(capture).map((m) => m.sessions), [0, 1, 1, 1]);
  });
});

// Der strukturelle Beleg zu den drei Verhaltenstests: Nicht ein Ausgang nach dem
// anderen wird gemeldet, sondern die Stufe selbst — jeder Aufruf in `stufenDerKette`
// laeuft durch `mitMeldung`. Damit fuehrt kein Weg durch die Kette ueber zwei Stufen
// ohne Meldung, gleich welchen Ausgang eine Stufe nimmt.
test("[night-61] kein Weg durch stufenDerKette fuehrt ueber zwei Stufen ohne Meldung", () => {
  const quelle = readFileSync(join(repoRoot, "kit", "night", "kette.mjs"), "utf-8");
  const beginn = quelle.indexOf("async function stufenDerKette(");
  assert.notEqual(beginn, -1, "stufenDerKette nicht gefunden");
  const rumpf = quelle.slice(beginn, quelle.indexOf("\n}\n", beginn));
  // Seit Issue #1086 laeuft jede Stufe durch `stufeMitErgebnis`, das sie nur startet, wenn
  // ihr Ergebnis nicht schon vorliegt — gemeldet wird um diesen Aufruf herum.
  const zeilen = rumpf.split("\n").filter((z) => /\bstufeMitErgebnis\(kette, "(plan|review|pakete|abdeckung)"/.test(z));
  assert.equal(zeilen.length, 4, `vier Stufenaufrufe erwartet, gefunden:\n${zeilen.join("\n")}`);
  for (const z of zeilen) {
    assert.match(z.trim(), /mitMeldung\(\(\) => stufeMitErgebnis\(kette, "(plan|review|pakete|abdeckung)"/, `Stufe ohne Meldung: ${z.trim()}`);
  }
  // Die Stufen selbst stehen nur noch als `laufen` darin, nie als eigener Aufruf daneben.
  for (const z of rumpf.split("\n").filter((z) => /\bstufe(Plan|Review|Pakete|Abdeckung)\(/.test(z))) {
    assert.match(z.trim(), /^laufen: \(\) => stufe(Plan|Review|Pakete|Abdeckung)\(/, `Stufe ausserhalb von stufeMitErgebnis: ${z.trim()}`);
  }
});

test("[night-61] scheitert die Meldung nach einer Stufe, laeuft die Kette weiter und der Grund steht einmal im Protokoll", () => {
  mitCapture((dir, capture) => {
    const F = fachplan(dir);
    const res = run(dir, ["--kette"], meldeUmgebung(dir, capture, GLATT, { KETTE_MELDE_FEHLER: "1" }));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(stand(dir).einheiten.find((e) => e.id === F).ausgang, "fertig");
    assert.equal(stand(dir).abschluss, "regulaer");
    assert.deepEqual(meldungen(capture), [], "keine Meldung kam durch");
    const treffer = res.stdout.match(/Einlieferung fehlgeschlagen: /g) ?? [];
    assert.equal(treffer.length, 1, "dieselbe Zeile steht nur einmal im Protokoll");
  });
});

test("[night-61] ohne toolbox entfaellt die Meldung nach einer Stufe mit derselben einen Protokollzeile", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const res = run(dir, ["--kette"], umgebung(dir, { stufen: GLATT }));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(stand(dir).einheiten.find((e) => e.id === F).ausgang, "fertig");
    const treffer = res.stdout.match(/Einlieferung entfaellt: issueTracker 'local'/g) ?? [];
    assert.equal(treffer.length, 1, "meldezeile() fasst die wiederholte Zeile zu einer zusammen");
  });
});
