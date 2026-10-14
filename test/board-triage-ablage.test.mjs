// Abschluss der Ablage von /triage (Issue #1629, Plan #1623 A13, E2): `ablageAbschliessen`
// verschiebt eine Vorlage nach `design/ideas/<N>/` und loescht danach `.claude/ideas/<N>/`.
// Fehlt die genannte Vorlage, bleibt alles stehen.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ablageAbschliessen, ablageLesen, VORLAGE_ORT } from "../kit/board/triage.mjs";
import { spracheFestlegen } from "../kit/board/namen.mjs";

const wurzeln = [];
afterEach(() => {
  spracheFestlegen(null);
  for (const w of wurzeln.splice(0)) rmSync(w, { recursive: true, force: true });
});

/** Eine Projektwurzel mit der Ablage `.claude/ideas/<id>/` und den genannten Dateien. */
function projekt(id, dateien = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), "triage-ablage-"));
  wurzeln.push(wurzel);
  const ablage = join(wurzel, ".claude", "ideas", id);
  mkdirSync(ablage, { recursive: true });
  for (const [name, inhalt] of Object.entries(dateien)) writeFileSync(join(ablage, name), inhalt);
  return { wurzel, ablage };
}

test("der dauerhafte Ort ist design/ideas", () => {
  assert.equal(VORLAGE_ORT, "design/ideas");
});

test("ohne Vorlage: die Ablage wird vollstaendig geloescht", () => {
  const { wurzel, ablage } = projekt("7", { "a.md": "a", "b.txt": "b" });
  mkdirSync(join(ablage, "unter"));
  writeFileSync(join(ablage, "unter", "c.png"), "c");
  const r = ablageAbschliessen(wurzel, "7");
  assert.deepEqual(r, { ok: true, pfad: ".claude/ideas/7", geloescht: true, vorlage: null, meldung: null });
  assert.equal(existsSync(ablage), false);
  assert.equal(existsSync(join(wurzel, VORLAGE_ORT)), false);
});

test("mit Vorlage: genau diese Datei wandert, danach ist die Ablage weg", () => {
  const { wurzel, ablage } = projekt("7", { "skizze.png": "bild", "notiz.md": "n" });
  const r = ablageAbschliessen(wurzel, "#7", "skizze.png");
  assert.deepEqual(r, { ok: true, pfad: ".claude/ideas/7", geloescht: true, vorlage: "design/ideas/7/skizze.png", meldung: null });
  assert.equal(readFileSync(join(wurzel, "design", "ideas", "7", "skizze.png"), "utf-8"), "bild");
  assert.equal(existsSync(join(wurzel, "design", "ideas", "7", "notiz.md")), false);
  assert.equal(existsSync(ablage), false);
});

test("fehlende Vorlage-Datei bricht ab und laesst die Ablage stehen", () => {
  const { wurzel, ablage } = projekt("7", { "notiz.md": "n" });
  const r = ablageAbschliessen(wurzel, "7", "skizze.png");
  assert.equal(r.ok, false);
  assert.equal(r.geloescht, false);
  assert.equal(r.vorlage, null);
  assert.match(r.meldung, /skizze\.png/);
  assert.match(r.meldung, /\.claude\/ideas\/7/);
  assert.ok(existsSync(join(ablage, "notiz.md")));
  assert.equal(existsSync(join(wurzel, VORLAGE_ORT)), false);
});

test("eine Vorlage ausserhalb der Ablage oder ein Verzeichnis gilt als fehlend", () => {
  const { wurzel, ablage } = projekt("7", { "notiz.md": "n" });
  mkdirSync(join(ablage, "unter"));
  writeFileSync(join(wurzel, "aussen.png"), "x");
  for (const vorlage of ["../../../aussen.png", "unter", "unter/../notiz.md", ".", ".."]) {
    const r = ablageAbschliessen(wurzel, "7", vorlage);
    assert.equal(r.ok, false, vorlage);
    assert.ok(existsSync(join(ablage, "notiz.md")), vorlage);
  }
  assert.ok(existsSync(join(wurzel, "aussen.png")));
});

test("fehlende Ablage ist kein Fehler", () => {
  const wurzel = mkdtempSync(join(tmpdir(), "triage-ablage-"));
  wurzeln.push(wurzel);
  assert.deepEqual(ablageAbschliessen(wurzel, "9"), { ok: true, pfad: ".claude/ideas/9", geloescht: false, vorlage: null, meldung: null });
});

test("fehlende Ablage mit genannter Vorlage bricht ab", () => {
  const wurzel = mkdtempSync(join(tmpdir(), "triage-ablage-"));
  wurzeln.push(wurzel);
  const r = ablageAbschliessen(wurzel, "9", "skizze.png");
  assert.equal(r.ok, false);
  assert.equal(r.geloescht, false);
});

test("die Meldung folgt der Projektsprache", () => {
  const { wurzel } = projekt("7");
  spracheFestlegen("en");
  assert.match(ablageAbschliessen(wurzel, "7", "skizze.png").meldung, /not found/);
});

test("Szenario: Eine Idee mit Bild wird zur fachlichen Anforderung", () => {
  const { wurzel, ablage } = projekt("12", { "skizze.png": "bild" });
  assert.deepEqual(ablageLesen(wurzel, "12").dateien.map((d) => [d.name, d.gelesen]), [["skizze.png", true]]);
  const r = ablageAbschliessen(wurzel, "12");
  assert.equal(r.ok, true);
  assert.equal(r.geloescht, true);
  assert.equal(existsSync(ablage), false);
  assert.equal(ablageLesen(wurzel, "12").vorhanden, false);
});

test("Szenario: Eine Skizze wird zur Vorlage und bleibt erhalten", () => {
  const { wurzel, ablage } = projekt("12", { "skizze.png": "bild", "begleit.pdf": "pdf" });
  const ziel = ablageLesen(wurzel, "12").dateien.find((d) => d.name === "skizze.png").vorlageZiel;
  const r = ablageAbschliessen(wurzel, "12", "skizze.png");
  assert.equal(r.ok, true);
  assert.equal(r.vorlage, ziel);
  assert.equal(r.vorlage, "design/ideas/12/skizze.png");
  assert.equal(readFileSync(join(wurzel, r.vorlage), "utf-8"), "bild");
  assert.equal(existsSync(join(ablage, "begleit.pdf")), false);
  assert.equal(existsSync(ablage), false);
});
