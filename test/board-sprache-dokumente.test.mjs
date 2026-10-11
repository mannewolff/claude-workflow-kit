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
import { pruefeParitaet } from "../kit/board/namen.mjs";
import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
const KARTE = [
  "---", "id: \"0005\"", "type: task", "status: ready", "title: Paket", "---", "",
  "## Kontext", "Text.", "", "## Aufgabe", "1. `kit/x.mjs` aendern.", "",
  "## Akzeptanzkriterium", "- gruen", "", "## Abhaengigkeiten", "Keine.", "",
].join("\n");

/** Ein Aufruf in einem frischen Projekt mit lokalem Tracker, Karte #5 und der Sprache `sprache`. */
function lauf(sprache, args) {
  const config = sprache === undefined ? LOKAL : { ...LOKAL, language: sprache };
  const dir = setupProjekt(config, "board-sprache-");
  try {
    mkdirSync(join(dir, "issues"), { recursive: true });
    writeFileSync(join(dir, "issues", "0005.md"), KARTE, "utf-8");
    return runBoard(dir, args, { HOME: dir });
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
