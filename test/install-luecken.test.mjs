// Wege durch den Installer, die keine Bestandsdatei betritt (Issue #405).
//
// Vier Stellen, an denen der Installer eine Entscheidung trifft, die bisher nur in
// EINE Richtung geprueft war:
//
// 1. Weniger Antworten als Fragen. Im Piped-Modus ist das der Normalfall eines
//    verkuerzten Aufrufs — jede fehlende Zeile muss als "leer" gelten und damit den
//    Default uebernehmen, statt `undefined` in die Config zu schreiben.
// 2. Ein `glab`, das gar nicht da ist. Das Label-Setup darf daran nicht zerbrechen:
//    Die Installation ist dann fertig, nur die Labels fehlen.
// 3. Eine `.gitignore` ohne abschliessenden Zeilenumbruch. Ohne den eingefuegten
//    Umbruch klebte der Block an die letzte Zeile — und beide Eintraege waeren
//    unwirksam.
// 4. Ein gemischtes Gespann: Code bei `local`, Issues bei GitHub. Der Hinweis auf
//    `gh auth login` haengt an BEIDEN Feldern, nicht nur am Code-Host.
//
// Gefahren wird das ECHTE install.mjs aus dem Repo im Piped-Modus.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");

function fixture(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  return dir;
}

function installiere(dir, antworten, extraEnv = {}) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: dir,
    input: `${antworten.join("\n")}\n`,
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"), ...extraEnv },
  });
}

function config(dir) {
  return JSON.parse(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"));
}

test("fehlende Antwortzeilen gelten als leer und uebernehmen den Default", () => {
  const dir = fixture("install-kurze-antworten-");
  try {
    // Nur die ersten drei Fragen werden beantwortet; danach ist die Eingabe zu Ende.
    // Jede weitere Frage muss den Default nehmen — nicht `undefined` schreiben.
    const res = installiere(dir, ["projekt", "github", "github"]);

    assert.equal(res.status, 0, `Installer schlug fehl: ${res.stderr}\n${res.stdout}`);
    const c = config(dir);
    assert.equal(c.mainBranch, "main", "der Default fuer mainBranch wurde nicht uebernommen");
    assert.equal(c.productionBranch, "production", "der Default fuer productionBranch wurde nicht uebernommen");
    assert.equal(c.reviewScope, "diff", "der Default fuer reviewScope wurde nicht uebernommen");
    const roh = readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8");
    assert.doesNotMatch(roh, /undefined/, "eine fehlende Antwort wurde als 'undefined' geschrieben");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ohne glab im PATH warnt das Label-Setup, ohne die Installation zu kippen", () => {
  const dir = fixture("install-ohne-glab-");
  try {
    // PATH auf ein leeres Verzeichnis: Ein installiertes glab der Entwicklermaschine
    // wuerde sonst echte Labels in einem echten Projekt anlegen.
    const leer = join(dir, "leerbin");
    mkdirSync(leer, { recursive: true });

    // Keine Spec-Antwortzeile: Bei issueTracker 'gitlab' entfaellt die Frage seit
    // Issue #461 (A19). Die neunte Zeile ist damit direkt das 'j' der Label-Frage.
    const res = installiere(dir, ["projekt", "gitlab", "gitlab", "", "", "", "", "", "j"], { PATH: leer });

    assert.equal(res.status, 0,
      `ein fehlendes glab darf die Installation nicht kippen: ${res.stderr}\n${res.stdout}`);
    assert.ok(existsSync(join(dir, ".claude", "workflow.config.json")),
      "die Config haette trotzdem entstehen muessen");
    // Fuenf Labels, fuenf Warnungen — und die Meldung nennt die Ursache.
    const warnungen = (res.stdout + res.stderr).split("\n").filter((z) => z.includes("✗"));
    assert.equal(warnungen.length, 5, `es haetten fuenf Label-Warnungen erscheinen muessen: ${warnungen.join(" | ")}`);
    assert.match(res.stdout + res.stderr, /ENOENT|not found|nicht gefunden/i,
      "die Meldung nennt nicht, dass das Werkzeug fehlt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("eine .gitignore ohne Schlusszeilenumbruch bekommt einen eingefuegt", () => {
  const dir = fixture("install-gitignore-ohne-nl-");
  try {
    // Ohne den eingefuegten Umbruch klebte der Block an "node_modules" — beide
    // Eintraege waeren damit unwirksam.
    writeFileSync(join(dir, ".gitignore"), "node_modules", "utf-8");

    const res = installiere(dir, ["projekt", "github", "github", "", "", "", ""]);

    assert.equal(res.status, 0, `Installer schlug fehl: ${res.stderr}\n${res.stdout}`);
    const zeilen = readFileSync(join(dir, ".gitignore"), "utf-8").split("\n");
    assert.equal(zeilen[0], "node_modules", "die vorhandene Zeile wurde veraendert");
    assert.ok(zeilen.includes(".claude/*"), "der .claude-Block fehlt");
    assert.ok(!zeilen.some((z) => z.startsWith("node_modules") && z.length > "node_modules".length),
      "der Block klebt an der letzten Zeile");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bei codeHost local und issueTracker github kommt der gh-Hinweis trotzdem", () => {
  const dir = fixture("install-gemischt-");
  try {
    // Das Zwei-Achsen-Modell erlaubt genau das: Code liegt lokal, die Issues bei
    // GitHub. Der Hinweis auf `gh auth login` haengt deshalb an BEIDEN Feldern.
    const res = installiere(dir, ["projekt", "local", "github", "", "", "", ""]);

    assert.equal(res.status, 0, `Installer schlug fehl: ${res.stderr}\n${res.stdout}`);
    const c = config(dir);
    assert.equal(c.codeHost, "local");
    assert.equal(c.issueTracker, "github");
    assert.match(res.stdout, /gh auth login/,
      "ohne den Hinweis laeuft der erste Board-Zugriff in einen Auth-Fehler");
    assert.doesNotMatch(res.stdout, /glab auth login/,
      "ein GitLab-Hinweis waere hier falsch");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
