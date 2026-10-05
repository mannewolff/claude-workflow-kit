// Wegwerf-Repository fuer die Tests von kit/checks.mjs (Issue #423).
//
// Die Auswahl liest ihren Zustand aus zwei Quellen, die sich nicht nachbilden
// lassen: `git diff` gegen einen Anker und `git status` fuer Ungetracktes. Ein
// Mock davon wuerde genau die Frage offenlassen, um die es geht — ob eine
// Loeschung, eine Umbenennung oder ein committetes Paket wirklich mitzaehlt.
// Deshalb laeuft jeder Test gegen ein echtes, frisch angelegtes Repo im
// Temp-Verzeichnis, nach dem Muster der night-*-Tests.
//
// Aufgerufen wird checks.mjs im selben Prozess, ueber `aufrufen` (Issue #1212, Plan
// #1199 E6): Ein Node-Prozess je Aufruf kostete bei rund 300 Aufrufen der Suite mehr
// als die Pruefungen selbst. Was nur als Prozess zu belegen ist — Signale, die
// Kommandozeile, der Hook —, startet `helpers/checks-ablauf.mjs`.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as schlafen } from "node:timers/promises";
import assert from "node:assert/strict";
// Ein eigener Sperrpfad je Testprozess (Issue #958): Jeder Lauf ueber diesen Helfer
// faehrt das echte kit/checks.mjs und nahm sonst dieselbe maschinenweite Sperre wie
// jede andere Testdatei — die Suite liefe Datei fuer Datei statt parallel. Der
// Import steht HIER und nicht in jeder Testdatei, weil jeder Aufruf durch diesen
// Helfer geht und `process.env` prozessweit gilt, also auch fuer spawn-Aufrufe, die
// an ihm vorbeigehen.
import "./checks-sperre.mjs";
import { gitBashPfad } from "../../kit/board.mjs";
import { aufrufen } from "../../kit/checks.mjs";
import { lfAttribute } from "./zeilenenden.mjs";

/**
 * Die POSIX-Shell, mit der ein Test den Hook startet: `sh`, unter Windows die Git Bash,
 * die das Kit dort voraussetzt (Issue #1138, Plan #1128 E7).
 */
export function posixShell() {
  if (process.platform !== "win32") return "sh";
  const { pfad, fehler } = gitBashPfad();
  if (!pfad) throw new Error(fehler);
  return pfad;
}

/**
 * Ein Pfad, wie ihn die Shell als Argument braucht: Unter Windows mit `/` — `dirname "$0"`
 * im Hook trennt nur dort.
 */
export function shellPfad(pfad) {
  return process.platform === "win32" ? pfad.replaceAll("\\", "/") : pfad;
}

export function git(dir, ...args) {
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${args.join(" ")} schlug fehl: ${res.stderr}`);
  return res.stdout.trim();
}

/**
 * Roher Aufruf im selben Prozess — fuer die Faelle, in denen der Exit-Code selbst der
 * Befund ist. Ergebnis wie bei `spawnSync`: `{ status, stdout, stderr }`, fuer `run` als
 * Promise. `env` ergaenzt die Umgebung des Testprozesses.
 */
export function checks(dir, ...cliArgs) {
  return checksMit(dir, {}, ...cliArgs);
}

/** Derselbe Aufruf mit zusaetzlichen Umgebungsvariablen und optional eigenem git. */
export function checksMit(dir, { env = {}, git: gitStarter } = {}, ...cliArgs) {
  return aufrufen(cliArgs, { cwd: dir, env: { ...process.env, ...env }, git: gitStarter });
}

/** Die Fake-`git` je Wegwerf-Repo (Issue #504, #1136, #1212). */
const FAKE_GIT = new Map();

/**
 * Derselbe Aufruf, aber mit dem Fake-`git`, das `fakeGitOhne` oder `fakeGitSetzen` fuer
 * dieses Repo hinterlegt hat (Issue #504, #1136). Seit Issue #1212 im selben Prozess: Das
 * Fake ist eine Funktion, die `aufrufen` statt des echten Starts von git bekommt.
 */
export function checksMitFakeGit(dir, ...cliArgs) {
  const fake = FAKE_GIT.get(dir);
  assert.ok(fake, `kein Fake-git fuer ${dir} hinterlegt`);
  return checksMit(dir, { git: fake }, ...cliArgs);
}

/** Hinterlegt `fake(args, optionen)` als git dieses Repos — Ergebnis wie `spawnSync`. */
export function fakeGitSetzen(dir, fake) {
  FAKE_GIT.set(dir, fake);
}

/** Das echte git, mit denselben Optionen, die checks.mjs uebergibt. */
export function echtesGit(args, optionen) {
  return spawnSync("git", args, optionen);
}

/**
 * Ein Fake-`git`, das genau ein Unterkommando scheitern laesst und alles andere an das
 * echte git durchreicht (Issue #504, #1136). Anders als ein Mock laesst es die uebrigen
 * git-Aufrufe von checks.mjs unangetastet: `rev-parse` loest weiter auf, nur der eine
 * Schritt danach bricht ab — genau die Reihenfolge, um die es in den Fehlerpfaden geht.
 *
 * `meldung: null` laesst das Unterkommando stumm scheitern — der Fall, in dem
 * checks.mjs seine Meldung ohne Zutun von git bilden muss.
 */
export function fakeGitOhne(dir, unterkommando, meldung = "fake: absichtlich gescheitert") {
  fakeGitSetzen(dir, (args, optionen) => {
    if (args[0] !== unterkommando) return echtesGit(args, optionen);
    const stderr = meldung === null ? "" : `${meldung}\n`;
    return { status: 128, signal: null, stdout: "", stderr };
  });
}

/** Erfolgreicher `plan`-Aufruf, JSON geparst. */
export function plan(dir, ...cliArgs) {
  const res = checks(dir, "plan", ...cliArgs);
  assert.equal(res.status, 0, `checks.mjs plan schlug fehl (${res.status}): ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/** Roher `run`-Aufruf — bei `run` ist der Exit-Code selbst ein Ergebnis (Issue #424). */
export function run(dir, ...cliArgs) {
  return checks(dir, "run", ...cliArgs);
}

/** Die Zusammenfassung, die `run` hinterlaesst. */
export function zusammenfassung(dir) {
  return JSON.parse(readFileSync(join(dir, ".claude", "checks-summary.json"), "utf-8"));
}

/** Der Ort des Ausfuehrungsprotokolls (Issue #785). */
export function ausfuehrungenPfad(dir) {
  return join(dir, ".claude", "ausfuehrungen.tsv");
}

/** Die Zeilen des Ausfuehrungsprotokolls; eine fehlende Datei zaehlt als keine Zeile. */
export function ausfuehrungen(dir) {
  try {
    return readFileSync(ausfuehrungenPfad(dir), "utf-8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Der Stand des Working Tree als Text. `--untracked-files=all` wie in checks.mjs:
 * sonst faellt eine einzelne Datei in einem neuen Verzeichnis unter den Tisch.
 */
export function treeStand(dir) {
  return git(dir, "status", "--porcelain", "--untracked-files=all");
}

export function datei(dir, pfad, inhalt = "Inhalt\n") {
  const ziel = join(dir, pfad);
  mkdirSync(dirname(ziel), { recursive: true });
  writeFileSync(ziel, inhalt, "utf-8");
}

export function repoAnlegen({ config = {}, configText = null, ohneConfig = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "checks-"));
  // Eine getrackte Datei von Anfang an: sonst haette der Setup-Commit im Fall
  // `ohneConfig` nichts zu committen und das Repo bliebe ohne HEAD.
  datei(dir, "README.md", "# Wegwerf\n");
  // Dieselbe Ignore-Regel, die ein installiertes Projekt hat (Issue #208/#209):
  // alles unter .claude/ ist lokaler Zustand, nur die workflow.config.json gehoert
  // ins Repo. Ohne sie wuerde die Zusammenfassung aus `run` (Issue #424) hier als
  // Tree-Aenderung erscheinen, waehrend sie es im echten Projekt nie tut — das
  // Wegwerf-Repo wuerde dann etwas anderes pruefen als den Ernstfall.
  //
  // `fakebin/` steht aus demselben Grund dabei (Issue #504): Das Fake-`git` ist
  // Werkzeug des Tests und kein Teil des Arbeitspakets; ungetrackt wuerde es als
  // geaenderte Datei zaehlen und jeden Lauf in den vollen Umfang ziehen.
  datei(dir, ".gitignore", ".claude/*\n!.claude/workflow.config.json\nfakebin/\n");
  if (!ohneConfig) {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    const inhalt = configText ?? JSON.stringify(config, null, 2) + "\n";
    writeFileSync(join(dir, ".claude", "workflow.config.json"), inhalt, "utf-8");
  }
  lfAttribute(join(dir, ".gitattributes"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "T");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "setup");
  return dir;
}

/** Die Fehlercodes, die Windows liefert, solange noch ein Handle auf dem Verzeichnis liegt. */
const BELEGT = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);

/**
 * Beendet unter Windows den ganzen Prozessbaum eines Laufs (Issue #874).
 *
 * `checks.mjs` startet seine Pruefkommandos mit `shell: true`; unter Windows steht
 * damit eine `cmd.exe` zwischen Lauf und Kommando. Ein SIGKILL auf den Lauf beendet
 * dort keinen Prozessbaum — die Shell ueberlebt als Waise und haelt das
 * Arbeitsverzeichnis offen. `taskkill /T /F` raeumt sie mit ab.
 *
 * Fehler sind kein Testfehler: Der Prozess kann laengst weg sein, und die Funktion
 * laeuft im `finally`, wo sie das Ergebnis des Tests nicht ueberschreiben darf.
 * Rueckgabe: ob ein Aufruf abgesetzt wurde — allein zur Pruefbarkeit.
 */
export function prozessbaumBeenden(pid, { plattform = process.platform, kill = spawnSync } = {}) {
  if (plattform !== "win32" || !pid) return false;
  try {
    kill("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    // schon weg
  }
  return true;
}

/**
 * Entfernt ein Wegwerf-Verzeichnis und wartet dabei ab, bis Windows es freigibt
 * (Issue #874). Die Wiederholungen von `rmSync` selbst sind der erste Weg; gibt die
 * ueberlebende Shell das Verzeichnis erst spaeter frei, setzt die Schleife mit
 * wachsendem Abstand nach, hoechstens bis `grenzeMs`. Ein Fehler, der nicht von
 * einem offenen Handle kommt, wird sofort weitergeworfen — er verginge nicht von
 * selbst. `rm`, `warten` und `uhr` dienen allein der Pruefbarkeit.
 */
export async function repoEntfernenHartnaeckig(
  dir,
  { rm = rmSync, grenzeMs = 10_000, warten = schlafen, uhr = Date.now } = {},
) {
  const ende = uhr() + grenzeMs;
  let abstand = 100;
  for (;;) {
    try {
      rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      return;
    } catch (fehler) {
      if (!BELEGT.has(fehler?.code) || uhr() >= ende) throw fehler;
      await warten(abstand);
      abstand = Math.min(abstand * 2, 1000);
    }
  }
}

/**
 * Dasselbe Entfernen, aber es kippt kein Testergebnis (Issue #892). Gibt die
 * ueberlebende `cmd.exe` das Verzeichnis auch bis zur Obergrenze nicht frei, wird der
 * Fehler notiert statt geworfen: Ein Wegwerf-Verzeichnis, das unter Windows belegt
 * bleibt, ist kein Befund ueber das Kit — die Zusicherungen des Tests sind da laengst
 * durchgelaufen, und das Aufraeumen im `finally` darf ihr Ergebnis nicht ueberschreiben.
 * Fehler, die nicht von einem offenen Handle kommen, fliegen unveraendert weiter; sonst
 * verbaerge die Toleranz auch einen falschen Pfad. `notiz` nimmt den Satz entgegen —
 * im Test `t.diagnostic`, damit er im TAP-Protokoll beim richtigen Test steht.
 */
export async function repoEntfernenTolerant(dir, { notiz = null, ...rest } = {}) {
  try {
    await repoEntfernenHartnaeckig(dir, rest);
  } catch (fehler) {
    if (!BELEGT.has(fehler?.code)) throw fehler;
    notiz?.(`Wegwerf-Verzeichnis ${dir} blieb belegt (${fehler.code}) — nicht entfernt, kein Testfehler.`);
  }
}

/**
 * Legt ein Wegwerf-Repo an, ruft `fn(dir)` und raeumt danach ab. Gibt `fn` ein Promise
 * zurueck — jeder Test, der `run` im selben Prozess ruft (Issue #1212) —, wird erst nach
 * dessen Ende abgeraeumt, und `mitRepo` liefert dieses Promise.
 */
export function mitRepo(optionen, fn) {
  const dir = repoAnlegen(optionen);
  const abraeumen = () => rmSync(dir, { recursive: true, force: true });
  let ergebnis;
  try {
    ergebnis = fn(dir);
  } catch (fehler) {
    abraeumen();
    throw fehler;
  }
  if (ergebnis instanceof Promise) return ergebnis.finally(abraeumen);
  abraeumen();
  return ergebnis;
}

/** Findet einen Eintrag aus `laufen` oder `ausgelassen` ueber sein Kommando. */
export function eintrag(liste, cmd) {
  return liste.find((e) => e.cmd === cmd);
}

export function kommandos(liste) {
  return liste.map((e) => e.cmd);
}
