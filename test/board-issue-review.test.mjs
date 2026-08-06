// Reviewer-Auswahl und Verfuegbarkeits-Check der issue-review-Achse (Issue #220).
//
// Der Autor eines Issues hat den Kontext im Kopf, aus dem es entstanden ist; was er
// nicht hingeschrieben hat, faellt ihm beim Lesen nicht auf. Deshalb prueft nie das
// Modell, das geschrieben hat — darauf beruht das ganze Verfahren, und `pickReviewers`
// ist die Stelle, an der es durchgesetzt wird.
//
// Reviewer koennen Claude-Subagenten oder fremde CLIs sein. Der Verfuegbarkeits-Check
// unterscheidet beides: Ein Claude-Reviewer laeuft immer, ein Kommando nur, wenn sein
// erstes Wort im PATH liegt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";
import { pickReviewers } from "../kit/board.mjs";

const OPUS = { name: "opus", kind: "claude", model: "claude-opus-5" };
const SONNET = { name: "sonnet", kind: "claude", model: "claude-sonnet-5" };
const FABLE = { name: "fable", kind: "claude", model: "claude-fable-5" };
const CODEX = { name: "codex", kind: "command", command: "codex exec --model gpt-5" };
const ALLE = [OPUS, SONNET, FABLE, CODEX];

const BASIS = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

// --- pickReviewers ---

test("pickReviewers: der Autor wird nie ausgewaehlt", () => {
  const { gewaehlt } = pickReviewers(ALLE, "opus");
  assert.equal(gewaehlt.length, 2);
  assert.ok(!gewaehlt.some((r) => r.name === "opus"), "der Autor darf nicht sein eigener Reviewer sein");
  assert.deepEqual(gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
});

test("pickReviewers: die Reihenfolge der Config bestimmt die Paarung", () => {
  // So laesst sich eine feste Paarung erzwingen, ohne eine Matrix zu pflegen.
  const umsortiert = [CODEX, FABLE, SONNET, OPUS];
  assert.deepEqual(pickReviewers(umsortiert, "sonnet").gewaehlt.map((r) => r.name), ["codex", "fable"]);
});

test("pickReviewers: unbekannter Autor nimmt die ersten zwei", () => {
  // Aeltere Issues ohne Autor-Modell-Zeile, oder ein Mensch als Autor.
  const { gewaehlt, unterbesetzt } = pickReviewers(ALLE, "unbekannt");
  assert.deepEqual(gewaehlt.map((r) => r.name), ["opus", "sonnet"]);
  assert.equal(unterbesetzt, false);
});

test("pickReviewers: zu wenige Kandidaten melden unterbesetzt", () => {
  // Kein Fehler: Der Skill entscheidet, ob er damit faehrt — muss es aber sichtbar machen.
  const { gewaehlt, unterbesetzt } = pickReviewers([OPUS, SONNET], "opus");
  assert.deepEqual(gewaehlt.map((r) => r.name), ["sonnet"]);
  assert.equal(unterbesetzt, true);
});

test("pickReviewers: leere Liste ergibt keine Reviewer", () => {
  const { gewaehlt, unterbesetzt } = pickReviewers([], "opus");
  assert.deepEqual(gewaehlt, []);
  assert.equal(unterbesetzt, true);
});

test("pickReviewers: die Anzahl ist einstellbar", () => {
  assert.equal(pickReviewers(ALLE, "opus", 3).gewaehlt.length, 3);
  assert.equal(pickReviewers(ALLE, "opus", 1).gewaehlt.length, 1);
});

// --- CLI: reviewers ---

/** Fixture mit issueReview-Block; `reviewers` darf auch Rohtext sein. */
function mitReview(issueReview, fn) {
  const dir = setupProjekt(issueReview === null ? BASIS : { ...BASIS, issueReview }, "board-ireview-");
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("issue-review reviewers gibt zwei Reviewer ohne den Autor", () => {
  mitReview({ reviewers: ALLE }, (dir) => {
    const res = runBoard(dir, ["issue-review", "reviewers", "--author", "opus"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.autor, "opus");
    assert.deepEqual(out.gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
    assert.equal(out.unterbesetzt, false);
    assert.equal(out.rounds, 1, "Default ist eine Runde");
  });
});

test("issue-review reviewers: konfigurierte rounds gewinnen", () => {
  mitReview({ rounds: 2, reviewers: ALLE }, (dir) => {
    const out = JSON.parse(runBoard(dir, ["issue-review", "reviewers", "--author", "opus"]).stdout);
    assert.equal(out.rounds, 2);
  });
});

test("issue-review reviewers: fehlender issueReview-Block ist kein Fehler", () => {
  mitReview(null, (dir) => {
    const res = runBoard(dir, ["issue-review", "reviewers", "--author", "opus"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out.gewaehlt, []);
    assert.equal(out.unterbesetzt, true);
  });
});

test("issue-review reviewers: --author ohne Wert bricht mit Meldung ab", () => {
  mitReview({ reviewers: ALLE }, (dir) => {
    const res = runBoard(dir, ["issue-review", "reviewers", "--author"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /--author/);
  });
});

// --- CLI: check ---

// POSIX-only (Issue #230): Die Datei hat keine Endung und traegt ihre Ausfuehrbarkeit
// im Shebang und im Modus. Unter Windows ist beides wirkungslos — dort entscheidet die
// Endung (.cmd/.bat/.exe), ob etwas startbar ist. Wer diesen Helfer in einen neuen Test
// einbaut, muss ihn dort ueberspringen (NUR_POSIX), sonst sucht er denselben Fehler
// noch einmal.
const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Das Fake-Binary ist eine endungslose Datei mit Shebang; startbar sind dort nur .cmd/.bat/.exe. Siehe Issue #197 und #231." }
  : {};

/** Legt ein ausfuehrbares Fake-Binary ohne Grammatik-Bindung im Fixture-PATH an. */
function fakeBinary(dir, name) {
  const binDir = join(dir, "fakebin");
  mkdirSync(binDir, { recursive: true });
  const pfad = join(binDir, name);
  writeFileSync(pfad, "#!/bin/sh\nexit 0\n");
  chmodSync(pfad, 0o755);
}

test("issue-review check: claude-Reviewer gelten immer als verfuegbar", () => {
  mitReview({ reviewers: [OPUS, SONNET] }, (dir) => {
    const out = JSON.parse(runBoard(dir, ["issue-review", "check"]).stdout);
    assert.equal(out.alleVerfuegbar, true);
    assert.ok(out.reviewers.every((r) => r.verfuegbar));
  });
});

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

test("issue-review check: vorhandenes Kommando gilt als verfuegbar", NUR_POSIX, () => {
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "meinfake --flag" }] }, (dir) => {
    fakeBinary(dir, "meinfake");
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.alleVerfuegbar, true);
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

// --- pairs: explizite Zuordnung (Issue #225) ---
//
// Die Regel allein waehlt immer die vordersten Eintraege: Bei vier Reviewern kam der
// vierte nie zum Zug — ausgerechnet das Modell aus dem fremden Haus, dessen Wert darin
// liegt, die blinden Flecken der Familie NICHT zu teilen. pairs macht die Zuordnung
// ablesbar statt errechenbar.

const PAARE = { opus: ["codex", "sonnet"], sonnet: ["opus", "codex"] };

test("pickReviewers: ein pairs-Eintrag gewinnt ueber die Regel", () => {
  const { gewaehlt, quelle } = pickReviewers(ALLE, "opus", 2, PAARE);
  assert.deepEqual(gewaehlt.map((r) => r.name), ["codex", "sonnet"]);
  assert.equal(quelle, "pairs");
});

test("pickReviewers: die Reihenfolge im pairs-Eintrag wird eingehalten", () => {
  assert.deepEqual(
    pickReviewers(ALLE, "sonnet", 2, PAARE).gewaehlt.map((r) => r.name),
    ["opus", "codex"]
  );
});

test("pickReviewers: fehlt der Autor in pairs, greift die Regel", () => {
  const { gewaehlt, quelle } = pickReviewers(ALLE, "fable", 2, PAARE);
  assert.deepEqual(gewaehlt.map((r) => r.name), ["opus", "sonnet"]);
  assert.equal(quelle, "regel");
});

test("pickReviewers: ohne pairs bleibt das Verhalten wie vorher", () => {
  // Regressionsschutz — die Regel darf sich durch das neue Feld nicht aendern.
  const ohne = pickReviewers(ALLE, "opus");
  assert.deepEqual(ohne.gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
  assert.equal(ohne.quelle, "regel");
  assert.deepEqual(pickReviewers(ALLE, "opus", 2, {}).gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
});

test("pickReviewers: ein leerer pairs-Eintrag faellt auf die Regel zurueck", () => {
  assert.equal(pickReviewers(ALLE, "opus", 2, { opus: [] }).quelle, "regel");
});

// --- CLI: pairs und Validierung ---

test("issue-review reviewers nennt die Quelle der Auswahl", () => {
  mitReview({ reviewers: ALLE, pairs: PAARE }, (dir) => {
    const out = JSON.parse(runBoard(dir, ["issue-review", "reviewers", "--author", "opus"]).stdout);
    assert.deepEqual(out.gewaehlt.map((r) => r.name), ["codex", "sonnet"]);
    assert.equal(out.quelle, "pairs");
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

// --- CLI: matrix ---

test("issue-review matrix listet jeden bekannten Autor mit Quelle", () => {
  mitReview({ reviewers: ALLE, pairs: PAARE }, (dir) => {
    const res = runBoard(dir, ["issue-review", "matrix"]);
    assert.equal(res.status, 0, res.stderr);
    const { matrix } = JSON.parse(res.stdout);
    const zeile = (name) => matrix.find((m) => m.autor === name);

    assert.deepEqual(zeile("opus").reviewer, ["codex", "sonnet"]);
    assert.equal(zeile("opus").quelle, "pairs");
    assert.deepEqual(zeile("fable").reviewer, ["opus", "sonnet"]);
    assert.equal(zeile("fable").quelle, "regel");
    assert.deepEqual(matrix.map((m) => m.autor).sort(), ["codex", "fable", "opus", "sonnet"]);
  });
});

test("issue-review matrix nimmt auch Autoren auf, die nur in pairs stehen", () => {
  // haiku ist kein Reviewer, kann aber Issues schreiben.
  mitReview({ reviewers: ALLE, pairs: { haiku: ["sonnet", "opus"] } }, (dir) => {
    const { matrix } = JSON.parse(runBoard(dir, ["issue-review", "matrix"]).stdout);
    const haiku = matrix.find((m) => m.autor === "haiku");
    assert.deepEqual(haiku.reviewer, ["sonnet", "opus"]);
    assert.equal(haiku.quelle, "pairs");
  });
});
