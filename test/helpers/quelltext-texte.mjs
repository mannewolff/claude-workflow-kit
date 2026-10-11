// Der Quelltext-Scan der zweisprachigen Meldungen (Plan #1420 E13): Was der Mensch liest, geht
// ueber den Texthelfer. Der Scan liest die Zeichenketten eines Moduls ausserhalb seiner
// Texttabelle und meldet die, die deutsche Woerter tragen. Herausgezogen aus
// test/night-englisch-texte-einstieg.test.mjs (Issue #1486), damit jede Testdatei der Gruppen
// denselben Scan faehrt (Issue #1487).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { MARKER } from "../../kit/board/namen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ANFUEHRUNG = new Set(['"', "'", "`"]);

/** Das Ende des Kommentars ab `i`, oder -1, wenn dort keiner beginnt. */
function kommentarEnde(src, i) {
  if (src.startsWith("//", i)) {
    const zeilenende = src.indexOf("\n", i);
    return zeilenende < 0 ? src.length : zeilenende;
  }
  if (src.startsWith("/*", i)) return src.indexOf("*/", i + 2) + 2;
  return -1;
}

/** Das Ende einer Zeichenklasse `[…]` in einem regulaeren Ausdruck ab `i`. */
function klassenEnde(src, i) {
  let j = i + 1;
  while (j < src.length && src[j] !== "]") j += src[j] === "\\" ? 2 : 1;
  return j + 1;
}

/** Das Ende eines regulaeren Ausdrucks ab `i`, oder -1, wenn der Schraegstrich keiner beginnt. */
function regexEnde(src, i) {
  if (!/[(,=:!&|?;{}[]\s*$/.test(src.slice(Math.max(0, i - 20), i))) return -1;
  let j = i + 1;
  while (j < src.length && src[j] !== "/") {
    if (src[j] === "\\") j += 2;
    else if (src[j] === "[") j = klassenEnde(src, j);
    else j++;
  }
  return j + 1;
}

/** Ein `${…}` ab `i` (hinter der Klammer) bis zu seinem Ende; Literale darin zaehlen mit. */
function einschubEnde(src, i, aus) {
  let tiefe = 1;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (ANFUEHRUNG.has(c)) {
      j = liesLiteral(src, j, aus);
      continue;
    }
    if (c === "{") tiefe++;
    if (c === "}" && --tiefe === 0) return j + 1;
    j++;
  }
  return j;
}

/** Liest das Literal ab dem Anfuehrungszeichen bei `i` nach `aus`; Rueckgabe sein Ende. */
function liesLiteral(src, i, aus) {
  const q = src[i];
  let s = "";
  let j = i + 1;
  while (j < src.length && src[j] !== q) {
    if (src[j] === "\\") {
      s += src[j + 1];
      j += 2;
    } else if (q === "`" && src.startsWith("${", j)) {
      j = einschubEnde(src, j + 2, aus);
      s += " ";
    } else {
      s += src[j];
      j++;
    }
  }
  aus.push(s);
  return j + 1;
}

/**
 * Die Zeichenketten eines Quelltexts ohne Kommentare und ohne regulaere Ausdruecke; ein
 * Template-Literal ohne seine `${…}`-Teile, deren eigene Zeichenketten zaehlen mit.
 */
export function literale(src) {
  const aus = [];
  let i = 0;
  while (i < src.length) {
    const ende = kommentarEnde(src, i);
    if (ende >= 0) i = ende;
    else if (ANFUEHRUNG.has(src[i])) i = liesLiteral(src, i, aus);
    else if (src[i] === "/") i = Math.max(regexEnde(src, i), i + 1);
    else i++;
  }
  return aus;
}


// Woerter, die in einem englischen Satz nicht vorkommen. Gross und klein zaehlen getrennt: Die
// Kleinwoerter `karte`, `lauf` und `pruefung` sind Vertragswerte (E14) und bleiben.
export const DEUTSCHE_WOERTER = new RegExp(`\\b(${[
  "nicht", "kein", "keine", "der", "die", "das", "und", "ist", "wird", "wurde", "fehlt", "bleibt", "steht",
  "mit", "ohne", "nach", "beim", "von", "um", "Karte", "Lauf", "Pruefung", "Fehler",
].join("|")})\\b`);

const MARKER_DEUTSCH = new Set(Object.values(MARKER).map((m) => m.de));

/**
 * Die deutschen Texte eines Moduls ausserhalb seiner Texttabelle — was der Mensch liest, geht
 * ueber den Texthelfer. Ein Markername aus dem Register zaehlt nicht: Ihn waehlt das Register
 * je Sprache, der deutsche steht nur als Rueckfall ohne Register im Modul. `vertrag` nennt
 * weitere Texte, die als Vertragswert (E14) deutsch bleiben. `bis` begrenzt den Scan auf den
 * Quelltext vor dieser Stelle, fuer ein Modul, das in mehreren Paketen umgestellt wird.
 */
export function deutschAmHelferVorbei(datei, tabelle, vertrag = [], { bis } = {}) {
  const ganz = readFileSync(join(repoRoot, datei), "utf-8");
  const ende = bis ? ganz.indexOf(bis) : -1;
  if (bis) assert.ok(ende >= 0, `${datei}: die Grenze "${bis}" ist nicht zu finden`);
  const src = bis ? ganz.slice(0, ende) : ganz;
  const ohneTabelle = src.replace(/\nexport const TEXTE = Object\.freeze\(\{[\s\S]*?\n\}\);\n/, "\n");
  if (tabelle) assert.notEqual(ohneTabelle, src, `${datei}: die Texttabelle TEXTE ist nicht zu finden`);
  const ausnahmen = new Set(vertrag);
  return literale(ohneTabelle).filter((l) => DEUTSCHE_WOERTER.test(l) && !MARKER_DEUTSCH.has(l) && !ausnahmen.has(l));
}

/** Die Eintraege der englischen Tabellenhaelfte, die deutsche Woerter tragen. */
export function deutschImEnglischen(tabelle) {
  return Object.entries(tabelle?.en ?? {}).filter(([, v]) => DEUTSCHE_WOERTER.test(v.replaceAll(/\{\w+\}/g, "")));
}
