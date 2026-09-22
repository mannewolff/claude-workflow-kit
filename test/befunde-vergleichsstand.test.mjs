// Der Vergleichsstand der Code-Stufe (Issue #802, Plan #797, E12 — AK 10 der Quelle #768).
//
// `buchen --stufe code` ermittelt aus `.claude/checks-summary.json`, ob die
// maschinellen Pflichtpruefungen auf demselben Stand gruen waren: Er ist `gruen`,
// wenn jeder Eintrag unter `laufen` gruen ist, `leeresPaket` falsch ist und jede
// heute geaenderte Datei einen Eintrag unter `hashes` mit passendem Hash hat —
// sonst `nicht-vergleichbar`. Eine Auslassung wegen unberuehrten Bereichs ODER
// wegen der Stufe macht den Stand ausdruecklich NICHT unvergleichbar (W3 des
// Regeltextes; sonst gaelte jeder Code-Review vor dem Push als unvergleichbar).
//
// Echtes Repo statt Fixture, wie in den checks-Tests: Die Frage, ob eine danach
// erstmals geaenderte Datei durchfaellt, entscheidet `git diff`/`git status`,
// nicht ein Mock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { mitRepo, git, datei } from "./helpers/checks-repo.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BEFUNDE = join(repoRoot, "kit", "befunde.mjs");

const FUND = [
  "#### WICHTIG",
  "",
  "**C1 — Ein Code-Fund.**",
  "Gegenprobe: Eine Beobachtung. — geprueft, bestaetigt",
  "Art: korrektheit",
  "Uebernahme: uebernommen",
].join("\n");

/** `buchen --stufe code` im Wegwerf-Repo; die Eingangsdatei liegt unter `.claude/` (ignoriert). */
function buchenCode(dir) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const eingang = join(dir, ".claude", "befunde-eingang.md");
  writeFileSync(eingang, FUND, "utf-8");
  const res = spawnSync(process.execPath, [BEFUNDE, "buchen", "--datei", eingang, "--stufe", "code", "--karte", "42"], { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

/** Eine Zusammenfassung, wie `checks.mjs run` sie hinterlaesst — Felder je Test uebersteuert. */
function summary(dir, extra = {}) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const daten = {
    basis: "HEAD",
    stufe: "push",
    geaendert: [],
    bereiche: [],
    laufen: [{ cmd: "node -e \"process.exit(0)\"", stufe: "paket", grund: "laeuft", ergebnis: "gruen", dauerMs: 5 }],
    ausgelassen: [],
    vollerUmfang: false,
    leeresPaket: false,
    zeitpunkt: "2026-09-22T00:00:00.000Z",
    hashes: {},
    ...extra,
  };
  writeFileSync(join(dir, ".claude", "checks-summary.json"), JSON.stringify(daten, null, 2) + "\n", "utf-8");
}

function letzteZeile(dir) {
  const zeilen = readFileSync(join(dir, ".claude", "befunde.tsv"), "utf-8").split("\n").filter(Boolean);
  return zeilen.at(-1).split("\t");
}

test("gruen: lauter gruene Laeufe, leeresPaket falsch, keine ungedeckte Aenderung — trotz Auslassungen", () => {
  mitRepo({}, (dir) => {
    summary(dir, {
      ausgelassen: [
        { cmd: "a", stufe: "paket", grund: "Bereich 'kit' unberuehrt" },
        { cmd: "b", stufe: "push", grund: "Stufe push, gefahren wird paket" },
      ],
    });
    const json = buchenCode(dir);
    assert.equal(json.vergleichsstand, "gruen");
    assert.equal(letzteZeile(dir)[6], "gruen");
  });
});

test("gruen: eine geaenderte Datei mit passendem Eintrag unter hashes", () => {
  mitRepo({}, (dir) => {
    datei(dir, "a.txt", "neuer Stand\n");
    summary(dir, { geaendert: ["a.txt"], hashes: { "a.txt": git(dir, "hash-object", "a.txt") } });
    assert.equal(buchenCode(dir).vergleichsstand, "gruen");
  });
});

test("nicht-vergleichbar: leeresPaket ist wahr", () => {
  mitRepo({}, (dir) => {
    summary(dir, { leeresPaket: true, laufen: [] });
    assert.equal(buchenCode(dir).vergleichsstand, "nicht-vergleichbar");
  });
});

test("nicht-vergleichbar: ein Eintrag unter laufen ist nicht gruen", () => {
  mitRepo({}, (dir) => {
    summary(dir, {
      laufen: [
        { cmd: "a", ergebnis: "gruen", dauerMs: 5 },
        { cmd: "b", ergebnis: "rot", dauerMs: 5 },
      ],
    });
    assert.equal(buchenCode(dir).vergleichsstand, "nicht-vergleichbar");
  });
});

test("nicht-vergleichbar: eine nach dem Lauf erstmals geaenderte Datei ohne Eintrag unter hashes", () => {
  mitRepo({}, (dir) => {
    summary(dir);
    datei(dir, "neu.txt", "erst nach dem Lauf entstanden\n");
    assert.equal(buchenCode(dir).vergleichsstand, "nicht-vergleichbar");
  });
});

test("nicht-vergleichbar: eine geaenderte Datei mit abweichendem Hash", () => {
  mitRepo({}, (dir) => {
    datei(dir, "a.txt", "Stand beim Lauf\n");
    summary(dir, { geaendert: ["a.txt"], hashes: { "a.txt": git(dir, "hash-object", "a.txt") } });
    datei(dir, "a.txt", "danach weitergeaendert\n");
    assert.equal(buchenCode(dir).vergleichsstand, "nicht-vergleichbar");
  });
});

test("nicht-vergleichbar: die Zusammenfassung fehlt oder ist unlesbar — gebucht wird trotzdem", () => {
  mitRepo({}, (dir) => {
    const json = buchenCode(dir);
    assert.equal(json.vergleichsstand, "nicht-vergleichbar");
    assert.equal(json.geschrieben, 1, "der Vergleichsstand ist ein Spaltenwert, kein Gate");
    assert.equal(letzteZeile(dir)[6], "nicht-vergleichbar");
  });
  mitRepo({}, (dir) => {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "checks-summary.json"), "{ kein JSON", "utf-8");
    assert.equal(buchenCode(dir).vergleichsstand, "nicht-vergleichbar");
  });
});

test("portabel: befunde.mjs allein in einem leeren Verzeichnis — arten und pruefen laufen, buchen --stufe code meldet den fehlenden Nachbarn", () => {
  const dir = mkdtempSync(join(tmpdir(), "befunde-allein-"));
  try {
    const allein = join(dir, "befunde.mjs");
    copyFileSync(BEFUNDE, allein);

    const arten = spawnSync(process.execPath, [allein, "arten"], { cwd: dir, encoding: "utf-8" });
    assert.equal(arten.status, 0, arten.stderr);
    assert.equal(JSON.parse(arten.stdout).ok, true);

    writeFileSync(join(dir, "text.md"), FUND, "utf-8");
    const pruefen = spawnSync(process.execPath, [allein, "pruefen", "--datei", "text.md"], { cwd: dir, encoding: "utf-8" });
    assert.equal(pruefen.status, 0, pruefen.stderr);
    assert.equal(JSON.parse(pruefen.stdout).ok, true);

    const buchen = spawnSync(process.execPath, [allein, "buchen", "--datei", "text.md", "--stufe", "code", "--karte", "1"], { cwd: dir, encoding: "utf-8" });
    assert.equal(buchen.status, 1, "der fehlende Nachbar ist ein Fehler, kein stiller Lauf");
    const json = JSON.parse(buchen.stdout);
    assert.equal(json.ok, false);
    assert.match(json.fehler, /checks\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("portabel: buchen ohne Nachbarn laeuft fuer die Stufen ohne Vergleichsstand weiter", () => {
  const dir = mkdtempSync(join(tmpdir(), "befunde-allein-"));
  try {
    const allein = join(dir, "befunde.mjs");
    copyFileSync(BEFUNDE, allein);
    writeFileSync(join(dir, "text.md"), FUND, "utf-8");
    const res = spawnSync(process.execPath, [allein, "buchen", "--datei", "text.md", "--stufe", "plan", "--karte", "1"], { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(JSON.parse(res.stdout).geschrieben, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
