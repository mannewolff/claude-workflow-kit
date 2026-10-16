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
 * Gegliedert nach Zweck (Issue #1734, Plan #1710 A7, A8): je Teil aus kit/board/config-teile.mjs
 * eine `### `-Überschrift in der Reihenfolge der Seite. Die Zeile eines Wurzelfelds der ersten
 * beiden Teile endet mit seinem `wann`-Satz, jede Gruppe der Feinabstimmung leitet ihr
 * `gruppe`-Satz ein, und im Teil „Vom Kit verwaltet“ steht vor dem Satz das Kennzeichen.
 *
 * Zwei Sprachen (Issue #1356, Plan #1348 E8): Die deutsche Fassung schneidet ihren Satz aus
 * dem Schema, die englische in docs/en/einstellungen.md aus einer geprüften Übersetzung. Sie
 * steht in tools/config-referenz.en.json — je Einstellung der englische Text und der Hash
 * der deutschen Beschreibung — und nicht im Schema, das in jedes Projekt installiert wird.
 * Ändert sich eine deutsche Beschreibung, passt ihr Hash nicht mehr, und --check nennt die
 * Einstellung. Geschrieben und geprüft wird die englische Fassung erst, wenn
 * docs/en/einstellungen.md beide Marker trägt.
 *
 * Daneben die kommentierte Beispieldatei (Issue #1735, Plan #1710 A9, E3):
 * templates/workflow.config.example.de.jsonc und .en.jsonc, gegliedert in dieselben Teile. Die
 * Einstellungen des ersten Teils stehen aktiv mit dem Beispielwert aus
 * templates/workflow.config.json, alle übrigen auskommentiert mit ihrer Vorgabe; über jeder
 * Einstellung steht derselbe Satz wie auf der Seite. Der Installer legt die Fassung der
 * Projektsprache als .claude/workflow.config.example.jsonc ab; das Kit liest sie nie.
 *
 * Nutzung:
 *   node tools/config-referenz.mjs           Abschnitt neu schreiben
 *   node tools/config-referenz.mjs --check   nur vergleichen, Exit 1 bei Abweichung
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHLUESSEL, WERTE } from "../kit/board/config-namen.mjs";
import { TEILE, teilVon, kennzeichenVon } from "../kit/board/config-teile.mjs";

// KIT_ROOT ist ein Test-Hook wie in tools/copy-downloads-for-docs.mjs (Issue #186).
const root = process.env.KIT_ROOT
  ? resolve(process.env.KIT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = join(root, "templates", "workflow.config.schema.json");
const DOKU = join(root, "docs", "einstellungen.md");
const DOKU_EN = join(root, "docs", "en", "einstellungen.md");
const UEBERSETZUNG = join(root, "tools", "config-referenz.en.json");
const VORGABEN = join(root, "tools", "config-referenz.vorgaben.json");
const VORLAGE = join(root, "templates", "workflow.config.json");
const BEISPIEL = { de: join(root, "templates", "workflow.config.example.de.jsonc"), en: join(root, "templates", "workflow.config.example.en.jsonc") };
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
    teile: { einrichten: "Beim Einrichten nötig", lohnt: "Lohnt sich", verwaltet: "Vom Kit verwaltet", fein: "Feinabstimmung" },
    kennzeichen: { veraltet: "Veraltet.", installer: "Vom Installer gesetzt.", intern: "Intern." },
    beispielKopf: [
      "Beispieldatei zu .claude/workflow.config.json: jede Einstellung, die das Kit kennt, mit dem Satz der Einstellungsseite.",
      "Das Kit liest diese Datei nie, und jedes Update erneuert sie — Änderungen hier gehen verloren.",
      "Aktiv stehen die Einstellungen, die beim Einrichten nötig sind, mit Beispielwerten; alle übrigen stehen auskommentiert mit ihrer Vorgabe.",
      "Übernehmen: die Zeile nach .claude/workflow.config.json kopieren, das // davor entfernen und den Wert anpassen.",
    ],
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
    teile: { einrichten: "Needed at setup", lohnt: "Worth setting", verwaltet: "Managed by the kit", fein: "Fine-tuning" },
    kennzeichen: { veraltet: "Deprecated.", installer: "Set by the installer.", intern: "Internal." },
    beispielKopf: [
      "Example file for .claude/workflow.config.json: every setting the kit knows, with the sentence from the settings page.",
      "The kit never reads this file, and every update renews it — changes made here are lost.",
      "The settings needed at setup are active with example values; all others are commented out with their default.",
      "To take one over: copy the line into .claude/workflow.config.json, remove the leading // and adjust the value.",
    ],
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

/** Der Text einer Zeile hinter dem Pfad: Kennzeichen, Rest und `wann`-Satz eines Wurzelfelds. */
function seitenSatz(z, sprache, tabelle) {
  const kennzeichen = z.wurzel && kennzeichenVon(z.quelle);
  const vorn = kennzeichen ? `_${RAHMEN[sprache].kennzeichen[kennzeichen]}_ ` : "";
  const wann = z.wurzel && tabelle[z.quelle]?.wann ? ` ${tabelle[z.quelle].wann[sprache]}` : "";
  return `${vorn}${z.rest}${wann}`;
}

/**
 * Der Abschnitt zwischen den Markern, ohne die Marker selbst; `texte` liefert die Beschreibung je Eintrag.
 * `andere` ({ sprache, texte }) ist die andere Fassung, soweit sie vorliegt: Zusammengezogen wird nur,
 * was auch dort wörtlich gleich ist.
 */
function referenz(liste, sprache, texte, tabelle, andere = null) {
  const rahmen = RAHMEN[sprache];
  const zeilen = liste.map((e) => {
    const rest = zeilenRest(e, sprache, texte, tabelle);
    const gleich = andere ? `${rest}\n${zeilenRest(e, andere.sprache, andere.texte, tabelle)}` : rest;
    return { pfad: englischerPfad(e.pfad), quelle: e.pfad, teil: teilVon(e.pfad), wurzel: e.wurzel, rest, gleich };
  });
  const aus = ["", rahmen.hinweis];
  for (const teil of TEILE) {
    aus.push("", `### ${rahmen.teile[teil]}`);
    for (const z of zusammengezogen(zeilen.filter((x) => x.teil === teil))) {
      const gruppe = tabelle[z.quelle]?.gruppe;
      if (gruppe) aus.push("", gruppe[sprache], "");
      else if (z.wurzel) aus.push("");
      aus.push(`- \`${z.pfad}\` — ${seitenSatz(z, sprache, tabelle)}`);
    }
  }
  aus.push("");
  return aus.join("\n");
}

const istObjekt = (w) => w !== null && typeof w === "object" && !Array.isArray(w);

/** Die Vorgabe aus `default` mit englischem Aufzählungswert, `undefined` ohne `default`. */
function vorgabeWert(e) {
  if (!e.knoten || !("default" in e.knoten)) return undefined;
  const wert = e.knoten.default;
  return typeof wert === "string" ? WERTE[e.pfad]?.[wert] ?? wert : structuredClone(wert);
}

/** Ein leerer Wert nach dem Typ des Feldes, für eine Einstellung ohne Vorgabe und ohne Beispielwert. */
function leerWert(knoten) {
  const typ = Array.isArray(knoten?.type) ? knoten.type[0] : knoten?.type;
  if (typ === "array") return [];
  if (typ === "object" || knoten?.properties || knoten?.additionalProperties) return {};
  if (typ === "boolean") return false;
  if (typ === "integer" || typ === "number") return 0;
  return "";
}

/**
 * Die kommentierte Beispieldatei einer Sprache (Issue #1735, Plan #1710 A9, E3). Je Teil eine
 * Überschrift; je Einstellung darüber ihr Satz der Seite, nicht zusammengezogen. Aktiv steht ein
 * Wurzelfeld des ersten Teils mit Beispielwert aus der Vorlage, alles andere auskommentiert mit
 * seiner Vorgabe. Ein Objekt mit festen Feldern steht Feld für Feld, jedes mit seinem Satz;
 * Listen, freie Schlüssel und Varianten stehen als ein Wert, die Sätze ihrer Unterfelder darüber.
 * Ohne die Kommentarzeilen ist der aktive Teil gültiges JSON.
 */
function beispiel(liste, sprache, texte, tabelle, vorlage) {
  const rahmen = RAHMEN[sprache];
  const nachPfad = new Map(liste.map((e) => [e.pfad, e]));
  const satz = (e) => entschaerft(seitenSatz({ quelle: e.pfad, wurzel: e.wurzel, rest: zeilenRest(e, sprache, texte, tabelle) }, sprache, tabelle));
  const kinder = (e) => Object.keys(e.knoten?.properties ?? {}).map((n) => nachPfad.get(`${e.pfad}.${n}`)).filter(Boolean);
  const feldweise = (e, wert) => !e.knoten?.oneOf && kinder(e).length > 0 && (wert === undefined || istObjekt(wert));
  // Aktiv gilt das Beispiel vor der Vorgabe, auskommentiert die Vorgabe vor dem Beispiel.
  const wertVon = (e, bsp, aktiv) => {
    const vorgabe = vorgabeWert(e);
    const gewaehlt = aktiv ? bsp ?? vorgabe : vorgabe ?? bsp;
    return gewaehlt === undefined && !feldweise(e, undefined) ? leerWert(e.knoten) : gewaehlt;
  };

  function block(e, bsp, tiefe, aktiv, komma) {
    const vorn = "  ".repeat(tiefe);
    const k = aktiv ? "" : "// ";
    const name = englischerPfad(e.pfad).split(".").pop();
    const wert = wertVon(e, bsp, aktiv);
    const aus = [];
    if (tabelle[e.pfad]?.gruppe) aus.push(`${vorn}// ${tabelle[e.pfad].gruppe[sprache]}`);
    aus.push(`${vorn}// ${satz(e)}`);
    if (feldweise(e, wert)) {
      const felder = kinder(e);
      aus.push(`${vorn}${k}"${name}": {`);
      felder.forEach((kind, i) => {
        const kindName = englischerPfad(kind.pfad).split(".").pop();
        const kindBsp = wert?.[kindName] ?? wert?.[kind.pfad.split(".").pop()];
        aus.push(...block(kind, kindBsp, tiefe + 1, aktiv, i < felder.length - 1));
      });
      aus.push(`${vorn}${k}}${komma ? "," : ""}`);
      return aus;
    }
    for (const u of liste) {
      if (u.pfad.startsWith(`${e.pfad}.`) || u.pfad.startsWith(`${e.pfad}[]`)) aus.push(`${vorn}// \`${englischerPfad(u.pfad)}\` — ${satz(u)}`);
    }
    const json = JSON.stringify(wert, null, 2).split("\n");
    json[0] = `"${name}": ${json[0]}`;
    json[json.length - 1] += komma ? "," : "";
    aus.push(...json.map((z) => `${vorn}${k}${z}`));
    return aus;
  }

  const bloecke = [];
  for (const teil of TEILE) {
    bloecke.push({ zeilen: ["", `  // === ${rahmen.teile[teil]} ===`] });
    for (const e of liste.filter((x) => x.wurzel && teilVon(x.pfad) === teil)) {
      const name = englischerPfad(e.pfad);
      const aktiv = teil === "einrichten" && Object.hasOwn(vorlage, name);
      const bsp = name === "language" ? sprache : vorlage[name];
      bloecke.push({ aktiv, zeilen: ["", ...block(e, bsp, 1, aktiv, true)] });
    }
  }
  // Das letzte aktive Feld trägt kein Komma: Danach folgen nur noch Kommentarzeilen.
  const letzter = bloecke.findLast((b) => b.aktiv);
  if (letzter) letzter.zeilen[letzter.zeilen.length - 1] = letzter.zeilen.at(-1).replace(/,$/, "");
  return [...rahmen.beispielKopf.map((z) => `// ${z}`), "{", ...bloecke.flatMap((b) => b.zeilen).slice(1), "}", ""].join("\n");
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

// Die Beispieldateien: die englische nur, wenn die englische Referenz vollständig ist.
const vorlage = existsSync(VORLAGE) ? JSON.parse(readFileSync(VORLAGE, "utf-8")) : {};
const beispiele = [["de", deutsch], ["en", englisch]]
  .filter(([, texte]) => texte)
  .map(([sprache, texte]) => {
    const pfad = BEISPIEL[sprache];
    return { pfad, alt: existsSync(pfad) ? readFileSync(pfad, "utf-8") : null, neu: beispiel(liste, sprache, texte, tabelle, vorlage) };
  });

const lueckenListe = luecken.map((l) => `  - ${l}`).join("\n");
const abweichend = [];
if (neu !== doku) abweichend.push("docs/einstellungen.md");
if (neuEn !== null && neuEn !== dokuEn) abweichend.push("docs/en/einstellungen.md");
for (const b of beispiele) if (b.neu !== b.alt) abweichend.push(`templates/${b.pfad.split(/[\\/]/).pop()}`);

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
  for (const b of beispiele) if (b.neu !== b.alt) writeFileSync(b.pfad, b.neu, "utf-8");
  if (luecken.length) {
    fehler(`englischer Abschnitt nicht geschrieben, tools/config-referenz.en.json unvollständig:\n${lueckenListe}`);
  }
  process.stdout.write(abweichend.length ? `Abschnitt „Alle Einstellungen" geschrieben (${abweichend.join(", ")}).\n` : "Abschnitt „Alle Einstellungen\" ist aktuell.\n");
}
