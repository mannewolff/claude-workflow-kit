// Die Einstellungsoberflaeche zeigt die Projektsprache im Teil Grundlagen (Issue #1431, Plan #1420 E2, E12).
//
// Ohne Feld gilt Deutsch; gelesen wird `language`, sonst der deutsche Altname `sprache`.
// Umgestellt wird nicht in der Oberflaeche, sondern ueber den Installer — die Oberflaeche nennt
// nur das Kommando. Die Datei wird allein verteilt: Der Test startet sie deshalb aus einem
// Wegwerf-Verzeichnis, in dem neben ihr nur ein Projekt mit seiner Config liegt.
// Ablauf-Pruefung: Dass die Datei allein, ohne Repo-Kontext, startet, zeigt nur ihr Start als eigener Prozess aus einem Wegwerf-Verzeichnis.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const QUELLE = fileURLToPath(new URL("../kit/einstellungen.mjs", import.meta.url));

/** Startet die kopierte Oberflaeche ueber einem Projekt mit `team` und liefert dessen Zustand und die Seite. */
async function zustandMit(team) {
  const wurzel = mkdtempSync(join(tmpdir(), "einstellungen-sprache-"));
  const kit = join(wurzel, "kit");
  const ordner = join(wurzel, "projekte");
  mkdirSync(kit);
  mkdirSync(join(ordner, "alpha", ".claude"), { recursive: true });
  copyFileSync(QUELLE, join(kit, "einstellungen.mjs"));
  writeFileSync(join(ordner, "alpha", ".claude", "workflow.config.json"), `${JSON.stringify(team, null, 2)}\n`);
  const kind = spawn(process.execPath, [join(kit, "einstellungen.mjs"), ordner, "--port", "0"], { cwd: wurzel, env: { ...process.env, HOME: wurzel } });
  try {
    const url = await new Promise((fertig, fehler) => {
      let text = "";
      kind.stdout.on("data", (c) => {
        text += c;
        const treffer = text.match(/Öffnen: (\S+)/);
        if (treffer) fertig(treffer[1]);
      });
      kind.on("exit", (code) => fehler(new Error(`Oberflaeche endete mit ${code}`)));
    });
    const { origin, hash } = new URL(url);
    const token = hash.replace("#token=", "");
    const res = await fetch(`${origin}/api/projekt/alpha`, { headers: { "X-Einstellungen-Token": token } });
    assert.equal(res.status, 200);
    const seite = await (await fetch(`${origin}/`)).text();
    return { zustand: await res.json(), seite };
  } finally {
    kind.kill();
    rmSync(wurzel, { recursive: true, force: true });
  }
}

const BASIS = { codeHost: "local", issueTracker: "local", buildChecks: ["node --test"], mainBranch: "main" };

test("[einstellungen-sprache] ohne Feld zeigt der Teil Grundlagen Deutsch und nennt den Weg zur Umstellung", async () => {
  const { zustand, seite } = await zustandMit(BASIS);
  assert.deepEqual(zustand.grundlagen.sprache, { wert: "de", anzeige: "Deutsch", umstellung: "node install.mjs --language en" });
  assert.match(seite, /Grundlagen/);
  assert.match(seite, /grundlagen\.sprache/);
});

test("[einstellungen-sprache] language: en zeigt English", async () => {
  const { zustand } = await zustandMit({ ...BASIS, language: "en" });
  assert.equal(zustand.grundlagen.sprache.anzeige, "English");
  assert.equal(zustand.grundlagen.sprache.umstellung, "node install.mjs --language de", "zurück geht es mit --language de");
});

test("[einstellungen-sprache] der Altname sprache: en zeigt English", async () => {
  const { zustand } = await zustandMit({ ...BASIS, sprache: "en" });
  assert.equal(zustand.grundlagen.sprache.wert, "en");
  assert.equal(zustand.grundlagen.sprache.anzeige, "English");
});
