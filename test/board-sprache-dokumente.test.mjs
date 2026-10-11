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
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { TEXTE } from "../kit/board.mjs";
import { TEXTE as DOKUMENTE_TEXTE, labelAbbilden, titelMitArt } from "../kit/board/dokumente.mjs";
import { MARKER, pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
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

// --- kit/board/dokumente.mjs ab ursprungEinhaengen bis zum Dateiende (Issue #1479) ---
//
// Vertrag bleiben (E14): die Feldnamen, die Folge des Auftrags (beginnen | bleibt | backlog |
// geschuetzt), der Befund einer Voraussetzung, die Werte von `bericht` und `kommentar`, die
// `aktion` der Ursprungsdokumente und die Marker `Bericht-Lauf:` und `## Laufstand`.

/** Mehrere Aufrufe in einem Projekt der Sprache `sprache`; `nimm` erwartet Exit 0 und JSON. */
function imProjektDerSprache(sprache, fn) {
  const config = sprache === undefined ? LOKAL : { ...LOKAL, language: sprache };
  const dir = setupProjekt(config, "board-sprache-");
  const rufe = (...args) => runBoard(dir, args, { HOME: dir });
  const nimm = (...args) => {
    const res = rufe(...args);
    assert.equal(res.status, 0, `${args.join(" ")}: ${res.stderr}`);
    return JSON.parse(res.stdout);
  };
  try {
    mkdirSync(join(dir, "issues"), { recursive: true });
    return fn({ dir, rufe, nimm });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Ein Vorhaben: 0001 Anforderung ohne Abschnitte, 0002 Plan ohne Entscheidungen, 0003 Paket,
 * 0004 Voraussetzung. Die Karten schreiben ihre Marker in der Sprache des Projekts.
 */
function vorhaben(nimm, sprache = "de") {
  const [quelle, auswahl] = sprache === "en" ? ["Requirement", "Plan-Decisions"] : ["Fachliche Quelle", "Plan-Entscheidungen"];
  nimm("issue", "create", "--title", "[Fachlich] Anforderung", "--body", "Text ohne Abschnitte.");
  nimm("issue", "create", "--title", "[Plan] Plan", "--body", `${quelle}: Issue #0001\n\n## Ziel\nz`);
  nimm("issue", "create", "--title", "Paket", "--body",
    `## Kontext\nPlan: Issue #0002\n${auswahl}: E1\n\n## Aufgabe\na\n\n## Abhaengigkeiten\nIssue #0004\nund #77`);
  nimm("issue", "create", "--title", "Vorher", "--body", "## Kontext\nk");
  nimm("issue", "move", "0003", "ready");
  nimm("issue", "move", "0004", "ready");
}

const kommentareVon = (dir, nr) => readFileSync(join(dir, "issues", `${nr}.md`), "utf-8");

test("[1479] die Tabelle traegt auch die Texte ab ursprungEinhaengen", () => {
  assert.deepEqual(pruefeParitaet(DOKUMENTE_TEXTE), []);
  for (const k of ["meldenTeilKeineZahl", "standZustandUnbekannt", "auftragSpalteUngueltig", "urteilDarfBeginnen",
    "auftragKopfUrteil", "ursprungGewandert", "hinweisSchreibweise", "backlogFachlich", "checkFormWege"]) {
    assert.ok(Object.hasOwn(DOKUMENTE_TEXTE.de, k), k);
  }
});

test("[1479] englische Stichproben: Abweisungen von report, run-state, brief und update", () => {
  const faelle = [
    [["issue", "report"], /: id is required: board\.mjs issue report <id> \[--part <n>\] --text '…'$/m],
    [["issue", "report", "5", "--part", "x", "--text", "a"], /: --part 'x' is not a positive integer\.$/m],
    [["issue", "report", "5", "--part", "1"], /: --part needs --text '…' with the piece\.$/m],
    [["issue", "report", "5"], /: No report for issue 5: neither --text nor pieces under \.claude\/berichte\/\.$/m],
    [["issue", "report", "5", "--text", "x"], /: No move of issue 5 to in_progress in \.claude\/bewegungen\.tsv — /m],
    [["issue", "run-state"], /: id is required: board\.mjs issue run-state <id> --state laeuft\|abgebrochen\|wartet\|fertig --text-file <file>$/m],
    [["issue", "run-state", "5", "--labels", "a"], /: --labels does not exist: the names come from night\.stand\.labels in the config\. /m],
    [["issue", "run-state", "5", "--state", "weg"], /: --state 'weg' unknown\. Expected: laeuft \| abgebrochen \| wartet \| fertig$/m],
    [["issue", "run-state", "5", "--state", "fertig"], /: --text-file is required: board\.mjs issue run-state /m],
    [["issue", "brief"], /: id is required: board\.mjs issue brief <id> \[--column ready\|in_progress\] \[--json\]$/m],
    [["issue", "brief", "5", "--column", "done"], /: --column 'done' is not an expected column \(ready \| in_progress\)\.$/m],
    [["issue", "brief", "99"], /: Package 99 not readable: /m],
    [["issue", "update"], /: id is required: board\.mjs issue update <id> --body "\.\.\."$/m],
  ];
  for (const [args, erwartet] of faelle) {
    const res = lauf("en", args);
    assert.equal(res.status, 1, `${args.join(" ")}: ${res.stderr}`);
    assert.match(res.stderr, erwartet, args.join(" "));
    assert.doesNotMatch(res.stderr, /erforderlich|unbekannt|Erwartet|braucht|nicht lesbar|keine positive/, args.join(" "));
  }
});

test("[1479] englische Stichprobe: night.stand.labels in der Config", () => {
  for (const [labels, erwartet] of [
    [{ laeuft: "" }, /: night\.stand\.labels\.laeuft must be a non-empty text, is ""\.$/m],
    [{ laeuft: "a", wartet: "a" }, /: night\.stand\.labels: the three names must differ \(a, /m],
  ]) {
    const dir = setupProjekt({ ...LOKAL, language: "en", night: { stand: { labels } } }, "board-sprache-");
    try {
      mkdirSync(join(dir, "issues"), { recursive: true });
      writeFileSync(join(dir, "issues", "0005.md"), KARTE, "utf-8");
      writeFileSync(join(dir, "stand.md"), "Stand", "utf-8");
      const res = runBoard(dir, ["issue", "run-state", "5", "--state", "laeuft", "--text-file", "stand.md"], { HOME: dir });
      assert.equal(res.status, 1, res.stderr);
      assert.match(res.stderr, erwartet);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("[1479] issue brief spricht englisch; Folge, Befund und Feldnamen bleiben", () => {
  imProjektDerSprache("en", ({ rufe, nimm }) => {
    vorhaben(nimm, "en");
    const md = rufe("issue", "brief", "3");
    assert.equal(md.status, 0, md.stderr);
    const o = md.stdout;
    for (const kopf of ["## Verdict", "## Task", "## Plan decisions", "## Business reason", "## Siblings", "## Prerequisites", "## Gaps"]) {
      assert.match(o, new RegExp(`^${kopf}$`, "m"), kopf);
    }
    assert.match(o, /^may not start — Consequence: bleibt$/m);
    assert.match(o, /^Reason: Prerequisite #4 unmet \(unmet is what lies in Backlog, Ready or In progress\)\.$/m);
    assert.match(o, /^Column: ready$/m);
    assert.match(o, /^Labels: none$/m);
    assert.match(o, /^Comments: none$/m);
    assert.match(o, /^- #4 Vorher — Column: ready — unmet$/m);
    assert.match(o, /^- #77 \(no title\) — Column: none — met \(not on the board\)$/m);
    assert.match(o, /^Requirement: Issue #1 \(from the plan #2\)$/m);
    assert.match(o, /^### Goal$/m);
    assert.match(o, /^### Business acceptance criteria$/m);
    assert.match(o, /^missing \(see gaps\)$/m);
    assert.match(o, /^Full text: `node \.claude\/kit\/board\.mjs issue get 1`$/m);
    assert.match(o, /^- Plan decisions: plan #2 has no entry `- E<n>:` under `## Architectural decisions`$/m);
    assert.match(o, /^- Business reason: section `## Goal` missing in issue #1$/m);

    const json = nimm("issue", "brief", "3", "--json");
    assert.deepEqual(Object.keys(json), ["id", "urteil", "aufgabe", "planEntscheidungen", "fachlicherAnlass", "geschwister", "voraussetzungen", "luecken"]);
    assert.equal(json.urteil.folge, "bleibt");
    assert.equal(json.urteil.urteil, "may not start");
    assert.deepEqual(json.voraussetzungen.map((v) => v.befund), ["unerfuellt", "erfuellt"]);
    assert.equal(json.voraussetzungen[1].grund, "not on the board");

    const ohnePlan = rufe("issue", "brief", "4");
    assert.match(ohnePlan.stdout, /^may start — Consequence: beginnen$/m);
    assert.match(ohnePlan.stdout, /^no project — the package names no line `Plan: Issue #M` \(see gaps\)$/m);
    assert.match(ohnePlan.stdout, /^no business source \(see gaps\)$/m);
    assert.match(ohnePlan.stdout, /^- Plan decisions: no project — the package names no line `Plan: Issue #M`$/m);

    nimm("issue", "move", "0002", "ready");
    const plan = rufe("issue", "brief", "2");
    assert.match(plan.stdout, /^Reason: Title prefix \[Plan\] — not implemented\.$/m);
    assert.match(plan.stdout, /^Comment for the card \(verbatim\):$/m);
    assert.match(plan.stdout, /^Plan document — not implemented, please turn it into work packages via \/issues #2\.$/m);
    const voraus = rufe("issue", "brief", "1");
    assert.match(voraus.stdout, /^Reason: Issue #1 is not \(or no longer\) in Ready, but in Backlog\.$/m);
  });
});

test("[1479] dieselben Auftraege bleiben in einem deutschen Projekt deutsch", () => {
  imProjektDerSprache(undefined, ({ rufe, nimm }) => {
    vorhaben(nimm);
    const o = rufe("issue", "auftrag", "3").stdout;
    assert.match(o, /^## Urteil$/m);
    assert.match(o, /^darf nicht beginnen — Folge: bleibt$/m);
    assert.match(o, /^### Ziel$/m);
    assert.match(o, /^## Lücken$/m);
  });
});

test("[1479] Hinweise zu den Abhaengigkeiten und der Abschnitt Ursprungsdokumente stehen englisch", () => {
  imProjektDerSprache("en", ({ dir, nimm }) => {
    nimm("issue", "create", "--title", "[Plan] Plan", "--body", "## Ziel\nz");
    const paket = nimm("issue", "create", "--title", "Paket", "--body",
      "## Kontext\nPlan: Issue #0001\n\n## Aufgabe\na\n\n## Abhaengigkeiten\nsiehe #1 und #88");
    assert.deepEqual(paket.hinweise.map((h) => h.art), ["schreibweise", "dokument", "schreibweise", "unbekannt"]);
    assert.equal(paket.hinweise[0].meldung, "#1 counts as a dependency — it is not on a reference line ('Issue #1'): siehe #1 und #88");
    assert.equal(paket.hinweise[1].meldung, "#1 is a document ([Plan]), not a work package — a plan document is never done by implementation");
    assert.equal(paket.hinweise[3].meldung, "#88 is not on the board (archived or missing?) — it counts as met");

    nimm("issue", "move", "0002", "in_progress");
    const e = nimm("issue", "report", "0002", "--text", "All green.");
    assert.equal(e.bericht, "angelegt");
    assert.equal(e.ursprung.dokumente[0].aktion, "wandert");
    const k = kommentareVon(dir, "0002");
    assert.match(k, /^### Origin documents$/m);
    assert.match(k, /^- Plan #1: moved to In review$/m);
    assert.match(k, /^Bericht-Lauf: /m);
  });
});

test("[1479] kein Abbruch in board.mjs und dokumente.mjs traegt einen Text am Texthelfer vorbei", () => {
  const abbruch = /\b(?:fail|labelFail|labelFailMit|checkFormAbweisen|new BoardError)\(\s*[`"']/g;
  for (const datei of ["../kit/board.mjs", "../kit/board/dokumente.mjs"]) {
    const quelle = readFileSync(new URL(datei, import.meta.url), "utf-8");
    const funde = [...quelle.matchAll(abbruch)].map((m) => quelle.slice(m.index, m.index + 60));
    assert.deepEqual(funde, [], datei);
  }
});

/**
 * Deutsche Bruchstuecke beider Tabellen der Gruppe: jedes Stueck zwischen Platzhaltern, das
 * in keinem englischen Text steht. Kurze Stuecke sagen nichts ueber die Sprache, und ein Stueck
 * aus einem Markernamen (`Plan-Entscheidungen:`, `## Geschuetzte Datei`) ist Inhalt einer
 * Karte oder ein zitierter Name, keine Meldung.
 */
function deutscheBruchstuecke() {
  const marker = Object.values(MARKER).map((m) => m.de);
  const stuecke = new Set();
  for (const tabelle of [TEXTE, DOKUMENTE_TEXTE]) {
    const englisch = Object.values(tabelle.en).join("\n");
    for (const wert of Object.values(tabelle.de)) {
      for (const teil of wert.split(/\{[A-Za-z_]\w*\}|\n/)) {
        const t = teil.trim();
        if (t.length >= 8 && !englisch.includes(t) && !marker.some((m) => m.includes(t))) stuecke.add(t);
      }
    }
  }
  return [...stuecke];
}

// Vertrag (E14), nicht Meldung: Folge, Befund, Art und die Ergebniswerte der Schreibwege.
const VERTRAGSFELDER = new Set(["folge", "befund", "art", "aktion", "bericht", "kommentar", "status", "zustand"]);

/** Die Textwerte einer JSON-Ausgabe ohne die Vertragsfelder; sonst die Ausgabe selbst. */
function freitexte(ausgabe) {
  let wert;
  try {
    wert = JSON.parse(ausgabe);
  } catch {
    return ausgabe;
  }
  const texte = (w, schluessel = null) => {
    if (VERTRAGSFELDER.has(schluessel) && typeof w === "string") return [];
    if (typeof w === "string") return [w];
    if (Array.isArray(w)) return w.flatMap((x) => texte(x));
    if (w && typeof w === "object") return Object.entries(w).flatMap(([k, x]) => texte(x, k));
    return [];
  };
  return texte(wert).join("\n");
}

test("[1479] ein englisches Projekt sieht aus board.mjs und dokumente.mjs keine deutsche Meldung", () => {
  const ausgaben = [];
  const sammle = (res) => ausgaben.push(freitexte(res.stdout), res.stderr);
  imProjektDerSprache("en", ({ dir, rufe, nimm }) => {
    vorhaben(nimm, "en");
    writeFileSync(join(dir, "stand.md"), "Stand", "utf-8");
    for (const args of [
      ["--help"], ["achse"], ["issue", "gibtsnicht"], ["issue", "create"], ["issue", "get"], ["issue", "move", "3", "weg"],
      ["issue", "label", "quatsch"], ["issue", "label", "add", "3", "Ready"], ["issue", "comment", "3"],
      ["issue", "activity"], ["issue", "origin"], ["issue", "check-form"], ["issue", "check-form", "--body-file"],
      ["issue", "check-protected", "3"], ["issue", "report"], ["issue", "report", "3"], ["issue", "report", "3", "--text", "x"],
      ["issue", "report", "3", "--part", "0"], ["issue", "run-state"], ["issue", "run-state", "3", "--state", "x"],
      ["issue", "brief"], ["issue", "brief", "3", "--column", "x"], ["issue", "brief", "99"], ["issue", "update"],
      ["issue", "brief", "1"], ["issue", "brief", "2"], ["issue", "brief", "3"], ["issue", "brief", "3", "--json"], ["issue", "brief", "4"],
      ["issue", "update", "3", "--body", "## Abhaengigkeiten\n#1 und #88"],
      ["issue", "run-state", "3", "--state", "laeuft", "--text-file", "stand.md"],
      ["issue", "move", "3", "in_progress"], ["issue", "report", "3", "--text", "x"],
    ]) sammle(rufe(...args));
    ausgaben.push(kommentareVon(dir, "0003"));
  });
  const alles = ausgaben.join("\n");
  const funde = deutscheBruchstuecke().filter((s) => alles.includes(s));
  assert.deepEqual(funde, []);
  assert.ok(deutscheBruchstuecke().length > 100, "die Probe kennt die deutschen Texte beider Tabellen");
});
