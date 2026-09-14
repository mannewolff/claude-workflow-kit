// Die reinen Funktionen des Reviewer-Vorflugs (Issue #269).
//
// Der Vorflug laeuft in einer eigenen Session, weil ein Probelauf im Runner nur beweist,
// dass der RUNNER das Werkzeug starten darf. Die Session-Laeufe dazu gehoeren seit Plan
// #638 zu den Kette-Tests; hier stehen die drei Bausteine, die den Befund waehlen,
// schneiden und in die Form des Gates bringen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { trackerProbeId, parseVorflugBefund, normalisiereVorflug } from "../kit/night.mjs";

test("trackerProbeId: der erste Kandidat gewinnt, sonst das erste Issue der Liste", () => {
  assert.equal(trackerProbeId([{ id: 7 }, { id: 9 }], [{ id: 1 }]), "7");
  assert.equal(trackerProbeId([], [{ id: 1 }, { id: 2 }]), "1");
  assert.equal(trackerProbeId([], []), null);
  assert.equal(trackerProbeId([], null), null);
});

test("parseVorflugBefund: nimmt den letzten Block und vertraegt Prosa drumherum", () => {
  const text = 'Ich pruefe jetzt.\n<<<VORFLUG\n{"reviewers": []}\nVORFLUG>>>\nnoch ein Versuch:\n'
    + '<<<VORFLUG\n{"tracker": {"erreichbar": true}}\nVORFLUG>>>\n';
  assert.deepEqual(parseVorflugBefund(text), { tracker: { erreichbar: true } });
  assert.equal(parseVorflugBefund("alles gut"), null);
  assert.equal(parseVorflugBefund("<<<VORFLUG\nkein json\nVORFLUG>>>"), null);
  assert.equal(parseVorflugBefund("<<<VORFLUG\n{}"), null, "ohne Endmarker ist der Block nicht auswertbar");
});

test("normalisiereVorflug: Schweigen zaehlt nicht als Zustimmung", () => {
  const reviewers = [{ name: "opus", kind: "claude" }, { name: "fremd", kind: "command" }];
  const { reviewers: befunde, tracker } = normalisiereVorflug({ reviewers: [], tracker: {} }, reviewers);

  assert.deepEqual(befunde[0], { name: "opus", kind: "claude", umgebung: "review-session", verfuegbar: true });
  assert.equal(befunde[1].verfuegbar, false);
  assert.equal(befunde[1].umgebung, "review-session");
  assert.ok(befunde[1].grund.length > 0, "ein nicht verfuegbarer Reviewer braucht einen Grund");
  assert.equal(tracker.erreichbar, false);
  assert.ok(tracker.grund.length > 0);
});

test("normalisiereVorflug: ein uebersprungenes issue get bleibt erreichbar", () => {
  const { tracker } = normalisiereVorflug(
    { reviewers: [], tracker: { erreichbar: true, geprueft: "issue list", uebersprungen: "kein Issue vorhanden" } },
    [],
  );
  assert.equal(tracker.erreichbar, true);
  assert.equal(tracker.uebersprungen, "kein Issue vorhanden");
  assert.equal(tracker.grund, undefined);
});

test("normalisiereVorflug: nur ein ausdrueckliches true zaehlt", () => {
  const reviewers = [{ name: "fremd", kind: "command" }];
  for (const wert of ["true", 1, null, undefined]) {
    const { reviewers: befunde } = normalisiereVorflug({ reviewers: [{ name: "fremd", verfuegbar: wert }] }, reviewers);
    assert.equal(befunde[0].verfuegbar, false, `verfuegbar: ${JSON.stringify(wert)} darf nicht als ja gelten`);
  }
});

// --- Wenn die Vorflug-Session selbst nicht startet (Issue #405) ---
//
// Drei Fehlerarten, drei Meldungen. Sie zu unterscheiden ist nicht Kosmetik: Ein
// Zeitlimit heisst "zu langsam", ein ENOENT "gar nicht installiert", alles andere
// "etwas Drittes". Wer sie zusammenfasst, schickt den Menschen morgens in die
// falsche Ecke — genau der Fehler, den Issue #269 an den Reviewern behoben hat.
