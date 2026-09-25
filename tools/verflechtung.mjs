#!/usr/bin/env node
/**
 * verflechtung.mjs — erhebt je versionierter Testdatei die Menge der
 * Quelldateien, die sie laedt (Issue #931, Plan #930, E5).
 *
 * Der Plan stellt die bereichsbezogene Auswahl der Pruefungen um. Jeder Schnitt
 * legt sich gegen die tatsaechliche Verflechtung von Test und Quelle; ohne
 * Erhebung waere er geraten, und er irrte in die Richtung, in der der Fehler
 * niemandem auffaellt: Ein Bereich, der seine Testgruppe nicht ausloest, ist
 * still gruen.
 *
 * Das Verfahren ist bewusst konservativ und statisch (E5):
 *
 *   1. Die Import-Kette, verfolgt durch `test/**` hindurch — eine Testdatei
 *      laedt ihre Quellen oft ueber einen Helfer unter `test/helpers/`. Ein
 *      Graph, der an der Helferdatei endet, saehe diese Kopplung nicht (E8).
 *   2. Jede Erwaehnung eines Quellpfads als Zeichenkette im Dateitext. Die
 *      Kit-Werkzeuge starten einander als Kindprozess; ein reiner Import-Graph
 *      saehe die wichtigste Kopplung des Repos nicht.
 *
 * Eine Erwaehnung faelschlich als Kopplung zu zaehlen irrt in die sichere
 * Richtung und ist gewollt: Die Auswahl darf nur zu mehr Pruefung irren, nie zu
 * weniger. Deshalb bleibt auch ein kurzer Wurzelpfad (`README.md`,
 * `package.json`) in der Quellmenge, obwohl ihn fast jeder Test in einem
 * Wegwerfprojekt nennt — wer ihn herausnaehme, entschiede damit ueber den
 * Schnitt, und das ist nicht Sache der Erhebung.
 *
 * Die Kette laeuft ausdruecklich NICHT von Quelle zu Quelle weiter. Diese
 * Richtung traegt der Plan ueber die `areas`-Liste je Pruefkommando: Laedt
 * `night.mjs` den Board-Adapter, fuehrt das Nacht-Kommando den Bereich `board`.
 * Beide Wege zugleich beschrieben dieselbe Regel zweimal.
 *
 * Nutzung:
 *   node tools/verflechtung.mjs        Tabelle auf der Standardausgabe
 *   import { verflechtungErheben }     dieselbe Tabelle als Map
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Ein Pfad in der Schreibweise der Config: Posix-Trenner, repo-relativ. */
function posix(pfad) {
  return pfad.split("\\").join("/");
}

/**
 * Die versionierten Dateien des Repositories.
 *
 * Eine leere Antwort ist ein Fehler und kein leerer Fall: Sie entstuende bei
 * einem Aufruf ausserhalb des Repos — und die Erhebung meldete dann eine
 * Verflechtung von null, die wie „keine Kopplung" aussieht.
 */
function versionierte(repoRoot) {
  const res = spawnSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf-8" });
  if (res.status !== 0) {
    throw new Error(`git ls-files schlug fehl: ${(res.stderr || "").trim()}`);
  }
  const dateien = res.stdout.split("\0").filter((p) => p.length > 0).map(posix);
  if (dateien.length === 0) throw new Error(`git ls-files fand nichts unter ${repoRoot}`);
  return dateien;
}

/** Die relativen Import-Ziele einer Datei — `from "…"`, `import("…")`, `export … from "…"`. */
function importZiele(text) {
  const ziele = [];
  for (const treffer of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const ziel = treffer[1];
    if (ziel.startsWith("./") || ziel.startsWith("../")) ziele.push(ziel);
  }
  return ziele;
}

/**
 * Ein Import-Ziel einer Datei als repo-relativer Pfad.
 *
 * Ein Ziel unter `test/` ist Durchgangsstation (die Kette laeuft weiter), jedes
 * andere ist ein Blatt: die Quelldatei, die gesucht wird.
 */
function zielPfad(datei, ziel, repoRoot) {
  return posix(relative(repoRoot, resolve(join(repoRoot, dirname(datei)), ziel)));
}

/**
 * Die Importe einer Datei, getrennt nach Blatt und Durchgangsstation.
 *
 * @returns {{ quellen: string[], weiter: string[] }}
 */
function importeAuswerten(datei, text, { repoRoot, quellmenge }) {
  const quellen = [];
  const weiter = [];
  for (const ziel of importZiele(text)) {
    const pfad = zielPfad(datei, ziel, repoRoot);
    if (pfad.startsWith("test/")) weiter.push(pfad);
    else if (quellmenge.has(pfad)) quellen.push(pfad);
  }
  return { quellen, weiter };
}

/** Jede Quelldatei, deren Pfad als Zeichenkette im Text steht (E5, zweite Haelfte). */
function erwaehnte(text, quellmenge) {
  const gefunden = [];
  for (const quelle of quellmenge) {
    if (text.includes(quelle)) gefunden.push(quelle);
  }
  return gefunden;
}

/**
 * Die Menge der Quelldateien, die eine Testdatei laedt.
 *
 * `gelesen` verhindert die Endlosschleife bei zwei Helfern, die sich
 * gegenseitig laden; ohne sie haengt die Erhebung, statt zu irren.
 */
function quellenZu(testdatei, ctx) {
  const quellen = new Set();
  const offen = [testdatei];
  const gelesen = new Set([testdatei]);

  while (offen.length > 0) {
    const datei = offen.pop();
    const text = ctx.textVon(datei);
    if (text === null) continue;

    const { quellen: blaetter, weiter } = importeAuswerten(datei, text, ctx);
    for (const pfad of blaetter) quellen.add(pfad);
    for (const pfad of weiter) {
      if (gelesen.has(pfad)) continue;
      gelesen.add(pfad);
      offen.push(pfad);
    }
    for (const pfad of erwaehnte(text, ctx.quellmenge)) quellen.add(pfad);
  }

  return [...quellen].sort();
}

/**
 * Die Verflechtungstabelle: je versionierter Testdatei die sortierte Liste der
 * Quelldateien, die sie laedt.
 *
 * @param {{ repoRoot?: string }} [optionen]
 * @returns {Map<string, string[]>} Testpfad → Quellpfade, beide repo-relativ
 */
export function verflechtungErheben({ repoRoot = KIT_ROOT } = {}) {
  const alle = versionierte(repoRoot);
  const testdateien = alle.filter((p) => /^test\/.*\.test\.mjs$/.test(p)).sort();
  const quellmenge = new Set(alle.filter((p) => !p.startsWith("test/")));

  const zwischenspeicher = new Map();
  const textVon = (datei) => {
    if (zwischenspeicher.has(datei)) return zwischenspeicher.get(datei);
    let text = null;
    try {
      text = readFileSync(join(repoRoot, datei), "utf-8");
    } catch {
      // Ein Import, der auf keine versionierte Datei zeigt (Verzeichnis-Index,
      // nicht versionierte Hilfsdatei): kein Fehler, nur keine Kopplung.
      text = null;
    }
    zwischenspeicher.set(datei, text);
    return text;
  };

  const tabelle = new Map();
  for (const testdatei of testdateien) {
    tabelle.set(testdatei, quellenZu(testdatei, { repoRoot, quellmenge, textVon }));
  }
  return tabelle;
}

/** Die Tabelle als Markdown — so, wie sie als Kommentar ans Arbeitspaket geht. */
export function tabelleAlsMarkdown(tabelle) {
  const zeilen = ["| Testdatei | Quelldateien | Anzahl |", "|---|---|---|"];
  for (const [testdatei, quellen] of tabelle) {
    const liste = quellen.map((q) => "`" + q + "`").join(", ") || "—";
    zeilen.push(`| \`${testdatei}\` | ${liste} | ${quellen.length} |`);
  }
  return zeilen.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tabelle = verflechtungErheben();
  process.stdout.write(`${tabelleAlsMarkdown(tabelle)}\n`);
}
