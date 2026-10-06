// Der Beobachter der Fortschrittszeilen am Session-Strom (Issue #975, Plan #974).
//
// Am Zeitlimit wird die Sitzung samt Prozessgruppe gekillt: Ein `result`-Ereignis kommt
// nie an, und der Schlusstext fehlt genau im Anlassfall. Was vom Stand uebrig bleibt, ist
// allein das, was die Sitzung unterwegs gesagt hat — darum wird es live mitgelesen.
//
// Geprueft wird der exportierte, reine Beobachter an aufgezeichneten Stromzeilen, dieselbe
// Linie wie `night-session-werkzeugzeit.test.mjs`. Die beiden Faelle, in denen `fortschritt` `null`
// ist, gehen ueber `runSession`: Sie entstehen nicht im Beobachter, sondern daran, ob er
// ueberhaupt angelegt wird.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fortschrittBeobachter, runSession } from "../kit/night/session.mjs";

/** Ein `assistant`-Ereignis mit einem Textblock. */
function text(inhalt) {
  return JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: inhalt }] } });
}

/** Fuettert den Beobachter mit Zeilen und liefert sein Ergebnis. */
function beobachte(zeilen) {
  const b = fortschrittBeobachter();
  for (const zeile of zeilen) b.zeile(zeile, 1000);
  return b.ergebnis();
}

const ARGS = { model: "fixture-modell", timeoutMin: 1, yolo: false, verbose: false };

test("[night-975-1] eine Zeile mit dem Anker wird gesammelt, alles andere nicht", () => {
  const erg = beobachte([
    text("Ich lese jetzt das Paket.\nFORTSCHRITT: AK1 — Testdatei liegt rot\nWeiter geht es."),
  ]);
  assert.deepEqual(erg.zeilen, ["FORTSCHRITT: AK1 — Testdatei liegt rot"]);
  assert.equal(erg.gesehen, 1);
});

test("[night-975-2] die Reihenfolge der Zeilen bleibt erhalten", () => {
  const erg = beobachte([
    text("FORTSCHRITT: AK1 — eins"),
    text("Zwischentext ohne Anker"),
    text("FORTSCHRITT: AK2 — zwei"),
    text("FORTSCHRITT: AK3 — drei"),
  ]);
  assert.deepEqual(erg.zeilen, [
    "FORTSCHRITT: AK1 — eins",
    "FORTSCHRITT: AK2 — zwei",
    "FORTSCHRITT: AK3 — drei",
  ]);
  assert.equal(erg.gesehen, 3);
});

test("[night-975-3] eine zu lange Zeile wird auf 200 Zeichen gekappt", () => {
  const lang = `FORTSCHRITT: AK1 — ${"x".repeat(400)}`;
  const erg = beobachte([text(lang)]);
  assert.equal(erg.zeilen.length, 1);
  assert.equal(erg.zeilen[0].length, 200, "die Kappung laeuft wie bei `flatten` auf genau 200 Zeichen");
  assert.ok(erg.zeilen[0].endsWith("…"), "eine gekappte Zeile weist ihre Kappung aus");
  assert.ok(erg.zeilen[0].startsWith("FORTSCHRITT: AK1 — x"));
});

test("[night-975-4] hoechstens zehn Zeilen, die Gesamtzahl bleibt sichtbar", () => {
  const erg = beobachte(Array.from({ length: 14 }, (_, i) => text(`FORTSCHRITT: AK${i + 1} — Punkt ${i + 1}`)));
  assert.equal(erg.zeilen.length, 10, "mehr als zehn Zeilen machen den Vermerk unlesbar");
  assert.equal(erg.gesehen, 14, "dass gekuerzt wurde, muss am Vermerk ablesbar bleiben");
  assert.equal(erg.zeilen.at(-1), "FORTSCHRITT: AK14 — Punkt 14", "der juengste Stand ist der gefragte");
  assert.equal(erg.zeilen[0], "FORTSCHRITT: AK5 — Punkt 5");
});

test("[night-975-5] eine unlesbare Zeile wird uebersprungen, statt den Lauf zu Fall zu bringen", () => {
  const erg = beobachte([
    "Fliesstext ohne Klammer",
    '{"type":"assistant","message":',
    text("FORTSCHRITT: AK1 — eins"),
    JSON.stringify({ type: "assistant", message: { content: "kein Array" } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "FORTSCHRITT: fremd" }] } }),
  ]);
  assert.deepEqual(erg.zeilen, ["FORTSCHRITT: AK1 — eins"], "nur assistant-Textbloecke zaehlen");
  assert.equal(erg.gesehen, 1);
});

/** Eine Kommandozeile, die genau eine Fortschritts-Stromzeile ausgibt. */
const STROM_FAKE = `printf '%s\\n' '${text("FORTSCHRITT: AK1 — eins")}'`;

test("[night-975-6] ein Lauf ohne angeforderten Strom traegt kein Ergebnis — nicht etwa eines mit Nullen", async () => {
  process.env.NIGHT_CLAUDE_CMD = STROM_FAKE;
  try {
    const res = await runSession("975", ARGS, {});
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.fortschritt, null, "nicht beobachtet ist nicht dasselbe wie nichts gemeldet");
  } finally {
    delete process.env.NIGHT_CLAUDE_CMD;
  }
});

test("[night-975-8] mit angefordertem Strom kommen die Zeilen der Sitzung an", async () => {
  process.env.NIGHT_CLAUDE_CMD = STROM_FAKE;
  try {
    const res = await runSession("975", ARGS, { stream: true });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.fortschritt, { zeilen: ["FORTSCHRITT: AK1 — eins"], gesehen: 1 });
  } finally {
    delete process.env.NIGHT_CLAUDE_CMD;
  }
});

test("[night-975-7] eine Kommando-Stufe traegt null und nicht ein leeres Ergebnis", async () => {
  // `laufeRunde` fordert den Strom immer an, aber die Kommando-Stufe startet ein fremdes
  // Programm ohne `--output-format stream-json`: Der Beobachter lieferte `{ zeilen: [],
  // gesehen: 0 }`, und am Vermerk stuende "keine Auskunft der Sitzung", obwohl gar nicht
  // beobachtet werden konnte.
  delete process.env.NIGHT_CLAUDE_CMD;
  const res = await runSession("975", ARGS, { stream: true, kommando: STROM_FAKE, stufenName: "fremd" });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.fortschritt, null, "ohne Strom-Format ist nichts beobachtet worden");
  assert.notDeepEqual(res.fortschritt, { zeilen: [], gesehen: 0 });
  assert.ok(res.werkzeugzeit, "die uebrigen Beobachter bleiben unberuehrt");
});
