// Pruefvorgabe am Ticket: Parser und Bezugsstand (Issue #301, Plan #300,
// fachliche Quelle #285).
//
// Die Regel, was eine Pruefvorgabe ist und wann sie verfallen ist, lebt an genau
// einer Stelle — sonst haetten Nacht-Runner und Adapter zwei Auslegungen
// derselben Zeile, und ein `SYNC:`-Kommentar erzwingt keine identische Semantik.
//
// Der wertvollste Test hier ist der feste Hash-Vektor: Rein relationale Tests
// ("Kontexttext aendert nichts") blieben auch mit einem anderen Hashverfahren
// oder einer unvollstaendigen Zeilenend-Normalisierung gruen.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePruefvorgabe, pruefvorgabeStand } from "../kit/board.mjs";

/** Body im Vier-Abschnitt-Format mit frei waehlbarem Kontext-Inhalt. */
const body = (kontext, rest = "## Aufgabe\n\nA\n") =>
  `## Kontext\n${kontext}\n\n${rest}`;

// --- Vorgabezeile ---

test("alle vier Werte werden erkannt", () => {
  assert.equal(parsePruefvorgabe(body("Pruefung: 1")).wert, 1);
  assert.equal(parsePruefvorgabe(body("Pruefung: 2")).wert, 2);
  assert.equal(parsePruefvorgabe(body("Pruefung: 3")).wert, 3);
  assert.equal(parsePruefvorgabe(body("Pruefung: Verzicht")).wert, "verzicht");
});

test("der Wert wird case-insensitiv gelesen und kleingeschrieben geliefert", () => {
  assert.equal(parsePruefvorgabe(body("Pruefung: vErZiChT")).wert, "verzicht");
  assert.equal(parsePruefvorgabe(body("Pruefung: VERZICHT")).wert, "verzicht");
});

test("fehlende Zeile ist kein Fehler", () => {
  const r = parsePruefvorgabe(body("Autor-Modell: claude-opus-5"));
  assert.deepEqual(r, { wert: null, stand: null, verfallen: false });
});

test("zwei Vorgabezeilen sind ein Fehler", () => {
  assert.throws(
    () => parsePruefvorgabe(body("Pruefung: 1\nPruefung: 2")),
    /Pruefung/
  );
});

test("unbekannter Wert im Kontext ist ein Fehler", () => {
  assert.throws(() => parsePruefvorgabe(body("Pruefung: 4")), /Pruefung/);
  assert.throws(() => parsePruefvorgabe(body("Pruefung: manchmal")), /Pruefung/);
  assert.throws(() => parsePruefvorgabe(body("Pruefung:")), /Pruefung/);
});

test("unbekannter Wert ausserhalb des Kontexts wird ignoriert", () => {
  const r = parsePruefvorgabe(body("Autor-Modell: x", "## Aufgabe\n\nPruefung: 4\n"));
  assert.equal(r.wert, null);
});

test("eine Vorgabezeile in einem Fence innerhalb des Kontexts wird ignoriert", () => {
  const r = parsePruefvorgabe(body("```\nPruefung: 4\n```"));
  assert.equal(r.wert, null, "die Zeile im Fence ist ein Beispiel, keine Vorgabe");
});

test("ein Fence aus Tilden wirkt genauso", () => {
  const r = parsePruefvorgabe(body("~~~\nPruefung: 4\n~~~\nPruefung: 2"));
  assert.equal(r.wert, 2);
});

test("Body ohne Kontext-Abschnitt liefert null", () => {
  const r = parsePruefvorgabe("## Aufgabe\n\nPruefung: 2\n");
  assert.deepEqual(r, { wert: null, stand: null, verfallen: false });
});

test("bei zwei Kontext-Abschnitten gilt der erste, ohne Fehler", () => {
  const roh = "## Kontext\nPruefung: 1\n\n## Aufgabe\n\nA\n\n## Kontext\nPruefung: 3\n";
  assert.equal(parsePruefvorgabe(roh).wert, 1);
});

test("Ueberschrift mit Suffix wird als Kontext erkannt", () => {
  const roh = "## Kontext (alt)\nPruefung: 2\n\n## Aufgabe\n\nA\n";
  assert.equal(parsePruefvorgabe(roh).wert, 2);
});

test("eine ##-Zeile in einem Fence beendet den Kontext nicht", () => {
  const roh = "## Kontext\n```\n## Aufgabe\n```\nPruefung: 3\n\n## Aufgabe\n\nA\n";
  assert.equal(parsePruefvorgabe(roh).wert, 3);
});

// --- Standzeile ---

const HEX = "a".repeat(64);

test("64 Hex-Zeichen sind ein gueltiger Stand", () => {
  const r = parsePruefvorgabe(body(`Pruefung: 1\nPruefung-Stand: ${HEX}`));
  assert.equal(r.stand, HEX);
});

test("Grossbuchstaben im Stand werden kleingeschrieben", () => {
  const r = parsePruefvorgabe(body(`Pruefung: 1\nPruefung-Stand: ${"A".repeat(64)}`));
  assert.equal(r.stand, HEX);
});

test("zwei Standzeilen sind ein Fehler", () => {
  assert.throws(
    () => parsePruefvorgabe(body(`Pruefung-Stand: ${HEX}\nPruefung-Stand: ${HEX}`)),
    /Pruefung-Stand/
  );
});

test("leerer, zu kurzer, zu langer oder nichthexadezimaler Stand ist ein Fehler", () => {
  for (const wert of ["", "a".repeat(63), "a".repeat(65), "z".repeat(64)]) {
    assert.throws(
      () => parsePruefvorgabe(body(`Pruefung-Stand: ${wert}`)),
      /Pruefung-Stand/,
      `'${wert}' haette abgelehnt werden muessen`
    );
  }
});

test("ein Stand ohne Vorgabezeile ist zulaessig", () => {
  const roh = body(`Pruefung-Stand: ${HEX}`);
  const r = parsePruefvorgabe(roh);
  assert.equal(r.wert, null);
  assert.equal(r.stand, HEX);
  assert.equal(r.verfallen, true, "der Fantasie-Stand passt nicht zum Body");

  const passend = body(`Pruefung-Stand: ${pruefvorgabeStand(roh)}`);
  assert.equal(parsePruefvorgabe(passend).verfallen, false);
});

// --- Bezugsstand ---

const VEKTOR_BODY = "## Kontext\nPruefung: 1\n\n## Aufgabe\n\nA\n";
const VEKTOR_STAND = "ef34a0437a833f1c7031734249b89c6d7372d9fab194170833be80dcea5b86bb";

test("fester Testvektor", () => {
  assert.equal(pruefvorgabeStand(VEKTOR_BODY), VEKTOR_STAND);
});

test("beliebiger Kontexttext veraendert den Stand nicht", () => {
  const roh = "## Kontext\nAutor-Modell: claude-opus-5\nPruefung: 3\nIssue-Review: codex\n\n## Aufgabe\n\nA\n";
  assert.equal(pruefvorgabeStand(roh), VEKTOR_STAND);
});

test("fuehrende und abschliessende Leerzeilen veraendern den Stand nicht", () => {
  assert.equal(pruefvorgabeStand("\n\n" + VEKTOR_BODY + "\n\n"), VEKTOR_STAND);
});

test("ein zusaetzlicher Abschnitt ausserhalb des Kontexts veraendert den Stand", () => {
  const roh = VEKTOR_BODY + "\n## Abhaengigkeiten\n\nKeine.\n";
  assert.notEqual(pruefvorgabeStand(roh), VEKTOR_STAND);
});

test("CRLF und LF liefern denselben Stand", () => {
  assert.equal(pruefvorgabeStand(VEKTOR_BODY.replace(/\n/g, "\r\n")), VEKTOR_STAND);
  assert.equal(pruefvorgabeStand(VEKTOR_BODY.replace(/\n/g, "\r")), VEKTOR_STAND);
});

test("ohne Kontext-Abschnitt wird der ganze Body gehasht", () => {
  assert.equal(pruefvorgabeStand("## Aufgabe\n\nA\n"), VEKTOR_STAND);
});

test("Vorspann vor dem Kontext bleibt erhalten", () => {
  const roh = "Vorspann\n\n" + VEKTOR_BODY;
  assert.notEqual(pruefvorgabeStand(roh), VEKTOR_STAND);
  assert.match(String(pruefvorgabeStand(roh)), /^[0-9a-f]{64}$/);
});

// --- Verfall ---

test("passender Stand: nicht verfallen — abweichender Stand: verfallen", () => {
  const inhalt = "Autor-Modell: claude-opus-5\nPruefung: 2";
  const passend = body(`${inhalt}\nPruefung-Stand: ${pruefvorgabeStand(body(inhalt))}`);
  assert.equal(parsePruefvorgabe(passend).verfallen, false);

  const veraendert = passend.replace("## Aufgabe\n\nA\n", "## Aufgabe\n\nB\n");
  assert.equal(parsePruefvorgabe(veraendert).verfallen, true);
});

test("fehlender Stand gilt nie als verfallen", () => {
  assert.equal(parsePruefvorgabe(body("Pruefung: Verzicht")).verfallen, false);
});
