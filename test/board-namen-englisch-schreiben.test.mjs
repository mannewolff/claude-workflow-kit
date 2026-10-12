// Ablauf-Pruefung: `issue create`, `issue check-form`, `issue label` und `issue stand` fuehrt der
// Einstieg, und der Befund ist Ausgabe und Kartenstand des Prozesses.
//
// Ein Register, eine Schreibrichtung (Issue #1552, Plan #1548 E2, E3): Der Board-Teil schreibt
// Labels und Titel-Praefixe in jedem Projekt englisch und erkennt beim Lesen beide Namen. Geprueft
// an einem deutschen Projekt ueber das echte CLI mit dem lokalen Tracker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard, board } from "./helpers/board-fixture.mjs";

const DEUTSCH = { language: "de", codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
const BODY = "## Kontext\nAutor-Modell: fixture-modell\n";

function mitProjekt(fn, karte) {
  const dir = setupProjekt(DEUTSCH, "board-englisch-");
  mkdirSync(join(dir, "issues"), { recursive: true });
  if (karte) writeFileSync(join(dir, "issues", "0007.md"), karte, "utf-8");
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const karte = ({ titel = "Paket", labels = [] } = {}) => [
  "---", "id: 0007", "type: task", "status: in_progress", `title: ${titel}`,
  ...(labels.length > 0 ? [`labels: ${labels.join(", ")}`] : []), "---", "", "## Kontext", "Text.", "",
].join("\n");

test("[board-1552] ein deutsches Projekt legt mit --art fachlich eine Karte [Requirement] an", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "create", "--title", "Etwas", "--body", BODY, "--art", "fachlich"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(board(dir, "issue", "get", String(JSON.parse(res.stdout).id)).title, "[Requirement] Etwas");
  });
});

test("[board-1552] ein deutsches Projekt erkennt [Fachlich] weiter als fachliche Anforderung", () => {
  mitProjekt((dir) => {
    const datei = join(dir, "eingabe.md");
    writeFileSync(datei, BODY);
    const res = runBoard(dir, ["issue", "check-form", "--body-file", datei, "--title", "[Fachlich] Etwas"]);
    assert.equal(JSON.parse(res.stdout).stufe, "fachlich");
  });
});

test("[board-1552] ein deutsches Projekt setzt kit:clarify, auch wenn kit:klaeren gerufen wird", () => {
  mitProjekt((dir) => {
    assert.equal(board(dir, "issue", "label", "add", "7", "kit:klaeren").label, "kit:clarify");
    assert.deepEqual(board(dir, "issue", "get", "7").labels, ["kit:clarify"]);
  }, karte());
});

test("[board-1552] ein deutsches Projekt erkennt ein getragenes kit:klaeren und nimmt es ab", () => {
  mitProjekt((dir) => {
    assert.equal(board(dir, "issue", "label", "remove", "7", "kit:clarify").label, "kit:klaeren");
    assert.deepEqual(board(dir, "issue", "get", "7").labels, ["fix"]);
  }, karte({ labels: ["kit:klaeren", "fix"] }));
});

test("[board-1552] issue stand raeumt ein getragenes lauf:laeuft ab und setzt das englische Label (E3)", () => {
  mitProjekt((dir) => {
    const text = join(dir, "stand.md");
    writeFileSync(text, "Abgebrochen um 03:00.", "utf-8");
    const res = runBoard(dir, ["issue", "stand", "7", "--zustand", "abgebrochen", "--text-file", text]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(board(dir, "issue", "get", "7").labels, ["kit:nightrun", "run:aborted"]);
  }, karte({ labels: ["lauf:laeuft", "kit:nightrun"] }));
});

test("[board-1552] issue stand fertig raeumt deutsche und englische Laufstand-Labels ab, fremde bleiben", () => {
  mitProjekt((dir) => {
    const text = join(dir, "stand.md");
    writeFileSync(text, "Fertig.", "utf-8");
    const res = runBoard(dir, ["issue", "stand", "7", "--zustand", "fertig", "--text-file", text]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(board(dir, "issue", "get", "7").labels, ["lauf:anders"]);
  }, karte({ labels: ["lauf:laeuft", "run:waiting", "lauf:anders", "lauf:abgebrochen"] }));
});
