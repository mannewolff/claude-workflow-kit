// Ablauf-Pruefung: Ob ein englisches Projekt die Meldungen des Einstiegs englisch sieht, zeigt nur der gestartete Einstieg mit seiner Config.
//
// Meldungen zweisprachig: kit/board.mjs (Issue #1477, Teil 1 von #1445, Plan #1420 E13/E14).
//
// Der Einstieg traegt seine Texte in einer Tabelle `{ de, en }` und gibt sie ueber den
// Texthelfer aus kit/board/namen.mjs aus. Hier steht, was das Paket zusaetzlich zu den
// deutschen Wortlaut-Tests verlangt:
//
//   - Paritaet: je Sprache dieselben Schluessel und Platzhalter.
//   - Englische Stichproben: Hilfe, Fehlerpraefix, Abweisungen der Achsen und Befehle,
//     die Handlung von `issue check-geschuetzt` und die Abweisung von `issue check-form`.
//   - Der Maschinenvertrag (E14) bleibt: Feldnamen der JSON-Ausgaben.
//
// Die folgenden Teile (#1478, #1479) ergaenzen diese Datei um kit/board/dokumente.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { TEXTE } from "../kit/board.mjs";
import { TEXTE as DOKUMENTE_TEXTE, labelAbbilden, titelMitArt } from "../kit/board/dokumente.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
const KARTE = [
  "---", "id: \"0005\"", "type: task", "status: ready", "title: Paket", "---", "",
  "## Kontext", "Text.", "", "## Aufgabe", "1. `kit/x.mjs` aendern.", "",
  "## Akzeptanzkriterium", "- gruen", "", "## Abhaengigkeiten", "Keine.", "",
].join("\n");

/** Ein Aufruf in einem frischen Projekt mit lokalem Tracker, Karte #5 und der Sprache `sprache`. */
function lauf(sprache, args, env = {}) {
  const config = sprache === undefined ? LOKAL : { ...LOKAL, language: sprache };
  const dir = setupProjekt(config, "board-sprache-");
  try {
    mkdirSync(join(dir, "issues"), { recursive: true });
    writeFileSync(join(dir, "issues", "0005.md"), KARTE, "utf-8");
    return runBoard(dir, args, { HOME: dir, ...env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("[1477] die Texttabelle von board.mjs hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(TEXTE), []);
  assert.ok(Object.keys(TEXTE.de).length > 20, "die Tabelle traegt die Texte des Einstiegs");
});

test("[1477] die Hilfe steht in einem englischen Projekt englisch, in einem deutschen deutsch", () => {
  const en = lauf("en", ["--help"]);
  assert.equal(en.status, 0, en.stderr);
  assert.match(en.stdout, /^board\.mjs — board adapter for the claude-workflow-kit$/m);
  assert.match(en.stdout, /^Usage:$/m);
  assert.match(en.stdout, /^Valid status values: backlog \| ready \| in_progress \| in_review \| done$/m);
  assert.doesNotMatch(en.stdout, /Nutzung:|Gueltige Status-Werte|Konfiguration:/);

  for (const sprache of [undefined, "de"]) {
    const de = lauf(sprache, ["--help"]);
    assert.equal(de.status, 0, de.stderr);
    assert.match(de.stdout, /^Nutzung:$/m);
    assert.doesNotMatch(de.stdout, /^Usage:$/m);
  }
});

test("[1477] englische Stichproben: Fehlerpraefix und Abweisungen der Achsen und Befehle", () => {
  const faelle = [
    [["achse"], /^Error: Unknown axis: 'achse'\. Expected: issue \| code \| context \| issue-review \| nightrun \| session \| hook$/m],
    [["issue", "gibtsnicht"], /^Error: Unknown issue command: 'gibtsnicht'$/m],
    [["code", "gibtsnicht"], /^Error: Unknown code command: 'gibtsnicht'$/m],
    [["context", "gibtsnicht"], /^Error: Unknown context command: 'gibtsnicht'$/m],
    [["code", "pr"], /^Error: --from is required$/m],
    [["code", "pr", "--from", "a"], /^Error: --to is required$/m],
    [["code", "pr", "--from", "a", "--to", "b"], /^Error: This codeHost does not support pull requests\. Use a local git merge\.$/m],
    [["code", "ci-status"], /^Error: --commit is required$/m],
    [["code", "ci-status", "--commit"], /^Error: --commit needs a value$/m],
    [["code", "protection", "gibtsnicht"], /^Error: Unknown protection action: 'gibtsnicht'\. Expected: status \| setup \| suspend \| restore \| verify$/m],
    [["context", "paths", "--date"], /^Error: --date needs a value$/m],
    [["issue", "check-protected"], /^Error: issue check-protected needs a card number: node board\.mjs issue check-protected <id>$/m],
  ];
  for (const [args, erwartet] of faelle) {
    const res = lauf("en", args);
    assert.equal(res.status, 1, `${args.join(" ")}: ${res.stderr}`);
    assert.match(res.stderr, erwartet, args.join(" "));
    assert.doesNotMatch(res.stderr, /Fehler|Unbekannt|erforderlich|braucht/, args.join(" "));
  }
});

test("[1477] dieselben Abweisungen bleiben in einem deutschen Projekt deutsch", () => {
  const res = lauf(undefined, ["achse"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^Fehler: Unbekannte Achse: 'achse'\. Erwartet: issue \| code \| kontext \| issue-review \| nightrun \| sitzung \| hook$/m);
  const pr = lauf("de", ["code", "pr"]);
  assert.match(pr.stderr, /^Fehler: --from ist erforderlich$/m);
});

test("[1477] issue check-protected nennt die Handlung englisch, die Feldnamen bleiben", () => {
  const res = lauf("en", ["issue", "check-protected", "5"]);
  assert.equal(res.status, 0, res.stderr);
  const ergebnis = JSON.parse(res.stdout);
  assert.deepEqual(Object.keys(ergebnis), ["ok", "treffer", "label", "freigegeben", "handlung", "kommentar"]);
  assert.equal(ergebnis.handlung, "No protected file named — the package may start.");
});

test("[1477] issue check-form weist englisch ab, mit dem Feld fehler", () => {
  const res = lauf("en", ["issue", "check-form"]);
  assert.equal(res.status, 1);
  const ergebnis = JSON.parse(res.stdout);
  assert.deepEqual(Object.keys(ergebnis), ["ok", "stufe", "verstoesse", "fehler"]);
  assert.match(ergebnis.fehler, /^No input given\. /);
  assert.match(res.stderr, /^Error: No input given\. /m);

  const ohnePfad = lauf("en", ["issue", "check-form", "--body-file"]);
  assert.match(JSON.parse(ohnePfad.stdout).fehler, /^--body-file needs a path\. /);
  const ohneTitel = lauf("en", ["issue", "check-form", "--body-file", "fehlt.md"]);
  assert.match(JSON.parse(ohneTitel.stdout).fehler, /^--body-file needs --title so the stage is known\. /);
  const unlesbar = lauf("en", ["issue", "check-form", "--body-file", "fehlt.md", "--title", "Paket"]);
  assert.match(JSON.parse(unlesbar.stdout).fehler, /^--body-file: fehlt\.md is not readable \(ENOENT\)\. /);
  const beides = lauf("en", ["issue", "check-form", "5", "--body-file", "x.md"]);
  assert.match(JSON.parse(beides.stdout).fehler, /^Card number and --body-file given together\. /);
});

// --- kit/board/dokumente.mjs, vom Dateianfang bis vor ursprungEinhaengen (Issue #1478) ---
//
// Die Abbrueche laufen weiter ueber `fail` der Grundlagen; dessen Praefix `Fehler:` stellt
// #1483 um. Die Stichproben pruefen darum den Text hinter dem Praefix.

test("[1478] die Texttabelle von dokumente.mjs hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(DOKUMENTE_TEXTE), []);
  assert.ok(Object.keys(DOKUMENTE_TEXTE.de).length > 30, "die Tabelle traegt die Texte bis vor ursprungEinhaengen");
});

test("[1478] englische Stichproben: Abweisungen von create, move, label, comment, activity und origin", () => {
  const faelle = [
    [["issue", "create"], /: --title is required$/m],
    [["issue", "create", "--title", "X", "--art", "quatsch"], /: --art needs one of these values: fachlich\|/m],
    [["issue", "create", "--title", "[Plan] X", "--art", "plan"], /: --art plan next to a title with a prefix \('\[Plan\] X'\) — either --art or the prefix in the title$/m],
    [["issue", "create", "--title", "X", "--derived-from"], /: --derived-from needs a value \(card number of the nearest ancestor\)$/m],
    [["issue", "create", "--title", "X", "--derived-from", "x"], /: --derived-from 'x' is not a positive integer\.$/m],
    [["issue", "get"], /: id is required: board\.mjs issue get <id>$/m],
    [["issue", "list", "--status", "weg"], /: Invalid status 'weg'\. Valid: backlog, ready, in_progress, in_review, done$/m],
    [["issue", "move"], /: id is required: board\.mjs issue move <id> <status>$/m],
    [["issue", "move", "5"], /: status is required: board\.mjs issue move <id> <status>$/m],
    [["issue", "move", "5", "weg"], /: Invalid status 'weg'\./m],
    [["issue", "origin"], /: Plan number is required: board\.mjs issue origin <plan>$/m],
    [["issue", "activity"], /: id is required: board\.mjs issue activity <id> \| --ids <n,n,\.\.\.>$/m],
    [["issue", "activity", "5", "--ids", "1"], /: --ids and a single number exclude each other: /m],
    [["issue", "activity", "--ids", ","], /: --ids needs at least one card number: board\.mjs issue activity --ids 12,13$/m],
    [["issue", "label", "quatsch"], /: Unknown label command: 'quatsch'\. Expected: add \| remove$/m],
    [["issue", "label", "add"], /: id is required: board\.mjs issue label add <id> <name>$/m],
    [["issue", "label", "add", "5"], /: name is required: board\.mjs issue label add <id> <name>$/m],
    [["issue", "label", "add", "5", "a", "b"], /: Too many arguments: 'b'\. Expected exactly <id> and <name>\.$/m],
    [["issue", "label", "add", "5", "a,b"], /: Label name must not contain a comma or a line break: 'a,b'$/m],
    [["issue", "label", "add", "5", "Ready"], /: Change the status label `Ready` only via `issue move`$/m],
    [["issue", "comment"], /: id is required: board\.mjs issue comment <id> --text "\.\.\."$/m],
    [["issue", "comment", "5"], /: --text is required and must not be empty \(argument, --text-file or '-' for stdin\)\.$/m],
    [["issue", "comment", "5", "--text", "a", "--text-file", "b"], /: --text and --text-file exclude each other — give only one source\.$/m],
    [["issue", "comment", "5", "--text-file"], /: --text-file needs a path\.$/m],
    [["issue", "comment", "5", "--text"], /: --text needs a value \(or '-' for stdin\)\.$/m],
    [["issue", "comment", "5", "--text-file", "fehlt.md"], /: --text-file: file not found: fehlt\.md$/m],
    [["issue", "comment", "5", "--text", "x", "--idempotency-key"], /: --idempotency-key needs a value\.$/m],
  ];
  for (const [args, erwartet] of faelle) {
    const res = lauf("en", args);
    assert.equal(res.status, 1, `${args.join(" ")}: ${res.stderr}`);
    assert.match(res.stderr, erwartet, args.join(" "));
    assert.doesNotMatch(res.stderr, /erforderlich|Ungueltig|Unbekannt|braucht|nicht gefunden|schliessen sich aus/, args.join(" "));
  }
});

test("[1478] englische Stichprobe: das fehlende Autor-Modell", () => {
  const res = lauf("en", ["issue", "create", "--title", "X", "--body", "Text"], { KIT_AGENT_MODEL: "" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /: No author model given\. The body needs a line "Author-Model: <model>" in the context section\./m);

  const widerspruch = lauf("en", ["issue", "create", "--title", "X", "--body", "Autor-Modell: a", "--author-model", "b"]);
  assert.match(widerspruch.stderr, /: --author-model 'b' contradicts the existing author model line \('a'\)\. Leave out one of the two\.$/m);
});

test("[1478] dieselben Abweisungen bleiben in einem deutschen Projekt deutsch", () => {
  assert.match(lauf(undefined, ["issue", "move", "5", "weg"]).stderr, /^Fehler: Ungueltiger Status 'weg'\. Gueltig: /m);
  assert.match(lauf("de", ["issue", "label", "quatsch"]).stderr, /^Fehler: Unbekannter label-Befehl: 'quatsch'\. Erwartet: add \| remove$/m);
  assert.match(lauf("de", ["issue", "comment", "5"]).stderr, /^Fehler: --text ist erforderlich und darf nicht leer sein/m);
});

test("[1478] titelMitArt und die Label-Hinweise nennen ihren Freitext englisch, Art und Felder bleiben", async () => {
  spracheFestlegen("en");
  try {
    assert.match(titelMitArt("X", true, "en").fehler, /^--art needs one of these values: fachlich\|/);
    assert.deepEqual(Object.keys(titelMitArt("[Idea] X", "idee", "en")), ["fehler"]);

    const tracker = (labels) => ({
      gesetzt: [],
      async labelIssue(id, name, aktion) {
        this.gesetzt.push([name, aktion]);
      },
      async getIssue() { return { labels }; },
    });

    const keins = await labelAbbilden(tracker([]), { language: "en" }, "remove", "5", "kit:klaeren");
    assert.equal(keins.hinweise[0].art, "nicht-getragen");
    assert.equal(keins.hinweise[0].meldung, "Issue 5 carries neither kit:clarify nor kit:klaeren — nothing removed.");

    const beide = await labelAbbilden(tracker(["kit:klaeren", "kit:clarify"]), { language: "en" }, "remove", "5", "kit:clarify");
    assert.equal(beide.hinweise[0].art, "beide");
    assert.equal(beide.hinweise[0].meldung, "Issue 5 carried both names (kit:clarify, kit:klaeren) — both removed.");
  } finally {
    spracheFestlegen(null);
  }
});
