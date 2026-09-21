// Wegwerf-Projekt fuer die Tests von kit/wirksamkeit.mjs (Issue #787, Plan #782).
//
// Die Auswertung ist eine reine Leseoperation ueber Dateien — kein Board, kein Git.
// Sie laesst sich deshalb vollstaendig an Fixtures pruefen: ein Temp-Verzeichnis mit
// .claude/ und darin das Ausfuehrungsprotokoll, genau wie ein echtes Projekt es traegt.
//
// Aufgerufen wird das ECHTE Werkzeug aus kit/ mit cwd im Fixture — nach demselben
// Muster wie test/helpers/aufwand-fixture.mjs. Eine Kopie im Temp-Verzeichnis erzeugte
// Coverage unter einem Pfad, den SonarCloud nicht auf die Repo-Datei abbildet.
//
// Die Zeitstempel der Protokollzeilen entstehen RELATIV zur echten Jetzt-Zeit
// (`vorTagen`): Das Fenster der Auswertung haengt an `new Date()` im Werkzeug, und ein
// fester Stempel laege irgendwann ausserhalb jedes Fensters. Tests, die Lauftage
// zaehlen, nutzen deshalb IDENTISCHE `vorTagen`-Werte je Tag — zwei knapp
// verschiedene Werte koennten ueber eine Kalendertagsgrenze fallen.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const WIRKSAMKEIT = join(repoRoot, "kit", "wirksamkeit.mjs");

const TAG_MS = 24 * 60 * 60 * 1000;

/** Der ISO-Zeitstempel "vor n Tagen" — n darf gebrochen sein. */
export function vorTagen(n) {
  return new Date(Date.now() - n * TAG_MS).toISOString();
}

/**
 * Eine Protokollzeile, wie `ausfuehrungSchreiben` in kit/checks.mjs sie anhaengt:
 * Zeitpunkt, Kommando, Ergebnis, Dauer — durch Tabs getrennt.
 */
export function zeile({ tage = 1, zeit, cmd = "node --test", ergebnis = "gruen", dauerMs = 1000 }) {
  return `${zeit ?? vorTagen(tage)}\t${cmd}\t${ergebnis}\t${dauerMs}`;
}

/**
 * Legt ein Projekt an, ruft `fn(dir)` und raeumt danach auf — auch nach einem
 * gescheiterten Assert (finally), sonst bleibt bei jedem roten Lauf ein Verzeichnis
 * im Temp stehen.
 *
 * `zeilen` sind fertige Protokollzeilen (Strings, siehe `zeile`); `zeilen: null`
 * heisst: kein Protokoll anlegen. `config` ist die workflow.config.json des Fixtures.
 */
export function mitProjekt({ zeilen = [], config }, fn) {
  const dir = mkdtempSync(join(tmpdir(), "wirksamkeit-"));
  try {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    if (zeilen !== null) {
      writeFileSync(join(dir, ".claude", "ausfuehrungen.tsv"), zeilen.map((z) => `${z}\n`).join(""), "utf-8");
    }
    if (config !== undefined) {
      writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config, null, 2) + "\n", "utf-8");
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Roher Aufruf — fuer die Faelle, in denen der Exit-Code selbst der Befund ist. */
export function wirksamkeit(dir, ...cliArgs) {
  return spawnSync(process.execPath, [WIRKSAMKEIT, ...cliArgs], { cwd: dir, encoding: "utf-8" });
}

/** Erfolgreicher `auswerten`-Aufruf, JSON von stdout geparst. */
export function auswerten(dir, ...cliArgs) {
  const res = wirksamkeit(dir, "auswerten", ...cliArgs);
  if (res.status !== 0) throw new Error(`auswerten schlug fehl (${res.status}): ${res.stderr}${res.stdout}`);
  return JSON.parse(res.stdout);
}

/** Die Zeile einer Pruefung aus einem Auswertungsergebnis. */
export function pruefung(ergebnis, cmd) {
  return ergebnis.pruefungen.find((p) => p.cmd === cmd);
}

/** Der geschriebene Stand `.claude/wirksamkeit.json`. */
export function stand(dir) {
  return JSON.parse(readFileSync(standPfad(dir), "utf-8"));
}

/** Der geschriebene Bericht `.claude/wirksamkeit.md`. */
export function bericht(dir) {
  return readFileSync(join(dir, ".claude", "wirksamkeit.md"), "utf-8");
}

export function hatStand(dir) {
  return existsSync(standPfad(dir));
}

export function standPfad(dir) {
  return join(dir, ".claude", "wirksamkeit.json");
}
