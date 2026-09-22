// Die Einheiten je Arbeitspaket im Ergebnisstand und die Startmeldung (Issue #488/#743).
//
// Zweite von drei Dateien zum Ergebnisstand (Issue #836): Je Arbeitspaket eine Einheit —
// beim Ziehen mit unbekanntem Ausgang, nach der Runde ergaenzt um Ausgang, Dauer,
// Commit, End-Status, Pruefstand und Session-Kennzahlen. Dazu die Meldung, die schon vor
// dem ersten Arbeitspaket hinausgeht. Anlage und harte Stopps liegen in
// `night-ergebnisstand.test.mjs`, die Kennzahlen einer Kette in
// `night-ergebnisstand-kette.test.mjs`, die gemeinsamen Hilfen in
// `helpers/ergebnisstand-fixture.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

import {
  NUR_POSIX, NIGHT, run, setupProjekt, setupProjektMitMeldeCapture, meldungen, readyIssue,
  stand, einheit, textprotokollDa,
  NACH_IN_REVIEW, ARBEIT_UND_COMMIT, SUMMARY_GRUEN, SUMMARY_LEER, RESULT_AUSGEBEN,
} from "./helpers/ergebnisstand-fixture.mjs";

// --- Die Einheiten je Arbeitspaket (Issue #488) ---

test("[night-4] ein erfolgreiches Paket steht mit Ausgang, Dauer, Commit, Pruefstand und Kennzahlen im Stand", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-erfolg-");
  try {
    const id = readyIssue(dir, "Erfolgreiches Paket");
    const fake = [RESULT_AUSGEBEN, SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "erfolg");
    assert.equal(e.titel, "Erfolgreiches Paket", "die Einheit nennt den Titel des Pakets");
    assert.equal(typeof e.dauerMs, "number", `dauerMs muss eine Zahl sein, ist ${JSON.stringify(e.dauerMs)}`);
    assert.ok(typeof e.commit === "string" && e.commit.length > 0, "der Commit-Hash fehlt");
    assert.equal(e.endStatus, "in_review", "der End-Status kommt vom Board");
    assert.equal(e.pruefung.zustand, "geprueft");
    // Ohne diesen Fall saehe ein vergessener leseKennzahlen-Aufruf aus wie ein korrekter.
    assert.equal(e.kennzahlen.kostenUsd, 2.4124460000000005, "die Kosten stammen aus der result-Zeile");
    assert.equal(e.kennzahlen.zuege, 37);
    assert.equal(stand(dir).abschluss, "regulaer", "ein sauber beendeter Lauf traegt regulaer");
    // Die Schleife bricht danach zwar ebenso am leeren Ready (kein weiteres
    // Paket steht mehr an), aber mit einem Arbeitspaket im Lauf traegt der Kopf keinen
    // Grund — sonst saehe ein Lauf mit Arbeit aus wie einer ohne.
    assert.ok(!("noWorkReason" in stand(dir)), "ein Lauf mit Arbeitspaket darf keinen noWorkReason tragen");
    assert.ok(textprotokollDa(dir), "das Textprotokoll liegt weiterhin daneben");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-4] die Einheit traegt stufe und stufeVerwendet hinter den drei Modellfeldern", NUR_POSIX, () => {
  // Issue #711: Zwei Felder kommen hinzu, die bestehenden behalten Namen und Reihenfolge —
  // sie sind der Vertrag mit den Auswertungen.
  const dir = setupProjekt("night-stand-stufe-", {
    modelle: ["claude-opus-5", "claude-sonnet-5"],
    stufen: { schwer: { modell: "claude-sonnet-5" } },
  });
  try {
    const id = readyIssue(dir, "Leichtes Paket", "Aufgabenstufe: leicht\n\n");
    const fake = [SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--model", "claude-opus-5"],
      { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const e = einheit(dir, id);
    assert.equal(e.stufe, "leicht", "die Stufe des Pakets fehlt");
    assert.equal(e.stufeVerwendet, "schwer", "die Stufe, die das Modell gestellt hat, fehlt");
    assert.equal(e.modell, "claude-sonnet-5");
    assert.equal(e.modellHerkunft, "stufe");
    assert.ok(e.modellGrund && e.modellGrund.length > 0, "der Grund des Ausweichens fehlt");
    assert.deepEqual(
      Object.keys(e).slice(0, 7),
      ["id", "titel", "modell", "modellHerkunft", "modellGrund", "stufe", "stufeVerwendet"],
      `die Feldreihenfolge der Einheit hat sich verschoben: ${Object.keys(e).join(", ")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-4] ohne Stufe stehen beide Felder als null in der Einheit", NUR_POSIX, () => {
  // Ein fehlendes Feld liesse offen, ob niemand gemessen hat oder ob die Frage sich nicht
  // stellte — dieselbe Begruendung wie bei den drei Modellfeldern.
  const dir = setupProjekt("night-stand-ohne-stufe-");
  try {
    const id = readyIssue(dir, "Paket ohne Stufe");
    const fake = [SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const e = einheit(dir, id);
    assert.equal(e.stufe, null);
    assert.equal(e.stufeVerwendet, null);
    assert.ok("stufe" in e && "stufeVerwendet" in e, "die Felder fehlen ganz, statt null zu tragen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ohne result-Zeile bleiben die Kennzahlen null", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-ohnekennzahlen-");
  try {
    const id = readyIssue(dir, "Session ohne result-Ereignis");
    const fake = [SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(einheit(dir, id).kennzahlen, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Der Kernfall des Pakets: Ein Erfolg deckt den Pruefstand nicht zu. Bewusst zwei
// GRUENE Ausgaenge — ein Paar aus gruen und rot bewiese nichts, weil ein roter
// Nachweis seit Issue #471 ohnehin als Fehlschlag endet und die Ausgaenge sich
// schon dadurch unterschieden.
test("zwei erfolgreiche Pakete mit verschiedenem Pruefstand: gleicher Ausgang, verschiedener Zustand", NUR_POSIX, () => {
  const laeufe = [
    { praefix: "night-stand-kern-gruen-", summary: SUMMARY_GRUEN, zustand: "geprueft" },
    { praefix: "night-stand-kern-leer-", summary: SUMMARY_LEER, zustand: "leeresPaket" },
  ];
  const beobachtet = [];
  for (const lauf of laeufe) {
    const dir = setupProjekt(lauf.praefix);
    try {
      const id = readyIssue(dir, "Paket");
      const fake = [lauf.summary, ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
      const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
      assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
      const e = einheit(dir, id);
      beobachtet.push({ ausgang: e.ausgang, zustand: e.pruefung.zustand });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  assert.equal(beobachtet[0].ausgang, "erfolg");
  assert.equal(beobachtet[1].ausgang, beobachtet[0].ausgang, "beide Pakete sind ein Erfolg");
  assert.equal(beobachtet[0].zustand, "geprueft");
  assert.equal(beobachtet[1].zustand, "leeresPaket");
  assert.notEqual(beobachtet[1].zustand, beobachtet[0].zustand, "der Pruefstand unterscheidet sie");
});

test("ein zurueckgestelltes Paket erscheint als eigene Einheit mit Grund, nicht nur als Zaehler", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-gate-");
  try {
    const id = readyIssue(dir, "[Idee] Roher Einfall");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "zurueckgestellt");
    assert.match(e.grund, /Idee/, `der Grund nennt das Gate nicht: ${e.grund}`);
    assert.equal(stand(dir).abschluss, "regulaer");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Die Startmeldung vor dem ersten Arbeitspaket (Issue #743) ---

test("[night-43] der Lauf meldet sich sofort mit leerer Paketliste und ohne Abschluss, bevor ein Arbeitspaket gezogen wird", NUR_POSIX, () => {
  const dir = setupProjektMitMeldeCapture("night-stand-start-melden-");
  const captureFile = join(dir, "..", "night43-capture-melden.jsonl");
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: "true", NIGHT_MELDEN_ERZWINGEN: "1", NIGHT43_CAPTURE: captureFile });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const gemeldet = meldungen(captureFile);
    // Ohne die Aenderung aus Issue #743 meldet ein Lauf ohne Arbeitspaket nur einmal —
    // am regulaeren Ende (laufAbschliessen). Zwei Meldungen beweisen die neue Startmeldung.
    assert.equal(gemeldet.length, 2, `zwei Meldungen erwartet (Start und Ende), gefunden: ${gemeldet.length}`);

    assert.deepEqual(gemeldet[0].items, [], "die Startmeldung traegt keine Arbeitspakete");
    assert.equal(gemeldet[0].complete, false, "die Startmeldung gilt nicht als abgeschlossen");

    assert.equal(gemeldet[1].complete, true, "die Endmeldung eines regulaeren Laufs ist abgeschlossen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(captureFile, { force: true });
  }
});

test("[night-43] im Dry-Run bleibt die Startmeldung aus", NUR_POSIX, () => {
  const dir = setupProjektMitMeldeCapture("night-stand-start-dry-");
  const captureFile = join(dir, "..", "night43-capture-dry.jsonl");
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--dry-run"],
      { NIGHT_CLAUDE_CMD: "true", NIGHT_MELDEN_ERZWINGEN: "1", NIGHT43_CAPTURE: captureFile });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.deepEqual(meldungen(captureFile), [], "der Dry-Run legt keinen Ergebnisstand an, also gibt es nichts zu melden");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(captureFile, { force: true });
  }
});
