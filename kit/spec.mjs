#!/usr/bin/env node
/**
 * claude-workflow-kit Spec-Werkzeug (Issue #440, Plan #437)
 *
 * Liest das beschriebene Verhalten eines Projekts — eine Datei je Bereich unter
 * specs/ — und beantwortet zwei Fragen: `index` schreibt die Uebersicht ueber
 * alle Bereiche, `show` gibt die Aussage zu einer einzelnen ID aus.
 *
 * Warum ein eigenes Werkzeug und keine Achse in board.mjs (Plan #437, A2):
 * board.mjs spricht mit Issue-Trackern, hier geht es um Dateien im Repo. Die
 * beiden teilen weder Konfiguration noch Zugang, und eine gemeinsame Datei
 * haette nur den gemeinsamen Namen.
 *
 * Die Dateiform steht in Plan #437, A15 — geschrieben wird sie erst in
 * Ausbaustufe 4, hier wird sie nur gelesen:
 *
 *   Eine Datei je Bereich: specs/<bereich>.md
 *   Der Bereichsname ist der Dateiname ohne Endung.
 *   specs/INDEX.md und specs/vorhaben/** sind keine Bereiche.
 *
 *   Gueltige Aussagen — Zeilen oberhalb von "## Entfallen":
 *   - <ID> — <Aussage>
 *
 *   Gestrichene Aussagen — Zeilen unterhalb von "## Entfallen":
 *   - <ID> — <Aussage> (entfallen <JJJJ-MM-TT>, Paket #<M>)
 *
 *   Alles andere (Ueberschriften, Prosa) wird ignoriert.
 *
 * Eine ID hat die Form <bereich>-<N> (A16).
 *
 * specs/ wird relativ zum Arbeitsverzeichnis gesucht, wie bei checks.mjs und
 * board.mjs — kein --root-Parameter. Fehlt das Verzeichnis, ist das der
 * Normalzustand eines Projekts ohne Specs und kein Fehler.
 *
 * Keine Laufzeitabhaengigkeit ausserhalb der Node-Standardbibliothek, kein Netz,
 * kein Zugriff auf den Adapter: Die Datei ist eigenstaendig portabel und laesst
 * sich einzeln in ein Projekt kopieren, wie board.mjs, night.mjs und checks.mjs.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "1.44.0";

const SPECS_DIR = "specs";
const INDEX_DATEI = "INDEX.md";

const HELP = `spec.mjs (claude-workflow-kit v${KIT_VERSION}) — beschriebenes Verhalten lesen

  node spec.mjs index
  node spec.mjs show <id>

index   Schreibt ${SPECS_DIR}/${INDEX_DATEI} neu: eine Zeile je Bereich mit der Zahl der
        gueltigen und der entfallenen Aussagen. Fehlt ${SPECS_DIR}/, sagt das Kommando
        das und endet gruen.
show    Gibt die Aussage zu einer ID aus, mit Bereich und Status. Bei einer
        entfallenen Aussage auch Datum und Paketnummer.

  --version       Kit-Stand dieser Datei.
  --help, -h      Diese Uebersicht.

Gelesen wird ${SPECS_DIR}/ im Arbeitsverzeichnis: eine Datei je Bereich, der
Bereichsname ist der Dateiname ohne Endung. ${SPECS_DIR}/${INDEX_DATEI} und alles unter
${SPECS_DIR}/vorhaben/ sind keine Bereiche. Aussagen stehen als '- <ID> — <Aussage>';
was unter der Ueberschrift '## Entfallen' steht, gilt als gestrichen.
`;

class SpecError extends Error {}

function fail(nachricht) {
  throw new SpecError(nachricht);
}

// --- Lesen ------------------------------------------------------------------

function specsPfad(root = process.cwd()) {
  return join(root, SPECS_DIR);
}

/**
 * Die Bereiche in alphabetischer Reihenfolge.
 *
 * Sortiert wird mit dem Standardvergleich, nicht mit localeCompare: Dessen
 * Reihenfolge haengt an der Locale der Maschine, und `index` muss auf jeder
 * Maschine dieselbe Datei erzeugen.
 *
 * Unterverzeichnisse fallen durch die isFile()-Pruefung heraus — damit ist
 * specs/vorhaben/** ohne Sonderfall draussen, und ein spaeter dazukommendes
 * Unterverzeichnis ebenso.
 */
function bereiche(root = process.cwd()) {
  return readdirSync(specsPfad(root), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== INDEX_DATEI)
    .map((e) => e.name.slice(0, -3))
    .sort();
}

// '- <ID> — <Aussage>'. Die ID muss der Form <bereich>-<N> genuegen (A16): ohne
// diese Bedingung wuerde jede Prosa-Aufzaehlung mit Gedankenstrich als Aussage
// gelesen, und der Index zaehlte Saetze statt Zusagen.
const AUSSAGE_RE = /^-\s+(\S+-\d+)\s+—\s+(.+?)\s*$/;

// Das Suffix einer gestrichenen Aussage. Es steht am Zeilenende und wird von der
// Aussage abgetrennt, damit `show` Datum und Paket getrennt nennen kann.
const ENTFALLEN_RE = /^(.*?)\s*\(entfallen\s+(\d{4}-\d{2}-\d{2}),\s*Paket\s+#(\d+)\)$/;

const ENTFALLEN_UEBERSCHRIFT_RE = /^##\s+Entfallen\s*$/;

/**
 * Zerlegt eine Bereichsdatei in ihre Aussagen.
 *
 * Ueber den Status entscheidet allein die Position zur Ueberschrift '##
 * Entfallen', nie das Suffix: Eine Zeile ohne Suffix unterhalb der Ueberschrift
 * ist trotzdem gestrichen, sonst zaehlte ein vergessener Klammerzusatz sie
 * wieder als gueltig — der Fehler ginge in die unsichere Richtung.
 *
 * Die Zeilennummer wird mitgefuehrt, weil sie in der Meldung zu einer doppelt
 * vergebenen ID die einzige Angabe ist, die zwei Fundstellen in derselben Datei
 * auseinanderhaelt.
 */
function aussagenLesen(bereich, text) {
  const gefunden = [];
  let entfallenAbschnitt = false;

  for (const [i, zeile] of text.split("\n").entries()) {
    if (ENTFALLEN_UEBERSCHRIFT_RE.test(zeile.trim())) {
      entfallenAbschnitt = true;
      continue;
    }
    const treffer = AUSSAGE_RE.exec(zeile);
    if (!treffer) continue;

    const [, id, rest] = treffer;
    const eintrag = { id, bereich, zeile: i + 1, entfallen: entfallenAbschnitt, aussage: rest };
    const zusatz = entfallenAbschnitt ? ENTFALLEN_RE.exec(rest) : null;
    if (zusatz) {
      eintrag.aussage = zusatz[1];
      eintrag.datum = zusatz[2];
      eintrag.paket = zusatz[3];
    }
    gefunden.push(eintrag);
  }
  return gefunden;
}

function bereichLesen(bereich, root = process.cwd()) {
  return aussagenLesen(bereich, readFileSync(join(specsPfad(root), `${bereich}.md`), "utf-8"));
}

/** Die Datei eines Bereichs, wie sie in Meldungen und im Index erscheint. */
function bereichsDatei(bereich) {
  return `${SPECS_DIR}/${bereich}.md`;
}

// --- index ------------------------------------------------------------------

const INDEX_KOPF = ["# Spec-Index", "", "| Bereich | Datei | Gueltig | Entfallen |", "| --- | --- | --- | --- |"];

/**
 * Schreibt den Index vollstaendig neu — kein Merge.
 *
 * Ein zusammengefuehrter Index behielte die Zeile eines geloeschten Bereichs:
 * Der Index behauptete dann ein beschriebenes Verhalten, zu dem es keine Datei
 * mehr gibt. Lieber eine Zeile zu wenig als eine erfundene.
 */
function index() {
  const verzeichnis = specsPfad();
  if (!existsSync(verzeichnis)) {
    process.stdout.write(`Kein ${SPECS_DIR}/ unter ${process.cwd()} — nichts zu indizieren.\n`);
    return 0;
  }

  const zeilen = bereiche().map((bereich) => {
    const aussagen = bereichLesen(bereich);
    const entfallen = aussagen.filter((a) => a.entfallen).length;
    return `| ${bereich} | ${bereichsDatei(bereich)} | ${aussagen.length - entfallen} | ${entfallen} |`;
  });

  const pfad = join(verzeichnis, INDEX_DATEI);
  writeFileSync(pfad, [...INDEX_KOPF, ...zeilen, ""].join("\n"), "utf-8");
  process.stdout.write(`${SPECS_DIR}/${INDEX_DATEI} geschrieben: ${zeilen.length} ${zeilen.length === 1 ? "Bereich" : "Bereiche"}.\n`);
  return 0;
}

// --- show -------------------------------------------------------------------

function statusText(eintrag) {
  if (!eintrag.entfallen) return "gueltig";
  return eintrag.datum
    ? `entfallen (${eintrag.datum}, Paket #${eintrag.paket})`
    : "entfallen (ohne Datum und Paketnummer)";
}

function fundstelle(eintrag) {
  return `${bereichsDatei(eintrag.bereich)}:${eintrag.zeile}`;
}

/**
 * Gibt die Aussage zu einer ID aus.
 *
 * Jeder Fehlerpfad endet mit leerem stdout und Exit 1. Wer `show` in einem
 * Skript liest, darf eine Fehlermeldung nie fuer eine Aussage halten.
 *
 * Kommt die ID mehrfach vor, bricht das Kommando ab und nennt beide Fundstellen.
 * Welche der beiden gilt, entscheidet `check` (Ausbaustufe 2) — gaebe `show`
 * eine davon aus, verschwiege es genau den Widerspruch, den es gerade sieht.
 */
function show(id) {
  if (!id) fail("Keine ID angegeben. Aufruf: node spec.mjs show <id>");
  if (!existsSync(specsPfad())) {
    fail(`Kein ${SPECS_DIR}/ unter ${process.cwd()} — es ist kein Verhalten beschrieben.`);
  }

  const treffer = bereiche().flatMap((bereich) => bereichLesen(bereich).filter((a) => a.id === id));

  if (treffer.length === 0) fail(`ID '${id}' ist nicht vergeben.`);
  if (treffer.length > 1) {
    fail(`ID '${id}' ist mehrfach vergeben: ${treffer.map((t) => fundstelle(t)).join(", ")}. `
      + `Aufloesen ist Sache von 'spec.mjs check'.`);
  }

  const [eintrag] = treffer;
  process.stdout.write([
    `${eintrag.id} — ${eintrag.aussage}`,
    `Bereich: ${eintrag.bereich}`,
    `Datei:   ${fundstelle(eintrag)}`,
    `Status:  ${statusText(eintrag)}`,
    "",
  ].join("\n"));
  return 0;
}

// --- CLI --------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return 0;
  }

  // Vor jedem Dateizugriff: --version muss auch dort antworten, wo nichts liegt
  // ausser dieser Datei — genau dort fragt man danach.
  if (argv[0] === "--version") {
    process.stdout.write(`spec.mjs (claude-workflow-kit v${KIT_VERSION})\n`);
    return 0;
  }

  const [command, ...rest] = argv;
  if (command === "index") return index();
  if (command === "show") return show(rest[0]);

  // Keine Hilfe auf stdout wie bei board.mjs: `show` haelt stdout fuer seine
  // Aussagen frei, und ein Vertipper darf dort nichts hinterlassen.
  return fail(`Unbekannter Befehl: '${command}'. Erwartet: index oder show — 'node spec.mjs --help' zeigt die Uebersicht.`);
}

// Nur als CLI ausfuehren, nicht beim Import (z. B. durch die node:test-Suite, #135).
// realpathSync statt resolve: Node loest fuer import.meta.url Symlinks auf (macOS:
// /var -> /private/var), ein nur normalisierter argv[1] wuerde dann nie matchen (#146).
let runAsCli = false;
if (process.argv[1]) {
  try {
    runAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { /* argv[1] nicht aufloesbar -> kein CLI-Start */ }
}
if (runAsCli) {
  try {
    process.exitCode = main();
  } catch (err) {
    const prefix = err instanceof SpecError ? "Fehler" : "Unerwarteter Fehler";
    process.stderr.write(`${prefix}: ${err.message}\n`);
    process.exit(1);
  }
}
