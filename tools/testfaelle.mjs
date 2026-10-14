#!/usr/bin/env node
/**
 * testfaelle.mjs — haelt die Testfaelle einer Pruefgruppe fest und vergleicht zwei Staende
 * (Issue #1690, Plan #1685, E5; Kriterium 2 des Fachplans #1603: es wird nicht weniger geprueft).
 *
 *   node tools/testfaelle.mjs list <glob…>
 *   node tools/testfaelle.mjs compare <vorher.json> <nachher.json>
 *
 * LIST: Jede Datei, die ein Muster trifft, faehrt einzeln mit `node --test
 * --test-reporter=tap`. TAP nennt bei mehreren Dateien in einem Lauf nicht, aus welcher ein
 * Test stammt; einzeln ist jede Zuordnung eindeutig, und `# duration_ms` am Ende ist die
 * Laufzeit der Datei. Die Liste steht als JSON unter `<tmpdir>/testfaelle-<stempel>.json`:
 * je Test Datei, voller Name (`Suite > Test`) und Ergebnis (`ok`, `skip`, offen, `fehler`),
 * je Datei Laufzeit und die Zahl der `assert.`-Aufrufstellen, statisch aus dem Quelltext
 * gezaehlt — ein grober Zeiger, denn TAP kennt keine Zusicherungen; die Pruefbedingungen
 * selbst liest das Code-Review. Exit 1, wenn ein Muster nichts trifft, eine Datei keinen Test
 * nennt oder ein Test rot ist: Eine solche Liste taugt nicht als Vergleichsstand. Sie wird
 * trotzdem geschrieben.
 *
 * COMPARE: Nennt jede Abweichung — ein fehlender oder neuer Test, ein neu uebersprungener,
 * neu offener oder roter, eine Datei mit weniger `assert.`-Aufrufstellen — und endet bei
 * einer mit Exit 1. Die Laufzeit ist keine Abweichung; sie zu senken ist der Zweck.
 *
 * Starter, Dateisuche, Uhr und Ablage sind injizierbar; die Tests in
 * `test/tools-testfaelle.test.mjs` laufen damit im selben Prozess.
 */

import { spawn } from "node:child_process";
import { globSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { vergleicheText } from "../kit/night/grundlagen.mjs";

export const HILFE = `testfaelle.mjs — Testfaelle einer Pruefgruppe festhalten und vergleichen (Issue #1690)

Aufruf:
  node tools/testfaelle.mjs list <glob…>
      Faehrt jede getroffene Datei mit --test-reporter=tap und schreibt die Liste nach
      <tmpdir>/testfaelle-<stempel>.json; nennt den Pfad.
  node tools/testfaelle.mjs compare <vorher.json> <nachher.json>
      Nennt jede Abweichung; Exit 1 bei einer, Exit 0 bei gleichen Listen.`;

const ZEILE_ERGEBNIS = /^(\s*)(not ok|ok) \d+ - (.*)$/;
const ZEILE_SUBTEST = /^(\s*)# Subtest: (.*)$/;
const DIREKTIVE = /(?<!\\) # (SKIP|TODO)\b.*$/i;

function entmaskieren(name) {
  return name.replaceAll(/\\([\\#])/g, "$1");
}

/** Eine Zeile `ok`/`not ok`; kuerzt `offen` auf die Ebene der Zeile. */
function ergebnisLesen([, einrueckung, status, roh], offen) {
  const ebene = Math.floor(einrueckung.length / 4);
  const direktive = DIREKTIVE.exec(roh);
  const name = entmaskieren(direktive ? roh.slice(0, direktive.index) : roh);
  let art = status === "ok" ? "ok" : "fehler";
  if (direktive) art = direktive[1].toLowerCase();
  const eintrag = { name: [...offen.slice(0, ebene), name].join(" > "), ergebnis: art };
  offen.length = ebene;
  return eintrag;
}

/**
 * Liest die TAP-Ausgabe eines Laufs ueber genau eine Datei. Suiten zaehlen nicht als Test;
 * ein Test unter einer Suite traegt ihren Namen voran (`Suite > Test`).
 */
export function tapLesen(text) {
  const offen = [];
  const tests = [];
  let laufzeitMs = null;
  let letzter = null;
  for (const zeile of text.split(/\r?\n/)) {
    const subtest = ZEILE_SUBTEST.exec(zeile);
    if (subtest) {
      const ebene = Math.floor(subtest[1].length / 4);
      offen.length = ebene;
      offen[ebene] = entmaskieren(subtest[2]);
      continue;
    }
    const ergebnis = ZEILE_ERGEBNIS.exec(zeile);
    if (ergebnis) {
      letzter = ergebnisLesen(ergebnis, offen);
      tests.push(letzter);
      continue;
    }
    if (letzter && /^\s*type: 'suite'\s*$/.test(zeile)) {
      tests.splice(tests.indexOf(letzter), 1);
      letzter = null;
      continue;
    }
    const dauer = /^# duration_ms ([\d.]+)\s*$/.exec(zeile);
    if (dauer) laufzeitMs = Number(dauer[1]);
  }
  return { tests, laufzeitMs };
}

/** Zahl der Aufrufstellen `assert.<name>(` im Quelltext. */
export function assertStellen(quelltext) {
  return quelltext.match(/\bassert\.\w+\s*\(/g)?.length ?? 0;
}

// Nach Code-Punkten, nicht nach Locale: Die Reihenfolge haengt so an keinem Rechner.
function nachDateiUndName(a, b) {
  return vergleicheText(a.datei, b.datei) || vergleicheText(a.name, b.name) || vergleicheText(a.ergebnis, b.ergebnis);
}

function stempelVon(ms) {
  return `${new Date(ms).toISOString().replaceAll(/\D/g, "").slice(0, 14)}-${process.pid}`;
}

/**
 * Faehrt `list`. `abh`: `{ wurzel, ablage, jetzt, dateienZu(muster), starter({ datei, cmd, cwd,
 * env }), ausgabe }`. Liefert `{ exitCode, pfad? }`.
 */
export async function liste(muster, abh) {
  const dateien = [...new Set(abh.dateienZu(muster))].sort(vergleicheText);
  if (dateien.length === 0) {
    abh.ausgabe(`testfaelle: kein Muster trifft eine Datei (${muster.join(" ")})`);
    return { exitCode: 1 };
  }
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const probleme = [];
  const tests = [];
  const proDatei = [];
  for (const datei of dateien) {
    const { ausgabe } = await abh.starter({
      datei,
      cmd: `node --test --test-reporter=tap ${JSON.stringify(datei)}`,
      cwd: abh.wurzel,
      env,
    });
    const gelesen = tapLesen(ausgabe ?? "");
    if (gelesen.tests.length === 0) probleme.push(`${datei}: nennt keinen Test`);
    for (const t of gelesen.tests) {
      if (t.ergebnis === "fehler") probleme.push(`${datei}: rot — ${t.name}`);
      tests.push({ datei, ...t });
    }
    const quelltext = readFileSync(resolve(abh.wurzel, datei), "utf-8");
    proDatei.push({ datei, laufzeitMs: gelesen.laufzeitMs, assertStellen: assertStellen(quelltext) });
  }
  tests.sort(nachDateiUndName);
  const daten = {
    muster,
    dateien: proDatei,
    tests,
    skip: tests.filter((t) => t.ergebnis === "skip").length,
    todo: tests.filter((t) => t.ergebnis === "todo").length,
  };
  const pfad = join(abh.ablage, `testfaelle-${stempelVon(abh.jetzt())}.json`);
  writeFileSync(pfad, `${JSON.stringify(daten, null, 2)}\n`);
  for (const p of probleme) abh.ausgabe(`testfaelle: ${p}`);
  abh.ausgabe(`testfaelle: ${tests.length} Tests in ${dateien.length} Dateien (skip ${daten.skip}, todo ${daten.todo}) — Liste ${pfad}`);
  return { exitCode: probleme.length > 0 ? 1 : 0, pfad };
}

function schluessel(t) {
  return `${t.datei}\u0000${t.name}`;
}

function gruppiert(tests) {
  const karte = new Map();
  for (const t of tests) {
    const k = schluessel(t);
    if (!karte.has(k)) karte.set(k, []);
    karte.get(k).push(t.ergebnis);
  }
  return karte;
}

const NEU_SCHLECHTER = {
  skip: "ist neu übersprungen",
  todo: "ist neu als offen markiert",
  fehler: "ist rot",
};

/** Die Abweichungen eines Testnamens einer Datei, ueber die Ergebnisse vorher und nachher. */
function testAbweichungen(k, vorher, nachher) {
  const [datei, name] = k.split("\u0000");
  const a = [...vorher];
  const n = [];
  // Gleiche Ergebnisse heben sich auf; was bleibt, ist fehlend, neu oder verschlechtert.
  for (const e of nachher) {
    const i = a.indexOf(e);
    if (i >= 0) a.splice(i, 1);
    else n.push(e);
  }
  const zeilen = [];
  while (a.length > 0 && n.length > 0) {
    const war = a.shift();
    const ist = n.shift();
    const text = NEU_SCHLECHTER[ist] ?? `ist jetzt ${ist}`;
    zeilen.push(`${datei}: Test „${name}“ ${text} (vorher ${war})`);
  }
  for (const war of a) zeilen.push(`${datei}: Test „${name}“ fehlt (vorher ${war})`);
  for (const ist of n) zeilen.push(`${datei}: Test „${name}“ ist neu (${ist})`);
  return zeilen;
}

/** Alle Abweichungen von `vorher` zu `nachher`, je eine Zeile; leer bei gleichen Listen. */
export function vergleich(vorher, nachher) {
  const abweichungen = [];
  const alt = gruppiert(vorher.tests);
  const neu = gruppiert(nachher.tests);
  for (const k of [...new Set([...alt.keys(), ...neu.keys()])].sort(vergleicheText)) {
    abweichungen.push(...testAbweichungen(k, alt.get(k) ?? [], neu.get(k) ?? []));
  }
  const stellenNachher = new Map(nachher.dateien.map((d) => [d.datei, d.assertStellen]));
  for (const d of vorher.dateien) {
    if (!stellenNachher.has(d.datei)) {
      abweichungen.push(`${d.datei}: Datei fehlt`);
    } else if (stellenNachher.get(d.datei) < d.assertStellen) {
      abweichungen.push(`${d.datei}: weniger assert.-Aufrufstellen (vorher ${d.assertStellen}, nachher ${stellenNachher.get(d.datei)})`);
    }
  }
  return abweichungen;
}

/** Faehrt `compare` ueber zwei Listen-Dateien; liefert den Exitcode. */
export function vergleichen(vorherPfad, nachherPfad, { ausgabe }) {
  const vorher = JSON.parse(readFileSync(vorherPfad, "utf-8"));
  const nachher = JSON.parse(readFileSync(nachherPfad, "utf-8"));
  const abweichungen = vergleich(vorher, nachher);
  for (const z of abweichungen) ausgabe(z);
  ausgabe(abweichungen.length === 0
    ? `testfaelle: gleich — ${nachher.tests.length} Tests, keine Abweichung`
    : `testfaelle: ${abweichungen.length} Abweichung(en)`);
  return abweichungen.length === 0 ? 0 : 1;
}

// --- Echte Abhaengigkeiten ----------------------------------------------------

/** Ein Kommando ueber die Shell, ohne Zeitgrenze; nur stdout, dort steht das TAP. */
function starter({ cwd, cmd, env }) {
  return new Promise((aufloesen) => {
    const kind = spawn(cmd, { cwd, env, shell: true, stdio: ["ignore", "pipe", "inherit"] });
    const teile = [];
    kind.stdout.on("data", (d) => teile.push(d));
    kind.on("error", (e) => teile.push(Buffer.from(String(e))));
    kind.on("close", (code) => aufloesen({ code, ausgabe: Buffer.concat(teile).toString("utf-8") }));
  });
}

async function main(argv) {
  const [befehl, ...rest] = argv;
  if (befehl === "list" && rest.length > 0) {
    const wurzel = process.cwd();
    const { exitCode } = await liste(rest, {
      wurzel,
      ablage: tmpdir(),
      jetzt: Date.now,
      dateienZu: (muster) => muster.flatMap((m) => globSync(m, { cwd: wurzel })),
      starter,
      ausgabe: (z) => console.log(z),
    });
    return exitCode;
  }
  if (befehl === "compare" && rest.length === 2) {
    return vergleichen(rest[0], rest[1], { ausgabe: (z) => console.log(z) });
  }
  if (befehl === "--help" || befehl === "-h") {
    console.log(HILFE);
    return 0;
  }
  console.error(`testfaelle: falscher Aufruf\n\n${HILFE}`);
  return 2;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
