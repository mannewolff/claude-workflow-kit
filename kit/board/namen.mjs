/**
 * board/namen.mjs — Namen-Register der Labels und Titel-Praefixe (Issue #1421, Plan #1420
 * E2 bis E4): je Sache ein deutscher und ein englischer Name, die Projektsprache aus der
 * Config und das Erkennen beider Namen. Dazu die zurueckgelesenen Marker in Kommentaren und
 * Body und der Texthelfer, ueber den jedes Modul seine Meldungen in der Projektsprache
 * waehlt (Issue #1440, E13, E15).
 *
 * Hier und nur hier stehen die Namenspaare. Bis zu diesem Register standen dieselben Labels
 * mehrfach im Code, nur durch SYNC-Kommentare gehalten (`kit:klaeren` dreifach,
 * `kit:geschuetzt` doppelt). Jede Stelle soll ueber das Register beide Namen erkennen und
 * den Namen der Projektsprache schreiben (Plan #1420, Kriterium 4 der fachlichen Quelle
 * #1416); die Umstellung der Nutzer folgt in eigenen Paketen.
 *
 * Die englischen Namen legt E4 fest. `kit:night`, `kit:nightrun`, `planreview:1|2`, `[Plan]`
 * und `[Task]` sind schon englisch und heissen in beiden Sprachen gleich.
 *
 * Dieses Modul importiert nur Node-Bordmittel — es soll von jedem Teil des Kits geladen
 * werden koennen, ohne einen Zyklus zu bilden.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Die Sprachen des Kits; die erste ist die Vorgabe (E2). */
export const SPRACHEN = Object.freeze(["de", "en"]);
const VORGABE = SPRACHEN[0];

/**
 * Die Sprache des Projekts: das Wurzelfeld `language`, sonst sein deutscher Altname
 * `sprache`, sonst `de` (E2). Ein Wert ausserhalb von `de` und `en` gilt wie ein fehlendes
 * Feld — ein bestehendes Projekt bleibt deutsch, bis der Mensch es umstellt.
 */
export function projektSprache(config) {
  const wert = config?.language ?? config?.sprache;
  return SPRACHEN.includes(wert) ? wert : VORGABE;
}

const eintrag = (de, en = de) => Object.freeze({ de, en });

/** Die Kit-Labels, je Sache der deutsche und der englische Name (E4). */
export const LABELS = Object.freeze({
  klaeren: eintrag("kit:klaeren", "kit:clarify"),
  geschuetzt: eintrag("kit:geschuetzt", "kit:protected"),
  durchziehen: eintrag("kit:durchziehen", "kit:carry-through"),
  pruefen: eintrag("kit:pruefen", "kit:check"),
  laufLaeuft: eintrag("lauf:laeuft", "run:running"),
  laufAbgebrochen: eintrag("lauf:abgebrochen", "run:aborted"),
  laufWartet: eintrag("lauf:wartet", "run:waiting"),
  reviewFertig: eintrag("review:fertig", "review:done"),
  zielPlan: eintrag("ziel:plan", "goal:plan"),
  zielPakete: eintrag("ziel:pakete", "goal:packages"),
  zielUmsetzung: eintrag("ziel:umsetzung", "goal:implementation"),
  zielPushVorbereitet: eintrag("ziel:push-vorbereitet", "goal:push-prepared"),
  night: eintrag("kit:night"),
  nightrun: eintrag("kit:nightrun"),
  planreview1: eintrag("planreview:1"),
  planreview2: eintrag("planreview:2"),
});

/** Die Titel-Praefixe, je Art der deutsche und der englische Name (E4). */
export const PRAEFIXE = Object.freeze({
  fachlich: eintrag("[Fachlich]", "[Requirement]"),
  idee: eintrag("[Idee]", "[Idea]"),
  mensch: eintrag("[Mensch]", "[Human]"),
  plan: eintrag("[Plan]"),
  task: eintrag("[Task]"),
});

// Labels zeichengenau, wie der Bestand sie vergleicht (`labels.includes("kit:klaeren")`).
const LABEL_SACHE = new Map(
  Object.entries(LABELS).flatMap(([sache, { de, en }]) => [[de, sache], [en, sache]])
);

// Praefixe wie FACHLICH_PRAEFIX & Co. in kit/board/dokumente.mjs: am Titelanfang, fuehrender
// Leerraum erlaubt, Gross- und Kleinschreibung gleichgueltig.
const PRAEFIX_ART = new Map(
  Object.entries(PRAEFIXE).flatMap(([art, { de, en }]) => [[de.toLowerCase(), art], [en.toLowerCase(), art]])
);

function nameIn(tabelle, art, schluessel, sprache) {
  const e = Object.hasOwn(tabelle, schluessel) ? tabelle[schluessel] : undefined;
  if (!e) throw new Error(`namen: unbekannte ${art} "${schluessel}"`);
  return SPRACHEN.includes(sprache) ? e[sprache] : e[VORGABE];
}

/** Der Name eines Labels in der Sprache; eine unbekannte Sprache gilt als `de`. */
export function labelName(sache, sprache) {
  return nameIn(LABELS, "Sache", sache, sprache);
}

/** Das Titel-Praefix einer Art in der Sprache; eine unbekannte Sprache gilt als `de`. */
export function praefix(art, sprache) {
  return nameIn(PRAEFIXE, "Art", art, sprache);
}

/** Die Sache hinter einem Labelnamen, gleich in welcher Sprache; sonst `null`. */
export function erkenneLabel(name) {
  return typeof name === "string" ? LABEL_SACHE.get(name) ?? null : null;
}

/** Die Art des Titel-Praefixes am Anfang des Titels, gleich in welcher Sprache; sonst `null`. */
export function erkennePraefix(titel) {
  if (typeof titel !== "string") return null;
  const treffer = /^\s*(\[[^\]]*\])/.exec(titel);
  return treffer ? PRAEFIX_ART.get(treffer[1].toLowerCase()) ?? null : null;
}

/**
 * Die Marker, die der Code aus Kommentaren und Body zurueckliest (Issue #1440, Plan #1420
 * E15), je Sache der deutsche und der englische Name nach der Regel aus E4. Geschrieben wird
 * der Name der Projektsprache, erkannt werden beide; die Leser stellt ein eigenes Paket um.
 * Ein Marker mit veraenderlichem Rest (`## Einarbeitung, Runde 2`, `Plan: Issue #1420`)
 * steht hier nur mit seinem festen Anfang.
 */
export const MARKER = Object.freeze({
  // Laufstand-Kommentar: kit/board/dokumente.mjs, kit/night/laufstand.mjs, kit/night/kette.mjs.
  laufstand: eintrag("## Laufstand", "## Run status"),
  laufId: eintrag("Lauf-ID:", "Run-ID:"),
  stand: eintrag("Stand:", "Updated:"),
  position: eintrag("Position:"),
  protokoll: eintrag("Protokoll:", "Log:"),
  ziel: eintrag("Ziel:", "Goal:"),
  pruefer: eintrag("Prüfer:", "Reviewers:"),
  grenze: eintrag("Grenze:", "Limit:"),
  // Halt- und Vermerk-Kommentare.
  geschuetzteDatei: eintrag("## Geschuetzte Datei", "## Protected file"),
  wartend: eintrag("## Nachtlauf: wartende Sitzung", "## Night run: waiting session"),
  zeitgrenze: eintrag("## Nachtlauf: Zeitgrenze erreicht", "## Night run: time limit reached"),
  festgefahren: eintrag("## Nachtlauf: an einer Pruefung festgefahren", "## Night run: stuck on a check"),
  nachweisMangel: eintrag("Nachtlauf: Nachweis", "Night run: evidence"),
  ketteUngeprueft: eintrag("## Kette nicht gestartet: Pruefung fehlt", "## Chain not started: check missing"),
  ketteZiel: eintrag("## Kette nicht gestartet: unpassende Einstellung", "## Chain not started: unsuitable setting"),
  issuesHalt: eintrag("Kein Eingang für /issues", "No input for /issues"),
  // SYNC: HALT_FOLGESATZ in kit/night/wartend.mjs.
  haltFolgesatz: eintrag(
    "Daraus soll per /fachplan eine fachliche Anforderung entstehen.",
    "A requirement is to be created from this via /requirement."
  ),
  ueberholt: eintrag("Ueberholt durch Plan #", "Superseded by plan #"),
  // Berichte und Review-Kommentare.
  berichtLauf: eintrag("Bericht-Lauf:", "Report-Run:"),
  kitStand: eintrag("Kit-Stand:", "Kit-Revision:"),
  nachtbericht: eintrag("## Nachtbericht, Kette", "## Night report, chain"),
  planReviewRunde: eintrag("## Plan-Review, Runde", "## Plan-Review, Round"),
  fachplanReviewRunde: eintrag("## Fachplan-Review, Runde", "## Requirement-Review, Round"),
  issueReviewRunde: eintrag("## Issue-Review, Runde", "## Issue-Review, Round"),
  einarbeitungRunde: eintrag("## Einarbeitung, Runde", "## Incorporation, Round"),
  // Kopfzeilen in Body und Kontext der Dokumente.
  kontext: eintrag("## Kontext", "## Context"),
  autorModell: eintrag("Autor-Modell:", "Author-Model:"),
  planModell: eintrag("Plan-Modell:", "Plan-Model:"),
  plan: eintrag("Plan:"),
  fachlicheQuelle: eintrag("Fachliche Quelle:", "Requirement:"),
  planEntscheidungen: eintrag("Plan-Entscheidungen:", "Plan-Decisions:"),
  entscheidung: eintrag("Entscheidung:", "Decision:"),
  aufgabenstufe: eintrag("Aufgabenstufe:", "Task-Tier:"),
  empfohlenesModell: eintrag("Empfohlenes Modell:", "Recommended model:"),
  sitzungsumfang: eintrag("Sitzungsumfang:", "Session scope:"),
  vorlage: eintrag("Vorlage:", "Template:"),
  planReview: eintrag("Plan-Review:"),
  fachplanReview: eintrag("Fachplan-Review:", "Requirement-Review:"),
  issueReview: eintrag("Issue-Review:"),
});

// Laengster Name zuerst: `Plan-Review:` darf nicht als `Plan:` gelten, und ein Name, der
// Anfang eines anderen ist, verliert gegen den laengeren.
const MARKER_NAMEN = Object.entries(MARKER)
  .flatMap(([sache, { de, en }]) => [[de.toLowerCase(), sache], [en.toLowerCase(), sache]])
  .sort(([a], [b]) => b.length - a.length);

/** Der Name eines Markers in der Sprache; eine unbekannte Sprache gilt als `de`. */
export function markerName(sache, sprache) {
  return nameIn(MARKER, "Sache", sache, sprache);
}

/**
 * Die Sache des Markers am Anfang der Zeile, gleich in welcher Sprache; sonst `null`.
 * Fuehrender Leerraum ist erlaubt, Gross- und Kleinschreibung gleichgueltig. Endet der Name
 * auf einen Buchstaben, darf keiner folgen: `## Kontextwechsel` ist nicht `## Kontext`.
 */
export function erkenneMarker(zeile) {
  if (typeof zeile !== "string") return null;
  const z = zeile.trimStart().toLowerCase();
  for (const [name, sache] of MARKER_NAMEN) {
    if (!z.startsWith(name)) continue;
    if (/[\p{L}\p{N}]$/u.test(name) && /^[\p{L}\p{N}]/u.test(z.slice(name.length))) continue;
    return sache;
  }
  return null;
}

// --- Texthelfer (Plan #1420 E13) ----------------------------------------------------

let sprache = null;

/**
 * Die Sprache dieses Prozesses: einmal aus `.claude/workflow.config.json` im cwd gelesen,
 * danach fest. Fehlt die Datei oder ist sie nicht lesbar, gilt `de` — ein bestehendes
 * Projekt bleibt deutsch. Gelesen wird roh, ohne `normalisiereConfig`: `projektSprache` kennt
 * beide Namen des einen Felds, und install.mjs laedt dieses Modul als data:-URL, die keinen
 * relativen Import aufloest.
 */
export function prozessSprache() {
  if (sprache === null) {
    let config = {};
    try {
      config = JSON.parse(readFileSync(join(process.cwd(), ".claude", "workflow.config.json"), "utf-8"));
    } catch {
      // keine oder kaputte Config: Vorgabe
    }
    sprache = projektSprache(config);
  }
  return sprache;
}

/**
 * Legt die Sprache des Prozesses fest, etwa wo die Config schon geladen ist; `null` vergisst
 * sie, der naechste Text liest sie neu. Eine unbekannte Sprache wirft.
 */
export function spracheFestlegen(neu) {
  if (neu !== null && !SPRACHEN.includes(neu)) throw new Error(`namen: unbekannte Sprache "${neu}"`);
  sprache = neu;
}

const PLATZHALTER = /\{([A-Za-z_]\w*)\}/g;

/**
 * Der Text zu `schluessel` aus einer Tabelle `{ de: {…}, en: {…} }` in der Sprache des
 * Prozesses, die Platzhalter `{name}` durch `werte` ersetzt. Fehlt der Text in der Sprache,
 * wirft der Helfer — nie still die andere Sprache; ebenso bei einem fehlenden Wert.
 */
export function text(tabelle, schluessel, werte = {}) {
  const s = prozessSprache();
  const vorlage = Object.hasOwn(tabelle?.[s] ?? {}, schluessel) ? tabelle[s][schluessel] : undefined;
  if (typeof vorlage !== "string") throw new Error(`namen: kein Text "${schluessel}" in der Sprache ${s}`);
  return vorlage.replaceAll(PLATZHALTER, (_, name) => {
    if (!Object.hasOwn(werte, name)) throw new Error(`namen: Text "${schluessel}" ohne Wert fuer {${name}}`);
    return String(werte[name]);
  });
}

const platzhalterVon = (vorlage) => [...new Set([...vorlage.matchAll(PLATZHALTER)].map((m) => m[1]))].sort((a, b) => a.localeCompare(b));

/**
 * Die Befunde einer Texttabelle: je Sprache dieselben Schluessel, jeder Wert ein Text, je
 * Schluessel dieselben Platzhalter. Leer, wenn alles passt.
 */
export function pruefeParitaet(tabelle) {
  const befunde = [];
  for (const s of SPRACHEN) {
    if (typeof tabelle?.[s] !== "object" || tabelle[s] === null) befunde.push(`Sprache ${s} fehlt`);
  }
  if (befunde.length > 0) return befunde;
  const schluessel = [...new Set(SPRACHEN.flatMap((s) => Object.keys(tabelle[s])))].sort((a, b) => a.localeCompare(b));
  for (const k of schluessel) {
    const fehlt = SPRACHEN.filter((s) => !Object.hasOwn(tabelle[s], k));
    if (fehlt.length > 0) {
      befunde.push(`"${k}" fehlt in ${fehlt.join(", ")}`);
      continue;
    }
    const keinText = SPRACHEN.filter((s) => typeof tabelle[s][k] !== "string");
    if (keinText.length > 0) {
      befunde.push(`"${k}" ist in ${keinText.join(", ")} kein Text`);
      continue;
    }
    const je = SPRACHEN.map((s) => platzhalterVon(tabelle[s][k]));
    if (je.some((p) => p.join() !== je[0].join())) {
      const liste = SPRACHEN.map((s, i) => s + " {" + je[i].join("}, {") + "}").join(" / ");
      befunde.push(`"${k}" hat abweichende Platzhalter: ${liste}`);
    }
  }
  return befunde;
}
