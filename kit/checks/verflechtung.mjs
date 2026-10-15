#!/usr/bin/env node
/**
 * checks/verflechtung.mjs — erhebt je Testdatei des Arbeitsstands die Quelldateien, die sie
 * laedt, und die, die sie nur nennt (Issue #931, Plan #930, E5; seit Issue #1714 ein
 * mitgelieferter Teil des Kits, Plan #1713 A1 und A2).
 *
 * Der Plan stellt die bereichsbezogene Auswahl der Pruefungen um. Jeder Schnitt
 * legt sich gegen die tatsaechliche Verflechtung von Test und Quelle; ohne
 * Erhebung waere er geraten, und er irrte in die Richtung, in der der Fehler
 * niemandem auffaellt: Ein Bereich, der seine Testgruppe nicht ausloest, ist
 * still gruen.
 *
 * Das Verfahren ist bewusst konservativ und statisch (E5):
 *
 *   1. „laedt": die Import-Kette, verfolgt durch `test/**` hindurch — eine Testdatei
 *      laedt ihre Quellen oft ueber einen Helfer unter `test/helpers/`. Ein
 *      Graph, der an der Helferdatei endet, saehe diese Kopplung nicht (E8).
 *   2. „nennt": jede Erwaehnung eines Quellpfads als Zeichenkette im Dateitext, die
 *      nicht schon geladen wird. Die Kit-Werkzeuge starten einander als Kindprozess;
 *      ein reiner Import-Graph saehe die wichtigste Kopplung des Repos nicht.
 *
 * Beides zaehlt als Kopplung (A2); getrennt geliefert wird es, weil Vorschlag und Abgleich
 * der Pruefbereiche verschieden fragen: Eine Luecke ist eine geladene Datei, ein
 * Geruest-Kandidat eine, die viele Tests nur nennen. Wer die Kopplung insgesamt braucht,
 * nimmt `kopplungVon`.
 *
 * Eine Erwaehnung faelschlich als Kopplung zu zaehlen irrt in die sichere
 * Richtung: Die Auswahl darf nur zu mehr Pruefung irren, nie zu weniger. Fuer die
 * Deckungsfrage ist das richtig, fuer die Auswahl wurde es teuer — ein Wurzelpfad
 * wie `README.md`, den fast jeder Test in seinem Wegwerfprojekt anlegt, zwang die
 * `areas` der Nacht-Gruppe auf `skills-doku` (Issue #937).
 *
 * Deshalb nimmt die Erhebung seit Issue #943 eine Liste von Geruest-Mustern
 * entgegen (`nurGeruest`). Sie wird uebergeben und nicht hier verdrahtet: Welche
 * Dateien ein Projekt als Geruest anlegt, weiss der Aufrufer, und das Kit laeuft
 * auch in fremden Projekten. Ohne Liste bleibt es beim konservativen Verhalten von
 * vorher — wer nichts uebergibt, entscheidet nichts.
 *
 * Die Kette laeuft ausdruecklich NICHT von Quelle zu Quelle weiter. Diese
 * Richtung traegt der Plan ueber die `areas`-Liste je Pruefkommando: Laedt
 * `night.mjs` den Board-Adapter, fuehrt das Nacht-Kommando den Bereich `board`.
 * Beide Wege zugleich beschrieben dieselbe Regel zweimal.
 *
 * Fuer die Teile von Nacht-Runner und Board-Werkzeug heisst das (Issue #1208, Plan
 * #1199, E18): Jede Datei unter `kit/night/` und `kit/board/` ist eine eigene Quelle.
 * Ein Test, der einen Teil laedt, koppelt an diesen Teil; ein Test, der den Einstieg
 * `kit/night.mjs` oder `kit/board.mjs` laedt, koppelt an den Einstieg und damit an
 * dessen Bereich — die Teile dahinter erreicht die Auswahl ueber die abhaengigen
 * Bereiche aus `kit/checks.mjs`, nicht diese Tabelle.
 *
 * Nutzung:
 *   node .claude/kit/checks/verflechtung.mjs   Tabelle auf der Standardausgabe
 *   import { verflechtungErheben }             dieselbe Tabelle als Map
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { globZuRegex, vergleicheText } from "../checks.mjs";
import { TEXTE } from "../texte/checks-verflechtung.mjs";

// Die Texttabelle liegt im Teil texte/ (Issue #1524); exportiert bleibt sie unter ihrem Namen.
export { TEXTE };

// Der Texthelfer aus dem Board-Teil namen (Plan #1420 E13), abgefangen: Fehlt
// board/namen.mjs neben dem Kit, bleiben die Texte deutsch.
const namen = await import(new URL("../board/namen.mjs", import.meta.url).href).catch(() => null);

/** Der Text zu `schluessel` aus `TEXTE` in der Sprache des Prozesses; ohne Register deutsch. */
function t(schluessel, werte = {}) {
  if (namen) return namen.text(TEXTE, schluessel, werte);
  return TEXTE.de[schluessel].replaceAll(/\{([A-Za-z_]\w*)\}/g, (_, name) => String(werte[name]));
}

/** Ein Pfad in der Schreibweise der Config: Posix-Trenner, repo-relativ. */
function posix(pfad) {
  return pfad.replaceAll("\\", "/");
}

/** Eine Liste von Pfaden aus `git ls-files`, in der Schreibweise der Config. */
function lsFiles(repoRoot, args) {
  const res = spawnSync("git", ["ls-files", "-z", ...args], { cwd: repoRoot, encoding: "utf-8" });
  if (res.status !== 0) {
    throw new Error(t("lsFilesFehler", { grund: (res.stderr || "").trim() }));
  }
  return res.stdout.split("\0").filter((p) => p.length > 0).map(posix);
}

/**
 * Die Dateien des Arbeitsstands: versioniert und uncommittet neu angelegt.
 *
 * Der Prueflauf eines Arbeitspakets steht VOR dem Commit (Issue #957). Nur
 * `git ls-files` zu lesen liess jede in diesem Paket neu angelegte Testdatei
 * unsichtbar bleiben — sichtbar wurde sie erst im Lauf der naechsten Karte, und
 * der Fund gehoerte dann der falschen. Die uncommitteten Neuanlagen kommen
 * deshalb dazu, und zwar ohne die ignorierten (`--exclude-standard`): sonst
 * zaehlten `node_modules/` und der lokale Zustand unter `.claude/` als Kopplung.
 *
 * Eine insgesamt leere Antwort ist ein Fehler und kein leerer Fall: Sie entstuende
 * bei einem Aufruf ausserhalb des Repos — und die Erhebung meldete dann eine
 * Verflechtung von null, die wie „keine Kopplung" aussieht. Eine leere zweite
 * Liste allein ist dagegen der Normalfall: ein sauberer Arbeitsbaum.
 */
function imArbeitsstand(repoRoot) {
  const dateien = [...new Set([
    ...lsFiles(repoRoot, []),
    ...lsFiles(repoRoot, ["--others", "--exclude-standard"]),
  ])].sort(vergleicheText);
  if (dateien.length === 0) throw new Error(t("lsFilesLeer", { pfad: repoRoot }));
  return dateien;
}

/**
 * Die relativen Import-Ziele einer JavaScript-Datei — `from "…"`, `import("…")`,
 * `export … from "…"` und `require("…")`.
 */
export function importZiele(text) {
  const ziele = [];
  for (const treffer of text.matchAll(/(?:from|import|require)[\s(]*["']([^"']+)["']/g)) {
    const ziel = treffer[1];
    if (ziel.startsWith("./") || ziel.startsWith("../")) ziele.push(ziel);
  }
  return ziele;
}

/**
 * Die Lesarten: je Sprache die Endungen ihrer Dateien und wie aus dem Text die relativen
 * Import-Ziele werden (Plan #1713 P13). Eine Tabelle und nicht je Sprache eine gleich
 * gebaute Funktion, damit keine Kopie fuer die Duplikatsmessung entsteht. Eine Datei ohne
 * Lesart traegt keine Importe; ihre Nennungen zaehlen trotzdem.
 */
const LESARTEN = Object.freeze([
  Object.freeze({ sprache: "javascript", endungen: Object.freeze([".js", ".mjs", ".cjs", ".jsx"]), ziele: importZiele }),
]);

/** Die Lesart einer Datei nach ihrer Endung, oder `null`. */
function lesartVon(datei) {
  return LESARTEN.find((lesart) => lesart.endungen.some((endung) => datei.endsWith(endung))) ?? null;
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
  const lesart = lesartVon(datei);
  if (!lesart) return { quellen, weiter };
  for (const ziel of lesart.ziele(text)) {
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
 * Die Quelldateien, die eine Testdatei laedt, und die, die sie nur nennt.
 *
 * `gelesen` verhindert die Endlosschleife bei zwei Helfern, die sich
 * gegenseitig laden; ohne sie haengt die Erhebung, statt zu irren.
 *
 * @returns {{ laedt: string[], nennt: string[] }}
 */
function quellenZu(testdatei, ctx) {
  const laedt = new Set();
  const genannt = new Set();
  const offen = [testdatei];
  const gelesen = new Set([testdatei]);

  while (offen.length > 0) {
    const datei = offen.pop();
    const text = ctx.textVon(datei);
    if (text === null) continue;

    const { quellen: blaetter, weiter } = importeAuswerten(datei, text, ctx);
    for (const pfad of blaetter) laedt.add(pfad);
    for (const pfad of weiter) {
      if (gelesen.has(pfad)) continue;
      gelesen.add(pfad);
      offen.push(pfad);
    }
    for (const pfad of erwaehnte(text, ctx.quellmenge)) genannt.add(pfad);
  }

  // Codepoint-Ordnung, nicht die der Locale: Die Tabelle geht in die
  // bereichsbezogene Auswahl der Pruefungen ein und muss auf jeder Maschine
  // dieselbe sein (Issue #956, S2871).
  return {
    laedt: [...laedt].sort(vergleicheText),
    nennt: [...genannt].filter((pfad) => !laedt.has(pfad)).sort(vergleicheText),
  };
}

/**
 * Die Verflechtungstabelle: je Testdatei des Arbeitsstands die sortierten Listen der
 * Quelldateien, die sie laedt und die sie nur nennt — versioniert wie uncommittet neu
 * angelegt (#957).
 *
 * `nurGeruest` sind Pfadmuster in der Schreibweise von `checkAreas` — dieselbe
 * Aufloesung aus `kit/checks.mjs`, nicht eine zweite hier. Ein getroffener
 * Quellpfad faellt vor der Erhebung aus der Quellmenge und erscheint damit in
 * KEINER Zeile und in keiner der beiden Listen: Das Muster gilt gegen den Quellpfad,
 * nicht gegen die Testdatei. Ausgeschlossen wird, was als Geruest erwaehnt wird, nicht
 * wer es erwaehnt — eine Liste je Testdatei waere eine zweite Verflechtungstabelle
 * neben der ersten.
 *
 * `testdateien` beschraenkt die Messung auf diese Tests (repo-relativ); ohne sie gilt jede
 * Datei `test/**\/*.test.mjs` des Arbeitsstands.
 *
 * @param {{ repoRoot?: string, nurGeruest?: string[], testdateien?: string[] }} [optionen]
 * @returns {Map<string, { laedt: string[], nennt: string[] }>} Testpfad → Quellpfade, repo-relativ
 */
export function verflechtungErheben({ repoRoot = process.cwd(), nurGeruest = [], testdateien } = {}) {
  const alle = imArbeitsstand(repoRoot);
  const tests = (testdateien ?? alle.filter((p) => /^test\/.*\.test\.mjs$/.test(p))).map(posix).sort(vergleicheText);
  const geruest = nurGeruest.map((muster) => globZuRegex(muster));
  const quellmenge = new Set(alle.filter(
    (p) => !p.startsWith("test/") && !geruest.some((regex) => regex.test(p)),
  ));

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
  for (const testdatei of tests) {
    tabelle.set(testdatei, quellenZu(testdatei, { repoRoot, quellmenge, textVon }));
  }
  return tabelle;
}

/**
 * Die Kopplung insgesamt: je Test die Vereinigung aus „laedt" und „nennt", sortiert — die
 * eine Liste, die die Erhebung vor der Trennung lieferte (Plan #1713 A2).
 *
 * @param {Map<string, { laedt: string[], nennt: string[] }>} tabelle
 * @returns {Map<string, string[]>}
 */
export function kopplungVon(tabelle) {
  const kopplung = new Map();
  for (const [testdatei, { laedt, nennt }] of tabelle) {
    kopplung.set(testdatei, [...laedt, ...nennt].sort(vergleicheText));
  }
  return kopplung;
}

/** Die Tabelle als Markdown — so, wie sie als Kommentar ans Arbeitspaket geht. */
export function tabelleAlsMarkdown(tabelle) {
  const liste = (pfade) => pfade.map((q) => "`" + q + "`").join(", ") || "—";
  const zeilen = [t("kopf"), "|---|---|---|---|"];
  for (const [testdatei, { laedt, nennt }] of tabelle) {
    zeilen.push(`| \`${testdatei}\` | ${liste(laedt)} | ${liste(nennt)} | ${laedt.length + nennt.length} |`);
  }
  return zeilen.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tabelle = verflechtungErheben();
  process.stdout.write(`${tabelleAlsMarkdown(tabelle)}\n`);
}
