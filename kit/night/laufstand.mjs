/**
 * night/laufstand.mjs — der Laufstand des Nacht-Runners (Issue #1225, Plan #1199, E17):
 * Journal, Puls und Abbruch, der eine Versuch nach einem Umgebungsfehler samt Anhalten und
 * der Waechter, der einen verstummten Lauf abschliesst.
 *
 * Ein Teil von kit/night.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nur aus den Grundlagen, nie aus dem Einstieg: Der Einstieg laedt die Teile,
 * ein Rueckimport waere ein Zyklus. Was ein spaeterer Teil beim Ende des Prozesses
 * freigeben muss — die Markierung des festen Kit-Stands —, reicht der Einstieg an
 * `abbruchHandlerSetzen` herein.
 *
 * Nicht hier, obwohl es im Abschnitt „Laufstand“ stand: `wurzelBelegt` mit
 * `laufstandKopf`. Es fragt Plan-Praefix, fachliche Quelle, Prozess-Probe und die Budgets
 * von Kette und Prueflauf und steht seit Issue #1232 im Teil seines Hauptaufrufers,
 * kit/night/kette.mjs.
 *
 * Die Abhaengigkeiten nach aussen — Board-Aufruf, Uhr, die beiden Arten zu warten, der
 * Start des Waechters, die Prozess-Probe und das Ende des Prozesses — stehen an einer
 * Stelle und lassen sich ueber `laufstandAbhaengigkeiten` einsetzen (Plan #1199, E6):
 * So pruefen die Tests den Teil im selben Prozess, ohne Kindprozess und ohne feste Pause.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { spawn as kindStarten } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, renameSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, hostname } from "node:os";

import {
  ZUSTAND, LETZTES_PROTOKOLL, log, fail, boardRoh, laufMelden, schreibeErgebnisstand, ersteZeile,
  ladeConfigMitOverrides, vergleicheText,
} from "./grundlagen.mjs";

// Der Einstieg, den der Waechter als eigenen Prozess startet — er liegt eine Ebene hoeher.
const EINSTIEG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "night.mjs");

// --- Abhaengigkeiten nach aussen (Plan #1199, E6) ---

const VORGABEN = Object.freeze({
  board: (...cliArgs) => boardRoh(...cliArgs),
  jetzt: () => new Date(),
  // Synchron ueber `Atomics.wait` wie in kit/checks.mjs: `board()` ist synchron, und ein
  // asynchroner Umbau beruehrte jede Aufrufstelle (E13).
  schlaf: (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
  warten: (ms) => new Promise((r) => setTimeout(r, ms)),
  spawn: kindStarten,
  kill: (pid, signal) => process.kill(pid, signal),
  beenden: (code) => process.exit(code),
  // Das Umbenennen, mit dem der Puls die alte Fassung ersetzt (Issue #1262).
  umbenennen: renameSync,
});
const abh = { ...VORGABEN };

/**
 * Setzt Abhaengigkeiten des Teils ein; nicht genannte behalten ihren Wert, ohne Argument
 * gelten wieder alle Vorgaben. Nur fuer Tests — der Runner arbeitet mit den Vorgaben.
 */
export function laufstandAbhaengigkeiten(neu) {
  if (neu === undefined) {
    Object.assign(abh, VORGABEN);
    return;
  }
  for (const [name, fn] of Object.entries(neu)) {
    if (!Object.hasOwn(VORGABEN, name)) throw new Error(`laufstandAbhaengigkeiten kennt keine Abhaengigkeit '${name}'`);
    abh[name] = fn;
  }
}

const isoJetzt = () => abh.jetzt().toISOString();

// --- Laufstand: Journal, Puls, Abbruch (Issue #1084, Plan #1079 E5, E6, E8) ---

// SYNC: dieselben Vorgaben stehen in templates/workflow.config.schema.json unter
// `night.stand` (fristMin, pauseMin).
const STAND_VORGABEN = Object.freeze({ fristMin: 10, pauseMin: 5 });
// Journal und Puls eines Laufs liegen unter `.claude/lauf/<lauf>.jsonl` und
// `.claude/lauf/<lauf>.puls`; `<lauf>` ist der Stempel des Laufberichts.
export const LAUF_ORDNER = join(".claude", "lauf");
const PULS_TAKT_MS = 60_000;
// Das kurze Budget der Board-Aufrufe im Abbruch (E8): Ein Ctrl-C soll binnen Sekunden am
// Board stehen und nicht zwei Minuten auf ein langsames Board warten.
export const ABBRUCH_BUDGET_MS = 5_000;
let PULS_DATEI = null;
let PULS_TIMER = null;
// `art` und `phase` des Pulses (Plan #1243, E8): Zustand des Teils, nicht Argumente, weil der
// Takt `pulsSchreiben()` ohne Angabe ruft und die Datei jedes Mal neu schreibt.
const PULS_ZUSTAND = {};
// Laeuft gerade ein Abbruch (Issue #1084, E8)? Ein zweites Signal oder ein fail() aus dem
// Abbruch heraus beginnt keinen zweiten.
let ABBRUCH_LAEUFT = false;

/**
 * Laedt `night.stand` mit Vorgaben und prueft ihn (E6). Rueckgabe `{ fristMin, pauseMin }`
 * oder `{ fehler }` mit dem Feldnamen. `pauseMin` muss unter `fristMin` liegen: Waehrend
 * der Pause vor dem einen Versuch schweigt der Puls, und ein lebender Lauf gaelte sonst
 * schon als verstummt. Die Labelnamen prueft `issue stand` in kit/board.mjs selbst.
 */
export function nightStandLaden(cfg) {
  const block = cfg?.night?.stand ?? {};
  const stand = { ...STAND_VORGABEN };
  for (const feld of Object.keys(STAND_VORGABEN)) {
    const wert = block[feld];
    if (wert === undefined) continue;
    if (typeof wert !== "number" || !Number.isFinite(wert) || wert <= 0) {
      return { fehler: `night.stand.${feld} muss eine Zahl groesser 0 sein, ist ${JSON.stringify(wert)}.` };
    }
    stand[feld] = wert;
  }
  if (stand.pauseMin >= stand.fristMin) {
    return { fehler: `night.stand.pauseMin (${stand.pauseMin}) muss kleiner sein als night.stand.fristMin (${stand.fristMin}) — sonst gaelte ein lebender Lauf in der Pause vor seinem zweiten Versuch als verstummt.` };
  }
  return stand;
}

/** Haelt den Lauf mit dem Befund von `nightStandLaden` an, bevor er etwas veraendert. */
export function nightStandPruefen(cfg) {
  const stand = nightStandLaden(cfg);
  if (stand.fehler) fail(stand.fehler, "zustand");
}

const laufPfad = (repoRoot, lauf, endung) => join(repoRoot, LAUF_ORDNER, `${lauf}.${endung}`);

/**
 * Haengt eine Zeile ans Journal, synchron. Ein Schreibfehler bricht nichts ab — wie beim
 * Ergebnisstand ist das Journal Protokoll, und der Board-Aufruf danach soll trotzdem
 * versucht werden.
 */
function journalZeile(pfad, objekt) {
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    appendFileSync(pfad, JSON.stringify(objekt) + "\n", "utf-8");
  } catch (err) {
    log(`Journal ${pfad} nicht geschrieben: ${err.message}`);
  }
}

/**
 * Liest ein Journal (E5). Drei Zeilenarten: `lauf` (Beginn und Abbruch des Laufs), `stand`
 * (ein Standwechsel, angelegt als "offen") und `quittung` (das Board hat den Stand mit
 * dieser Nummer angenommen). Nur angehaengt, nie umgeschrieben: Eine Zeile, die vor einem
 * Absturz stand, steht danach noch. Eine unlesbare Zeile — die halbe letzte nach einem
 * Absturz — wird uebergangen.
 *
 * Der Status eines Stands ist `geschrieben` mit Quittung, `ueberholt`, wenn ein spaeterer
 * Stand derselben Karte quittiert ist (`issue stand` ersetzt, ein Nachtrag des aelteren
 * ueberschriebe den neueren), sonst `offen`.
 */
export function journalLesen(pfad) {
  const lauf = [];
  const staende = [];
  const quittiert = new Set();
  const zeilen = existsSync(pfad) ? readFileSync(pfad, "utf-8").split(/\r?\n/) : [];
  for (const roh of zeilen) {
    if (!roh.trim()) continue;
    let zeile;
    try {
      zeile = JSON.parse(roh);
    } catch {
      continue;
    }
    if (zeile.art === "stand") staende.push(zeile);
    else if (zeile.art === "quittung") quittiert.add(zeile.nr);
    else if (zeile.art === "lauf") lauf.push(zeile);
  }
  const mitStatus = staende.map((z) => ({ ...z, status: quittiert.has(z.nr) ? "geschrieben" : "offen" }));
  mitStatus.forEach((z, i) => {
    if (z.status === "offen" && mitStatus.slice(i + 1).some((s) => s.karte === z.karte && s.status === "geschrieben")) {
      z.status = "ueberholt";
    }
  });
  return { lauf, staende: mitStatus };
}

/** Der letzte Journalstand je Karte. */
function letzteZustaende(staende) {
  const letzter = new Map();
  for (const s of staende) letzter.set(s.karte, s.zustand);
  return letzter;
}

/**
 * Die Karten, deren letzter Stand im Journal `laeuft` ist — sie zeigen einen Abbruch. Eine
 * abgegebene Karte (E3) faellt schon dadurch heraus: Ihr letzter Stand ist `abgegeben`.
 */
export function laufendeKarten(staende) {
  return [...letzteZustaende(staende)].filter(([, zustand]) => zustand === "laeuft").map(([karte]) => karte);
}

/** Der Rechner in der Lauf-ID (Plan #1113 E15): der Hostname bis zum ersten Punkt. */
export const RECHNER = hostname().split(".")[0];

/**
 * Position der Karten im Lauf (E5): `{ k, n }` je Karte, gesetzt, sobald der Lauf seine
 * Auftraege kennt. Ein anderer Rechner schaetzt daraus, wie lange der Laufstand frisch bleibt.
 */
const LAUF_POSITIONEN = new Map();

/** Merkt die Position `{ k, n }` einer Karte im Lauf; jeder spaetere Stand der Karte traegt sie. */
export function laufPositionSetzen(karte, position) {
  LAUF_POSITIONEN.set(String(karte), position);
}

/**
 * Die Kopfzeilen des Laufstands (E3, E5, E15): welcher Runner ihn haelt, wann er ihn
 * schrieb und an welcher Stelle seines Laufs die Karte steht. Aus der Journalzeile, damit
 * ein Nachtrag den Stand des Laufs traegt, der ihn schrieb. Eine Zeile aus einem Journal
 * vor #1186 hat keine Lauf-ID und bleibt ohne Kopf.
 */
function laufstandText(zeile) {
  if (!zeile.laufId) return zeile.text;
  const kopf = [`Lauf-ID: ${zeile.laufId}`, `Stand: ${zeile.zeit}`];
  if (zeile.position) kopf.push(`Position: ${zeile.position.k} von ${zeile.position.n}`);
  return zeile.text ? `${zeile.text}\n\n${kopf.join("\n")}\n` : `${kopf.join("\n")}\n`;
}

/** Schreibt einen Journal-Stand ans Board und quittiert ihn; `true`, wenn das Board ihn annahm. */
function standAnsBoard(pfad, zeile, { repoRoot, budgetMs }) {
  // Mit Prozess-Id und Nummer: Zwei Runner teilen sich sonst die Zwischendatei.
  const datei = join(tmpdir(), `${process.pid}-laufstand-${zeile.karte}-${zeile.nr}.md`);
  writeFileSync(datei, laufstandText(zeile), "utf-8");
  try {
    const res = abh.board("issue", "stand", zeile.karte, "--zustand", zeile.zustand, "--text-file", datei, { cwd: repoRoot, budgetMs });
    if (res.status !== 0) {
      log(`Laufstand #${zeile.karte} ${zeile.zustand} nicht geschrieben (${res.text.slice(0, 200)}) — bleibt offen im Journal und wird nachgetragen.`);
      return false;
    }
    journalZeile(pfad, { art: "quittung", nr: zeile.nr, zeit: isoJetzt() });
    return true;
  } finally {
    rmSync(datei, { force: true });
  }
}

/**
 * Der Laufstand nennt das Protokoll des Schritts, der gerade an dieser Karte laeuft oder
 * zuletzt lief (Issue #1090, E16). Hier und nicht an jeder Aufrufstelle: So traegt auch der
 * Stand des Anhaltens den Pfad, und keiner der Wege vergisst ihn.
 */
function mitProtokollZeile(karte, eintrag) {
  const rel = LETZTES_PROTOKOLL.get(karte);
  if (!rel) return eintrag;
  const zeile = `Protokoll: ${rel}`;
  return eintrag ? `${eintrag}\n\n${zeile}` : zeile;
}

/**
 * Der gemeinsame Schreibweg jedes Standwechsels (E5): erst die Journalzeile, dann
 * `issue stand`. Scheitert der Board-Aufruf, bleibt die Zeile offen und wird beim
 * naechsten Start nachgetragen. Rueckgabe `geschrieben`, `offen` oder `null` ohne Lauf
 * (der Trockenlauf hat keinen Stempel und schreibt keinen Stand).
 *
 * Jeder Aufruf traegt eine neue Zeit, und mit ihr erneuert der Laufstand seine Zeile
 * `Stand:` (Plan #1113 E5) — jeder Stufenwechsel geht hier durch.
 */
export function standSetzen(karte, zustand, eintrag, { lauf = ZUSTAND.LAUF_STEMPEL, repoRoot = process.cwd(), budgetMs, position = LAUF_POSITIONEN.get(String(karte)) } = {}) {
  if (!lauf) return null;
  const pfad = laufPfad(repoRoot, lauf, "jsonl");
  const text = mitProtokollZeile(String(karte), mitVersuchVermerk(String(karte), eintrag));
  const zeile = {
    art: "stand", nr: naechsteNr(pfad), zeit: isoJetzt(), karte: String(karte), zustand, text, status: "offen",
    laufId: `${RECHNER}/${process.pid}/${lauf}`, ...(position ? { position } : {}),
  };
  journalZeile(pfad, zeile);
  return standAnsBoard(pfad, zeile, { repoRoot, budgetMs }) ? "geschrieben" : "offen";
}

const naechsteNr = (pfad) => journalLesen(pfad).staende.reduce((max, s) => Math.max(max, Number(s.nr) || 0), 0) + 1;

/**
 * Traegt eine Karte im Journal als `abgegeben` aus (Plan #1113 E3), ohne Board-Aufruf: Ein
 * anderer Runner haelt ihre Wurzel. Danach schreibt dieser Lauf nichts mehr an die Karte —
 * `laufendeKarten` und `staendeNachtragen` uebergehen sie, damit ein spaeterer Abbruch oder
 * Nachtrag den Laufstand des Gewinners nicht ueberschreibt.
 */
export function abgeben(karte, { lauf = ZUSTAND.LAUF_STEMPEL, repoRoot = process.cwd() } = {}) {
  if (!lauf) return;
  const pfad = laufPfad(repoRoot, lauf, "jsonl");
  journalZeile(pfad, { art: "stand", nr: naechsteNr(pfad), zeit: isoJetzt(), karte: String(karte), zustand: "abgegeben", text: "", status: "offen" });
}

/**
 * Lebt der Lauf, dessen Puls hier liegt? Ein Puls ohne lesbare PID gilt als tot; EPERM
 * heisst, den Prozess gibt es, er gehoert nur einem anderen Benutzer.
 */
export function laufLebt(repoRoot, lauf) {
  let pid;
  try {
    pid = JSON.parse(readFileSync(laufPfad(repoRoot, lauf, "puls"), "utf-8")).pid;
  } catch {
    return false;
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    abh.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * Traegt offene Journalzeilen nach (E5) — beim Start jeder Betriebsart ausser dem
 * Trockenlauf, neben `berichteNachtragen`. Journale aufsteigend nach Name (der Stempel ist
 * die Zeit), darin in Zeilenfolge. Das Journal eines noch lebenden Laufs bleibt liegen:
 * Er schreibt selbst weiter, und ein Nachtrag von aussen koennte seinen neueren Stand mit
 * einem aelteren ueberschreiben. Idempotent, weil `issue stand` ersetzt.
 */
export function staendeNachtragen(repoRoot = process.cwd()) {
  const ordner = join(repoRoot, LAUF_ORDNER);
  if (!existsSync(ordner)) return [];
  const journale = readdirSync(ordner).filter((n) => n.endsWith(".jsonl")).sort(vergleicheText);
  const nachgetragen = [];
  for (const name of journale) {
    const lauf = name.slice(0, -".jsonl".length);
    if (laufLebt(repoRoot, lauf)) continue;
    nachgetragen.push(...journalNachtragen(repoRoot, lauf));
  }
  return nachgetragen;
}

/** Traegt die offenen Zeilen EINES Journals nach, in Zeilenfolge — fuer Start und Waechter. */
function journalNachtragen(repoRoot, lauf) {
  const pfad = laufPfad(repoRoot, lauf, "jsonl");
  const nachgetragen = [];
  const staende = journalLesen(pfad).staende;
  const letzter = letzteZustaende(staende);
  // Eine abgegebene Karte gehoert einem anderen Runner (E3): keine ihrer Zeilen geht ans Board.
  for (const zeile of staende.filter((s) => s.status === "offen" && letzter.get(s.karte) !== "abgegeben")) {
    if (!standAnsBoard(pfad, zeile, { repoRoot })) continue;
    nachgetragen.push({ lauf, nr: zeile.nr, karte: zeile.karte, zustand: zeile.zustand });
    log(`Laufstand nachgetragen: #${zeile.karte} ${zeile.zustand} (Journal .claude/lauf/${lauf}.jsonl).`);
  }
  return nachgetragen;
}

/**
 * Erneuert die Puls-Datei: Zeitstempel und PID (E6), dazu `art` und `phase`, soweit gesetzt
 * (Plan #1243, E8). Ohne Lauf ein Leerlauf.
 *
 * Atomar (Issue #1262): erst eine temporaere Datei daneben, dann das Umbenennen. Ein
 * `writeFileSync` auf den Puls leerte ihn zuerst; stirbt der Runner dazwischen oder liest der
 * Waechter genau dann, stuende kein Lebenszeichen da, und ein lebender Lauf koennte als
 * verstummt gelten. Scheitert ein Schritt, bleibt der alte Puls stehen und die temporaere
 * Datei wird entfernt.
 */
export function pulsSchreiben() {
  if (!PULS_DATEI) return;
  const temporaer = `${PULS_DATEI}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaer, JSON.stringify({ zeit: isoJetzt(), pid: process.pid, ...PULS_ZUSTAND }) + "\n", "utf-8");
    abh.umbenennen(temporaer, PULS_DATEI);
  } catch (err) {
    try { rmSync(temporaer, { force: true }); } catch { /* bleibt liegen, der Puls zaehlt nur .puls */ }
    log(`Puls ${PULS_DATEI} nicht geschrieben: ${err.message}`);
  }
}

/**
 * Setzt `art` und `phase` des Pulses (Plan #1243, E8) und schreibt ihn sofort. Geaendert
 * wird nur, was genannt ist; ein genanntes `undefined` nimmt das Feld zurueck. `art` ist die
 * Laufart (`pruefung` beim Prueflauf), `phase` ist `vorbereitung-wartet`, solange der Lauf
 * in seiner Vorbereitung auf das Ende der anderen wartet. Beides lesen fremde Laeufe.
 */
export function pulsZustandSetzen(neu) {
  for (const feld of ["art", "phase"]) {
    if (!Object.hasOwn(neu, feld)) continue;
    if (neu[feld] === undefined) delete PULS_ZUSTAND[feld];
    else PULS_ZUSTAND[feld] = neu[feld];
  }
  pulsSchreiben();
}

/**
 * Legt Journal und Puls dieses Laufs an und startet den Takt (E6). Nur mit Stempel, also
 * nie im Trockenlauf. `unref`: Der Takt haelt den Prozess nicht am Leben.
 */
export function laufstandStarten() {
  if (!ZUSTAND.LAUF_STEMPEL) return;
  PULS_DATEI = laufPfad(process.cwd(), ZUSTAND.LAUF_STEMPEL, "puls");
  // Die Laufart steht im Laufbericht, den der Einstieg davor anlegt (`laufArt`, E8).
  if (ZUSTAND.LAUF?.art) PULS_ZUSTAND.art = ZUSTAND.LAUF.art;
  journalZeile(laufPfad(process.cwd(), ZUSTAND.LAUF_STEMPEL, "jsonl"), { art: "lauf", zeit: isoJetzt(), pid: process.pid, text: "begonnen" });
  pulsSchreiben();
  PULS_TIMER = setInterval(pulsSchreiben, Number(process.env.NIGHT_PULS_MS) || PULS_TAKT_MS);
  PULS_TIMER.unref();
}

/**
 * Der eine Weg jedes Abbruchs, den der Prozess noch bemerkt (E8): Signal, Exception und
 * fail(). Erst synchron die Journalzeile "abgebrochen, <Grund>", dann jede Karte, die im
 * Journal laeuft, auf `abgebrochen` — mit dem Budget des Aufrufers —, dann der Laufbericht
 * mit seinem Abschluss, dann das Ende. Was das Board nicht annimmt, bleibt offen im
 * Journal und wird nachgetragen.
 */
export function laufAbbrechen(grund, { abschluss = "abgebrochen", budgetMs, exitCode = 1 } = {}) {
  if (ABBRUCH_LAEUFT) return abh.beenden(exitCode);
  ABBRUCH_LAEUFT = true;
  if (PULS_TIMER) clearInterval(PULS_TIMER);
  const text = `abgebrochen, ${grund}`;
  if (abschluss === "abgebrochen") log(`Lauf ${text}.`);
  if (ZUSTAND.LAUF_STEMPEL) {
    const pfad = laufPfad(process.cwd(), ZUSTAND.LAUF_STEMPEL, "jsonl");
    const zeit = isoJetzt();
    journalZeile(pfad, { art: "lauf", zeit, pid: process.pid, text });
    for (const karte of laufendeKarten(journalLesen(pfad).staende)) {
      standSetzen(karte, "abgebrochen", `${text} (um ${zeit})`, { budgetMs });
    }
  }
  if (ZUSTAND.LAUF) {
    ZUSTAND.LAUF.abschluss = abschluss;
    if (abschluss === "abgebrochen") ZUSTAND.LAUF.fehlerText = text;
    schreibeErgebnisstand();
    laufMelden({ budgetMs });
  }
  waechterBeenden();
  return abh.beenden(exitCode);
}

/** Ein Abbruch durch einen Fehler, den niemand gefangen hat: Stack nach stderr, dann E8. */
function abbruchDurchFehler(art, err) {
  process.stderr.write(`${err?.stack ?? String(err)}\n`);
  laufAbbrechen(`${art}: ${ersteZeile(err?.message ?? String(err))}`, { budgetMs: ABBRUCH_BUDGET_MS, exitCode: 1 });
}

/**
 * Die vier Handler (E8) — nur im CLI-Start gesetzt, nie beim Import durch die Tests.
 *
 * Jeder Abbruch endet in process.exit und erreicht kein finally mehr: Was beim Ende
 * synchron freizugeben ist — die Markierung des festen Kit-Stands (Issue #1102, A4) —,
 * reicht der Einstieg als `beimEnde` herein; der Teil, der sie fuehrt, ist nicht dieser.
 * `prozess` ist der Prozess, an dem die Handler haengen, im Test ein Ersatz.
 */
export function abbruchHandlerSetzen({ beimEnde = () => {}, prozess = process } = {}) {
  prozess.on("SIGINT", () => laufAbbrechen("SIGINT", { budgetMs: ABBRUCH_BUDGET_MS, exitCode: 130 }));
  prozess.on("SIGTERM", () => laufAbbrechen("SIGTERM", { budgetMs: ABBRUCH_BUDGET_MS, exitCode: 143 }));
  prozess.on("uncaughtException", (err) => abbruchDurchFehler("uncaughtException", err));
  prozess.on("unhandledRejection", (err) => abbruchDurchFehler("unhandledRejection", err));
  prozess.on("exit", beimEnde);
}

// --- Umgebung oder Paket: ein Versuch (Issue #1088, Plan #1079 E13, E15) ---

/**
 * Was der Lauf gerade bearbeitet: die Karte, an der ein Umgebungsfehler vermerkt wird, und
 * die Karten, die er als naechste aufnaehme. Kette und Umsetzungsnacht setzen beides
 * (`Object.assign` oder `.karte =` — das Objekt bleibt dasselbe, weil der Einstieg es ueber
 * den Import haelt); beim Anhalten bekommen die naechsten "nicht begonnen" (E15).
 */
export const LAUF_KONTEXT = { karte: null, kandidaten: () => [] };
// Gesetzt, sobald der Lauf anhaelt: Ein Board-Aufruf, der dann scheitert, wirft, statt einen
// zweiten Versuch und ein zweites Anhalten zu beginnen.
let ANHALTEN_LAEUFT = false;
// Je Karte der Vermerk "2. Versuch" — er steht in jedem weiteren Laufstand dieser Karte, bis
// der Lauf endet, und wird nicht von der naechsten Stufe ueberschrieben.
const VERSUCH_VERMERKE = new Map();

/** Haelt der Lauf gerade an? Eine Funktion, weil der Wert sich nach dem Import aendert. */
export function anhaltenLaeuft() {
  return ANHALTEN_LAEUFT;
}

/** Haengt den Vermerk "2. Versuch" der Karte an einen Laufstand-Text, hoechstens einmal. */
function mitVersuchVermerk(karte, eintrag) {
  const vermerk = VERSUCH_VERMERKE.get(karte);
  if (!vermerk || eintrag.includes(vermerk)) return eintrag;
  return eintrag ? `${eintrag}\n\n${vermerk}` : vermerk;
}

/** Die Pause vor dem zweiten Versuch: `night.stand.pauseMin`, ein unbrauchbarer Block faellt auf die Vorgabe. */
function pauseMs() {
  const stand = nightStandLaden(ZUSTAND.config);
  return (stand.fehler ? STAND_VORGABEN.pauseMin : stand.pauseMin) * 60_000;
}

/**
 * Vermerkt einen Umgebungsfehler und wartet die Pause ab, synchron (`schlaf`): `board()` ist
 * synchron, und ein asynchroner Umbau beruehrte jede Aufrufstelle (E13). Der Puls davor und
 * danach — waehrend der Pause schweigt der Takt, und `pauseMin < fristMin` haelt den
 * Waechter still.
 */
export function zweiterVersuch(grund) {
  const ms = pauseMs();
  const zeit = isoJetzt();
  log(`Umgebungsfehler: ${grund} — 2. Versuch nach ${ms / 1000} s Pause.`);
  if (ZUSTAND.LAUF_STEMPEL) journalZeile(laufPfad(process.cwd(), ZUSTAND.LAUF_STEMPEL, "jsonl"), { art: "lauf", zeit, pid: process.pid, text: `2. Versuch: ${ersteZeile(grund)}` });
  if (LAUF_KONTEXT.karte) VERSUCH_VERMERKE.set(String(LAUF_KONTEXT.karte), `2. Versuch nach Umgebungsfehler um ${zeit}: ${ersteZeile(grund)}`);
  pulsSchreiben();
  abh.schlaf(ms);
  pulsSchreiben();
}

/**
 * Schreibt den letzten Stand der laufenden Karte erneut, jetzt mit dem Vermerk — nach einem
 * gelungenen zweiten Board-Versuch, denn waehrend des Ausfalls nahm das Board nichts an.
 * Eine Karte ohne Stand im Journal bekommt ihn mit dem naechsten Stand ihrer Runde.
 */
export function vermerkAnDieKarte() {
  const karte = LAUF_KONTEXT.karte;
  if (!karte || !ZUSTAND.LAUF_STEMPEL) return;
  const letzter = journalLesen(laufPfad(process.cwd(), ZUSTAND.LAUF_STEMPEL, "jsonl")).staende.findLast((s) => s.karte === String(karte));
  if (letzter && letzter.zustand !== "abgegeben") standSetzen(karte, letzter.zustand, letzter.text);
}

/**
 * Setzt die Staende des Anhaltens (E15): die laufende Karte auf `abgebrochen`, jede Karte,
 * die der Lauf als naechste aufgenommen haette, auf `wartet` mit "nicht begonnen", Grund und
 * Zeitpunkt. Was das Board nicht annimmt, bleibt offen im Journal. Lassen sich die naechsten
 * Karten nicht bestimmen, weil das Board schweigt, gilt dort ihr zuletzt sichtbarer Stand.
 */
export function anhaltenVermerken(grund) {
  ANHALTEN_LAEUFT = true;
  const zeit = isoJetzt();
  const karte = LAUF_KONTEXT.karte ? String(LAUF_KONTEXT.karte) : null;
  log(`Lauf haelt an: ${grund}`);
  if (karte) standSetzen(karte, "abgebrochen", `abgebrochen, Umgebungsfehler um ${zeit}: ${grund}`, { budgetMs: ABBRUCH_BUDGET_MS });
  let ids;
  try {
    ids = LAUF_KONTEXT.kandidaten().map(String);
  } catch (err) {
    log(`  Die naechsten Karten liessen sich nicht bestimmen (${ersteZeile(err.message)}) — am Board gilt ihr zuletzt sichtbarer Stand.`);
    return;
  }
  for (const id of ids.filter((i) => i !== karte)) {
    log(`  #${id} nicht begonnen.`);
    standSetzen(id, "wartet", `nicht begonnen: der Lauf hielt um ${zeit} an — ${grund}`, { budgetMs: ABBRUCH_BUDGET_MS });
  }
}

/**
 * Haelt den Lauf wegen der Umgebung an (E13, E15): Staende setzen, dann der Weg von fail().
 * Die Klasse bleibt die des Ausfalls — ein schweigendes Board ist `tracker`, ein
 * gescheiterter Sitzungsstart `umgebung`.
 */
export function laufAnhalten(grund, klasse = "umgebung") {
  anhaltenVermerken(grund);
  fail(`Lauf angehalten: ${grund}`, klasse);
}

/** Hat die Sitzung ein Ereignis in ihren Strom geschrieben, kam sie zustande (E13). */
export function hatSitzungsereignis(stdout) {
  return String(stdout ?? "").split("\n").some((zeile) => {
    if (!zeile.trim().startsWith("{")) return false;
    try {
      return typeof JSON.parse(zeile)?.type === "string";
    } catch {
      return false;
    }
  });
}

/**
 * Ist dieser Sitzungsstart an der Umgebung gescheitert? Exit ungleich 0 ohne Zeitlimit und
 * ohne ein einziges Sitzungsereignis (E13). Die Kommando-Stufe meldet keine Ereignisse; dort
 * laesst sich Umgebung nicht von Paket trennen, und es bleibt beim harten Stopp ohne Versuch.
 */
export function sitzungsStartGescheitert(res, kommando) {
  const timedOut = res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM";
  if (timedOut || !(res.error || res.status !== 0)) return false;
  return !kommando && !hatSitzungsereignis(res.stdout);
}

export const exitText = (res) => (res.error ? `${res.error.code || res.error.message}` : `Exit ${res.status ?? res.signal}`);

// --- Waechter: der verstummte Lauf (Issue #1085, Plan #1079 E7) ---

// Der Takt, in dem der Waechter nachsieht; bei einer kuerzeren Frist (nur in Tests) die
// Frist selbst, damit "Frist plus ein Pruefakt" eine kurze Zeit bleibt.
const WAECHTER_TAKT_MS = 60_000;
// Die PID des Waechters dieses Laufs; `laufAbschliessen` und `laufAbbrechen` beenden ihn.
let WAECHTER_PID = null;

/**
 * Die Frist in Millisekunden: `night.stand.fristMin`, im Test `KIT_NIGHT_WAECHTER_FRIST_S`
 * in Sekunden. Ein unbrauchbarer Block faellt auf die Vorgabe zurueck — der Runner hat ihn
 * vor dem Start schon abgewiesen, und der Waechter soll an ihm nicht scheitern.
 */
function waechterFristMs(cfg, env = process.env) {
  const sekunden = Number(env.KIT_NIGHT_WAECHTER_FRIST_S);
  if (String(env.KIT_NIGHT_WAECHTER_FRIST_S ?? "").trim() && Number.isFinite(sekunden) && sekunden > 0) return sekunden * 1000;
  const stand = nightStandLaden(cfg);
  return (stand.fehler ? STAND_VORGABEN.fristMin : stand.fristMin) * 60_000;
}

const fristText = (ms) => (ms % 60_000 === 0 ? `${ms / 60_000} min` : `${ms / 1000} s`);

/** Die Puls-Datei eines Laufs (`{ zeit, pid }`) oder `null`, wenn sie fehlt oder unlesbar ist. */
function pulsLesen(repoRoot, lauf) {
  try {
    return JSON.parse(readFileSync(laufPfad(repoRoot, lauf, "puls"), "utf-8"));
  } catch {
    return null;
  }
}

const laufberichtPfad = (repoRoot, lauf) => join(repoRoot, ".claude", `night-run-${lauf}.json`);

/** Der Laufbericht eines Laufs oder `null`. */
function laufberichtLesen(repoRoot, lauf) {
  try {
    return JSON.parse(readFileSync(laufberichtPfad(repoRoot, lauf), "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Was der Waechter vorfindet: `beendet` (Journal weg oder Laufbericht mit Abschluss),
 * `lebt` oder `verstummt`. Verstummt nur, wenn der Puls aelter als die Frist ist UND die
 * PID des Runners nicht mehr lebt: Ein Lauf, der wegen synchroner Pruefungen lange
 * schweigt, aber lebt, gilt nie als verstummt (E7).
 */
function waechterLage(repoRoot, lauf, fristMs) {
  if (!existsSync(laufPfad(repoRoot, lauf, "jsonl"))) return "beendet";
  const bericht = laufberichtLesen(repoRoot, lauf);
  if (bericht && bericht.abschluss != null) return "beendet";
  const alterMs = abh.jetzt().getTime() - Date.parse(pulsLesen(repoRoot, lauf)?.zeit ?? "");
  if (Number.isFinite(alterMs) && alterMs <= fristMs) return "lebt";
  return laufLebt(repoRoot, lauf) ? "lebt" : "verstummt";
}

/**
 * Schliesst einen verstummten Lauf ab (E7): Journalzeile, jede Karte mit Journalstand
 * `laeuft` auf `abgebrochen`, offene Zeilen nachtragen, Laufbericht `abschluss:
 * "verstummt"` samt Einlieferung. Einen Neustart gibt es nicht — ein Neustart von aussen
 * waere ein Lauf ohne Geste (Kriterium 12 aus #1075).
 */
function verstummtAbschliessen(repoRoot, lauf, fristMs) {
  const text = `nicht beendet, letztes Lebenszeichen ${pulsLesen(repoRoot, lauf)?.zeit ?? "unbekannt"}, Frist ${fristText(fristMs)}`;
  log(`Lauf ${lauf} verstummt: ${text}.`);
  const pfad = laufPfad(repoRoot, lauf, "jsonl");
  journalZeile(pfad, { art: "lauf", zeit: isoJetzt(), pid: process.pid, text: `verstummt, ${text}` });
  for (const karte of laufendeKarten(journalLesen(pfad).staende)) {
    standSetzen(karte, "abgebrochen", text, { lauf, repoRoot, budgetMs: ABBRUCH_BUDGET_MS });
  }
  journalNachtragen(repoRoot, lauf);
  const bericht = laufberichtLesen(repoRoot, lauf);
  if (!bericht || bericht.abschluss != null) return;
  bericht.abschluss = "verstummt";
  bericht.fehlerText = text;
  for (const einheit of Array.isArray(bericht.einheiten) ? bericht.einheiten : []) {
    if (einheit.ausgang == null || einheit.ausgang === "unbekannt") {
      einheit.ausgang = "verstummt";
      einheit.grund = text;
    }
  }
  try {
    writeFileSync(laufberichtPfad(repoRoot, lauf), JSON.stringify(bericht, null, 2) + "\n", "utf-8");
  } catch (err) {
    log(`Laufbericht ${lauf} nicht geschrieben: ${err.message}`);
    return;
  }
  laufMelden({ budgetMs: ABBRUCH_BUDGET_MS, datei: laufberichtPfad(repoRoot, lauf), stand: bericht });
}

/**
 * Rueckfall beim Start (E7): Ein Journal, dessen Runner nicht mehr lebt und dessen
 * Laufbericht noch keinen Abschluss traegt, wird wie verstummt abgeschlossen — fuer den
 * Waechter, der mit dem Rechner gestorben ist. Ein Journal ohne Laufbericht bleibt dem
 * Nachtrag ueberlassen.
 */
export function verwaisteLaeufeAbschliessen(repoRoot = process.cwd()) {
  const ordner = join(repoRoot, LAUF_ORDNER);
  if (!existsSync(ordner)) return [];
  const fristMs = waechterFristMs(ZUSTAND.config);
  const abgeschlossen = [];
  for (const name of readdirSync(ordner).filter((n) => n.endsWith(".jsonl")).sort(vergleicheText)) {
    const lauf = name.slice(0, -".jsonl".length);
    if (laufLebt(repoRoot, lauf) || laufberichtLesen(repoRoot, lauf)?.abschluss !== null) continue;
    verstummtAbschliessen(repoRoot, lauf, fristMs);
    abgeschlossen.push(lauf);
  }
  return abgeschlossen;
}

/** Der Modus `--waechter <lauf>`: prueft im Takt, bis der Lauf beendet oder verstummt ist. */
export async function waechterLaufen(lauf, repoRoot = process.cwd()) {
  if (!lauf) return;
  const configPath = join(repoRoot, ".claude", "workflow.config.json");
  if (existsSync(configPath)) ZUSTAND.config = ladeConfigMitOverrides(configPath);
  ZUSTAND.LOG_FILE = join(repoRoot, ".claude", `night-run-${lauf.slice(0, 10)}.log`);
  ZUSTAND.LOG_KENNUNG = `${lauf}-waechter`;
  const fristMs = waechterFristMs(ZUSTAND.config);
  const taktMs = Math.min(WAECHTER_TAKT_MS, fristMs);
  for (;;) {
    await abh.warten(taktMs);
    const lage = waechterLage(repoRoot, lauf, fristMs);
    if (lage === "lebt") continue;
    if (lage === "verstummt") verstummtAbschliessen(repoRoot, lauf, fristMs);
    return;
  }
}

/**
 * Die `spawn`-Optionen des Waechters (Issue #1132, Plan #1128 E10). `detached` gilt auf jeder
 * Plattform: Unter Windows legt Node jedes nicht abgekoppelte Kind in ein Job-Objekt, das
 * mit dem Runner endet — der Waechter stuerbe mit genau dem Lauf, den er ueberwachen soll.
 * Das Konsolenfenster, das `detached` dort sonst bringt (#1123), unterdruecken
 * `windowsHide` und `stdio: "ignore"`; eine Ausgabe, die verloren gehen koennte, hat der
 * Waechter nicht.
 */
export function waechterStartOptionen(cwd) {
  return { cwd, detached: true, stdio: "ignore", windowsHide: true };
}

/**
 * Startet den Waechter dieses Laufs als abgekoppelten Kindprozess des Einstiegs und merkt
 * seine PID im Journal (E7). Nur mit Stempel, also nie im Trockenlauf;
 * `KIT_NIGHT_WAECHTER=0` unterdrueckt ihn (nur fuer Tests).
 */
export function waechterStarten() {
  if (!ZUSTAND.LAUF_STEMPEL || process.env.KIT_NIGHT_WAECHTER === "0") return;
  try {
    const kind = abh.spawn(process.execPath, [EINSTIEG, "--waechter", ZUSTAND.LAUF_STEMPEL], waechterStartOptionen(process.cwd()));
    kind.on("error", (err) => log(`Waechter nicht gestartet: ${err.message}`));
    kind.unref();
    WAECHTER_PID = kind.pid ?? null;
  } catch (err) {
    log(`Waechter nicht gestartet: ${err.message}`);
    return;
  }
  journalZeile(laufPfad(process.cwd(), ZUSTAND.LAUF_STEMPEL, "jsonl"), { art: "lauf", zeit: isoJetzt(), pid: process.pid, waechterPid: WAECHTER_PID, text: "Waechter gestartet" });
}

/** Beendet den Waechter dieses Laufs mit SIGTERM; ohne Waechter ein Leerlauf. */
export function waechterBeenden() {
  if (!WAECHTER_PID) return;
  try {
    abh.kill(WAECHTER_PID, "SIGTERM");
  } catch { /* schon beendet */ }
  WAECHTER_PID = null;
}

/**
 * Setzt den Zustand des Teils zurueck: Puls, Abbruch, Anhalten, Vermerke, Kontext und
 * Waechter. Nur fuer Tests, die mehrere Laeufe im selben Prozess nachstellen.
 */
export function laufstandZuruecksetzen() {
  if (PULS_TIMER) clearInterval(PULS_TIMER);
  PULS_TIMER = null;
  PULS_DATEI = null;
  for (const feld of Object.keys(PULS_ZUSTAND)) delete PULS_ZUSTAND[feld];
  ABBRUCH_LAEUFT = false;
  ANHALTEN_LAEUFT = false;
  WAECHTER_PID = null;
  VERSUCH_VERMERKE.clear();
  LAUF_POSITIONEN.clear();
  Object.assign(LAUF_KONTEXT, { karte: null, kandidaten: () => [] });
}
