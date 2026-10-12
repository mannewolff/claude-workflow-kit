// Ablauf-Pruefung: Verteiler und Optionsnamen bildet erst der gestartete Einstieg kit/board.mjs ab;
// dass `issue questions --compare` und `issue run-state --state running` wirken wie die deutschen
// Namen, zeigt nur der Prozess.
//
// Englische Namen fuer `issue fragen`, `--vergleich` und die Auswahlwerte von `--art`, `--zustand`
// und `issue-review roles --stufe` (Issue #1555, Plan #1548 E1, E5, E8). Die deutschen gelten in
// diesem Paket noch. Je Paar laufen der deutsche und der englische Aufruf in je einem frischen
// Projekt und liefern dasselbe — Exitcode, stdout, stderr und die Karten danach. Die reinen
// Abbildungen (`internerWert`, `titelMitArt`, `issueReviewRoles`) pruefen die Faelle im selben
// Prozess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";
import { BEFEHLSNAMEN, internerWert } from "../kit/board/namen.mjs";
import { titelMitArt, ARTEN } from "../kit/board/dokumente.mjs";
import { issueReviewRoles } from "../kit/board/issue-review.mjs";

const REVIEWERS = [
  { name: "opus", kind: "claude", model: "claude-opus-5" },
  { name: "sonnet", kind: "claude", model: "claude-sonnet-5" },
  { name: "fable", kind: "claude", model: "claude-fable-5.1" },
];
const LOKAL = {
  codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" },
  issueReview: { reviewers: REVIEWERS },
};
// Mit Aufsicht: Die Fixture setzt KIT_AGENT_MODEL, und gesetzt hiesse fuer `/groom` unbeaufsichtigt.
const MIT_AUFSICHT = { KIT_AGENT_MODEL: "" };

const PAKET = [
  "---", "id: \"0005\"", "type: task", "status: ready", "title: Paket", "---", "",
  "## Kontext", "Text.", "", "## Aufgabe", "1. `kit/x.mjs` aendern.", "",
  "## Akzeptanzkriterium", "- gruen", "", "## Abhaengigkeiten", "Keine.", "",
].join("\n");
const FACHPLAN_BODY = [
  "## Ziel", "Ein Export.", "",
  "Autor-Modell: claude-opus-5-5", "",
  "## Fachliche Akzeptanzkriterien", "1. Der Export liefert CSV.", "2. Der Export nennt die Spalten.", "",
  "## Nicht-Ziele", "- Kein PDF.", "",
  "## Offene Fragen an den PO", "1. Welches Trennzeichen?", "",
].join("\n");
const FACHPLAN = [
  "---", "id: \"0006\"", "type: task", "status: backlog", "title: \"[Requirement] Export\"", "labels: review:done", "---", "",
  FACHPLAN_BODY,
].join("\n");

/** Ein frisches Projekt mit einem Paket #5, einem Fachplan #6 und den Dateien der Aufrufe. */
function projekt() {
  const dir = setupProjekt(LOKAL, "board-en-werte-");
  mkdirSync(join(dir, "issues"), { recursive: true });
  writeFileSync(join(dir, "issues", "0005.md"), PAKET, "utf-8");
  writeFileSync(join(dir, "issues", "0006.md"), FACHPLAN, "utf-8");
  writeFileSync(join(dir, "stand.md"), "Lauf beginnt.\n", "utf-8");
  writeFileSync(join(dir, "start.md"), FACHPLAN_BODY.replace("2. Der Export nennt die Spalten.\n", ""), "utf-8");
  writeFileSync(join(dir, "body.md"), "## Ziel\nEtwas.\n", "utf-8");
  return dir;
}

/** Fuehrt einen Aufruf in einem frischen Projekt aus: Ergebnis und alle Karten danach, ohne Zeitstempel. */
function lauf(args, env = MIT_AUFSICHT) {
  const dir = projekt();
  try {
    const res = runBoard(dir, args, { HOME: dir, ...env });
    const neutral = (s) => (s || "").replaceAll(dir, "<DIR>").replaceAll(/\d{4}-\d\d-\d\d[T ][\d:.]+Z?/g, "<ZEIT>");
    const karten = readdirSync(join(dir, "issues")).sort()
      .map((n) => `${n}:${neutral(readFileSync(join(dir, "issues", n), "utf-8"))}`);
    return { status: res.status, stdout: neutral(res.stdout), stderr: neutral(res.stderr), karten };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const WERTE = BEFEHLSNAMEN.werte;

// --- das Register --------------------------------------------------------------

test("das Register nennt die englischen Namen aus E5 und E8", () => {
  assert.equal(BEFEHLSNAMEN.befehle.issue.fragen, "questions");
  assert.equal(BEFEHLSNAMEN.optionen.vergleich, "compare");
  assert.deepEqual(WERTE.art, { fachlich: "requirement", idee: "idea", mensch: "human", plan: "plan", task: "task" });
  assert.deepEqual(WERTE.zustand, { laeuft: "running", abgebrochen: "aborted", wartet: "waiting", fertig: "done" });
  assert.deepEqual(WERTE.stufe, { fachlich: "requirement", plan: "plan", issue: "issue" });
});

test("internerWert bildet den englischen Wert auf den internen Schluessel ab, alles andere bleibt", () => {
  for (const [option, ebene] of Object.entries(WERTE)) {
    for (const [intern, englisch] of Object.entries(ebene)) {
      assert.equal(internerWert(option, englisch), intern, `${option} ${englisch}`);
      assert.equal(internerWert(option, intern), intern, `${option} ${intern}`);
    }
  }
  assert.equal(internerWert("art", "epos"), "epos");
  assert.equal(internerWert("art", true), true);
  assert.equal(internerWert("art", undefined), undefined);
  assert.equal(internerWert("unbekannt", "requirement"), "requirement");
});

test("die englischen Werte sind je Option eindeutig und kollidieren mit keinem anderen internen Schluessel", () => {
  for (const ebene of Object.values(WERTE)) {
    const englisch = Object.values(ebene);
    assert.equal(new Set(englisch).size, englisch.length);
    for (const [intern, name] of Object.entries(ebene)) {
      if (intern !== name) assert.ok(!Object.hasOwn(ebene, name), `${name} ist zugleich ein interner Schluessel`);
    }
  }
  // Die internen Schluessel bleiben, wie sie sind.
  assert.deepEqual([...ARTEN].sort(), Object.keys(WERTE.art).sort());
});

// --- im selben Prozess ------------------------------------------------------------

test("titelMitArt: jeder englische Wert von --art ergibt denselben Titel wie der deutsche", () => {
  for (const [intern, englisch] of Object.entries(WERTE.art)) {
    assert.deepEqual(titelMitArt("Etwas", englisch), titelMitArt("Etwas", intern), englisch);
  }
});

test("issueReviewRoles: --stufe requirement wirkt wie fachlich und meldet den Config-Schluessel", () => {
  const config = { ...LOKAL, reviewStufen: {
    fachlich: { reviewer: 2, rollen: ["form-beobachtbarkeit", "abgrenzung"] }, plan: { reviewer: 1, rollen: ["architektur-bestand"] },
    issue: { reviewer: 1, rollen: ["pruefbarkeit"] },
  } };
  for (const [intern, englisch] of Object.entries(WERTE.stufe)) {
    const de = issueReviewRoles({ _: [], stufe: intern, author: "claude-opus-5" }, config, {});
    const en = issueReviewRoles({ _: [], stufe: englisch, author: "claude-opus-5" }, config, {});
    assert.deepEqual(en, de, englisch);
    assert.equal(en.stufe, intern);
  }
});

// --- ueber den Einstieg -----------------------------------------------------------

const FAELLE = [
  { de: ["issue", "fragen", "6"], en: ["issue", "questions", "6"] },
  { de: ["issue", "fragen", "6", "--vergleich", "start.md"], en: ["issue", "questions", "6", "--compare", "start.md"] },
  { de: ["issue", "fragen"], en: ["issue", "questions"] },
  ...Object.entries(WERTE.zustand).map(([intern, englisch]) => ({
    de: ["issue", "stand", "5", "--zustand", intern, "--text-file", "stand.md"],
    en: ["issue", "run-state", "5", "--state", englisch, "--text-file", "stand.md"],
  })),
  ...Object.entries(WERTE.art).flatMap(([intern, englisch]) => [
    { de: ["issue", "create", "--title", "Etwas", "--body-file", "body.md", "--art", intern],
      en: ["issue", "create", "--title", "Etwas", "--body-file", "body.md", "--art", englisch] },
    { de: ["issue", "check-form", "--body-file", "body.md", "--title", "Etwas", "--art", intern],
      en: ["issue", "check-form", "--body-file", "body.md", "--title", "Etwas", "--art", englisch] },
  ]),
  ...Object.entries(WERTE.stufe).map(([intern, englisch]) => ({
    de: ["issue-review", "roles", "--stufe", intern, "--author", "claude-opus-5"],
    en: ["issue-review", "roles", "--stage", englisch, "--author", "claude-opus-5"],
  })),
];

for (const fall of FAELLE) {
  test(`${fall.en.join(" ")} wirkt wie ${fall.de.join(" ")}`, () => {
    const deutsch = lauf(fall.de);
    const englisch = lauf(fall.en);
    assert.deepEqual(englisch, deutsch);
  });
}

test("issue questions --compare liefert den Kriterienvergleich", () => {
  const res = lauf(["issue", "questions", "6", "--compare", "start.md"]);
  assert.equal(res.status, 0, res.stderr);
  const ausgabe = JSON.parse(res.stdout);
  assert.ok(ausgabe.aenderungen, "kein Vergleich in der Ausgabe");
  assert.equal(ausgabe.einstieg.start, true, JSON.stringify(ausgabe.einstieg));
});

test("issue run-state --state running setzt das Lauf-Label", () => {
  const res = lauf(["issue", "run-state", "5", "--state", "running", "--text-file", "stand.md"]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).zustand, "laeuft");
  assert.match(res.karten.find((k) => k.startsWith("0005.md")), /run:running/);
});
