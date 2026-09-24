// E2E fuer den maschinenlesbaren Ergebnisstand des Nacht-Runners (Issue #486).
//
// Der Runner gibt sein Ergebnis bisher nur als Fliesstext aus; jede Umformulierung
// bricht eine Auswertung still. Dieses Paket legt Schema, Pfad und Schreiber an:
// Ohne --dry-run entsteht nach den Vorflug-Pruefungen eine Datei
// .claude/night-run-<YYYY-MM-DD>-<HHMMSS>.json, deren erstes Feld die Schemafassung
// traegt. Ein Schreibfehler geht ins Textprotokoll und bricht den Lauf nie ab.
//
// Issue #557 loest die Entstehung vom Flag: Ohne --verbose entsteht der Stand ebenfalls,
// nur ohne Session-Kennzahlen — der Lauf-Kopf traegt dann `kennzahlenHinweis` mit dem
// Grund. Der Grund eines Abbruchs wiegt mehr als die Kennzahlen eines glatten Laufs.
//
// Zweiter Teil und Voraussetzung: gitClean() nimmt .claude/night-run-* aus, sonst
// stoppte der Rest-Guard (#152) nach jeder erfolgreichen Runde hart.
//
// Erste von drei Dateien zum Ergebnisstand (Issue #836): Hier stehen die Anlage der
// Datei und der abgeschlossene harte Stopp. Die Einheiten je Arbeitspaket liegen in
// `night-ergebnisstand-einheiten.test.mjs`, die Kennzahlen einer Kette in
// `night-ergebnisstand-kette.test.mjs`, die gemeinsamen Hilfen in
// `helpers/ergebnisstand-fixture.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  NUR_POSIX, NIGHT, run, board, setupProjekt, readyIssue, staende, stand, einheit, textprotokollDa,
  NACH_IN_REVIEW, ARBEIT_UND_COMMIT, SUMMARY_GRUEN,
} from "./helpers/ergebnisstand-fixture.mjs";
import { nachtlaufMeldung } from "../kit/board.mjs";


test("[night-2] --verbose legt den Ergebnisstand an: schemaFassung 1 als erstes Feld, dazu erzeugtVon", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-neu-");
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const dateien = staende(dir);
    assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);

    const stand = JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
    assert.equal(Object.keys(stand)[0], "schemaFassung", "schemaFassung muss das erste Feld sein");
    assert.equal(stand.schemaFassung, 1, "schemaFassung traegt die Zahl 1");
    assert.ok(typeof stand.erzeugtVon === "string" && stand.erzeugtVon.length > 0, "erzeugtVon nennt den Kit-Stand");
    // Ein bedingungslos gesetzter Hinweis zerstoerte die Unterscheidung, die er tragen
    // soll: Mit --verbose sind die Kennzahlen erreichbar, es fehlt nichts zu erklaeren.
    assert.ok(!("kennzahlenHinweis" in stand), "mit --verbose fehlt das Feld ganz, es ist nicht null");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Bis Issue #668 stand hier das Gegenteil: Ohne --verbose forderte der Runner den Strom
// nicht an, die Kennzahlen fehlten, und kennzahlenHinweis sagte das am Lauf-Kopf. Seit
// #668 fordert der Implementierungslauf den Strom immer an — der Hinweis hat damit
// keinen Gegenstand mehr und entfaellt in JEDEM Lauf. Das Feld bedingt stehenzulassen
// waere schlimmer als es zu streichen: Es behauptete fehlende Kennzahlen, die es gibt.
test("[night-2] ohne --verbose entsteht der Ergebnisstand ohne kennzahlenHinweis — der Strom wird immer angefordert", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-still-");
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const dateien = staende(dir);
    assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);

    const stand = JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
    assert.equal(stand.schemaFassung, 1, "die Schemafassung bleibt dieselbe");
    assert.ok(
      !("kennzahlenHinweis" in stand),
      `ohne --verbose darf kein kennzahlenHinweis mehr entstehen, gefunden: ${JSON.stringify(stand.kennzahlenHinweis)}`,
    );
    // Die Feldreihenfolge ist der Vertrag mit den Auswertungen: Faellt das bedingte Feld
    // weg, folgt einheiten unmittelbar auf stufe — und zwar in beiden Betriebsarten.
    const schluessel = Object.keys(stand);
    assert.equal(
      schluessel[schluessel.indexOf("stufe") + 1],
      "einheiten",
      `nach stufe folgt einheiten, gefunden: ${schluessel.join(", ")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Der Lauf-Kopf vermerkt den Grund, statt ihn nur zu protokollieren (Issue #744): Bricht
// der Implementierungslauf schon in der ersten Runde am leeren Ready ab, steht "Ready
// ist leer" wortgleich am Lauf-Kopf, hinter den Feldern der Schemafassung 1.
test("ein Implementierungslauf ohne Ready-Issues vermerkt 'Ready ist leer' als noWorkReason am Lauf-Kopf", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-ohnearbeit-");
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const dateien = staende(dir);
    assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
    const stand = JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
    assert.equal(stand.noWorkReason, "Ready ist leer — nichts zu tun.");
    // Ans Ende des Lauf-Kopfes: hinter alle Felder, die beim Start entstehen. Seit
    // Issue #752 folgt `aufwand` noch darauf, seit Issue #790 `wirksamkeit` und seit
    // Issue #806 `befunde` — alle drei entstehen erst beim Abschluss, und die Reihenfolge
    // der Schemafassung 1 haengt neue Felder hinten an.
    const AUSWERTUNGEN = ["aufwand", "wirksamkeit", "befunde"];
    const schluessel = Object.keys(stand).filter((k) => !AUSWERTUNGEN.includes(k));
    assert.equal(schluessel.at(-1), "noWorkReason", "das Feld gehoert ans Ende des Lauf-Kopfes");
    for (const feld of AUSWERTUNGEN) {
      assert.ok(Object.keys(stand).indexOf(feld) > Object.keys(stand).indexOf("noWorkReason"),
        `die Auswertung '${feld}' gehoert hinter die Felder des Lauf-Kopfes`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Der Beweis, dass der Strom wirklich angefordert wird, und nicht nur der Hinweis
// verschwunden ist: Der Session-Fake schreibt seine Argumente mit. Ohne diesen Test
// bestuende das Streichen des Feldes fuer sich — und die Kennzahlen fehlten weiter.
test("[night-2] der Implementierungslauf ruft die CLI mit --output-format stream-json, auch ohne --verbose", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-strom-");
  let binDir = null;
  try {
    readyIssue(dir, "Belegt die Stream-Anforderung");
    // NIGHT_CLAUDE_CMD ist der Test-Hook-Zweig und baut die Argumente NICHT — deshalb
    // faehrt dieser Test den Produktivzweig ueber eine Fake-CLI im PATH.
    //
    // Fake und Mitschrift liegen AUSSERHALB des Fixture-Repos: Im Repo machten sie den
    // Working Tree dirty, und der Vorflug beendete den Lauf, bevor eine Session startet.
    binDir = mkdtempSync(join(tmpdir(), "night-stand-fakebin-"));
    const argLog = join(binDir, "cli-args.txt");
    writeFileSync(join(binDir, "claude"), `#!/bin/sh\nprintf '%s\\n' "$@" >> ${JSON.stringify(argLog)}\nexit 0\n`);
    chmodSync(join(binDir, "claude"), 0o755);

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], {
      PATH: `${binDir}:${process.env.PATH}`,
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const args = readFileSync(argLog, "utf-8").split("\n");
    assert.ok(args.includes("--output-format"), `--output-format fehlt: ${args.join(" ")}`);
    assert.ok(args.includes("stream-json"), `stream-json fehlt: ${args.join(" ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (binDir) rmSync(binDir, { recursive: true, force: true });
  }
});

// Eine erreichte Grenze ist kein Abbruch (Issue #881): Ein Lauf, der nach --max Paketen
// planmaessig endet, schliesst regulaer ab und meldet ans Board keinen abortReason. Der
// Grund gehoert allein dem harten Stopp — stuende er auch hier, saehe jede volle Nacht
// wie eine Stoerung aus.
test("[night-2] ein am --max beendeter Lauf schliesst regulaer ab und meldet keinen abortReason", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-max-");
  try {
    readyIssue(dir, "Einziges Paket der Nacht");
    const fake = [SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.abschluss, "regulaer");
    assert.equal(s.einheiten.length, 1, "ein leerer Lauf belegte die Aussage nicht");
    const m = nachtlaufMeldung(s);
    assert.equal(m.complete, true);
    assert.ok(!("abortReason" in m), "eine erreichte Grenze ist kein Abbruchgrund");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mit --dry-run --verbose entsteht keine Ergebnisstand-Datei", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-dry-");
  try {
    readyIssue(dir, "Wird nur angezeigt");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--dry-run", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.deepEqual(staende(dir), [], "ein Dry-Run schreibt nichts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("zwei Laeufe am selben Tag hinterlassen zwei Ergebnisstand-Dateien", NUR_POSIX, async () => {
  const dir = setupProjekt("night-stand-zwei-");
  try {
    const erst = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(erst.status, 0, `${erst.stderr}\n${erst.stdout}`);
    // Die Uhrzeit im Namen loest auf Sekunden auf — ohne Wartezeit koennten beide
    // Laeufe denselben Namen treffen.
    await new Promise((fertig) => setTimeout(fertig, 1100));
    const zweit = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(zweit.status, 0, `${zweit.stderr}\n${zweit.stdout}`);

    const dateien = staende(dir);
    assert.equal(dateien.length, 2, `zwei Dateien erwartet, gefunden: ${dateien.join(", ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ein Schreibfehler des Ergebnisstands bricht den Lauf nicht ab, das Textprotokoll nennt ihn", NUR_POSIX, () => {
  // root ignoriert Verzeichnisrechte — der Schreibfehler waere nicht herstellbar.
  if (process.getuid?.() === 0) return;
  const dir = setupProjekt("night-stand-eacces-");
  const claudeDir = join(dir, ".claude");
  try {
    const id = readyIssue(dir, "Laeuft trotz Schreibfehler");
    // Die Tagesdatei des Textprotokolls vorab anlegen: Ihr Name ist vorhersagbar,
    // und POSIX erlaubt das Anhaengen an eine bestehende Datei auch in einem nicht
    // beschreibbaren Verzeichnis. Nur das Anlegen der JSON-Datei scheitert (EACCES).
    const logPfad = join(claudeDir, `night-run-${new Date().toISOString().slice(0, 10)}.log`);
    writeFileSync(logPfad, "", "utf-8");
    // Der Umsetzungs-Lock (Issue #696) aus demselben Grund vorab: Er liegt ebenfalls unter
    // `.claude/`, und ein nicht schreibbarer Lock laesst die Umsetzung aus — dann liefe die
    // Runde gar nicht erst, und dieser Test prueefte nicht mehr, was er prueft. Leer heisst
    // verwaist, der Lauf nimmt ihn also selbst.
    writeFileSync(join(claudeDir, "night-umsetzung.lock"), "", "utf-8");
    chmodSync(claudeDir, 0o555);

    const fake = `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `der Schreibfehler darf den Lauf nicht abbrechen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /Ergebnisstand konnte nicht geschrieben werden:/, "die Fehlerzeile fehlt auf der Konsole");
    assert.match(readFileSync(logPfad, "utf-8"), /Ergebnisstand konnte nicht geschrieben werden:/,
      "die Fehlerzeile fehlt im Textprotokoll");
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(id), "die Runde haette trotzdem durchlaufen muessen");
  } finally {
    chmodSync(claudeDir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-3] eine erfolgreiche Runde endet trotz untracked Ergebnisstand mit Exit 0", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-clean-");
  try {
    const id = readyIssue(dir, "Erfolgreiche Runde");
    const fake = `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `der untracked Ergebnisstand darf keinen harten Stopp ausloesen: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /HARTER STOPP/, "der Rest-Guard haette nicht anschlagen duerfen");
    assert.match(res.stdout, new RegExp(`Erfolg[\\s\\S]*Issue #${id} in In review`), "die Runde haette als Erfolg gemeldet werden muessen");

    // Die Datei liegt wirklich untracked im Arbeitsbaum — sonst bewiese der Test nichts.
    const dateien = staende(dir);
    assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
    const status = run(dir, "git", ["status", "--porcelain"]);
    assert.match(status.stdout, new RegExp(`\\?\\? \\.claude/${dateien[0]}`), "die Datei muesste untracked sichtbar sein");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Der abgeschlossene harte Stopp (Issue #488) ---

test("ein Abbruch waehrend der Runde hinterlaesst harterStopp, Fehlerklasse tracker und das gezogene Paket unbekannt", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-tracker-");
  try {
    const id = readyIssue(dir, "Abbruch mitten in der Runde");
    // Board bewegen, dann den Tracker unter dem Runner wegziehen: Der erste
    // board()-Aufruf in werteRunde scheitert, fail() greift.
    const fake = [NACH_IN_REVIEW, "rm .claude/kit/board.mjs"].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.notEqual(res.status, 0, `der Lauf haette abbrechen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.abschluss, "harterStopp", "ein erkannter Stopp darf nicht wie ein Absturz aussehen");
    assert.equal(s.complete, false, "[night-31] ein harter Stopp laesst complete auf false");
    assert.equal(s.fehlerklasse, "tracker");
    assert.ok(typeof s.fehlerText === "string" && s.fehlerText.length > 0, "der Fehlertext fehlt");
    const e = einheit(dir, id);
    assert.equal(e.ausgang, "unbekannt", "die Runde wurde nie bewertet");
    assert.equal(e.commit ?? null, null, "ohne Bewertung gibt es keinen Commit im Stand");
    assert.ok(textprotokollDa(dir), "das Textprotokoll liegt weiterhin daneben");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("der Rest-Guard hinterlaesst harterStopp und das Paket mit Ausgang harterStopp, Commit und Pruefstand", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-restguard-");
  try {
    const id = readyIssue(dir, "Runde mit Resten");
    // Erfolgreiche Runde, danach ein unkommittierter Rest: Der Rest-Guard (#152)
    // stoppt hart, obwohl die Runde selbst bewertet wurde.
    const fake = [SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW, "echo rest > rest.txt"].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.notEqual(res.status, 0, `der Rest-Guard haette anschlagen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.abschluss, "harterStopp");
    assert.equal(s.fehlerklasse, "harterStopp");
    const e = einheit(dir, id);
    assert.equal(e.ausgang, "harterStopp", "hier wurde die Runde bewertet — nicht unbekannt");
    assert.ok(typeof e.commit === "string" && e.commit.length > 0, "der Commit der Runde fehlt");
    assert.equal(e.pruefung.zustand, "geprueft", "der Pruefstand der Runde fehlt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ein Vorflug-Abbruch traegt die Fehlerklasse zustand", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-vorflug-");
  try {
    // Ein unsauberer Baum vor dem Lauf: vorbereiten() bricht ab, noch bevor eine
    // Session startet. Der Stand existiert trotzdem und benennt den Grund.
    writeFileSync(join(dir, "unsauber.txt"), "schon vorher da\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.notEqual(res.status, 0, `der Vorflug haette abbrechen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.abschluss, "harterStopp");
    assert.equal(s.fehlerklasse, "zustand");
    assert.deepEqual(s.einheiten, [], "vor der ersten Session gibt es keine Einheiten");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
