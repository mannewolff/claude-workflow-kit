// Lueckenhafte Antworten von gh und glab (Issue #405).
//
// Die Bestandstests fahren vollstaendige CLI-Antworten. Was hier geprueft wird, sind
// die Rueckfaelle fuer das, was fehlen kann: ein `project list` ohne `projects`, ein
// Status-Feld ohne `options`, ein Issue ohne `projectItems`, eine Item-Liste ohne
// `items`.
//
// Das ist kein konstruierter Fall. `gh` aendert sein JSON zwischen Versionen, und
// ein Feld, das gestern da war, kann heute fehlen — dann muss der Adapter eine
// Meldung liefern und nicht an `undefined.length` sterben. Genau so ist der
// Nachtlauf am 2026-07-09 gekippt.
//
// Seit Issue #1217 laufen die Tests im selben Prozess gegen kit/board/adapter.mjs:
// Tracker aus `resolveTracker`, cwd und Umgebung aus `imProjekt`. Wo die CLI frueher mit
// Exit ungleich 0 endete, wirft der Adapter jetzt sichtbar.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { setupProjekt, fakeCli, imProjekt, aufrufe, MIT_DATEIRECHTEN } from "./helpers/adapter-fixture.mjs";
import { mitStderr } from "./helpers/board-github-fixture.mjs";
import { resolveTracker } from "../kit/board/adapter.mjs";

const GITHUB = { codeHost: "github", issueTracker: "github", github: { projectNumber: 14 } };
const GITHUB_OHNE_NUMMER = { codeHost: "github", issueTracker: "github" };
const GITLAB = { codeHost: "gitlab", issueTracker: "gitlab" };

const OPTIONEN = [
  { id: "opt-backlog", name: "Backlog" },
  { id: "opt-ready", name: "Ready" },
  { id: "opt-progress", name: "In progress" },
  { id: "opt-review", name: "In review" },
  { id: "opt-done", name: "Done" },
];

function graphqlItem(itemId = "ITEM_1") {
  return {
    data: {
      repository: {
        issue: {
          projectItems: { nodes: [{ id: itemId, project: { number: 14, owner: { login: "besitzer" } } }] },
        },
      },
    },
  };
}

function basisRegeln() {
  return [
    { match: "^repo view", stdout: "besitzer/mein-repo\n" },
    { match: "^project list", stdout: { projects: [{ number: 14, title: "Mein Board", id: "PVT_1" }] } },
    { match: "^project field-list", stdout: { fields: [{ id: "FELD_STATUS", name: "Status", options: OPTIONEN }] } },
    { match: "^api graphql", stdout: graphqlItem() },
    { match: "^project item-list", stdout: { items: [] } },
    { match: "^project item-edit", stdout: "" },
    { match: "^issue list", stdout: [] },
    { match: "^issue create", stdout: "https://github.com/besitzer/mein-repo/issues/42\n" },
  ];
}

// `fn` bekommt dir und einen Tracker-Bauer: Jeder CLI-Aufruf von frueher baut seinen
// Tracker neu, darum hier `neuerTracker()` je nachgestelltem Aufruf.
async function mitGh(fn, { regeln = [], config = GITHUB, praefix = "board-adapter-gh-" } = {}) {
  const dir = setupProjekt(config, praefix);
  fakeCli(dir, "gh", [...regeln, ...basisRegeln()]);
  try {
    return await imProjekt(dir, () => fn({ dir, neuerTracker: () => resolveTracker(config) }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Der Wert hinter einem Flag im letzten Aufruf eines Fakes, der auf `praefix` beginnt. */
function flagWert(dir, cli, praefix, flag) {
  const argv = aufrufe(dir, cli).findLast((a) => a.join(" ").startsWith(praefix));
  assert.ok(argv, `kein Aufruf '${cli} ${praefix}'`);
  return argv[argv.indexOf(flag) + 1];
}

// ============================================================
// GitHub: fehlende Felder in den gh-Antworten
// ============================================================

test("ein 'project list' ohne projects-Feld gilt als 'kein Project'", async () => {
  // Ohne den Rueckfall auf die leere Liste stuende hier `undefined.length` — ein
  // Absturz statt der Meldung, die der Anwender braucht.
  //
  // Zwei Wege fuehren durch diese Stelle, und sie enden verschieden: `issue move`
  // braucht das Project zwingend und scheitert mit Anleitung; `issue list --status`
  // faellt auf alle offenen Issues zurueck (Bestandsverhalten), damit ein Lesezugriff
  // an einer fehlenden Projektnummer nicht stirbt.
  await mitGh(async ({ neuerTracker }) => {
    await assert.rejects(neuerTracker().moveIssue("42", "ready"), (e) => {
      assert.match(e.message, /hat kein GitHub Project/, "die Lage wird nicht benannt");
      assert.match(e.message, /"github": \{ "projectNumber": <N> \}/, "die Anleitung fehlt");
      return true;
    }, "ohne Project haette der move scheitern muessen");

    const { wert } = await mitStderr(() => neuerTracker().listIssues("ready"));
    assert.deepEqual(wert, [], "der Rueckfall liefert die offenen Issues");
  }, { regeln: [{ match: "^project list", stdout: {} }], config: GITHUB_OHNE_NUMMER, praefix: "board-adapter-ohne-projects-" });
});

test("ein Status-Feld ohne options meldet den fehlenden Status statt zu crashen", async () => {
  await mitGh(async ({ neuerTracker }) => {
    await assert.rejects(neuerTracker().moveIssue("42", "ready"), /Status 'ready' hat keine Entsprechung im GitHub Project/,
      "ohne Optionen haette der move mit dem gesuchten Status scheitern muessen");
  }, {
    regeln: [{ match: "^project field-list", stdout: { fields: [{ id: "F", name: "Status" }] } }],
    praefix: "board-adapter-ohne-optionen-",
  });
});

test("eine field-list ohne fields-Feld wird als fehlendes Status-Feld gemeldet", async () => {
  await mitGh(async ({ neuerTracker }) => {
    await assert.rejects(neuerTracker().moveIssue("42", "ready"), /Status/,
      "ohne Felder haette der move mit dem fehlenden Feld scheitern muessen");
  }, { regeln: [{ match: "^project field-list", stdout: {} }], praefix: "board-adapter-ohne-fields-" });
});

test("ein Issue ohne projectItems liegt nicht auf dem Board", async () => {
  await mitGh(async ({ neuerTracker }) => {
    await assert.rejects(neuerTracker().moveIssue("42", "ready"), /Board|Project/i,
      "ein Issue ohne Board-Eintrag haette mit der Ursache scheitern muessen");
  }, {
    regeln: [{ match: "^api graphql", stdout: { data: { repository: { issue: {} } } } }],
    praefix: "board-adapter-ohne-items-",
  });
});

test("eine item-list ohne items-Feld liefert eine leere Liste", async () => {
  // Der Status-Filter laeuft ueber das Project. Fehlt das Feld, ist die richtige
  // Antwort "keine Treffer" — nicht ein Absturz und auch nicht "alle Issues".
  await mitGh(async ({ neuerTracker }) => {
    assert.deepEqual(await neuerTracker().listIssues("ready"), [], "eine fehlende Item-Liste muss leer bleiben");
  }, { regeln: [{ match: "^project item-list", stdout: {} }], praefix: "board-adapter-ohne-itemliste-" });
});

test("ein Project-Item ohne status faellt aus dem Statusfilter", async () => {
  await mitGh(async ({ neuerTracker }) => {
    assert.deepEqual(await neuerTracker().listIssues("ready"), [],
      "ein Item ohne Status darf keinem Status zugeordnet werden");
  }, {
    regeln: [{ match: "^project item-list", stdout: { items: [{ content: { number: 42 } }] } }],
    praefix: "board-adapter-item-ohne-status-",
  });
});

test("issue create ohne --body schickt einen leeren Body statt 'undefined'", async () => {
  // Die CLI setzt vorher die Autor-Modell-Zeile (#266); der Adapter selbst muss aber
  // auch einen fehlenden Body vertragen. Geprueft wird, was wirklich an gh geht.
  await mitGh(async ({ dir, neuerTracker }) => {
    const angelegt = await mitStderr(() => neuerTracker().createIssue({ title: "Ohne Body" }));
    assert.ok(!JSON.stringify(angelegt.wert).includes("undefined"), "'undefined' steht im Ergebnis");
    assert.equal(flagWert(dir, "gh", "issue create", "--body"), "", "der Body ist nicht leer");
  }, { praefix: "board-adapter-create-ohne-body-" });
});

test("ein korrupter Auto-Cache wird wie ein Cache-Miss behandelt", async () => {
  await mitGh(async ({ dir, neuerTracker }) => {
    // Der Cache liegt da, ist aber unlesbar. Der Adapter muss ihn uebergehen und
    // neu ermitteln, statt daran zu scheitern.
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "board-meta-cache.json"), "{kein JSON", "utf-8");

    const { stderr } = await mitStderr(() => neuerTracker().listIssues("ready"));

    assert.match(stderr, /automatisch erkanntes einziges GitHub Project/,
      "die Projektnummer wurde nicht neu ermittelt");
  }, { config: GITHUB_OHNE_NUMMER, praefix: "board-adapter-cache-kaputt-" });
});

test("ein Auto-Cache ohne projectNumber gilt als leer", async () => {
  await mitGh(async ({ dir, neuerTracker }) => {
    // Syntaktisch gueltiges JSON, aber der Eintrag traegt die Nummer nicht — etwa
    // aus einer aelteren Kit-Version. Auch das ist ein Cache-Miss.
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "board-meta-cache.json"),
      JSON.stringify({ "besitzer#auto": {} }), "utf-8");

    const { stderr } = await mitStderr(() => neuerTracker().listIssues("ready"));

    assert.match(stderr, /automatisch erkanntes einziges GitHub Project/,
      "der halbe Cache-Eintrag wurde als Treffer gewertet");
  }, { config: GITHUB_OHNE_NUMMER, praefix: "board-adapter-cache-halb-" });
});

// ============================================================
// GitLab
// ============================================================

test("glab: issue create ohne --body schickt eine leere Beschreibung", async () => {
  const dir = setupProjekt(GITLAB, "board-adapter-glab-create-");
  try {
    fakeCli(dir, "glab", [
      { match: "^issue create", stdout: "https://gitlab.com/gruppe/repo/-/issues/7\n" },
    ]);

    const angelegt = await imProjekt(dir, () => resolveTracker(GITLAB).createIssue({ title: "Ohne Body" }));

    assert.ok(!JSON.stringify(angelegt).includes("undefined"), "'undefined' steht im Ergebnis");
    assert.equal(flagWert(dir, "glab", "issue create", "--description"), "", "die Beschreibung ist nicht leer");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("glab: ein Status ohne Label-Zuordnung wird woertlich als Label genutzt", async () => {
  // `columnLabels(config)[status] || status`: Fuer einen Status, den die
  // Spaltentabelle nicht fuehrt, gilt der Statusname selbst. Ohne diesen Rueckfall
  // stuende `--label undefined` in der Kommandozeile.
  const config = { ...GITLAB, columns: { backlog: "Backlog", ready: "Ready", in_progress: "In progress", in_review: "In review", done: "Done" } };
  const dir = setupProjekt(config, "board-adapter-glab-status-");
  try {
    fakeCli(dir, "glab", [{ match: "^issue list", stdout: [] }]);

    const liste = await imProjekt(dir, () => resolveTracker(config).listIssues("ready"));

    assert.deepEqual(liste, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// exec: das Werkzeug selbst
// ============================================================

test("ein nicht ausfuehrbares gh meldet den Systemfehler, nicht 'nicht gefunden'", MIT_DATEIRECHTEN, async () => {
  const dir = setupProjekt(GITHUB, "board-adapter-eacces-");
  try {
    // Eine Datei ohne Ausfuehrungsrecht: spawnSync liefert EACCES statt ENOENT — der
    // zweite Zweig der Fehlerbehandlung, den die ENOENT-Meldung sonst verdeckt.
    const binDir = join(dir, "fakebin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "gh"), "#!/bin/sh\necho hi\n", { mode: 0o644 });

    await assert.rejects(
      imProjekt(dir, () => resolveTracker(GITHUB).listIssues(), { PATH: binDir }),
      (e) => {
        assert.match(e.message, /EACCES|permission denied/i, "der Systemfehler fehlt");
        assert.doesNotMatch(e.message, /nicht gefunden — ist es installiert/,
          "ein Rechteproblem darf nicht als 'nicht installiert' gemeldet werden");
        return true;
      },
      "ein nicht startbares gh haette scheitern muessen",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
