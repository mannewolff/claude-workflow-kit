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
 * Zwei Sprachen (Issue #1356, Plan #1348 E8): Die deutsche Fassung ist wortgleich mit der
 * Oberfläche, die englische in docs/en/dokumentation.md eine geprüfte Übersetzung. Sie
 * steht in tools/config-referenz.en.json — je Einstellung der englische Text und der Hash
 * der deutschen Beschreibung — und nicht im Schema, das in jedes Projekt installiert wird.
 * Ändert sich eine deutsche Beschreibung, passt ihr Hash nicht mehr, und --check nennt die
 * Einstellung. Geschrieben und geprüft wird die englische Fassung erst, wenn
 * docs/en/dokumentation.md beide Marker trägt.
 *
 * Nutzung:
 *   node tools/config-referenz.mjs           Abschnitt neu schreiben
 *   node tools/config-referenz.mjs --check   nur vergleichen, Exit 1 bei Abweichung
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// KIT_ROOT ist ein Test-Hook wie in tools/copy-downloads-for-docs.mjs (Issue #186).
const root = process.env.KIT_ROOT
  ? resolve(process.env.KIT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = join(root, "templates", "workflow.config.schema.json");
const DOKU = join(root, "docs", "dokumentation.md");
const DOKU_EN = join(root, "docs", "en", "dokumentation.md");
const UEBERSETZUNG = join(root, "tools", "config-referenz.en.json");
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

/** Die Liste der gültigen Werte eines Feldes, `undefined` ohne enum. */
function werteListe(knoten) {
  const ausVarianten = (knoten?.oneOf ?? []).flatMap((v) => (Array.isArray(v?.enum) ? v.enum : []));
  const liste = knoten?.enum ?? knoten?.items?.enum ?? (ausVarianten.length ? ausVarianten : undefined);
  return Array.isArray(liste) ? liste : undefined;
}

/**
 * Jede Einstellung, die der Abschnitt ausgibt, in Ausgabereihenfolge: Pfad
 * (`root.feld.unterfeld`, `[]` für Listeneinträge, `*` für freie Schlüssel), deutsche
 * Beschreibung, gültige Werte, Wurzelfeld oder nicht. Ein Feld, das einen festen Wert oder
 * ein Objekt annimmt (`pushPruefung`: `lokal` oder `{ ort, zweig }`), trägt sein enum in
 * einer oneOf-Variante — die Objekt-Variante steht in den Unterfeldern.
 */
function eintraege(schema) {
  const liste = [];
  function unterfelder(knoten, pfad) {
    if (!knoten || typeof knoten !== "object") return;
    if (knoten.items && typeof knoten.items === "object") {
      if (typeof knoten.items.description === "string") liste.push({ pfad: `${pfad}[]`, text: knoten.items.description });
      unterfelder(knoten.items, `${pfad}[]`);
    }
    for (const variante of knoten.oneOf ?? []) unterfelder(variante, pfad);
    for (const [name, kind] of Object.entries(knoten.properties ?? {})) {
      const p = `${pfad}.${name}`;
      if (typeof kind.description === "string") liste.push({ pfad: p, text: kind.description, werte: werteListe(kind) });
      unterfelder(kind, p);
    }
    const zusatz = knoten.additionalProperties;
    if (zusatz && typeof zusatz === "object") unterfelder(zusatz, `${pfad}.*`);
  }
  for (const [feld, knoten] of Object.entries(schema.properties ?? {})) {
    if (feld === "version") continue;
    liste.push({ pfad: feld, text: knoten.description ?? "", werte: werteListe(knoten), wurzel: true });
    unterfelder(knoten, feld);
  }
  return liste;
}

/** Der Hash einer deutschen Beschreibung, nach demselben Verfahren wie die Seitenstempel (Plan #1348 E5). */
function stempelVon(text) {
  return createHash("sha256").update(String(text).replaceAll("\r\n", "\n").replaceAll("\r", "\n")).digest("hex").slice(0, 12);
}

/** Der Rahmentext, der nicht aus dem Schema stammt, je Sprache (Plan-Review #1348, Fund 7). */
const RAHMEN = {
  de: {
    hinweis: "_Dieser Abschnitt entsteht aus `templates/workflow.config.schema.json` mit `node tools/config-referenz.mjs`; Änderungen gehören ins Schema, nicht hierher._",
    gueltig: "gültig",
  },
  en: {
    hinweis: "_This section is generated from `templates/workflow.config.schema.json` by `node tools/config-referenz.mjs`; changes belong in the schema, not here._",
    gueltig: "valid",
  },
};

/** Der Abschnitt zwischen den Markern, ohne die Marker selbst; `texte` liefert die Beschreibung je Eintrag. */
function referenz(liste, sprache, texte) {
  const rahmen = RAHMEN[sprache];
  const werte = (w) => (w ? ` (${rahmen.gueltig}: ${w.map((x) => "`" + x + "`").join(", ")})` : "");
  const teile = ["", rahmen.hinweis, ""];
  let offen = false;
  for (const e of liste) {
    const text = entschaerft(texte(e));
    if (e.wurzel) {
      if (offen) teile.push("");
      teile.push(`### \`${e.pfad}\``, "", `${text}${werte(e.werte)}`, "");
      offen = false;
    } else {
      teile.push(`- \`${e.pfad}\` — ${text}${werte(e.werte)}`);
      offen = true;
    }
  }
  if (offen) teile.push("");
  return teile.join("\n");
}

/** Liest eine Doku-Datei und gibt die Lage der Marker zurück; `null`, wenn ein Marker fehlt. */
function marker(text) {
  const a = text.indexOf(START);
  const b = text.indexOf(ENDE);
  return a < 0 || b < a ? null : { a, b };
}

function ersetzt(text, { a, b }, abschnitt) {
  return text.slice(0, a + START.length) + abschnitt + text.slice(b);
}

const nurPruefen = process.argv.includes("--check");
const schema = JSON.parse(readFileSync(SCHEMA, "utf-8"));
const liste = eintraege(schema);
const doku = readFileSync(DOKU, "utf-8");
const lage = marker(doku);
if (doku.indexOf(START) < 0) fehler(`Marker ${START} fehlt in docs/dokumentation.md`);
if (!lage) fehler(`Marker ${ENDE} fehlt in docs/dokumentation.md oder steht vor ${START}`);
const neu = ersetzt(doku, lage, referenz(liste, "de", (e) => e.text));

// Die englische Fassung gilt erst, wenn docs/en/dokumentation.md beide Marker trägt; bis
// dahin bleibt alles wie vor Issue #1356.
const dokuEn = existsSync(DOKU_EN) ? readFileSync(DOKU_EN, "utf-8") : null;
const lageEn = dokuEn === null ? null : marker(dokuEn);
let neuEn = null;
const luecken = [];
if (lageEn) {
  const uebersetzung = existsSync(UEBERSETZUNG) ? JSON.parse(readFileSync(UEBERSETZUNG, "utf-8")) : {};
  for (const e of liste) {
    const eintrag = uebersetzung[e.pfad];
    if (!eintrag || typeof eintrag.text !== "string") luecken.push(`${e.pfad}: englischer Eintrag fehlt`);
    else if (eintrag.de !== stempelVon(e.text)) luecken.push(`${e.pfad}: Hash veraltet, erwartet ${stempelVon(e.text)} — die deutsche Beschreibung hat sich geändert`);
  }
  if (!luecken.length) neuEn = ersetzt(dokuEn, lageEn, referenz(liste, "en", (e) => uebersetzung[e.pfad].text));
}

const lueckenListe = luecken.map((l) => `  - ${l}`).join("\n");
const abweichend = [];
if (neu !== doku) abweichend.push("docs/dokumentation.md");
if (neuEn !== null && neuEn !== dokuEn) abweichend.push("docs/en/dokumentation.md");

if (nurPruefen) {
  if (luecken.length) {
    fehler(`englische Einstellungs-Referenz unvollständig (tools/config-referenz.en.json):\n${lueckenListe}`);
  }
  if (abweichend.length) {
    fehler(`Abschnitt „Alle Einstellungen" weicht vom Schema ab (${abweichend.join(", ")}) — node tools/config-referenz.mjs ausführen.`);
  }
  process.stdout.write("Abschnitt „Alle Einstellungen\" ist aktuell.\n");
} else {
  if (neu !== doku) writeFileSync(DOKU, neu, "utf-8");
  if (neuEn !== null && neuEn !== dokuEn) writeFileSync(DOKU_EN, neuEn, "utf-8");
  if (luecken.length) {
    fehler(`englischer Abschnitt nicht geschrieben, tools/config-referenz.en.json unvollständig:\n${lueckenListe}`);
  }
  process.stdout.write(abweichend.length ? `Abschnitt „Alle Einstellungen" geschrieben (${abweichend.join(", ")}).\n` : "Abschnitt „Alle Einstellungen\" ist aktuell.\n");
}
