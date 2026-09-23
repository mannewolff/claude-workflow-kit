// Die Merkmal-Pruefung von kit/checks.mjs (Issue #858, Plan #810, Fachplan #769 AK 2).
//
// Ein Build-Kommando kann mit Rueckgabewert 0 enden und trotzdem gescheitert
// sein — Maven meldet einen fehlgeschlagenen Checkstyle-Lauf in der Ausgabe und
// gibt je nach Aufrufkette eine 0 zurueck. Bis hierher stand die Regel „pruefe
// die Ausgabe zusaetzlich auf allgemeine Fehlermerkmale" im Text von
// `/local-check`, und eine Regel im Prompt wirkt nicht unter Druck. Jetzt prueft
// das Werkzeug selbst.
//
// Die Gegenprobe laeuft gegen ZWEI ECHTE Maven-Logs unter `test/fixtures/`
// (Entscheidung des Issues): je ein gruener und ein roter `mvn verify` aus
// kanban-kit, gekuerzt auf den Teil, der die Aussage traegt. Selbstgebaute
// Ausgaben pruefen nur das Projekt mit der harmlosesten Ausgabe — das gruene Log
// traegt Spring-Boot-Zeilen, Surefire-Ergebnisse und JaCoCo-Ausgaben und darf
// trotzdem nicht anschlagen.
//
// Die Merkmale stehen hier NICHT woertlich: Diese Suite laeuft selbst unter der
// Merkmal-Pruefung dieses Repos, und ein Merkmal in einem Testnamen faerbte den
// eigenen Prueflauf rot. Deshalb setzt der Test sie zur Laufzeit zusammen, und
// die Kommando-Ausgaben der Fixture-Laeufe werden eingesammelt statt
// durchgereicht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { mitRepo, run, zusammenfassung, datei, eintrag } from "./helpers/checks-repo.mjs";
import { fehlermerkmal } from "../kit/checks.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die beiden Merkmale, zur Laufzeit gebaut — siehe Kopfkommentar. */
const MERKMAL_STUFE = `${String.fromCharCode(91)}ERROR${String.fromCharCode(93)}`;
const MERKMAL_BAU = ["BUILD", "FAILURE"].join(" ");

const BEREICHE = { frontend: ["frontend/**"] };

/**
 * Ein Kommando, das den Text ausgibt und mit 0 endet — der Fall, um den es geht.
 * Der Text steht in einfachen Anfuehrungszeichen innerhalb der doppelten: So
 * bleibt die eckige Klammer der Shell verborgen und wird nicht als Dateimuster
 * gelesen. `node -e` statt `echo`, damit POSIX und Windows dasselbe sehen.
 */
function gibtAus(text) {
  return `node -e "console.log('${text}')"`;
}

/** Dasselbe fuer eine Datei: liest sie und schreibt sie unveraendert auf stdout. */
function zeigt(pfad) {
  return `node -e "process.stdout.write(require('node:fs').readFileSync(process.argv.at(-1),'utf-8'))" ${pfad}`;
}

/** Legt eines der echten Maven-Logs im Wegwerf-Repo ab. */
function fixtureLegen(dir, name) {
  copyFileSync(join(repoRoot, "test", "fixtures", name), join(dir, name));
}

function fixtureText(name) {
  return readFileSync(join(repoRoot, "test", "fixtures", name), "utf-8");
}

// --- Die Funktion selbst ----------------------------------------------------

test("das erste Merkmal der Liste gilt, auch wenn das zweite fruehere Zeilen traegt", () => {
  assert.equal(fehlermerkmal(`x\n${MERKMAL_BAU}\ny\n${MERKMAL_STUFE}\n`), MERKMAL_STUFE);
  assert.equal(fehlermerkmal(`nur das zweite: ${MERKMAL_BAU}`), MERKMAL_BAU);
});

test("eine Ausgabe ohne Merkmal und die leere Ausgabe ergeben null", () => {
  assert.equal(fehlermerkmal("alles gut, 42 Tests gruen\n"), null);
  assert.equal(fehlermerkmal(""), null);
});

test("das echte gruene Maven-Log schlaegt nicht an", () => {
  // Der Fall, der die Pruefung wertlos machen wuerde, wenn er anschlaegt: ein
  // vollstaendiger gruener Lauf mit Warnungen, Testzeilen und Plugin-Ausgaben.
  assert.equal(fehlermerkmal(fixtureText("mvn-verify-gruen.log")), null);
});

test("das echte rote Maven-Log schlaegt an und nennt das erste Merkmal der Liste", () => {
  assert.equal(fehlermerkmal(fixtureText("mvn-verify-rot.log")), MERKMAL_STUFE);
});

// --- Im Lauf ----------------------------------------------------------------

for (const [wie, merkmal] of [["ersten", MERKMAL_STUFE], ["zweiten", MERKMAL_BAU]]) {
  test(`ein Kommando mit Rueckgabewert 0 und dem ${wie} Merkmal in der Ausgabe wird rot`, () => {
    const cmd = gibtAus(merkmal);
    const config = {
      buildChecks: [{ cmd, always: true }, { cmd: "echo x > danach.txt", always: true }],
      checkAreas: BEREICHE,
    };
    mitRepo({ config }, (dir) => {
      datei(dir, "frontend/src/App.tsx");

      const res = run(dir);

      assert.notEqual(res.status, 0, "ein Fehlermerkmal muss den Exit-Code rot faerben");
      assert.match(res.stdout, /Fehlermerkmal in der Ausgabe/);
      assert.match(res.stdout, /der Lauf gilt als rot/);
      const summary = zusammenfassung(dir);
      assert.equal(eintrag(summary.laufen, cmd).ergebnis, "rot");
      assert.equal(eintrag(summary.laufen, cmd).fehlermerkmal, merkmal);
      // Wie bei jedem roten Kommando: der Rest startet nicht.
      assert.equal(eintrag(summary.laufen, "echo x > danach.txt").ergebnis, "nicht gestartet");
    });
  });
}

test("ein gruenes Kommando ohne Merkmal bleibt gruen und traegt das Feld nicht", () => {
  const cmd = gibtAus("alles gut");
  mitRepo({ config: { buildChecks: [{ cmd, always: true }], checkAreas: BEREICHE } }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.equal(res.status, 0, "ein Lauf ohne Merkmal muss gruen bleiben");
    assert.doesNotMatch(res.stdout, /Fehlermerkmal/);
    const gelaufen = eintrag(zusammenfassung(dir).laufen, cmd);
    assert.equal(gelaufen.ergebnis, "gruen");
    assert.equal(gelaufen.fehlermerkmal, undefined);
  });
});

test("ein Guete-Eintrag mit Fehlermerkmal wird nicht ausgewertet und nennt den Grund", () => {
  // Ohne diesen Zweig bescheinigte der Anteil aus der Ausgabe eine Messung, die
  // es nicht gab — dieselbe Begruendung wie beim roten Kommando, nur eine Stufe
  // frueher: Der Rueckgabewert war hier 0.
  const cmd = gibtAus(`Killed 42 (84%) ${MERKMAL_STUFE}`);
  const config = {
    buildChecks: [{ cmd, always: true, guete: { muster: String.raw`\((\d+)%\)`, marke: 80 } }],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.notEqual(res.status, 0, "ein Fehlermerkmal muss den Lauf rot faerben");
    const guete = zusammenfassung(dir).guete;
    assert.equal(guete.anteil, null, "aus einer Ausgabe mit Fehlermerkmal wird kein Anteil erhoben");
    assert.equal(guete.erfuellt, false);
    assert.match(guete.grund, /Fehlermerkmal/);
    assert.ok(
      guete.grund.includes(MERKMAL_STUFE),
      "der Grund nennt das getroffene Merkmal nicht",
    );
    assert.doesNotMatch(guete.grund, /das Kommando selbst war rot/);
  });
});

// --- Die echten Logs als Lauf ------------------------------------------------

test("das gruene Maven-Log als Pruefkommando bleibt gruen", () => {
  const cmd = zeigt("mvn-verify-gruen.log");
  mitRepo({ config: { buildChecks: [{ cmd, always: true }], checkAreas: BEREICHE } }, (dir) => {
    fixtureLegen(dir, "mvn-verify-gruen.log");

    const res = run(dir);

    assert.equal(res.status, 0, "ein echtes gruenes Maven-Log darf nicht anschlagen");
    assert.equal(eintrag(zusammenfassung(dir).laufen, cmd).ergebnis, "gruen");
  });
});

test("das rote Maven-Log als Pruefkommando wird rot", () => {
  const cmd = zeigt("mvn-verify-rot.log");
  mitRepo({ config: { buildChecks: [{ cmd, always: true }], checkAreas: BEREICHE } }, (dir) => {
    fixtureLegen(dir, "mvn-verify-rot.log");

    const res = run(dir);

    assert.notEqual(res.status, 0, "ein echtes rotes Maven-Log muss den Lauf rot faerben");
    const gelaufen = eintrag(zusammenfassung(dir).laufen, cmd);
    assert.equal(gelaufen.ergebnis, "rot");
    assert.equal(gelaufen.fehlermerkmal, MERKMAL_STUFE);
  });
});
