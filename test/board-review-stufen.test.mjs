// Stufen der Pruefung: reviewStufen-Config und `issue-review roles` (Issue #278).
//
// Die Pruefung hat drei Stufen mit unterschiedlichen Blickwinkeln und unterschiedlicher
// Besetzung: fachlich und Plan je zwei Reviewer, das Arbeitspaket nur noch einen. Wer
// wie stark besetzt ist, gehoert in die Konfiguration — fest verdrahtet waere es weder
// pro Projekt anpassbar noch ablesbar.
//
// Der Kern dieser Datei ist die Kuerzung: `pickReviewers` kuerzte bisher nur im
// Regel-Zweig auf die Anzahl, der pairs-Zweig lieferte alle genannten Reviewer. Fuer die
// Stufe `issue` mit `reviewer: 1` waeren damit trotzdem zwei gelaufen — der eine
// Reviewer, um den es geht, waere stillschweigend zwei geblieben.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard, repoRoot } from "./helpers/board-fixture.mjs";
import { pickReviewers } from "../kit/board.mjs";

const OPUS = { name: "opus", kind: "claude", model: "claude-opus-5" };
const SONNET = { name: "sonnet", kind: "claude", model: "claude-sonnet-5" };
const FABLE = { name: "fable", kind: "claude", model: "claude-fable-5" };
const CODEX = { name: "codex", kind: "command", command: "codex exec --model gpt-5" };
const ALLE = [OPUS, SONNET, FABLE, CODEX];

const BASIS = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
const REVIEW = { reviewers: ALLE, pairs: { opus: ["codex", "sonnet"], sonnet: ["opus", "codex"] } };

const STUFEN = {
  fachlich: { reviewer: 2, rollen: ["form-beobachtbarkeit", "abgrenzung"] },
  plan: { reviewer: 2, rollen: ["architektur-bestand", "schnitt-abhaengigkeiten"] },
  issue: { reviewer: 1, rollen: ["pruefbarkeit"] },
};

/** Fixture mit issueReview- und (optional) reviewStufen-Block. */
function mitStufen(reviewStufen, fn, issueReview = REVIEW) {
  const config = { ...BASIS, issueReview };
  if (reviewStufen !== null) config.reviewStufen = reviewStufen;
  const dir = setupProjekt(config, "board-stufen-");
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- pickReviewers: Kuerzung auch im pairs-Zweig ---

test("pickReviewers: ein pairs-Eintrag wird auf die Anzahl gekuerzt", () => {
  // Ohne diese Kuerzung liefe die Stufe `issue` mit zwei Reviewern statt mit einem.
  const { gewaehlt, quelle, unterbesetzt } = pickReviewers(ALLE, "opus", 1, { opus: ["codex", "sonnet"] });
  assert.deepEqual(gewaehlt.map((r) => r.name), ["codex"]);
  assert.equal(quelle, "pairs");
  assert.equal(unterbesetzt, false);
});

test("pickReviewers: die Kuerzung haelt die konfigurierte Reihenfolge ein", () => {
  const { gewaehlt } = pickReviewers(ALLE, "sonnet", 1, { sonnet: ["fable", "codex"] });
  assert.deepEqual(gewaehlt.map((r) => r.name), ["fable"]);
});

// --- CLI: roles ---

test("issue-review roles: die Stufe issue laeuft mit genau einem Reviewer", () => {
  mitStufen(STUFEN, (dir) => {
    const res = runBoard(dir, ["issue-review", "roles", "--stufe", "issue", "--author", "claude-opus-5"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.stufe, "issue");
    assert.equal(out.reviewer, 1);
    assert.deepEqual(out.rollen, ["pruefbarkeit"]);
    // Der Punkt des Vorhabens: pairs.opus nennt zwei Namen, gewaehlt wird genau einer.
    assert.equal(out.gewaehlt.length, 1);
    assert.deepEqual(out.gewaehlt.map((r) => r.name), ["codex"]);
  });
});

test("issue-review roles: fachlich und plan laufen mit zwei Reviewern", () => {
  mitStufen(STUFEN, (dir) => {
    for (const [stufe, rollen] of [["fachlich", STUFEN.fachlich.rollen], ["plan", STUFEN.plan.rollen]]) {
      const out = JSON.parse(runBoard(dir, ["issue-review", "roles", "--stufe", stufe, "--author", "opus"]).stdout);
      assert.equal(out.reviewer, 2, stufe);
      assert.deepEqual(out.rollen, rollen, stufe);
      assert.equal(out.gewaehlt.length, 2, stufe);
    }
  });
});

test("issue-review roles: die Modell-ID des Autors wird aufgeloest und schliesst ihn aus", () => {
  mitStufen(STUFEN, (dir) => {
    const out = JSON.parse(runBoard(dir, ["issue-review", "roles", "--stufe", "fachlich", "--author", "claude-opus-5"]).stdout);
    assert.equal(out.autor, "claude-opus-5");
    assert.equal(out.autorAufgeloest, true);
    assert.equal(out.quelle, "pairs", "pairs.opus greift ueber die aufgeloeste Modell-ID");
    assert.ok(!out.gewaehlt.some((r) => r.name === "opus"), "der Autor darf nicht sein eigener Reviewer sein");
  });
});

test("issue-review roles: quelle bleibt die Auswahlquelle, stufenQuelle ist ein eigenes Feld", () => {
  mitStufen(STUFEN, (dir) => {
    const ausPairs = JSON.parse(runBoard(dir, ["issue-review", "roles", "--stufe", "plan", "--author", "opus"]).stdout);
    assert.equal(ausPairs.quelle, "pairs");
    assert.equal(ausPairs.stufenQuelle, "stufen");
    // fable steht nicht in pairs -> die Reihenfolge-Regel waehlt.
    const ausRegel = JSON.parse(runBoard(dir, ["issue-review", "roles", "--stufe", "plan", "--author", "fable"]).stdout);
    assert.equal(ausRegel.quelle, "regel");
    assert.equal(ausRegel.stufenQuelle, "stufen");
  });
});

test("issue-review roles: ohne reviewStufen-Block gilt fuer jede Stufe die Rueckfallebene", () => {
  // Ein Kit-Update darf keinem Bestandsprojekt den Review umbauen — dieselbe Vorsicht
  // wie bei requiredBeforeReady, das per Default aus ist.
  mitStufen(null, (dir) => {
    for (const stufe of ["fachlich", "plan", "issue"]) {
      const res = runBoard(dir, ["issue-review", "roles", "--stufe", stufe, "--author", "opus"]);
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.reviewer, 2, stufe);
      assert.deepEqual(out.rollen, ["vollstaendigkeit-pruefbarkeit", "scope-risiko-bestand"], stufe);
      assert.equal(out.stufenQuelle, "default", stufe);
      assert.equal(out.gewaehlt.length, 2, stufe);
    }
  });
});

test("issue-review roles: eine unbekannte Stufe bricht ab", () => {
  mitStufen(STUFEN, (dir) => {
    const res = runBoard(dir, ["issue-review", "roles", "--stufe", "unbekannt", "--author", "opus"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /unbekannt/);
  });
});

test("issue-review roles: --stufe ohne Wert und ohne Option brechen ab", () => {
  mitStufen(STUFEN, (dir) => {
    const ohneWert = runBoard(dir, ["issue-review", "roles", "--stufe", "--author", "opus"]);
    assert.notEqual(ohneWert.status, 0);
    assert.match(ohneWert.stderr, /--stufe/);
    const ohneOption = runBoard(dir, ["issue-review", "roles", "--author", "opus"]);
    assert.notEqual(ohneOption.status, 0);
    assert.match(ohneOption.stderr, /--stufe/);
  });
});

test("issue-review roles: --author ist verpflichtend", () => {
  // pickReviewers braucht den Autor fuer pairs und fuer den Selbstausschluss; ohne ihn
  // koennte das Kommando genau das nicht leisten, wofuer es da ist.
  mitStufen(STUFEN, (dir) => {
    const ohneOption = runBoard(dir, ["issue-review", "roles", "--stufe", "issue"]);
    assert.notEqual(ohneOption.status, 0);
    assert.match(ohneOption.stderr, /--author/);
    const ohneWert = runBoard(dir, ["issue-review", "roles", "--stufe", "issue", "--author"]);
    assert.notEqual(ohneWert.status, 0);
    assert.match(ohneWert.stderr, /--author/);
  });
});

// --- Validierung des Config-Blocks ---
//
// Hart wie im uebrigen Config-Bereich: validateReviewers und validatePairs brechen bei
// Tippfehlern ab, weil ein stiller Skip einen Tippfehler in einen unsichtbaren
// Ein-Reviewer-Lauf verwandelt. Fuer die Stufenbesetzung gilt dasselbe.

test("reviewStufen: rollen.length ungleich reviewer bricht mit genau dieser Meldung ab", () => {
  const kaputt = { ...STUFEN, issue: { reviewer: 1, rollen: ["pruefbarkeit", "zuviel"] } };
  mitStufen(kaputt, (dir) => {
    const res = runBoard(dir, ["issue-review", "roles", "--stufe", "issue", "--author", "opus"]);
    assert.equal(res.status, 1);
    assert.ok(
      res.stderr.includes("reviewStufen.issue: rollen.length (2) stimmt nicht mit reviewer (1) ueberein."),
      `unerwartete Meldung: ${res.stderr}`,
    );
    assert.equal(res.stdout, "", "im Fehlerfall darf kein JSON auf stdout stehen");
  });
});

for (const [was, stufe] of [
  ["reviewer: 0", { reviewer: 0, rollen: [] }],
  ["negativem reviewer", { reviewer: -1, rollen: ["a"] }],
  ["nicht ganzzahligem reviewer", { reviewer: 1.5, rollen: ["a"] }],
  ["reviewer als Text", { reviewer: "2", rollen: ["a", "b"] }],
  ["fehlendem reviewer", { rollen: ["a", "b"] }],
  ["rollen als Nicht-Array", { reviewer: 1, rollen: "pruefbarkeit" }],
  ["fehlenden rollen", { reviewer: 1 }],
  ["leerem Rollennamen", { reviewer: 2, rollen: ["a", ""] }],
  ["doppeltem Rollennamen", { reviewer: 2, rollen: ["a", "a"] }],
  ["Rollenname als Nicht-Text", { reviewer: 1, rollen: [7] }],
]) {
  test(`reviewStufen: Stufe mit ${was} bricht mit Config-Pfad ab`, () => {
    mitStufen({ ...STUFEN, issue: stufe }, (dir) => {
      const res = runBoard(dir, ["issue-review", "roles", "--stufe", "issue", "--author", "opus"]);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /reviewStufen\.issue/);
      assert.equal(res.stdout, "");
    });
  });
}

test("reviewStufen: eine fehlende Stufe im vorhandenen Block bricht ab", () => {
  // Defaults greifen ausschliesslich, wenn der GESAMTE Block fehlt — sonst waere ein
  // vergessener Eintrag von einer bewussten Rueckfallebene nicht zu unterscheiden.
  const { issue, ...ohneIssue } = STUFEN;
  mitStufen(ohneIssue, (dir) => {
    const res = runBoard(dir, ["issue-review", "roles", "--stufe", "fachlich", "--author", "opus"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /reviewStufen\.issue/);
  });
});

test("reviewStufen: ein Block, der kein Objekt ist, bricht ab", () => {
  mitStufen(["fachlich"], (dir) => {
    const res = runBoard(dir, ["issue-review", "roles", "--stufe", "fachlich", "--author", "opus"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /reviewStufen/);
  });
});

// --- Bestandsverhalten ---

test("issue-review reviewers, check und matrix laufen mit reviewStufen unveraendert", () => {
  mitStufen(STUFEN, (dir) => {
    const reviewers = JSON.parse(runBoard(dir, ["issue-review", "reviewers", "--author", "opus"]).stdout);
    assert.deepEqual(reviewers.gewaehlt.map((r) => r.name), ["codex", "sonnet"]);
    assert.equal(reviewers.quelle, "pairs");
    assert.equal(reviewers.stufenQuelle, undefined, "reviewers kennt keine Stufen");

    const check = JSON.parse(runBoard(dir, ["issue-review", "check", "--nur-pfad"]).stdout);
    assert.equal(check.reviewers.length, 4);

    const { matrix } = JSON.parse(runBoard(dir, ["issue-review", "matrix"]).stdout);
    assert.deepEqual(matrix.find((m) => m.autor === "opus").reviewer, ["codex", "sonnet"]);
  });
});

// --- Hilfe und Kopfkommentar ---

const SYNTAX = "issue-review roles --stufe <fachlich|plan|issue> --author <modell>";

test("Die Hilfe nennt die volle Syntax von issue-review roles", () => {
  mitStufen(STUFEN, (dir) => {
    const res = runBoard(dir, ["--help"]);
    assert.ok(res.stdout.includes(SYNTAX), `Syntax fehlt in der Hilfe:\n${res.stdout}`);
  });
});

test("Der Kopfkommentar von board.mjs nennt dieselbe Syntax", () => {
  // Wer die Datei oeffnet, liest den Kopf — driftet er, beschreibt die Datei ein
  // Kommando, das es nicht gibt, oder verschweigt eines, das es gibt.
  const kopf = readFileSync(join(repoRoot, "kit", "board.mjs"), "utf-8").split("*/")[0];
  assert.ok(kopf.includes(SYNTAX), "Syntax fehlt im Kopfkommentar von kit/board.mjs");
});

// --- Ausschlussliste und die Rolle synthese (Issue #597) ---
//
// Kriterium 7 aus Issue #587 verlangt fuer die Synthese-Pruefung ein Modell, das weder
// das Dokument geschrieben noch eine der Befundlisten erstellt hat — auf der Stufe
// `plan` sind das drei Namen. `pickReviewers` konnte bisher genau einen ausschliessen,
// den Autor. Und der pairs-Zweig konnte es gar nicht: Er begrenzt die Kandidatenmenge
// auf die genannten Namen, und in diesem Projekt sind das fuer `opus` ausgerechnet die
// beiden, die auf der Stufe `plan` gerade geprueft haben.
//
// Deshalb eine eigene Fixture mit den fuenf Reviewern und den Paaren dieses Projekts:
// Die Bestandsfixture oben kennt weder `gpt-astra` noch `gpt-sol`, und an ihr liesse
// sich der Fall, um den es geht, nicht nachstellen.

const P_OPUS = { name: "opus", kind: "claude", model: "claude-opus-5" };
const P_SONNET = { name: "sonnet", kind: "claude", model: "claude-sonnet-5" };
const P_FABLE = { name: "fable", kind: "claude", model: "claude-fable-5.1" };
const P_ASTRA = { name: "gpt-astra", kind: "command", model: "gpt-6-astra", command: "codex exec --model gpt-6-astra" };
const P_SOL = { name: "gpt-sol", kind: "command", model: "gpt-5.6-sol", command: "codex exec --model gpt-5.6-sol" };

const PROJEKT_ALLE = [P_OPUS, P_SONNET, P_FABLE, P_ASTRA, P_SOL];
const PROJEKT_PAARE = {
  opus: ["fable", "gpt-astra"],
  sonnet: ["opus", "gpt-sol"],
  fable: ["opus", "gpt-astra"],
  "gpt-sol": ["fable", "gpt-astra"],
  "gpt-astra": ["fable", "opus"],
};
const PROJEKT_REVIEW = { reviewers: PROJEKT_ALLE, pairs: PROJEKT_PAARE };

/** Die Besetzung, in der es kein unbeteiligtes Modell mehr gibt. */
const ZWEI_REVIEW = { reviewers: [P_FABLE, P_ASTRA], pairs: {} };

const rollenCli = (dir, ...extra) =>
  runBoard(dir, ["issue-review", "roles", "--stufe", "plan", "--author", "claude-opus-5", ...extra]);

/** Wie mitStufen, legt zusaetzlich ein Ticket 0001 fuer den `--issue`-Pfad an. */
function mitTicket(reviewStufen, fn, issueReview = PROJEKT_REVIEW) {
  mitStufen(reviewStufen, (dir) => {
    mkdirSync(join(dir, "issues"), { recursive: true });
    const kopf = `---\nid: "0001"\ntype: task\nstatus: ready\ntitle: Ticket\ncreated: 2026-08-12\n---\n`;
    writeFileSync(join(dir, "issues", "0001.md"), `${kopf}\n## Kontext\n\nA\n\n## Aufgabe\n\nB\n`, "utf-8");
    fn(dir);
  }, issueReview);
}

test("[board-4] pickReviewers: der pairs-Zweig wird um die Ausschlussliste gekuerzt", () => {
  const { gewaehlt, quelle, unterbesetzt } = pickReviewers(PROJEKT_ALLE, "opus", 1, PROJEKT_PAARE, ["fable"]);
  assert.deepEqual(gewaehlt.map((r) => r.name), ["gpt-astra"]);
  assert.equal(quelle, "pairs");
  assert.equal(unterbesetzt, false);
});

test("[board-4] pickReviewers: ein leergefilterter pairs-Eintrag faellt auf die Regel zurueck", () => {
  // Praezedenzfall ist der von vornherein leere Eintrag: Auch dort greift die Regel.
  const { gewaehlt, quelle } = pickReviewers(PROJEKT_ALLE, "opus", 1, PROJEKT_PAARE, ["fable", "gpt-astra"]);
  assert.deepEqual(gewaehlt.map((r) => r.name), ["sonnet"]);
  assert.equal(quelle, "regel");
  for (const raus of ["opus", "fable", "gpt-astra"]) {
    assert.ok(!gewaehlt.some((r) => r.name === raus), `${raus} haette nicht gewaehlt werden duerfen`);
  }
});

test("[board-4] pickReviewers: ein gekuerzter pairs-Eintrag wird nicht aufgefuellt", () => {
  // Die Paartabelle bleibt die abschliessende Auswahl — wer sie setzt, bekommt keine
  // ungefragten Zusaetze aus dem Regel-Zweig, sondern eine sichtbare Unterbesetzung.
  const { gewaehlt, quelle, unterbesetzt } = pickReviewers(PROJEKT_ALLE, "opus", 2, PROJEKT_PAARE, ["fable"]);
  assert.deepEqual(gewaehlt.map((r) => r.name), ["gpt-astra"]);
  assert.equal(quelle, "pairs");
  assert.equal(unterbesetzt, true);
});

test("[board-4] issue-review roles --rolle synthese: der Ausschluss wirkt an der Projekt-Fixture", () => {
  mitStufen(STUFEN, (dir) => {
    const res = rollenCli(dir, "--rolle", "synthese", "--ausschluss", "fable,gpt-astra");
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.reviewer, 1);
    assert.deepEqual(out.rollen, ["synthese"]);
    assert.deepEqual(out.gewaehlt.map((r) => r.name), ["sonnet"]);
    assert.equal(out.quelle, "regel");
    assert.equal(out.entfall, false);
    assert.deepEqual(out.ausschlussUnbekannt, []);
    assert.ok(!out.gewaehlt.some((r) => r.name === "opus"), "der Autor kommt nicht vor");
  }, PROJEKT_REVIEW);
});

test("[board-4] issue-review roles --rolle synthese: ohne unbeteiligtes Modell entfaellt die Pruefung", () => {
  mitStufen(STUFEN, (dir) => {
    const res = rollenCli(dir, "--rolle", "synthese", "--ausschluss", "fable,gpt-astra");
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out.gewaehlt, []);
    assert.equal(out.unterbesetzt, true);
    assert.equal(out.entfall, true);
    assert.equal(out.autorAufgeloest, false, "claude-opus-5 steht in dieser Besetzung nicht");
  }, ZWEI_REVIEW);
});

test("[board-4] --ausschluss nimmt die Modell-ID genauso wie den Kurznamen", () => {
  mitStufen(STUFEN, (dir) => {
    const out = JSON.parse(rollenCli(dir, "--rolle", "synthese", "--ausschluss", "claude-fable-5.1,gpt-astra").stdout);
    assert.ok(!out.gewaehlt.some((r) => r.name === "fable"));
    assert.deepEqual(out.gewaehlt.map((r) => r.name), ["sonnet"]);
    assert.deepEqual(out.ausschlussUnbekannt, []);
  }, PROJEKT_REVIEW);
});

test("[board-4] ein unbekannter Ausschlussname wird uebergangen, nicht abgebrochen", () => {
  // Das Session-Modell kommt aus `night.mjs --model <id>` und ist frei waehlbar. Ein
  // Abbruch dafuer liesse die Synthese-Pruefung in jedem Dokument ausfallen; still
  // verschwinden darf der Name aber auch nicht.
  mitStufen(STUFEN, (dir) => {
    const res = rollenCli(dir, "--rolle", "synthese", "--ausschluss", "fable,fable, ,claude-nightly-9");
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out.ausschlussUnbekannt, ["claude-nightly-9"]);
    assert.deepEqual(out.gewaehlt.map((r) => r.name), ["gpt-astra"]);
  }, PROJEKT_REVIEW);
});

test("[board-4] --rolle synthese liefert fest einen Reviewer — mit und ohne reviewStufen-Block", () => {
  for (const block of [STUFEN, null]) {
    mitStufen(block, (dir) => {
      const res = rollenCli(dir, "--rolle", "synthese");
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.reviewer, 1, "die Stufe plan besetzt sonst zwei");
      assert.deepEqual(out.rollen, ["synthese"]);
      assert.equal(out.stufe, "plan");
      assert.equal(out.stufenQuelle, block ? "stufen" : "default", "stufenQuelle bleibt erhalten");
      assert.equal(out.gewaehlt.length, 1);
    }, PROJEKT_REVIEW);
  }
});

test("[board-4] --rolle synthese mit --issue liefert die Pruefvorgabe weiterhin mit", () => {
  mitTicket(STUFEN, (dir) => {
    const res = rollenCli(dir, "--rolle", "synthese", "--issue", "1");
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.reviewer, 1);
    assert.deepEqual(out.rollen, ["synthese"]);
    assert.equal(out.vorgabeQuelle, "config");
    assert.equal(out.verzicht, false);
  });
});

test("[board-4] --rolle synthese hebt die Validierung des reviewStufen-Blocks nicht auf", () => {
  const kaputt = { ...STUFEN, issue: { reviewer: 1, rollen: ["pruefbarkeit", "zuviel"] } };
  mitStufen(kaputt, (dir) => {
    const res = rollenCli(dir, "--rolle", "synthese");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /reviewStufen\.issue/);
    assert.equal(res.stdout, "");
  }, PROJEKT_REVIEW);
});

test("[board-4] ohne --rolle bleibt die Feldmenge der Antwort unveraendert", () => {
  // Die neuen Felder sind an die Rolle gebunden: Wer sie nicht anfordert, bekommt
  // exakt die Antwort von vorher — sonst muesste jeder Leser raten, was `entfall`
  // ausserhalb der Synthese-Pruefung bedeuten soll.
  mitStufen(STUFEN, (dir) => {
    const out = JSON.parse(rollenCli(dir).stdout);
    assert.deepEqual(Object.keys(out).sort(), [
      "autor", "autorAufgeloest", "gewaehlt", "quelle", "reviewer", "rollen",
      "runden", "stufe", "stufenQuelle", "unterbesetzt", "verzicht", "vorgabeQuelle",
    ]);
  }, PROJEKT_REVIEW);
});

test("[board-4] --rolle ohne Wert und --rolle mit fremdem Wert brechen ab", () => {
  mitStufen(STUFEN, (dir) => {
    const ohneWert = rollenCli(dir, "--rolle");
    assert.notEqual(ohneWert.status, 0);
    assert.match(ohneWert.stderr, /--rolle: erwartet 'synthese'/);
    const fremd = rollenCli(dir, "--rolle", "abgrenzung");
    assert.notEqual(fremd.status, 0);
    assert.match(fremd.stderr, /--rolle: erwartet 'synthese', ist 'abgrenzung'/);
  }, PROJEKT_REVIEW);
});

test("[board-4] --ausschluss ohne --rolle synthese und ohne Wert brechen ab", () => {
  mitStufen(STUFEN, (dir) => {
    const ohneRolle = rollenCli(dir, "--ausschluss", "fable");
    assert.notEqual(ohneRolle.status, 0);
    assert.match(ohneRolle.stderr, /--ausschluss gilt nur mit --rolle synthese/);
    const ohneWert = rollenCli(dir, "--rolle", "synthese", "--ausschluss");
    assert.notEqual(ohneWert.status, 0);
    assert.match(ohneWert.stderr, /--ausschluss/);
  }, PROJEKT_REVIEW);
});

const SYNTAX_ROLLE = "[--rolle synthese] [--ausschluss <name,...>]";

test("[board-4] Die Hilfe nennt --rolle und --ausschluss als Folgezeile hinter [--issue <N>]", () => {
  mitStufen(STUFEN, (dir) => {
    const res = runBoard(dir, ["--help"]);
    const zeilen = res.stdout.split("\n");
    const i = zeilen.findIndex((z) => z.includes("[--issue <N>]"));
    assert.ok(i >= 0, `[--issue <N>] fehlt in der Hilfe:\n${res.stdout}`);
    assert.ok(zeilen[i + 1].includes(SYNTAX_ROLLE), `Folgezeile fehlt, gefunden: ${zeilen[i + 1]}`);
    assert.ok(res.stdout.includes(SYNTAX), "die Bestands-Syntaxzeile bleibt woertlich unveraendert");
  });
});

test("[board-4] Der Kopfkommentar nennt dieselbe Folgezeile", () => {
  const kopf = readFileSync(join(repoRoot, "kit", "board.mjs"), "utf-8").split("*/")[0];
  assert.ok(kopf.includes(SYNTAX_ROLLE), "Folgezeile fehlt im Kopfkommentar von kit/board.mjs");
});
