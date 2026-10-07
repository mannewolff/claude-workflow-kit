// Ablauf-Pruefung: Ein Lauf, der mitten im Kommando gekillt wird, und das Commit-Gate, das seine Zwischenfassung liest, sind nur als eigene Prozesse zu beobachten.
//
// Die Pruef-Zusammenfassung begleitet den Lauf (Issue #857, Plan #810, E1/E5; seit Issue
// #1212 aus `checks-lauf-abbruch.test.mjs` herausgeloest). Dort stehen die Fassungen, die
// ein Lauf im selben Prozess hinterlaesst; hier der Abbruch von aussen und das Gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import {
  mitRepo, repoAnlegen, run, zusammenfassung, datei, git, repoEntfernenTolerant,
} from "./helpers/checks-repo.mjs";
import { CHECKS, gate, gateEinbauen } from "./helpers/checks-ablauf.mjs";

const CHECK_AREAS = { kern: ["src/**"] };

/** Wartet, bis `bedingung()` zutrifft — hoechstens `ms`, danach scheitert es mit `meldung`. */
async function warteAuf(bedingung, meldung, ms = 10_000) {
  const ende = Date.now() + ms;
  while (!bedingung()) {
    if (Date.now() > ende) assert.fail(meldung);
    await new Promise((weiter) => setTimeout(weiter, 20));
  }
}

/** Die pid des haengenden Pruefkommandos, sobald es sie hinterlassen hat. */
function kommandoPid(dir) {
  try {
    const roh = readFileSync(join(dir, "laeuft.txt"), "utf-8").trim();
    return /^\d+$/.test(roh) ? Number(roh) : null;
  } catch {
    return null;
  }
}

function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Beendet das Pruefkommando, das den Kill des Laufs ueberlebt hat, und wartet auf
 * sein Ende. Scheitert nie: Die Funktion laeuft im `finally` und darf das Ergebnis
 * des Tests nicht ueberschreiben — auch ein Prozess, der sich nicht beenden laesst,
 * soll das Aufraeumen noch versuchen lassen.
 */
async function beendeKommando(pid) {
  if (!pid) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return; // schon weg
  }
  await warteAuf(() => !lebt(pid), `das Kommando ${pid} lebt noch`, 2_000).catch(() => {});
}

// Ein Pruefkommando, das die Zusammenfassung waehrend seines eigenen Laufs
// wegkopiert. Als Node-Skript statt `cp`, damit das Kommando unter Windows
// dieselbe Zeile ist — `checks.mjs` faehrt es ueber die Shell der Plattform.
const SNAPSHOT = [
  "// Generiert von test/ablauf-checks-lauf-abbruch.test.mjs — kein Produktivcode.",
  'import { copyFileSync } from "node:fs";',
  'copyFileSync(".claude/checks-summary.json", process.argv[2]);',
  "",
].join("\n");

test("[checks-8] ein Lauf, der waehrend eines Kommandos stirbt, hinterlaesst einen ungruenen Stand", async (t) => {
  // Ein Kommando, das seinen Start meldet und dann haengt: So trifft der Test den
  // Lauf sicher mitten darin und nicht davor oder danach. Gemeldet wird die eigene
  // pid und nicht bloss "ja": Der Kill trifft den Lauf, nicht dessen Kind — das
  // haengende Kommando ueberlebt ihn und muss eigens beendet werden (Issue #873).
  const LANGSAM = [
    "// Generiert von test/ablauf-checks-lauf-abbruch.test.mjs — kein Produktivcode.",
    'import { writeFileSync } from "node:fs";',
    'writeFileSync("laeuft.txt", String(process.pid));',
    "setTimeout(() => {}, 15000);",
    "",
  ].join("\n");
  const config = {
    buildChecks: [{ cmd: "node werkzeug/langsam.mjs", always: true }, { cmd: "echo nie", always: true }],
    checkAreas: CHECK_AREAS,
  };
  // Nicht `mitRepo`: Das Aufraeumen ist dort synchron, dieser Fall wartet auf den
  // Tod eines Kindprozesses.
  const dir = repoAnlegen({ config });
  let kind = null;
  try {
    datei(dir, "werkzeug/langsam.mjs", LANGSAM);
    datei(dir, "src/a.txt");

    const proc = spawn(process.execPath, [CHECKS, "run"], { cwd: dir });
    proc.stdout.resume();
    proc.stderr.resume();
    await warteAuf(() => kommandoPid(dir) !== null, "das erste Pruefkommando lief nicht an");
    kind = kommandoPid(dir);
    proc.kill("SIGKILL");
    await new Promise((fertig) => proc.on("exit", fertig));

    assert.ok(existsSync(join(dir, ".claude", "checks-summary.json")),
      "ein gekillter Lauf muss seinen Stand hinterlassen, sonst gilt die Session als ungeprueft");
    const fassung = zusammenfassung(dir);
    assert.equal(fassung.abgeschlossen, false);
    assert.ok(fassung.laufen.some((e) => e.ergebnis !== "gruen"),
      `ein abgebrochener Lauf darf nie ganz gruen aussehen: ${JSON.stringify(fassung.laufen)}`);
    assert.equal(typeof fassung.hashes, "object");
    assert.notEqual(fassung.hashes, null);
  } finally {
    // Erst das Kommando, dann das Verzeichnis: Das haengende Kommando ueberlebt den Kill
    // des Laufs, `beendeKommando` trifft es ueber die pid aus `laeuft.txt` (Issue #873).
    // Bleibt das Verzeichnis trotzdem belegt, wird das notiert und nicht geworfen — die
    // Zusicherungen oben sind durch, und das Aufraeumen eines Wegwerf-Verzeichnisses darf
    // ihr Ergebnis nicht kippen (Issue #892).
    await beendeKommando(kind);
    await repoEntfernenTolerant(dir, { notiz: (satz) => t.diagnostic(satz) });
  }
});

test("[checks-8] das Commit-Gate weist eine Zwischenfassung als 'nicht gestartet' ab, nicht als altes Format", async () => {
  const config = {
    buildChecks: [{ cmd: "node werkzeug/snapshot.mjs vorher.json", always: true }, { cmd: "echo zwei", always: true }],
    checkAreas: CHECK_AREAS,
  };
  await mitRepo({ config }, async (dir) => {
    gateEinbauen(dir);
    datei(dir, "werkzeug/snapshot.mjs", SNAPSHOT);
    datei(dir, "src/a.txt");

    await run(dir);
    // Der simulierte Abbruch: Was der Lauf mittendrin hinterlassen haette, liegt am
    // Ort der Zusammenfassung. Geschrieben hat die Fassung das echte Werkzeug.
    copyFileSync(join(dir, "vorher.json"), join(dir, ".claude", "checks-summary.json"));
    git(dir, "add", "src/a.txt");

    const res = gate(dir, "pre-commit");

    assert.notEqual(res.status, 0, "eine Zwischenfassung darf keinen Commit durchlassen");
    assert.match(res.stderr, /nicht gestartet/, `der Grund nennt nicht den unfertigen Lauf: ${res.stderr}`);
    assert.doesNotMatch(res.stderr, /altes Format/,
      `die Zwischenfassung wurde fuer eine Datei aus alter Zeit gehalten: ${res.stderr}`);
  });
});
