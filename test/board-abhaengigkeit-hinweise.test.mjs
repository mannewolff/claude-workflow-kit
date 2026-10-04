// Hinweise zum Abschnitt `## Abhaengigkeiten` beim Schreiben (Issue #1060, Plan #1057 E4, E5).
//
// Der Nachtlauf liest jede lokale `#N` im Abschnitt als Abhaengigkeit, auch in einer
// Erlaeuterung. `issue check-form`, `issue create` und `issue update` sagen das dem Autor
// sofort, im Kanal `hinweise`: ein Eintrag `schreibweise` je Nummer ausserhalb einer
// Verweiszeile, ein Eintrag `dokument` je Nummer, deren Karte ein Dokument ist, ein Eintrag
// `unbekannt` je Nummer, die das Board nicht kennt (Issue #1149). Keine neue
// Ablehnung — `ok` und Exit-Code bleiben, wie sie waren. Geprueft auf dem local-Adapter
// und dem Toolbox-Mock (Plan-Verifizierung 2).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard, board, runBoardAsync, starteServer } from "./helpers/board-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
const MIT_TOKEN = { TBX_TOKEN: "test-token" };

function paket(abhaengigkeiten, { kontext = "Warum." } = {}) {
  return `## Kontext
${kontext}

Autor-Modell: fixture-modell

## Aufgabe
In \`kit/board.mjs\` etwas aendern.

## Akzeptanzkriterium
- Ein Kommando liefert etwas.

## Abhängigkeiten
${abhaengigkeiten}
`;
}

// Issue #1149: Eine Nummer, die das Board nicht kennt, gilt als erfuellte Abhaengigkeit —
// ein Tippfehler faellt nur noch hier auf, als Hinweis ohne Ablehnung.
const unbekannt = (nummer, stelle) => ({
  art: "unbekannt", nummer, stelle,
  meldung: `#${nummer} steht nicht auf dem Board (archiviert oder nicht vorhanden?) — sie gilt als erfüllt`,
});

const PLAN_SATZ = "ein Plandokument wird nie durch Umsetzung erledigt";
const ANFORDERUNG_SATZ = "eine fachliche Anforderung oder Idee ist erst erledigt, wenn ihre Pakete fertig sind";

// --- local-Adapter ---

/** Ein lokales Fixture mit drei Dokumenten (#1 Plan, #2 Fachlich, #3 Idee) und einem Paket (#4). */
function mitLokal(fn) {
  const dir = setupProjekt(LOKAL, "board-abh-hinweise-");
  try {
    board(dir, "issue", "create", "--title", "[Plan] Ein Plan", "--body", "Plan-Modell: x");
    board(dir, "issue", "create", "--title", "[Fachlich] Eine Anforderung", "--body", "Autor-Modell: x");
    board(dir, "issue", "create", "--title", "[Idee] Eine Idee", "--body", "Autor-Modell: x");
    board(dir, "issue", "create", "--title", "Ein Paket", "--body", paket("Keine."));
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Die drei Schreibwege mit demselben Body; liefert je Weg { weg, res, json }. */
function alleWege(dir, body, titel = "Neues Paket") {
  const datei = join(dir, "body.md");
  writeFileSync(datei, body);
  const pruef = runBoard(dir, ["issue", "check-form", "--body-file", datei, "--title", titel]);
  const anlegen = runBoard(dir, ["issue", "create", "--title", titel, "--body-file", datei]);
  const aendern = runBoard(dir, ["issue", "update", "4", "--body-file", datei]);
  return [["check-form", pruef], ["create", anlegen], ["update", aendern]]
    .map(([weg, res]) => ({ weg, res, json: JSON.parse(res.stdout || "{}") }));
}

test("local: eine Nummer aus Erlaeuterungstext gibt einen Hinweis schreibweise mit Stelle, ohne Ablehnung", () => {
  mitLokal((dir) => {
    const body = paket("Issue #4\nNicht #999: das bleibt getrennt.");
    for (const { weg, res, json } of alleWege(dir, body)) {
      assert.equal(res.status, 0, `${weg}: ${res.stderr}`);
      if (weg === "check-form") assert.equal(json.ok, true);
      assert.deepEqual(json.hinweise, [{
        art: "schreibweise",
        nummer: 999,
        stelle: "Nicht #999: das bleibt getrennt.",
        meldung: "#999 zählt als Abhängigkeit — sie steht nicht in einer Verweiszeile (‚Issue #999‘): Nicht #999: das bleibt getrennt.",
      }, unbekannt(999, "Nicht #999: das bleibt getrennt.")], weg);
    }
    // Angelegt bzw. geaendert trotz Hinweis.
    assert.match(board(dir, "issue", "get", "5").body, /Nicht #999/);
    assert.match(board(dir, "issue", "get", "4").body, /Nicht #999/);
  });
});

test("local: Plan, Fachlich und Idee geben je einen Hinweis dokument, auch in einer Verweiszeile", () => {
  mitLokal((dir) => {
    const body = paket("Issue #1\n- Issue #2\n* Issue #3");
    for (const { weg, res, json } of alleWege(dir, body)) {
      assert.equal(res.status, 0, `${weg}: ${res.stderr}`);
      assert.deepEqual(json.hinweise, [
        { art: "dokument", nummer: 1, stelle: "Issue #1", meldung: `#1 ist ein Dokument ([Plan]), kein Arbeitspaket — ${PLAN_SATZ}` },
        { art: "dokument", nummer: 2, stelle: "- Issue #2", meldung: `#2 ist ein Dokument ([Fachlich]), kein Arbeitspaket — ${ANFORDERUNG_SATZ}` },
        { art: "dokument", nummer: 3, stelle: "* Issue #3", meldung: `#3 ist ein Dokument ([Idee]), kein Arbeitspaket — ${ANFORDERUNG_SATZ}` },
      ], weg);
    }
  });
});

test("local: ein Dokument in Erlaeuterungstext gibt beide Hinweise", () => {
  mitLokal((dir) => {
    const [pruef] = alleWege(dir, paket("Siehe Plan #1."));
    assert.deepEqual(pruef.json.hinweise.map((h) => h.art), ["schreibweise", "dokument"]);
  });
});

test("local: ein ruhiger Bestand gibt keinen Schluessel hinweise", () => {
  mitLokal((dir) => {
    for (const abschnitt of ["Keine.", "Issue #4\n- Issue #4 muss vorher fertig sein"]) {
      for (const { weg, res, json } of alleWege(dir, paket(abschnitt))) {
        assert.equal(res.status, 0, `${weg}: ${res.stderr}`);
        assert.equal("hinweise" in json, false, `${weg} bei ${JSON.stringify(abschnitt)}`);
      }
    }
  });
});

// Issue #1104: Der Zusatz `(wartet auf Push)` haengt an der Verweiszeile und macht sie nicht
// zu Erlaeuterungstext — `DEPS_VERWEISZEILE` bleibt unveraendert, kein Hinweis schreibweise.
test("local: eine Verweiszeile mit (wartet auf Push) gibt keinen Hinweis schreibweise", () => {
  mitLokal((dir) => {
    for (const abschnitt of ["Issue #4 (wartet auf Push)", "- Issue #4 (wartet auf Push)"]) {
      for (const { weg, res, json } of alleWege(dir, paket(abschnitt))) {
        assert.equal(res.status, 0, `${weg}: ${res.stderr}`);
        assert.equal("hinweise" in json, false, `${weg} bei ${JSON.stringify(abschnitt)}`);
      }
    }
  });
});

test("local: eine unbekannte Nummer in einer Verweiszeile gibt den Hinweis unbekannt, ohne Ablehnung", () => {
  mitLokal((dir) => {
    for (const { weg, res, json } of alleWege(dir, paket("Issue #777"))) {
      assert.equal(res.status, 0, `${weg}: ${res.stderr}`);
      if (weg === "check-form") assert.equal(json.ok, true);
      assert.deepEqual(json.hinweise, [unbekannt(777, "Issue #777")], weg);
    }
  });
});

test("local: eine Karte, die sich nicht lesen laesst, gibt keinen Hinweis unbekannt", () => {
  mitLokal((dir) => {
    // Ein Verzeichnis statt der Datei: Die Karte existiert, ihr Abruf scheitert.
    mkdirSync(join(dir, "issues", "0777.md"));
    const [pruef] = alleWege(dir, paket("Issue #777"));
    assert.equal(pruef.res.status, 0, pruef.res.stderr);
    assert.equal(pruef.json.ok, true);
    assert.equal("hinweise" in pruef.json, false);
  });
});

test("local: I3- und I4-Verstoesse weisen wie bisher ab, die Hinweise kommen hinzu", () => {
  mitLokal((dir) => {
    const datei = join(dir, "body.md");
    // I4: eine Herkunftszeile im Abschnitt.
    const i4 = paket("Issue #1\nPlan: Issue #1");
    writeFileSync(datei, i4);
    const res = runBoard(dir, ["issue", "check-form", "--body-file", datei, "--title", "Paket"]);
    assert.equal(res.status, 1);
    const json = JSON.parse(res.stdout);
    assert.equal(json.ok, false);
    assert.ok(json.verstoesse.some((v) => v.gate === "I4"), JSON.stringify(json.verstoesse));
    assert.ok(json.hinweise.some((h) => h.art === "dokument" && h.nummer === 1));

    // I3: Die Formpruefung sieht den Codeblock nicht und findet keine `#N` — der Nachtlauf
    // liest sie dort trotzdem, als Text.
    writeFileSync(datei, paket("Siehe unten.\n```\n#12\n```"));
    const i3 = runBoard(dir, ["issue", "check-form", "--body-file", datei, "--title", "Paket"]);
    assert.equal(i3.status, 1);
    const j3 = JSON.parse(i3.stdout);
    assert.ok(j3.verstoesse.some((v) => v.gate === "I3"), JSON.stringify(j3.verstoesse));
    assert.deepEqual(j3.hinweise.map((h) => [h.art, h.nummer]), [["schreibweise", 12], ["unbekannt", 12]]);
  });
});

test("local: check-form ueber die Kartennummer liefert die Hinweise ebenso", () => {
  mitLokal((dir) => {
    board(dir, "issue", "update", "4", "--body", paket("Issue #1"));
    const res = runBoard(dir, ["issue", "check-form", "4"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout).hinweise.map((h) => h.nummer), [1]);
  });
});

// --- Toolbox-Mock ---

function tbxKarte(number, title, column = "BACKLOG") {
  return { id: number * 100, number, title, body: "", column, position: 0 };
}

function gruppiert(karten) {
  const gruppen = {};
  for (const k of karten) {
    gruppen[k.column] ||= [];
    gruppen[k.column].push(k);
  }
  return gruppen;
}

async function mitToolbox(fn, { boardKaputt = false } = {}) {
  const karten = [tbxKarte(10, "[Plan] P"), tbxKarte(11, "[Fachlich] F"), tbxKarte(12, "[Idee] I"), tbxKarte(13, "Paket")];
  const { server, requests, host } = await starteServer((req) => {
    if (req.url === "/api/kanban/items" && req.method === "GET") {
      return boardKaputt ? { status: 500, json: { message: "kaputt" } } : { status: 200, json: gruppiert(karten) };
    }
    if (req.url === "/api/kanban/items" && req.method === "POST") return { status: 200, json: { id: 1400, number: 14 } };
    if (/^\/api\/kanban\/items\/\d+$/.test(req.url) && req.method === "PUT") return { status: 200, json: { ok: true } };
    if (/^\/api\/kanban\/items\/\d+\/comments$/.test(req.url)) return { status: 200, json: [] };
    return null;
  });
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-abh-hinweise-tbx-");
  try {
    return await fn(dir, requests);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
}

async function alleWegeTbx(dir, body) {
  const datei = join(dir, "body.md");
  writeFileSync(datei, body);
  const ergebnisse = [];
  for (const [weg, args] of [
    ["check-form", ["issue", "check-form", "--body-file", datei, "--title", "Paket"]],
    ["create", ["issue", "create", "--title", "Paket", "--body-file", datei]],
    ["update", ["issue", "update", "13", "--body-file", datei]],
  ]) {
    const res = await runBoardAsync(dir, args, MIT_TOKEN);
    ergebnisse.push({ weg, res, json: JSON.parse(res.stdout || "{}") });
  }
  return ergebnisse;
}

test("toolbox: Erlaeuterungstext und Dokumente geben ihre Hinweise, ohne Ablehnung", async () => {
  await mitToolbox(async (dir, requests) => {
    const body = paket("Issue #10\n- Issue #11\nIssue #12\nNicht #13: getrennt.");
    for (const { weg, res, json } of await alleWegeTbx(dir, body)) {
      assert.equal(res.status, 0, `${weg}: ${res.stderr}`);
      assert.deepEqual(json.hinweise.map((h) => [h.art, h.nummer]), [
        ["dokument", 10], ["dokument", 11], ["dokument", 12], ["schreibweise", 13],
      ], weg);
      assert.equal(json.hinweise[0].meldung, `#10 ist ein Dokument ([Plan]), kein Arbeitspaket — ${PLAN_SATZ}`);
    }
    assert.ok(requests.some((r) => r.method === "POST" && r.url === "/api/kanban/items"), "nicht angelegt");
    assert.ok(requests.some((r) => r.method === "PUT" && r.url === "/api/kanban/items/1300"), "nicht geaendert");
  });
});

test("toolbox: ein ruhiger Bestand gibt keinen Schluessel hinweise", async () => {
  await mitToolbox(async (dir) => {
    for (const { weg, res, json } of await alleWegeTbx(dir, paket("Issue #13"))) {
      assert.equal(res.status, 0, `${weg}: ${res.stderr}`);
      assert.equal("hinweise" in json, false, weg);
    }
  });
});

test("toolbox: eine Nummer, die nicht auf dem Board steht, gibt den Hinweis unbekannt, ohne Ablehnung", async () => {
  await mitToolbox(async (dir) => {
    for (const { weg, res, json } of await alleWegeTbx(dir, paket("Issue #99"))) {
      assert.equal(res.status, 0, `${weg}: ${res.stderr}`);
      if (weg === "check-form") assert.equal(json.ok, true);
      assert.deepEqual(json.hinweise, [unbekannt(99, "Issue #99")], weg);
    }
  });
});

test("toolbox: ein scheiternder Board-Abruf laesst check-form und create gelingen, ohne hinweise", async () => {
  // Nur diese beiden Wege brauchen die Board-Liste nicht selbst: Den Dokument-Hinweis
  // fragt allein das Nachschlagen der Karte ab, und das scheitert hier mit HTTP 500.
  await mitToolbox(async (dir, requests) => {
    const datei = join(dir, "body.md");
    writeFileSync(datei, paket("Issue #10"));
    for (const args of [
      ["issue", "check-form", "--body-file", datei, "--title", "Paket"],
      ["issue", "create", "--title", "Paket", "--body-file", datei],
    ]) {
      const res = await runBoardAsync(dir, args, MIT_TOKEN);
      assert.equal(res.status, 0, `${args[1]}: ${res.stderr}`);
      assert.equal("hinweise" in JSON.parse(res.stdout), false, args[1]);
    }
    assert.ok(requests.some((r) => r.method === "POST" && r.url === "/api/kanban/items"), "nicht angelegt");
  }, { boardKaputt: true });
});
