/**
 * board/namen.mjs — Namen-Register der Labels und Titel-Praefixe (Issue #1421, Plan #1420
 * E2 bis E4): je Sache ein deutscher und ein englischer Name, die Projektsprache aus der
 * Config und das Erkennen beider Namen.
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
