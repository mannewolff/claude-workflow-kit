// Attrappen fuer die Tests des Nacht-Teils session im selben Prozess (Issue #1229, Plan
// #1199, E6): ein `spawn`, das statt eines Kindprozesses ein Objekt mit stdout, stderr und
// close-Ereignis liefert und ein Drehbuch abspielt, eine Uhr, die nur weitergeht, wenn das
// Drehbuch oder der Test sie stellt, und ein `ps`, das eine leere Prozessgruppe meldet.
// `sessionAbh` setzt alles zu den Abhaengigkeiten von `runSession` und `runProcess`
// zusammen; `mitLauf` stellt einen Lauf mit Einheiten in den Zustand und raeumt danach ab.

import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ZUSTAND, einheitAnlegen } from "../../kit/night/grundlagen.mjs";
import { verbrauchLeer } from "../../kit/night/session.mjs";

/**
 * Eine Uhr, die steht, bis jemand sie stellt. `wecker` merkt sich Rueckrufe mit ihrer
 * Faelligkeit; `vor(ms)` stellt die Uhr weiter und ruft dabei jeden faelligen Wecker in der
 * Reihenfolge seiner Faelligkeit. `schlaf(ms)` stellt die Uhr selbst weiter — eine Pause
 * kostet so keine echte Zeit.
 */
export function uhrAttrappe(start = 1_000_000) {
  const wecker = [];
  const uhr = { ms: start };
  uhr.jetzt = () => uhr.ms;
  uhr.wecker = (fn, ms) => {
    const w = { faellig: uhr.ms + ms, fn, aktiv: true };
    wecker.push(w);
    return () => { w.aktiv = false; };
  };
  uhr.vor = (ms) => {
    const ziel = uhr.ms + ms;
    for (;;) {
      const naechster = wecker.filter((w) => w.aktiv && w.faellig <= ziel).sort((a, b) => a.faellig - b.faellig)[0];
      if (!naechster) break;
      naechster.aktiv = false;
      uhr.ms = Math.max(uhr.ms, naechster.faellig);
      naechster.fn();
    }
    uhr.ms = ziel;
  };
  uhr.schlaf = async (ms) => { uhr.vor(ms); };
  /** Die Wecker, die noch nicht geklingelt haben und nicht abgestellt sind. */
  uhr.offen = () => wecker.filter((w) => w.aktiv).length;
  return uhr;
}

/** Ein Kindprozess ohne Prozess: stdout und stderr als Ereignisquellen, `pid` fest. */
function kindAttrappe(pid) {
  const kind = new EventEmitter();
  kind.stdout = new EventEmitter();
  kind.stderr = new EventEmitter();
  kind.pid = pid;
  return kind;
}

/**
 * Ein `spawn`, das ein Drehbuch abspielt. Ein Drehbuch ist eine Liste von Schritten:
 *
 *   "text"            eine Zeile auf stdout (mit Zeilenumbruch)
 *   { roh: "text" }   Text auf stdout, genau so (etwa eine letzte Zeile ohne Umbruch)
 *   { stderr: "t" }   Text auf stderr
 *   { ms: n }         die Uhr um n Millisekunden weiterstellen
 *   { ende: code }    das close-Ereignis mit diesem Exitcode (Vorgabe am Schluss: 0)
 *   { offen: true }   die Session endet nicht von selbst — ein Zeitlimit muss sie beenden
 *
 * Statt einer Liste darf `drehbuch` eine Funktion `(aufruf) => Liste` sein; so sieht es
 * Kommandozeile und Umgebung. Jeder Aufruf steht in `aufrufe` als `{ befehl, args, env, cwd }`.
 */
export function spawnAttrappe(drehbuch, { uhr, pid = 4242 } = {}) {
  const aufrufe = [];
  const spawn = (befehl, args, optionen = {}) => {
    const kind = kindAttrappe(pid);
    const aufruf = { befehl, args, env: optionen.env ?? {}, cwd: optionen.cwd, kind };
    aufrufe.push(aufruf);
    const schritte = typeof drehbuch === "function" ? drehbuch(aufruf) : drehbuch;
    // Erst nach der Rueckkehr von spawn abspielen: `runProcess` haengt seine Zuhoerer an.
    queueMicrotask(() => abspielen(kind, schritte ?? [], uhr));
    return kind;
  };
  return { spawn, aufrufe };
}

function abspielen(kind, schritte, uhr) {
  let beendet = false;
  for (const schritt of schritte) {
    if (typeof schritt === "string") kind.stdout.emit("data", Buffer.from(`${schritt}\n`));
    else if ("roh" in schritt) kind.stdout.emit("data", Buffer.from(schritt.roh));
    else if ("stderr" in schritt) kind.stderr.emit("data", Buffer.from(schritt.stderr));
    else if ("ms" in schritt) uhr.vor(schritt.ms);
    else if ("ende" in schritt) {
      kind.emit("close", schritt.ende, schritt.signal ?? null);
      beendet = true;
    } else if (schritt.offen) beendet = true;
  }
  if (!beendet) kind.emit("close", 0, null);
}

/** `ps` ohne Treffer: Die Prozessgruppe der Session ist leer. */
export const psLeer = () => ({ status: 0, stdout: "", stderr: "" });

/**
 * Die Abhaengigkeiten fuer `runSession`/`runProcess` aus Drehbuch und Uhr. `signale` sammelt
 * jedes Signal an die Prozessgruppe als `{ pid, signal }`; `beimSignal(kind, signal)` darf auf
 * ein Signal antworten, etwa mit dem close-Ereignis. Die Antwort kommt wie bei einem echten
 * Prozess erst nach dem Aufruf von `kill`, nicht in ihm.
 *
 * `plattform` ist fest POSIX: Die Attrappen spielen Prozessgruppe, Signal und `ps`. Mit der
 * echten Plattform naehme `runProcess` im Windows-Job der CI den Zweig mit `taskkill`, und
 * kein Signal kaeme bei `killen` an (Issue #1261).
 */
export function sessionAbh(drehbuch, { uhr = uhrAttrappe(), spawnSync = psLeer, beimSignal, plattform = "linux" } = {}) {
  const { spawn, aufrufe } = spawnAttrappe(drehbuch, { uhr });
  const signale = [];
  const killen = (pid, signal) => {
    signale.push({ pid, signal });
    const kind = aufrufe.at(-1)?.kind;
    if (beimSignal) queueMicrotask(() => beimSignal(kind, signal));
  };
  return {
    abh: { spawn, spawnSync, jetzt: uhr.jetzt, schlaf: uhr.schlaf, wecker: uhr.wecker, killen, plattform },
    aufrufe, signale, uhr,
  };
}

/** Die Argumente eines Laufs, wie `parseArgs` sie liefert, soweit `runSession` sie liest. */
export const ARGS = Object.freeze({ timeoutMin: 60, verbose: false, model: "claude-test", yolo: false });

/**
 * Laesst `fn` mit einem Lauf im Zustand laufen: `ids` werden zu Einheiten (`einheitAnlegen`,
 * in dieser Reihenfolge), Tagesprotokoll und
 * Ergebnisstand liegen in einem eigenen Verzeichnis. Danach steht der Zustand wie vorher, und
 * das Verzeichnis ist geraeumt. `fn` bekommt `{ lauf, einheit(id), protokoll() }`.
 */
export async function mitLauf(ids, fn) {
  const dir = mkdtempSync(join(tmpdir(), "night-session-lauf-"));
  const vorher = { LAUF: ZUSTAND.LAUF, LOG_FILE: ZUSTAND.LOG_FILE, ERGEBNIS_FILE: ZUSTAND.ERGEBNIS_FILE };
  const lauf = { start: null, verbrauch: verbrauchLeer(), einheiten: [] };
  ZUSTAND.LAUF = lauf;
  ZUSTAND.LOG_FILE = join(dir, "night-run.log");
  ZUSTAND.ERGEBNIS_FILE = join(dir, "night-run.json");
  try {
    for (const id of ids) einheitAnlegen(String(id), `Paket ${id}`);
    return await fn({
      lauf,
      einheit: (id) => lauf.einheiten.findLast((e) => e.id === String(id)),
      protokoll: () => {
        try {
          return readFileSync(ZUSTAND.LOG_FILE, "utf-8");
        } catch {
          return "";
        }
      },
      stand: () => JSON.parse(readFileSync(ZUSTAND.ERGEBNIS_FILE, "utf-8")),
    });
  } finally {
    Object.assign(ZUSTAND, vorher);
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Faengt, was `fn` auf stdout schreibt — `log` schreibt jede Zeile dorthin, und im
 * Testprotokoll stuende sie sonst zwischen den Ergebnissen.
 */
export async function stdoutFangen(fn) {
  const original = process.stdout.write;
  let text = "";
  process.stdout.write = (chunk, ...rest) => {
    text += String(chunk);
    const rueckruf = rest.find((r) => typeof r === "function");
    rueckruf?.();
    return true;
  };
  try {
    const ergebnis = await fn();
    return { ergebnis, text };
  } finally {
    process.stdout.write = original;
  }
}
