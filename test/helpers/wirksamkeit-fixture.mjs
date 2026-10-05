// Wegwerf-Projekt fuer die Tests von kit/wirksamkeit.mjs (Issue #787, Plan #782).
//
// Die Auswertung ist eine reine Leseoperation ueber Dateien — kein Board, kein Git.
// Sie laesst sich deshalb vollstaendig an Fixtures pruefen: ein Temp-Verzeichnis mit
// .claude/ und darin das Ausfuehrungsprotokoll, genau wie ein echtes Projekt es traegt.
//
// Aufgerufen wird das ECHTE Werkzeug aus kit/ mit cwd im Fixture, im selben Prozess
// ueber `aufrufen` (Issue #1213, Plan #1199 E6) — nach demselben Muster wie
// test/helpers/aufwand-fixture.mjs. Board-Adapter und `checks.mjs bereiche` sind
// Attrappen-Funktionen statt Kindprozessen; dass die Vorgabe wirklich die Kommandos
// unter `.claude/kit/` startet, belegt test/ablauf-wirksamkeit-cli.test.mjs.
//
// Die Zeitstempel der Protokollzeilen entstehen RELATIV zur echten Jetzt-Zeit
// (`vorTagen`): Das Fenster der Auswertung haengt an `new Date()` im Werkzeug, und ein
// fester Stempel laege irgendwann ausserhalb jedes Fensters. Tests, die Lauftage
// zaehlen, nutzen deshalb IDENTISCHE `vorTagen`-Werte je Tag — zwei knapp
// verschiedene Werte koennten ueber eine Kalendertagsgrenze fallen.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { aufrufen } from "../../kit/wirksamkeit.mjs";

const TAG_MS = 24 * 60 * 60 * 1000;

/** Der ISO-Zeitstempel "vor n Tagen" — n darf gebrochen sein. */
export function vorTagen(n) {
  return new Date(Date.now() - n * TAG_MS).toISOString();
}

/**
 * Eine Protokollzeile, wie `ausfuehrungSchreiben` in kit/checks.mjs sie anhaengt:
 * Zeitpunkt, Kommando, Ergebnis, Dauer — durch Tabs getrennt, dahinter Anlass,
 * Laufkennung und Karte (Issue #948).
 *
 * Die hinteren drei Spalten stehen nur da, wenn der Aufrufer eine davon nennt: So
 * bleibt `zeile({})` die ALTE Vierspalten-Form aus der Zeit vor Issue #948 — genau
 * die Zeile, die eine Auswertung im Bestand vorfindet und die in der Kennzahl je
 * Karte nicht mitzaehlt (Issue #951).
 */
export function zeile({
  tage = 1, zeit, cmd = "node --test", ergebnis = "gruen", dauerMs = 1000, anlass, lauf, karte,
  ausloeser, bereiche, dateien,
}) {
  const stempel = zeit ?? vorTagen(tage);
  const vorn = `${stempel}\t${cmd}\t${ergebnis}\t${dauerMs}`;
  const mitAusloeser = ausloeser !== undefined || bereiche !== undefined || dateien !== undefined;
  if (anlass === undefined && lauf === undefined && karte === undefined && !mitAusloeser) return vorn;
  const mitte = `${vorn}\t${anlass ?? "paket"}\t${lauf ?? stempel}\t${karte ?? ""}`;
  if (!mitAusloeser) return mitte;
  return `${mitte}\t${ausloeser ?? "bereiche"}\t${listeMaskieren(bereiche ?? [])}\t${listeMaskieren(dateien ?? [])}`;
}

/**
 * Eine Liste als EIN Protokollfeld, wie `listeMaskieren` in kit/checks.mjs sie schreibt
 * (Issue #1004): jeder Eintrag maskiert wie das Kommando, dazu das Komma, dann
 * kommagetrennt. Hier nachgebaut und nicht importiert — der Test soll die Schreibform
 * festhalten, nicht die Funktion, die er prueft.
 */
function listeMaskieren(eintraege) {
  return eintraege
    .map((e) => e
      .replaceAll("\\", "\\\\")
      .replaceAll("\t", String.raw`\t`)
      .replaceAll("\n", String.raw`\n`)
      .replaceAll("\r", String.raw`\r`)
      .replaceAll(",", String.raw`\,`))
    .join(",");
}

/**
 * Eine Bewegungszeile, wie `bewegungSchreiben` in kit/board.mjs sie anhaengt:
 * Zeitpunkt, Kartennummer, kanonischer Status — durch Tabs getrennt (Issue #786).
 */
export function bewegung({ tage = 1, zeit, id = "12", status = "in_review" }) {
  return `${zeit ?? vorTagen(tage)}\t${id}\t${status}`;
}

/** Ein MOVED-Eintrag des Aktivitaetsverlaufs, wie die Toolbox ihn liefert. */
export function moved(tage, spalte) {
  return { type: "MOVED", createdAt: vorTagen(tage), detail: `Verschoben nach ${spalte}` };
}

/** Die Antwort auf einen Aufruf, dessen Kommando im Projekt fehlt — wie Node sie gibt. */
function fehlt(name) {
  return { status: 1, stdout: "", stderr: `Error: Cannot find module '.claude/kit/${name}'` };
}

/**
 * Das Fake-Board fuer die Ruecklaeuferquote (Issue #788): eine Attrappe an der Stelle des
 * Kindprozesses `.claude/kit/board.mjs`. Jeder Aufruf landet in `aufrufe` — so belegt ein
 * Test die Zahl der Board-Aufrufe, und die Vorgabe startet je Aufruf genau einen Prozess.
 *
 * `exit` != 0 laesst den Aufruf mit stderr scheitern, sonst antwortet er in der
 * Sammelform von `issue activity --ids` — je angefragter Nummer der hinterlegte Verlauf,
 * fuer eine unbekannte der Eintrag mit Fehlergrund, wie listActivityMany es zusagt.
 */
function fakeBoard({ verlaeufe = {}, exit = 0, stderr = "" }, aufrufe) {
  return (args) => {
    aufrufe.push(args.join(" "));
    if (exit) return { status: exit, stdout: "", stderr: stderr || "Fehler" };
    const ids = (args[args.indexOf("--ids") + 1] ?? "").split(",").filter(Boolean);
    const antwort = {};
    for (const id of ids) antwort[id] = verlaeufe[id] ?? { fehler: `Issue ${id} nicht gefunden` };
    return { status: 0, stdout: JSON.stringify(antwort), stderr: "" };
  };
}

/**
 * Der Fake fuer `checks.mjs bereiche` (Issue #1005), wie das Fake-Board eine Attrappe an
 * der Stelle des Kindprozesses. `exit` != 0 laesst den Aufruf mit stderr scheitern, sonst
 * gibt er `ausgabe` als JSON aus.
 */
function fakeChecks({ ausgabe, exit = 0, stderr = "" }) {
  return (args) => {
    if (exit) return { status: exit, stdout: "", stderr: stderr || "Fehler" };
    if (args[0] !== "bereiche") return { status: 2, stdout: "", stderr: `unerwartet: ${args.join(" ")}` };
    return { status: 0, stdout: JSON.stringify(ausgabe), stderr: "" };
  };
}

/** Die Attrappen und das Aufrufprotokoll je Wegwerf-Projekt. */
const ATTRAPPEN = new Map();

/** Die protokollierten Board-Aufrufe, eine Zeile je Aufruf. */
export function boardAufrufe(dir) {
  return ATTRAPPEN.get(dir)?.aufrufe ?? [];
}

/**
 * Legt ein Projekt an, ruft `fn(dir)` und raeumt danach auf — auch nach einem
 * gescheiterten Assert (finally), sonst bleibt bei jedem roten Lauf ein Verzeichnis
 * im Temp stehen.
 *
 * `zeilen` sind fertige Protokollzeilen (Strings, siehe `zeile`); `zeilen: null`
 * heisst: kein Protokoll anlegen. `config` ist die workflow.config.json des Fixtures.
 * `bewegungen` sind Zeilen fuer `.claude/bewegungen.tsv` (siehe `bewegung`);
 * `board` legt das Fake-Board an: `{ verlaeufe }` fuer Verlaeufe je Kartennummer,
 * `{ exit, stderr }` fuer einen scheiternden `issue activity`-Aufruf. `zuschnitt` legt
 * den Fake fuer `checks.mjs bereiche` an: `{ ausgabe }` fuer dessen JSON, `{ exit, stderr }`
 * fuer einen scheiternden Aufruf. Ohne `zuschnitt` fehlt die Datei, und der Aufruf scheitert.
 */
export function mitProjekt({ zeilen = [], config, bewegungen, board, zuschnitt }, fn) {
  const dir = mkdtempSync(join(tmpdir(), "wirksamkeit-"));
  try {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    if (zeilen !== null) {
      writeFileSync(join(dir, ".claude", "ausfuehrungen.tsv"), zeilen.map((z) => `${z}\n`).join(""), "utf-8");
    }
    if (config !== undefined) {
      writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config, null, 2) + "\n", "utf-8");
    }
    if (bewegungen !== undefined) {
      writeFileSync(join(dir, ".claude", "bewegungen.tsv"), bewegungen.map((z) => `${z}\n`).join(""), "utf-8");
    }
    const aufrufe = [];
    ATTRAPPEN.set(dir, {
      aufrufe,
      board: board === undefined ? () => fehlt("board.mjs") : fakeBoard(board, aufrufe),
      checks: zuschnitt === undefined ? () => fehlt("checks.mjs") : fakeChecks(zuschnitt),
    });
    return fn(dir);
  } finally {
    ATTRAPPEN.delete(dir);
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Roher Aufruf im selben Prozess — fuer die Faelle, in denen der Exit-Code selbst der
 * Befund ist. Ergebnis wie bei `spawnSync`: `{ status, stdout, stderr }`. Board und
 * `checks.mjs` sind die Attrappen, die `mitProjekt` fuer dieses Projekt hinterlegt hat.
 */
export function wirksamkeit(dir, ...cliArgs) {
  const attrappen = ATTRAPPEN.get(dir) ?? { board: () => fehlt("board.mjs"), checks: () => fehlt("checks.mjs") };
  return aufrufen(cliArgs, { cwd: dir, board: attrappen.board, checks: attrappen.checks });
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
