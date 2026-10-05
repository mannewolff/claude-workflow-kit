// Ablauf-Pruefung: Die Fehlerwege brechen ueber fail() mit Exit 1 ab, und der Verfuegbarkeits-Check soll einmal echt durch PATH-Suche, Ausfuehrbar-Bit und Probelauf ueber stdin laufen; beides belegt nur ein gestartetes kit/board.mjs.
//
// Die issue-review-Achse ueber die CLI (Issue #220, umgestellt mit Issue #1221). Auswahl,
// Antworten der Befehle und jeder Ausgang des Probelaufs stehen im selben Prozess in
// `test/board-issue-review-*.test.mjs`; hier bleibt, was einen Prozess braucht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync, mkdirSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard, cmdAttrappe } from "./helpers/board-fixture.mjs";

const OPUS = { name: "opus", kind: "claude", model: "claude-opus-5" };
const SONNET = { name: "sonnet", kind: "claude", model: "claude-sonnet-5" };
const FABLE = { name: "fable", kind: "claude", model: "claude-fable-5" };
const CODEX = { name: "codex", kind: "command", command: "codex exec --model gpt-5" };
const ALLE = [OPUS, SONNET, FABLE, CODEX];

const BASIS = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

/** Fixture mit issueReview-Block; `reviewers` darf auch Rohtext sein. */
function mitReview(issueReview, fn) {
  const dir = setupProjekt(issueReview === null ? BASIS : { ...BASIS, issueReview }, "board-ireview-");
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("issue-review reviewers: --author ohne Wert bricht mit Meldung ab", () => {
  mitReview({ reviewers: ALLE }, (dir) => {
    const res = runBoard(dir, ["issue-review", "reviewers", "--author"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /--author/);
  });
});

/**
 * Legt ein Fake-Binary ohne Grammatik-Bindung im Fixture-PATH an.
 *
 * `rumpf` ersetzt den Standard-Rumpf (`exit 0`) — der Probelauf aus Issue #262
 * braucht Kommandos, die scheitern, haengen oder stdin mitschreiben.
 *
 * Startbar ist ein Fake auf POSIX ueber das X-Bit, unter Windows ueber die `.cmd`-Attrappe
 * daneben (Issue #1135, E8). Darum bekommt nur ein ausfuehrbarer Modus die Attrappe: Ein
 * nur lesbares Fake ist dann auf beiden Plattformen kein Kommando.
 */
function fakeBinary(dir, name, modus = 0o755, rumpf = "exit 0") {
  const binDir = join(dir, "fakebin");
  mkdirSync(binDir, { recursive: true });
  const pfad = join(binDir, name);
  writeFileSync(pfad, `#!/bin/sh\n${rumpf}\n`);
  chmodSync(pfad, modus);
  if (modus & 0o111) cmdAttrappe(pfad);
}

test("issue-review check: fehlendes Kommando wird mit Grund gemeldet, Exit bleibt 0", () => {
  // check ist eine Auskunft, kein Gate — wer daraus ein Gate macht, ist der Skill.
  //
  // Bewusst ein Fantasiename statt 'codex': Auf einem Rechner, auf dem das echte CLI
  // installiert ist, wuerde der Test sonst gruen behaupten, was er nicht geprueft hat
  // (genau so ist er beim Bauen einmal umgekippt).
  const fehlt = { name: "gibtsnicht", kind: "command", command: "gibtsnicht-xyz --flag" };
  mitReview({ reviewers: [OPUS, fehlt] }, (dir) => {
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.alleVerfuegbar, false);
    const eintrag = out.reviewers.find((r) => r.name === "gibtsnicht");
    assert.equal(eintrag.verfuegbar, false);
    assert.match(eintrag.grund, /gibtsnicht-xyz/);
  });
});

test("issue-review check: vorhandenes Kommando gilt als verfuegbar", () => {
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "meinfake --flag" }] }, (dir) => {
    fakeBinary(dir, "meinfake");
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.alleVerfuegbar, true);
  });
});

test("issue-review check: eine nicht ausfuehrbare Datei gilt nicht als Kommando", () => {
  // Deckt den echten accessSync-Pfad ab (Issue #231): Die Datei liegt im PATH, ist
  // aber nur lesbar. Der fruehere Prozessstart fing das implizit ab.
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "nurlesbar --flag" }] }, (dir) => {
    fakeBinary(dir, "nurlesbar", 0o644);
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.alleVerfuegbar, false);
    assert.match(out.reviewers[0].grund, /nurlesbar/);
    // Ein Kommando, das gar nicht startbar ist, bekommt keinen Probelauf.
    assert.equal(out.reviewers[0].geprueft, "pfad");
  });
});

test("issue-review check: der Probeprompt erreicht das Kommando ueber stdin", () => {
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "liest --flag" }] }, (dir) => {
    const mitschrift = join(dir, "stdin.txt");
    fakeBinary(dir, "liest", 0o755, `cat > ${JSON.stringify(mitschrift)}\nexit 0`);
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(existsSync(mitschrift), "das Kommando hat nichts auf stdin bekommen");
    // Exakt, nicht nur nicht-leer: Seit es mit KIT_PROBE_PROMPT einen Weg gibt, den
    // Prompt zu ersetzen, muss belegt sein, dass er ohne die Variable unveraendert
    // bleibt. `length > 0` haette auch ein versehentlich ueberschriebener Prompt
    // erfuellt (Issue #393).
    assert.equal(readFileSync(mitschrift, "utf-8"), "Antworte nur mit dem Wort OK.\n");
  });
});

// --- Validierung ---
//
// Eine halb ausgefuellte Reviewer-Definition still zu ueberspringen wuerde einen
// Tippfehler in einen unsichtbaren Ein-Reviewer-Lauf verwandeln.

for (const [was, reviewer] of [
  ["fehlendem name", { kind: "claude", model: "x" }],
  ["unbekanntem kind", { name: "x", kind: "zauberei" }],
  ["command ohne command-Feld", { name: "x", kind: "command" }],
  ["claude ohne model", { name: "x", kind: "claude" }],
]) {
  test(`issue-review: Reviewer mit ${was} bricht mit Meldung ab`, () => {
    mitReview({ reviewers: [reviewer] }, (dir) => {
      const res = runBoard(dir, ["issue-review", "check"]);
      assert.notEqual(res.status, 0, "eine kaputte Definition darf nicht still durchgehen");
      assert.match(res.stderr, /issueReview/);
    });
  });
}

test("Die Hilfe nennt die issue-review-Achse", () => {
  mitReview({ reviewers: ALLE }, (dir) => {
    const res = runBoard(dir, ["--help"]);
    assert.match(res.stdout, /issue-review reviewers/);
    assert.match(res.stdout, /issue-review check/);
  });
});

test("Unbekannte Achse nennt issue | code | kontext | issue-review", () => {
  mitReview(null, (dir) => {
    const res = runBoard(dir, ["quatsch", "irgendwas"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /issue-review/);
  });
});

test("Unbekannter issue-review-Befehl: Hilfe plus Fehlermeldung", () => {
  mitReview({ reviewers: ALLE }, (dir) => {
    const res = runBoard(dir, ["issue-review", "quatsch"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /quatsch/);
  });
});

test("issue-review: ein pairs-Eintrag mit unbekanntem Namen bricht ab", () => {
  // Ein Tippfehler wuerde sonst zu einem unsichtbaren Ein-Reviewer-Lauf.
  mitReview({ reviewers: ALLE, pairs: { opus: ["sonett", "fable"] } }, (dir) => {
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /sonett/);
  });
});

test("issue-review: ein Autor, der sich selbst nennt, bricht ab", () => {
  // Das hebelt den Zweck des Verfahrens aus und gehoert beim Schreiben bemerkt.
  mitReview({ reviewers: ALLE, pairs: { opus: ["opus", "sonnet"] } }, (dir) => {
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /opus/);
  });
});
