// Tests fuer die Spec-Wirkung-Leitplanke in `issue create` (Issue #443).
//
// Ein Arbeitspaket muss sagen, was es an der Beschreibung unter specs/ aendert.
// Das ist eine Leitplanke im Adapter, keine Bitte im Skill-Text (Plan #437, A7):
// Eine Bitte im Skill ist genau die Leitplanke, die unter Druck uebersprungen
// wird — in diesem Repo dreimal belegt. Dieselbe Bauart wie die Autor-Modell-
// Leitplanke aus Issue #266, deshalb dasselbe Testmuster wie in
// test/board-autor-modell.test.mjs.
//
// Geprueft wird hier nur die ANWESENHEIT des Abschnitts. Die Form der Zeilen
// darin prueft `spec.mjs check --paket` (Issue #442) — zwei Pruefungen derselben
// Grammatik waeren zwei Wahrheiten.

import { test } from "node:test";
import assert from "node:assert/strict";

import { setupProjekt, runBoard, board } from "./helpers/board-fixture.mjs";

const BASIS = {
  issueTracker: "local",
  codeHost: "local",
  local: { issuesDir: "issues" },
};

// Der Schalter ist das Vorhandensein des Blocks, nicht ein Feld darin (A1).
const SPEC = { seit: "2026-09-02", bereiche: { board: ["kit/board.mjs"] } };

const mitSpec = () => setupProjekt({ ...BASIS, spec: SPEC }, "spec-wirkung-");
const ohneSpec = () => setupProjekt(BASIS, "spec-wirkung-ohne-");

// Kopf mit Autor-Modell-Zeile: Sonst greift die aeltere Leitplanke zuerst, und
// die Probe misst den falschen Abbruch.
const KOPF = "## Kontext\nAutor-Modell: claude-opus-5\n\n## Aufgabe\nWas.\n";

test("mit spec-Block wird ein Body ohne Spec-Wirkung abgelehnt und nichts angelegt", () => {
  const dir = mitSpec();
  const res = runBoard(dir, ["issue", "create", "--title", "Ohne Wirkung", "--body", KOPF]);
  assert.notEqual(res.status, 0, "der Aufruf haette fehlschlagen muessen");
  assert.match(res.stderr, /## Spec-Wirkung/, "die Meldung muss den fehlenden Abschnitt nennen");
  assert.match(res.stderr, /spec\.mjs check --paket/, "die Meldung muss auf die Formpruefung verweisen");
  assert.deepEqual(board(dir, "issue", "list"), [], "trotz Fehler wurde ein Issue angelegt");
});

test("mit spec-Block und vorhandenem Abschnitt wird angelegt", () => {
  const dir = mitSpec();
  const body = `${KOPF}\n## Spec-Wirkung\nKEINE — reine Testaenderung.\n`;
  const angelegt = board(dir, "issue", "create", "--title", "Mit Wirkung", "--body", body);
  assert.match(board(dir, "issue", "get", String(angelegt.id)).body, /^## Spec-Wirkung$/m);
});

test("eine Ueberschrift im Code-Fence zaehlt nicht als vorhanden", () => {
  const dir = mitSpec();
  // Genau der Fall, den eine Doku-Karte erzeugt: Sie ZEIGT die Grammatik, sie
  // wendet sie nicht an.
  const body = `${KOPF}\nSo sieht der Abschnitt aus:\n\n\`\`\`\n## Spec-Wirkung\nKEINE — Beispiel.\n\`\`\`\n`;
  const res = runBoard(dir, ["issue", "create", "--title", "Nur Beispiel", "--body", body]);
  assert.notEqual(res.status, 0, "die Ueberschrift im Fence haette nicht zaehlen duerfen");
  assert.match(res.stderr, /## Spec-Wirkung/);
  assert.deepEqual(board(dir, "issue", "list"), []);
});

test("issue create ohne Body-Quelle wird bei gesetztem spec-Block abgelehnt", () => {
  const dir = mitSpec();
  // Die lokale Vier-Abschnitt-Vorlage traegt keinen fuenften Abschnitt und soll
  // auch keinen bekommen — ein `create` ohne Body kommt bei gesetztem Schalter
  // deshalb nicht durch.
  const res = runBoard(dir, ["issue", "create", "--title", "Ohne Body"]);
  assert.notEqual(res.status, 0, "der Aufruf haette fehlschlagen muessen");
  assert.match(res.stderr, /## Spec-Wirkung/);
  assert.deepEqual(board(dir, "issue", "list"), []);
});

test("ohne spec-Block bleibt issue create unveraendert", () => {
  // Kriterium 2 und der wichtigste Fall: Waere die Bedingung falsch, wuerde
  // dieses Paket die Pakete ablehnen, mit denen es gebaut wird — das Kit selbst
  // hat keinen spec-Block. Byte-Vergleich, nicht assert.match: Ein Adapter, der
  // den Abschnitt still ergaenzt, faellt nur so auf.
  const dir = ohneSpec();
  const angelegt = board(dir, "issue", "create", "--title", "Ohne Schalter", "--body", KOPF);
  assert.equal(board(dir, "issue", "get", String(angelegt.id)).body, KOPF);
});

test("bei fehlendem Autor-Modell UND fehlender Spec-Wirkung meldet der Adapter das Autor-Modell", () => {
  // Die Reihenfolge ist zugesagt: Die neue Pruefung laeuft NACH
  // autorModellSicherstellen, auf dem aufgeloesten Body.
  const dir = mitSpec();
  const res = runBoard(dir, ["issue", "create", "--title", "Beides fehlt", "--body", "## Kontext\nnichts.\n"], { KIT_AGENT_MODEL: "" });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Autor-Modell/);
  assert.deepEqual(board(dir, "issue", "list"), []);
});

// --- Ausnahme fuer Dokument-Praefixe (Issue #464) ---------------------------
//
// `[Fachlich]`, `[Plan]` und `[Idee]` werden nie implementiert und nie nach Ready
// gezogen. Sie koennen an der Beschreibung nichts aendern, ihr Abschnitt kann nur
// `KEINE — <Begruendung>` lauten — und eine Leitplanke, die immer dieselbe leere
// Zeile erzwingt, prueft nichts mehr. Belegt an #462 und #463: zwei Sessions, die
// einander nicht kannten, schrieben unabhaengig dieselbe Pflichtzeile.

test("[board-2] mit spec-Block wird jedes der drei Dokument-Praefixe ohne Spec-Wirkung angelegt", () => {
  const dir = mitSpec();
  // Auch die Schreibvarianten, die die Erkennung ausdruecklich deckt: fuehrender
  // Leerraum und Gross-/Kleinschreibung sind gleichgueltig.
  for (const titel of ["[Fachlich] Eine Anforderung", "[Plan] Ein Weg", "[Idee] Ein Einfall", "  [FACHLICH] Mit Leerraum", "[plan] klein geschrieben"]) {
    const angelegt = board(dir, "issue", "create", "--title", titel, "--body", KOPF);
    assert.ok(angelegt.id, `'${titel}' haette angelegt werden muessen`);
    assert.equal(board(dir, "issue", "get", String(angelegt.id)).body, KOPF, `'${titel}': der Body wurde veraendert`);
  }
});

test("[board-2] ein Beinahe-Praefix wird weiter abgewiesen, mit unveraenderter Meldung", () => {
  const dir = mitSpec();
  // Das Praefix muss am Titelanfang stehen und wortgleich sein. `[Fachplan]` und
  // `[Konzept]` sind andere Woerter, `Foo [Plan]` steht mitten im Titel — keiner
  // dieser Titel ist ein Dokument-Praefix, alle drei sind Arbeitspakete.
  for (const titel of ["Ohne jedes Praefix", "[Fachplan] Beinahe", "[Konzept] Auch nicht", "Text ueber [Plan] mittendrin", "Fachlich: ohne Klammern"]) {
    const res = runBoard(dir, ["issue", "create", "--title", titel, "--body", KOPF]);
    assert.notEqual(res.status, 0, `'${titel}' haette abgewiesen werden muessen`);
    assert.match(res.stderr, /## Spec-Wirkung/, `'${titel}': die Meldung muss den fehlenden Abschnitt nennen`);
    assert.match(res.stderr, /spec\.mjs check --paket/, `'${titel}': die Meldung muss auf die Formpruefung verweisen`);
  }
  assert.deepEqual(board(dir, "issue", "list"), [], "trotz Fehler wurde ein Issue angelegt");
});

test("[board-2] ein Praefix-Dokument mit freiwilligem Abschnitt wird angelegt", () => {
  const dir = mitSpec();
  // Die Ausnahme erlaubt das Weglassen, sie verbietet den Abschnitt nicht: Wer
  // ihn schreibt, wird weiter an derselben Grammatik gemessen.
  const body = `${KOPF}\n## Spec-Wirkung\nKEINE — Plandokument, die Wirkung tragen die Pakete.\n`;
  const angelegt = board(dir, "issue", "create", "--title", "[Plan] Mit freiwilliger Wirkung", "--body", body);
  assert.match(board(dir, "issue", "get", String(angelegt.id)).body, /^## Spec-Wirkung$/m);
});

test("[board-2] ohne spec-Block bleibt ein Praefix-Titel ohne Abschnitt zeichengleich", () => {
  // Byte-Vergleich wie im Bestandstest: Ein Adapter, der den Abschnitt still
  // ergaenzt oder den Titel anfasst, faellt nur so auf.
  const dir = ohneSpec();
  const angelegt = board(dir, "issue", "create", "--title", "[Fachlich] Ohne Schalter", "--body", KOPF);
  assert.equal(board(dir, "issue", "get", String(angelegt.id)).body, KOPF);
});
