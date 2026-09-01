// Die Ausfuehrung der ausgewaehlten Pruefungen (Issue #424).
//
// `plan` entscheidet, `run` fuehrt aus — und hinterlaesst eine Zusammenfassung,
// aus der der Nacht-Runner spaeter liest (Issue #428). Drei Dinge muessen hier
// haltbar sein, weil ihr Ausfall jeweils still ist:
//   - Ausgelassenes laeuft wirklich nicht. Ein Kommando, das trotz Auslassung
//     startet, faellt niemandem auf, solange es gruen ist.
//   - Ein rotes Kommando bricht ab UND wird in der Zusammenfassung als rot
//     ausgewiesen. Ohne das Ergebnisfeld koennte der Runner einen Fehlschlag
//     nicht dem ausloesenden Paket zuordnen.
//   - Der Working Tree bleibt unveraendert. Die Zusammenfassung liegt zwar im
//     Projekt (.claude/), aber hinter der Ignore-Regel; taete sie es nicht,
//     stoppte der Nacht-Runner jede Runde hart auf dirty (Issue #152).
//
// Die Tests fahren Fake-Kommandos (`echo`, `exit 1`) statt echter Builds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  CHECKS, mitRepo, plan, run, zusammenfassung, treeStand, datei, kommandos, eintrag,
} from "./helpers/checks-repo.mjs";

/** Ein Kommando, dessen Lauf sich an einer Datei ablesen laesst statt an der Ausgabe. */
function marke(name) {
  return `echo x > ${name}`;
}

function gelaufen(dir, name) {
  return existsSync(join(dir, name));
}

const ERGEBNISSE = (liste) => liste.map((e) => e.ergebnis);

test("nur die ausgewaehlten Kommandos laufen, die ausgelassenen nennt die Ausgabe mit Grund", () => {
  const config = {
    buildChecks: [
      { cmd: marke("lief-frontend.txt"), areas: ["frontend"] },
      { cmd: marke("lief-backend.txt"), areas: ["backend"] },
    ],
    checkAreas: { frontend: ["frontend/**"], backend: ["backend/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stderr}`);
    assert.ok(gelaufen(dir, "lief-frontend.txt"), "die ausgewaehlte Pruefung ist nicht gelaufen");
    assert.ok(!gelaufen(dir, "lief-backend.txt"), "eine ausgelassene Pruefung ist trotzdem gelaufen");
    // Punkt 4 des Issues: Die Ausgabe wandert in den Bericht der aufrufenden
    // Skills — dort muss auch stehen, was NICHT lief und warum.
    assert.match(res.stdout, /ausgelassen/i);
    assert.match(res.stdout, /unberuehrt/);
  });
});

test("ein rotes Kommando bricht den Lauf ab: die nachfolgenden starten nicht, Exit ungleich 0", () => {
  const config = {
    buildChecks: [
      { cmd: marke("eins.txt"), always: true },
      { cmd: "exit 1", always: true },
      { cmd: marke("drei.txt"), always: true },
    ],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    const res = run(dir);

    assert.notEqual(res.status, 0, "ein roter Check muss den Exit-Code rot faerben");
    assert.ok(gelaufen(dir, "eins.txt"), "das erste Kommando haette laufen muessen");
    assert.ok(!gelaufen(dir, "drei.txt"), "nach dem roten Kommando darf nichts mehr starten");
  });
});

test("ein roter Lauf hinterlaesst eine Zusammenfassung, die das rote Kommando ausweist", () => {
  const config = {
    buildChecks: [
      { cmd: "echo eins", always: true },
      { cmd: "exit 1", always: true },
      { cmd: "echo drei", always: true },
    ],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    run(dir);
    const summary = zusammenfassung(dir);

    assert.deepEqual(kommandos(summary.laufen), ["echo eins", "exit 1", "echo drei"]);
    assert.deepEqual(ERGEBNISSE(summary.laufen), ["gruen", "rot", "nicht gestartet"]);
  });
});

test("die Zusammenfassung traegt Auswahl und Ergebnis — und der Working Tree bleibt unveraendert", () => {
  const config = {
    buildChecks: [
      { cmd: "echo build", areas: ["frontend"] },
      { cmd: "echo verify", areas: ["backend"] },
    ],
    checkAreas: { frontend: ["frontend/**"], backend: ["backend/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");
    const vorher = treeStand(dir);

    const res = run(dir);

    assert.equal(res.status, 0, res.stderr);
    assert.ok(
      existsSync(join(dir, ".claude", "checks-summary.json")),
      "die Zusammenfassung entsteht nicht unter .claude/",
    );
    const summary = zusammenfassung(dir);
    assert.match(summary.basis, /^[0-9a-f]{7,40}$/);
    assert.deepEqual(summary.geaendert, ["frontend/src/App.tsx"]);
    assert.deepEqual(summary.bereiche, ["frontend"]);
    assert.deepEqual(kommandos(summary.laufen), ["echo build"]);
    assert.equal(eintrag(summary.laufen, "echo build").ergebnis, "gruen");
    assert.match(eintrag(summary.laufen, "echo build").grund, /frontend/);
    assert.deepEqual(kommandos(summary.ausgelassen), ["echo verify"]);
    assert.match(eintrag(summary.ausgelassen, "echo verify").grund, /unberuehrt/);

    assert.equal(treeStand(dir), vorher, "der Lauf hat dem Working Tree etwas hinzugefuegt");
  });
});

test("leeres Paket: Exit 0, kein Kindprozess, Zusammenfassung trotzdem geschrieben", () => {
  // "Keine Pruefung, weil nichts veraendert wurde" ist ein Ergebnis und kein Loch
  // (Kriterium 10 aus Issue #420) — es muss in der Datei stehen.
  const config = {
    buildChecks: [{ cmd: marke("nie.txt"), always: true }],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    const res = run(dir);

    assert.equal(res.status, 0, `leeres Paket ist kein Fehler: ${res.stderr}`);
    assert.ok(!gelaufen(dir, "nie.txt"), "auf einem leeren Paket darf kein Kindprozess starten");
    const summary = zusammenfassung(dir);
    assert.equal(summary.leeresPaket, true);
    assert.deepEqual(summary.laufen, []);
    assert.deepEqual(kommandos(summary.ausgelassen), [marke("nie.txt")]);
    assert.match(eintrag(summary.ausgelassen, marke("nie.txt")).grund, /leeres Paket/);
  });
});

test("laesst sich die Zusammenfassung nicht schreiben, endet run rot und nennt den Pfad", () => {
  // Die Datei ist die Datenquelle des Runners — ihr Ausfall darf nicht
  // stillschweigend durchgehen, auch nicht bei gruenen Checks.
  const config = {
    buildChecks: [{ cmd: "echo gruen", always: true }],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");
    // Ein Verzeichnis am Zielpfad blockiert das Schreiben auf jeder Plattform —
    // anders als ein Rechte-Entzug, der als root wirkungslos bliebe.
    mkdirSync(join(dir, ".claude", "checks-summary.json"), { recursive: true });

    const res = run(dir);

    assert.notEqual(res.status, 0, "eine nicht schreibbare Zusammenfassung muss rot enden");
    assert.match(res.stderr, /checks-summary\.json/, "die Meldung nennt den Pfad nicht");
  });
});

test("run und plan treffen dieselbe Auswahl", () => {
  const config = {
    buildChecks: [
      "echo lint", // String-Form: laeuft immer mit, aber mangels Entscheidung
      { cmd: "echo typecheck", always: true },
      { cmd: "echo build", areas: ["frontend"] },
      { cmd: "echo verify", areas: ["backend"] },
    ],
    checkAreas: { frontend: ["frontend/**"], backend: ["backend/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const erwartet = plan(dir);
    run(dir);
    const summary = zusammenfassung(dir);

    assert.equal(summary.basis, erwartet.basis);
    assert.deepEqual(summary.geaendert, erwartet.geaendert);
    assert.deepEqual(summary.bereiche, erwartet.bereiche);
    assert.equal(summary.vollerUmfang, erwartet.vollerUmfang);
    assert.equal(summary.leeresPaket, erwartet.leeresPaket);
    assert.deepEqual(
      summary.laufen.map(({ cmd, grund }) => ({ cmd, grund })),
      erwartet.laufen,
      "run laeuft gegen eine andere Auswahl als plan",
    );
    assert.deepEqual(summary.ausgelassen, erwartet.ausgelassen);
  });
});

test("die Nutzungshilfe nennt run und laeuft ohne Repo-Kontext", () => {
  const dir = mkdtempSync(join(tmpdir(), "checks-nackt-run-"));
  try {
    const kopie = join(dir, "checks.mjs");
    copyFileSync(CHECKS, kopie);

    const res = spawnSync(process.execPath, [kopie, "--help"], { cwd: dir, encoding: "utf-8" });

    assert.equal(res.status, 0, `--help endete mit ${res.status}: ${res.stderr}`);
    assert.match(res.stdout, /\brun\b/, "die Nutzungshilfe nennt das Unterkommando run nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
