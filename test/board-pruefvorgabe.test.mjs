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
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";
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

// --- CLI: issue-review roles --issue (Issue #302) ---
//
// `roles` lieferte bisher gar keine Rundenzahl — der Skill las sie "aus der Config",
// was er sonst an keiner Stelle tut. Ein Kommando soll die vollstaendige Pruefvorgabe
// liefern, nicht zwei Quellen. Die drei Felder sind additiv: Auswahl und Besetzung
// bleiben unveraendert, nur das JSON waechst.

const OPUS = { name: "opus", kind: "claude", model: "claude-opus-5" };
const SONNET = { name: "sonnet", kind: "claude", model: "claude-sonnet-5" };
const CODEX = { name: "codex", kind: "command", command: "codex exec --model gpt-5" };

// rounds: 2 statt des Defaults 1 — sonst waere der Config-Wert von einer Vorgabe
// `Pruefung: 1` nicht zu unterscheiden, und ein falsch verdrahtetes `runden` bliebe gruen.
const KONFIG = {
  codeHost: "local",
  issueTracker: "local",
  local: { issuesDir: "issues" },
  issueReview: { rounds: 2, reviewers: [OPUS, SONNET, CODEX] },
  reviewStufen: {
    fachlich: { reviewer: 2, rollen: ["form-beobachtbarkeit", "abgrenzung"] },
    plan: { reviewer: 2, rollen: ["architektur-bestand", "schnitt-abhaengigkeiten"] },
    issue: { reviewer: 1, rollen: ["pruefbarkeit"] },
  },
};

/** Fixture-Projekt mit lokalem Tracker; `kontext` fuellt den Kontext-Abschnitt von 0001. */
function mitTicket(kontext, fn) {
  const dir = setupProjekt(KONFIG, "board-vorgabe-");
  try {
    mkdirSync(join(dir, "issues"), { recursive: true });
    const koerper = `\n## Kontext\n\n${kontext}\n\n## Aufgabe\n\nA\n`;
    const kopf = `---\nid: "0001"\ntype: task\nstatus: ready\ntitle: Ticket\ncreated: 2026-08-12\n---\n`;
    writeFileSync(join(dir, "issues", "0001.md"), kopf + koerper, "utf-8");
    // Der Tracker liefert genau `koerper` als Body — daher ist der Stand darueber
    // derselbe, den der Adapter spaeter berechnet.
    fn(dir, koerper);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rollen = (dir, ...extra) =>
  runBoard(dir, ["issue-review", "roles", "--stufe", "issue", "--author", "claude-opus-5", ...extra]);

test("roles ohne --issue: runden aus der Config, kein Verzicht", () => {
  mitTicket("Pruefung: 3", (dir) => {
    const res = rollen(dir);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.runden, 2, "ohne --issue zaehlt allein issueReview.rounds");
    assert.equal(out.verzicht, false);
    assert.equal(out.vorgabeQuelle, "config");
    // Die Felder aus Issue #278 bleiben unveraendert — die Erweiterung ist additiv.
    assert.equal(out.stufe, "issue");
    assert.equal(out.autor, "claude-opus-5");
    assert.equal(out.gewaehlt.length, 1);
    assert.ok(!out.gewaehlt.some((r) => r.name === "opus"));
  });
});

test("roles --issue mit gueltiger Vorgabe: runden aus dem Ticket", () => {
  mitTicket("Pruefung: 3", (dir) => {
    const res = rollen(dir, "--issue", "1");
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.runden, 3);
    assert.equal(out.verzicht, false);
    assert.equal(out.vorgabeQuelle, "issue");
  });
});

test("roles --issue mit passendem Stand: die Vorgabe gilt", () => {
  // Der Regelfall nach einem `issue update`: Die Vorgabe traegt ihren Bezugsstand.
  mitTicket("Pruefung: 1", (dir, koerper) => {
    const stand = pruefvorgabeStand(koerper);
    const mitStand = koerper.replace("Pruefung: 1", `Pruefung: 1\nPruefung-Stand: ${stand}`);
    const kopf = `---\nid: "0001"\ntype: task\nstatus: ready\ntitle: Ticket\ncreated: 2026-08-12\n---\n`;
    writeFileSync(join(dir, "issues", "0001.md"), kopf + mitStand, "utf-8");
    const out = JSON.parse(rollen(dir, "--issue", "1").stdout);
    assert.equal(out.runden, 1);
    assert.equal(out.vorgabeQuelle, "issue", "der Stand deckt den unveraenderten Body");
  });
});

test("roles --issue mit Verzicht: verzicht true, keine Runde", () => {
  mitTicket("Pruefung: Verzicht", (dir) => {
    const out = JSON.parse(rollen(dir, "--issue", "1").stdout);
    assert.equal(out.verzicht, true);
    assert.equal(out.vorgabeQuelle, "issue");
    assert.equal(out.runden, 0, "ohne Pruefung laeuft keine Runde");
  });
});

test("roles --issue mit verfallener Vorgabe: Config-Runden, eigene Quelle", () => {
  // "config" und "verfallen" ergeben dieselbe Rundenzahl — nur der zweite Wert sagt,
  // dass dort einmal etwas stand. Ohne ihn koennte niemand den Unterschied melden.
  mitTicket(`Pruefung: 3\nPruefung-Stand: ${"b".repeat(64)}`, (dir) => {
    const out = JSON.parse(rollen(dir, "--issue", "1").stdout);
    assert.equal(out.runden, 2);
    assert.equal(out.verzicht, false);
    assert.equal(out.vorgabeQuelle, "verfallen");
  });
});

test("roles --issue mit verfallenem Verzicht: kein Verzicht", () => {
  // Der gefaehrlichste Verfall: Ein Ticket, das nach der Freigabe inhaltlich
  // veraendert wurde, darf nicht weiter ungeprueft durchlaufen.
  mitTicket(`Pruefung: Verzicht\nPruefung-Stand: ${"b".repeat(64)}`, (dir) => {
    const out = JSON.parse(rollen(dir, "--issue", "1").stdout);
    assert.equal(out.verzicht, false);
    assert.equal(out.vorgabeQuelle, "verfallen");
    assert.equal(out.runden, 2);
  });
});

test("roles --issue ohne Vorgabezeile: der Regelfall gilt", () => {
  mitTicket("Autor-Modell: claude-opus-5", (dir) => {
    const out = JSON.parse(rollen(dir, "--issue", "1").stdout);
    assert.equal(out.runden, 2);
    assert.equal(out.verzicht, false);
    assert.equal(out.vorgabeQuelle, "config");
  });
});

test("roles --issue mit ungueltiger Vorgabe bricht mit der Parser-Meldung ab", () => {
  mitTicket("Pruefung: manchmal", (dir) => {
    const res = rollen(dir, "--issue", "1");
    assert.notEqual(res.status, 0, "eine kaputte Vorgabe darf nicht still zum Regelfall werden");
    assert.match(res.stderr, /Pruefung/);
  });
});

test("roles --issue mit zwei Vorgabezeilen bricht ab", () => {
  mitTicket("Pruefung: 1\nPruefung: 3", (dir) => {
    const res = rollen(dir, "--issue", "1");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Pruefung/);
  });
});

test("roles --issue ohne Wert bricht ab", () => {
  mitTicket("Pruefung: 1", (dir) => {
    const res = rollen(dir, "--issue");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /--issue/);
  });
});

test("roles --issue mit unbekannter Nummer bricht ab", () => {
  mitTicket("Pruefung: 1", (dir) => {
    const res = rollen(dir, "--issue", "42");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /42/);
  });
});

test("Die Hilfe nennt --issue bei roles", () => {
  mitTicket("Pruefung: 1", (dir) => {
    const res = runBoard(dir, ["--help"]);
    assert.match(res.stdout, /issue-review roles --stufe/);
    assert.match(res.stdout, /\[--issue <N>\]/);
    assert.match(res.stdout, /vorgabeQuelle/, "die Hilfe nennt auch, was --issue liefert");
  });
});
