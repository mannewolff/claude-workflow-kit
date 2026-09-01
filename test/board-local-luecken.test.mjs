// Der lokale Tracker und die CLI-Achse, wo Felder fehlen duerfen (Issue #405).
//
// Der lokale Tracker ist der einzige, dessen Datenbestand ein Mensch von Hand
// anlegen kann: eine Markdown-Datei mit Frontmatter. Genau deshalb muss er mit
// unvollstaendigen Dateien umgehen — ohne `type`, ohne `status`, ohne `title`. Ein
// `undefined` an dieser Stelle wandert in die JSON-Ausgabe und von dort in jeden
// Skill, der sie liest.
//
// Dazu die Stellen der CLI, an denen ein Argument fehlen darf oder muss.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setupProjekt, runBoard, board } from "./helpers/board-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

function mitProjekt(fn, config = LOKAL, praefix = "board-local-luecken-") {
  const dir = setupProjekt(config, praefix);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================
// issuesDir: der Default ohne local-Block
// ============================================================

test("ohne local-Block liegen die Issues im Default-Verzeichnis", () => {
  // Eine Config, die `local` gar nicht fuehrt — der Fall eines Projekts, das den
  // Tracker nachtraeglich auf `local` gestellt hat, ohne den Block zu ergaenzen.
  mitProjekt((dir) => {
    const issue = board(dir, "issue", "create", "--title", "Ohne local-Block", "--body", "## Abhaengigkeiten\nKeine.");

    const liste = board(dir, "issue", "list");
    assert.equal(liste.length, 1, "das Issue wurde nicht gefunden");
    assert.equal(String(liste[0].id), String(issue.id));
    assert.match(issue.path, /[/\\]issues[/\\]/, "der Default 'issues' wurde nicht verwendet");
  }, { codeHost: "local", issueTracker: "local" }, "board-local-ohne-block-");
});

// ============================================================
// issueCreate: der Body und seine drei Formen
// ============================================================

test("ein create ohne Body bekommt die Abschnitts-Vorlage", () => {
  mitProjekt((dir) => {
    const issue = board(dir, "issue", "create", "--title", "Ganz ohne Body");
    const text = readFileSync(issue.path, "utf-8");

    for (const ueberschrift of ["## Kontext", "## Aufgabe", "## Akzeptanzkriterium", "## Abhaengigkeiten"]) {
      assert.ok(text.includes(ueberschrift), `${ueberschrift} fehlt in der Vorlage`);
    }
  });
});

test("ein Body, der nur aus der Autor-Modell-Zeile besteht, behaelt die Vorlage", () => {
  // Seit der Leitplanke aus Issue #266 ist ein Body nie mehr wirklich leer: Die
  // Autor-Zeile steht immer drin. Ohne die Erweiterung haette `create` ohne --body
  // still die Vorlage verloren — das Issue saehe aus wie ein fertiges Dokument.
  mitProjekt((dir) => {
    const issue = board(dir, "issue", "create", "--title", "Nur Autor", "--body", "Autor-Modell: fixture-modell");
    const text = readFileSync(issue.path, "utf-8");

    assert.match(text, /Autor-Modell: fixture-modell/, "die Autor-Zeile ging verloren");
    assert.ok(text.includes("## Kontext"), "die Vorlage fehlt");
    assert.ok(text.includes("## Abhaengigkeiten"), "die Vorlage ist unvollstaendig");
  });
});

test("ein vollstaendiger Body bleibt unveraendert", () => {
  mitProjekt((dir) => {
    const body = "## Kontext\n\nEigener Text.\n\n## Abhaengigkeiten\n\nKeine.\n";
    const issue = board(dir, "issue", "create", "--title", "Mit Body", "--body", body);
    const text = readFileSync(issue.path, "utf-8");

    assert.ok(text.includes("Eigener Text."), "der eigene Text ging verloren");
    assert.ok(!text.includes("## Akzeptanzkriterium"),
      "an einen vollstaendigen Body darf keine Vorlage angehaengt werden");
  });
});

// ============================================================
// Eine von Hand angelegte Datei ohne Frontmatter-Felder
// ============================================================

test("eine Issue-Datei ohne Frontmatter-Felder bekommt Rueckfaelle statt undefined", () => {
  mitProjekt((dir) => {
    // So sieht eine Datei aus, die jemand von Hand angelegt hat: kein type, kein
    // status, kein title. Der Adapter muss sie lesen koennen — die Alternative waere
    // "undefined" in der JSON-Ausgabe und damit in jedem Skill, der sie liest.
    mkdirSync(join(dir, "issues"), { recursive: true });
    writeFileSync(join(dir, "issues", "0042.md"), "---\n---\n\n## Kontext\n\nVon Hand.\n", "utf-8");

    const liste = board(dir, "issue", "list");

    assert.equal(liste.length, 1, "die Datei wurde nicht gelesen");
    const i = liste[0];
    assert.equal(i.id, "0042", "ohne id-Feld gilt der Dateiname");
    assert.equal(i.title, "", "ein fehlender Titel muss leer sein, nicht undefined");
    assert.equal(i.status, "backlog", "ohne status gilt Backlog");
    assert.deepEqual(i.labels, [], "ohne labels muss die Liste leer sein");
    const roh = JSON.stringify(liste);
    assert.ok(!roh.includes("undefined"), `'undefined' steht in der Ausgabe: ${roh}`);
  });
});

test("issue update auf ein nicht vorhandenes Issue nennt den erwarteten Pfad", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "update", "9999", "--body", "neu"]);

    assert.notEqual(res.status, 0, "ein fehlendes Issue haette den Aufruf scheitern lassen muessen");
    assert.match(res.stderr, /Issue 9999 nicht gefunden/, "die Nummer fehlt in der Meldung");
    assert.match(res.stderr, /issues[/\\]/, "ohne den Pfad ist nicht erkennbar, wo gesucht wurde");
  });
});

// ============================================================
// Die CLI-Achse: fehlende und ueberzaehlige Argumente
// ============================================================

test("label-sync ohne Issue-Nummer bricht mit einem Hinweis ab", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue-review", "label-sync"]);

    assert.notEqual(res.status, 0, "ohne Nummer haette der Aufruf scheitern muessen");
    assert.match(res.stderr, /label-sync braucht eine Issue-Nummer/);
  });
});

test("issue-review reviewers ohne --author meldet autor null statt undefined", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue-review", "reviewers"]);

    assert.equal(res.status, 0, `reviewers haette durchlaufen muessen: ${res.stderr}`);
    const daten = JSON.parse(res.stdout);
    assert.equal(daten.autor, null, "ohne --author muss der Autor null sein, nicht undefined");
    assert.ok(!res.stdout.includes("undefined"), "'undefined' steht in der JSON-Ausgabe");
  }, { ...LOKAL, issueReview: { rounds: 1, reviewers: [{ name: "fable", kind: "claude", model: "claude-fable-5" }] } },
  "board-local-roles-");
});

test("issue-review roles --issue liest die Vorgabe eines Issues ohne Body", () => {
  mitProjekt((dir) => {
    // Ein Issue, dessen Body leer ist: Der Parser bekommt den leeren Text statt
    // `undefined` und meldet den Regelfall — nicht einen Fehler.
    mkdirSync(join(dir, "issues"), { recursive: true });
    writeFileSync(join(dir, "issues", "0007.md"), "---\nid: 7\ntitle: Leer\nstatus: backlog\n---\n", "utf-8");

    const res = runBoard(dir, ["issue-review", "roles", "--stufe", "issue", "--author", "claude-opus-5", "--issue", "7"]);

    assert.equal(res.status, 0, `roles --issue haette durchlaufen muessen: ${res.stderr}`);
    const daten = JSON.parse(res.stdout);
    assert.equal(daten.vorgabeQuelle, "config", "ohne Zeile am Ticket gilt der Regelfall aus der Config");
    assert.equal(daten.verzicht, false);
  }, { ...LOKAL, issueReview: { rounds: 1, reviewers: [{ name: "fable", kind: "claude", model: "claude-fable-5" }] } },
  "board-local-roles-issue-");
});

// ============================================================
// stufeAusTitel: die drei Praefixe ueber label-sync
// ============================================================

const STUFEN = [
  { titel: "[Fachlich] Eine Anforderung", marker: "Fachplan-Review: fable (2026-08-31)" },
  { titel: "[Plan] Ein Plandokument", marker: "Plan-Review: fable (2026-08-31)" },
  { titel: "Ein Arbeitspaket", marker: "Issue-Review: fable (2026-08-31)" },
];

for (const fall of STUFEN) {
  test(`label-sync liest die Stufe aus dem Titel: ${fall.titel}`, () => {
    mitProjekt((dir) => {
      // Der jeweils passende Marker macht den Zustand `fertig`. Nur wenn die Stufe
      // richtig aus dem Titel gelesen wird, zaehlt er — ein `Plan-Review:` an einem
      // Arbeitspaket belegt nichts.
      const body = `## Kontext\n\n${fall.marker}\n\n## Abhaengigkeiten\n\nKeine.\n`;
      const issue = board(dir, "issue", "create", "--title", fall.titel, "--body", body);

      const res = runBoard(dir, ["issue-review", "label-sync", String(issue.id)]);

      assert.equal(res.status, 0, `label-sync schlug fehl: ${res.stderr}`);
      const daten = JSON.parse(res.stdout);
      assert.equal(daten.zustand, "fertig",
        `der Marker '${fall.marker}' wurde fuer '${fall.titel}' nicht anerkannt`);
      assert.equal(daten.label, "review:fertig");
    }, { ...LOKAL, issueReview: { statusLabels: true } }, "board-local-stufe-");
  });
}

test("ein Marker der falschen Stufe belegt nichts", () => {
  mitProjekt((dir) => {
    // `Plan-Review:` an einem Arbeitspaket: Die Stufe ist `issue`, und dort zaehlt
    // allein `Issue-Review:`. Wer das verwechselt, zieht ein ungepruefte Paket nach
    // Ready.
    const body = "## Kontext\n\nPlan-Review: fable (2026-08-31)\n\n## Abhaengigkeiten\n\nKeine.\n";
    const issue = board(dir, "issue", "create", "--title", "Ein Arbeitspaket", "--body", body);

    const res = runBoard(dir, ["issue-review", "label-sync", String(issue.id)]);

    assert.equal(res.status, 0, `label-sync schlug fehl: ${res.stderr}`);
    assert.notEqual(JSON.parse(res.stdout).zustand, "fertig",
      "ein Marker der falschen Stufe wurde als Nachweis gewertet");
  }, { ...LOKAL, issueReview: { statusLabels: true } }, "board-local-falsche-stufe-");
});
