// Logging, Abbruch und Ergebnisstand des Nacht-Runners im selben Prozess (Issue #486, #488,
// #558, #885, #1090, #1224).
//
// Bis Issue #1224 waren diese Wege nur ueber ganze Nachtlaeufe als Kindprozess zu sehen. Seit
// die Grundlagen ein eigener Teil sind, liegt ihr Laufzustand am Objekt `ZUSTAND`, und den
// Abbruch des Laufstands bindet der Test selbst an (`grundlagenAnbinden`): Er wirft, statt
// den Prozess zu beenden.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ZUSTAND, grundlagenAnbinden, log, fail, merkeHartenStopp, hefteStoppGrund, hefteStoppGrundAnLauf, resteText,
  vermerkeOhneArbeit, einheitAnlegen, einheitErgaenzen, laufMelden, schreibeErgebnisstand, ersteZeile,
  schrittBeginnen, schrittEnden, schrittZweiterVersuch, schrittProtokollPfad, LETZTES_PROTOKOLL,
  sicherheitsnetzGrund, ERSATZ_GRUND, ANKER_FEHLT, grundOhneArbeit,
} from "../kit/night/grundlagen.mjs";

class Abbruch extends Error {
  constructor(grund, optionen) {
    super(grund);
    this.optionen = optionen;
  }
}

const ANFANG = { ...ZUSTAND };
const ARBEITSVERZEICHNIS = process.cwd();
let ausgabe;
let fehler;
let schreibeAus;
let schreibeFehler;

beforeEach(() => {
  Object.assign(ZUSTAND, ANFANG);
  ausgabe = [];
  fehler = [];
  schreibeAus = process.stdout.write;
  schreibeFehler = process.stderr.write;
  process.stdout.write = (text) => { ausgabe.push(String(text)); return true; };
  process.stderr.write = (text) => { fehler.push(String(text)); return true; };
  grundlagenAnbinden({ laufAbbrechen: (grund, optionen) => { throw new Abbruch(grund, optionen); } });
});

afterEach(() => {
  process.stdout.write = schreibeAus;
  process.stderr.write = schreibeFehler;
  process.chdir(ARBEITSVERZEICHNIS);
});

function projekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-grundlagen-logging-"));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  return dir;
}

function laufMitDatei(dir, felder = {}) {
  ZUSTAND.ERGEBNIS_FILE = join(dir, ".claude", "night-run-test.json");
  ZUSTAND.LAUF = { art: "implementierung", einheiten: [], abschluss: null, ...felder };
  return ZUSTAND.ERGEBNIS_FILE;
}

const gelesen = (datei) => JSON.parse(readFileSync(datei, "utf-8"));

test("log schreibt Zeitstempel und Kennung nach stdout und ins Tagesprotokoll", () => {
  const dir = projekt();
  ZUSTAND.LOG_FILE = join(dir, "night.log");
  ZUSTAND.LAUF_STEMPEL = "2026-10-05-220000";
  log("eine Zeile");
  assert.match(ausgabe.join(""), /^\[\d{4}-\d\d-\d\dT[^ ]+ 2026-10-05-220000\] eine Zeile\n$/);
  assert.equal(readFileSync(ZUSTAND.LOG_FILE, "utf-8"), ausgabe.join(""));
});

test("die Kennung des Waechters geht vor dem Stempel, ohne beide steht die Prozess-Id (Issue #1090)", () => {
  ZUSTAND.LOG_KENNUNG = "fremd";
  ZUSTAND.LAUF_STEMPEL = "stempel";
  log("a");
  ZUSTAND.LOG_KENNUNG = null;
  ZUSTAND.LAUF_STEMPEL = null;
  log("b");
  assert.match(ausgabe[0], / fremd\] a\n$/);
  assert.match(ausgabe[1], new RegExp(` pid-${process.pid}\\] b\\n$`));
});

test("ein Schritt schreibt in sein eigenes Protokoll, der zweite Versuch in -v2 (Issue #1090, #1088)", () => {
  const dir = projekt();
  process.chdir(dir);
  ZUSTAND.LAUF_STEMPEL = "2026-10-05-220000";
  const vorher = schrittBeginnen(12, "umsetzung");
  log("im Schritt");
  schrittZweiterVersuch();
  log("im zweiten Versuch");
  schrittEnden(vorher);
  log("danach");
  const erste = join(dir, schrittProtokollPfad("2026-10-05-220000", 12, "umsetzung"));
  const zweite = join(dir, schrittProtokollPfad("2026-10-05-220000", 12, "umsetzung", 2));
  assert.match(readFileSync(erste, "utf-8"), /im Schritt\n$/);
  assert.match(readFileSync(zweite, "utf-8"), /im zweiten Versuch\n$/);
  assert.equal(LETZTES_PROTOKOLL.get("12"), ".claude/protokolle/2026-10-05-220000/12-umsetzung-v2.log");
  assert.doesNotMatch(readFileSync(zweite, "utf-8"), /danach/);
});

test("ohne Stempel beginnt kein Schrittprotokoll", () => {
  const dir = projekt();
  process.chdir(dir);
  schrittBeginnen(3, "plan");
  log("x");
  schrittEnden(null);
  assert.equal(existsSync(join(dir, ".claude", "protokolle")), false);
});

test("ein Schreibfehler am Schrittprotokoll haelt den Lauf nicht an", () => {
  const dir = projekt();
  process.chdir(dir);
  writeFileSync(join(dir, ".claude", "protokolle"), "eine Datei, kein Verzeichnis");
  ZUSTAND.LAUF_STEMPEL = "s";
  schrittBeginnen(4, "plan");
  log("x");
  schrittEnden(null);
  assert.match(ausgabe.join(""), /Schrittprotokoll konnte nicht geschrieben werden: .* — die Zeilen stehen weiter im Tagesprotokoll\./);
  assert.equal(LETZTES_PROTOKOLL.has("4"), false);
});

test("fail schreibt die Fehlerzeile, haelt Klasse und Text am Lauf fest und bricht ueber den Laufstand ab (Issue #488)", () => {
  const dir = projekt();
  ZUSTAND.LOG_FILE = join(dir, "night.log");
  ZUSTAND.LAUF = { einheiten: [] };
  assert.throws(() => fail("git status schlug fehl", "umgebung"), (err) => {
    assert.ok(err instanceof Abbruch);
    assert.deepEqual(err.optionen, { abschluss: "harterStopp", exitCode: 1 });
    return err.message === "git status schlug fehl";
  });
  assert.deepEqual(fehler, ["Fehler: git status schlug fehl\n"]);
  assert.equal(readFileSync(ZUSTAND.LOG_FILE, "utf-8"), "Fehler: git status schlug fehl\n");
  assert.equal(ZUSTAND.LAUF.fehlerklasse, "umgebung");
  assert.equal(ZUSTAND.LAUF.fehlerText, "git status schlug fehl");
});

test("merkeHartenStopp und hefteStoppGrund bringen den Grund an die Einheit und schreiben (Issue #558)", () => {
  const datei = laufMitDatei(projekt());
  const einheit = einheitAnlegen("7", "Karte");
  merkeHartenStopp("harterStopp", "HARTER STOPP: Reste");
  hefteStoppGrund(einheit);
  assert.equal(ZUSTAND.STOPP_GRUND, "HARTER STOPP: Reste");
  const stand = gelesen(datei);
  assert.equal(stand.fehlerklasse, "harterStopp");
  assert.equal(stand.fehlerEinheit, "7");
  assert.equal(stand.einheiten[0].grund, "HARTER STOPP: Reste");
});

test("hefteStoppGrundAnLauf legt den Grund am Lauf ab, ohne Lauf geschieht nichts", () => {
  hefteStoppGrundAnLauf();
  const datei = laufMitDatei(projekt());
  ZUSTAND.STOPP_GRUND = "Vorflug gestoppt";
  hefteStoppGrundAnLauf();
  assert.equal(gelesen(datei).fehlerText, "Vorflug gestoppt");
});

test("einheitAnlegen legt die Felder in der vertraglichen Reihenfolge an (Issue #665, #1026)", () => {
  const datei = laufMitDatei(projekt(), { art: "kette" });
  const einheit = einheitAnlegen(5, "Titel", { modell: "m", herkunft: "h", grund: "g", stufe: "leicht", stufeVerwendet: "mittel", effort: "low" });
  assert.deepEqual(Object.keys(einheit), ["id", "titel", "modell", "modellHerkunft", "modellGrund", "stufe", "stufeVerwendet", "effort", "art", "ausgang", "umsetzung", "auskunft"]);
  assert.equal(einheit.art, "kette");
  assert.equal(gelesen(datei).einheiten.length, 1);
});

test("ohne Lauf haengt die Einheit an nichts", () => {
  const einheit = einheitAnlegen("1", "t");
  assert.equal(einheit.modell, null);
  assert.equal(einheit.art, null);
});

test("einheitErgaenzen schreibt und meldet ausserhalb von toolbox genau einmal, dass die Einlieferung entfaellt", () => {
  const datei = laufMitDatei(projekt());
  ZUSTAND.config = { issueTracker: "local" };
  const einheit = einheitAnlegen("1", "t");
  einheitErgaenzen(einheit, { ausgang: "erfolg" });
  einheitErgaenzen(einheit, { ausgang: "erfolg" });
  assert.equal(gelesen(datei).einheiten[0].ausgang, "erfolg");
  const zeilen = ausgabe.filter((z) => z.includes("Einlieferung entfaellt: issueTracker 'local'"));
  assert.equal(zeilen.length, 1, "dieselbe Meldezeile steht nur einmal im Protokoll");
});

test("laufMelden liefert bei toolbox ueber board.mjs nightrun melden ein (Issue #669)", () => {
  const datei = laufMitDatei(projekt(), { abschluss: "regulaer" });
  ZUSTAND.config = { issueTracker: "toolbox" };
  const aufrufe = [];
  const spawn = (_befehl, args) => {
    aufrufe.push(args.slice(1));
    return { status: 0, stdout: JSON.stringify({ outcome: "created" }), stderr: "" };
  };
  laufMelden({ spawn, budgetMs: 1000 });
  assert.deepEqual(aufrufe, [["nightrun", "melden", "--datei", datei]]);
  assert.match(ausgabe.join(""), /Nachtlauf eingeliefert \(created\)\./);
});

test("laufMelden: ein Fehlschlag ist eine Zeile, die Art pruefung meldet nicht", () => {
  laufMitDatei(projekt());
  ZUSTAND.config = { issueTracker: "toolbox" };
  laufMelden({ spawn: () => ({ status: 1, stdout: "", stderr: "Board weg" }) });
  assert.match(ausgabe.join(""), /Einlieferung fehlgeschlagen: Board weg — der Ergebnisstand bleibt als Datei\./);
  laufMitDatei(projekt(), { art: "pruefung" });
  laufMelden({ spawn: () => assert.fail("die Art pruefung wird nicht eingeliefert") });
  assert.match(ausgabe.join(""), /die Lauf-Art 'pruefung' hat keine Nachtlauf-Schnittstelle/);
});

test("ein Schreibfehler am Ergebnisstand ist eine Zeile und kein Abbruch (Issue #486)", () => {
  const dir = projekt();
  ZUSTAND.ERGEBNIS_FILE = join(dir, "fehlt", "night-run.json");
  ZUSTAND.LAUF = { einheiten: [] };
  schreibeErgebnisstand();
  assert.match(ausgabe.join(""), /Ergebnisstand konnte nicht geschrieben werden: /);
});

test("vermerkeOhneArbeit schreibt denselben Satz ins Protokoll und an den Lauf-Kopf (Issue #887)", () => {
  laufMitDatei(projekt());
  vermerkeOhneArbeit("readyLeer");
  assert.equal(ZUSTAND.LAUF.noWorkReason, grundOhneArbeit("readyLeer"));
  assert.match(ausgabe.join(""), /Ready ist leer — nichts zu tun\./);
});

test("resteText nennt bis zehn Reste vollstaendig und kuerzt darueber (Issue #558)", () => {
  assert.equal(resteText([]), "keine unkommittierten Reste");
  assert.equal(resteText(["?? a", " M b"]), "unkommittierte Reste: ?? a |  M b");
  const elf = Array.from({ length: 11 }, (_, i) => `?? d${i}`);
  assert.match(resteText(elf), /^11 unkommittierte Reste, die ersten zehn: \?\? d0 \| .* \| \?\? d9$/);
});

test("ersteZeile nimmt die erste nicht leere Zeile eines Fremdtextes", () => {
  assert.equal(ersteZeile("\n\n  zweite Zeile  \ndritte"), "zweite Zeile");
  assert.equal(ersteZeile(undefined), "");
});

test("grundlagenAnbinden weist einen unbekannten Haken ab", () => {
  assert.throws(() => grundlagenAnbinden({ gibtsNicht: () => {} }), /kennt keinen Haken 'gibtsNicht'/);
});

// --- Das Sicherheitsnetz in seinen drei Lagen ---
//
// Reine Funktion mit explizitem Laufzustand: `laufAbschliessen` ist nicht exportiert,
// und ein kompletter Lauf je Lage waere drei Nachtlaeufe fuer eine Fallunterscheidung.

test("[night-11] Sicherheitsnetz (a): ohne Grund und ohne gemerkten Stoppgrund entsteht der Ersatztext", () => {
  const lauf = { einheiten: [{ id: "1", ausgang: "harterStopp" }] };
  assert.equal(sicherheitsnetzGrund(lauf, ""), ERSATZ_GRUND);
  assert.equal(sicherheitsnetzGrund(lauf, null), ERSATZ_GRUND);
});

test("[night-11] Sicherheitsnetz (b): ohne Grund, aber mit gemerktem Stoppgrund kommt dessen Text plus der Ankervermerk", () => {
  const lauf = { einheiten: [{ id: "1", ausgang: "harterStopp" }] };
  const netz = sicherheitsnetzGrund(lauf, "HARTER STOPP: irgendetwas ist passiert.");
  assert.match(netz, /HARTER STOPP: irgendetwas ist passiert\./, "der gemerkte Text fehlt");
  assert.ok(netz.includes(ANKER_FEHLT), `der Vermerk zum fehlenden Uebergabe-Anker fehlt: ${netz}`);
  assert.notEqual(netz, ERSATZ_GRUND, "mit gemerktem Grund darf der reine Ersatztext nicht entstehen");
});

test("[night-11] Sicherheitsnetz (c): der Grund einer FREMDEN Einheit unterdrueckt das Netz nicht", () => {
  // Eine begruendet uebersprungene Einheit hat mit dem spaeteren Stopp nichts zu tun.
  // Zaehlte ihr Grund, bliebe der eigentliche Stopp fuer immer unbegruendet — und die
  // Datei saehe vollstaendig aus.
  const lauf = {
    einheiten: [
      { id: "1", ausgang: "uebersprungen", grund: "traegt bereits einen Issue-Review-Marker" },
      { id: "2", ausgang: "harterStopp" },
    ],
  };
  assert.equal(sicherheitsnetzGrund(lauf, ""), ERSATZ_GRUND);
  // Auch der Verweis auf eine Einheit OHNE Grund rettet nicht.
  assert.equal(sicherheitsnetzGrund({ ...lauf, fehlerEinheit: "2" }, ""), ERSATZ_GRUND);
});

test("[night-11] das Sicherheitsnetz schweigt, wo ein Grund vorliegt", () => {
  const amLauf = { einheiten: [], fehlerText: "git status schlug fehl" };
  assert.equal(sicherheitsnetzGrund(amLauf, "etwas anderes"), null, "ein Lauf-Fehlertext genuegt");

  const anDerEinheit = { einheiten: [{ id: "7", grund: "der echte Grund" }], fehlerEinheit: "7" };
  assert.equal(sicherheitsnetzGrund(anDerEinheit, "etwas anderes"), null, "die referenzierte Einheit genuegt");
});
