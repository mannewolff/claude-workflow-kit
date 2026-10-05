// Die Ausgabe roter Kommandos liegt als Datei (Issue #1196).
//
// Nach einem roten Lauf kappte die Werkzeugausgabe der Session die Mitte, und checks.mjs
// verwarf die Ausgabe des roten Kommandos. Die Session fuhr dann die ganze Suite mit
// --frisch erneut, nur um sie in eine Datei umzuleiten — bei #1194 und #1195 jeweils zehn
// bis fuenfzehn Minuten. Jetzt liegt die Ausgabe jedes nicht gruenen Kommandos unter
// .claude/checks-protokolle/, und Zusammenfassung wie Berichtszeile nennen den Pfad.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mitRepo, run, zusammenfassung, datei } from "./helpers/checks-repo.mjs";

const ORDNER = ".claude/checks-protokolle";

// Ein Kommando, dessen Farbe eine Datei unter .claude/ steuert: Die Datei zaehlt nicht
// zum Stand des Pakets, ein Wechsel erzwingt also keinen echten Lauf von selbst.
const SCHALTER = [
  "import { existsSync } from 'node:fs';",
  "console.log('erste Zeile der Ausgabe');",
  "console.log('mittlere Zeile, die eine Session sonst nie sieht');",
  "console.log('letzte Zeile der Ausgabe');",
  "process.exit(existsSync('.claude/rot') ? 1 : 0);",
].join("\n");

const CONFIG = {
  buildChecks: [
    "node -e \"console.log('gruen und still')\"",
    "node .claude/schalter.mjs",
  ],
};

function vorbereiten(dir, { rot }) {
  datei(dir, ".claude/schalter.mjs", `${SCHALTER}\n`);
  if (rot) datei(dir, ".claude/rot", "x\n");
  datei(dir, "src/a.txt");
}

/** Ein Pfad als Muster: Der Punkt steht fuer sich selbst. */
const maskiert = (pfad) => pfad.replaceAll(".", String.raw`\.`);

function protokolle(dir) {
  const pfad = join(dir, ...ORDNER.split("/"));
  return existsSync(pfad) ? readdirSync(pfad) : [];
}

function eintragVon(dir, cmd) {
  return zusammenfassung(dir).laufen.find((e) => e.cmd === cmd);
}

test("[1196] ein roter Lauf legt genau die Ausgabe des roten Kommandos ab und nennt den Pfad", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    vorbereiten(dir, { rot: true });

    const res = run(dir);

    assert.equal(res.status, 1, `der Lauf haette rot sein muessen: ${res.stdout}`);
    const dateien = protokolle(dir);
    assert.equal(dateien.length, 1, `genau eine Datei erwartet: ${dateien}`);
    const rel = `${ORDNER}/${dateien[0]}`;
    assert.match(dateien[0], /^02-node-claude-schalter-mjs\.log$/, "laufende Nummer und lesbarer Kurzname");
    const inhalt = readFileSync(join(dir, ...rel.split("/")), "utf-8");
    assert.match(inhalt, /erste Zeile der Ausgabe/);
    assert.match(inhalt, /mittlere Zeile, die eine Session sonst nie sieht/);
    assert.match(inhalt, /letzte Zeile der Ausgabe/);

    assert.equal(eintragVon(dir, "node .claude/schalter.mjs").protokoll, rel);
    assert.equal(eintragVon(dir, CONFIG.buildChecks[0]).protokoll, undefined, "gruene Kommandos legen nichts ab");

    const zeile = res.stdout.split("\n").find((z) => z.startsWith("gelaufen: node .claude/schalter.mjs"));
    assert.ok(zeile, res.stdout);
    assert.match(zeile, new RegExp("Ausgabe: " + maskiert(rel) + "$"), "die Berichtszeile nennt den Pfad");
  });
});

test("[1196] ein zweiter echter Lauf, der gruen ist, leert den Ordner", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    vorbereiten(dir, { rot: true });
    run(dir);
    assert.equal(protokolle(dir).length, 1, "Vorbedingung: eine Datei aus dem roten Lauf");

    // Der Schalter wird abgeschaltet, indem die Datei verschwindet.
    rmSync(join(dir, ".claude", "rot"));
    const res = run(dir, "--frisch");

    assert.equal(res.status, 0, res.stdout);
    assert.deepEqual(protokolle(dir), []);
    assert.equal(eintragVon(dir, "node .claude/schalter.mjs").protokoll, undefined);
  });
});

test("[1196] ein uebernommener Lauf laesst Ordner und Feld stehen und nennt den Pfad erneut", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    vorbereiten(dir, { rot: true });
    run(dir);
    const rel = eintragVon(dir, "node .claude/schalter.mjs").protokoll;

    const zweiter = run(dir);

    assert.match(zweiter.stdout, /Ergebnis uebernommen \(rot/);
    assert.equal(protokolle(dir).length, 1, "der Ordner bleibt stehen");
    assert.equal(eintragVon(dir, "node .claude/schalter.mjs").protokoll, rel);
    assert.match(zweiter.stdout, new RegExp("Ausgabe: " + maskiert(rel)));
  });
});

test("[1196] ein nicht schreibbarer Ordner fuehrt zu einem Hinweis, nicht zu einem anderen Ausgang", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    vorbereiten(dir, { rot: true });
    // Eine Datei an der Stelle des Ordners: Leeren und Ablegen scheitern auf jeder Plattform.
    datei(dir, ORDNER, "kein Ordner\n");

    const res = run(dir);

    assert.equal(res.status, 1, "der Lauf bleibt rot wegen des roten Kommandos, nicht wegen des Ordners");
    assert.match(res.stderr, /Hinweis: .*checks-protokolle/);
    assert.equal(zusammenfassung(dir).abgeschlossen, true, "der Lauf kommt zu seinem Ende");
    assert.equal(eintragVon(dir, "node .claude/schalter.mjs").protokoll, undefined);
  });
});
