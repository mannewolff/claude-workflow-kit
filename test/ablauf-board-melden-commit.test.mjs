// Ablauf-Pruefung: `issue report` zieht nur mit Beleg (Issue #1584); der Vertrag ist
// Ausgabe, Exitcode und der Zustand der Karte nach dem Prozess.
//
// Beleg ist ein Commit seit dem juengsten Zug nach In progress, dessen Nachricht
// `Issue #<N>` mit Wortgrenze nennt. Ausgenommen sind `[Mensch]`-Karten; im Einzelfall
// meldet `--without-commit '<Begruendung>'`, und die Begruendung steht im Bericht. Ohne
// Beleg endet der Aufruf mit Exit 1, Karte, Bericht und Stuecke bleiben unberuehrt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard, commitFuer } from "./helpers/board-fixture.mjs";
import { commitBeleg } from "../kit/board/dokumente.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
const STEMPEL = "2026-09-29T09:00:00.000Z";

function mitKarte(fn, { titel = "Paket", stempel = STEMPEL } = {}) {
  const dir = setupProjekt(LOKAL, "board-melden-commit-");
  mkdirSync(join(dir, "issues"), { recursive: true });
  const datei = join(dir, "issues", "0005.md");
  writeFileSync(datei, `---\nid: "0005"\ntype: task\nstatus: in_progress\ntitle: ${titel}\n---\n\n## Kontext\nText.\n`, "utf-8");
  writeFileSync(join(dir, ".claude", "bewegungen.tsv"), `${stempel}\t5\tin_progress\n`, "utf-8");
  try {
    return fn(dir, datei);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const status = (datei) => readFileSync(datei, "utf-8").match(/^status: (\S+)$/m)[1];
const hatKommentar = (datei) => readFileSync(datei, "utf-8").includes("**Kommentar**");
const melden = (dir, ...weitere) => runBoard(dir, ["issue", "report", "5", "--text", "Alles gruen.", ...weitere]);

function gezogen(res) {
  assert.equal(res.status, 0, `Exit ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function abgewiesen(res, datei, muster) {
  assert.equal(res.status, 1, `Exit ${res.status}: ${res.stdout}`);
  assert.match(res.stderr, muster);
  assert.equal(status(datei), "in_progress", "die Karte ist nicht bewegt");
  assert.equal(hatKommentar(datei), false, "kein Bericht am Board");
}

const KEIN_COMMIT = /Seit dem Zug nach In progress \(2026-09-29T09:00:00\.000Z\) nennt kein Commit "Issue #5"\..*committen.*--without-commit '<Begruendung>'/;

test("Commit nennt Issue #5 -> zieht, Ausgabe traegt den kurzen Hash", () => {
  mitKarte((dir, datei) => {
    commitFuer(dir, "1", "Vorarbeit (Issue #1)");
    const hash = commitFuer(dir, "5");
    commitFuer(dir, "2", "Danach (Issue #2)");
    const e = gezogen(melden(dir));
    assert.equal(e.commit, hash);
    assert.equal(e.status, "in_review");
    assert.equal(status(datei), "in_review");
  });
});

test("kein Commit nennt die Karte -> Exit 1, Karte nicht bewegt, kein Kommentar", () => {
  mitKarte((dir, datei) => {
    commitFuer(dir, "-", "Aufraeumen ohne Kartennummer");
    abgewiesen(melden(dir), datei, KEIN_COMMIT);
  });
});

test("kein Repo -> Exit 1 wie ohne Commit", () => {
  mitKarte((dir, datei) => {
    abgewiesen(melden(dir), datei, KEIN_COMMIT);
  });
});

test("Commit nennt nur Issue #50 oder eine andere Nummer -> Abweisung", () => {
  mitKarte((dir, datei) => {
    commitFuer(dir, "50");
    commitFuer(dir, "6", "Anderes (Issue #6), Issue #5a, issue #5");
    abgewiesen(melden(dir), datei, KEIN_COMMIT);
  });
});

test("Commit vor dem Zug nach In progress zaehlt nicht", () => {
  mitKarte((dir, datei) => {
    commitFuer(dir, "5");
    abgewiesen(melden(dir), datei, /\(2099-01-01T00:00:00\.000Z\) nennt kein Commit "Issue #5"/);
  }, { stempel: "2099-01-01T00:00:00.000Z" });
});

test("Abweisung laesst Stuecke liegen, die Wiederholung nach dem Commit zieht", () => {
  mitKarte((dir, datei) => {
    gezogen(runBoard(dir, ["issue", "report", "5", "--part", "1", "--text", "Stueck"]));
    abgewiesen(runBoard(dir, ["issue", "report", "5"]), datei, KEIN_COMMIT);
    assert.deepEqual(readdirSync(join(dir, ".claude", "berichte")), ["5.1.md"]);
    commitFuer(dir, "5");
    assert.equal(gezogen(runBoard(dir, ["issue", "report", "5"])).status, "in_review");
  });
});

test("[Mensch]-Karte ohne Commit -> zieht, commit: mensch", () => {
  mitKarte((dir, datei) => {
    const e = gezogen(melden(dir));
    assert.equal(e.commit, "mensch");
    assert.equal(status(datei), "in_review");
  }, { titel: "\"[Mensch] Token anlegen\"" });
});

test("--without-commit 'Grund' -> zieht, Bericht traegt Ohne Commit: Grund vor Bericht-Lauf", () => {
  mitKarte((dir, datei) => {
    const e = gezogen(melden(dir, "--without-commit", "Nur Board-Arbeit"));
    assert.equal(e.commit, "ohne");
    assert.equal(status(datei), "in_review");
    assert.match(readFileSync(datei, "utf-8"), /Alles gruen\.\n\nOhne Commit: Nur Board-Arbeit\n\nBericht-Lauf: 2026-09-29T09:00:00\.000Z/);
  });
});

test("leere Begruendung -> Abweisung, mit Leerzeichen wie ohne Wert", () => {
  mitKarte((dir, datei) => {
    for (const wert of [[" "], []]) {
      abgewiesen(melden(dir, "--without-commit", ...wert), datei, /--without-commit braucht eine Begruendung/);
    }
  });
});

test("der fruehere deutsche Name --ohne-commit wird abgewiesen und nennt --without-commit", () => {
  mitKarte((dir, datei) => {
    abgewiesen(melden(dir, "--ohne-commit", "Grund"), datei, /'--ohne-commit' — englischer Name: '--without-commit'/);
  });
});

test("englisches Projekt: die Abweisung nennt beide Wege englisch, die Zeile heisst Without commit", () => {
  mitKarte((dir, datei) => {
    const config = JSON.parse(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"));
    writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({ ...config, language: "en" }));
    abgewiesen(melden(dir), datei, /since the move to In progress \(2026-09-29T09:00:00\.000Z\) no commit names "Issue #5"\. Either commit and repeat the call, or use --without-commit '<reason>'/);
    gezogen(melden(dir, "--without-commit", "Board only"));
    assert.match(readFileSync(datei, "utf-8"), /\n\nWithout commit: Board only\n\nBericht-Lauf: /);
  });
});

test("commitBeleg: Start injizierbar, git-Fehler ergibt null, fuehrende Nullen zaehlen", () => {
  const aufrufe = [];
  const antwort = (stdout, status = 0) => (datei, args, opts) => {
    aufrufe.push({ datei, args, cwd: opts.cwd });
    return { status, stdout };
  };
  const satz = (hash, text) => `${hash}\x1f${text}\n\x1e`;
  assert.equal(commitBeleg("0005", STEMPEL, { spawn: antwort(satz("abc1234", "x (Issue #5)")), baum: "/b" }), "abc1234");
  assert.deepEqual(aufrufe[0], { datei: "git", args: ["log", `--since=${STEMPEL}`, "--format=%h%x1f%B%x1e"], cwd: "/b" });
  assert.equal(commitBeleg("5", STEMPEL, { spawn: antwort(satz("abc1234", "x (Issue #0005)")) }), "abc1234");
  assert.equal(commitBeleg("5", STEMPEL, { spawn: antwort(satz("a1", "Issue #51") + satz("b2", "Text\n\nRefs Issue #5.")) }), "b2");
  assert.equal(commitBeleg("5", STEMPEL, { spawn: antwort("", 128) }), null);
  assert.equal(commitBeleg("5", STEMPEL, { spawn: () => ({ error: new Error("ENOENT") }) }), null);
});
