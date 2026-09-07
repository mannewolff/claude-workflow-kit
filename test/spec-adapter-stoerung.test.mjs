// Die Stoerung des Adapters, gesehen von `apply` und `check --anker` (Issue #500).
//
// Beide Kommandos holen den Paket-Body und den Aktivitaetsverlauf ueber
// .claude/kit/board.mjs (A11), und beide bestehen darauf, dass eine Stoerung rot
// endet: Ein Ausfall des Trackers darf nicht aussehen wie ein Paket ohne Wirkung
// oder wie eine Karte ohne Anlage-Eintrag. Das ist dieselbe Fehlerklasse, die am
// 2026-09-01 an Issue #316 gefunden wurde — ein Gate, das bei Stoerung oeffnet,
// bescheinigt eine Pruefung, die nicht stattfand.
//
// **Warum hier ein praeparierter Adapter steht — und nur hier.** Mit dem echten
// kit/board.mjs sind diese Pfade nicht erreichbar: `paketeLesen` ruft je Paket
// zuerst `issue activity` und erst danach `issue get`, und der lokale Tracker
// liest fuer beides dieselbe Datei. Ein fehlendes Issue scheitert deshalb immer
// schon bei `activity`, und die Faelle "Exit 0, aber kein JSON" kann ein
// funktionierender Adapter grundsaetzlich nicht erzeugen. Die Entscheidung, dafuer
// einen Stub zuzulassen, steht in Issue #500; sie gilt fuer diese Datei und nicht
// darueber hinaus. helpers/spec-repo.mjs bleibt bei seinem Grundsatz "Kein Mock
// des Adapters, ausdruecklich" — der Stub wird hier ueber den kopierten echten
// Adapter geschrieben, nicht im Helfer.
//
// Der Stub antwortet nur mit dem gewuenschten Fehlverhalten, sonst nichts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mitRepo, spec, commit, kopf, specStand, SPEC_BLOCK } from "./helpers/spec-repo.mjs";

const KIT = [".claude", "kit"];

/**
 * Der praeparierte Adapter. Sein Verhalten je Unterbefehl steht in einer
 * Nachbardatei, damit der Quelltext fuer alle Faelle derselbe bleibt:
 *
 *   "ok"              gueltige Antwort, Exit 0
 *   "kein-json"       Exit 0, aber die Ausgabe ist kein JSON
 *   "exit-mit-grund"  Exit ungleich 0, mit einer Zeile auf stderr
 *   "exit-ohne-grund" Exit ungleich 0, ohne jede Meldung
 */
const STUB = `#!/usr/bin/env node
// Praeparierter Adapter fuer test/spec-adapter-stoerung.test.mjs (Issue #500).
import { readFileSync } from "node:fs";

const modi = JSON.parse(readFileSync(new URL("stub-modus.json", import.meta.url), "utf-8"));
const unterbefehl = process.argv[3];

switch (modi[unterbefehl] ?? "ok") {
  case "kein-json":
    process.stdout.write("<html>Ein Proxy hat geantwortet</html>\\n");
    break;
  case "exit-mit-grund":
    process.stderr.write("Der Tracker antwortet nicht.\\n");
    process.exit(3);
    break;
  case "exit-ohne-grund":
    process.exit(4);
    break;
  default:
    process.stdout.write(unterbefehl === "activity"
      ? JSON.stringify([{ type: "CREATED", createdAt: "2026-09-05T10:00:00Z" }])
      : JSON.stringify({ id: process.argv[4], body: "## Spec-Wirkung\\n\\nKEINE — dieses Paket aendert nichts.\\n" }));
}
`;

/**
 * Legt das Repo an, schreibt den Stub ueber den kopierten Adapter, setzt einen
 * Commit mit Marke und ruft `spec.mjs` mit dem Anker davor auf.
 */
function mitStoerung(modi, kommando, fn) {
  mitRepo({ specBlock: { ...SPEC_BLOCK, testGlobs: ["tests/**"] } }, (dir) => {
    writeFileSync(join(dir, ...KIT, "board.mjs"), STUB, "utf-8");
    writeFileSync(join(dir, ...KIT, "stub-modus.json"), JSON.stringify(modi), "utf-8");

    const anker = kopf(dir);
    commit(dir, "Arbeit an 7 (Issue #7)");

    // Der Stand vor dem Lauf ist der Massstab: Die Fixture liegt schon da, und
    // "unveraendert" heisst hier byte-gleich zu ihr, nicht leer.
    const vorher = specStand(dir);
    fn(spec(dir, ...kommando, "--anker", anker), () => {
      assert.equal(specStand(dir), vorher, "ein Fehler laesst die Beschreibung unangetastet");
    });
  });
}

// --- Der Body ist nicht lesbar ----------------------------------------------

test("apply: der Adapter scheitert beim Body — Exit 1, die Meldung nennt Paket und Grund", () => {
  mitStoerung({ get: "exit-mit-grund" }, ["apply"], (res, unveraendert) => {
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Paket #7 ist nicht lesbar: Der Tracker antwortet nicht\./,
      "der Grund des Adapters gehoert in die Meldung — sonst sucht ihn jemand von Hand");
    unveraendert();
  });
});

test("apply: der Adapter scheitert stumm — die Meldung nennt wenigstens den Exit-Code", () => {
  // Ohne diesen Rueckfall staende in der Meldung nichts hinter dem Doppelpunkt,
  // und der Leser wuesste nicht einmal, dass ueberhaupt etwas gelaufen ist.
  mitStoerung({ get: "exit-ohne-grund" }, ["apply"], (res) => {
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Paket #7 ist nicht lesbar: der Adapter endete mit 4/);
  });
});

test("apply: der Adapter liefert Exit 0, aber kein JSON — das ist ein Fehler, kein leeres Paket", () => {
  // Ein Proxy oder eine Fehlerseite mit Exit 0 ist der unangenehmste Fall: Wer
  // hier auf ein leeres Paket zurueckfaellt, laesst die Fortschreibung still an
  // der Wirkung vorbeilaufen.
  mitStoerung({ get: "kein-json" }, ["apply"], (res, unveraendert) => {
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Paket #7 ist nicht lesbar: der Adapter lieferte kein JSON \(/);
    unveraendert();
  });
});

// --- Der Aktivitaetsverlauf ist nicht lesbar --------------------------------

test("apply: der Verlauf kommt als Nicht-JSON — kein stilles Ueberspringen des Pakets", () => {
  // Eine leere Liste hiesse "Karte ohne Anlage-Eintrag" und damit "aelter als
  // seit" — ein Adapterfehler wuerde so zu einem uebersprungenen Paket.
  mitStoerung({ activity: "kein-json" }, ["apply"], (res, unveraendert) => {
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Paket #7: Aktivitaetsverlauf nicht lesbar: der Adapter lieferte kein JSON \(/);
    assert.doesNotMatch(res.stdout, /nicht gewertet/,
      "das Paket wurde nicht uebersprungen, sondern der Lauf abgebrochen");
    unveraendert();
  });
});

test("apply: der Verlauf scheitert stumm — auch hier steht der Exit-Code in der Meldung", () => {
  mitStoerung({ activity: "exit-ohne-grund" }, ["apply"], (res) => {
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Paket #7: Aktivitaetsverlauf nicht lesbar: der Adapter endete mit 4/);
  });
});

// --- Das Gate haelt bei derselben Stoerung ----------------------------------

test("check --anker: eine Stoerung des Adapters oeffnet das Gate nicht", () => {
  mitStoerung({ get: "exit-mit-grund" }, ["check"], (res) => {
    assert.equal(res.status, 1, "ein Gate, das bei Stoerung oeffnet, ist schlimmer als keins");
    assert.match(res.stderr, /Paket #7 ist nicht lesbar/);
    assert.doesNotMatch(res.stdout, /ohne Befund/);
  });
});

// --- Die Gegenprobe ---------------------------------------------------------

test("derselbe Stub ohne Stoerung laeuft gruen durch — die Faelle oben liegen am Fehlverhalten", () => {
  // Ohne diese Gegenprobe koennte jeder rote Lauf oben auch daran liegen, dass
  // der Stub grundsaetzlich nicht spricht, was spec.mjs erwartet.
  mitStoerung({}, ["apply"], (res) => {
    assert.equal(res.status, 0, `Exit ${res.status}, stderr: ${res.stderr}`);
    assert.match(res.stdout, /keine Aenderung/, "das Paket meldet 'KEINE' — es gibt nichts fortzuschreiben");
  });
});
