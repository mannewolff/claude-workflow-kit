#!/usr/bin/env node
/**
 * claude-workflow-kit Pruef-Auswahl und -Ausfuehrung (Issues #423, #424)
 *
 * `plan` entscheidet, welche Pruefungen nach einem Arbeitspaket laufen muessen —
 * und gibt die Entscheidung als Daten zurueck, ohne sie auszufuehren. `run` fuehrt
 * genau diese Auswahl aus und hinterlaesst das Ergebnis als Zusammenfassung, aus
 * der der Nacht-Runner liest.
 *
 * Warum ein Kommando und keine Regel im Skilltext: Die Sessions dieses Projekts
 * haben dreimal belegt, dass eine Regel im Prompt nicht wirkt, wenn sie unter
 * Druck steht (Issue #267, 2026-08-12, Issue #410). Eine Auswahl, die falsch
 * ausfaellt, nimmt Pruefung weg — der Fehler geht in die unsichere Richtung und
 * faellt niemandem auf.
 *
 * Deshalb irrt dieses Kommando nur in eine Richtung: mehr pruefen. Drei Ausgaenge
 * setzen das durch:
 *   - Eine geaenderte Datei, die kein Muster trifft -> `vollerUmfang: true`,
 *     alles laeuft. Nicht abschaltbar.
 *   - Ein Anker, der sich nicht aufloesen laesst -> ebenso voller Umfang. Ein
 *     LEERER `--since`-Wert zaehlt dabei wie ein nicht aufloesbarer, nie wie ein
 *     fehlender: Er entsteht, wenn im /local-check-Skill die
 *     merge-base-Substitution fehlschlaegt. Als "nicht angegeben" gelesen griffe
 *     der Default HEAD, und auf sauberem Tree liefe keine einzige Pruefung.
 *   - Eine fehlende Config -> Abbruch mit Exit ungleich 0. Ein Kommando, das
 *     ohne Config stillschweigend "nichts zu pruefen" meldet, zeigt genau dorthin,
 *     wo der Fehler niemandem auffaellt.
 *
 * Aufruf im Projekt-Root:  node .claude/kit/checks.mjs plan [--since <ref>]
 *                          node .claude/kit/checks.mjs run  [--since <ref>]
 *
 * Die Ausgabe von `plan` ist immer JSON, es gibt kein --json-Flag: `board.mjs
 * issue get` liefert ebenfalls JSON ohne Flag, und eine zweite Ausgabeform waere
 * zweite Pflege. `run` schreibt fuer Menschen und legt seine maschinenlesbare
 * Fassung in der Zusammenfassung ab.
 *
 * Keine Laufzeitabhaengigkeit ausserhalb der Node-Standardbibliothek — das Kit
 * liefert seine Werkzeuge als eigenstaendig portable Einzeldateien aus. Deshalb
 * traegt die Datei auch ihre eigene Minimal-Glob-Fassung statt eines Pakets.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "1.43.4";

// Ort der Zusammenfassung, die `run` hinterlaesst (Issue #424, Entscheidung A4 des
// Plans #421): derselbe Ort wie das Nachtprotokoll (`LOG_FILE` in night.mjs) — im
// Projekt, aber hinter der Ignore-Regel `.claude/*`. Damit bleibt der Working Tree
// sauber und der harte Stopp auf dirty (Issue #152) greift nicht.
//
// Fester Dateiname, kein Zeitstempel: Der Nacht-Runner loescht die Datei vor jeder
// Session (Issue #428), es zaehlt also immer nur der Lauf der laufenden Session —
// und innerhalb einer Session der letzte. Eine Session darf `run` mehrfach fahren
// (rot, Fix, erneut), daraus entsteht bewusst keine Historie.
const SUMMARY_DATEI = ".claude/checks-summary.json";

/**
 * Der Pfad der Zusammenfassung. Exportiert, damit night.mjs ihn importieren kann,
 * statt ihn ein zweites Mal auszurechnen (Issue #428) — derselbe Grund, aus dem
 * `run` seine Auswahl von `plan` bezieht und nicht neu berechnet.
 */
export function zusammenfassungPfad(root = process.cwd()) {
  return join(root, ...SUMMARY_DATEI.split("/"));
}

const HELP = `checks.mjs (claude-workflow-kit v${KIT_VERSION}) — faellige Pruefungen

  node checks.mjs plan [--since <ref>]
  node checks.mjs run  [--since <ref>]

plan  Gibt als JSON aus, welche buildChecks nach dem aktuellen Arbeitspaket
      laufen muessen und welche ausgelassen werden koennen — jede Entscheidung
      mit Grund. Ausgefuehrt wird nichts.
run   Fuehrt genau diese Auswahl sequenziell aus, bricht beim ersten roten Check
      ab (Exit ungleich 0) und schreibt die Zusammenfassung nach
      ${SUMMARY_DATEI}.

  --since <ref>   Anker, gegen den die Aenderungen ermittelt werden (Default HEAD).
                  Laesst sich der Anker nicht aufloesen — auch bei leerem Wert —,
                  laufen alle Pruefungen.
  --help, -h      Diese Uebersicht (laeuft als einziger Aufruf ohne Config).

Gelesen wird .claude/workflow.config.json im Arbeitsverzeichnis: 'buildChecks'
(Kommandostring, { cmd, areas } oder { cmd, always }) und 'checkAreas'
(Bereichsname -> Pfadmuster). Muster kennen '*' innerhalb eines Pfadsegments und
'**' ueber Segmentgrenzen; ein Verzeichnis erfasst man als 'frontend/**'.
`;

class ChecksError extends Error {}

function fail(nachricht) {
  throw new ChecksError(nachricht);
}

function git(...args) {
  return spawnSync("git", args, { cwd: process.cwd(), encoding: "utf-8" });
}

// --- Config ----------------------------------------------------------------

function ladeConfig() {
  const pfad = join(process.cwd(), ".claude", "workflow.config.json");
  if (!existsSync(pfad)) {
    fail(`Keine .claude/workflow.config.json unter ${process.cwd()} — bitte im Projekt-Root starten.`);
  }
  try {
    return JSON.parse(readFileSync(pfad, "utf-8"));
  } catch (err) {
    return fail(`.claude/workflow.config.json ist kein gueltiges JSON: ${err.message}`);
  }
}

/** Die String-Form und das Objekt nur mit `cmd` bedeuten dasselbe. */
function normalisiere(check) {
  return typeof check === "string" ? { cmd: check } : check;
}

/**
 * Ein vertippter Bereichsname wuerde eine Pruefung still nie laufen lassen —
 * genau der Fehler, den dieses Kommando verhindern soll. Also Abbruch.
 *
 * Ein LEERES `areas`-Array und die Kombination `areas` + `always` sind hier
 * nicht zu pruefen: Das Schema schliesst beide aus (minItems 1, not). Was das
 * Schema verhindert, muss die Laufzeit nicht erklaeren (Issue #422).
 */
function pruefeBereichsnamen(checks, checkAreas) {
  const bekannt = new Set(Object.keys(checkAreas));
  for (const check of checks) {
    for (const name of check.areas ?? []) {
      if (!bekannt.has(name)) {
        const liste = bekannt.size > 0 ? [...bekannt].join(", ") : "keine";
        fail(`Unbekannter Bereich '${name}' bei Pruefung '${check.cmd}'. Bekannt aus checkAreas: ${liste}.`);
      }
    }
  }
}

// --- Muster ----------------------------------------------------------------

const REGEX_SONDERZEICHEN = /[.+?^${}()|[\]\\]/;

/**
 * Minimal-Glob: '*' innerhalb eines Pfadsegments, '**' ueber Segmentgrenzen,
 * '/' als Trenner. Ein '**' samt folgendem Trenner darf ganz verschwinden, damit
 * ein Muster wie "doppelstern, Trenner, *.md" auch eine Datei im
 * Wurzelverzeichnis trifft und nicht erst eine in einem Unterverzeichnis.
 */
function globZuRegex(muster) {
  let quelle = "";
  let i = 0;
  while (i < muster.length) {
    const zeichen = muster[i];
    if (zeichen !== "*") {
      quelle += REGEX_SONDERZEICHEN.test(zeichen) ? `\\${zeichen}` : zeichen;
      i += 1;
    } else if (muster[i + 1] === "*") {
      const mitTrenner = muster[i + 2] === "/";
      quelle += mitTrenner ? "(?:.*/)?" : ".*";
      i += mitTrenner ? 3 : 2;
    } else {
      quelle += "[^/]*";
      i += 1;
    }
  }
  return new RegExp(`^${quelle}$`);
}

function bereicheVorbereiten(checkAreas) {
  return Object.entries(checkAreas).map(([name, muster]) => ({
    name,
    regexe: (muster ?? []).map((m) => globZuRegex(m)),
  }));
}

/**
 * Ordnet jede geaenderte Datei ihren Bereichen zu. Die erste Datei, die kein
 * einziges Muster trifft, wird als `ohneMuster` gemeldet — sie loest den vollen
 * Umfang aus und gehoert in den Grund, sonst weiss niemand, welches Muster fehlt.
 */
function zuordnen(dateien, bereichsdefinition) {
  const beruehrt = new Set();
  let ohneMuster = null;
  for (const pfad of dateien) {
    const treffer = bereichsdefinition.filter((b) => b.regexe.some((r) => r.test(pfad)));
    if (treffer.length === 0) {
      ohneMuster ??= pfad;
      continue;
    }
    for (const bereich of treffer) beruehrt.add(bereich.name);
  }
  return { beruehrt, ohneMuster };
}

// --- Aenderungen -----------------------------------------------------------

function ankerAufloesen(refText) {
  // Der leere Wert wird gar nicht erst gefragt: Er ist die Spur einer
  // fehlgeschlagenen merge-base-Substitution und gilt als nicht aufloesbar.
  if (refText === "") return null;
  const res = git("rev-parse", "--verify", "--short", `${refText}^{commit}`);
  const basis = res.stdout.trim();
  return res.status === 0 && basis ? basis : null;
}

/**
 * Zerlegt die NUL-getrennte Ausgabe von `git diff --name-status -z`. Eine
 * Umbenennung (R) und eine Kopie (C) tragen zwei Pfade — beide zaehlen, denn eine
 * verschobene Datei aendert an beiden Enden etwas.
 */
function* diffPfade(roh) {
  const felder = roh.split("\0");
  let i = 0;
  while (i < felder.length) {
    const status = felder[i];
    i += 1;
    if (!status) continue;
    const anzahl = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    for (let n = 0; n < anzahl && i < felder.length; n += 1, i += 1) {
      if (felder[i]) yield felder[i];
    }
  }
}

function* untracktePfade(roh) {
  for (const eintrag of roh.split("\0")) {
    if (eintrag.startsWith("?? ")) yield eintrag.slice(3);
  }
}

/**
 * Alles, was das Arbeitspaket beruehrt hat: getrackte Aenderungen gegen den
 * Anker (angelegt, geaendert, geloescht, umbenannt) plus Ungetracktes.
 * `--untracked-files=all` ist Pflicht — sonst meldet git ein neues Verzeichnis
 * als einen einzigen Eintrag, und die Datei darin faende nie ihr Muster.
 */
function geaenderteDateien(basis) {
  const dateien = new Set();

  const diff = git("diff", "--name-status", "-z", basis);
  if (diff.status !== 0) fail(`git diff gegen '${basis}' schlug fehl: ${diff.stderr.trim()}`);
  for (const pfad of diffPfade(diff.stdout)) dateien.add(pfad);

  const status = git("status", "--porcelain", "-z", "--untracked-files=all");
  if (status.status !== 0) fail(`git status schlug fehl: ${status.stderr.trim()}`);
  for (const pfad of untracktePfade(status.stdout)) dateien.add(pfad);

  return [...dateien].map((p) => p.replaceAll("\\", "/")).sort();
}

// --- Auswahl ---------------------------------------------------------------

function bereichsText(namen) {
  return `${namen.length === 1 ? "Bereich" : "Bereiche"} ${namen.join(", ")}`;
}

/**
 * String und `always: true` laufen beide immer, meinen aber Verschiedenes —
 * vergessen gegen entschieden. Nur der Grund haelt das auseinander.
 */
function entscheidung(check, beruehrt) {
  if (check.always) return { laeuft: true, grund: "als immer laufend festgelegt" };
  if (!check.areas) return { laeuft: true, grund: "nicht zugeordnet" };
  const treffer = check.areas.filter((name) => beruehrt.has(name));
  return treffer.length > 0
    ? { laeuft: true, grund: `${bereichsText(treffer)} beruehrt` }
    : { laeuft: false, grund: `${bereichsText(check.areas)} unberuehrt` };
}

function mitGrund(checks, grund) {
  return checks.map((check) => ({ cmd: check.cmd, grund }));
}

function bauen({ basis, geaendert = [], bereiche = [], laufen = [], ausgelassen = [],
  vollerUmfang = false, leeresPaket = false }) {
  return { basis, geaendert, bereiche, laufen, ausgelassen, vollerUmfang, leeresPaket };
}

function planen(args) {
  const config = ladeConfig();
  const checks = (config.buildChecks ?? []).map((c) => normalisiere(c));
  const checkAreas = config.checkAreas ?? {};
  pruefeBereichsnamen(checks, checkAreas);

  const refText = args.since ?? "HEAD";
  const basis = ankerAufloesen(refText);
  if (basis === null) {
    const grund = `voller Umfang: Anker '${refText}' laesst sich nicht aufloesen`;
    return bauen({ basis: refText, laufen: mitGrund(checks, grund), vollerUmfang: true });
  }

  const geaendert = geaenderteDateien(basis);
  if (geaendert.length === 0) {
    const grund = `leeres Paket: keine Aenderung seit ${basis}`;
    return bauen({ basis, ausgelassen: mitGrund(checks, grund), leeresPaket: true });
  }

  const { beruehrt, ohneMuster } = zuordnen(geaendert, bereicheVorbereiten(checkAreas));
  const bereiche = [...beruehrt].sort();
  if (ohneMuster !== null) {
    const grund = `voller Umfang: '${ohneMuster}' trifft kein Muster`;
    return bauen({ basis, geaendert, bereiche, laufen: mitGrund(checks, grund), vollerUmfang: true });
  }

  const laufen = [];
  const ausgelassen = [];
  for (const check of checks) {
    const { laeuft, grund } = entscheidung(check, beruehrt);
    (laeuft ? laufen : ausgelassen).push({ cmd: check.cmd, grund });
  }
  return bauen({ basis, geaendert, bereiche, laufen, ausgelassen });
}

// --- Ausfuehrung (Issue #424) ----------------------------------------------

/**
 * Liest den env-Block aus .claude/settings.json (falls vorhanden) — uebernommen
 * aus `settingsEnv` in night.mjs, nicht neu erfunden.
 *
 * Dort stehen projektspezifische Variablen (z.B. DOCKER_HOST /
 * TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE fuer Testcontainers unter Colima), die
 * Claude Code seinen eigenen Bash-Aufrufen automatisch mitgibt. checks.mjs ist
 * aber ein eigener Node-Prozess ausserhalb von Claude Code und bekommt sie sonst
 * nicht — ohne sie ein falsches Rot (beobachtet bei kanban-kit #445: mvn verify
 * schlug ohne die beiden Variablen mit Mockito-MockMaker-Fehlern fehl).
 *
 * Precedence wie in Claude Code: settings.json zuerst, settings.local.json
 * gewinnt. Die local-Datei ist gitignored und damit der uebliche Ort fuer
 * maschinenspezifische Werte — genau die, die hier fehlen wuerden (Issue #168).
 */
function settingsEnv() {
  const merged = {};
  for (const name of ["settings.json", "settings.local.json"]) {
    const pfad = join(process.cwd(), ".claude", name);
    if (!existsSync(pfad)) continue;
    try {
      const settings = JSON.parse(readFileSync(pfad, "utf-8"));
      if (settings.env && typeof settings.env === "object") Object.assign(merged, settings.env);
    } catch {
      // Kaputtes JSON blockiert den Lauf nicht — nur diese eine Quelle faellt aus.
    }
  }
  return merged;
}

/**
 * Fuehrt ein konfiguriertes Kommando aus.
 *
 * Eine Shell ist hier zwingend — anders als in board.mjs, wo Issue #196 sie gerade
 * abgeschafft hat. Der Unterschied: Dort stehen die Kommandos fest im Code und
 * lassen sich als Argument-Array uebergeben. Hier ist `cmd` eine frei konfigurierte
 * Kommandozeile aus der workflow.config.json ("mvn verify", "npm --prefix frontend
 * run build"), die Operatoren und Umleitungen enthalten darf. Ohne Shell gaebe es
 * das Feature nicht.
 *
 * Statt fest "sh" zu starten (das es unter Windows nicht gibt, Issue #199) waehlt
 * Node mit shell:true die Shell der Plattform: /bin/sh auf POSIX, die ComSpec-Shell
 * (im Regelfall cmd.exe) unter Windows. Bewusst nicht PowerShell: Der Wert ist eine
 * Nutzer-Konfiguration, und cmd.exe ist das, was ein Windows-Nutzer beim Eintragen
 * eines Build-Kommandos erwartet; PowerShell haette zudem eine eigene
 * Operator-Syntax (kein && vor Version 7).
 *
 * PATH-Aufloesung bewusst (S4036, Issue #183).
 *
 * Die Ausgabe wird eingesammelt und von uns geschrieben statt via stdio:"inherit"
 * durchgereicht: nur so steht sie garantiert zwischen der eigenen Kopf- und
 * Fusszeile und nicht irgendwo dazwischen.
 */
function kommandoAusfuehren(cmd, env) {
  const res = spawnSync(cmd, { cwd: process.cwd(), encoding: "utf-8", env, shell: true });
  // status ist null, wenn der Prozess durch ein Signal endete oder gar nicht erst
  // startete — beides ist rot, nie gruen.
  return { gruen: res.status === 0, ausgabe: `${res.stdout || ""}${res.stderr || ""}` };
}

function schreibeZusammenfassung(daten) {
  const pfad = zusammenfassungPfad();
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, JSON.stringify(daten, null, 2) + "\n", "utf-8");
  } catch (err) {
    // Die Datei ist die Datenquelle des Nacht-Runners; ihr Ausfall darf nicht
    // stillschweigend durchgehen, auch nicht bei gruenen Checks.
    fail(`Zusammenfassung konnte nicht geschrieben werden (${pfad}): ${err.message}`);
  }
  return pfad;
}

/**
 * Fuehrt die Auswahl aus `planen` aus und gibt den Exit-Code zurueck.
 *
 * Der Rueckgabewert je gelaufenem Kommando steht in der Zusammenfassung: `gruen`,
 * `rot` oder `nicht gestartet`. Ohne dieses Feld koennte der Runner einen
 * Fehlschlag nicht dem ausloesenden Paket zuordnen (Kriterium 9 aus Issue #420).
 */
function ausfuehren(args) {
  const auswahl = planen(args);
  const env = { ...process.env, ...settingsEnv() };

  // Vorab in den Bericht: Was nicht laeuft, ist genauso ein Ergebnis wie was laeuft.
  for (const e of auswahl.ausgelassen) {
    process.stdout.write(`ausgelassen: ${e.cmd} — ${e.grund}\n`);
  }

  const laufen = auswahl.laufen.map((e) => ({ ...e, ergebnis: "nicht gestartet" }));
  let rot = false;
  for (const eintrag of laufen) {
    if (rot) break; // Beim ersten roten ist Schluss; der Rest bleibt "nicht gestartet".
    process.stdout.write(`\n$ ${eintrag.cmd} — ${eintrag.grund}\n`);
    const { gruen, ausgabe } = kommandoAusfuehren(eintrag.cmd, env);
    process.stdout.write(ausgabe);
    eintrag.ergebnis = gruen ? "gruen" : "rot";
    process.stdout.write(`-> ${eintrag.ergebnis}\n`);
    rot = !gruen;
  }

  // Auch bei rotem Abbruch geschrieben — und beim leeren Paket ebenso: "keine
  // Pruefung, weil nichts veraendert wurde" ist ein Ergebnis und kein Loch.
  const pfad = schreibeZusammenfassung({ ...auswahl, laufen });
  process.stdout.write(`\nZusammenfassung: ${pfad}\n`);
  return rot ? 1 : 0;
}

// --- CLI -------------------------------------------------------------------

function parseArgs(rest) {
  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--since") {
      // Fehlt der Wert ganz, ist das derselbe Fall wie ein leerer: nicht
      // aufloesbar, also voller Umfang.
      args.since = rest[i + 1] ?? "";
      i += 1;
    } else {
      fail(`Unbekanntes Argument: '${rest[i]}'`);
    }
  }
  return args;
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const [command, ...rest] = argv;
  if (command === "plan") {
    process.stdout.write(JSON.stringify(planen(parseArgs(rest)), null, 2) + "\n");
    return 0;
  }
  if (command === "run") return ausfuehren(parseArgs(rest));

  process.stdout.write(HELP);
  return fail(`Unbekannter Befehl: '${command}'. Erwartet: plan oder run`);
}

// Nur als CLI ausfuehren, nicht beim Import (z. B. durch die node:test-Suite, #135).
// realpathSync statt resolve: Node loest fuer import.meta.url Symlinks auf (macOS:
// /var -> /private/var), ein nur normalisierter argv[1] wuerde dann nie matchen (#146).
let runAsCli = false;
if (process.argv[1]) {
  try {
    runAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { /* argv[1] nicht aufloesbar -> kein CLI-Start */ }
}
if (runAsCli) {
  try {
    // exitCode statt process.exit: `run` faerbt den Lauf rot, ohne ihn abzuschneiden.
    process.exitCode = main();
  } catch (err) {
    const prefix = err instanceof ChecksError ? "Fehler" : "Unerwarteter Fehler";
    process.stderr.write(`${prefix}: ${err.message}\n`);
    process.exit(1);
  }
}
