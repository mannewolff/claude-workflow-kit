// Die Protokollfrist des Nacht-Runners (Issue #1696, Idee #1684): Zu Beginn jedes Laufs
// loescht der Runner Tagesprotokolle und Laufordner, die aelter sind als
// `night.protokollFristTage` (Vorgabe 14). Alles mit Kennzahlen bleibt.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, readFileSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  protokolleAufraeumen, protokollFrist, aufraeumZeilen, PROTOKOLL_FRIST_VORGABE, TEXTE,
} from "../kit/night/aufraeumen.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";

const TAG = 24 * 60 * 60 * 1000;
const JETZT = Date.parse("2026-10-15T03:00:00Z");
const verzeichnisse = [];

afterEach(() => {
  spracheFestlegen(null);
  while (verzeichnisse.length) rmSync(verzeichnisse.pop(), { recursive: true, force: true });
});

function projekt() {
  const dir = mkdtempSync(join(tmpdir(), "protokollfrist-"));
  verzeichnisse.push(dir);
  mkdirSync(join(dir, ".claude", "protokolle"), { recursive: true });
  return dir;
}

/** Legt eine Datei mit Inhalt an und setzt ihre Aenderungszeit auf `tageAlt` Tage vor JETZT. */
function datei(dir, rel, inhalt, tageAlt) {
  const pfad = join(dir, ".claude", rel);
  mkdirSync(join(pfad, ".."), { recursive: true });
  writeFileSync(pfad, inhalt);
  const zeit = new Date(JETZT - tageAlt * TAG);
  utimesSync(pfad, zeit, zeit);
  return pfad;
}

function kennzahlen(dir, tageAlt) {
  return [
    datei(dir, "night-run-2026-09-01-030000.json", "{\"lauf\":1}", tageAlt),
    datei(dir, "ausfuehrungen.tsv", "a\tb\n", tageAlt),
    datei(dir, "bewegungen.tsv", "c\td\n", tageAlt),
    datei(dir, "befunde.tsv", "e\tf\n", tageAlt),
    datei(dir, "checks-protokolle/node-test.log", "check\n", tageAlt),
  ];
}

test("ein .log und ein Laufordner aelter als die Frist werden geloescht, juengere bleiben", () => {
  const dir = projekt();
  const altLog = datei(dir, "night-run-2026-09-20.log", "x".repeat(100), 20);
  const jungLog = datei(dir, "night-run-2026-10-10.log", "y", 5);
  datei(dir, "protokolle/2026-09-20-030000/1.log", "z".repeat(50), 20);
  datei(dir, "protokolle/2026-10-10-030000/2.log", "w", 5);

  const ergebnis = protokolleAufraeumen(dir, { jetzt: JETZT });

  assert.equal(existsSync(altLog), false);
  assert.equal(existsSync(join(dir, ".claude", "protokolle", "2026-09-20-030000")), false);
  assert.equal(existsSync(jungLog), true);
  assert.equal(existsSync(join(dir, ".claude", "protokolle", "2026-10-10-030000", "2.log")), true);
  assert.equal(ergebnis.anzahl, 2);
  assert.deepEqual(ergebnis.gescheitert, []);
});

test("ein Laufordner mit einer alten und einer jungen Datei bleibt", () => {
  const dir = projekt();
  const alt = datei(dir, "protokolle/2026-09-20-030000/alt.log", "a", 30);
  const jung = datei(dir, "protokolle/2026-09-20-030000/unter/jung.log", "b", 1);

  const ergebnis = protokolleAufraeumen(dir, { jetzt: JETZT });

  assert.equal(existsSync(alt), true);
  assert.equal(existsSync(jung), true);
  assert.equal(ergebnis.anzahl, 0);
});

test("Kennzahlen, checks-protokolle und lose Dateien unter protokolle/ bleiben unveraendert, auch wenn sie alt sind", () => {
  const dir = projekt();
  const bleibend = [...kennzahlen(dir, 100), datei(dir, "protokolle/lose.log", "lose", 100)];
  const vorher = bleibend.map((p) => [readFileSync(p, "utf8"), statSync(p).mtimeMs]);

  const ergebnis = protokolleAufraeumen(dir, { jetzt: JETZT });

  assert.deepEqual(bleibend.map((p) => [readFileSync(p, "utf8"), statSync(p).mtimeMs]), vorher);
  assert.equal(ergebnis.anzahl, 0);
});

test("eine abweichende Frist greift, ohne Feld gilt 14", () => {
  assert.equal(PROTOKOLL_FRIST_VORGABE, 14);
  assert.equal(protokollFrist({}), 14);
  assert.equal(protokollFrist({ night: {} }), 14);
  assert.equal(protokollFrist(undefined), 14);
  assert.equal(protokollFrist({ night: { protokollFristTage: 3 } }), 3);

  const dir = projekt();
  const vierTage = datei(dir, "night-run-2026-10-11.log", "v", 4);
  const zweiTage = datei(dir, "night-run-2026-10-13.log", "z", 2);
  const zehnTage = datei(dir, "night-run-2026-10-05.log", "t", 10);

  protokolleAufraeumen(dir, { jetzt: JETZT, fristTage: protokollFrist({}) });
  assert.equal(existsSync(vierTage), true, "unter der Vorgabe 14 bleibt ein vier Tage altes Protokoll");
  assert.equal(existsSync(zehnTage), true, "unter der Vorgabe 14 bleibt ein zehn Tage altes Protokoll");

  const ergebnis = protokolleAufraeumen(dir, { jetzt: JETZT, fristTage: protokollFrist({ night: { protokollFristTage: 3 } }) });
  assert.equal(existsSync(vierTage), false);
  assert.equal(existsSync(zehnTage), false);
  assert.equal(existsSync(zweiTage), true);
  assert.equal(ergebnis.fristTage, 3);
});

test("im Dry-Run bleibt alles liegen, und das Ergebnis nennt dieselben Pfade", () => {
  const anlegen = (dir) => {
    datei(dir, "night-run-2026-09-20.log", "x".repeat(10), 20);
    datei(dir, "protokolle/2026-09-20-030000/1.log", "y".repeat(7), 20);
    datei(dir, "night-run-2026-10-14.log", "j", 1);
  };
  const trocken = projekt();
  anlegen(trocken);
  const echt = projekt();
  anlegen(echt);

  const probe = protokolleAufraeumen(trocken, { jetzt: JETZT, dryRun: true });
  const lauf = protokolleAufraeumen(echt, { jetzt: JETZT });

  assert.equal(probe.dryRun, true);
  assert.equal(existsSync(join(trocken, ".claude", "night-run-2026-09-20.log")), true);
  assert.equal(existsSync(join(trocken, ".claude", "protokolle", "2026-09-20-030000", "1.log")), true);
  const relativ = (e, dir) => e.pfade.map((p) => p.slice(dir.length)).sort();
  assert.deepEqual(relativ(probe, trocken), relativ(lauf, echt));
  assert.equal(probe.anzahl, lauf.anzahl);
  assert.equal(probe.bytes, lauf.bytes);
});

test("ein nicht loeschbarer Pfad steht unter den gescheiterten, die uebrigen werden geloescht, nichts wirft", () => {
  const dir = projekt();
  const gesperrt = datei(dir, "night-run-2026-09-20.log", "g", 20);
  const frei = datei(dir, "night-run-2026-09-21.log", "f", 19);
  datei(dir, "protokolle/2026-09-20-030000/1.log", "o", 20);

  const ergebnis = protokolleAufraeumen(dir, {
    jetzt: JETZT,
    entfernen: (pfad) => {
      if (pfad === gesperrt) throw new Error("EACCES: permission denied");
      rmSync(pfad, { recursive: true, force: true });
    },
  });

  assert.deepEqual(ergebnis.gescheitert, [{ pfad: gesperrt, grund: "EACCES: permission denied" }]);
  assert.equal(existsSync(gesperrt), true);
  assert.equal(existsSync(frei), false);
  assert.equal(existsSync(join(dir, ".claude", "protokolle", "2026-09-20-030000")), false);
  assert.equal(ergebnis.anzahl, 2);
  assert.equal(ergebnis.bytes, 2, "der gescheiterte Pfad zaehlt nicht mit");
});

test("Anzahl und Bytes stimmen mit den geloeschten Dateien ueberein", () => {
  const dir = projekt();
  datei(dir, "night-run-2026-09-20.log", "a".repeat(1000), 20);
  datei(dir, "protokolle/2026-09-20-030000/1.log", "b".repeat(300), 20);
  datei(dir, "protokolle/2026-09-20-030000/unter/2.log", "c".repeat(200), 20);
  datei(dir, "night-run-2026-10-14.log", "d".repeat(999), 1);

  const ergebnis = protokolleAufraeumen(dir, { jetzt: JETZT });

  assert.equal(ergebnis.anzahl, 2);
  assert.equal(ergebnis.bytes, 1500);
  assert.equal(ergebnis.pfade.length, 2);
});

test("ohne .claude-Verzeichnis gibt es nichts zu loeschen", () => {
  const dir = mkdtempSync(join(tmpdir(), "protokollfrist-leer-"));
  verzeichnisse.push(dir);
  assert.deepEqual(protokolleAufraeumen(dir, { jetzt: JETZT }),
    { anzahl: 0, bytes: 0, pfade: [], gescheitert: [], dryRun: false, fristTage: 14 });
});

test("die Texte tragen je Sprache dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(TEXTE), []);
});

test("die Log-Zeile entsteht aus dem Ergebnis, deutsch und englisch", () => {
  const ergebnis = { anzahl: 3, bytes: 5 * 1024 * 1024 + 512 * 1024, pfade: [], dryRun: false, fristTage: 14,
    gescheitert: [{ pfad: "/p/.claude/night-run-2026-09-01.log", grund: "EACCES" }] };

  spracheFestlegen("de");
  assert.deepEqual(aufraeumZeilen(ergebnis), [
    "Protokollfrist 14 Tage: 3 Protokoll(e) geloescht, 5.5 MB frei geworden",
    "WARNUNG: Protokoll nicht geloescht: /p/.claude/night-run-2026-09-01.log — EACCES. Der Lauf geht weiter.",
  ]);
  assert.deepEqual(aufraeumZeilen({ ...ergebnis, dryRun: true, gescheitert: [] }),
    ["Protokollfrist 14 Tage: wuerde 3 Protokoll(e) loeschen, 5.5 MB (DRY-RUN)"]);

  spracheFestlegen("en");
  assert.deepEqual(aufraeumZeilen(ergebnis), [
    "Log retention 14 days: 3 log(s) deleted, 5.5 MB freed",
    "WARNING: log not deleted: /p/.claude/night-run-2026-09-01.log — EACCES. The run continues.",
  ]);
  assert.deepEqual(aufraeumZeilen({ ...ergebnis, dryRun: true, gescheitert: [] }),
    ["Log retention 14 days: would delete 3 log(s), 5.5 MB (DRY-RUN)"]);
});
