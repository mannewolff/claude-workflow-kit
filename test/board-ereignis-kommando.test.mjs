// Ablauf-Pruefung: `issue hold` und `issue check-form` starten kit/board.mjs und enden bei einem
// Bedienfehler ueber process.exit — Exit-Code und Ausgabe zeigt nur der gestartete Prozess.
//
// Das Warten eines Fachplans setzen und heben (Issue #1662, Plan #1624 E2, E3, E4, E9, E11):
// `issue hold <id> --reason "<Grund>"` schreibt die Zeile `Wartet auf Ereignis:` in `## Ziel`
// und setzt `kit:on-hold`, `--lift` nimmt beides wieder weg. `issue check-form` meldet das
// Warten auf der Stufe `fachlich` als Feld `wartet`. Die Zeile selbst lesen und schreiben die
// Funktionen aus kit/board/ereignis.mjs; ihre Faelle stehen in test/board-ereignis-lesen.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, board, runBoard, fakeCli, aufrufZeilen } from "./helpers/board-fixture.mjs";
import { mitSzenarien } from "./helpers/szenarien-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
const GITHUB = { codeHost: "github", issueTracker: "github", github: { projectNumber: 14 } };

const BODY = mitSzenarien([
  "## Ziel", "Ein Export.", "",
  "Autor-Modell: claude-opus-5-5", "",
  "## Fachliche Akzeptanzkriterien", "1. Der Export liefert CSV.", "",
  "## Nicht-Ziele", "- Kein PDF.", "",
  "## Offene Fragen an den PO", "1. Welches Trennzeichen?", "",
].join("\n"));

/** Ein lokales Projekt mit einer Karte je Titel; `lauf(dir)` und danach aufraeumen. */
function imProjekt(titel, lauf, body = BODY) {
  const dir = setupProjekt(LOKAL, "board-hold-");
  try {
    for (const t of titel) board(dir, "issue", "create", "--title", t, "--body", body);
    return lauf(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const datei = (dir, id = "0001") => join(dir, "issues", `${id}.md`);
const karte = (dir, id = "1") => board(dir, "issue", "get", id);
const hold = (dir, ...args) => runBoard(dir, ["issue", "hold", ...args]);
const json = (res) => JSON.parse(res.stdout);
const wartezeilen = (body) => body.split("\n").filter((z) => z.startsWith("Wartet auf Ereignis:"));

test("--reason an einem Fachplan: Zeile im Ziel, Label gesetzt", () => {
  for (const praefix of ["[Requirement]", "[Fachlich]"]) {
    imProjekt([`${praefix} Export`], (dir) => {
      const res = hold(dir, "1", "--reason", "Tarif X waehlbar");
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(json(res), { ok: true, id: "1", wartet: "Tarif X waehlbar", label: "gesetzt", labelFehler: null });
      const k = karte(dir);
      assert.ok(k.labels.includes("kit:on-hold"));
      assert.match(k.body, /Autor-Modell: claude-opus-5-5\nWartet auf Ereignis: Tarif X waehlbar\n/);
    });
  }
});

test("ein zweites --reason ersetzt den Grund, keine zweite Zeile", () => imProjekt(["[Requirement] Export"], (dir) => {
  board(dir, "issue", "hold", "1", "--reason", "alt");
  assert.equal(board(dir, "issue", "hold", "1", "--reason", "neu").wartet, "neu");
  assert.deepEqual(wartezeilen(karte(dir).body), ["Wartet auf Ereignis: neu"]);
}));

test("--lift entfernt jede Wartezeile im Ziel und nimmt das Label ab", () => imProjekt(["[Requirement] Export"], (dir) => {
  const vorher = karte(dir).body;
  board(dir, "issue", "hold", "1", "--reason", "Tarif X");
  const res = hold(dir, "1", "--lift");
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(json(res), { ok: true, id: "1", wartet: null, label: "abgenommen", labelFehler: null });
  const k = karte(dir);
  assert.ok(!k.labels.includes("kit:on-hold"));
  assert.deepEqual(wartezeilen(k.body), []);
  assert.equal(k.body, vorher, "jedes andere Zeichen bleibt stehen");
}));

test("--lift an einer Karte mit zwei Wartezeilen entfernt beide", () => {
  const body = BODY.replace("Autor-Modell: claude-opus-5-5", "Autor-Modell: claude-opus-5-5\nWartet auf Ereignis: A\nWartet auf Ereignis: B");
  imProjekt(["[Requirement] Export"], (dir) => {
    board(dir, "issue", "hold", "1", "--lift");
    assert.deepEqual(wartezeilen(karte(dir).body), []);
  }, body);
});

test("fehlt das Label am Board, steht die Zeile trotzdem und das Kommando endet mit Exit 0", () => {
  const dir = setupProjekt(GITHUB, "board-hold-gh-");
  fakeCli(dir, "gh", [
    { match: "^repo view", stdout: "besitzer/mein-repo\n" },
    { match: "^issue view 7", stdout: JSON.stringify({ number: 7, title: "[Requirement] Export", body: BODY, state: "OPEN",
      comments: [], labels: [], createdAt: "2026-10-14T00:00:00Z" }) + "\n" },
    { match: "--add-label kit:on-hold", stderr: "could not add label: 'kit:on-hold' not found\n", exit: 1 },
    { match: "^issue edit", stdout: "" },
  ]);
  try {
    const res = hold(dir, "7", "--reason", "Tarif X");
    assert.equal(res.status, 0, res.stderr);
    const aus = json(res);
    assert.equal(aus.ok, true);
    assert.equal(aus.wartet, "Tarif X");
    assert.equal(aus.label, null);
    assert.match(aus.labelFehler, /'kit:on-hold' not found/);
    const zeilen = aufrufZeilen(dir, "gh").join("\n");
    assert.match(zeilen, /--body [^]*Wartet auf Ereignis: Tarif X[^]*--add-label kit:on-hold/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ein Plan und ein Arbeitspaket werden abgewiesen, der Body bleibt", () => imProjekt(["[Plan] Export", "Paket Export"], (dir) => {
  for (const [id, nr] of [["1", "0001"], ["2", "0002"]]) {
    const vorher = readFileSync(datei(dir, nr), "utf-8");
    for (const args of [["--reason", "Tarif X"], ["--lift"]]) {
      const res = hold(dir, id, ...args);
      assert.equal(res.status, 1, `#${id} ${args.join(" ")}`);
      assert.match(res.stderr, /Fachplan/);
    }
    assert.equal(readFileSync(datei(dir, nr), "utf-8"), vorher);
  }
}));

test("Bedienfehler: leerer Grund, beide Optionen, keine Option, keine Kartennummer", () => imProjekt(["[Requirement] Export"], (dir) => {
  const vorher = readFileSync(datei(dir), "utf-8");
  for (const args of [["1", "--reason", ""], ["1", "--reason", "   "], ["1", "--reason"], ["1", "--reason", "X", "--lift"], ["1"], []]) {
    const res = hold(dir, ...args);
    assert.equal(res.status, 1, args.join(" "));
    assert.match(res.stderr, /^Fehler/, args.join(" "));
  }
  assert.equal(readFileSync(datei(dir), "utf-8"), vorher);
}));

test("ein Fachplan ohne Abschnitt Ziel wird abgewiesen", () => imProjekt(["[Requirement] Export"], (dir) => {
  const res = hold(dir, "1", "--reason", "Tarif X");
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Ziel/);
}, mitSzenarien("## Nicht-Ziele\n- Kein PDF.\n")));

test("englisch: die Zeile in der Projektsprache, die Meldung englisch", () => {
  const dir = setupProjekt({ ...LOKAL, language: "en" }, "board-hold-en-");
  try {
    const body = mitSzenarien("## Goal\nAn export.\n\nAuthor-Model: claude-opus-5-5\n\n## Non-goals\n- No PDF.\n", "en");
    board(dir, "issue", "create", "--title", "[Requirement] Export", "--body", body);
    board(dir, "issue", "create", "--title", "[Plan] Export", "--body", body);
    assert.equal(board(dir, "issue", "hold", "1", "--reason", "plan X").wartet, "plan X");
    assert.match(karte(dir).body, /Author-Model: claude-opus-5-5\nWaiting for event: plan X\n/);
    const res = hold(dir, "2", "--lift");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: .*requirement/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-form meldet das Warten als Feld, ok und Exit bleiben gleich", () => imProjekt(["[Requirement] Export"], (dir) => {
  const ohne = runBoard(dir, ["issue", "check-form", "1"]);
  const ohneAus = json(ohne);
  assert.ok(!("wartet" in ohneAus));
  board(dir, "issue", "hold", "1", "--reason", "Tarif X");
  const mit = runBoard(dir, ["issue", "check-form", "1"]);
  const mitAus = json(mit);
  assert.equal(mitAus.wartet, "Tarif X");
  assert.equal(mit.status, ohne.status);
  assert.equal(mitAus.ok, ohneAus.ok);
  assert.deepEqual(mitAus.verstoesse, ohneAus.verstoesse);
}));

test("Szenario: Eine offene Frage bleibt eine offene Frage", () => imProjekt(["[Requirement] Export"], (dir) => {
  board(dir, "issue", "label", "add", "1", "kit:clarify");
  const vorher = karte(dir);
  assert.ok(!vorher.labels.includes("kit:on-hold"), "die offene Frage ist kein Warten");
  assert.ok(!("wartet" in json(runBoard(dir, ["issue", "check-form", "1"]))));

  board(dir, "issue", "hold", "1", "--reason", "Tarif X");
  const wartend = karte(dir);
  assert.ok(wartend.labels.includes("kit:clarify"));
  assert.match(wartend.body, /## Offene Fragen an den PO\n1\. Welches Trennzeichen\?/);

  board(dir, "issue", "hold", "1", "--lift");
  const nachher = karte(dir);
  assert.ok(nachher.labels.includes("kit:clarify"), "--lift nimmt kit:clarify nicht ab");
  assert.equal(nachher.body, vorher.body, "Frage und Body unveraendert");
}));

test("--help nennt issue hold mit --reason und --lift", () => imProjekt([], (dir) => {
  const res = runBoard(dir, ["--help"]);
  assert.match(res.stdout, /issue hold <id> --reason "<[^"]+>"/);
  assert.match(res.stdout, /issue hold <id> --lift/);
}));
