// Tests fuer die FORMpruefung der Spec-Wirkung in `issue create` und
// `issue update` (Issue #526).
//
// Die Anwesenheit des Abschnitts prueft board.mjs seit Issue #443 selbst
// (test/board-spec-wirkung.test.mjs). Die Form der Zeilen darin kam bis hierher
// erst am Push-Gate zur Sprache: `spec.mjs check --paket` rief niemand auf, und
// ein Paket mit ueber sechs Zeilen umbrochener `KEINE`-Begruendung ueberstand am
// 2026-09-08 einen ganzen Nachtlauf.
//
// board.mjs baut die Grammatik NICHT nach, sondern laedt `wirkungPruefen` aus der
// Nachbardatei `spec.mjs` — die Entscheidung aus Issue #443 (genau eine Fassung
// der Grammatik) bleibt damit unangetastet, und die Pruefung wird trotzdem eine
// harte Leitplanke statt einer Bitte im Skill-Text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { setupProjekt, runBoard, board } from "./helpers/board-fixture.mjs";
import { wirkungPruefen } from "../kit/spec.mjs";

const BASIS = {
  issueTracker: "local",
  codeHost: "local",
  local: { issuesDir: "issues" },
};

const SPEC = { seit: "2026-09-02", bereiche: { board: ["kit/board.mjs"] } };

const mitSpec = () => setupProjekt({ ...BASIS, spec: SPEC }, "spec-form-");
const ohneSpec = () => setupProjekt(BASIS, "spec-form-ohne-");

// Kopf mit Autor-Modell-Zeile: Sonst greift die aeltere Leitplanke zuerst.
const KOPF = "## Kontext\nAutor-Modell: claude-opus-5\n\n## Aufgabe\nWas.\n";

const mitWirkung = (abschnitt) => `${KOPF}\n## Spec-Wirkung\n${abschnitt}\n`;

/** Legt eine Karte an, deren Body spaeter per `issue update` ersetzt wird. */
function karteAnlegen(dir) {
  const angelegt = board(dir, "issue", "create", "--title", "Traeger", "--body", mitWirkung("KEINE — Ausgangsstand."));
  return String(angelegt.id);
}

// --- die Bodies, an denen gemessen wird -------------------------------------

// Genau der Fall vom 2026-09-08: gueltig ist nur die erste Zeile, die
// Folgezeilen passen zu keiner der vier Formen aus A12.
const KEINE_UMBROCHEN = mitWirkung(
  "KEINE — dieses Paket aendert an der Beschreibung unter specs/ nichts,\nweil es nur Tests ergaenzt und keine Zusage beruehrt.",
);
const BINDESTRICH = mitWirkung("KEINE - reine Testaenderung.");
const UNBEKANNTE_FORM = mitWirkung("VIELLEICHT board-9 — irgendwas.");
const NUR_UEBERSCHRIFT = `${KOPF}\n## Spec-Wirkung\n\n`;
const KEINE_NEBEN_ZEILE = mitWirkung("KEINE — nichts.\nGEAENDERT board-2 — doch etwas.");
const FREMDER_BEREICH = mitWirkung("NEU nacht nacht-1 — Der Runner tut etwas.");

const KEINE_GUELTIG = mitWirkung("KEINE — reine Testaenderung.");
const NEU_GUELTIG = mitWirkung("NEU board board-9 — Der Adapter prueft die Form der Wirkungszeilen.");

// --- der geteilte Einstieg --------------------------------------------------

test("[board-2] spec.mjs exportiert wirkungPruefen", () => {
  // board.mjs haengt an genau diesem Namen. Ohne den Export bliebe der Import
  // `undefined`, und die Leitplanke fiele still aus — der Fall, den dieses Paket
  // schliesst. Bewusst kein Wrapper "nur Form": `neuFehler` prueft auch ohne
  // Dateibestand gegen die bekannten Bereiche.
  assert.equal(typeof wirkungPruefen, "function");
  assert.deepEqual(wirkungPruefen("## Spec-Wirkung\nKEINE — nichts.\n", ["board"]), []);
});

// --- issue create -----------------------------------------------------------

test("[board-2] issue create weist eine mehrzeilige KEINE-Begruendung ab und nennt die Zeilennummer", () => {
  const dir = mitSpec();
  const res = runBoard(dir, ["issue", "create", "--title", "Umbrochen", "--body", KEINE_UMBROCHEN]);
  assert.notEqual(res.status, 0, "der Aufruf haette fehlschlagen muessen");
  // Die Folgezeile ist Zeile 8: Kontext(1) Autor(2) leer(3) Aufgabe(4) Was(5)
  // leer(6) Ueberschrift(7) KEINE(8) Folgezeile(9).
  assert.match(res.stderr, /Zeile 9:/, "die Meldung muss die fehlerhafte Zeile nennen");
  assert.match(res.stderr, /A12/, "die Meldung muss die Grammatik benennen");
  assert.deepEqual(board(dir, "issue", "list"), [], "trotz Fehler wurde ein Issue angelegt");
});

test("[board-2] issue create weist einen Bindestrich statt Gedankenstrich ab", () => {
  const dir = mitSpec();
  const res = runBoard(dir, ["issue", "create", "--title", "Bindestrich", "--body", BINDESTRICH]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /U\+2014/, "der Hinweis auf den Gedankenstrich gehoert in die Meldung");
  assert.deepEqual(board(dir, "issue", "list"), []);
});

test("[board-2] issue create weist eine unbekannte Zeilenform ab", () => {
  const dir = mitSpec();
  const res = runBoard(dir, ["issue", "create", "--title", "Unbekannt", "--body", UNBEKANNTE_FORM]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Zeilenform passt zu keiner der vier Formen/);
  assert.deepEqual(board(dir, "issue", "list"), []);
});

test("[board-2] issue create weist einen Abschnitt nur aus der Ueberschrift ab", () => {
  // Bisher angelegt: Die Anwesenheitspruefung war erfuellt, sobald die
  // Ueberschrift stand — auch ohne eine einzige Wirkungszeile.
  const dir = mitSpec();
  const res = runBoard(dir, ["issue", "create", "--title", "Leerer Abschnitt", "--body", NUR_UEBERSCHRIFT]);
  assert.notEqual(res.status, 0, "ein Abschnitt ohne Wirkungszeile haette abgewiesen werden muessen");
  assert.match(res.stderr, /ohne Wirkungszeile/);
  assert.deepEqual(board(dir, "issue", "list"), []);
});

test("[board-2] issue create weist KEINE neben einer weiteren Zeile ab", () => {
  const dir = mitSpec();
  const res = runBoard(dir, ["issue", "create", "--title", "KEINE plus", "--body", KEINE_NEBEN_ZEILE]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /'KEINE' steht allein/);
  assert.deepEqual(board(dir, "issue", "list"), []);
});

test("[board-2] issue create weist eine NEU-Zeile mit unbekanntem Bereich ab", () => {
  // Der Bereich kommt aus `spec.bereiche` der Config — Config-Wissen, kein
  // Dateibestand unter specs/.
  const dir = mitSpec();
  const res = runBoard(dir, ["issue", "create", "--title", "Fremder Bereich", "--body", FREMDER_BEREICH]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Unbekannter Bereich 'nacht'/);
  assert.deepEqual(board(dir, "issue", "list"), []);
});

test("[board-2] issue create laesst eine einzeilige KEINE und eine gueltige NEU-Zeile durch", () => {
  const dir = mitSpec();
  for (const body of [KEINE_GUELTIG, NEU_GUELTIG]) {
    const angelegt = board(dir, "issue", "create", "--title", "Gueltig", "--body", body);
    assert.equal(board(dir, "issue", "get", String(angelegt.id)).body, body);
  }
});

test("[board-2] ohne spec-Block prueft issue create die Form nicht", () => {
  // Byte-Vergleich: Das Kit selbst hat keinen spec-Block, und ein Adapter, der
  // hier abweist, lehnte die Pakete ab, mit denen er gebaut wird.
  const dir = ohneSpec();
  const angelegt = board(dir, "issue", "create", "--title", "Ohne Schalter", "--body", KEINE_UMBROCHEN);
  assert.equal(board(dir, "issue", "get", String(angelegt.id)).body, KEINE_UMBROCHEN);
});

test("[board-2] ein Dokument-Praefix geht bei issue create weiterhin ohne Abschnitt durch", () => {
  const dir = mitSpec();
  for (const titel of ["[Fachlich] Eine Anforderung", "[Plan] Ein Weg", "[Idee] Ein Einfall"]) {
    const angelegt = board(dir, "issue", "create", "--title", titel, "--body", KOPF);
    assert.equal(board(dir, "issue", "get", String(angelegt.id)).body, KOPF, `'${titel}': der Body wurde veraendert`);
  }
});

// --- issue update -----------------------------------------------------------
//
// Genau hierueber schreibt `/issue-review` den geschaerften Body zurueck — auch
// nachts. Ohne diese Leitplanke war das der offene Weg an der Pruefung vorbei.

test("[board-2] issue update weist dieselben Bodies ab und laesst die Karte unveraendert", () => {
  const dir = mitSpec();
  const id = karteAnlegen(dir);
  const vorher = board(dir, "issue", "get", id).body;

  for (const body of [KEINE_UMBROCHEN, BINDESTRICH, UNBEKANNTE_FORM, NUR_UEBERSCHRIFT, KEINE_NEBEN_ZEILE, FREMDER_BEREICH]) {
    const res = runBoard(dir, ["issue", "update", id, "--body", body]);
    assert.notEqual(res.status, 0, `haette abgewiesen werden muessen: ${body}`);
    assert.equal(board(dir, "issue", "get", id).body, vorher, "der Body wurde trotz Fehler geschrieben");
  }
});

test("[board-2] issue update weist einen Body ohne Spec-Wirkung ab", () => {
  const dir = mitSpec();
  const id = karteAnlegen(dir);
  const res = runBoard(dir, ["issue", "update", id, "--body", KOPF]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /## Spec-Wirkung/);
});

test("[board-2] issue update laesst dieselben gueltigen Bodies durch", () => {
  const dir = mitSpec();
  const id = karteAnlegen(dir);
  for (const body of [KEINE_GUELTIG, NEU_GUELTIG]) {
    const res = runBoard(dir, ["issue", "update", id, "--body", body]);
    assert.equal(res.status, 0, `haette durchgehen muessen: ${res.stderr}`);
    assert.equal(board(dir, "issue", "get", id).body, body);
  }
});

test("[board-2] ein Dokument-Praefix geht bei issue update weiterhin ohne Abschnitt durch", () => {
  // Der Titel steht nicht am Kommando — er kommt aus `tracker.getIssue`. Ohne
  // diese Reihenfolge wiese der Adapter jedes Plandokument ab, das
  // `/issue-review` nachts zurueckschreibt.
  const dir = mitSpec();
  const angelegt = board(dir, "issue", "create", "--title", "[Plan] Ein Weg", "--body", KOPF);
  const id = String(angelegt.id);
  const neu = `${KOPF}\nGeschaerft.\n`;
  const res = runBoard(dir, ["issue", "update", id, "--body", neu]);
  assert.equal(res.status, 0, `das Plandokument haette durchgehen muessen: ${res.stderr}`);
  assert.equal(board(dir, "issue", "get", id).body, neu);
});

test("[board-2] ohne spec-Block prueft issue update die Form nicht", () => {
  const dir = ohneSpec();
  const angelegt = board(dir, "issue", "create", "--title", "Ohne Schalter", "--body", KOPF);
  const id = String(angelegt.id);
  const res = runBoard(dir, ["issue", "update", id, "--body", KEINE_UMBROCHEN]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(board(dir, "issue", "get", id).body, KEINE_UMBROCHEN);
});

// --- die Fence-Grenze, festgeschrieben statt aufgehoben ----------------------

test("[board-2] ein gefenctes Beispiel vor dem echten Abschnitt wird von der Formpruefung gelesen", () => {
  // Zwei Auslegungen treffen hier aufeinander: `specWirkungVorhanden` in
  // board.mjs ignoriert Ueberschriften im Code-Fence, `wirkungsAbschnitt` in
  // spec.mjs nimmt die ERSTE `## Spec-Wirkung`-Zeile ohne Fence-Regel. Die
  // Anwesenheit ist also erfuellt (der echte Abschnitt steht unten), gelesen
  // wird aber der gefencte. Die Regel bleibt so: `fenceLauf` liegt in board.mjs,
  // und ein Import aus spec.mjs heraus ergaebe einen Zyklus oder eine zweite
  // Fence-Fassung. Der Test haelt den Fall fest, damit er bekannt ist.
  const dir = mitSpec();
  const body = `${KOPF}\nSo sieht der Abschnitt aus:\n\n\`\`\`\n## Spec-Wirkung\nKEINE - falsches Beispiel.\n\`\`\`\n\n## Spec-Wirkung\nKEINE — echte Angabe.\n`;
  const res = runBoard(dir, ["issue", "create", "--title", "Mit Beispiel", "--body", body]);
  assert.notEqual(res.status, 0, "die Formpruefung liest den gefencten Abschnitt — das ist die bekannte Grenze");
  assert.match(res.stderr, /U\+2014/);
  assert.deepEqual(board(dir, "issue", "list"), []);
});

// --- der fehlende Nachbar ---------------------------------------------------

test("[board-2] ohne spec.mjs neben board.mjs enden create und update rot und legen nichts an", () => {
  const dir = mitSpec();
  const leer = mkdtempSync(join(tmpdir(), "spec-form-nachbar-"));
  const id = karteAnlegen(dir);
  const vorher = board(dir, "issue", "get", id).body;

  const erstellt = runBoard(dir, ["issue", "create", "--title", "Ohne Nachbar", "--body", KEINE_GUELTIG], { BOARD_NACHBAR_DIR: leer });
  assert.notEqual(erstellt.status, 0, "ohne Nachbarn darf nichts angelegt werden");
  assert.match(erstellt.stderr, /spec\.mjs liegt nicht neben board\.mjs/);

  const geaendert = runBoard(dir, ["issue", "update", id, "--body", KEINE_GUELTIG], { BOARD_NACHBAR_DIR: leer });
  assert.notEqual(geaendert.status, 0, "ohne Nachbarn darf nichts geschrieben werden");
  assert.match(geaendert.stderr, /spec\.mjs liegt nicht neben board\.mjs/);

  assert.deepEqual(board(dir, "issue", "list").map((i) => String(i.id)), [id], "es entstand eine Karte");
  assert.equal(board(dir, "issue", "get", id).body, vorher, "der Body wurde veraendert");
});

test("[board-2] ohne spec-Block laeuft derselbe Aufruf mit leerem Nachbar-Verzeichnis durch", () => {
  // Der Ersatz wirft erst BEIM AUFRUF. Ein Projekt ohne spec-Block ruft ihn nie
  // — damit ist "nur bei gesetztem Block" ohne zweite Bauart erfuellt.
  const dir = ohneSpec();
  const leer = mkdtempSync(join(tmpdir(), "spec-form-nachbar-ohne-"));
  const res = runBoard(dir, ["issue", "create", "--title", "Ohne Schalter", "--body", KOPF], { BOARD_NACHBAR_DIR: leer });
  assert.equal(res.status, 0, res.stderr);
  const angelegt = JSON.parse(res.stdout);
  assert.equal(board(dir, "issue", "get", String(angelegt.id)).body, KOPF);
});
