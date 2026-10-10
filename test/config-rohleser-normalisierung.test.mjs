// Rohleser der Config lesen ueber normalisiereConfig (Issue #1436, Plan #1420 E10).
//
// Neben loadConfig lesen mehrere Module die Config roh ein und greifen direkt auf die
// deutschen Schluessel zu. In einem englisch benannten Projekt faenden sie ihre
// Einstellungen nicht. Der Quelltext-Scan haelt fest, dass jede Stelle unter kit/, die
// workflow.config mit JSON.parse liest, die Config ueber normalisiereConfig oder loadConfig
// bezieht — auch ein kuenftiger neuer Rohleser faellt ihm auf. Die zwei Stichproben belegen
// das Verhalten an einer englisch benannten Config.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mitRepo, plan, datei, kommandos } from "./helpers/checks-repo.mjs";
import { befundeZurueck } from "../kit/night/kitstand.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(ROOT, "kit");

/** Wie weit vor einem JSON.parse die Zuweisung seiner Pfadvariable stehen darf. */
const FENSTER_DAVOR = 30;
/** Wie weit nach dem JSON.parse der Normalisierer stehen darf. */
const FENSTER_DANACH = 2;
const CONFIG_NAME = /workflow\.config|CONFIG_DATEI/;

/**
 * Die Lader selbst: Sie lesen beide Dateien roh und normalisieren vor dem Mischen
 * (Issue #1435, belegt in test/ablauf-workflow-config-merge.test.mjs).
 */
const LADER = new Set(["kit/board/grundlagen.mjs", "kit/night/grundlagen.mjs"]);

function mjsDateien(ordner) {
  return readdirSync(ordner, { withFileTypes: true }).flatMap((e) => {
    const pfad = join(ordner, e.name);
    if (e.isDirectory()) return mjsDateien(pfad);
    return e.name.endsWith(".mjs") ? [pfad] : [];
  });
}

const istKommentar = (zeile) => /^\s*(\/\/|\*|\/\*)/.test(zeile);

/**
 * Nennt der Ausdruck `text` die Config-Datei — unmittelbar oder ueber eine Variable, deren
 * Zuweisung (`name =` oder `name of liste`) bis zu FENSTER_DAVOR Zeilen ueber `bis` steht?
 */
function nenntConfig(zeilen, bis, text, tiefe = 0) {
  if (CONFIG_NAME.test(text)) return true;
  if (tiefe > 2) return false;
  const name = /readFileSync\(\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(text)?.[1] ?? (tiefe > 0 ? text : null);
  if (!name) return false;
  const zuweisung = new RegExp(`\\b${name}\\s*=[^=]|\\b${name}\\s+of\\s+([A-Za-z_$][\\w$]*)`);
  for (let i = bis; i >= Math.max(0, bis - FENSTER_DAVOR); i--) {
    if (istKommentar(zeilen[i])) continue;
    const treffer = zuweisung.exec(zeilen[i]);
    if (!treffer) continue;
    if (treffer[1]) return nenntConfig(zeilen, i - 1, treffer[1], tiefe + 1);
    return CONFIG_NAME.test(zeilen.slice(i, i + 4).join("\n"));
  }
  return false;
}

/** Je JSON.parse, das workflow.config liest, Datei und Zeile — ohne Kommentarzeilen. */
function configLeser() {
  const funde = [];
  for (const pfad of mjsDateien(KIT)) {
    const ort = relative(ROOT, pfad).split("\\").join("/");
    if (LADER.has(ort)) continue;
    const zeilen = readFileSync(pfad, "utf-8").split("\n");
    zeilen.forEach((zeile, i) => {
      if (istKommentar(zeile) || !zeile.includes("JSON.parse(")) return;
      if (!nenntConfig(zeilen, i - 1, zeile)) return;
      const umfeld = zeilen.slice(i, i + 1 + FENSTER_DANACH).join("\n");
      funde.push({ ort: `${ort}:${i + 1}`, normalisiert: /normalisiereConfig\(|loadConfig\(/.test(umfeld) });
    });
  }
  return funde;
}

test("[config-rohleser] jeder Rohleser von workflow.config unter kit/ normalisiert", () => {
  const funde = configLeser();
  assert.ok(funde.length >= 9, `der Scan fand nur ${funde.length} Leser — er greift nicht mehr`);
  const offen = funde.filter((f) => !f.normalisiert).map((f) => f.ort);
  assert.deepEqual(offen, [], `diese Stellen lesen workflow.config ohne normalisiereConfig: ${offen.join(", ")}`);
});

test("[config-rohleser] checks.mjs versteht die Stufe unter dem englischen Namen", async () => {
  const config = {
    buildChecks: [{ cmd: "echo paket" }, { cmd: "echo push", stage: "push" }],
    checkAreas: { frontend: ["frontend/**"] },
  };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "frontend/src/App.tsx");
    const ergebnis = plan(dir);
    assert.deepEqual(kommandos(ergebnis.laufen), ["echo paket"]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), ["echo push"]);
  });
});

test("[config-rohleser] kitstand.mjs liest die Befunde-Schwelle unter dem englischen Namen", () => {
  const repo = mkdtempSync(join(tmpdir(), "rohleser-haupt-"));
  const wt = mkdtempSync(join(tmpdir(), "rohleser-wt-"));
  const zeile = "2026-09-22T00:00:00.000Z\tplan\t2\treviewer\tluecke\tWICHTIG\t-\n";
  try {
    mkdirSync(join(repo, ".claude"), { recursive: true });
    mkdirSync(join(wt, ".claude"), { recursive: true });
    writeFileSync(join(repo, ".claude", "befunde.tsv"), zeile);
    writeFileSync(join(wt, ".claude", "befunde.tsv"), zeile);
    writeFileSync(join(repo, ".claude", "workflow.config.json"),
      JSON.stringify({ language: "en", findings: { threshold: 2 } }));
    assert.deepEqual(befundeZurueck(wt, repo), ["luecke"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
  }
});
