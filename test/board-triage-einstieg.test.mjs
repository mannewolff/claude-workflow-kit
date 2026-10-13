// Einstieg und Ablage von /triage (Issue #1628, Plan #1623 A3, A11, A12, E2):
// `triageEinstieg` prueft die Gruende in fester Reihenfolge, `ablageLesen` liest die Ablage
// `.claude/ideas/<N>/` und legt sie nie an.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { triageEinstieg, ablageLesen } from "../kit/board/triage.mjs";
import { spracheFestlegen } from "../kit/board/namen.mjs";

afterEach(() => spracheFestlegen(null));

const karte = ({ id = "42", title = "[Idea] Export" } = {}) => ({ id, title, body: "Ein Export.", labels: [] });
const OHNE_AUFSICHT = {};

test("keine Idee: jede andere Karte wird abgewiesen", () => {
  for (const title of ["[Plan] Export", "[Requirement] Export", "[Fachlich] Export", "[Task] Export", "Export"]) {
    const e = triageEinstieg(karte({ title }), OHNE_AUFSICHT);
    assert.equal(e.start, false, title);
    assert.equal(e.grund, "keine-idee", title);
    assert.match(e.meldung, /#42/, title);
  }
});

test("[Idea] und der fruehere deutsche Name [Idee] gelten als Idee", () => {
  assert.deepEqual(triageEinstieg(karte(), OHNE_AUFSICHT), { start: true, grund: null, meldung: null });
  assert.deepEqual(triageEinstieg(karte({ title: "[Idee] Export" }), OHNE_AUFSICHT), { start: true, grund: null, meldung: null });
});

test("keine-idee geht vor unbeaufsichtigt", () => {
  assert.equal(triageEinstieg(karte({ title: "[Plan] x" }), { KIT_AGENT_MODEL: "opus" }).grund, "keine-idee");
});

test("unbeaufsichtigt bei gesetztem, nicht leerem KIT_AGENT_MODEL", () => {
  const e = triageEinstieg(karte(), { KIT_AGENT_MODEL: "claude-opus-5-5" });
  assert.equal(e.start, false);
  assert.equal(e.grund, "unbeaufsichtigt");
  assert.ok(e.meldung);
});

test("leeres KIT_AGENT_MODEL zaehlt nicht als unbeaufsichtigt", () => {
  assert.equal(triageEinstieg(karte(), { KIT_AGENT_MODEL: "" }).start, true);
  assert.equal(triageEinstieg(karte(), { KIT_AGENT_MODEL: "  " }).start, true);
  assert.equal(triageEinstieg(karte()).start, true);
});

test("englische Meldung im englischen Projekt", () => {
  spracheFestlegen("en");
  assert.match(triageEinstieg(karte({ title: "[Plan] x" }), OHNE_AUFSICHT).meldung, /is not an idea/);
});

function mitWurzel(lauf) {
  const wurzel = mkdtempSync(join(tmpdir(), "triage-ablage-"));
  try {
    lauf(wurzel);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
}

test("fehlende Ablage: nicht vorhanden, keine Dateien, und es wird nichts angelegt", () => mitWurzel((wurzel) => {
  const a = ablageLesen(wurzel, "7");
  assert.deepEqual(a, { pfad: ".claude/ideas/7", vorhanden: false, dateien: [] });
  assert.equal(existsSync(join(wurzel, ".claude")), false, "ablageLesen legt kein Verzeichnis an");
}));

test("leere Ablage: vorhanden, keine Dateien", () => mitWurzel((wurzel) => {
  mkdirSync(join(wurzel, ".claude", "ideas", "7"), { recursive: true });
  assert.deepEqual(ablageLesen(wurzel, "7"), { pfad: ".claude/ideas/7", vorhanden: true, dateien: [] });
}));

test("gefuellte Ablage: gelesene Endungen nach A12, alles andere nicht gelesen, Ziel je Datei", () => mitWurzel((wurzel) => {
  const ablage = join(wurzel, ".claude", "ideas", "7");
  mkdirSync(join(ablage, "unterordner"), { recursive: true });
  const gelesen = ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.WebP", "f.pdf", "g.md"];
  const nicht = ["h.docx", "i.txt", "ohne-endung", "j.png.zip"];
  for (const datei of [...gelesen, ...nicht]) writeFileSync(join(ablage, datei), "x");

  const a = ablageLesen(wurzel, "7");
  assert.equal(a.vorhanden, true);
  const nachName = Object.fromEntries(a.dateien.map((d) => [d.name, d]));
  for (const datei of gelesen) {
    assert.deepEqual(nachName[datei], { name: datei, gelesen: true, vorlageZiel: `design/ideas/7/${datei}` }, datei);
  }
  for (const datei of nicht) {
    assert.deepEqual(nachName[datei], { name: datei, gelesen: false, vorlageZiel: `design/ideas/7/${datei}` }, datei);
  }
  assert.deepEqual(nachName.unterordner, { name: "unterordner", gelesen: false, vorlageZiel: null });
  assert.deepEqual(a.dateien.map((d) => d.name), [...a.dateien.map((d) => d.name)].sort(), "nach Namen geordnet");
}));

test("ein fuehrendes # an der Nummer zaehlt nicht", () => mitWurzel((wurzel) => {
  assert.equal(ablageLesen(wurzel, "#7").pfad, ".claude/ideas/7");
}));
