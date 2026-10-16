#!/usr/bin/env node
/**
 * config-referenz.mjs — erzeugt den Abschnitt „Alle Einstellungen" in
 * docs/einstellungen.md aus templates/workflow.config.schema.json (Issue #675,
 * Plan #674 E3; eigene Seite seit Plan #1652 E4).
 *
 * Das Schema ist die Quelle, dieser Abschnitt ist ihr Abbild. Je Einstellung steht eine
 * Zeile (Plan #1652 E3): englischer Pfad, erster Satz der Beschreibung, gültige Werte und
 * Vorgabe, dazu der Wertebereich aus `minimum`, `maximum` und `const`. Die Vorgabe kommt aus `default`, sonst aus tools/config-referenz.vorgaben.json,
 * sonst steht „Keine Vorgabe“. Dieselbe Datei ersetzt je Pfad den ersten Satz, wo er keine
 * Wirkung nennt. Gleich gebaute Geschwister mit wörtlich gleicher Zeile stehen in einer Zeile
 * mit `{a,b,c}` im Pfad (Issue #1732). Geschrieben wird ausschließlich zwischen den beiden Markern; der übrige
 * Text der Seite bleibt unberührt.
 *
 * Zwei Sprachen (Issue #1356, Plan #1348 E8): Die deutsche Fassung schneidet ihren Satz aus
 * dem Schema, die englische in docs/en/einstellungen.md aus einer geprüften Übersetzung. Sie
 * steht in tools/config-referenz.en.json — je Einstellung der englische Text und der Hash
 * der deutschen Beschreibung — und nicht im Schema, das in jedes Projekt installiert wird.
 * Ändert sich eine deutsche Beschreibung, passt ihr Hash nicht mehr, und --check nennt die
 * Einstellung. Geschrieben und geprüft wird die englische Fassung erst, wenn
 * docs/en/einstellungen.md beide Marker trägt.
 *
 * Nutzung:
 *   node tools/config-referenz.mjs           Abschnitt neu schreiben
 *   node tools/config-referenz.mjs --check   nur vergleichen, Exit 1 bei Abweichung
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHLUESSEL } from "../kit/board/config-namen.mjs";
import { teilVon } from "../kit/board/config-teile.mjs";

// KIT_ROOT ist ein Test-Hook wie in tools/copy-downloads-for-docs.mjs (Issue #186).
const root = process.env.KIT_ROOT
  ? resolve(process.env.KIT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = join(root, "templates", "workflow.config.schema.json");
const DOKU = join(root, "docs", "einstellungen.md");
const DOKU_EN = join(root, "docs", "en", "einstellungen.md");
const UEBERSETZUNG = join(root, "tools", "config-referenz.en.json");
const VORGABEN = join(root, "tools", "config-referenz.vorgaben.json");
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
 * Der Wertebereich eines Feldes aus `const`, `minimum` und `maximum` als Satz, leer ohne
 * diese Angaben (Issue #1669): Der erste Satz der Beschreibung trägt ihn nicht immer.
 */
function bereichSatz(knoten, sprache) {
  const rahmen = RAHMEN[sprache];
  if (knoten && "const" in knoten) return ` ${rahmen.wert}: \`${JSON.stringify(knoten.const)}\`.`;
  const min = typeof knoten?.minimum === "number" ? knoten.minimum : undefined;
  const max = typeof knoten?.maximum === "number" ? knoten.maximum : undefined;
  if (min !== undefined && max !== undefined) return ` ${rahmen.werte}: ${min} ${rahmen.bis} ${max}.`;
  if (min !== undefined) return ` ${rahmen.werte}: ${rahmen.ab} ${min}.`;
  if (max !== undefined) return ` ${rahmen.werte}: ${rahmen.hoechstens} ${max}.`;
  return "";
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
      if (typeof knoten.items.description === "string") liste.push({ pfad: `${pfad}[]`, text: knoten.items.description, knoten: knoten.items });
      unterfelder(knoten.items, `${pfad}[]`);
    }
    for (const variante of knoten.oneOf ?? []) unterfelder(variante, pfad);
    for (const [name, kind] of Object.entries(knoten.properties ?? {})) {
      const p = `${pfad}.${name}`;
      if (typeof kind.description === "string") liste.push({ pfad: p, text: kind.description, werte: werteListe(kind), knoten: kind });
      unterfelder(kind, p);
    }
    const zusatz = knoten.additionalProperties;
    if (zusatz && typeof zusatz === "object") unterfelder(zusatz, `${pfad}.*`);
  }
  for (const [feld, knoten] of Object.entries(schema.properties ?? {})) {
    if (feld === "version") continue;
    liste.push({ pfad: feld, text: knoten.description ?? "", werte: werteListe(knoten), wurzel: true, knoten });
    unterfelder(knoten, feld);
  }
  return liste;
}

/** Der Hash einer deutschen Beschreibung, nach demselben Verfahren wie die Seitenstempel (Plan #1348 E5). */
function stempelVon(text) {
  return createHash("sha256").update(String(text).replaceAll("\r\n", "\n").replaceAll("\r", "\n")).digest("hex").slice(0, 12);
}

/**
 * Der englische Pfad zu einem deutschen (Issue #1439, Plan #1420 E20): jedes Glied nach
 * kit/board/config-namen.mjs, `[]` und `*` bleiben stehen, ein Glied ausserhalb der Tabelle
 * auch.
 */
function englischerPfad(pfad) {
  const glieder = pfad.split(".");
  return glieder
    .map((glied, i) => {
      const name = glied.replace(/\[\]$/, "");
      const englisch = SCHLUESSEL[[...glieder.slice(0, i), name].join(".")] ?? name;
      return glied.endsWith("[]") ? `${englisch}[]` : englisch;
    })
    .join(".");
}

/** Abkürzungen, deren Punkt den ersten Satz nicht beendet. */
const ABKUERZUNGEN = ["z.B.", "bzw.", "ggf.", "d.h.", "u.a.", "e.g.", "i.e."];

/**
 * Der erste Satz einer Beschreibung (Plan #1652 E3): Er endet am ersten Punkt mit folgendem
 * Leerraum außerhalb von Klammern; eine Abkürzung beendet ihn nicht. Ohne solchen Punkt
 * ist der ganze Text der Satz.
 */
function ersterSatz(text) {
  let tiefe = 0;
  for (let i = 0; i < text.length; i++) {
    const zeichen = text[i];
    if (zeichen === "(") tiefe++;
    else if (zeichen === ")") tiefe = Math.max(0, tiefe - 1);
    else if (zeichen === "." && tiefe === 0 && /\s/.test(text[i + 1] ?? "")) {
      const bisHier = text.slice(0, i + 1);
      if (!ABKUERZUNGEN.some((abk) => bisHier.endsWith(abk))) return bisHier;
    }
  }
  return text.trimEnd();
}

/** Der Rahmentext, der nicht aus dem Schema stammt, je Sprache (Plan-Review #1348, Fund 7). */
const RAHMEN = {
  de: {
    hinweis: "_Dieser Abschnitt entsteht aus `templates/workflow.config.schema.json` mit `node tools/config-referenz.mjs`; Änderungen gehören ins Schema, nicht hierher._",
    gueltig: "Gültig",
    vorgabe: "Vorgabe",
    keine: "Keine Vorgabe.",
    leer: "leer",
    objekt: "die Werte der Felder darunter",
    wert: "Wert",
    werte: "Werte",
    bis: "bis",
    ab: "ab",
    hoechstens: "bis",
  },
  en: {
    hinweis: "_This section is generated from `templates/workflow.config.schema.json` by `node tools/config-referenz.mjs`; changes belong in the schema, not here._",
    gueltig: "Valid",
    vorgabe: "Default",
    keine: "No default.",
    leer: "empty",
    objekt: "the values of the fields below",
    wert: "Value",
    werte: "Values",
    bis: "to",
    ab: "from",
    hoechstens: "up to",
  },
};

/**
 * Die Vorgabe als Satzende: aus `default`, sonst aus der Tabelle, sonst „Keine Vorgabe“.
 * Eine `bedingung` der Tabelle steht hinter der Vorgabe, wenn sie nicht immer gilt — etwa
 * nur, wenn der ganze Block fehlt (Issue #1669).
 */
function vorgabeSatz(e, sprache, tabelle) {
  const rahmen = RAHMEN[sprache];
  const bedingung = tabelle[e.pfad]?.bedingung;
  const zusatz = bedingung ? ", " + bedingung[sprache] : "";
  const mitBedingung = (text) => `${rahmen.vorgabe}: ${text}${zusatz}.`;
  if (e.knoten && "default" in e.knoten) {
    const wert = e.knoten.default;
    let text;
    if (wert === "") text = rahmen.leer;
    else if (wert !== null && typeof wert === "object" && !Array.isArray(wert)) text = rahmen.objekt;
    else text = "`" + (typeof wert === "string" ? wert : JSON.stringify(wert)) + "`";
    return mitBedingung(text);
  }
  const eintrag = tabelle[e.pfad]?.vorgabe;
  return eintrag ? mitBedingung(eintrag[sprache]) : rahmen.keine;
}

/**
 * Zieht gleich gebaute Geschwister zusammen (Issue #1732, Plan #1710 A14): Zeilen, deren Pfade
 * sich in genau einem Glied unterscheiden, das weder das erste noch das letzte ist, und deren
 * Text danach wörtlich gleich ist, werden eine Zeile mit `{a,b,c}` an dieser Stelle. Sie steht, wo die
 * erste stand. `zeilen` trägt je Eintrag `pfad` (englisch), `rest` (alles hinter dem Pfad) und
 * `gleich` (der Text, der übereinstimmen muss: der Rest beider Sprachen, damit beide Fassungen
 * dieselben Zeilen zusammenziehen).
 */
function zusammengezogen(zeilen) {
  const verbraucht = new Set();
  const aus = [];
  zeilen.forEach((z, i) => {
    if (verbraucht.has(i)) return;
    const glieder = z.pfad.split(".");
    for (let stelle = 1; stelle < glieder.length - 1; stelle++) {
      const muster = (pfad) => {
        const g = pfad.split(".");
        return g.length === glieder.length ? [...g.slice(0, stelle), "", ...g.slice(stelle + 1)].join(".") : null;
      };
      const gesucht = muster(z.pfad);
      const gleiche = [];
      for (let j = i + 1; j < zeilen.length; j++) {
        if (!verbraucht.has(j) && zeilen[j].gleich === z.gleich && muster(zeilen[j].pfad) === gesucht) gleiche.push(j);
      }
      if (!gleiche.length) continue;
      for (const j of gleiche) verbraucht.add(j);
      const namen = [glieder[stelle], ...gleiche.map((j) => zeilen[j].pfad.split(".")[stelle])];
      aus.push({ ...z, pfad: [...glieder.slice(0, stelle), `{${namen.join(",")}}`, ...glieder.slice(stelle + 1)].join(".") });
      return;
    }
    aus.push(z);
  });
  return aus;
}

/** Alles hinter dem Pfad: Satz, gültige Werte, Wertebereich und Vorgabe. */
function zeilenRest(e, sprache, texte, tabelle) {
  const werte = e.werte ? ` ${RAHMEN[sprache].gueltig}: ${e.werte.map((x) => "`" + x + "`").join(", ")}.` : "";
  const satz = tabelle[e.pfad]?.satz?.[sprache] ?? ersterSatz(texte(e));
  return `${entschaerft(satz)}${werte}${bereichSatz(e.knoten, sprache)} ${vorgabeSatz(e, sprache, tabelle)}`;
}

/**
 * Der Abschnitt zwischen den Markern, ohne die Marker selbst; `texte` liefert die Beschreibung je Eintrag.
 * `andere` ({ sprache, texte }) ist die andere Fassung, soweit sie vorliegt: Zusammengezogen wird nur,
 * was auch dort wörtlich gleich ist.
 */
function referenz(liste, sprache, texte, tabelle, andere = null) {
  const zeilen = liste.map((e) => {
    const rest = zeilenRest(e, sprache, texte, tabelle);
    const gleich = andere ? `${rest}\n${zeilenRest(e, andere.sprache, andere.texte, tabelle)}` : rest;
    return { pfad: englischerPfad(e.pfad), wurzel: e.wurzel, rest, gleich };
  });
  const teile = ["", RAHMEN[sprache].hinweis];
  for (const z of zusammengezogen(zeilen)) {
    if (z.wurzel) teile.push("");
    teile.push(`- \`${z.pfad}\` — ${z.rest}`);
  }
  teile.push("");
  return teile.join("\n");
}

/**
 * Die Pfade, die einen Satz der Tabelle brauchen (Issue #1733, Plan #1710 A8): `wann` je Wurzelfeld
 * der Teile „Beim Einrichten nötig“ und „Lohnt sich“, `gruppe` je Gruppe der Feinabstimmung — ein
 * Wurzelfeld mit Unterfeldern, bei `night` dazu jedes Objekt der zweiten Ebene.
 */
function pflichtSaetze(liste) {
  const wann = new Set();
  const gruppe = new Set();
  for (const e of liste) {
    const teil = teilVon(e.pfad);
    if (e.wurzel && (teil === "einrichten" || teil === "lohnt")) wann.add(e.pfad);
    if (teil !== "fein") continue;
    const unterfeld = liste.some((u) => u.pfad.startsWith(`${e.pfad}.`) || u.pfad.startsWith(`${e.pfad}[]`));
    if (e.wurzel && unterfeld) gruppe.add(e.pfad);
    if (/^night\.[^.[]+$/.test(e.pfad) && e.knoten?.properties) gruppe.add(e.pfad);
  }
  return { wann, gruppe };
}

/** Ein Tabellenpfad mit seinem englischen Namen, wenn der abweicht. */
function benannt(pfad) {
  const englisch = englischerPfad(pfad);
  return englisch === pfad ? pfad : `${pfad} (${englisch})`;
}

/** Die Fehler eines Tabelleneintrags zu einer Einstellung des Schemas. */
function eintragFehler(pfad, eintrag, e, pflicht) {
  const fehlerListe = [];
  if (eintrag.vorgabe && e.knoten && "default" in e.knoten) fehlerListe.push(`${pfad}: trägt im Schema schon default, die Vorgabe der Tabelle griffe nie`);
  for (const art of ["vorgabe", "satz", "bedingung", "wann", "gruppe"]) {
    if (eintrag[art] && (typeof eintrag[art].de !== "string" || typeof eintrag[art].en !== "string")) {
      fehlerListe.push(`${pfad}: ${art} braucht de und en`);
    }
  }
  if (eintrag.wann && !pflicht.wann.has(pfad)) fehlerListe.push(`${benannt(pfad)}: wann steht nur an einem Wurzelfeld der Teile „Beim Einrichten nötig“ und „Lohnt sich“`);
  if (eintrag.gruppe && !pflicht.gruppe.has(pfad)) fehlerListe.push(`${benannt(pfad)}: gruppe steht nur an einer Gruppe der Feinabstimmung`);
  return fehlerListe;
}

/**
 * Die Fehler der Vorgabetabelle: unbekannte Pfade, Vorgabe neben `default`, fehlende Sprache,
 * fehlende und fehl platzierte `wann`- und `gruppe`-Sätze.
 */
function tabellenFehler(tabelle, liste) {
  const nachPfad = new Map(liste.map((e) => [e.pfad, e]));
  const pflicht = pflichtSaetze(liste);
  const fehlerListe = Object.entries(tabelle).flatMap(([pfad, eintrag]) => {
    const e = nachPfad.get(pfad);
    return e ? eintragFehler(pfad, eintrag, e, pflicht) : [`${pfad}: keine Einstellung des Schemas`];
  });
  for (const pfad of pflicht.wann) if (!tabelle[pfad]?.wann) fehlerListe.push(`${benannt(pfad)}: wann fehlt — ein Satz, was sich ändert und wann man es setzt`);
  for (const pfad of pflicht.gruppe) if (!tabelle[pfad]?.gruppe) fehlerListe.push(`${benannt(pfad)}: gruppe fehlt — ein Satz, wofür die Gruppe da ist`);
  return fehlerListe;
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
const tabelle = existsSync(VORGABEN) ? JSON.parse(readFileSync(VORGABEN, "utf-8")) : {};
const tabellenLuecken = tabellenFehler(tabelle, liste);
if (tabellenLuecken.length) {
  const aufzaehlung = tabellenLuecken.map((l) => "  - " + l).join("\n");
  fehler(`tools/config-referenz.vorgaben.json passt nicht zum Schema:\n${aufzaehlung}`);
}
const doku = readFileSync(DOKU, "utf-8");
const lage = marker(doku);
if (doku.indexOf(START) < 0) fehler(`Marker ${START} fehlt in docs/einstellungen.md`);
if (!lage) fehler(`Marker ${ENDE} fehlt in docs/einstellungen.md oder steht vor ${START}`);

// Die englische Fassung gilt erst, wenn docs/en/einstellungen.md beide Marker trägt.
const dokuEn = existsSync(DOKU_EN) ? readFileSync(DOKU_EN, "utf-8") : null;
const lageEn = dokuEn === null ? null : marker(dokuEn);
let neuEn = null;
const luecken = [];
const deutsch = (e) => e.text;
let englisch = null;
if (lageEn) {
  const uebersetzung = existsSync(UEBERSETZUNG) ? JSON.parse(readFileSync(UEBERSETZUNG, "utf-8")) : {};
  for (const e of liste) {
    const eintrag = uebersetzung[e.pfad];
    if (!eintrag || typeof eintrag.text !== "string") luecken.push(`${e.pfad}: englischer Eintrag fehlt`);
    else if (eintrag.de !== stempelVon(e.text)) luecken.push(`${e.pfad}: Hash veraltet, erwartet ${stempelVon(e.text)} — die deutsche Beschreibung hat sich geändert`);
  }
  if (!luecken.length) {
    englisch = (e) => uebersetzung[e.pfad].text;
    neuEn = ersetzt(dokuEn, lageEn, referenz(liste, "en", englisch, tabelle, { sprache: "de", texte: deutsch }));
  }
}
const neu = ersetzt(doku, lage, referenz(liste, "de", deutsch, tabelle, englisch && { sprache: "en", texte: englisch }));

const lueckenListe = luecken.map((l) => `  - ${l}`).join("\n");
const abweichend = [];
if (neu !== doku) abweichend.push("docs/einstellungen.md");
if (neuEn !== null && neuEn !== dokuEn) abweichend.push("docs/en/einstellungen.md");

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
