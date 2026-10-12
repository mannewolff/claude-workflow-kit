/**
 * board/namen.mjs — Namen-Register der Labels und Titel-Praefixe (Issue #1421, Plan #1420
 * E2 bis E4): je Sache ein deutscher und ein englischer Name, die Projektsprache aus der
 * Config und das Erkennen beider Namen. Dazu die zurueckgelesenen Marker in Kommentaren und
 * Body und der Texthelfer, ueber den jedes Modul seine Meldungen in der Projektsprache
 * waehlt (Issue #1440, E13, E15). Zuletzt die frueheren deutschen Befehlsnamen von
 * kit/board.mjs, die nur noch in der Abweisung erscheinen (Issue #1557).
 *
 * Hier und nur hier stehen die Namenspaare. Bis zu diesem Register standen dieselben Labels
 * mehrfach im Code, nur durch SYNC-Kommentare gehalten (`kit:klaeren` dreifach,
 * `kit:geschuetzt` doppelt). Jede Stelle soll ueber das Register beide Namen erkennen und
 * den Namen der Projektsprache schreiben (Plan #1420, Kriterium 4 der fachlichen Quelle
 * #1416); die Umstellung der Nutzer folgt in eigenen Paketen. Seit Issue #1552 (Plan #1548
 * E2) schreibt das Kit Labels und Titel-Praefixe in jedem Projekt englisch.
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

function nameIn(tabelle, art, schluessel, sprache, vorgabe = VORGABE) {
  const e = Object.hasOwn(tabelle, schluessel) ? tabelle[schluessel] : undefined;
  if (!e) throw new Error(`namen: unbekannte ${art} "${schluessel}"`);
  return SPRACHEN.includes(sprache) ? e[sprache] : e[vorgabe];
}

// Labels und Titel-Praefixe schreibt das Kit in jedem Projekt englisch (Issue #1552, Plan
// #1548 E2); erkannt werden weiter beide Namen. Der deutsche Name bleibt nur auf ausdruecklichen
// Wunsch abrufbar, etwa fuer die Erkennung oder fuer Texte, die ihn noch nennen.

/** Der Name eines Labels in der Sprache; ohne oder mit unbekannter Sprache der englische. */
export function labelName(sache, sprache) {
  return nameIn(LABELS, "Sache", sache, sprache, "en");
}

/** Das Titel-Praefix einer Art in der Sprache; ohne oder mit unbekannter Sprache das englische. */
export function praefix(art, sprache) {
  return nameIn(PRAEFIXE, "Art", art, sprache, "en");
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
  // SYNC: HALT_FOLGESATZ in kit/night/wartend.mjs. Der alte Wortlaut mit /fachplan wird
  // weiter erkannt (MARKER_ALTNAMEN).
  haltFolgesatz: eintrag(
    "Daraus soll per /requirement eine fachliche Anforderung entstehen.",
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

/**
 * Fruehere Wortlaute eines Markers, die nur noch erkannt und nie geschrieben werden: Offene
 * Karten tragen sie noch (Issue #1552, Plan #1548 E15).
 */
const MARKER_ALTNAMEN = Object.freeze({
  haltFolgesatz: Object.freeze(["Daraus soll per /fachplan eine fachliche Anforderung entstehen."]),
});

// Laengster Name zuerst: `Plan-Review:` darf nicht als `Plan:` gelten, und ein Name, der
// Anfang eines anderen ist, verliert gegen den laengeren.
const MARKER_NAMEN = [
  ...Object.entries(MARKER).flatMap(([sache, { de, en }]) => [[de.toLowerCase(), sache], [en.toLowerCase(), sache]]),
  ...Object.entries(MARKER_ALTNAMEN).flatMap(([sache, alte]) => alte.map((n) => [n.toLowerCase(), sache])),
].sort(([a], [b]) => b.length - a.length);

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
  return leseMarker(zeile)?.sache ?? null;
}

/**
 * Sache und Rest des Markers am Anfang der Zeile, nach derselben Regel wie `erkenneMarker`:
 * `{ sache, rest }` mit dem Rest hinter dem Namen in der Schreibweise der Zeile, sonst `null`.
 * Die Leser der Module nehmen ihren Wert aus `rest` (Issue #1443).
 */
export function leseMarker(zeile) {
  if (typeof zeile !== "string") return null;
  const roh = zeile.trimStart();
  const z = roh.toLowerCase();
  for (const [name, sache] of MARKER_NAMEN) {
    if (!z.startsWith(name)) continue;
    if (/[\p{L}\p{N}]$/u.test(name) && /^[\p{L}\p{N}]/u.test(z.slice(name.length))) continue;
    return { sache, rest: roh.slice(name.length) };
  }
  return null;
}

/**
 * Die Reste aller Zeilen des Texts, die mit dem Marker `sache` beginnen, in ihrer Folge. Mit
 * `eingerueckt: false` zaehlt nur eine Zeile, deren Marker ganz vorn steht — fuer Leser, die
 * eine eingerueckte Zeile nie als Treffer gelten liessen.
 */
export function markerWerte(text, sache, { eingerueckt = true } = {}) {
  return String(text ?? "").split(/\r\n|\r|\n/)
    .filter((z) => eingerueckt || !/^\s/.test(z))
    .map(leseMarker).filter((m) => m?.sache === sache).map((m) => m.rest);
}

/**
 * Die Formatueberschriften der Dokumente (Issue #1460, Plan #1420 E15): Arbeitspaket, Plan,
 * Fachplan und Abschlussbericht, je Sache der deutsche und der englische Name. Die
 * Abschnittsparser erkennen beide; geschrieben wird, was der Skill der Projektsprache
 * schreibt. Die manuelle Pruefung steht nur mit ihrem festen Anfang hier, der Zusatz
 * `(Mensch, nicht Teil des Session-Abschlusses)` bzw. `(human, not part of the session
 * close)` gehoert nicht zur Erkennung.
 */
export const UEBERSCHRIFTEN = Object.freeze({
  // Arbeitspaket.
  kontext: eintrag("Kontext", "Context"),
  aufgabe: eintrag("Aufgabe", "Task"),
  akzeptanzkriterium: eintrag("Akzeptanzkriterium", "Acceptance criteria"),
  abhaengigkeiten: eintrag("Abhaengigkeiten", "Dependencies"),
  manuellePruefung: eintrag("Manuelle Pruefung", "Manual check"),
  // Plan; `Ziel` teilt er mit dem Fachplan.
  ziel: eintrag("Ziel", "Goal"),
  betroffeneBereiche: eintrag("Betroffene Bereiche", "Affected areas"),
  architektonischeEntscheidungen: eintrag("Architektonische Entscheidungen", "Architectural decisions"),
  geplanteAenderungen: eintrag("Geplante Aenderungen", "Planned changes"),
  offeneFragen: eintrag("Offene Fragen", "Open questions"),
  verifizierung: eintrag("Verifizierung", "Verification"),
  // Fachplan.
  fachlicheKriterien: eintrag("Fachliche Akzeptanzkriterien", "Business acceptance criteria"),
  nichtZiele: eintrag("Nicht-Ziele", "Non-goals"),
  poFragen: eintrag("Offene Fragen an den PO", "Open questions for the PO"),
  // Fachplan und Plan (Issue #1537, Plan #1534 E1).
  vorgeschichte: eintrag("Vorgeschichte", "History"),
  // Abschlussbericht.
  aenderungen: eintrag("Änderungen", "Changes"),
  testsUndChecks: eintrag("Tests und Checks", "Tests and checks"),
  hinweise: eintrag("Hinweise", "Notes"),
  entscheidungen: eintrag("Entscheidungen", "Decisions"),
  ursprungsdokumente: eintrag("Ursprungsdokumente", "Origin documents"),
  standDesVorhabens: eintrag("Stand des Vorhabens", "State of the project"),
});

/** Ueberschriften vergleichbar machen: klein, Umlaute in beiden Schreibweisen, Leerraum einfach. */
export function normUeberschrift(text) {
  return String(text).trim().toLowerCase()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")
    .replaceAll(/\s+/g, " ");
}

// Laengster Name zuerst, wie bei den Markern: `Offene Fragen an den PO` ist nicht `Offene Fragen`.
const UEBERSCHRIFT_NAMEN = Object.entries(UEBERSCHRIFTEN)
  .flatMap(([sache, { de, en }]) => [[normUeberschrift(de), sache], [normUeberschrift(en), sache]])
  .sort(([a], [b]) => b.length - a.length);

/** Der Name einer Formatueberschrift in der Sprache; eine unbekannte Sprache gilt als `de`. */
export function ueberschriftName(sache, sprache) {
  return nameIn(UEBERSCHRIFTEN, "Ueberschrift", sache, sprache);
}

/**
 * Sache und Rest der Formatueberschrift am Anfang des Titels (ohne Rauten), gleich in welcher
 * Sprache: `{ sache, rest }` mit dem normalisierten Rest, sonst `null`. Wie bei den Markern
 * darf auf einen Namen, der auf einen Buchstaben endet, keiner folgen.
 */
export function leseUeberschrift(titel) {
  if (typeof titel !== "string") return null;
  const t = normUeberschrift(titel);
  for (const [name, sache] of UEBERSCHRIFT_NAMEN) {
    if (!t.startsWith(name)) continue;
    if (/^[\p{L}\p{N}-]/u.test(t.slice(name.length))) continue;
    return { sache, rest: t.slice(name.length).trim() };
  }
  return null;
}

/** Die Sache des Titels, wenn er genau eine Formatueberschrift ist, gleich in welcher Sprache; sonst `null`. */
export function erkenneUeberschrift(titel) {
  const m = leseUeberschrift(titel);
  return m && m.rest === "" ? m.sache : null;
}

/**
 * Der Titel, wie die Formgates ihn vergleichen: eine erkannte Formatueberschrift als ihr
 * deutscher Name, normalisiert, jede andere nur normalisiert. So gelten die Gates unter
 * beiden Namen, ohne dass jedes seine Abschnitte zweimal kennt.
 */
export function kanonischeUeberschrift(titel) {
  const sache = erkenneUeberschrift(titel);
  return normUeberschrift(sache ? UEBERSCHRIFTEN[sache].de : titel);
}

/**
 * Ein Pruefer fuer die Kopfzeile der Ueberschrift `sache` auf der Ebene `ebene` (2 fuer
 * `##`), beide Namen: bis zu drei Leerzeichen davor, genau so viele Rauten, der Name allein
 * auf der Zeile. Mit `anfang: true` darf ihm ein Zusatz folgen (der Block der manuellen
 * Pruefung). Ein Objekt mit `test`, weil die Abschnittsleser eine Ueberschrift so pruefen.
 */
export function ueberschriftZeile(sache, ebene = 2, { anfang = false } = {}) {
  if (!Object.hasOwn(UEBERSCHRIFTEN, sache)) throw new Error(`namen: unbekannte Ueberschrift "${sache}"`);
  const kopf = new RegExp(`^ {0,3}#{${ebene}}(?!#)\\s*(.*)$`);
  return Object.freeze({
    test(zeile) {
      const m = kopf.exec(String(zeile));
      if (!m) return false;
      if (!anfang) return erkenneUeberschrift(m[1]) === sache;
      return leseUeberschrift(m[1])?.sache === sache;
    },
  });
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

// --- Altnamen (Plan #1548 E5, E7, E8) -------------------------------------------------

/**
 * Die getippten Auswahlwerte, die ein Verhalten des Kits waehlen (Issue #1555, Plan #1548 E5),
 * je englischer Option interner Schluessel -> englischer Wert: `--art`, `issue run-state
 * --state` und `issue-review roles --stage`. Die internen Schluessel (ARTEN, STAND_ZUSTAENDE,
 * REVIEW_STUFEN, der Config-Schluessel `reviewStufen.fachlich`) bleiben; abgebildet wird am
 * Einstieg. Getippt wird allein der englische Wert.
 */
export const EINGABEWERTE = Object.freeze({
  art: Object.freeze({ fachlich: "requirement", idee: "idea", mensch: "human", plan: "plan", task: "task" }),
  state: Object.freeze({ laeuft: "running", abgebrochen: "aborted", wartet: "waiting", fertig: "done" }),
  stage: Object.freeze({ fachlich: "requirement", plan: "plan", issue: "issue" }),
});

/** Die Paare einer Ebene, deren beide Namen sich unterscheiden. */
const nurAbweichende = (ebene) => Object.freeze(Object.fromEntries(Object.entries(ebene).filter(([de, en]) => de !== en)));

/**
 * Die frueheren deutschen Namen der Achsen, Befehle, Optionen und Auswahlwerte von
 * kit/board.mjs, je Eintrag deutsch -> englisch (Issue #1557, Plan #1548). Seit Version 5
 * nimmt board.mjs nur die englischen an; diese Tabelle dient allein der Meldung, die einen
 * deutschen Namen abweist und den englischen nennt — zum Ausfuehren wird sie nie benutzt
 * (PO-Antwort 2, Kriterium 1). Die Befehle stehen je englischer Achse, die Werte je
 * englischer Option.
 */
export const ALTNAMEN = Object.freeze({
  achsen: Object.freeze({ kontext: "context", sitzung: "session" }),
  befehle: Object.freeze({
    issue: Object.freeze({ melden: "report", stand: "run-state", auftrag: "brief", ursprung: "origin",
      "check-geschuetzt": "check-protected", vorgeschichte: "history", fragen: "questions" }),
    code: Object.freeze({ schutz: "protection" }),
    "issue-review": Object.freeze({ pruefauftrag: "review-brief" }),
    nightrun: Object.freeze({ melden: "report" }),
    session: Object.freeze({ melden: "report" }),
    hook: Object.freeze({ "bash-pruefen": "bash-check" }),
  }),
  // Die Aktionen von `code protection`.
  schutz: Object.freeze({ einrichten: "setup", aussetzen: "suspend", wiederherstellen: "restore",
    nachpruefen: "verify" }),
  optionen: Object.freeze({ teil: "part", zustand: "state", spalte: "column", pfad: "path", zweig: "branch",
    "nur-pfad": "path-only", stufe: "stage", rolle: "role", datei: "file", "material-datei": "material-file",
    auftrag: "brief", ausgabe: "output", protokoll: "transcript", begriffe: "terms", dateien: "files",
    ohne: "without", vergleich: "compare" }),
  werte: Object.freeze(Object.fromEntries(Object.entries(EINGABEWERTE).map(([option, ebene]) => [option, nurAbweichende(ebene)]))),
});

const ALTNAMEN_TEXTE = Object.freeze({
  de: { altname: "unbekannt: '{name}' — englischer Name: '{englisch}'" },
  en: { altname: "unknown: '{name}' — English name: '{englisch}'" },
});

/**
 * Die Meldung zu einem frueheren deutschen Namen in der Projektsprache, etwa
 * "unbekannt: 'melden' — englischer Name: 'report'"; `null`, wenn `name` kein Altname ist.
 * `art` ist `achse`, `befehl` (mit der englischen Achse als `bereich`), `schutz`, `option`
 * (Name ohne `--`, die Meldung nennt ihn mit) oder `wert` (mit der englischen Option als
 * `bereich`).
 */
export function altnameHinweis(art, name, bereich) {
  const ebene = {
    achse: ALTNAMEN.achsen,
    befehl: ALTNAMEN.befehle[bereich],
    schutz: ALTNAMEN.schutz,
    option: ALTNAMEN.optionen,
    wert: ALTNAMEN.werte[bereich],
  }[art];
  if (!ebene || typeof name !== "string" || !Object.hasOwn(ebene, name)) return null;
  const vorn = art === "option" ? "--" : "";
  return text(ALTNAMEN_TEXTE, "altname", { name: vorn + name, englisch: vorn + ebene[name] });
}

/**
 * Der interne Schluessel zum getippten Wert der englischen Option `option` (`art`, `state`,
 * `stage`): ein englischer Wert wird abgebildet, `true` und ein fehlender Wert bleiben, jeder
 * andere — auch der interne Schluessel selbst, wo er nicht der englische Wert ist — ergibt
 * `null` (Issue #1557). Eine Option ohne Auswahlwerte laesst den Wert, wie er ist.
 */
export function internerWert(option, wert) {
  const ebene = Object.hasOwn(EINGABEWERTE, option) ? EINGABEWERTE[option] : null;
  if (ebene === null || typeof wert !== "string") return wert;
  return Object.keys(ebene).find((intern) => ebene[intern] === wert) ?? null;
}
