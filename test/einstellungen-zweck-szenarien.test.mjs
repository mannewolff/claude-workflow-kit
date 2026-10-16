// Szenarien aus Plan #1710 (Fachplan #1705): Einstellungen nach Zweck und mit englischen Namen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { normalisiereConfig } from "../kit/board/config-namen.mjs";
import { vorgeschichteAktiv } from "../kit/board/vorgeschichte.mjs";
import { pruefeForm } from "../kit/board/testhinweise.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Das Update eines bestehenden Projekts: der echte Installer im Wegwerf-Verzeichnis, cwd und
// HOME dort, wie in ablauf-install-flow.test.mjs. Dieselbe Antwortfolge wie dort
// PROJEKT_GITHUB_BESTAND; spawnSync schliesst stdin nach der letzten Antwort.
function update(config) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "einstellungen-update-")));
  mkdirSync(join(dir, "home"), { recursive: true });
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config, null, 2) + "\n");
  const fake = join(dir, "szenarien-fake.mjs");
  writeFileSync(fake, "console.log(JSON.stringify({ ab: 1 }));\n");
  const res = spawnSync(process.execPath, [join(repoRoot, "install.mjs")], {
    cwd: dir,
    input: ["projekt", "github", "j", "n", "github", "", "", "", "", "", "", ""].join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"), INSTALL_SZENARIEN_FAKE: fake },
  });
  const roh = JSON.parse(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"));
  rmSync(dir, { recursive: true, force: true });
  return { res, roh };
}

// Ein Fachplan ohne Abschnitt zur Vorgeschichte, sonst vollstaendig.
const FACHPLAN = `## Ziel
Der Nutzer sieht etwas.

## Fachliche Akzeptanzkriterien
- Der Nutzer sieht es.

## Nicht-Ziele
- Nichts weiter.

## Offene Fragen an den PO
- Keine.
`;

const vorgeschichteHinweise = (config) =>
  (pruefeForm(FACHPLAN, "[Requirement] x", config).hinweise ?? []).filter((h) => h.art === "vorgeschichte");

test("Szenario: Ältere Datei mit deutschen Namen", () => {
  // Angenommen auf einem älteren Zweig steht die Vorgeschichte noch unter ihrem deutschen Namen eingeschaltet
  const { config } = normalisiereConfig({ vorgeschichte: true, mainBranch: "main" });
  // Wenn auf diesem Zweig ein Fachplan entsteht, dann wirkt die Vorgeschichte wie eingeschaltet
  assert.equal(vorgeschichteAktiv(config), true);
});

test("Szenario: Einstellung aus der Doku in der eigenen Datei finden", () => {
  // Angenommen ein deutsches Projekt hat die Vorgeschichte eingeschaltet
  const { res, roh } = update({ sprache: "de", codeHost: "github", issueTracker: "github", vorgeschichte: true });
  assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
  // Wenn der Mensch auf der deutschen Einstellungsseite die Vorgeschichte nachschlaegt
  const seite = readFileSync(join(repoRoot, "docs", "einstellungen.md"), "utf-8");
  assert.match(seite, /^- `history` — /m);
  // Dann findet er den Eintrag in seiner Datei unter genau dem Namen, den die Seite nennt
  assert.equal(roh.history, true);
  assert.equal("vorgeschichte" in roh, false);
});

test("Szenario: Lohnender Schalter ist nach dem Update an", () => {
  // Angenommen ein Projekt hat die Vorgeschichte nie gesetzt
  const { res, roh } = update({ codeHost: "github", issueTracker: "github" });
  // Wenn das Projekt das naechste Update des Kits einspielt
  assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
  assert.equal("history" in roh, false, "das Update schreibt den Schalter nicht");
  // Dann entsteht der naechste Fachplan mit Abschnitt Vorgeschichte
  const { config } = normalisiereConfig(roh);
  assert.equal(vorgeschichteAktiv(config), true);
  assert.equal(vorgeschichteHinweise(config).length, 1);
});

test("Szenario: Bewusst ausgeschaltete Vorgeschichte bleibt aus", () => {
  // Angenommen ein Projekt hat die Vorgeschichte in seiner Einstellungsdatei ausgeschaltet
  const { res, roh } = update({ codeHost: "github", issueTracker: "github", vorgeschichte: false });
  // Wenn das Projekt das naechste Update des Kits einspielt
  assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
  assert.equal(roh.history, false);
  // Dann entsteht der naechste Fachplan ohne Abschnitt Vorgeschichte
  const { config } = normalisiereConfig(roh);
  assert.equal(vorgeschichteAktiv(config), false);
  assert.deepEqual(vorgeschichteHinweise(config), []);
  // und das Update hat nicht nachgefragt: Keine Frage nennt die Vorgeschichte. Die Liste der
  // alten Kommandonamen nennt `issue vorgeschichte → issue history` und ist keine Frage.
  const fragen = res.stdout.split("\n").filter((z) => /vorgeschichte|history/i.test(z) && z.includes("?"));
  assert.deepEqual(fragen, []);
});
