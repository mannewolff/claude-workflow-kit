// Suchtest: Kein Aufrufer von kit/board.mjs nennt einen deutschen Namen (Issue #1556, Plan #1548
// E1, E5, E8). Nach Issue #1555 hat jeder Befehl, jede Option und jeder Auswahlwert einen
// englischen Namen; das naechste Paket weist die deutschen ab. Damit dann weder ein Skill noch der
// Nachtlauf bricht, ruft vorher jede Stelle in kit/, skills/, templates/, en/templates/ und
// install.mjs die englischen.
//
// Ein Aufruf ist eine Zeile mit `board.mjs`, gefolgt von einer bekannten Achse, oder im Code ein
// Aufruf `board(…)`, `boardRoh(…)` mit der Achse als erstem Zeichenkettenargument. Fliesstext wie
// "board.mjs liegt nicht" zaehlt nicht: Ohne bekannte Achse ist es kein Aufruf. Geprueft wird
// gegen `ALTNAMEN` aus kit/board/namen.mjs — jeder fruehere deutsche Name, den board.mjs seit
// Issue #1557 abweist. Erkennungs- und Abweisungscode (`case "melden":`) ist kein Aufruf und
// faellt nicht auf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { ALTNAMEN } from "../kit/board/namen.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const BEREICHE = ["kit", "skills", "templates", join("en", "templates"), "install.mjs"];

// Je Tabelle die frueheren deutschen Namen mit ihrem englischen.
const deutsch = (tabelle) => new Map(Object.entries(tabelle));
// Jede Achse unter ihrem englischen Namen, auch unter dem frueheren deutschen.
const ACHSEN = new Map([
  ...["issue", "code", "issue-review", "context", "nightrun", "session", "hook"].map((a) => [a, a]),
  ...Object.entries(ALTNAMEN.achsen),
]);
const ACHSE_DE = deutsch(ALTNAMEN.achsen);
const OPTION_DE = deutsch(ALTNAMEN.optionen);

/** Die Befunde zu den Woertern eines Aufrufs, beginnend mit der Achse; leer ohne bekannte Achse. */
export function befundeZuAufruf(woerter) {
  const [achse, befehl, aktion] = woerter;
  if (!ACHSEN.has(achse)) return [];
  const befunde = [];
  if (ACHSE_DE.has(achse)) befunde.push(`Achse ${achse} -> ${ACHSE_DE.get(achse)}`);
  const befehlDe = deutsch(ALTNAMEN.befehle[ACHSEN.get(achse)] ?? {});
  if (befehlDe.has(befehl)) befunde.push(`Befehl ${befehl} -> ${befehlDe.get(befehl)}`);
  const istSchutz = befehl === "schutz" || befehl === ALTNAMEN.befehle.code.schutz;
  if (ACHSEN.get(achse) === "code" && istSchutz && Object.hasOwn(ALTNAMEN.schutz, aktion)) {
    befunde.push(`Aktion ${aktion} -> ${ALTNAMEN.schutz[aktion]}`);
  }
  woerter.forEach((wort, i) => {
    const m = /^--([a-z][a-z-]*)$/.exec(wort);
    if (!m) return;
    if (OPTION_DE.has(m[1])) befunde.push(`Option --${m[1]} -> --${OPTION_DE.get(m[1])}`);
    const werte = ALTNAMEN.werte[OPTION_DE.get(m[1]) ?? m[1]];
    if (!werte || i + 1 >= woerter.length) return;
    for (const wert of woerter[i + 1].split("|")) {
      if (Object.hasOwn(werte, wert)) befunde.push(`Wert --${m[1]} ${wert} -> ${werte[wert]}`);
    }
  });
  return befunde;
}

const TRENNER = /[\s"'`,()[\]{}<>;]+/;
const woerterVon = (rest) => rest.split(TRENNER).filter((w) => w !== "");

/** Die Aufrufe einer Zeile als Wortlisten, je beginnend mit dem Wort hinter `board.mjs` bzw. der Achse. */
export function aufrufeInZeile(zeile) {
  const aufrufe = [];
  // Textform: bis zum naechsten Backtick (Ende der Inline-Code-Spanne) oder Zeilenende.
  for (const m of zeile.matchAll(/board\.mjs([^`]*)/g)) {
    aufrufe.push(woerterVon(m[1].split("board.mjs")[0]));
  }
  // Codeform: board("issue", "stand", …), abh.boardRoh("nightrun", …).
  for (const m of zeile.matchAll(/\bboard(?:Roh)?\(\s*(".*)$/g)) {
    aufrufe.push(woerterVon(m[1]));
  }
  return aufrufe;
}

function dateien(pfad) {
  const voll = join(WURZEL, pfad);
  if (!existsSync(voll)) return [];
  if (!statSync(voll).isDirectory()) return [pfad];
  return readdirSync(voll).flatMap((name) => dateien(join(pfad, name)));
}

function alleBefunde() {
  const befunde = [];
  for (const datei of BEREICHE.flatMap(dateien)) {
    if (!/\.(mjs|md|json)$/.test(datei)) continue;
    readFileSync(join(WURZEL, datei), "utf-8").split("\n").forEach((zeile, i) => {
      for (const woerter of aufrufeInZeile(zeile)) {
        for (const b of befundeZuAufruf(woerter)) befunde.push(`${relative(WURZEL, join(WURZEL, datei))}:${i + 1}: ${b}`);
      }
    });
  }
  return befunde;
}

test("der Suchtest erkennt deutsche Namen in Text- und Codeform", () => {
  const befunde = (zeile) => aufrufeInZeile(zeile).flatMap(befundeZuAufruf);
  assert.deepEqual(befunde("node .claude/kit/board.mjs issue melden <id> --teil <n> --text '…'"),
    ["Befehl melden -> report", "Option --teil -> --part"]);
  assert.deepEqual(befunde("`node .claude/kit/board.mjs sitzung melden`"), ["Achse sitzung -> session", "Befehl melden -> report"]);
  assert.deepEqual(befunde("node board.mjs issue stand <id> --zustand laeuft|wartet --text-file <pfad>"),
    ["Befehl stand -> run-state", "Option --zustand -> --state", "Wert --zustand laeuft -> running", "Wert --zustand wartet -> waiting"]);
  assert.deepEqual(befunde("node board.mjs issue create --art mensch --title x"), ["Wert --art mensch -> human"]);
  assert.deepEqual(befunde("node board.mjs code protection einrichten --branch x"), ["Aktion einrichten -> setup"]);
  assert.deepEqual(befunde('abh.board("issue", "stand", karte, "--zustand", z, { cwd })'),
    ["Befehl stand -> run-state", "Option --zustand -> --state"]);
  assert.deepEqual(befunde('cliSpawn(node, [join(kitDir, "board.mjs"), "code", "schutz", "einrichten", "--zweig", zweig])'),
    ["Befehl schutz -> protection", "Aktion einrichten -> setup", "Option --zweig -> --branch"]);
});

test("der Suchtest laesst englische Aufrufe, Fliesstext und Erkennungscode stehen", () => {
  const befunde = (zeile) => aufrufeInZeile(zeile).flatMap(befundeZuAufruf);
  assert.deepEqual(befunde("node .claude/kit/board.mjs issue report <id> --part 2 --text '…'"), []);
  assert.deepEqual(befunde("node board.mjs issue run-state <id> --state running|waiting"), []);
  assert.deepEqual(befunde("Die board.mjs liegt nicht neben dem Kit, `issue melden` heisst sonst so."), []);
  assert.deepEqual(befunde('    case "melden":'), []);
  assert.deepEqual(befunde('boardTeilFehlt("dokumente.mjs", "teilPraefix")'), []);
});

test("kein Aufrufer von board.mjs nennt einen deutschen Namen", () => {
  assert.deepEqual(alleBefunde(), []);
});
