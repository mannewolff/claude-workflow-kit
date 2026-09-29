// `issue auftrag` — Aufgabe, Voraussetzungen und das Urteil "darf beginnen" in einem Zug
// (Issue #1023, Plan #1015 E2, E3, E5, E6).
//
// Der Befehl ist rein lesend: Er bewegt keine Karte und schreibt keinen Kommentar. Bei
// Folge "backlog" liefert er den Kommentartext, den die Session selbst ans Board haengt.
//
// Je Adapter dieselben Faelle ueber das echte CLI: local direkt, GitHub und GitLab mit
// Fake-gh/-glab, toolbox gegen einen Mock-Server. Dazu zwei Gleichlauf-Tests gegen
// kit/night.mjs: Abhaengigkeitslesung gegen `parseDeps`, Backlog-Texte gegen die
// `Nachtlauf: `-Texte in `pruefeIssueGates`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard, runBoardAsync, fakeCli, aufrufe, starteServer, toolboxMitKommentaren } from "./helpers/board-fixture.mjs";
import { NUR_POSIX, GITHUB, basisRegeln as ghBasis } from "./helpers/board-github-fixture.mjs";
import { GITLAB, basisRegeln as glabBasis } from "./helpers/board-gitlab-fixture.mjs";
import { AUFTRAG_BACKLOG_TEXTE, abhaengigkeitenLesen, fenceLauf } from "../kit/board.mjs";
import { parseDeps, pruefeIssueGates } from "../kit/night.mjs";

// --- Das gemeinsame Board ---
//
// Jede Karte steht fuer genau ein Urteil. 20 bis 22 sind Voraussetzungen, 99 fehlt.

const deps = (...nummern) => `## Abhängigkeiten\n${nummern.length ? nummern.map((n) => "Issue #" + n).join("\n") : "Keine."}\n`;
const body = (...nummern) => `## Kontext\nText.\n\n## Aufgabe\nTun.\n\n## Akzeptanzkriterium\n- gruen\n\n${deps(...nummern)}`;

const KARTEN = [
  { nr: 10, spalte: "ready", titel: "Paket frei", body: body() },
  { nr: 11, spalte: "in_progress", titel: "Paket in Arbeit", body: body() },
  { nr: 12, spalte: "ready", titel: "[Fachlich] Anforderung", body: body() },
  { nr: 13, spalte: "ready", titel: "[Idee] Einfall", body: body() },
  { nr: 14, spalte: "ready", titel: "[Plan] Weg", body: body() },
  { nr: 15, spalte: "ready", titel: "[Mensch] Zugang anlegen", body: body() },
  { nr: 16, spalte: "ready", titel: "Paket mit Frage", body: body(), labels: ["kit:klaeren"] },
  { nr: 17, spalte: "ready", titel: "Paket wartet", body: body(20) },
  { nr: 18, spalte: "ready", titel: "Paket mit Phantom", body: body(99) },
  { nr: 19, spalte: "ready", titel: "Rueckläufer", body: body(21, 22), kommentare: ["Review: Test fehlt."] },
  { nr: 20, spalte: "ready", titel: "Voraussetzung offen", body: body() },
  { nr: 21, spalte: "in_review", titel: "Voraussetzung im Review", body: body() },
  { nr: 22, spalte: "done", titel: "Voraussetzung fertig", body: body() },
];

const GLIEDER = ["Urteil", "Aufgabe", "Plan-Entscheidungen", "Fachlicher Anlass", "Geschwister", "Voraussetzungen", "Lücken"];

// Die `##`-Ueberschriften ausserhalb von Codebloecken — der Body steht eingezaeunt darin.
function ueberschriften(markdown) {
  const imFence = fenceLauf();
  return markdown.split("\n").filter((z) => !imFence(z) && /^## /.test(z)).map((z) => z.slice(3).trim());
}

function json(res) {
  assert.equal(res.status, 0, `Exit ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/**
 * Die Faelle, die jeder Adapter erfuellen muss. `lauf(args)` ruft `issue auftrag` und
 * liefert { status, stdout, stderr }; `zustand()` liefert, was sich am Board aendern
 * koennte (Spalte und Kommentare), fuer den Vorher-nachher-Vergleich.
 */
async function adapterFaelle(t, lauf, zustand) {
  const auftrag = async (...args) => json(await lauf(["issue", "auftrag", ...args, "--json"]));

  await t.test("darf beginnen", async () => {
    const a = await auftrag("10");
    assert.equal(a.urteil.urteil, "darf beginnen");
    assert.equal(a.urteil.folge, "beginnen");
    assert.equal(a.aufgabe.titel, "Paket frei");
    assert.equal(a.aufgabe.spalte, "ready");
    assert.match(a.aufgabe.body, /## Aufgabe\nTun\./);
    assert.deepEqual(a.voraussetzungen, []);
  });

  await t.test("nicht in Ready -> bleibt", async () => {
    const a = await auftrag("11");
    assert.equal(a.urteil.urteil, "darf nicht beginnen");
    assert.equal(a.urteil.folge, "bleibt");
    assert.match(a.urteil.grund, /liegt nicht \(mehr\) in Ready/);
    assert.equal(a.urteil.kommentar, null);
  });

  await t.test("--spalte in_progress erwartet In progress", async () => {
    assert.equal((await auftrag("11", "--spalte", "in_progress")).urteil.folge, "beginnen");
    const a = await auftrag("10", "--spalte", "in_progress");
    assert.equal(a.urteil.folge, "bleibt");
    assert.match(a.urteil.grund, /liegt nicht \(mehr\) in In progress/);
  });

  const backlogFaelle = [
    ["12", "[Fachlich]", AUFTRAG_BACKLOG_TEXTE.fachlich("12")],
    ["13", "[Idee]", AUFTRAG_BACKLOG_TEXTE.idee("13")],
    ["14", "[Plan]", AUFTRAG_BACKLOG_TEXTE.plan("14")],
    ["15", "[Mensch]", AUFTRAG_BACKLOG_TEXTE.mensch("15")],
    ["16", "kit:klaeren", AUFTRAG_BACKLOG_TEXTE.klaeren("16")],
  ];
  for (const [nr, was, text] of backlogFaelle) {
    await t.test(`${was} -> backlog mit Kommentartext, Karte unveraendert`, async () => {
      const vorher = await zustand(nr);
      const a = await auftrag(nr);
      assert.equal(a.urteil.urteil, "darf nicht beginnen");
      assert.equal(a.urteil.folge, "backlog");
      assert.equal(a.urteil.kommentar, text);
      const md = await lauf(["issue", "auftrag", nr]);
      assert.equal(md.status, 0);
      assert.ok(md.stdout.includes(text), "der Kommentartext steht woertlich in der Markdown-Ausgabe");
      assert.deepEqual(await zustand(nr), vorher, "weder Spalte noch Kommentare veraendert");
    });
  }

  await t.test("Voraussetzung unerfuellt -> bleibt", async () => {
    const a = await auftrag("17");
    assert.equal(a.urteil.folge, "bleibt");
    assert.deepEqual(a.voraussetzungen, [{ id: "20", titel: "Voraussetzung offen", spalte: "ready", befund: "unerfuellt" }]);
  });

  await t.test("Voraussetzung nicht feststellbar -> bleibt und steht unter Luecken", async () => {
    const a = await auftrag("18");
    assert.equal(a.urteil.folge, "bleibt");
    assert.equal(a.voraussetzungen.length, 1);
    assert.equal(a.voraussetzungen[0].id, "99");
    assert.equal(a.voraussetzungen[0].befund, "nicht feststellbar");
    assert.ok(a.luecken.some((l) => l.includes("#99")));
  });

  await t.test("Voraussetzungen in In review und Done -> darf beginnen; Ruecklaeufer zeigt Kommentare", async () => {
    const vorher = await zustand("19");
    const a = await auftrag("19");
    assert.equal(a.urteil.folge, "beginnen");
    assert.deepEqual(a.voraussetzungen.map((v) => [v.id, v.spalte, v.befund]), [["21", "in_review", "erfuellt"], ["22", "done", "erfuellt"]]);
    assert.ok(a.aufgabe.kommentare.some((k) => k.body.includes("Review: Test fehlt.")));
    const md = (await lauf(["issue", "auftrag", "19"])).stdout;
    assert.ok(md.includes("Review: Test fehlt."), "der Kommentar steht im Glied Aufgabe");
    assert.deepEqual(await zustand("19"), vorher);
  });

  await t.test("Markdown: sieben Glieder in fester Reihenfolge, fehlende unter Luecken", async () => {
    const res = await lauf(["issue", "auftrag", "10"]);
    assert.equal(res.status, 0);
    assert.deepEqual(ueberschriften(res.stdout), GLIEDER);
    const luecken = res.stdout.slice(res.stdout.lastIndexOf("## Lücken"));
    for (const glied of ["Plan-Entscheidungen", "Fachlicher Anlass", "Geschwister"]) {
      assert.match(luecken, new RegExp(`${glied}: noch nicht ermittelt`));
    }
  });

  await t.test("--json: jedes Glied als eigenes Feld", async () => {
    const a = await auftrag("10");
    assert.deepEqual(Object.keys(a), ["id", "urteil", "aufgabe", "planEntscheidungen", "fachlicherAnlass", "geschwister", "voraussetzungen", "luecken"]);
    assert.equal(a.planEntscheidungen, null);
    assert.equal(a.fachlicherAnlass, null);
    assert.equal(a.geschwister, null);
    assert.equal(a.luecken.filter((l) => l.endsWith("noch nicht ermittelt")).length, 3);
  });

  await t.test("nicht lesbares Paket -> Exit 1", async () => {
    const res = await lauf(["issue", "auftrag", "99"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /99/);
  });
}

// --- local ---

function lokalDatei(k) {
  const labels = k.labels ? `labels: ${k.labels.join(", ")}\n` : "";
  let inhalt = `---\nid: "${String(k.nr).padStart(4, "0")}"\ntype: task\nstatus: ${k.spalte}\ntitle: ${k.titel}\n${labels}---\n\n${k.body}`;
  for (const c of k.kommentare || []) inhalt += `\n\n---\n**Kommentar** (2026-09-28 08:00)\n\n${c}`;
  return inhalt;
}

test("local", async (t) => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } }, "board-auftrag-local-");
  mkdirSync(join(dir, "issues"));
  for (const k of KARTEN) writeFileSync(join(dir, "issues", `${String(k.nr).padStart(4, "0")}.md`), lokalDatei(k));
  const zustand = (nr) => readFileSync(join(dir, "issues", `${nr.padStart(4, "0")}.md`), "utf-8");
  try {
    await adapterFaelle(t, async (args) => runBoard(dir, args), zustand);
    await t.test("rein lesend: kein Bewegungsprotokoll, keine Berichtsstuecke", () => {
      assert.deepEqual(readdirSync(join(dir, ".claude")).sort(), ["workflow.config.json"]);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- GitHub ---

const GH_STATUS = { ready: "Ready", in_progress: "In progress", in_review: "In review", done: "Done" };
const ghKommentar = (i, text) => ({
  id: `IC_${i}`, url: `https://github.com/besitzer/mein-repo/issues/19#issuecomment-${500 + i}`,
  author: { login: "manne" }, body: text, createdAt: "2026-09-28T08:00:00Z",
});

function ghRegeln() {
  const regeln = KARTEN.map((k) => ({
    match: `^issue view ${k.nr} `,
    stdout: {
      number: k.nr, title: k.titel, body: k.body, state: k.spalte === "done" ? "CLOSED" : "OPEN",
      labels: (k.labels || []).map((name) => ({ name })),
      comments: (k.kommentare || []).map((c, i) => ghKommentar(i, c)),
      createdAt: "2026-09-27T08:00:00Z",
    },
  }));
  regeln.push({ match: "^issue view 99 ", stderr: "GraphQL: Could not resolve to an issue with the number of 99.\n", exit: 1 });
  regeln.push({
    match: "^project item-list",
    stdout: { items: KARTEN.map((k) => ({ status: GH_STATUS[k.spalte], content: { number: k.nr, title: k.titel } })) },
  });
  regeln.push({
    match: "^issue list .*--state all",
    stdout: KARTEN.map((k) => ({ number: k.nr, labels: (k.labels || []).map((name) => ({ name })) })),
  });
  return regeln;
}

const ghSchreibend = (argv) => (argv[0] === "issue" && ["comment", "edit", "close", "reopen"].includes(argv[1]))
  || (argv[0] === "project" && ["item-edit", "item-add"].includes(argv[1]))
  || argv.includes("PATCH");

test("GitHub", NUR_POSIX, async (t) => {
  const dir = setupProjekt(GITHUB, "board-auftrag-gh-");
  fakeCli(dir, "gh", [...ghRegeln(), ...ghBasis()]);
  const zustand = () => aufrufe(dir, "gh").filter(ghSchreibend);
  try {
    await adapterFaelle(t, async (args) => runBoard(dir, args), zustand);
    await t.test("kein schreibender gh-Aufruf", () => assert.deepEqual(zustand(), []));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- GitLab ---

const GL_LABEL = { ready: "Ready", in_progress: "In progress", in_review: "In review" };

function glRegeln() {
  const regeln = [];
  for (const k of KARTEN) {
    regeln.push({
      match: `^issue view ${k.nr} `,
      stdout: {
        iid: k.nr, title: k.titel, description: k.body, state: k.spalte === "done" ? "closed" : "opened",
        labels: [...(k.labels || []), ...(GL_LABEL[k.spalte] ? [GL_LABEL[k.spalte]] : [])],
        created_at: "2026-09-27T08:00:00Z",
      },
    });
    regeln.push({
      match: `^api projects/:id/issues/${k.nr}/notes$`,
      stdout: (k.kommentare || []).map((c, i) => ({ id: 70 + i, author: { username: "manne" }, body: c, created_at: "2026-09-28T08:00:00Z" })),
    });
  }
  regeln.push({ match: "^issue view 99 ", stderr: "404 Not Found\n", exit: 1 });
  return regeln;
}

const glSchreibend = (argv) => (argv[0] === "issue" && ["update", "note", "close", "reopen"].includes(argv[1]))
  || argv.includes("PUT") || argv.includes("POST");

test("GitLab", NUR_POSIX, async (t) => {
  const dir = setupProjekt(GITLAB, "board-auftrag-glab-");
  fakeCli(dir, "glab", [...glRegeln(), ...glabBasis()]);
  const zustand = () => aufrufe(dir, "glab").filter(glSchreibend);
  try {
    await adapterFaelle(t, async (args) => runBoard(dir, args), zustand);
    await t.test("kein schreibender glab-Aufruf", () => assert.deepEqual(zustand(), []));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- toolbox ---

const TBX_SPALTE = { ready: "READY", in_progress: "IN_PROGRESS", in_review: "IN_REVIEW", done: "DONE" };

test("toolbox", async (t) => {
  const karten = KARTEN.map((k, i) => ({
    id: 900 + k.nr, number: k.nr, title: k.titel, body: k.body, column: TBX_SPALTE[k.spalte], position: i,
    labels: (k.labels || []).map((name) => ({ name })),
  }));
  const kommentare = {};
  for (const k of KARTEN) {
    kommentare[900 + k.nr] = (k.kommentare || []).map((c, i) => ({ id: 40 + i, author: "manne", body: c, createdAt: "2026-09-28T08:00:00Z" }));
  }
  const { server, requests, host } = await starteServer(toolboxMitKommentaren({ karten, kommentare }));
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-auftrag-tbx-");
  const zustand = (nr) => {
    const karte = karten.find((k) => String(k.number) === nr);
    return JSON.stringify({ spalte: karte.column, kommentare: kommentare[karte.id] });
  };
  try {
    await adapterFaelle(t, (args) => runBoardAsync(dir, args, { TBX_TOKEN: "test-token" }), zustand);
    await t.test("nur lesende Requests", () => {
      assert.deepEqual(requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`), []);
    });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Aufrufformen ---

test("ohne id und mit falscher --spalte: Exit 1", () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } }, "board-auftrag-args-");
  mkdirSync(join(dir, "issues"));
  writeFileSync(join(dir, "issues", "0010.md"), lokalDatei(KARTEN[0]));
  try {
    assert.equal(runBoard(dir, ["issue", "auftrag"]).status, 1);
    const res = runBoard(dir, ["issue", "auftrag", "10", "--spalte", "done"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--spalte/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Gleichlauf: Abhaengigkeitslesung gegen parseDeps ---

const DEPS_FIXTURES = [
  body(),
  body(3, 4),
  "## Abhaengigkeiten\n#7, #8 und #7\n",
  "## Kontext\nsiehe #5\n\n## Abhängigkeiten\nIssue #6\n\n## Nachtrag\n#9\n",
  "## Abhängigkeiten\n```\n## Aufgabe\n#11\n```\n#12\n",
  "```\n## Abhängigkeiten\n#13\n```\n\n## Abhängigkeiten\n#14\n",
  "## Abhängigkeiten\n`owner/repo`#245 und repo#246 und #247\n",
  "Im Fliesstext: ## Abhängigkeiten #15\n",
  "## Abhängigkeiten\n#16\n\n## Abhängigkeiten\n#17\n",
  "   ##  abhängigkeiten  \r\n#18\r\n",
  "",
];

function depsAbweichungen(lesen, vergleich) {
  return DEPS_FIXTURES.filter((b) => JSON.stringify(lesen(b)) !== JSON.stringify(vergleich(b)));
}

test("Gleichlauf: die Abhaengigkeitslesung stimmt auf allen Fixtures mit parseDeps ueberein", () => {
  assert.deepEqual(depsAbweichungen(abhaengigkeitenLesen, parseDeps), []);
  assert.deepEqual(abhaengigkeitenLesen(body(3, 4)), [3, 4]);
});

test("Gleichlauf: eine abweichende Kopie der Lesung faellt auf", () => {
  const fenceBlind = (b) => abhaengigkeitenLesen(b.replaceAll("```", ""));
  const ohneDedupe = (b) => [...String(b).matchAll(/(?<![\w`/#])#(\d+)/g)].map((m) => Number(m[1]));
  assert.notDeepEqual(depsAbweichungen(fenceBlind, parseDeps), []);
  assert.notDeepEqual(depsAbweichungen(ohneDedupe, parseDeps), []);
});

// --- Gleichlauf: Backlog-Kommentartexte gegen kit/night.mjs ---

const TEXT_FAELLE = [
  ["fachlich", { id: "41", title: "[Fachlich] X", labels: [] }],
  ["idee", { id: "42", title: "[Idee] X", labels: [] }],
  ["plan", { id: "43", title: "[Plan] X", labels: [] }],
  ["mensch", { id: "44", title: "[Mensch] X", labels: [] }],
  ["klaeren", { id: "45", title: "Paket", labels: ["kit:klaeren"] }],
];

function textAbweichungen(texte, gates) {
  return TEXT_FAELLE
    .filter(([art, issue]) => `Nachtlauf: ${texte[art](issue.id)}` !== gates(issue)?.kommentar)
    .map(([art]) => art);
}

test("Gleichlauf: die Backlog-Texte gleichen den Nachtlauf-Texten ohne Praefix", () => {
  assert.deepEqual(Object.keys(AUFTRAG_BACKLOG_TEXTE).sort(), TEXT_FAELLE.map(([a]) => a).sort());
  assert.deepEqual(textAbweichungen(AUFTRAG_BACKLOG_TEXTE, pruefeIssueGates), []);
});

test("Gleichlauf: ein abweichender Text auf einer Seite faellt auf", () => {
  const kopie = { ...AUFTRAG_BACKLOG_TEXTE, idee: (id) => AUFTRAG_BACKLOG_TEXTE.idee(id).replace("wird nicht", "wird nachts nicht") };
  assert.deepEqual(textAbweichungen(kopie, pruefeIssueGates), ["idee"]);
  const nachtAnders = (issue) => {
    const r = pruefeIssueGates(issue);
    return issue.labels.length ? { ...r, kommentar: `${r.kommentar} ` } : r;
  };
  assert.deepEqual(textAbweichungen(AUFTRAG_BACKLOG_TEXTE, nachtAnders), ["klaeren"]);
});
