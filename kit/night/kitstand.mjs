/**
 * night/kitstand.mjs — der feste Kit-Stand des Nacht-Runners (Issue #1226, Plan #1199, E17):
 * der Umsetzungs-Lock, der Worktree je Kette samt Rueckweg der Befunde und der feste
 * Kit-Stand je unbeaufsichtigtem Lauf.
 *
 * Ein Teil von kit/night.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nur aus den Grundlagen, nie aus dem Einstieg: Der Einstieg laedt die Teile,
 * ein Rueckimport waere ein Zyklus. `kit/worktree.mjs` und `tools/frischer-checkout.mjs`
 * importieren direkt von hier.
 *
 * Mitgezogen, obwohl E17 sie nicht nennt: `laufKennungUmgebung` (stand im Abschnitt des
 * festen Kit-Stands und wird mit `kitStandUmgebung` jeder Sitzung mitgegeben) und
 * `laufArt`, das in die Grundlagen zog, weil Teil und Einstieg es teilen.
 *
 * Die Abhaengigkeiten nach aussen — git, der Start eines Programms mit und ohne Warten,
 * Uhr, Schlaf und die Prozess-Probe — stehen an einer Stelle und lassen sich ueber
 * `kitstandAbhaengigkeiten` einsetzen (Plan #1199, E6): So pruefen die Tests den Teil im
 * selben Prozess, ohne Kindprozess und ohne feste Pause.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { spawn as kindStarten, spawnSync } from "node:child_process";
import {
  existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync, readdirSync, cpSync, renameSync,
  linkSync, realpathSync,
} from "node:fs";
import { join, dirname, basename, resolve, relative, isAbsolute } from "node:path";
import { tmpdir, hostname, constants as osConstants } from "node:os";

import {
  ZUSTAND, UMSETZUNG_LOCK, KIT_STAND_MARKIERUNG, BEFUNDE_PATH, BOARD_MAX_BUFFER, log, fail, ersteZeile, gitReste,
  ladeConfigMitOverrides, vergleicheText, laufArt,
} from "./grundlagen.mjs";

// --- Abhaengigkeiten nach aussen (Plan #1199, E6) ---

const VORGABEN = Object.freeze({
  // PATH-Aufloesung bewusst, siehe Begruendung ueber gitReste() (S4036, Issue #183).
  git: (repoRoot, gitArgs) => spawnSync("git", gitArgs, { encoding: "utf-8", cwd: repoRoot }),
  // Ein Programm, auf dessen Ende gewartet wird: sync-blobs des Stands, befunde.mjs vorschlag.
  spawnSync: (befehl, argumente, optionen) => spawnSync(befehl, argumente, optionen),
  // Der Runner des Stands als Kind, auf den der Elternprozess asynchron wartet.
  spawn: kindStarten,
  jetzt: () => new Date(),
  schlaf: (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
  kill: (pid, signal) => process.kill(pid, signal),
});
const abh = { ...VORGABEN };

/**
 * Setzt Abhaengigkeiten des Teils ein; nicht genannte behalten ihren Wert, ohne Argument
 * gelten wieder alle Vorgaben. Nur fuer Tests — der Runner arbeitet mit den Vorgaben.
 */
export function kitstandAbhaengigkeiten(neu) {
  if (neu === undefined) {
    Object.assign(abh, VORGABEN);
    return;
  }
  for (const [name, fn] of Object.entries(neu)) {
    if (!Object.hasOwn(VORGABEN, name)) throw new Error(`kitstandAbhaengigkeiten kennt keine Abhaengigkeit '${name}'`);
    abh[name] = fn;
  }
}

// --- Der Umsetzungs-Lock (Plan #691, E10; Issue #696) ---
//
// Kette und Umsetzungsnacht liefen bisher ausdruecklich nebeneinander: Die Kette baute im
// Worktree, die Umsetzungsnacht in der Hauptkopie. Unter Variante B stimmt das nicht mehr —
// die Umsetzungsstufe baut selbst in der Hauptkopie (E4), und zwei Laeufe, die gleichzeitig
// in denselben Working Tree committen, hinterlassen einen Zustand, den morgens niemand
// entwirrt. E10 entscheidet deshalb den Lock und nicht einen Satz in der Dokumentation:
// Ein Satz, den ein Cron-Eintrag nicht liest, verhindert nichts.
//
// Verwaist wird ueber die Prozess-Id erkannt, nicht ueber eine Verfallsfrist. Eine Frist
// waere geraten — eine Umsetzungsnacht darf laenger dauern als jede Schaetzung, und ein zu
// kurzer Verfall gaebe genau die Gleichzeitigkeit frei, die der Lock verhindern soll.
//
// Die Datei liegt unter `.claude/` und ist damit in jedem Projekt mit dem `.claude/*`-Block
// des Installers per `.gitignore` gedeckt — in den uebrigen deckt sie der Ausschluss in
// `gitReste()`, wie bei Protokoll und wartendem Bericht. Beendet ein harter
// Stopp den Prozess an einem `finally` vorbei, bleibt sie liegen; der naechste Lauf erkennt
// sie als verwaist.

// UMSETZUNG_LOCK, der Pfad der Lock-Datei relativ zur Hauptkopie, steht in kit/night/grundlagen.mjs:
// Die Git-Helfer nehmen ihn vom Rest-Guard aus (Issue #1224).

/**
 * Die Prozess-Id aus einer Lock-Datei — null, wenn es sie nicht gibt, sie nicht lesbar ist
 * oder nicht als positive ganze Zahl dasteht. Alle drei zaehlen als verwaist: Ein Lock,
 * dessen Halter nicht benennbar ist, kann niemanden abhalten.
 *
 * `0` ist ausdruecklich keine gueltige Id — `process.kill(0, 0)` zielte auf die eigene
 * Prozessgruppe und meldete damit fuer jede kaputte Datei einen lebenden Halter.
 */
function lockPid(pfad) {
  try {
    return pidAusInhalt(readFileSync(pfad, "utf-8"));
  } catch {
    return null;
  }
}

/** Die Prozess-Id aus dem Inhalt einer Lock-Datei, nach denselben Regeln wie `lockPid`. */
export function pidAusInhalt(inhalt) {
  const pid = Number(inhalt.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Laeuft der Prozess mit dieser Id noch? `ESRCH` heisst nein; `EPERM` heisst, es gibt ihn
 * und er gehoert einem anderen Nutzer — das ist kein verwaister Lock.
 */
export function prozessLaeuft(pid) {
  try {
    abh.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
}

/**
 * Nimmt den Umsetzungs-Lock in der Hauptkopie.
 *
 * Rueckgabe ist `{ ok: true, hinweis, freigeben }` oder `{ ok: false, art, grund }`. Beide
 * Arten des Fehlschlags lassen die Umsetzung aus — ein Lock, der bei Schreibfehlern
 * uebergangen wird, ist keiner —, sie stehen aber fuer Verschiedenes und sind darum an `art`
 * zu unterscheiden statt am Wortlaut des Grundes: `"belegt"` ist der vorgefundene Lock eines
 * laufenden Laufs, `"schreibfehler"` der Lock, der sich nicht schreiben liess.
 *
 * Die beiden Aufrufer sind darauf verschieden angewiesen: Die Umsetzungsnacht (6861)
 * unterscheidet die Arten — belegt ist fuer sie ein ruhiger Lauf, ein Schreibfehler eine
 * Stoerung der Umgebung. Die Kettenstufe wartet bei `belegt` im Rahmen ihres
 * Umsetzungsbudgets (`aufUmsetzungWarten`, E10) und faellt erst danach, beim Schreibfehler
 * sofort, auf Variante A zurueck, was fuer sie ein vorgesehener Ausgang ist.
 *
 * Wer `ok: false` bekommt, ruft `freigeben` nicht: Der Lock gehoert dann einem anderen Lauf.
 *
 * Atomar (Plan #1113, E9): Die Datei entsteht mit `flag: "wx"` — von zwei Anlaeufen gegen
 * eine freie Sperre legt sie genau einer an. Eine verwaiste Sperre wird nicht ueberschrieben,
 * sondern auf einen eindeutigen Namen umbenannt und sofort geloescht; das Umbenennen gelingt
 * nur einem von zwei Anlaeufen, die dieselbe verwaiste Datei sehen. Danach wird das Anlegen
 * genau einmal wiederholt.
 */
export function umsetzungLockNehmen(repoRoot) {
  const pfad = join(repoRoot, UMSETZUNG_LOCK);
  try {
    mkdirSync(dirname(pfad), { recursive: true });
  } catch (e) {
    return lockSchreibfehler(e);
  }
  let verwaist = false;
  for (let versuch = 0; versuch < 2; versuch++) {
    try {
      writeFileSync(pfad, `${process.pid}\n`, { encoding: "utf-8", flag: "wx" });
      return {
        ok: true,
        hinweis: verwaist ? `verwaisten Lock ${UMSETZUNG_LOCK} aufgeraeumt und selbst genommen` : null,
        freigeben: () => lockFreigeben(pfad),
      };
    } catch (e) {
      if (e.code !== "EEXIST") return lockSchreibfehler(e);
    }
    // Ein zweites EEXIST heisst: Zwischen Wegraeumen und Anlegen kam ein anderer Anlauf
    // zuvor. Seine Sperre ist frisch, und wiederholt wird genau einmal (E9).
    if (versuch > 0) break;
    const geraeumt = verwaistRaeumen(pfad);
    if (geraeumt.ok === false) return geraeumt;
    verwaist = geraeumt.verwaist;
  }
  return lockBelegt(lockPid(pfad) ?? "unbekannt");
}

/** Der Takt, in dem eine Kette eine belegte Umsetzungssperre erneut versucht (E10). */
export const UMSETZUNG_WARTEN_MS = 60 * 1000;

/**
 * Wartet auf eine belegte Umsetzungssperre (Plan #1113, E10): Bei `art: "belegt"` alle
 * `UMSETZUNG_WARTEN_MS` ein neuer Versuch, bis `budgetMs` verbraucht ist. Die Wartezeit
 * zaehlt zum Umsetzungsbudget der Stufe, ein eigenes Wartebudget gibt es nicht
 * (PO-Antwort 4). Ein Schreibfehler wartet nicht — eine gestoerte Umgebung wird durch
 * Warten nicht heil.
 *
 * Waehrend des Wartens steht der Laufstand auf `laeuft`, nicht auf `wartet`: Das ist der
 * Zustand eines Halts, und eine wartende Kette belegt ihre Wurzel weiter (E6).
 *
 * Rueckgabe wie `umsetzungLockNehmen`; nach abgelaufenem Budget das letzte `belegt`, dessen
 * Grund die Wartezeit nennt. Uhr, Sperre, Schlaf und Laufstand sind eingespeist.
 */
export async function aufUmsetzungWarten({ nehmen, jetzt, schlafen, budgetMs, standSetzen }) {
  const start = jetzt();
  let lock = nehmen();
  let standGesetzt = false;
  while (!lock.ok && lock.art === "belegt") {
    const rest = budgetMs - (jetzt() - start);
    if (rest <= 0) {
      const minuten = Math.round((jetzt() - start) / 60000);
      return { ...lock, grund: `${lock.grund}, ${minuten} min im Umsetzungsbudget gewartet` };
    }
    if (!standGesetzt) {
      standSetzen("laeuft", `wartet auf die Umsetzung seit ${new Date(start).toISOString()}`);
      standGesetzt = true;
    }
    await schlafen(Math.min(UMSETZUNG_WARTEN_MS, rest));
    lock = nehmen();
  }
  return lock;
}

function lockBelegt(pid) {
  return { ok: false, art: "belegt", grund: `eine andere Umsetzung haelt ${UMSETZUNG_LOCK} (Prozess ${pid})` };
}

function lockSchreibfehler(e) {
  return { ok: false, art: "schreibfehler", grund: `${UMSETZUNG_LOCK} liess sich nicht schreiben (${e.message})` };
}

/**
 * Liest die vorgefundene Lock-Datei so, wie sie ueber ihren Halter entscheidet. Eine leere
 * Datei kann die frische Sperre eines Anlaufs sein, der sie eben mit `wx` angelegt, seine Id
 * aber noch nicht geschrieben hat; erst nach einem kurzen Moment gilt sie als verwaist.
 */
function lockGesehen(pfad) {
  const inhalt = lockInhalt(pfad);
  if (inhalt === null || inhalt.trim() !== "") return inhalt;
  abh.schlaf(LOCK_LEER_WARTEN_MS);
  return lockInhalt(pfad);
}

/**
 * Raeumt eine vorgefundene Sperre weg, wenn ihr Halter nicht mehr lebt (E9): umbenennen auf
 * einen eindeutigen Namen, dann loeschen. Das Umbenennen gelingt nur einem von zwei
 * Anlaeufen, die dieselbe verwaiste Datei sehen.
 *
 * Rueckgabe: `{ verwaist }` — `true`, wenn diese Datei weggeraeumt wurde, `false`, wenn sie
 * schon weg war —, oder das `ok: false`-Ergebnis von `umsetzungLockNehmen`.
 */
function verwaistRaeumen(pfad) {
  let gesehen;
  try {
    gesehen = lockGesehen(pfad);
  } catch (e) {
    return lockSchreibfehler(e);
  }
  if (gesehen === null) return { verwaist: false }; // inzwischen weg
  const pid = pidAusInhalt(gesehen);
  if (pid !== null && prozessLaeuft(pid)) return lockBelegt(pid);
  const weg = `${pfad}.${process.pid}.${abh.jetzt().getTime()}.verwaist`;
  try {
    renameSync(pfad, weg);
  } catch (e) {
    return e.code === "ENOENT" ? { verwaist: false } : lockSchreibfehler(e);
  }
  if (inhaltOderGesehen(weg, gesehen) !== gesehen) return zurueckholen(weg, pfad);
  rmSync(weg, { force: true });
  return { verwaist: true };
}

/** Der Inhalt der umbenannten Datei; unlesbar wie zuvor heisst: dieselbe verwaiste Datei. */
function inhaltOderGesehen(weg, gesehen) {
  try {
    return lockInhalt(weg);
  } catch {
    return gesehen;
  }
}

/**
 * Weggeraeumt ist, was zwischen Lesen und Umbenennen an dieser Stelle lag. War das nicht mehr
 * die verwaiste Datei, sondern die frische Sperre eines anderen Anlaufs, kommt sie zurueck —
 * per `linkSync`, das eine inzwischen neu angelegte Sperre nicht ueberschreibt.
 */
function zurueckholen(weg, pfad) {
  try {
    linkSync(weg, pfad);
  } catch {
    // Liegt schon eine neue Sperre, haelt die; die zurueckgeholte waere eine zweite.
  }
  rmSync(weg, { force: true });
  return lockBelegt(lockPid(pfad) ?? "unbekannt");
}

/** Wie lange eine leere Lock-Datei Zeit bekommt, die Id ihres Anlegers aufzunehmen. */
const LOCK_LEER_WARTEN_MS = 50;

/**
 * Der rohe Inhalt einer Lock-Datei, null wenn sie fehlt. Jeder andere Lesefehler wirft:
 * Ein Lock, der da ist, aber nicht lesbar, laesst sich auch nicht zuverlaessig nehmen.
 */
function lockInhalt(pfad) {
  try {
    return readFileSync(pfad, "utf-8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Gibt den Umsetzungs-Lock frei — nur, wenn er noch die eigene Prozess-Id traegt. Hat ein
 * anderer Lauf ihn inzwischen uebernommen, gehoert er ihm und bleibt liegen (E9).
 */
function lockFreigeben(pfad) {
  if (lockPid(pfad) !== process.pid) return;
  try {
    rmSync(pfad, { force: true });
  } catch (e) {
    // Gerufen wird das aus einem `finally`; ein Wurf von hier risse den ganzen Lauf
    // mit, nach getaner Arbeit. Liegenbleiben ist unschaedlich — der naechste Lauf
    // findet die Id dieses Prozesses vor und erkennt sie als verwaist.
    log(`${UMSETZUNG_LOCK} liess sich nicht entfernen (${e.message}) — der naechste Lauf raeumt ihn als verwaist auf.`);
  }
}

/**
 * Die Sperren, an denen ein Lauf des Runners in der Hauptkopie erkennbar ist (Issue #929).
 *
 * Heute ist es eine: `.claude/night-umsetzung.lock`. Sie deckt beide Faelle, die die
 * Release-Skills auseinanderhalten muessen — die Umsetzungsnacht nimmt sie, und die
 * Umsetzungsstufe der Kette nimmt unter Variante B dieselbe Datei (6170), weil sie in der
 * Hauptkopie baut. Eine Liste statt einer Konstante, damit eine zweite Sperre hier
 * eingetragen wird und nicht an der Pruefung vorbei entsteht.
 */
export const RUNNER_SPERREN = [UMSETZUNG_LOCK];

/** Die Config der Hauptkopie, so weit sie ohne Lauf-Kontext lesbar ist (Muster #800). */
function configVonPlatte(repoRoot) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, ".claude", "workflow.config.json"), "utf-8"));
  } catch {
    return null; // keine oder unlesbare Config ist ein normaler Zustand
  }
}

/**
 * Darf das lokale `<mainBranch>` der Hauptkopie jetzt nachgezogen werden (Issue #929)?
 *
 * Die Release-Skills arbeiten seit #929 in einem eigenen Worktree und pushen von dort;
 * das lokale `<mainBranch>` bleibt dabei zurueck. Nachgezogen wird es nur, wenn niemand
 * sonst in der Hauptkopie arbeitet: Ein `git rebase` unter einer laufenden Umsetzung
 * verschoebe ihr den Boden, und ein schmutziger Baum bringt den Rebase zum Halten.
 *
 * Gemessen wird mit den Mitteln, die es schon gibt — die Prozess-Id-Logik des
 * Umsetzungs-Locks und `gitReste()` mit denselben Ausnahmen wie der Rest-Guard. Zwei
 * eigene Messungen desselben Zustands liefen auseinander (dieselbe Begruendung wie #818).
 *
 * Rueckgabe: `{ nachziehen, grund }`. `grund` ist bei `true` null, sonst der Satz, den
 * der Skill in seinen Bericht uebernimmt.
 */
export function nachziehenPruefen(repoRoot = process.cwd()) {
  for (const sperre of RUNNER_SPERREN) {
    const pid = lockPid(join(repoRoot, sperre));
    if (pid !== null && prozessLaeuft(pid)) {
      return { nachziehen: false, grund: `${sperre} wird gehalten (Prozess ${pid}) — in der Hauptkopie arbeitet ein Lauf des Runners` };
    }
  }
  const reste = gitReste(repoRoot, configVonPlatte(repoRoot));
  if (reste.length > 0) {
    return { nachziehen: false, grund: `die Hauptkopie traegt unkommittierte Aenderungen: ${reste.join(", ")}` };
  }
  return { nachziehen: true, grund: null };
}

// --- Worktree je Kette (Plan #638, A3) ---
//
// Die Nacht-Kette arbeitet in einem eigenen Worktree ausserhalb des Repos: Im Repo laege
// er als untracked Verzeichnis im `git status` der Umsetzungsnacht. `.claude/` ist bis
// auf `workflow.config.json` und `launch.json` nicht versioniert; ein frischer Worktree
// traegt damit die Config, aber weder Kit-Kopie noch Skills, Settings oder Token. Der
// Runner spiegelt deshalb `.claude/` der Hauptkopie hinein — ohne `night-run-*`, denn
// Log und Ergebnisstand bleiben in der Hauptkopie.

/**
 * Der Ordnername eines Worktrees; der Praefix dient dem Aufraeumen beim Start.
 *
 * `praefix` trennt die Laeufe, die nebeneinander stehen koennen: die Nacht-Kette
 * (`kette`, der Vorgabewert) und der Prueflauf am Tag (`pruefung`). Ohne diese
 * Trennung entfernte ein Prueflauf beim Start den Worktree einer laufenden Kette.
 */
function worktreePraefix(repoRoot, praefix = "kette") {
  return `${praefix}-${basename(resolve(repoRoot))}-`;
}

function gitIm(repoRoot, gitArgs) {
  return abh.git(repoRoot, gitArgs);
}

/**
 * Spiegelt `.claude/` der Hauptkopie in den Worktree, ohne Protokolle und Ergebnisstaende.
 *
 * `force`, weil der Worktree `workflow.config.json` schon traegt — dieselbe Datei, sie
 * wird ueberschrieben, nicht gedoppelt.
 *
 * Die Aufwands-Auswertung (`aufwand.md`, `aufwand.json`, Issue #752) bleibt aus demselben
 * Grund zurueck wie `night-run-*`: Sie gehoert dem Lauf, der sie geschrieben hat, und
 * liegt in der Hauptkopie. Im Worktree waere sie ein fremder Stand, der mit ihm verginge.
 *
 * Dasselbe gilt fuer die vier Dateien der Wirksamkeits-Auswertung (Plan #782, E12):
 * `bewegungen.tsv`, `ausfuehrungen.tsv`, `wirksamkeit.md` und `wirksamkeit.json` bleiben
 * in der Hauptkopie.
 *
 * Auch die vier Dateien der Befunde (Plan #797; Issue #803) bleiben zurueck —
 * `befunde.tsv`, `befunde-vorschlaege.json`, `befunde.md` und `befunde.json`. Fuer
 * `befunde.tsv` kommt zum Grund der anderen ein zweiter dazu: Der Rueckweg
 * `befundeZurueck` HAENGT die im Worktree gebuchten Zeilen an die Hauptkopie AN.
 * Truege der Spiegel die Hauptkopie hinein, kaeme beim Abbau jede alte Zeile doppelt
 * zurueck; so enthaelt die Datei im Worktree ausschliesslich die Buchungen dieser Kette.
 *
 * ANNAHME (E12): Bewegungen und Ausfuehrungen, die IM Worktree entstuenden, gingen mit
 * ihm verloren — der Spiegel geht nur in eine Richtung, und nichts holt sie zurueck.
 * Heute trifft das nichts: Die Umsetzungsstufe baut den Worktree
 * zuerst ab und arbeitet in der Hauptkopie, und die erzeugenden Stufen bewegen nichts
 * nach In review und fahren keine Pruefungen — im Worktree entsteht also gar nichts,
 * was zu protokollieren waere. Bricht diese Annahme (arbeitet eine Stufe kuenftig am
 * Board oder faehrt Pruefungen im Worktree), bricht die Erhebung still: Die Auswertung
 * saehe die Bewegungen und Ausfuehrungen jener Stufe nie und meldete darum zu wenig,
 * ohne dass etwas rot wird. Dann muessen die beiden Protokolle aus dem Worktree
 * zurueckgeholt werden. Fuer die Befunde gilt das seit Issue #803 nicht mehr:
 * `befundeZurueck` holt `befunde.tsv` an beiden Abbaustellen der Kette zurueck — dort
 * fallen die meisten Buchungen an, denn /issue-review laeuft im Worktree —, seit Issue
 * #1028 auch beim Abbau des Prueflaufs.
 */
/**
 * Ob ein Eintrag direkt unter `.claude/` in der Hauptkopie zurueckbleibt: die Protokolle
 * und Auswertungen des Laufs, nicht die Werkzeuge. Entschieden wird am Namen des Eintrags
 * auf der obersten Ebene (Issue #824, night-68) — `.claude/kit/aufwand.mjs` und
 * `.claude/kit/wirksamkeit.mjs` kommen darum mit, `.claude/aufwand.json` nicht.
 */
function bleibtInHauptkopie(name) {
  return name.startsWith("night-run-")
    || name.startsWith("aufwand.")
    || name.startsWith("wirksamkeit.")
    || name.startsWith("befunde.")
    || name === "befunde-vorschlaege.json"
    || name === "bewegungen.tsv"
    || name === "ausfuehrungen.tsv";
}

function claudeSpiegeln(repoRoot, pfad) {
  const quelle = join(repoRoot, ".claude");
  if (!existsSync(quelle)) return;
  const ziel = join(pfad, ".claude");
  mkdirSync(ziel, { recursive: true });
  // Die oberste Ebene geht der Runner selbst durch und kopiert jeden uebrigen Eintrag ohne
  // Filter (Issue #832). Bis dahin entschied ein `cpSync`-Filter ueber den Pfad von `src`
  // relativ zu `.claude/` — und das hing daran, dass `cpSync` ihn in derselben Schreibweise
  // uebergibt wie die Quelle. Unter Windows tat es das nicht (Kurzname des Temp-Verzeichnisses), der
  // Filter liess alles durch, und die Protokolle landeten im Worktree. Ohne Pfadvergleich
  // gibt es keine Schreibweise, die abweichen kann.
  for (const eintrag of readdirSync(quelle, { withFileTypes: true })) {
    if (bleibtInHauptkopie(eintrag.name)) continue;
    cpSync(join(quelle, eintrag.name), join(ziel, eintrag.name), { recursive: true, force: true });
  }
}

/**
 * Legt den Worktree einer Kette an und liefert seinen Pfad.
 *
 * Scheitert `git worktree add`, wirft die Funktion mit der git-Meldung; ob daraus ein
 * `abgebrochen` wird, entscheidet der Aufrufer — ein stiller Rueckfall auf die Hauptkopie
 * hiesse, dass die Kette manchmal neben der Umsetzung im selben Baum liefe.
 *
 * `ref` ist der Stand, auf dem der Worktree aufsetzt (Issue #929). Die Kette und der
 * Prueflauf nehmen den Vorgabewert `HEAD` — sie messen die Arbeit dieser Maschine. Die
 * Release-Skills setzen ihn ausdruecklich: `/merge-production` auf `origin/<mainBranch>`,
 * weil veroeffentlicht wird, was gepusht ist. Immer `--detach`: Ein Branch, der in der
 * Hauptkopie ausgecheckt ist, liesse sich in einem zweiten Worktree gar nicht auschecken.
 *
 * `spiegeln: false` laesst `.claude/` ungespiegelt: Der Worktree ist dann ein frischer
 * Checkout mit nur versionierten Dateien, wie ihn die Pruefung der Push-Stufe braucht
 * (Plan #1035).
 */
export function worktreeAnlegen({ repoRoot, issueId = null, stempel, praefix = "kette", ref = "HEAD", spiegeln = true }) {
  // Ohne Kartennummer bleibt das Segment ganz weg (Plan #904, E11): Der Prueflauf legt
  // EINEN Worktree je Lauf an, und ein leeres Segment behauptete eine fehlende Nummer.
  const nummer = issueId === null ? "" : `${issueId}-`;
  const pfad = join(tmpdir(), `${worktreePraefix(repoRoot, praefix)}${nummer}${stempel}`);
  // Der Halter steht vor dem Ordner: Ein zweiter Start dazwischen saehe sonst einen Ordner
  // ohne Halter und raeumte ihn als verwaist ab (Plan #1113, E1).
  writeFileSync(halterPfad(pfad), JSON.stringify({ host: hostname(), pid: process.pid, seit: abh.jetzt().toISOString() }) + "\n", "utf-8");
  const res = gitIm(repoRoot, ["worktree", "add", "--detach", pfad, ref]);
  if (res.status !== 0) {
    rmSync(halterPfad(pfad), { force: true });
    throw new Error(`git worktree add schlug fehl: ${(res.stderr || res.stdout || "").trim()}`);
  }
  if (spiegeln) claudeSpiegeln(repoRoot, pfad);
  return pfad;
}

/**
 * Liegt das Arbeitsverzeichnis des Prozesses innerhalb von `pfad` (Issue #955)?
 *
 * Ueber aufgeloeste, normalisierte Pfade — nicht ueber einen Zeichenkettenvergleich, der
 * `…/release-abc` fuer einen Teil von `…/release-a` hielte. Laesst sich eine der beiden
 * Seiten nicht aufloesen, lautet die Antwort nein: Dann ist kein Wechsel begruendet.
 */
function cwdLiegtIn(pfad) {
  let ziel, cwd;
  try {
    ziel = realpathSync(pfad);
    cwd = realpathSync(process.cwd());
  } catch {
    return false;
  }
  const rel = relative(ziel, cwd);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Entfernt den Worktree — ueber git, und den Ordner, falls er danach noch liegt.
 *
 * Steht das Arbeitsverzeichnis des Prozesses IM Worktree, wechselt die Funktion zuerst
 * hinaus nach `repoRoot` (Issue #955): Genau so rufen die Release-Skills den Abbau, und
 * Windows sperrt das Loeschen eines Verzeichnisses, in dem ein Prozess steht (EBUSY) —
 * POSIX erlaubt es, die CI auf `windows-latest` stand daran rot. `repoRoot` ist immer
 * vorhanden und der Ort, an dem der Worktree-Eintrag gefuehrt wird. Der Wechsel geschieht
 * NUR in diesem Fall: Wer von aussen aufraeumt, soll sein cwd nicht wechseln sehen.
 */
export function worktreeEntfernen(pfad, repoRoot) {
  if (cwdLiegtIn(pfad)) process.chdir(repoRoot);
  gitIm(repoRoot, ["worktree", "remove", "--force", pfad]);
  rmSync(pfad, { recursive: true, force: true });
  rmSync(halterPfad(pfad), { force: true });
}

/**
 * Die Halter-Datei eines Worktrees oder Kit-Stands (Issue #1183, Plan #1113, E1): neben dem
 * Ordner im Temp-Verzeichnis, nicht darin — so bleibt der Git-Baum und mit ihm `gitClean`
 * unberuehrt, und der Ordnername samt Lauf-Stempel aendert sich nicht.
 */
const HALTER_ENDUNG = ".halter";

function halterPfad(pfad) {
  return `${pfad}${HALTER_ENDUNG}`;
}

/**
 * Gehoert der Ordner noch einem laufenden Runner? Nur dann, wenn sein Halter lesbar ist,
 * auf diesem Rechner geschrieben wurde und sein Prozess noch laeuft. Ein Ordner ohne Halter
 * stammt aus der Zeit vor den Haltern und gilt als verwaist (E2).
 */
function halterLebt(pfad) {
  let halter;
  try {
    halter = JSON.parse(readFileSync(halterPfad(pfad), "utf-8"));
  } catch {
    return false;
  }
  return halter?.host === hostname() && Number.isInteger(halter?.pid) && halter.pid > 0 && prozessLaeuft(halter.pid);
}

/**
 * Die Schwelle aus dem Config-Block `befunde` der Hauptkopie (Issue #800).
 * SYNC: `schwelleLesen` in kit/befunde.mjs — dieselbe Regel samt Vorgabe 3, dupliziert
 * nach dem Muster #440 und mit `repoRoot` statt `process.cwd()`, denn der Runner steht
 * beim Abbau nicht zwingend in der Hauptkopie.
 */
function befundeSchwelle(repoRoot) {
  try {
    const cfg = JSON.parse(readFileSync(join(repoRoot, ".claude", "workflow.config.json"), "utf-8"));
    const wert = cfg?.befunde?.schwelle;
    if (Number.isInteger(wert) && wert > 0) return wert;
  } catch { /* keine Config ist ein normaler Zustand — Vorgabe. */ }
  return 3;
}

/**
 * Der Nullpunkt je Art aus `befunde-vorschlaege.json` der Hauptkopie (Plan #797, E11).
 * SYNC: `nullpunktFuer` in kit/befunde.mjs — dupliziert wie die Schwelle darueber.
 */
function befundeNullpunkt(repoRoot, art) {
  try {
    const daten = JSON.parse(readFileSync(join(repoRoot, ".claude", "befunde-vorschlaege.json"), "utf-8"));
    const wert = daten?.[art]?.nullpunkt;
    if (Number.isInteger(wert) && wert >= 0) return wert;
  } catch { /* keine Vorschlagsdatei ist der Regelfall — Nullpunkt null. */ }
  return 0;
}

/** Der Zaehlerstand je Art (Spalte 5) aus Protokollzeilen; fehlerhafte Zeilen zaehlen nicht.
 *  SYNC: `zaehleArten` in kit/befunde.mjs. */
function befundeArtenZaehlen(zeilen) {
  const zaehler = new Map();
  for (const zeile of zeilen) {
    const spalten = zeile.split("\t");
    if (spalten.length < 7) continue;
    zaehler.set(spalten[4], (zaehler.get(spalten[4]) ?? 0) + 1);
  }
  return zaehler;
}

/** Die Zeilen einer `befunde.tsv`; eine fehlende oder unlesbare Datei zaehlt als keine. */
function befundeZeilen(pfad) {
  try {
    return readFileSync(pfad, "utf-8").split(/\r?\n/).filter((z) => z !== "");
  } catch {
    return [];
  }
}

/**
 * Holt die im Worktree gebuchten Befunde in die Hauptkopie zurueck (Issue #803, night-69).
 *
 * ANHAENGEND, nie kopierend (Plan #797, E8): Der Spiegel traegt `befunde.tsv` gar nicht
 * erst in den Worktree, die Datei dort enthaelt also ausschliesslich die Buchungen dieser
 * Kette — und Kopieren ueberschriebe die Hauptkopie und loeschte jede fruehere Zeile.
 *
 * Die Schwelle prueft der Rueckweg selbst, am GESAMTSTAND der Hauptkopie nach dem
 * Anhaengen (E20, Fund B1 der Plan-Pruefung): Der Worktree zaehlt ab null — stehen zwei
 * Vorkommen in der Hauptkopie und kommt das dritte in der Kette, sah `buchen` dort den
 * Stand 1 und schwieg. Zurueck kommen nur die BERUEHRTEN Arten, die die Schwelle
 * (oberhalb ihres Nullpunkts, wie bei `buchen`) erreichen; der Aufrufer macht daraus je
 * Art einen Vorschlag (Issue #804).
 *
 * Fehlt die Datei im Worktree, bleibt die Hauptkopie unberuehrt. Ein gescheitertes
 * Anhaengen ist ein Hinweis im Protokoll und haelt den Abbau nicht auf — das Protokoll
 * ist Buchhaltung, keine Bedingung (Muster checks-7).
 */
export function befundeZurueck(pfad, repoRoot) {
  const zeilen = befundeZeilen(join(pfad, ".claude", "befunde.tsv"));
  if (zeilen.length === 0) return [];

  const ziel = join(repoRoot, ".claude", "befunde.tsv");
  try {
    mkdirSync(dirname(ziel), { recursive: true });
    appendFileSync(ziel, zeilen.map((z) => `${z}\n`).join(""), "utf-8");
  } catch (e) {
    log(`Hinweis: Befunde aus dem Worktree nicht zurueckgeholt (${ziel}): ${e.message} — der Abbau geht weiter.`);
    return [];
  }

  const beruehrt = befundeArtenZaehlen(zeilen);
  const stand = befundeArtenZaehlen(befundeZeilen(ziel));
  const schwelle = befundeSchwelle(repoRoot);
  return [...beruehrt.keys()].sort(vergleicheText)
    .filter((art) => (stand.get(art) ?? 0) - befundeNullpunkt(repoRoot, art) >= schwelle);
}

/**
 * Ruft `befunde.mjs vorschlag --art <a>` fuer eine Mangel-Art an der Schwelle
 * (Issue #804, night-70) und protokolliert das Ergebnis in genau einer Zeile.
 *
 * KEIN GATE, wie bei den Auswertungen (E9): Ein Fehlschlag — fehlendes Werkzeug,
 * unerreichbares Board, unlesbare Zustandsdatei — ist eine Protokollzeile und haelt den
 * Abbau des Worktrees nicht auf. Auf dem Spiel steht ein Vorschlag, den ein Mensch
 * ohnehin erst bewerten muss; der Abbau dagegen raeumt einen Worktree weg, dessen
 * Liegenbleiben den naechsten Lauf stoert.
 */
function befundeVorschlagen(repoRoot, art) {
  try {
    if (!existsSync(BEFUNDE_PATH)) throw new Error(`${BEFUNDE_PATH} liegt nicht vor`);
    const res = abh.spawnSync(process.execPath, [BEFUNDE_PATH, "vorschlag", "--art", art], {
      encoding: "utf-8", cwd: repoRoot, maxBuffer: BOARD_MAX_BUFFER,
    });
    if (res.error) throw new Error(`liess sich nicht starten: ${res.error.message}`);
    let stand;
    try {
      stand = JSON.parse(res.stdout);
    } catch (err) {
      throw new Error(`Ausgabe nicht lesbar: ${err.message}`);
    }
    if (res.status !== 0 || stand?.ok !== true) throw new Error(stand?.fehler || `Exit ${res.status}`);
    const kennung = stand.karte === null ? `Pool-Idee ${stand.ideaId}` : `Karte ${stand.karte}`;
    if (stand.angelegt) log(`  Vorschlag fuer '${art}' angelegt: ${kennung} — ${stand.titel}`);
    else if (stand.ergaenzt) log(`  Vorschlag fuer '${art}' ergaenzt: Karte ${stand.karte}, Stand ${stand.zaehlerstand}.`);
    else log(`  Kein Vorschlag fuer '${art}': ${stand.grund}`);
  } catch (err) {
    log(`Vorschlag fuer '${art}' fehlgeschlagen: ${err.message} — der Abbau geht weiter.`);
  }
}

/**
 * Der Rueckweg unmittelbar vor einem Worktree-Abbau — in der Kette an BEIDEN Abbaustellen
 * gerufen (vor der Stufe umsetzung und im finally am Kettenende), im Prueflauf im finally
 * seiner Runden (Issue #1028). Das Nullen von `wt` nach dem ersten Abbau verhindert den
 * zweiten Lauf und damit doppeltes Anhaengen; die Arten an der Schwelle stehen als eine
 * Zeile im Protokoll.
 *
 * Je zurueckgegebener Art folgt ein `befunde.mjs vorschlag --art <a>` (Issue #804):
 * Hier — am Anlass — und nicht erst beim naechsten `push main`, weil ein zweiter Ort
 * ein zweiter Zeitpunkt waere, zu dem dieselbe Zahl anders herauskommen kann (E9).
 */
export function befundeZurueckUndVorschlagen(lauf) {
  const arten = befundeZurueck(lauf.wt, lauf.repoRoot);
  if (arten.length === 0) return;
  log(`  Befunde aus dem Worktree zurueckgeholt — Schwelle erreicht: ${arten.join(", ")}.`);
  for (const art of arten) befundeVorschlagen(lauf.repoRoot, art);
}

/**
 * Raeumt liegengebliebene Worktrees dieses Repos auf — beim Start jeder Kette.
 *
 * Ein harter Absturz laesst den Ordner unter dem Temp-Verzeichnis und den Eintrag in
 * `git worktree list` zurueck; beide muessen weg, sonst legt der naechste Lauf einen
 * zweiten Worktree neben einen toten. Liefert die entfernten Pfade.
 *
 * Geraeumt wird nur der eigene Praefix (`kette` als Vorgabe, `pruefung` fuer den
 * Prueflauf am Tag): Ein Lauf, der jeden Praefix abraeumte, zerstoerte den Worktree
 * des jeweils anderen, der gerade daneben laeuft.
 *
 * Innerhalb des Praefixes bleibt jeder Ordner stehen, dessen Halter einem laufenden Prozess
 * auf diesem Rechner gehoert (Issue #1183): Ein zweiter Runner derselben Laufart in einer
 * anderen Session raeumt nur die Reste abgestuerzter Laeufe ab. Die Liste nennt nur sie.
 *
 * `behalten` nimmt einen Ordner ausdruecklich aus — den eigenen Kit-Stand (Issue #1200).
 */
export function worktreesAufraeumen(repoRoot, praefixName = "kette", behalten = null) {
  gitIm(repoRoot, ["worktree", "prune"]);
  const praefix = worktreePraefix(repoRoot, praefixName);
  const entfernt = [];
  const namen = readdirSync(tmpdir()).filter((n) => n.startsWith(praefix));
  for (const name of namen) {
    const pfad = join(tmpdir(), name);
    if (name.endsWith(HALTER_ENDUNG)) {
      // Ein Halter ohne Ordner ist der Rest eines Absturzes zwischen den beiden Loeschungen.
      const ordner = pfad.slice(0, -HALTER_ENDUNG.length);
      if (!existsSync(ordner) && !halterLebt(ordner)) rmSync(pfad, { force: true });
      continue;
    }
    // Der Ordner eines lebenden Runners ist kein Rest (Issue #1183): Ihn zu raeumen zerstoerte
    // die Arbeit einer Kette, die in einer anderen Session laeuft.
    if (halterLebt(pfad)) continue;
    if (behalten && resolve(pfad) === resolve(behalten)) continue;
    worktreeEntfernen(pfad, repoRoot);
    entfernt.push(pfad);
  }
  return entfernt;
}

// --- Fester Kit-Stand je unbeaufsichtigtem Lauf (Issue #1102, Plan #1101) ---
//
// Ein unbeaufsichtigter Lauf arbeitet und prueft mit dem Kit des letzten Pushs, nicht mit
// der Kopie der Hauptkopie: Die frischt jedes Paket ueber `sync-blobs` auf, und das naechste
// Paket derselben Nacht arbeitete schon mit dem neuen, unbewaehrten Werkzeug. Der Stand ist
// eine eigene Kit-Installation aus `origin/<mainBranch>` in einem Worktree (A1). Der Runner
// selbst laeuft als Kind aus ihr (A2), und ihre Kopie wird in jeden Baum eingesetzt, in dem
// Sitzungen laufen (A3). Die Markierung im Baum bindet die Wirkung auf `sync-blobs` und den
// Commit-Hook an genau diesen Baum (A4) — eine blosse Umgebungsvariable erbte jeder
// Testprozess einer Nacht samt seiner Fixture-Repos.

// KIT_STAND_MARKIERUNG, die Markierung eines eingesetzten Baums (A4), steht in
// kit/night/grundlagen.mjs: Die Git-Helfer nehmen sie vom Rest-Guard aus (Issue #1224).

// Der Stand dieses Laufs, `{ commit, pfad }` — gesetzt nur im Kind (A2), sonst `null`.
let KIT_STAND_LAUF = null;
// Die Baeume, die dieser Prozess markiert hat. Freigegeben wird beim Ende jedes Laufs, auch
// beim Abbruch ueber process.exit, der kein finally mehr erreicht.
export const KIT_STAND_BAEUME = new Set();

/** Traegt der Stand `ref` die Kit-Quelle selbst (E3)? Nur dann greift der Mechanismus. */
function traegtKitQuelle(repoRoot, ref) {
  return ["kit/night.mjs", "tools/sync-blobs.mjs"]
    .every((datei) => gitIm(repoRoot, ["cat-file", "-e", `${ref}:${datei}`]).status === 0);
}

/**
 * Der Stand des Laufs: Commit und Commit-Zeit von `refs/remotes/origin/<mainBranch>`, ohne
 * `git fetch` (E1). `null`, wenn der Commit die Kit-Quelle nicht traegt (E3) — das ist jedes
 * Projekt ausser dem Kit selbst.
 *
 * Fehlt der Verweis, entscheidet der eigene Arbeitsstand: Traegt er die Kit-Quelle, ist das
 * Fehlen ein Abbruchgrund (E2), und die Funktion wirft. Sonst ist es ein anderes Projekt
 * ohne Remote, das unveraendert laeuft.
 */
export function kitStandErmitteln(repoRoot, mainBranch) {
  const verweis = `refs/remotes/origin/${mainBranch}`;
  const res = gitIm(repoRoot, ["rev-parse", "--verify", "--quiet", `${verweis}^{commit}`]);
  if (res.status !== 0) {
    if (!traegtKitQuelle(repoRoot, "HEAD")) return null;
    throw new Error(`Kit-Stand: der Verweis origin/${mainBranch} fehlt — ohne ihn gibt es keinen veroeffentlichten Stand, mit dem der Lauf arbeiten kann. Einmal 'git fetch origin' oder 'push main', dann neu starten.`);
  }
  const commit = res.stdout.trim();
  if (!traegtKitQuelle(repoRoot, commit)) return null;
  const commitZeit = gitIm(repoRoot, ["show", "-s", "--format=%cI", commit]).stdout.trim();
  return { commit, ref: `origin/${mainBranch}`, commitZeit };
}

/**
 * Stellt den Stand bereit (A1): ein abgeloester Worktree auf `commit` mit einer installierten
 * Kopie, gebaut auf dem Weg des Menschen — `.claude/kit/` und `.claude/skills/` anlegen,
 * das `sync-blobs` DIESES Stands laufen lassen, die Regeltexte nach `.claude/` kopieren.
 * Ein zweiter Weg mit eigener Dateiliste liefe beim ersten neuen Werkzeug auseinander.
 *
 * Er raeumt nichts ab (Issue #1200): Liegengebliebene Staende derselben Laufart raeumt erst
 * das Kind, wenn seine Vorpruefungen bestanden sind (`kitStaendeAufraeumen`) — ein Start,
 * der ohnehin abbricht, soll nichts wegnehmen. Scheitert ein Schritt, wirft die Funktion mit Grund
 * und laesst keinen halben Stand liegen; den Abbruch entscheidet der Aufrufer (E2).
 */
export function kitStandBereitstellen(repoRoot, commit, laufart) {
  const praefix = `kitstand-${laufart}`;
  // Ein eigener Stempel: Der Lauf-Stempel entsteht erst im Kind.
  const stempel = `${abh.jetzt().toISOString().replaceAll(/[-:.TZ]/g, "")}-${process.pid}`;
  const pfad = worktreeAnlegen({ repoRoot, stempel, praefix, ref: commit, spiegeln: false });
  try {
    mkdirSync(join(pfad, ".claude", "kit"), { recursive: true });
    mkdirSync(join(pfad, ".claude", "skills"), { recursive: true });
    // KIT_ROOT ueberschrieben: Eine ererbte Variable liesse sync-blobs in den fremden Root schreiben.
    const res = abh.spawnSync(process.execPath, [join(pfad, "tools", "sync-blobs.mjs")], {
      cwd: pfad, encoding: "utf-8", env: { ...process.env, KIT_ROOT: pfad },
    });
    if (res.status !== 0) {
      throw new Error(`sync-blobs im Stand ${commit.slice(0, 12)} schlug fehl: ${ersteZeile((res.stderr || res.stdout || res.error?.message || "").trim())}`);
    }
    const vorlagen = join(pfad, "templates");
    for (const name of readdirSync(vorlagen).filter((n) => /^CLAUDE-.*\.md$/.test(n))) {
      cpSync(join(vorlagen, name), join(pfad, ".claude", name));
    }
  } catch (err) {
    worktreeEntfernen(pfad, repoRoot);
    throw err;
  }
  return pfad;
}

/**
 * Setzt den Stand in einen Baum ein, in dem Sitzungen laufen (A3): `.claude/kit/*`,
 * `.claude/skills/*` und `.claude/CLAUDE-*.md` des Stands. Es wird nur ueberschrieben, nichts
 * geloescht — was `sync-blobs` nicht schreibt, gehoert nicht zum Stand und bleibt. Danach
 * die Markierung `{ commit, pfad, pid, seit }` (A4).
 */
export function kitStandEinsetzen(stand, baum) {
  const quelle = join(stand.pfad, ".claude");
  const ziel = join(baum, ".claude");
  for (const teil of ["kit", "skills"]) {
    cpSync(join(quelle, teil), join(ziel, teil), { recursive: true, force: true });
  }
  for (const name of readdirSync(quelle).filter((n) => /^CLAUDE-.*\.md$/.test(n))) {
    cpSync(join(quelle, name), join(ziel, name), { force: true });
  }
  const markierung = { commit: stand.commit, pfad: stand.pfad, pid: process.pid, seit: abh.jetzt().toISOString() };
  writeFileSync(join(baum, KIT_STAND_MARKIERUNG), JSON.stringify(markierung, null, 2) + "\n", "utf-8");
  KIT_STAND_BAEUME.add(baum);
}

/** Entfernt die Markierung; die Kopie bleibt auf dem Stand (E5). */
export function kitStandFreigeben(baum) {
  rmSync(join(baum, KIT_STAND_MARKIERUNG), { force: true });
  KIT_STAND_BAEUME.delete(baum);
}

/** Gibt einen Baum frei, den DIESER Prozess markiert hat — nie die Markierung eines anderen Laufs. */
export function kitStandAbgeben(baum) {
  if (KIT_STAND_BAEUME.has(baum)) kitStandFreigeben(baum);
}

/**
 * Setzt den Stand dieses Laufs ein, falls es einen gibt — die vier Stellen aus A3. Einmal je
 * Baum: Die Umsetzungsnacht ruft es vor jeder Session, eingesetzt wird nur beim ersten Mal.
 */
export function kitStandInBaum(baum) {
  if (KIT_STAND_LAUF && !KIT_STAND_BAEUME.has(baum)) kitStandEinsetzen(KIT_STAND_LAUF, baum);
}

/**
 * Raeumt die liegengebliebenen Staende der eigenen Laufart ab (E4, Issue #1200) — im Kind,
 * erst nach `vorbereiten()`: Ein Start, der an den Vorpruefungen scheitert, hat dann nichts
 * weggeraeumt. Der eigene Stand bleibt ausdruecklich stehen; nebeneinander laufende Laufarten
 * raeumen einander nichts weg. Nichts im Dry-Run und nichts ohne Stand.
 */
export function kitStaendeAufraeumen(args) {
  if (args.dryRun || !KIT_STAND_LAUF) return;
  const praefix = `kitstand-${laufArt(args)}`;
  for (const p of worktreesAufraeumen(process.cwd(), praefix, KIT_STAND_LAUF.pfad)) log(`Liegengebliebenen Kit-Stand entfernt: ${p}`);
}

/** Die Startzeile des festen Kit-Stands (A7) — nichts ohne Stand. */
export function kitStandMelden() {
  if (ZUSTAND.LAUF?.kitStand) log(kitStandZeile(ZUSTAND.LAUF.kitStand));
}

/**
 * Ist dieser Prozess das Kind, das aus dem Stand laeuft (A2)? `KIT_STAND` allein genuegt
 * nicht: Ein Runner, den ein Test in einer naechtlichen Sitzung startet, erbt die Variable,
 * liegt aber nicht unter dem Stand — er baut seinen eigenen.
 */
export function istStandKind(skript, env = process.env) {
  if (!env.KIT_STAND || !env.KIT_STAND_PFAD) return false;
  try {
    const rel = relative(realpathSync(env.KIT_STAND_PFAD), realpathSync(skript));
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  } catch {
    return false;
  }
}

/** Was `KIT_STAND` und `KIT_STAND_PFAD` jeder Sitzung mitgeben — leer ohne Stand. */
export function kitStandUmgebung() {
  return KIT_STAND_LAUF ? { KIT_STAND: KIT_STAND_LAUF.commit, KIT_STAND_PFAD: KIT_STAND_LAUF.pfad } : {};
}

/**
 * Die Laufkennung jeder Sitzung (Issue #1194): `KIT_NIGHT_RUN` ist der `start` des
 * Ergebnisstands, unveraendert als ISO-Zeitstempel — derselbe Wert, den die Laufmeldung
 * als `startedAt` sendet. board.mjs schickt ihn als Header X-Night-Run mit, und das Board
 * ordnet daran jede Karte ihrem Lauf zu. Leer ohne Ergebnisstand (--dry-run).
 */
export function laufKennungUmgebung() {
  return ZUSTAND.LAUF?.start ? { KIT_NIGHT_RUN: ZUSTAND.LAUF.start } : {};
}

/** Das Feld `kitStand` des Laufberichts (A7): `{ commit, ref, commitZeit }` oder `null`. */
export function kitStandFeld() {
  if (!KIT_STAND_LAUF) return null;
  const mainBranch = ZUSTAND.config?.mainBranch || "main";
  const commitZeit = gitIm(process.cwd(), ["show", "-s", "--format=%cI", KIT_STAND_LAUF.commit]).stdout.trim() || null;
  return { commit: KIT_STAND_LAUF.commit, ref: `origin/${mainBranch}`, commitZeit };
}

/**
 * Die Zeile `Kit-Stand: <commit, 12 Stellen> (origin/<mainBranch> vom <JJJJ-MM-TT HH:MM>)` (A7).
 * SYNC: dieselbe Form baut `kitStandZeileFuer` in kit/board.mjs fuer jeden Kommentar.
 */
export function kitStandZeile(kitStand) {
  const zeit = kitStand.commitZeit ? ` vom ${kitStand.commitZeit.slice(0, 10)} ${kitStand.commitZeit.slice(11, 16)}` : "";
  return `Kit-Stand: ${kitStand.commit.slice(0, 12)} (${kitStand.ref}${zeit})`;
}

/**
 * Der Stand-Schritt in main() (A2): ermitteln, bereitstellen, den Runner des Stands als Kind
 * starten und dessen Exit-Code zurueckgeben. `null` heisst, dieser Prozess arbeitet selbst —
 * als Kind (dann ist der Stand gesetzt) oder ohne Stand. Fehler brechen ab (E2).
 */
export async function kitStandSchritt(args, argv) {
  if (args.dryRun) return null;
  if (istStandKind(process.argv[1])) {
    KIT_STAND_LAUF = { commit: process.env.KIT_STAND, pfad: process.env.KIT_STAND_PFAD };
    return null;
  }
  const repoRoot = process.cwd();
  const configPfad = join(repoRoot, ".claude", "workflow.config.json");
  let stand;
  let pfad;
  try {
    const mainBranch = (existsSync(configPfad) ? ladeConfigMitOverrides(configPfad)?.mainBranch : null) || "main";
    stand = kitStandErmitteln(repoRoot, mainBranch);
    if (!stand) return null;
    pfad = kitStandBereitstellen(repoRoot, stand.commit, laufArt(args));
  } catch (err) {
    fail(`Kit-Stand nicht bereitgestellt: ${err.message}`, "umgebung");
  }
  process.stdout.write(`${kitStandZeile(stand)} — der Lauf arbeitet mit ${pfad}\n`);
  return await new Promise((fertig) => {
    const kind = abh.spawn(process.execPath, [join(pfad, ".claude", "kit", "night.mjs"), ...argv], {
      cwd: repoRoot, stdio: "inherit",
      env: { ...process.env, KIT_STAND: stand.commit, KIT_STAND_PFAD: pfad },
    });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(signal, () => kind.kill(signal));
    }
    kind.on("error", (err) => {
      process.stderr.write(`Fehler: Runner des Kit-Stands nicht gestartet: ${err.message}\n`);
      fertig(1);
    });
    kind.on("exit", (code, signal) => fertig(code ?? (signal ? 128 + (osConstants.signals[signal] ?? 0) : 1)));
  });
}
