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
 * Zeitpunkt, Kommando, Ergebnis, Dauer — durch Tabs getrennt, dahinter Anlass,
 * Laufkennung und Karte (Issue #948).
 *
 * Die hinteren drei Spalten stehen nur da, wenn der Aufrufer eine davon nennt: So
 * bleibt `zeile({})` die ALTE Vierspalten-Form aus der Zeit vor Issue #948 — genau
 * die Zeile, die eine Auswertung im Bestand vorfindet und die in der Kennzahl je
 * Karte nicht mitzaehlt (Issue #951).
 */
export function zeile({ tage = 1, zeit, cmd = "node --test", ergebnis = "gruen", dauerMs = 1000, anlass, lauf, karte }) {
  const stempel = zeit ?? vorTagen(tage);
  const vorn = `${stempel}\t${cmd}\t${ergebnis}\t${dauerMs}`;
  if (anlass === undefined && lauf === undefined && karte === undefined) return vorn;
  return `${vorn}\t${anlass ?? "paket"}\t${lauf ?? stempel}\t${karte ?? ""}`;
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

/**
 * Das Fake-Board fuer die Ruecklaeuferquote (Issue #788): ein ECHTER Kindprozess
 * unter `.claude/kit/board.mjs` im Fixture — genau der Pfad, den kit/wirksamkeit.mjs
 * aufruft. Jeder Aufruf schreibt eine Zeile nach aufrufe.log; so belegt ein Test die
 * Zahl der gestarteten Kindprozesse, nicht die Zahl der Funktionsaufrufe.
 *
 * Die Antwort kommt aus antwort.json: `exit` != 0 laesst den Prozess mit stderr
 * scheitern, sonst antwortet er in der Sammelform von `issue activity --ids` — je
 * angefragter Nummer der hinterlegte Verlauf, fuer eine unbekannte der Eintrag mit
 * Fehlergrund, wie listActivityMany es zusagt.
 */
const FAKE_BOARD = `import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const hier = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
appendFileSync(join(hier, "aufrufe.log"), args.join(" ") + "\\n");
const { verlaeufe, exit, stderr } = JSON.parse(readFileSync(join(hier, "antwort.json"), "utf-8"));
if (exit) { process.stderr.write(stderr || "Fehler"); process.exit(exit); }
const ids = (args[args.indexOf("--ids") + 1] ?? "").split(",").filter(Boolean);
const antwort = {};
for (const id of ids) antwort[id] = verlaeufe[id] ?? { fehler: \`Issue \${id} nicht gefunden\` };
process.stdout.write(JSON.stringify(antwort));
`;

/** Die geloggten Aufrufe des Fake-Boards, eine Zeile je Kindprozess. */
export function boardAufrufe(dir) {
  const pfad = join(dir, ".claude", "kit", "aufrufe.log");
  return existsSync(pfad) ? readFileSync(pfad, "utf-8").split("\n").filter(Boolean) : [];
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
 * `{ exit, stderr }` fuer einen scheiternden `issue activity`-Aufruf.
 */
export function mitProjekt({ zeilen = [], config, bewegungen, board }, fn) {
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
    if (board !== undefined) {
      const kitDir = join(dir, ".claude", "kit");
      mkdirSync(kitDir, { recursive: true });
      writeFileSync(join(kitDir, "board.mjs"), FAKE_BOARD, "utf-8");
      writeFileSync(join(kitDir, "antwort.json"), JSON.stringify({ verlaeufe: {}, exit: 0, stderr: "", ...board }), "utf-8");
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
