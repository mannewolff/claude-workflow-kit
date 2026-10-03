// `issue melden` — Abschlussbericht je Lauf idempotent ablegen und nach In review
// ziehen (Issue #1022, Plan #1015 E2, E8, E9, E10).
//
// Ein Aufruf ersetzt die Folge `issue move … in_review` plus Zwischendatei plus
// `issue comment --text-file`. Die Laufkennung ist der Zeitstempel des juengsten Zugs
// der Karte nach In progress aus `.claude/bewegungen.tsv`; der Bericht traegt sie als
// letzte Zeile `Bericht-Lauf: <stempel>`. Daran findet eine Wiederholung ihren eigenen
// Bericht wieder: gleicher Inhalt -> nichts schreiben, anderer -> ersetzen. Berichte
// anderer Laeufe bleiben unberuehrt.
//
// Geprueft je Adapter ueber das echte CLI: local direkt, GitHub und GitLab mit
// Fake-gh/-glab, toolbox gegen einen Mock-Server mit und ohne PATCH-Route.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, chmodSync } from "node:fs";
import { join } from "node:path";

import {
  setupProjekt, runBoard, runBoardAsync, fakeCli, aufrufe, starteServer, toolboxMitKommentaren,
  BOARD, TEST_TOOLBOX_BUDGET_MS,
} from "./helpers/board-fixture.mjs";
import { GITHUB, basisRegeln as ghBasis } from "./helpers/board-github-fixture.mjs";
import { GITLAB, basisRegeln as glabBasis } from "./helpers/board-gitlab-fixture.mjs";

const STEMPEL = "2026-09-29T09:00:00.000Z";
const LAUF = `Bericht-Lauf: ${STEMPEL}`;
const ALT_LAUF = "Bericht-Lauf: 2026-09-28T07:00:00.000Z";

// Zwei Laeufe derselben Karte, dazwischen ein Ruecklaeufer, und eine fremde Karte mit
// juengerem Zug: gezaehlt wird nur der juengste in_progress-Zug DIESER Karte.
function bewegungenText(id) {
  return [
    `2026-09-28T07:00:00.000Z\t${id}\tin_progress`,
    `2026-09-28T08:00:00.000Z\t${id}\tin_review`,
    `2026-09-28T09:00:00.000Z\t${id}\tbacklog`,
    `2026-09-29T08:00:00.000Z\t${id}\tready`,
    `${STEMPEL}\t${id}\tin_progress`,
    `2026-09-29T09:30:00.000Z\t99\tin_progress`,
    "",
  ].join("\n");
}

function schreibeBewegungen(dir, id) {
  writeFileSync(join(dir, ".claude", "bewegungen.tsv"), bewegungenText(id), "utf-8");
}

function bewegungen(dir) {
  const p = join(dir, ".claude", "bewegungen.tsv");
  return existsSync(p) ? readFileSync(p, "utf-8").split("\n").filter(Boolean) : [];
}

const bericht = (text) => `${text}\n\n${LAUF}`;

function ausgabe(res) {
  assert.equal(res.status, 0, `Exit ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

// --- local ---

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
const LOKAL_KOPF = "---\nid: \"0005\"\ntype: task\nstatus: in_progress\ntitle: Paket\n---\n\n## Kontext\nText.\n";
const ALTER_BERICHT = `Bericht des ersten Laufs\n\n${ALT_LAUF}`;

function mitLokal(fn, { kommentare = [] } = {}) {
  const dir = setupProjekt(LOKAL, "board-melden-local-");
  mkdirSync(join(dir, "issues"), { recursive: true });
  const datei = join(dir, "issues", "0005.md");
  let inhalt = LOKAL_KOPF;
  for (const k of kommentare) inhalt += `\n\n---\n**Kommentar** (2026-09-28 08:00)\n\n${k}`;
  writeFileSync(datei, inhalt, "utf-8");
  schreibeBewegungen(dir, "5");
  try {
    return fn(dir, datei);
  } finally {
    try { chmodSync(datei, 0o644); } catch { /* schon weg */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

function lokalKommentare(datei) {
  return readFileSync(datei, "utf-8").split(/\n\n---\n\*\*Kommentar\*\* \([^)]*\)\n\n/).slice(1);
}

function lokalStatus(datei) {
  return readFileSync(datei, "utf-8").match(/^status: (\S+)$/m)[1];
}

test("local: zweimal gleicher Text legt genau einen Bericht an, der zweite meldet unveraendert", () => {
  mitLokal((dir, datei) => {
    const erst = ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Alles gruen."]));
    assert.deepEqual(erst, { ok: true, id: "5", bericht: "angelegt", status: "in_review" });
    const zweit = ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Alles gruen."]));
    assert.deepEqual(zweit, { ok: true, id: "5", bericht: "unveraendert", status: "in_review" });

    assert.deepEqual(lokalKommentare(datei), [bericht("Alles gruen.")]);
    assert.equal(lokalStatus(datei), "in_review");
    assert.ok(bewegungen(dir).some((z) => z.endsWith("\t5\tin_review") && !z.startsWith("2026-09-28")),
      "der Zug nach In review steht im Bewegungsprotokoll");
  });
});

test("local: geaenderter Text ersetzt den Bericht dieses Laufs, die Zahl bleibt", () => {
  mitLokal((dir, datei) => {
    ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Erste Fassung."]));
    const zweit = ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Zweite Fassung."]));
    assert.equal(zweit.bericht, "ersetzt");
    assert.deepEqual(lokalKommentare(datei), [bericht("Zweite Fassung.")]);
  });
});

test("local: ein Bericht mit aelterem Bericht-Lauf bleibt Byte fuer Byte", () => {
  mitLokal((dir, datei) => {
    const vorher = readFileSync(datei, "utf-8");
    ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Neu."]));
    ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Neu, geaendert."]));
    const nachher = readFileSync(datei, "utf-8");
    const altStueck = vorher.slice(vorher.indexOf("\n\n---\n**Kommentar**"));
    assert.ok(nachher.includes(altStueck), "der alte Bericht ist unveraendert");
    assert.deepEqual(lokalKommentare(datei), [ALTER_BERICHT, bericht("Neu, geaendert.")]);
  }, { kommentare: [ALTER_BERICHT] });
});

test("local: Karte nicht lesbar -> Exit 1, nichts geschrieben, Karte bleibt", () => {
  if (process.getuid?.() === 0) return; // root liest trotz chmod 000
  mitLokal((dir, datei) => {
    const vorher = readFileSync(datei, "utf-8");
    const zuegeVorher = bewegungen(dir);
    chmodSync(datei, 0o000);
    const res = runBoard(dir, ["issue", "melden", "5", "--text", "Bericht."]);
    chmodSync(datei, 0o644);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Kommentare.*nicht lesbar/);
    assert.equal(readFileSync(datei, "utf-8"), vorher);
    assert.deepEqual(bewegungen(dir), zuegeVorher, "kein Zug protokolliert");
  });
});

// --- Laufkennung ---

test("Laufkennung: bei geleerten Wegmarken kommt der Stempel aus bewegungen.tsv", () => {
  mitLokal((dir, datei) => {
    writeFileSync(join(dir, ".claude", "wegmarken.tsv"), "", "utf-8");
    ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Bericht."]));
    const [k] = lokalKommentare(datei);
    assert.equal(k.split("\n").at(-1), LAUF, "die letzte Zeile ist die Laufkennung");
  });
});

test("Laufkennung: fuehrende Nullen der Kartennummer aendern den Lauf nicht", () => {
  mitLokal((dir, datei) => {
    ausgabe(runBoard(dir, ["issue", "melden", "0005", "--text", "Bericht."]));
    assert.equal(lokalKommentare(datei)[0].split("\n").at(-1), LAUF);
  });
});

test("Laufkennung: ohne in_progress-Zug der Karte Exit 1 und nichts geschrieben", () => {
  mitLokal((dir, datei) => {
    writeFileSync(join(dir, ".claude", "bewegungen.tsv"),
      "2026-09-29T08:00:00.000Z\t5\tready\n2026-09-29T09:30:00.000Z\t99\tin_progress\n", "utf-8");
    const vorher = readFileSync(datei, "utf-8");
    const res = runBoard(dir, ["issue", "melden", "5", "--text", "Bericht."]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /in_progress/);
    assert.equal(readFileSync(datei, "utf-8"), vorher);
    assert.equal(bewegungen(dir).length, 2);
  });
});

test("Laufkennung: ohne bewegungen.tsv Exit 1 und nichts geschrieben", () => {
  mitLokal((dir, datei) => {
    rmSync(join(dir, ".claude", "bewegungen.tsv"));
    const vorher = readFileSync(datei, "utf-8");
    const res = runBoard(dir, ["issue", "melden", "5", "--text", "Bericht."]);
    assert.equal(res.status, 1);
    assert.equal(readFileSync(datei, "utf-8"), vorher);
  });
});

// --- Maskierung ---

test(String.raw`ein ' im Bericht, als '\'' in der Shell geschrieben, kommt unveraendert an`, () => {
  mitLokal((dir, datei) => {
    const text = "Die Session schreibt 'so' und it's fine.\nZweite Zeile mit \"Doppel\".";
    const ersatz = String.raw`'\''`;
    const maskiert = `'${text.replaceAll("'", ersatz)}'`;
    const env = { ...process.env, KIT_ROOT: dir, KIT_AGENT_MODEL: "fixture-modell", KIT_TOOLBOX_BUDGET_MS: TEST_TOOLBOX_BUDGET_MS };
    const res = spawnSync("sh", ["-c", `"${process.execPath}" "${BOARD}" issue melden 5 --text ${maskiert}`],
      { cwd: dir, encoding: "utf-8", env });
    ausgabe(res);
    assert.deepEqual(lokalKommentare(datei), [bericht(text)]);
  });
});

// --- Stueckelung ---

const berichteDir = (dir) => join(dir, ".claude", "berichte");

test("--teil: Stuecke ueber 6.000 Zeichen setzen sich in Nummernfolge zusammen und werden geraeumt", () => {
  mitLokal((dir, datei) => {
    const eins = `## Abschlussbericht\n${"a".repeat(3500)}`;
    const zwei = `### Hinweise\n${"b".repeat(3500)}`;
    const zehn = "### Entscheidungen\nkeine";
    // Ausser der Reihe geschrieben, Stueck 1 zweimal (die Wiederholung ueberschreibt).
    ausgabe(runBoard(dir, ["issue", "melden", "5", "--teil", "10", "--text", zehn]));
    ausgabe(runBoard(dir, ["issue", "melden", "5", "--teil", "2", "--text", zwei]));
    ausgabe(runBoard(dir, ["issue", "melden", "5", "--teil", "1", "--text", "vorlaeufig"]));
    const teil = ausgabe(runBoard(dir, ["issue", "melden", "5", "--teil", "1", "--text", eins]));
    assert.equal(teil.ok, true);
    assert.equal(teil.teil, 1);
    assert.equal(lokalKommentare(datei).length, 1, "ein Stueck beruehrt das Board nicht");
    assert.equal(lokalStatus(datei), "in_progress");
    assert.equal(readdirSync(berichteDir(dir)).length, 3);

    const fertig = ausgabe(runBoard(dir, ["issue", "melden", "5"]));
    assert.equal(fertig.bericht, "angelegt");
    const gesamt = `${eins}\n${zwei}\n${zehn}`;
    assert.ok(gesamt.length > 6000);
    assert.deepEqual(lokalKommentare(datei).slice(1), [bericht(gesamt)]);
    assert.equal(lokalStatus(datei), "in_review");
    assert.deepEqual(existsSync(berichteDir(dir)) ? readdirSync(berichteDir(dir)) : [], []);
  }, { kommentare: [ALTER_BERICHT] });
});

test("--teil: ein gescheiterter Abschluss laesst die Stuecke liegen, die Wiederholung verdoppelt nichts", () => {
  mitLokal((dir, datei) => {
    ausgabe(runBoard(dir, ["issue", "melden", "5", "--teil", "1", "--text", "Stueck eins"]));
    ausgabe(runBoard(dir, ["issue", "melden", "5", "--teil", "2", "--text", "Stueck zwei"]));
    rmSync(join(dir, ".claude", "bewegungen.tsv"));
    assert.equal(runBoard(dir, ["issue", "melden", "5"]).status, 1);
    assert.equal(readdirSync(berichteDir(dir)).length, 2, "die Stuecke liegen noch da");

    schreibeBewegungen(dir, "5");
    assert.equal(ausgabe(runBoard(dir, ["issue", "melden", "5"])).bericht, "angelegt");
    assert.deepEqual(lokalKommentare(datei), [bericht("Stueck eins\nStueck zwei")]);
  });
});

test("--teil: Stuecke anderer Karten bleiben liegen", () => {
  mitLokal((dir) => {
    mkdirSync(berichteDir(dir), { recursive: true });
    writeFileSync(join(berichteDir(dir), "6.1.md"), "fremd", "utf-8");
    ausgabe(runBoard(dir, ["issue", "melden", "5", "--teil", "1", "--text", "eigen"]));
    ausgabe(runBoard(dir, ["issue", "melden", "5"]));
    assert.deepEqual(readdirSync(berichteDir(dir)), ["6.1.md"]);
  });
});

test("Abschluss ohne Text und ohne Stuecke, falsche --teil-Werte: Exit 1 ohne Schreiben", () => {
  mitLokal((dir, datei) => {
    const vorher = readFileSync(datei, "utf-8");
    for (const args of [
      ["issue", "melden", "5"],
      ["issue", "melden", "5", "--teil", "0", "--text", "x"],
      ["issue", "melden", "5", "--teil", "abc", "--text", "x"],
      ["issue", "melden", "5", "--teil", "1"],
      ["issue", "melden"],
    ]) {
      const res = runBoard(dir, args);
      assert.equal(res.status, 1, `${args.join(" ")} haette scheitern muessen`);
    }
    assert.equal(readFileSync(datei, "utf-8"), vorher);
    assert.equal(existsSync(berichteDir(dir)) ? readdirSync(berichteDir(dir)).length : 0, 0);
  });
});

test("--text zusammen mit liegenden Stuecken: Exit 1, Stuecke bleiben", () => {
  mitLokal((dir, datei) => {
    ausgabe(runBoard(dir, ["issue", "melden", "5", "--teil", "1", "--text", "Stueck"]));
    const vorher = readFileSync(datei, "utf-8");
    const res = runBoard(dir, ["issue", "melden", "5", "--text", "Ganz"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Stueck/);
    assert.equal(readFileSync(datei, "utf-8"), vorher);
    assert.equal(readdirSync(berichteDir(dir)).length, 1);
  });
});

test("--text-file bleibt fuer Hand-Aufrufe", () => {
  mitLokal((dir, datei) => {
    const pfad = join(dir, "..", `melden-${process.pid}.md`);
    writeFileSync(pfad, "Aus der Datei.\n", "utf-8");
    try {
      ausgabe(runBoard(dir, ["issue", "melden", "5", "--text-file", pfad]));
    } finally {
      rmSync(pfad, { force: true });
    }
    assert.deepEqual(lokalKommentare(datei), [bericht("Aus der Datei.")]);
  });
});

// --- GitHub ---

const GH_VIEW = "^issue view 5 ";
const ghKommentar = (nr, body) => ({
  id: `IC_${nr}`, url: `https://github.com/besitzer/mein-repo/issues/5#issuecomment-${nr}`,
  author: { login: "kit" }, body, createdAt: "2026-09-29T09:10:00Z",
});

function mitGitHub(regeln, fn) {
  const dir = setupProjekt(GITHUB, "board-melden-gh-");
  fakeCli(dir, "gh", [...regeln, { match: "^api repos/besitzer/mein-repo/issues/comments/", stdout: "{}" }, ...ghBasis()]);
  schreibeBewegungen(dir, "5");
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ghSchreiben = (dir) => aufrufe(dir, "gh").filter((a) => (a[0] === "issue" && a[1] === "comment") || a[0] === "api" && a.includes("PATCH"));
const ghZuege = (dir) => aufrufe(dir, "gh").filter((a) => a[0] === "project" && a[1] === "item-edit");

test("GitHub: zweimal gleicher Text -> ein Bericht, zweiter Aufruf unveraendert, Karte in In review", () => {
  mitGitHub([
    { match: GH_VIEW, times: 1, stdout: { comments: [] } },
    { match: GH_VIEW, stdout: { comments: [ghKommentar(301, bericht("Gruen."))] } },
  ], (dir) => {
    assert.equal(ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Gruen."])).bericht, "angelegt");
    assert.equal(ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Gruen."])).bericht, "unveraendert");
    const schreib = ghSchreiben(dir);
    assert.equal(schreib.length, 1);
    assert.deepEqual(schreib[0].slice(0, 3), ["issue", "comment", "5"]);
    assert.equal(schreib[0].at(-1), bericht("Gruen."));
    assert.equal(ghZuege(dir).length, 2);
    assert.ok(ghZuege(dir).every((a) => a.includes("opt-review")), "Zug nach In review");
  });
});

test("GitHub: geaenderter Text ersetzt per PATCH, kein zweiter Kommentar; alter Lauf bleibt", () => {
  mitGitHub([
    { match: GH_VIEW, stdout: { comments: [ghKommentar(300, ALTER_BERICHT), ghKommentar(301, bericht("Alt."))] } },
  ], (dir) => {
    assert.equal(ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Neu."])).bericht, "ersetzt");
    const schreib = ghSchreiben(dir);
    assert.equal(schreib.length, 1, "genau ein Schreibaufruf");
    assert.deepEqual(schreib[0], ["api", "repos/besitzer/mein-repo/issues/comments/301", "-X", "PATCH", "-f", `body=${bericht("Neu.")}`]);
  });
});

test("GitHub: Kommentare nicht lesbar -> Exit 1, kein Bericht, kein Zug", () => {
  mitGitHub([{ match: GH_VIEW, stderr: "HTTP 502\n", exit: 1 }], (dir) => {
    const res = runBoard(dir, ["issue", "melden", "5", "--text", "Bericht."]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /HTTP 502/);
    assert.equal(ghSchreiben(dir).length, 0);
    assert.equal(ghZuege(dir).length, 0);
    assert.equal(bewegungen(dir).filter((z) => z.endsWith("in_review")).length, 1, "nur der alte Zug");
  });
});

// --- GitLab ---

const GL_NOTES = "^api projects/:id/issues/5/notes$";
const glNote = (id, body) => ({ id, author: { username: "kit" }, body, created_at: "2026-09-29T09:10:00Z" });

function mitGitLab(regeln, fn) {
  const dir = setupProjekt(GITLAB, "board-melden-glab-");
  fakeCli(dir, "glab", [...regeln, { match: "^api projects/:id/issues/5/notes/", stdout: "{}" }, ...glabBasis()]);
  schreibeBewegungen(dir, "5");
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const glSchreiben = (dir) => aufrufe(dir, "glab").filter((a) => (a[0] === "issue" && a[1] === "note") || a.includes("PUT"));
const glZuege = (dir) => aufrufe(dir, "glab").filter((a) => a[0] === "issue" && a[1] === "update");

test("GitLab: zweimal gleicher Text -> ein Bericht, zweiter Aufruf unveraendert, Karte in In review", () => {
  mitGitLab([
    { match: GL_NOTES, times: 1, stdout: [] },
    { match: GL_NOTES, stdout: [glNote(7, bericht("Gruen."))] },
  ], (dir) => {
    assert.equal(ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Gruen."])).bericht, "angelegt");
    assert.equal(ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Gruen."])).bericht, "unveraendert");
    const schreib = glSchreiben(dir);
    assert.equal(schreib.length, 1);
    assert.deepEqual(schreib[0], ["issue", "note", "5", "--message", bericht("Gruen.")]);
    assert.equal(glZuege(dir).length, 2);
    assert.ok(glZuege(dir).every((a) => a.at(-1) === "In review"));
  });
});

test("GitLab: geaenderter Text ersetzt per PUT, kein zweiter Kommentar; alter Lauf bleibt", () => {
  mitGitLab([
    { match: GL_NOTES, stdout: [glNote(6, ALTER_BERICHT), glNote(7, bericht("Alt."))] },
  ], (dir) => {
    assert.equal(ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Neu."])).bericht, "ersetzt");
    assert.deepEqual(glSchreiben(dir), [["api", "projects/:id/issues/5/notes/7", "-X", "PUT", "-f", `body=${bericht("Neu.")}`]]);
  });
});

test("GitLab: Kommentare nicht lesbar -> Exit 1, kein Bericht, kein Zug", () => {
  mitGitLab([{ match: GL_NOTES, stderr: "404 Not Found\n", exit: 1 }], (dir) => {
    const res = runBoard(dir, ["issue", "melden", "5", "--text", "Bericht."]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /404 Not Found/);
    assert.equal(glSchreiben(dir).length, 0);
    assert.equal(glZuege(dir).length, 0);
  });
});

// --- toolbox ---

async function mitToolbox(optionen, fn) {
  const karte = { id: 700, number: 7, title: "Karte 7", body: "Body 7", column: "IN_PROGRESS", position: 0 };
  const kommentare = { 700: [{ id: 31, author: "manne", body: ALTER_BERICHT, createdAt: "2026-09-28T09:00:00Z" }] };
  const zustand = {};
  const { server, requests, host } = await starteServer(toolboxMitKommentaren({ karten: [karte], kommentare, zustand, ...optionen }));
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-melden-tbx-");
  schreibeBewegungen(dir, "7");
  const melden = (...rest) => runBoardAsync(dir, ["issue", "melden", "7", ...rest], { TBX_TOKEN: "test-token" });
  try {
    return await fn({ melden, karte, kommentare, requests, zustand, dir });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const posts = (requests) => requests.filter((r) => r.method === "POST");

test("toolbox: zweimal gleicher Text -> ein Bericht, zweiter Aufruf unveraendert, Karte in In review", async () => {
  await mitToolbox({}, async ({ melden, karte, kommentare, requests }) => {
    assert.equal(ausgabe(await melden("--text", "Gruen.")).bericht, "angelegt");
    assert.equal(ausgabe(await melden("--text", "Gruen.")).bericht, "unveraendert");
    assert.deepEqual(kommentare[700].map((k) => k.body), [ALTER_BERICHT, bericht("Gruen.")]);
    assert.equal(posts(requests).length, 1);
    assert.equal(karte.column, "IN_REVIEW");
  });
});

test("toolbox: geaenderter Text ersetzt, Zahl gleich, alter Lauf Byte fuer Byte", async () => {
  await mitToolbox({}, async ({ melden, kommentare }) => {
    ausgabe(await melden("--text", "Alt."));
    assert.equal(ausgabe(await melden("--text", "Neu.")).bericht, "ersetzt");
    assert.deepEqual(kommentare[700].map((k) => k.body), [ALTER_BERICHT, bericht("Neu.")]);
  });
});

test("toolbox: Kommentare nicht lesbar -> Exit 1, kein Bericht, Karte bleibt in In progress", async () => {
  await mitToolbox({ leseRoute: false }, async ({ melden, karte, requests }) => {
    const res = await melden("--text", "Bericht.");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /nicht lesbar/);
    assert.equal(posts(requests).length, 0);
    assert.equal(karte.column, "IN_PROGRESS");
  });
});

test("toolbox ohne PATCH-Route: geaenderter Text -> Exit 1, Meldung nennt die Route, kein zweiter Bericht", async () => {
  await mitToolbox({ patchRoute: false }, async ({ melden, karte, kommentare }) => {
    ausgabe(await melden("--text", "Alt."));
    karte.column = "IN_PROGRESS"; // Ruecklaeufer im selben Lauf nachgestellt
    const res = await melden("--text", "Neu.");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /PATCH \/api\/kanban\/items\/700\/comments\/1000/);
    assert.deepEqual(kommentare[700].map((k) => k.body), [ALTER_BERICHT, bericht("Alt.")]);
    assert.equal(karte.column, "IN_PROGRESS", "ohne Ablage kein Zug");
  });
});

test("toolbox: scheitert der Zug, bleiben die Stuecke; die Wiederholung verdoppelt nichts", async () => {
  await mitToolbox({}, async ({ melden, karte, kommentare, requests, zustand, dir }) => {
    ausgabe(await melden("--teil", "1", "--text", "Eins"));
    ausgabe(await melden("--teil", "2", "--text", "Zwei"));
    zustand.moveRoute = false;
    const res = await melden();
    assert.equal(res.status, 1);
    assert.equal(karte.column, "IN_PROGRESS");
    assert.equal(readdirSync(join(dir, ".claude", "berichte")).length, 2, "die Stuecke liegen noch da");

    zustand.moveRoute = true;
    assert.deepEqual(ausgabe(await melden()), { ok: true, id: "7", bericht: "unveraendert", status: "in_review" });
    assert.deepEqual(kommentare[700].map((k) => k.body), [ALTER_BERICHT, bericht("Eins\nZwei")]);
    assert.equal(posts(requests).length, 1);
    assert.equal(karte.column, "IN_REVIEW");
    assert.deepEqual(existsSync(join(dir, ".claude", "berichte")) ? readdirSync(join(dir, ".claude", "berichte")) : [], []);
    assert.ok(bewegungen(dir).some((z) => z.endsWith("\t7\tin_review") && !z.startsWith("2026-09-28")));
  });
});

// --- Rest-Guard ---

test("der Rest-Guard des Nacht-Runners nimmt .claude/berichte/ aus", async () => {
  const { gitResteAusnahmen, gitRestePathspec } = await import("../kit/night.mjs");
  assert.ok(gitResteAusnahmen().includes(".claude/berichte/"));
  assert.ok(gitRestePathspec().includes(":(exclude).claude/berichte/"));
});

// --- Kit-Stand-Zeile (Issue #1103, Plan #1101 A4, A7) ---
//
// Ein unbeaufsichtigter Lauf nennt seinen Kit-Stand an jedem Kommentar. Die Zeile setzt
// das Werkzeug, und nur, wenn Umgebung (`KIT_STAND`) und lebende Markierung
// `.claude/kit-stand.json` im Baum zusammenkommen. Die Fixtures sind keine Git-Repos,
// darum fehlt die Commit-Zeit, und die Zeile endet nach dem Ref.

const STAND = "0123456789abcdef0123456789abcdef01234567";
const STAND_ZEILE = "Kit-Stand: 0123456789ab (origin/main)";
// Ein Prozess, den es mit Sicherheit nicht gibt: Die Markierung gilt dann als verwaist.
const TOTER_PID = 2 ** 22 + 7;

function markierung(dir, pid = process.pid) {
  writeFileSync(join(dir, ".claude", "kit-stand.json"),
    JSON.stringify({ commit: STAND, pfad: "/stand", pid, seit: "2026-10-02T00:00:00.000Z" }), "utf-8");
}

test("[kitstand-zeile] melden setzt die Zeile unmittelbar vor Bericht-Lauf, das bleibt die letzte Zeile", () => {
  mitLokal((dir, datei) => {
    markierung(dir);
    ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Alles gruen."], { KIT_STAND: STAND }));
    assert.deepEqual(lokalKommentare(datei), [`Alles gruen.\n\n${STAND_ZEILE}\n${LAUF}`]);
  });
});

test("[kitstand-zeile] comment haengt die Zeile als letzte Zeile an", () => {
  mitLokal((dir, datei) => {
    markierung(dir);
    ausgabe(runBoard(dir, ["issue", "comment", "5", "--text", "Ein Kommentar."], { KIT_STAND: STAND }));
    assert.deepEqual(lokalKommentare(datei), [`Ein Kommentar.\n\n${STAND_ZEILE}`]);
  });
});

for (const [fall, vorbereiten, env] of [
  ["ohne Markierung", () => {}, { KIT_STAND: STAND }],
  ["mit verwaister Markierung", (dir) => markierung(dir, TOTER_PID), { KIT_STAND: STAND }],
  ["ohne KIT_STAND", (dir) => markierung(dir), { KIT_STAND: "" }],
]) {
  test(`[kitstand-zeile] ${fall} setzen melden und comment keine Zeile`, () => {
    mitLokal((dir, datei) => {
      vorbereiten(dir);
      ausgabe(runBoard(dir, ["issue", "comment", "5", "--text", "Kommentar."], env));
      ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", "Bericht."], env));
      assert.deepEqual(lokalKommentare(datei), ["Kommentar.", bericht("Bericht.")]);
    });
  });
}

test("[kitstand-zeile] traegt der Text schon eine Kit-Stand-Zeile, entsteht keine zweite", () => {
  mitLokal((dir, datei) => {
    markierung(dir);
    const vorhanden = "Kit-Stand: fedcba987654 (origin/main vom 2026-10-01 22:00)";
    ausgabe(runBoard(dir, ["issue", "comment", "5", "--text", `Nachtrag.\n\n${vorhanden}`], { KIT_STAND: STAND }));
    ausgabe(runBoard(dir, ["issue", "melden", "5", "--text", `Bericht.\n\n${vorhanden}`], { KIT_STAND: STAND }));
    assert.deepEqual(lokalKommentare(datei), [`Nachtrag.\n\n${vorhanden}`, `Bericht.\n\n${vorhanden}\n\n${LAUF}`]);
  });
});
