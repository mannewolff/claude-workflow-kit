#!/usr/bin/env node
/**
 * config-referenz.mjs — erzeugt den Abschnitt „Alle Einstellungen" in
 * docs/dokumentation.md aus templates/workflow.config.schema.json (Issue #675,
 * Plan #674 E3).
 *
 * Die Einstellungs-Oberfläche erklärt jede Einstellung wortgleich mit der
 * Dokumentation. Wortgleich bleibt nur, was aus einer Quelle erzeugt wird: Das Schema
 * ist die Quelle, dieser Abschnitt ist ihr Abbild. Geschrieben wird ausschließlich
 * zwischen den beiden Markern; der übrige Text der Doku bleibt unberührt.
 *
 * Nutzung:
 *   node tools/config-referenz.mjs           Abschnitt neu schreiben
 *   node tools/config-referenz.mjs --check   nur vergleichen, Exit 1 bei Abweichung
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// KIT_ROOT ist ein Test-Hook wie in tools/copy-downloads-for-docs.mjs (Issue #186).
const root = process.env.KIT_ROOT
  ? resolve(process.env.KIT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = join(root, "templates", "workflow.config.schema.json");
const DOKU = join(root, "docs", "dokumentation.md");
const START = "<!-- einstellungen:start -->";
const ENDE = "<!-- einstellungen:ende -->";

function fehler(meldung) {
  process.stderr.write(`Fehler: ${meldung}\n`);
  process.exit(1);
}

/**
 * Eine Beschreibung mit entschärften Platzhaltern (Issue #792).
 *
 * VitePress übersetzt die Doku in eine Vue-Komponente, und der Vue-Compiler liest darin
 * jedes `<Wort>` als Element: Ohne End-Tag bricht der Build mit „Element is missing end
 * tag" ab — genau daran stand docs.mwolff.org vier Tage still. Entschärft wird hier und
 * nicht im Schematext, weil sonst die nächste Beschreibung mit Platzhalter denselben
 * Build bricht.
 *
 * Nur die Form `<Wort>` wird gefasst, und nur außerhalb schon gesetzter Backticks: Ein
 * `` `<ID>` `` im Schema ist bereits richtig, ein zweiter Backtick machte daraus Unsinn.
 */
function entschaerft(text) {
  return String(text).replaceAll(
    /(`[^`]*`)|<([A-Za-z][A-Za-z0-9-]*)>/g,
    (treffer, inCode, name) => (inCode !== undefined ? inCode : `\`<${name}>\``)
  );
}

/** Gültige Werte eines Feldes in Klammern, leer ohne enum. */
function werte(knoten) {
  const liste = knoten?.enum ?? knoten?.items?.enum;
  if (!Array.isArray(liste)) return "";
  const genannt = liste.map((w) => "`" + w + "`").join(", ");
  return ` (gültig: ${genannt})`;
}

/** Die verschachtelten Felder unter einem Wurzelfeld als Listenzeilen. */
function unterfelder(knoten, pfad, zeilen = []) {
  if (!knoten || typeof knoten !== "object") return zeilen;
  if (knoten.items && typeof knoten.items === "object") {
    if (typeof knoten.items.description === "string") zeilen.push(`- \`${pfad}[]\` — ${entschaerft(knoten.items.description)}`);
    unterfelder(knoten.items, `${pfad}[]`, zeilen);
  }
  for (const variante of knoten.oneOf ?? []) unterfelder(variante, pfad, zeilen);
  for (const [name, kind] of Object.entries(knoten.properties ?? {})) {
    const p = `${pfad}.${name}`;
    if (typeof kind.description === "string") zeilen.push(`- \`${p}\` — ${entschaerft(kind.description)}${werte(kind)}`);
    unterfelder(kind, p, zeilen);
  }
  const zusatz = knoten.additionalProperties;
  if (zusatz && typeof zusatz === "object") unterfelder(zusatz, `${pfad}.*`, zeilen);
  return zeilen;
}

/** Der Abschnitt zwischen den Markern, ohne die Marker selbst. */
function referenz(schema) {
  const teile = ["", "_Dieser Abschnitt entsteht aus `templates/workflow.config.schema.json` mit `node tools/config-referenz.mjs`; Änderungen gehören ins Schema, nicht hierher._", ""];
  for (const [feld, knoten] of Object.entries(schema.properties ?? {})) {
    if (feld === "version") continue;
    teile.push(`### \`${feld}\``, "", `${entschaerft(knoten.description ?? "")}${werte(knoten)}`, "");
    const zeilen = unterfelder(knoten, feld);
    if (zeilen.length) teile.push(...zeilen, "");
  }
  return teile.join("\n");
}

const nurPruefen = process.argv.includes("--check");
const schema = JSON.parse(readFileSync(SCHEMA, "utf-8"));
const doku = readFileSync(DOKU, "utf-8");
const a = doku.indexOf(START);
const b = doku.indexOf(ENDE);
if (a < 0) fehler(`Marker ${START} fehlt in docs/dokumentation.md`);
if (b < a) fehler(`Marker ${ENDE} fehlt in docs/dokumentation.md oder steht vor ${START}`);
const neu = doku.slice(0, a + START.length) + referenz(schema) + doku.slice(b);

if (neu === doku) {
  process.stdout.write("Abschnitt „Alle Einstellungen\" ist aktuell.\n");
} else if (nurPruefen) {
  fehler("Abschnitt „Alle Einstellungen\" weicht vom Schema ab — node tools/config-referenz.mjs ausführen.");
} else {
  writeFileSync(DOKU, neu, "utf-8");
  process.stdout.write("Abschnitt „Alle Einstellungen\" geschrieben.\n");
}
