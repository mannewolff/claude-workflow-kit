#!/usr/bin/env node
/**
 * sprachfassungen.mjs — hält die deutsche und die englische Doku gleich (Issue #1355,
 * Plan #1348 E5, E6, E9).
 *
 * Deutsch ist die Quelle: `docs/<name>.md`. Die englische Fassung liegt unter
 * `docs/en/<name>.md` und trägt unter jeder Überschrift einen Stempel
 * `<!-- de: <hash> -->` — die ersten 12 Hex-Zeichen von SHA-256 über den deutschen
 * Abschnitt. Ändert sich ein deutscher Abschnitt, passt sein Stempel nicht mehr, und die
 * Prüfung nennt Seite, Abschnitt und den neuen Stempel.
 *
 * Ein Abschnitt reicht von einer Überschrift (jede Ebene, außerhalb von Codeblöcken) bis
 * zur nächsten. Abschnitt 0 ist der Text davor: leer bei Seiten, die mit `# ` beginnen,
 * die ganze Datei bei `docs/index.md` — dessen Stempel steht in der ersten Zeile nach
 * dem Frontmatter. Den erzeugten Bereich zwischen den Einstellungs-Markern lässt die
 * Prüfung in beiden Dateien aus; ihn hält `tools/config-referenz.mjs`.
 *
 * `docs-site/sprachen.json` schaltet: Bei `englischAktiv: false` darf eine englische
 * Seite fehlen, eine vorhandene muss ein lückenloses Anfangsstück der deutschen sein. Bei
 * `true` ist jede Seite vollständig Pflicht. Die Seiten unter `historisch` brauchen nur
 * einen Verweis auf das deutsche Original.
 *
 * Nutzung:
 *   node tools/sprachfassungen.mjs --check             alle Paare prüfen, Exit 1 bei Abweichung
 *   node tools/sprachfassungen.mjs --erwartet <seite>  Stempel einer deutschen Seite ausgeben
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { vergleicheText } from "../kit/night/grundlagen.mjs";

// KIT_ROOT ist ein Test-Hook wie in tools/config-referenz.mjs.
const root = process.env.KIT_ROOT
  ? resolve(process.env.KIT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(root, "docs");
const EN = join(DOCS, "en");
const SPRACHEN = join(root, "docs-site", "sprachen.json");
const START = "<!-- einstellungen:start -->";
const ENDE = "<!-- einstellungen:ende -->";
const STEMPEL = /^<!-- de: ([0-9a-f]{12}) -->$/;
const KOPF = /^(#{1,6})\s+\S/;
const ZAUN = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;

function fehler(meldung) {
  process.stderr.write(`Fehler: ${meldung}\n`);
  process.exit(1);
}

function stempelVon(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** Die Zeilen ohne den erzeugten Bereich zwischen den Einstellungs-Markern. */
function ohneEinstellungen(zeilen) {
  const aus = [];
  let drin = false;
  for (const z of zeilen) {
    if (z.trim() === START) {
      drin = true;
      aus.push(z);
    } else if (z.trim() === ENDE) {
      drin = false;
      aus.push(z);
    } else if (!drin) aus.push(z);
  }
  return aus;
}

/**
 * Ordnet eine Zeile außerhalb des Frontmatters ein: Codezaun, Überschrift, Tabellenzeile
 * oder Text. `zustand.zaun` hält den offenen Codezaun.
 */
function ordneEin(liste, z, zustand) {
  const aktuell = liste.at(-1);
  const m = ZAUN.exec(z);
  if (zustand.zaun) {
    const schliesst = m && m[1][0] === zustand.zaun[0] && m[1].length >= zustand.zaun.length && m[2] === "";
    if (schliesst) zustand.zaun = null;
  } else if (m) {
    zustand.zaun = m[1];
    aktuell.code.push(m[2] || "-");
  } else if (KOPF.test(z)) {
    liste.push({ kopf: z.trim(), ebene: KOPF.exec(z)[1].length, zeilen: [z], code: [], tabelle: 0 });
    return;
  } else if (/^\s*\|/.test(z)) aktuell.tabelle++;
  aktuell.zeilen.push(z);
}

/**
 * Zerlegt eine Seite in Abschnitte. Jeder Abschnitt trägt seine Überschrift (`kopf`,
 * leer für Abschnitt 0), seine Ebene, seinen Text, seine Codeblöcke (Sprachangaben) und
 * die Zahl seiner Tabellenzeilen.
 */
function abschnitte(roh) {
  const zeilen = ohneEinstellungen(roh.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n"));
  const liste = [{ kopf: "", ebene: 0, zeilen: [], code: [], tabelle: 0 }];
  // Das Frontmatter gehört ungeteilt zu Abschnitt 0: ein `# ` darin ist ein YAML-Kommentar.
  const frontmatter = zeilen[0]?.trim() === "---" ? zeilen.findIndex((z, i) => i > 0 && z.trim() === "---") : -1;
  const zustand = { zaun: null };
  for (const [nr, z] of zeilen.entries()) {
    if (nr <= frontmatter) liste[0].zeilen.push(z);
    else ordneEin(liste, z, zustand);
  }
  for (const a of liste) {
    a.text = a.zeilen.join("\n");
    a.stempel = stempelVon(a.text);
  }
  // Abschnitt 0 zählt nur, wenn vor der ersten Überschrift Text steht.
  liste[0].leer = liste[0].text.trim() === "";
  return liste;
}

/** Der Stempel eines englischen Abschnitts: erste nichtleere Zeile nach Überschrift bzw. Frontmatter. */
function gefundenerStempel(abschnitt, index) {
  let zeilen = index === 0 ? abschnitt.zeilen : abschnitt.zeilen.slice(1);
  if (index === 0 && zeilen[0]?.trim() === "---") {
    const ende = zeilen.findIndex((z, i) => i > 0 && z.trim() === "---");
    if (ende > 0) zeilen = zeilen.slice(ende + 1);
  }
  const erste = zeilen.find((z) => z.trim() !== "");
  const m = erste ? STEMPEL.exec(erste.trim()) : null;
  return m ? m[1] : null;
}

function name(a) {
  return a.kopf || "Abschnitt 0";
}

function erwartung(a) {
  return `erwartet <!-- de: ${a.stempel} -->`;
}

/**
 * Prüft die englische Überschrift an Position k gegen die deutsche. Liefert true, wenn
 * die Reihenfolge ab hier nicht mehr stimmt und weitere Positionen nur Folgefehler wären.
 */
function pruefePosition(k, de, en, gefunden, melde) {
  const d = de[k];
  const s = gefunden[k];
  if (en[k].ebene !== d.ebene) {
    melde(d, `Überschrift auf Ebene ${en[k].ebene} statt ${d.ebene} ("${en[k].kopf}")`);
    return true;
  }
  if (s === d.stempel) {
    pruefeStruktur(d, en[k], melde);
    return false;
  }
  const j = de.findIndex((x, i) => i > 0 && x.stempel === s);
  if (j < 0 || j === k) {
    melde(d, s ? `Stempel veraltet (gefunden ${s})` : "Stempel fehlt");
    return false;
  }
  const spaeter = gefunden.indexOf(d.stempel, k + 1);
  if (j < k || spaeter > k) melde(d, `Reihenfolge vertauscht, an dieser Stelle steht "${en[k].kopf}"`);
  else melde(d, `Lücke im Anfangsstück, der Abschnitt fehlt vor "${en[k].kopf}"`);
  return true;
}

/** Prüft ein Seitenpaar und liefert die Abweichungen als Meldungen. */
function pruefePaar(seite, de, en, aktiv) {
  const ort = `docs/en/${seite}.md`;
  const meldungen = [];
  const melde = (a, text) => meldungen.push(`${ort}, Abschnitt "${name(a)}": ${text}, ${erwartung(a)}`);

  if (!de[0].leer) {
    const s = gefundenerStempel(en[0], 0);
    if (s === de[0].stempel) pruefeStruktur(de[0], en[0], melde);
    else melde(de[0], s ? `Stempel veraltet (gefunden ${s})` : "Stempel fehlt");
  }

  const gefunden = en.map((a, i) => (i === 0 ? null : gefundenerStempel(a, i)));
  for (let k = 1; k < en.length; k++) {
    if (k >= de.length) {
      meldungen.push(`${ort}, Abschnitt "${en[k].kopf}": überzählige Überschrift, die deutsche Seite endet vorher`);
      break;
    }
    if (pruefePosition(k, de, en, gefunden, melde)) break;
  }

  if (aktiv) for (const d of de.slice(en.length)) melde(d, "Abschnitt fehlt");
  return meldungen;
}

function pruefeStruktur(d, e, melde) {
  if (d.code.join(",") !== e.code.join(",")) {
    melde(d, `Codeblöcke weichen ab (deutsch: ${d.code.length} [${d.code.join(", ")}], englisch: ${e.code.length} [${e.code.join(", ")}])`);
  }
  if (d.tabelle !== e.tabelle) melde(d, `Tabellenzeilen weichen ab (deutsch: ${d.tabelle}, englisch: ${e.tabelle})`);
}

function lies(pfad) {
  return readFileSync(pfad, "utf-8");
}

function sprachen() {
  if (!existsSync(SPRACHEN)) fehler(`${SPRACHEN} fehlt`);
  const s = JSON.parse(lies(SPRACHEN));
  return { aktiv: s.englischAktiv === true, historisch: new Set(s.historisch ?? []) };
}

function deutscheSeiten() {
  return readdirSync(DOCS, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => basename(e.name, ".md"))
    .sort(vergleicheText);
}

/** Eine historische Seite braucht nur den Verweis auf das deutsche Original (E9). */
function pruefeHistorisch(seite, enPfad, aktiv) {
  if (!existsSync(enPfad)) {
    return aktiv ? [`docs/en/${seite}.md fehlt (historische Seite, braucht den Verweis ](/${seite}))`] : [];
  }
  const verweis = new RegExp(`\\]\\(/${seite}(\\.md)?(#[^)]*)?\\)`);
  if (verweis.test(lies(enPfad))) return [];
  return [`docs/en/${seite}.md: historische Seite ohne Verweis auf das deutsche Original ](/${seite})`];
}

/** Prüft eine deutsche Seite gegen ihre englische Fassung. */
function pruefeSeite(seite, aktiv) {
  const enPfad = join(EN, `${seite}.md`);
  const de = abschnitte(lies(join(DOCS, `${seite}.md`)));
  if (existsSync(enPfad)) return pruefePaar(seite, de, abschnitte(lies(enPfad)), aktiv);
  if (!aktiv) return [];
  const erster = de.find((a, i) => i > 0 || !a.leer) ?? de[0];
  return [`docs/en/${seite}.md fehlt, Abschnitt "${name(erster)}", ${erwartung(erster)}`];
}

function check() {
  const { aktiv, historisch } = sprachen();
  const meldungen = [];
  let geprueft = 0;
  for (const seite of deutscheSeiten()) {
    const enPfad = join(EN, `${seite}.md`);
    if (existsSync(enPfad)) geprueft++;
    if (historisch.has(seite)) meldungen.push(...pruefeHistorisch(seite, enPfad, aktiv));
    else meldungen.push(...pruefeSeite(seite, aktiv));
  }
  if (meldungen.length) {
    for (const m of meldungen) process.stderr.write(`${m}\n`);
    process.stderr.write(`Sprachfassungen weichen ab: ${meldungen.length} Abweichung(en). Stempel einer Seite: node tools/sprachfassungen.mjs --erwartet <seite>\n`);
    process.exit(1);
  }
  process.stdout.write(`Sprachfassungen gleich: ${geprueft} englische Seite(n) geprüft, englischAktiv: ${aktiv}\n`);
}

function erwartet(seite) {
  if (!seite) fehler("--erwartet braucht eine Seite, zum Beispiel --erwartet wsl2");
  const kurz = basename(seite, ".md");
  const pfad = join(DOCS, `${kurz}.md`);
  if (!existsSync(pfad)) fehler(`docs/${kurz}.md gibt es nicht`);
  for (const a of abschnitte(lies(pfad))) {
    if (a.ebene === 0 && a.leer) continue;
    process.stdout.write(`<!-- de: ${a.stempel} -->  ${name(a)}\n`);
  }
}

const args = process.argv.slice(2);
if (args[0] === "--check") check();
else if (args[0] === "--erwartet") erwartet(args[1]);
else fehler("Nutzung: node tools/sprachfassungen.mjs --check | --erwartet <seite>");
