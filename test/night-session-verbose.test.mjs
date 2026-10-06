// Die Ereigniszeilen des Verlaufsprotokolls (Issue #154, Vorbelegung seit #867).
// Der Runner liest den stream-json-Output der Session live und schreibt kompakte
// Ereigniszeilen (Tool-Aufrufe, Text-Snippets) mit in Log und Konsole — das ist
// seit Issue #867 der Normalfall. Ohne `verbose` bleibt es beim alten Format: nur der
// finale Session-Output-Block.
//
// Im selben Prozess (Issue #1229, Plan #1199, E6): Die Session ist eine Attrappe, die ihren
// Strom abspielt, und `runSession` bekommt sie als `spawn` eingesetzt. Wie die
// Kommandozeile `--verbose` liest und wie eine Runde nach dem Zeitlimit endet, pruefen die
// Ablauf-Pruefungen in test/ablauf-night-session-verbose.test.mjs am echten Runner.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runSession } from "../kit/night/session.mjs";
import { sessionAbh, mitLauf, stdoutFangen, ARGS } from "./helpers/session-attrappe.mjs";

const LAUT = { ...ARGS, verbose: true };

/** Faehrt die Session zu Karte 7 mit dem Drehbuch; liefert Konsole und Tagesprotokoll. */
async function verlauf(drehbuch, args = LAUT) {
  return mitLauf(["7"], async ({ protokoll }) => {
    const { abh } = sessionAbh(drehbuch);
    const { ergebnis, text } = await stdoutFangen(() => runSession("7", args, { stream: true }, abh));
    return { res: ergebnis, konsole: text, protokoll: protokoll() };
  });
}

const STROM = [
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"mvn -q verify"}}]}}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"Tests gruen, ich committe jetzt."}]}}',
];

test("mit verbose zeigt die Session kompakte Ereigniszeilen in Konsole und Tagesprotokoll", async () => {
  const { res, konsole, protokoll } = await verlauf(STROM);
  assert.equal(res.status, 0);
  for (const ausgabe of [konsole, protokoll]) {
    assert.match(ausgabe, /#7 > Bash: mvn -q verify/, "Tool-Aufruf-Zeile fehlt");
    assert.match(ausgabe, /#7 > Claude: Tests gruen/, "Text-Snippet-Zeile fehlt");
  }
});

test("ohne verbose bleibt es beim alten Format (keine Ereigniszeilen)", async () => {
  const { konsole, protokoll } = await verlauf(STROM, ARGS);
  assert.doesNotMatch(konsole, /> Bash:/, "ohne verbose duerften keine Ereigniszeilen erscheinen");
  assert.doesNotMatch(protokoll, /> Bash:/);
  assert.match(protokoll, /--- Session-Output Issue #7 ---\n.*mvn -q verify/s, "der Session-Output-Block bleibt");
});

// --- Was der Stream sonst noch liefert (Issue #405) ---
//
// Die Ereigniszeilen entstehen aus fremdem NDJSON. Was dort ankommt, bestimmt nicht
// der Runner — und alles, was er nicht versteht, muss er ueberspringen, statt den
// Lauf daran zu kippen. Ein Verbose-Modus, der an einer unparsebaren Zeile stirbt,
// waere schlimmer als keiner.

test("verbose ueberspringt Zeilen, die kein Ereignis sind", async () => {
  const { res, konsole } = await verlauf([
    "kein JSON",                                    // unparsebar
    "",                                             // leer
    "null",                                         // JSON, aber kein Objekt
    '"nur ein String"',
    '{"type":"system","subtype":"init"}',           // Objekt ohne content
    '{"type":"assistant","message":{}}',            // ohne content-Array
    '{"type":"assistant","message":{"content":[{"type":"text","text":"   "}]}}', // leerer Text
    '{"type":"assistant","message":{"content":[{"type":"tool_use"}]}}',          // ohne Namen
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{}}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep"}]}}',  // ganz ohne input
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Glob","input":{"zahl":7}}]}}',
  ]);

  assert.equal(res.status, 0, "die Session haette durchlaufen muessen");
  // Ein Tool-Aufruf ohne brauchbares Argument erscheint mit blossem Namen ...
  assert.match(konsole, /#7 > Read$/m, "ein Tool ohne Argument muss mit blossem Namen erscheinen");
  assert.match(konsole, /#7 > Grep$/m, "ein Tool ganz ohne input-Feld muss mit blossem Namen erscheinen");
  // ... eines mit nicht-textlichem Argument als kompaktes JSON.
  assert.match(konsole, /#7 > Glob: \{"zahl":7\}/, "ein nicht-textliches Argument muss als JSON erscheinen");
  // Und nichts davon erzeugt eine leere oder kaputte Ereigniszeile.
  assert.doesNotMatch(konsole, /(?:> undefined)|(?:> null)|(?:> \s*$)/m,
    "aus einer unverstandenen Zeile wurde ein Ereignis gebaut");
  assert.equal(konsole.split("\n").filter((z) => z.includes("#7 > ")).length, 3, "genau die drei Werkzeugaufrufe");
});

test("verbose kuerzt lange Texte und Argumente", async () => {
  // Ein Text ueber 200 Zeichen und ein Kommando ueber 160: Beide muessen gekuerzt
  // ankommen, sonst walzt eine einzelne Session das Protokoll platt.
  const langerText = "T".repeat(400);
  const langesKommando = `echo ${"x".repeat(400)}`;
  const { konsole } = await verlauf([
    `{"type":"assistant","message":{"content":[{"type":"text","text":"${langerText}"}]}}`,
    `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"${langesKommando}"}}]}}`,
  ]);

  const textZeile = konsole.split("\n").find((z) => z.includes("> Claude: "));
  assert.ok(textZeile, "die Textzeile fehlt");
  assert.ok(textZeile.includes("…"), "der lange Text wurde nicht gekuerzt");
  assert.ok(textZeile.length < 300, `die Textzeile ist zu lang: ${textZeile.length} Zeichen`);
  const bashZeile = konsole.split("\n").find((z) => z.includes("> Bash: "));
  assert.ok(bashZeile?.includes("…"), "das lange Kommando wurde nicht gekuerzt");
});

test("verbose wertet auch eine letzte Zeile ohne Zeilenumbruch aus", async () => {
  // Ohne \n bleibt das Ereignis im Puffer, bis der Prozess endet. Ohne die Auswertung beim
  // Schliessen ginge die letzte Meldung einer Session verloren — und das ist oft die
  // interessanteste.
  const { konsole } = await verlauf([
    { roh: '{"type":"assistant","message":{"content":[{"type":"text","text":"Letzte Zeile ohne Umbruch"}]}}' },
  ]);
  assert.match(konsole, /> Claude: Letzte Zeile ohne Umbruch/, "die letzte Zeile ohne Umbruch wurde verschluckt");
});

test("eine Zeile, die auf zwei Stuecke des Stroms verteilt ankommt, ist ein Ereignis", async () => {
  const { konsole } = await verlauf([
    { roh: '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash",' },
    { roh: '"input":{"command":"git status"}}]}}\n' },
  ]);
  assert.equal(konsole.split("\n").filter((z) => z.includes("#7 > Bash: git status")).length, 1);
});
