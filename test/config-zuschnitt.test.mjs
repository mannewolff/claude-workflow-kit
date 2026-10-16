// Zuschnitt der Testgruppen fuer Installer, Werkzeuge, Sync und Einstellungen (Issue #1582).
//
// Beim `push main` fuer v4.2.4 meldete der Prueflauf die Gruppe `test/install-*` …
// `test/config-*` als „jedem Bereich zugeordnet": Sie trug fast alle Bereiche, weil zwei
// ihrer Tests (`test/kit-*`) Module des ganzen Kits laden. Damit lief sie bei jedem Paket mit,
// auch wenn dessen Aenderung keinen ihrer Tests betraf.
//
// Die Gruppen sind seither getrennt, und jede nennt nur die Bereiche, die ihre Tests
// tatsaechlich laden. Gemessen wird das mit derselben Verflechtung wie in
// test/config-teile.test.mjs (`kit/checks/verflechtung.mjs`, „laedt" und „nennt"
// zusammen) und derselben Glob-Aufloesung wie
// die Auswahl (`kit/checks.mjs`). config-teile prueft die untere Grenze — kein Bereich fehlt,
// den eine Testdatei laedt —, diese Datei die obere: kein Bereich steht da, den keine laedt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { globZuRegex, bereicheVorbereiten, aufrufen } from "../kit/checks.mjs";
import { verflechtungErheben, kopplungVon } from "../kit/checks/verflechtung.mjs";
import { normalisiereConfig } from "../kit/board/config-namen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Ueber normalisiereConfig gelesen: vor und nach der Umstellung auf englische Schluessel
// dieselben Namen (Issue #1728).
const { config } = normalisiereConfig(JSON.parse(readFileSync(join(repoRoot, ".claude", "workflow.config.json"), "utf-8")));

// Die Muster der beiden Gruppen vor dem Zuschnitt — die Testdateien, um die es geht.
const BISHERIGE_MUSTER = [
  "test/install-*.test.mjs", "test/tools-*.test.mjs", "test/changelog*.test.mjs", "test/derived-*.test.mjs",
  "test/copy-*.test.mjs", "test/sync-*.test.mjs", "test/kit-*.test.mjs", "test/einstellungen-*.test.mjs",
  "test/config-*.test.mjs",
  "test/ablauf-install-*.test.mjs", "test/ablauf-tools-*.test.mjs", "test/ablauf-changelog*.test.mjs",
  "test/ablauf-derived-*.test.mjs", "test/ablauf-copy-*.test.mjs", "test/ablauf-sync-*.test.mjs",
  "test/ablauf-kit-*.test.mjs", "test/ablauf-einstellungen-*.test.mjs",
];
const bisherige = BISHERIGE_MUSTER.map((muster) => globZuRegex(muster));

/**
 * Die Testdateien des Arbeitsstands: versioniert und neu angelegt, soweit nicht ignoriert.
 * Der Abschlusslauf eines Pakets steht vor dem Commit; nur die versionierten zu zaehlen,
 * liess die neue Testdatei von #1727 in zwei Gruppen durch (Issue #1741).
 */
function testdateien(root = repoRoot) {
  const res = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ":(glob)test/**/*.test.mjs"],
    { cwd: root, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ls-files schlug fehl: ${(res.stderr || "").trim()}`);
  return res.stdout.split("\0").filter((pfad) => pfad.length > 0);
}

/** Die Testaufrufe der Config mit ihren Dateimustern als Regexe. */
const testaufrufe = (config.buildChecks ?? [])
  .filter((eintrag) => typeof eintrag === "object" && eintrag.cmd.startsWith("node --test"))
  .map((eintrag) => ({ ...eintrag, regexe: [...eintrag.cmd.matchAll(/"([^"]+)"/g)].map((t) => globZuRegex(t[1])) }));

const erfasst = (aufruf, pfad) => aufruf.regexe.some((regex) => regex.test(pfad));

/** Die Testdateien der bisherigen Gruppen, die nicht in genau einer Gruppe laufen. */
function nichtInGenauEinerGruppe(dateien, aufrufe) {
  return dateien
    .filter((pfad) => bisherige.some((regex) => regex.test(pfad)))
    .map((pfad) => ({ pfad, n: aufrufe.filter((aufruf) => erfasst(aufruf, pfad)).length }))
    .filter(({ n }) => n !== 1)
    .map(({ pfad, n }) => `${pfad}: ${n} Gruppen`);
}

test("checks.mjs areas meldet kein Kommando mehr als jedem Bereich zugeordnet", () => {
  const res = aufrufen(["areas"], { cwd: repoRoot });
  assert.equal(res.status, 0, res.stderr);
  const breit = JSON.parse(res.stdout).kommandoUrteile
    .filter((urteil) => urteil.breit && urteil.kopplungsgrund === null)
    .map((urteil) => `${urteil.cmd} (${urteil.nennend} von ${urteil.von})`);
  assert.deepEqual(breit, [], "Kommandos, die bei (fast) jeder Aenderung laufen — Zuschnitt pruefen");
});

test("jede Testdatei der bisherigen Gruppen laeuft in genau einer Gruppe", () => {
  const dateien = testdateien().filter((pfad) => bisherige.some((regex) => regex.test(pfad)));
  assert.ok(dateien.length > 0, "keine Testdatei der bisherigen Gruppen gefunden");
  assert.deepEqual(nichtInGenauEinerGruppe(dateien, testaufrufe), [], "Testdateien, die nicht in genau einer Gruppe laufen");
});

test("eine neue, nicht committete Testdatei in zwei Gruppen wird gemeldet (Issue #1741)", () => {
  const dir = mkdtempSync(join(tmpdir(), "config-zuschnitt-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: dir }).status, 0);
    mkdirSync(join(dir, "test"));
    writeFileSync(join(dir, "test", "einstellungen-neu.test.mjs"), "");
    const zweiGruppen = ["test/einstellungen-*.test.mjs", "test/einstellungen-neu*.test.mjs"]
      .map((muster) => ({ regexe: [globZuRegex(muster)] }));
    assert.deepEqual(nichtInGenauEinerGruppe(testdateien(dir), zweiGruppen), ["test/einstellungen-neu.test.mjs: 2 Gruppen"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("die kitweiten Tests laufen in einer eigenen Gruppe, getrennt von Installer und Einstellungen", () => {
  const gruppeVon = (pfad) => testaufrufe.find((aufruf) => erfasst(aufruf, pfad))?.cmd;
  const kitweit = gruppeVon("test/kit-texte-ablage.test.mjs");
  assert.ok(kitweit, "test/kit-texte-ablage.test.mjs laeuft in keiner Gruppe");
  for (const pfad of ["test/install-luecken.test.mjs", "test/sync-blobs-en.test.mjs", "test/einstellungen-ebenen.test.mjs"]) {
    assert.notEqual(gruppeVon(pfad), kitweit, `${pfad} laeuft mit den kitweiten Tests`);
  }
  assert.notEqual(gruppeVon("test/install-luecken.test.mjs"), gruppeVon("test/einstellungen-ebenen.test.mjs"),
    "Installer- und Einstellungstests laufen in derselben Gruppe");
});

test("jede Gruppe der bisherigen Testdateien nennt nur Bereiche, die eine ihrer Testdateien laedt", () => {
  // Ohne die Geruest-Liste gemessen (Issue #1722): Ein Geruest-Pfad erzwingt keinen Bereich
  // (untere Grenze, config-teile), aber dass ein Test ihn nennt, traegt einen Bereich (obere
  // Grenze; ein Bereich darf vorsichtiger sein, #914). Seit Plan #1713, E9 stehen
  // `.claude/workflow.config.json` und `README.md` in der Liste, obwohl die Config-Tests sie
  // wirklich lesen — mit ihr gemessen fielen `konfiguration` und `skills-doku` aus deren Gruppen.
  const tabelle = kopplungVon(verflechtungErheben({ repoRoot }));
  const bereiche = bereicheVorbereiten(config.checkAreas ?? {});
  const bereicheVon = (pfad) => bereiche.filter((b) => b.regexe.some((r) => r.test(pfad))).map((b) => b.name);
  const dateien = testdateien();

  const ueberzaehlig = [];
  for (const aufruf of testaufrufe) {
    const eigene = dateien.filter((pfad) => erfasst(aufruf, pfad));
    if (!eigene.some((pfad) => bisherige.some((regex) => regex.test(pfad)))) continue;
    // Gebraucht: der Bereich der Testdatei selbst und die Bereiche jeder Quelle, die sie laedt.
    const gebraucht = new Set(eigene.flatMap((pfad) => [pfad, ...(tabelle.get(pfad) ?? [])]).flatMap(bereicheVon));
    for (const bereich of aufruf.areas ?? []) {
      if (!gebraucht.has(bereich)) ueberzaehlig.push(`${bereich}: ${aufruf.cmd}`);
    }
  }
  assert.deepEqual(ueberzaehlig.sort(), [], "Bereiche, deren Aenderung eine Gruppe ausloest, ohne dass einer ihrer Tests sie laedt");
});
