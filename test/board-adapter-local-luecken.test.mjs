// Der lokale Tracker und die CLI-Achse, wo Felder fehlen duerfen (Issue #405).
//
// Der lokale Tracker ist der einzige, dessen Datenbestand ein Mensch von Hand
// anlegen kann: eine Markdown-Datei mit Frontmatter. Genau deshalb muss er mit
// unvollstaendigen Dateien umgehen — ohne `type`, ohne `status`, ohne `title`. Ein
// `undefined` an dieser Stelle wandert in die JSON-Ausgabe und von dort in jeden
// Skill, der sie liest.
//
// Seit Issue #1217 laufen die Tracker-Faelle im selben Prozess gegen
// kit/board/adapter.mjs (`resolveTracker`, cwd ueber `imProjekt`). Die Stelle der
// CLI, an der ein Argument fehlen darf (`issue-review reviewers` ohne --author),
// steht in test/ablauf-board-adapter-local-luecken.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { resolveTracker } from "../kit/board/adapter.mjs";
import { setupProjekt, imProjekt } from "./helpers/adapter-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

// Legt das Fixture an und ruft `fn(tracker, dir)` mit cwd im Fixture — der Adapter
// loest das issues-Verzeichnis relativ zum cwd auf.
async function mitProjekt(fn, config = LOKAL, praefix = "board-local-luecken-") {
  const dir = setupProjekt(config, praefix);
  try {
    await imProjekt(dir, () => fn(resolveTracker(config), dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================
// issuesDir: der Default ohne local-Block
// ============================================================

test("ohne local-Block liegen die Issues im Default-Verzeichnis", async () => {
  // Eine Config, die `local` gar nicht fuehrt — der Fall eines Projekts, das den
  // Tracker nachtraeglich auf `local` gestellt hat, ohne den Block zu ergaenzen.
  await mitProjekt(async (tracker) => {
    const issue = await tracker.createIssue({ title: "Ohne local-Block", body: "## Abhaengigkeiten\nKeine." });

    const liste = await tracker.listIssues();
    assert.equal(liste.length, 1, "das Issue wurde nicht gefunden");
    assert.equal(String(liste[0].id), String(issue.id));
    assert.match(issue.path, /[/\\]issues[/\\]/, "der Default 'issues' wurde nicht verwendet");
  }, { codeHost: "local", issueTracker: "local" }, "board-local-ohne-block-");
});

// ============================================================
// issueCreate: der Body und seine drei Formen
// ============================================================

// Ohne Body-Quelle bekommt der Adapter einen leeren Body (vor der Autor-Leitplanke
// der Kommandozeile); die Form, die die Leitplanke daraus macht, belegt der naechste Test.
test("ein create ohne Body bekommt die Abschnitts-Vorlage", async () => {
  await mitProjekt(async (tracker) => {
    const issue = await tracker.createIssue({ title: "Ganz ohne Body", body: "" });
    const text = readFileSync(issue.path, "utf-8");

    for (const ueberschrift of ["## Kontext", "## Aufgabe", "## Akzeptanzkriterium", "## Abhaengigkeiten"]) {
      assert.ok(text.includes(ueberschrift), `${ueberschrift} fehlt in der Vorlage`);
    }
  });
});

test("ein Body, der nur aus der Autor-Modell-Zeile besteht, behaelt die Vorlage", async () => {
  // Seit der Leitplanke aus Issue #266 ist ein Body nie mehr wirklich leer: Die
  // Autor-Zeile steht immer drin. Ohne die Erweiterung haette `create` ohne --body
  // still die Vorlage verloren — das Issue saehe aus wie ein fertiges Dokument.
  await mitProjekt(async (tracker) => {
    const issue = await tracker.createIssue({ title: "Nur Autor", body: "Autor-Modell: fixture-modell" });
    const text = readFileSync(issue.path, "utf-8");

    assert.match(text, /Autor-Modell: fixture-modell/, "die Autor-Zeile ging verloren");
    assert.ok(text.includes("## Kontext"), "die Vorlage fehlt");
    assert.ok(text.includes("## Abhaengigkeiten"), "die Vorlage ist unvollstaendig");
  });
});

test("ein vollstaendiger Body bleibt unveraendert", async () => {
  await mitProjekt(async (tracker) => {
    const body = "## Kontext\n\nEigener Text.\n\n## Abhaengigkeiten\n\nKeine.\n";
    const issue = await tracker.createIssue({ title: "Mit Body", body });
    const text = readFileSync(issue.path, "utf-8");

    assert.ok(text.includes("Eigener Text."), "der eigene Text ging verloren");
    assert.ok(!text.includes("## Akzeptanzkriterium"),
      "an einen vollstaendigen Body darf keine Vorlage angehaengt werden");
  });
});

// ============================================================
// Eine von Hand angelegte Datei ohne Frontmatter-Felder
// ============================================================

test("eine Issue-Datei ohne Frontmatter-Felder bekommt Rueckfaelle statt undefined", async () => {
  await mitProjekt(async (tracker, dir) => {
    // So sieht eine Datei aus, die jemand von Hand angelegt hat: kein type, kein
    // status, kein title. Der Adapter muss sie lesen koennen — die Alternative waere
    // "undefined" in der JSON-Ausgabe und damit in jedem Skill, der sie liest.
    mkdirSync(join(dir, "issues"), { recursive: true });
    writeFileSync(join(dir, "issues", "0042.md"), "---\n---\n\n## Kontext\n\nVon Hand.\n", "utf-8");

    const liste = await tracker.listIssues();

    assert.equal(liste.length, 1, "die Datei wurde nicht gelesen");
    const i = liste[0];
    assert.equal(i.id, "0042", "ohne id-Feld gilt der Dateiname");
    assert.equal(i.title, "", "ein fehlender Titel muss leer sein, nicht undefined");
    assert.equal(i.status, "backlog", "ohne status gilt Backlog");
    assert.deepEqual(i.labels, [], "ohne labels muss die Liste leer sein");
    // JSON.stringify liesse ein undefined-Feld still weg — darum zusaetzlich jeder Wert.
    for (const [feld, wert] of Object.entries(i)) {
      assert.notEqual(wert, undefined, `Feld '${feld}' ist undefined`);
    }
    const roh = JSON.stringify(liste);
    assert.ok(!roh.includes("undefined"), `'undefined' steht in der Ausgabe: ${roh}`);
  });
});

// Der Adapter wirft BoardError; die Kommandozeile macht daraus Exit 1 und stderr.
test("issue update auf ein nicht vorhandenes Issue nennt den erwarteten Pfad", async () => {
  await mitProjekt(async (tracker) => {
    await assert.rejects(tracker.updateIssue("9999", { body: "neu" }), (fehler) => {
      assert.match(fehler.message, /Issue 9999 nicht gefunden/, "die Nummer fehlt in der Meldung");
      assert.match(fehler.message, /issues[/\\]/, "ohne den Pfad ist nicht erkennbar, wo gesucht wurde");
      return true;
    });
  });
});
