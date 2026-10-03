// `issue stand` — Label und Laufstand-Kommentar einer Karte in einem Zug (Issue #1083,
// Plan #1079 E1, E3, E4).
//
// Geprueft am lokalen Tracker ueber das echte CLI: Das Kommando baut nur auf
// `labelIssue`, `kommentareStreng`, `ersetzeKommentar` und `commentIssue` auf, die jeder
// Adapter traegt und die ihre eigenen Adapter-Tests haben.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";
import { STAND_LABEL_VORGABEN } from "../kit/board.mjs";

const VORGABEN = ["lauf:laeuft", "lauf:abgebrochen", "lauf:wartet"];
const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
const KOPF = "---\nid: \"0007\"\ntype: task\nstatus: in_progress\ntitle: Paket\n---\n\n## Kontext\nText.\n";

function mitLokal(fn, { config = LOKAL, labels = [], kommentare = [] } = {}) {
  const dir = setupProjekt(config, "board-stand-");
  mkdirSync(join(dir, "issues"), { recursive: true });
  const datei = join(dir, "issues", "0007.md");
  let inhalt = labels.length > 0 ? KOPF.replace("title: Paket\n", `title: Paket\nlabels: ${labels.join(", ")}\n`) : KOPF;
  for (const k of kommentare) inhalt += `\n\n---\n**Kommentar** (2026-09-30 08:00)\n\n${k}`;
  writeFileSync(datei, inhalt, "utf-8");
  try {
    return fn(dir, datei);
  } finally {
    try { chmodSync(datei, 0o644); } catch { /* schon weg */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

function stand(dir, zustand, text) {
  const pfad = join(dir, "stand.md");
  writeFileSync(pfad, text, "utf-8");
  return runBoard(dir, ["issue", "stand", "7", "--zustand", zustand, "--text-file", pfad]);
}

function ausgabe(res) {
  assert.equal(res.status, 0, `Exit ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function labelsVon(dir) {
  const res = runBoard(dir, ["issue", "get", "7"]);
  return ausgabe(res).labels;
}

function laufstandKommentare(datei) {
  return readFileSync(datei, "utf-8").split("\n---\n**Kommentar**").slice(1)
    .filter((b) => /\n## Laufstand\b/.test(b));
}

test("Zustand setzt sein Label und nimmt die beiden anderen ab", () => {
  mitLokal((dir) => {
    const res = ausgabe(stand(dir, "abgebrochen", "Zuletzt begonnen: Plan um 01:00."));
    assert.deepEqual(res, { ok: true, id: "7", zustand: "abgebrochen", kommentar: "angelegt" });
    assert.deepEqual(labelsVon(dir), ["kit:nightrun", "lauf:abgebrochen"]);
  }, { labels: ["kit:nightrun", "lauf:laeuft", "lauf:wartet"] });
});

test("fertig nimmt alle drei Labels ab, fremde bleiben", () => {
  mitLokal((dir) => {
    ausgabe(stand(dir, "fertig", "Abgeschlossen: Umsetzung um 03:00."));
    assert.deepEqual(labelsVon(dir), ["kit:nightrun"]);
  }, { labels: ["lauf:laeuft", "kit:nightrun", "lauf:abgebrochen", "lauf:wartet"] });
});

test("Kommentar wird angelegt, beim zweiten Aufruf ersetzt, bei gleichem Inhalt unveraendert", () => {
  mitLokal((dir, datei) => {
    assert.equal(ausgabe(stand(dir, "laeuft", "Lauf angenommen um 01:00, Vorabprüfung läuft")).kommentar, "angelegt");
    assert.equal(ausgabe(stand(dir, "laeuft", "Zuletzt begonnen: Plan um 01:02")).kommentar, "ersetzt");
    assert.equal(ausgabe(stand(dir, "laeuft", "Zuletzt begonnen: Plan um 01:02")).kommentar, "unveraendert");
    const staende = laufstandKommentare(datei);
    assert.equal(staende.length, 1, "genau ein Laufstand");
    assert.match(staende[0], /## Laufstand\n\nZuletzt begonnen: Plan um 01:02/);
    assert.ok(readFileSync(datei, "utf-8").includes("Fremder Kommentar"), "andere Kommentare bleiben");
    assert.deepEqual(labelsVon(dir), ["lauf:laeuft"]);
  }, { kommentare: ["Fremder Kommentar"] });
});

test("ein Text, der den Anker schon traegt, bekommt ihn nicht doppelt", () => {
  mitLokal((dir, datei) => {
    ausgabe(stand(dir, "wartet", "## Laufstand\n\nwartet: Karte ohne Freigabe zur Umsetzung"));
    const staende = laufstandKommentare(datei);
    assert.equal(staende.length, 1);
    assert.equal((staende[0].match(/## Laufstand/g) || []).length, 1);
  });
});

test("Labelnamen kommen aus night.stand.labels", () => {
  const config = { ...LOKAL, night: { stand: { labels: { laeuft: "x:lauf", abgebrochen: "x:ab", wartet: "x:wart" } } } };
  mitLokal((dir) => {
    ausgabe(stand(dir, "wartet", "Halt: Frage wartet auf den Menschen — siehe `## Kette angehalten`"));
    assert.deepEqual(labelsVon(dir), ["lauf:laeuft", "x:wart"], "die Vorgabenamen sind hier fremde Labels");
  }, { config, labels: ["x:lauf", "lauf:laeuft", "x:ab"] });
});

test("ohne night.stand in der Config gelten die Vorgaben", () => {
  assert.deepEqual(Object.values(STAND_LABEL_VORGABEN), VORGABEN);
  mitLokal((dir) => {
    ausgabe(stand(dir, "laeuft", "Lauf angenommen um 01:00, Vorabprüfung läuft"));
    assert.deepEqual(labelsVon(dir), ["lauf:laeuft"]);
  });
});

test("die Vorgaben im Kommando sind die des Schemas", () => {
  const schema = JSON.parse(readFileSync(new URL("../templates/workflow.config.schema.json", import.meta.url), "utf-8"));
  const block = schema.properties.night.properties.stand.properties;
  const ausSchema = Object.fromEntries(Object.entries(block.labels.properties).map(([k, v]) => [k, v.default]));
  assert.deepEqual(ausSchema, STAND_LABEL_VORGABEN);
  assert.equal(block.fristMin.default, 10);
  assert.equal(block.pauseMin.default, 5);
});

test("strenges Lesen: nicht lesbare Kommentare -> Exit 1, kein zweiter Kommentar, kein Label", () => {
  if (process.getuid?.() === 0) return; // root liest trotz chmod 000
  mitLokal((dir, datei) => {
    const vorher = readFileSync(datei, "utf-8");
    chmodSync(datei, 0o000);
    const res = stand(dir, "abgebrochen", "Zuletzt begonnen: Pakete");
    chmodSync(datei, 0o644);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Kommentare.*nicht lesbar/);
    assert.equal(readFileSync(datei, "utf-8"), vorher);
  }, { labels: ["lauf:laeuft"], kommentare: ["## Laufstand\n\nZuletzt begonnen: Plan"] });
});

test("unbekannter Zustand, fehlende Textdatei und --labels werden abgewiesen", () => {
  mitLokal((dir, datei) => {
    const vorher = readFileSync(datei, "utf-8");
    const falsch = stand(dir, "kaputt", "x");
    assert.equal(falsch.status, 1);
    assert.match(falsch.stderr, /laeuft \| abgebrochen \| wartet \| fertig/);
    const ohneText = runBoard(dir, ["issue", "stand", "7", "--zustand", "laeuft"]);
    assert.equal(ohneText.status, 1);
    assert.match(ohneText.stderr, /--text-file/);
    const mitLabels = runBoard(dir, ["issue", "stand", "7", "--zustand", "laeuft", "--text-file", join(dir, "stand.md"), "--labels", "a,b,c"]);
    assert.equal(mitLabels.status, 1);
    assert.match(mitLabels.stderr, /--labels/);
    assert.equal(readFileSync(datei, "utf-8"), vorher, "nichts geschrieben");
  });
});
