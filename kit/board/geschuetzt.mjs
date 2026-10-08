/**
 * board/geschuetzt.mjs — Geschuetzte Pfade im Board-Werkzeug (Issue #1219, Plan #1199, E17):
 * die Erkennung, ob ein Paket eine Datei nennt, die nur ein Mensch schreiben darf, der
 * Halt-Kommentar samt Freigabe und die Formgates der Stufen, an denen I7 bis I9 haengen.
 *
 * Ein Teil von kit/board.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nie aus dem Einstieg: Der Einstieg laedt die Teile, ein Rueckimport waere
 * ein Zyklus. Der Unterabschnitt der Testhinweise bleibt bis zu seinem eigenen Teil im
 * Einstieg; `escapeRegex`, das beide brauchen, steht darum hier.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { readFileSync } from "node:fs";
import path, { join } from "node:path";
import { homedir } from "node:os";

import { istMensch, zerlegeAbschnitte, CHECK_FORM_ABSCHNITTE } from "./dokumente.mjs";

// ============================================================
// Geschuetzte Pfade (Issue #1041, Plan #987, fachliche Quelle #868)
// ============================================================
//
// Zwei Naechte endeten hart, weil ein Paket eine Datei aendern sollte, die nur ein Mensch
// schreiben darf: Claude Code weist den Schreibzugriff ab, die Session darf den Schutz
// nicht umgehen und laesst ihre Arbeit liegen. Hier und nur hier wird entschieden, ob ein
// Paket einen solchen Pfad beim Namen nennt — Formgates, `issue check-geschuetzt` und das
// Gate des Runners rufen diese Funktionen, statt die Regel ein zweites Mal zu schreiben.
//
// Die Vorgabeliste traegt die Sperre, die Claude Code ueberall fuehrt und die sich nicht
// auslesen laesst: die Team- und die lokalen Einstellungen und das Hook-Verzeichnis (E2).
// Was ein Projekt zusaetzlich sperrt, kommt aus `permissions.deny` dieser beiden Dateien.
// Die Pruefeinstellungen des Kits (`workflow.config.json`) stehen bewusst NICHT darin: Sie
// sind versioniert und unter `permissions.allow` ausdruecklich freigegeben — eine Session
// darf sie schreiben, und ein Gate darauf waere ein Fehlalarm.

const EINSTELLUNGS_DATEIEN = Object.freeze([".claude/settings.json", ".claude/settings.local.json"]);

export const GESCHUETZTE_PFADE = Object.freeze([...EINSTELLUNGS_DATEIEN, ".claude/hooks/"]);

// Die installierte Kopie des Kits (E7): Sie wird nie von Hand geaendert, gemeint ist im Kit
// die Quelle, in einem installierten Projekt ein Kit-Update. Dieselbe Trefferregel (E16);
// das Gate dazu (I9) liest sie, nicht die Erkennung geschuetzter Pfade.
export const KOPIE_PFADE = Object.freeze([".claude/kit/", ".claude/skills/", ".claude/CLAUDE-*.md"]);

// `Edit(…)`/`Write(…)` aus `permissions.deny` — andere Werkzeuge sperren kein Schreiben.
const SCHREIB_REGEL = /^(?:Edit|Write)\(([^()]+)\)$/;

/**
 * Ein Claude-Code-Muster auf die Projektwurzel normalisiert (E16): `//` absolut, `~/` im
 * Home, sonst relativ zur Wurzel — ein fuehrendes `./` oder `/` faellt dabei weg.
 */
function normalisiereSchreibMuster(muster) {
  if (muster.startsWith("//")) return muster.slice(1);
  if (muster.startsWith("~/")) return join(homedir(), muster.slice(2));
  if (muster.startsWith("./")) return muster.slice(2);
  return muster.startsWith("/") ? muster.slice(1) : muster;
}

/** Die Schreibsperren einer Einstellungsdatei; fehlt oder bricht sie, sind es keine. */
function schreibSperren(datei) {
  let einstellungen;
  try {
    einstellungen = JSON.parse(readFileSync(datei, "utf8"));
  } catch {
    return [];
  }
  const deny = einstellungen?.permissions?.deny;
  if (!Array.isArray(deny)) return [];
  return deny.flatMap((regel) => {
    const m = SCHREIB_REGEL.exec(typeof regel === "string" ? regel.trim() : "");
    return m ? [normalisiereSchreibMuster(m[1].trim())] : [];
  });
}

/**
 * Die geschuetzten Pfade unter `wurzel`: die Vorgabeliste, dahinter die Schreibsperren aus
 * Team- und lokalen Einstellungen, ohne Doppel. Eine fehlende oder unlesbare Datei liefert
 * nur die Vorgabeliste und haelt nichts auf.
 */
export function geschuetztePfade(wurzel) {
  const pfade = new Set(GESCHUETZTE_PFADE);
  for (const datei of EINSTELLUNGS_DATEIEN) {
    for (const muster of schreibSperren(join(wurzel, datei))) pfade.add(muster);
  }
  return [...pfade];
}

const GLOB_ZEICHEN = /[*?]/;
const GLOB_TEIL = /\*\*\/|\*\*|\*|\?/g;

/**
 * Ein Glob als verankerter Ausdruck: `*` und `?` bleiben im Segment, `**` geht ueber
 * Segmentgrenzen, und `**` samt folgendem Trenner darf ganz verschwinden. Ein Muster ohne
 * Schraegstrich gilt wie bei `.gitignore`, nach dessen Regeln Claude Code liest, in jeder Tiefe.
 */
function globAlsAusdruck(muster) {
  const teile = { "**/": "(?:.*/)?", "**": ".*", "*": "[^/]*", "?": "[^/]" };
  let quelle = "";
  let letzte = 0;
  for (const m of muster.matchAll(GLOB_TEIL)) {
    quelle += escapeRegex(muster.slice(letzte, m.index)) + teile[m[0]];
    letzte = m.index + m[0].length;
  }
  quelle += escapeRegex(muster.slice(letzte));
  return new RegExp(`^${muster.includes("/") ? "" : "(?:.*/)?"}${quelle}$`);
}

/**
 * Trifft ein Pfad-Token einen Eintrag der Liste (E16)? Bei Gleichheit; bei einem Eintrag mit
 * Endung `/` auch das Verzeichnis selbst und alles darunter; bei einem Glob nach dessen Regeln.
 * Ein fuehrendes `./` am Token zaehlt nicht.
 */
export function trifftGeschuetzt(token, eintrag) {
  const pfad = String(token).startsWith("./") ? String(token).slice(2) : String(token);
  const verzeichnis = eintrag.endsWith("/");
  if (GLOB_ZEICHEN.test(eintrag)) return globAlsAusdruck(verzeichnis ? `${eintrag}**` : eintrag).test(pfad);
  if (!verzeichnis) return pfad === eintrag;
  return pfad === eintrag.slice(0, -1) || pfad.startsWith(eintrag);
}

const BACKTICK_LAUF = /`+/g;

// Die Kennzeichnung einer blossen Erwaehnung (Issue #1179): unmittelbar hinter dem Span.
const NUR_GENANNT = /^ \(nur genannt\)/;

/**
 * Die Pfad-Token der Zeilen (E3): der Inhalt jedes Backtick-Spans ohne Leerraum, je mit der
 * Zeile, in der er steht. Gepaart wird wie in Markdown — ein Span endet am naechsten Lauf
 * gleicher Laenge, ein Lauf ohne Partner ist Text. Codebloecke gibt es hier nicht mehr: Die
 * Zeilen kommen aus `zerlegeAbschnitte`, `fenceLauf` bleibt die einzige Fence-Auslegung.
 * `genannt` ist gesetzt, wenn unmittelbar hinter dem Span ` (nur genannt)` steht: Der Autor
 * erwaehnt den Pfad, das Paket schreibt ihn nicht (Issue #1179).
 */
export function pfadTokens(zeilen) {
  const tokens = [];
  for (const zeile of zeilen) {
    const laeufe = [...zeile.matchAll(BACKTICK_LAUF)];
    let i = 0;
    while (i < laeufe.length) {
      const auf = laeufe[i];
      const zu = laeufe.findIndex((l, j) => j > i && l[0].length === auf[0].length);
      if (zu === -1) {
        i += 1;
        continue;
      }
      const inhalt = zeile.slice(auf.index + auf[0].length, laeufe[zu].index);
      const genannt = NUR_GENANNT.test(zeile.slice(laeufe[zu].index + laeufe[zu][0].length));
      if (inhalt !== "" && !/\s/.test(inhalt)) tokens.push({ token: inhalt, zeile, genannt });
      i = zu + 1;
    }
  }
  return tokens;
}

/**
 * Das Token, wie es steht, absolut und — liegt es unter der Wurzel — relativ zu ihr, mit `/`
 * geschrieben wie die Sperrliste. Die relative Form entsteht ueber `relative` des Pfadmoduls
 * (Issue #1124) statt ueber einen Vergleich auf `${basis}/`, der vom Trennzeichen des
 * Pfadmoduls abhinge. `pfad` ist fuer Tests austauschbar.
 */
export function tokenFormen(token, wurzel, pfad = path) {
  const basis = pfad.resolve(wurzel);
  const absolut = token.startsWith("~/") ? pfad.join(homedir(), token.slice(2)) : pfad.resolve(basis, token);
  const formen = [token, absolut];
  const rel = pfad.relative(basis, absolut);
  if (rel && !rel.startsWith("..") && !pfad.isAbsolute(rel)) formen.push(rel.split(pfad.sep).join("/"));
  return formen;
}

// Gebaut wird, was in der Aufgabe steht; geprueft, was im Kriterium steht (E4). Der Kontext
// erzaehlt die Vorgeschichte und zitiert Pfade, die das Paket gerade nicht aendert.
const GESCHUETZT_ABSCHNITTE = new Set(["aufgabe", "akzeptanzkriterium"]);

/**
 * Die geschuetzten Pfade, die ein Paket in `## Aufgabe` und `## Akzeptanzkriterium` beim
 * Namen nennt, gegen `geschuetztePfade(wurzel)`. Je Treffer der Pfad und die woertliche Zeile
 * (E17); derselbe Pfad in derselben Zeile zaehlt einmal. Ein absolut genanntes Token unter
 * der Wurzel wird auch relativ verglichen und umgekehrt, damit relative wie absolute Sperren
 * greifen. Ein als ` (nur genannt)` gekennzeichneter Pfad zaehlt an dieser Stelle nicht
 * (Issue #1179). Ein `[Mensch]`-Titel liefert immer eine leere Liste (E8): Seine Aufgabe liegt
 * ausserhalb des Repositories und ist genau die Handlung, die der Mensch vornehmen soll.
 */
export function geschuetzteTreffer(body, title, wurzel) {
  if (istMensch(title)) return [];
  const zeilen = zerlegeAbschnitte(body).abschnitte
    .filter((a) => GESCHUETZT_ABSCHNITTE.has(a.titel))
    .flatMap((a) => a.zeilen);
  return listenTreffer(zeilen, geschuetztePfade(wurzel), wurzel, { ohneGenannt: true });
}

// Halt-Kommentar und Freigabe (Issue #1045, Plan #987, E5, E11, E17). Der Text ist
// Schreib- und Leseformat zugleich: Das Gate liest beim naechsten Anlauf aus genau diesem
// Kommentar zurueck, welche Pfade der Mensch freigegeben hat. Darum baut ihn nur
// `geschuetztKommentar`, und `kit/night.mjs` prueft seine eigenen Konstanten gegen diese.

export const GESCHUETZT_ANKER = "## Geschuetzte Datei";
export const GESCHUETZT_LABEL = "kit:geschuetzt";
export const GESCHUETZT_LABEL_GESETZT = `Label ${GESCHUETZT_LABEL} gesetzt`;
export const GESCHUETZT_LABEL_NICHT_GESETZT = `Label ${GESCHUETZT_LABEL} nicht gesetzt`;
// Die zitierte Zeile eines Pfads, den der Schutz beim Schreiben abwies (Issue #1053, E13):
// Die Aufgabe nennt ihn gerade nicht, es gibt keine Zeile aus dem Paket zu zitieren.
export const GESCHUETZT_ABGEWIESEN = "beim Schreiben abgewiesen";

/**
 * Die beim Schreiben abgewiesenen Pfade, die geschuetzt sind, als Treffer mit der Zeile
 * `GESCHUETZT_ABGEWIESEN` — fuer den Halt-Kommentar des Rueckfalls, wenn die Aufgabe den
 * Pfad nicht nennt. Ein fremder Pfad ist kein Treffer.
 */
export function abgewieseneTreffer(pfade, wurzel) {
  const liste = geschuetztePfade(wurzel);
  return [...new Set(pfade)]
    .filter((pfad) => liste.some((eintrag) => tokenFormen(pfad, wurzel).some((f) => trifftGeschuetzt(f, eintrag))))
    .map((pfad) => ({ pfad, zeile: GESCHUETZT_ABGEWIESEN }));
}

/**
 * Der Pfad einer Listenzeile `- <lauf><pfad><lauf>` mit genau einem Backtick-Pfad, sonst
 * null. Die zitierten Zeilen darunter beginnen mit `>` und zaehlen darum nie als genannt,
 * auch wenn sie selbst Pfade tragen.
 */
function listenPfad(zeile) {
  if (!zeile.startsWith("- `")) return null;
  const rest = zeile.slice(2);
  const lauf = /^`+/.exec(rest)[0];
  const ende = rest.length - lauf.length;
  if (ende <= lauf.length || !rest.endsWith(lauf) || rest[ende - 1] === "`") return null;
  return rest.slice(lauf.length, ende);
}

/** Ein Pfad in einem Backtick-Lauf, der laenger ist als jeder Lauf im Pfad selbst. */
function inBackticks(pfad) {
  const laengster = Math.max(0, ...[...pfad.matchAll(BACKTICK_LAUF)].map((m) => m[0].length));
  const lauf = "`".repeat(laengster + 1);
  return `${lauf}${pfad}${lauf}`;
}

/**
 * Der Halt-Kommentar nach E17 ohne die Label-Zeile aus E11: unter dem Anker je getroffenem
 * Pfad eine Listenzeile mit genau einem Backtick-Pfad, darunter die Zeilen aus Aufgabe und
 * Akzeptanzkriterium, in denen er steht, woertlich als Zitat.
 */
export function geschuetztKommentar(treffer) {
  const jePfad = new Map();
  for (const { pfad, zeile } of treffer) {
    if (!jePfad.has(pfad)) jePfad.set(pfad, []);
    jePfad.get(pfad).push(zeile);
  }
  const liste = [...jePfad].flatMap(([pfad, zeilen]) => [`- ${inBackticks(pfad)}`, ...zeilen.map((z) => `  > ${z}`)]);
  return [
    GESCHUETZT_ANKER,
    "",
    `Dieses Paket nennt Dateien, die nur ein Mensch schreiben darf — eine Session darf sie nicht aendern und den Schutz nicht umgehen. Ein Mensch nimmt die Aenderung, die die zitierten Zeilen verlangen, selbst vor und nimmt danach das Label \`${GESCHUETZT_LABEL}\` ab; beim naechsten Anlauf laeuft das Paket dann durch, solange es keine weitere geschuetzte Datei nennt.`,
    "",
    ...liste,
  ].join("\n");
}

/** Die Pfade der Listenzeilen eines Halt-Kommentars, oder null, wenn er nicht freigeben kann. */
function freigegebenePfade(body) {
  const zeilen = String(body ?? "").replaceAll("\r", "").split("\n").map((z) => z.trimEnd());
  if (!zeilen.includes(GESCHUETZT_ANKER) || !zeilen.includes(GESCHUETZT_LABEL_GESETZT)) return null;
  if (zeilen.includes(GESCHUETZT_LABEL_NICHT_GESETZT)) return null;
  return new Set(zeilen.map(listenPfad).filter((p) => p !== null));
}

/**
 * Ist das Paket nach E5 freigegeben? Nur wenn das Label nicht (mehr) haengt und ein Kommentar
 * mit dem Anker die Zeile `Label kit:geschuetzt gesetzt` traegt und jeden aktuellen Treffer
 * in seiner Backtick-Liste nennt. `Label kit:geschuetzt nicht gesetzt` gibt nie frei — dort
 * fehlt das Label, weil das Setzen scheiterte, nicht weil ein Mensch es abnahm. Ohne Treffer
 * gibt es nichts freizugeben: `false`.
 */
export function geschuetztFreigabe(treffer, kommentare, labels) {
  if (treffer.length === 0 || labels.includes(GESCHUETZT_LABEL)) return false;
  return kommentare.some((k) => {
    const pfade = freigegebenePfade(k.body);
    return pfade !== null && treffer.every((t) => pfade.has(t.pfad));
  });
}

/**
 * Die Pfad-Token der Zeilen, die einen Eintrag der Liste treffen, je Pfad und Zeile einmal.
 * Mit `ohneGenannt` zaehlt ein als ` (nur genannt)` gekennzeichnetes Token nicht.
 */
function listenTreffer(zeilen, liste, wurzel, { ohneGenannt = false } = {}) {
  const treffer = [];
  const gesehen = new Set();
  for (const { token, zeile, genannt } of pfadTokens(zeilen)) {
    if (ohneGenannt && genannt) continue;
    const formen = tokenFormen(token, wurzel);
    if (!liste.some((eintrag) => formen.some((f) => trifftGeschuetzt(f, eintrag)))) continue;
    const schluessel = `${token}\n${zeile}`;
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    treffer.push({ pfad: token, zeile });
  }
  return treffer;
}

function ersteNichtLeere(zeilen) {
  return zeilen.map((z) => z.trim()).find((z) => z !== "") ?? null;
}

function istLeer(zeilen) {
  return ersteNichtLeere(zeilen) === null;
}

/** `Autor-Modell: <wert>` (bzw. eine andere Kennzeichnungszeile) mit nicht leerem Wert. */
function hatKennzeichnung(zeilen, name) {
  const muster = new RegExp(String.raw`^${name}:[ \t]*(\S.*)?$`);
  return zeilen.some((z) => {
    const m = muster.exec(z.trim());
    return Boolean(m?.[1] && m[1].trim() !== "");
  });
}

/**
 * Pflichtabschnitte je genau einmal und in dieser Reihenfolge. Liefert die
 * Meldungen; leer heisst erfuellt. Andere Abschnitte werden hier nicht bewertet.
 */
function pruefeReihenfolge(abschnitte, erwartet) {
  const meldungen = [];
  let letzte = -1;
  for (const name of erwartet) {
    const stellen = abschnitte.map((a, i) => (a.titel === name ? i : -1)).filter((i) => i >= 0);
    if (stellen.length === 0) { meldungen.push(`Abschnitt '## ${name}' fehlt`); continue; }
    if (stellen.length > 1) meldungen.push(`Abschnitt '## ${name}' steht ${stellen.length}-mal`);
    if (stellen[0] < letzte) meldungen.push(`Abschnitt '## ${name}' steht nicht in der vorgeschriebenen Reihenfolge`);
    letzte = Math.max(letzte, stellen[0]);
  }
  return meldungen;
}

/** Zeilen ausserhalb von Codebloecken, die mit einem der Praefixe beginnen. */
function zeilenMitPraefix(zeilen, muster) {
  return zeilen.filter((z) => muster.test(z.trim()));
}

/** Meldungen fuer die Marker-Zeile, die auf dieser Stufe nicht stehen darf (F11, P12). */
function markerVerstoesse(zeilen, gate, richtigerMarker) {
  return zeilenMitPraefix(zeilen, /^Issue-Review:/i)
    .map((z) => ({ gate, meldung: `'${z.trim()}' — der Marker dieser Stufe heisst '${richtigerMarker}'` }));
}

export function pruefeFachlich(abschnitte, alleZeilen) {
  const erwartet = CHECK_FORM_ABSCHNITTE.fachlich;
  const finde = (name) => abschnitte.find((a) => a.titel === name);
  const verstoesse = pruefeReihenfolge(abschnitte, erwartet).map((meldung) => ({ gate: "F1", meldung }));
  const ziel = finde("ziel");
  if (!ziel || !hatKennzeichnung(ziel.zeilen, "Autor-Modell")) {
    verstoesse.push({ gate: "F2", meldung: "'Autor-Modell:' steht nicht mit Wert im Abschnitt '## Ziel'" });
  }
  for (const name of ["ziel", "fachliche akzeptanzkriterien", "nicht-ziele"]) {
    const a = finde(name);
    if (a && istLeer(a.zeilen)) verstoesse.push({ gate: "F6", meldung: `Abschnitt '## ${name}' ist leer` });
  }
  if (!finde("offene fragen an den po")) {
    verstoesse.push({ gate: "F7", meldung: "Abschnitt '## Offene Fragen an den PO' fehlt" });
  }
  for (const z of zeilenMitPraefix(alleZeilen, /^(Fachliche Quelle|Plan):/)) {
    verstoesse.push({ gate: "F9", meldung: `Herkunftszeile an der Wurzel: '${z.trim()}'` });
  }
  return [...verstoesse, ...markerVerstoesse(alleZeilen, "F11", "Fachplan-Review:")];
}

/** P6 fuer einen Abschnitt: nicht leer; `- Keine.` nur wo erlaubt und nur als erste Zeile. */
function pruefeP6(name, zeilen) {
  const inhalt = zeilen.map((z) => z.trim()).filter((z) => z !== "");
  if (inhalt.length === 0) return `Abschnitt '## ${name}' ist leer`;
  const keineErlaubt = name === "architektonische entscheidungen" || name === "offene fragen";
  const hatKeine = inhalt.some((z) => z.startsWith("- Keine."));
  if (!hatKeine) return null;
  if (!keineErlaubt) return `'- Keine.' ist in '## ${name}' nicht erlaubt`;
  const nurKeine = inhalt.every((z, i) => (i === 0 ? z.startsWith("- Keine.") : !z.startsWith("- Keine.")));
  return nurKeine ? null : `'- Keine.' in '## ${name}' muss die erste Zeile sein und darf keine weiteren Eintraege haben`;
}

export function pruefePlan(kopf, abschnitte, alleZeilen) {
  const erwartet = CHECK_FORM_ABSCHNITTE.plan;
  const verstoesse = pruefeReihenfolge(abschnitte, erwartet).map((meldung) => ({ gate: "P1", meldung }));
  for (const a of abschnitte) {
    if (!erwartet.includes(a.titel)) {
      verstoesse.push({ gate: "P2", meldung: `zusaetzliche Ueberschrift '## ${a.titel}' — nur ### ist zwischen den sechs Abschnitten erlaubt` });
    }
  }
  if (!hatKennzeichnung(kopf, "Plan-Modell")) {
    verstoesse.push({ gate: "P3", meldung: "'Plan-Modell:' steht nicht mit Wert im Kopf vor '## Ziel'" });
  }
  for (const a of abschnitte.filter((x) => erwartet.includes(x.titel))) {
    const meldung = pruefeP6(a.titel, a.zeilen);
    if (meldung) verstoesse.push({ gate: "P6", meldung });
  }
  return [...verstoesse, ...markerVerstoesse(alleZeilen, "P12", "Plan-Review:")];
}

/** I1 ueber die Reihenfolge hinaus: Abhaengigkeiten zuletzt. */
function pruefeI1Lage(abschnitte) {
  const meldungen = [];
  const abh = abschnitte.findIndex((a) => a.titel === "abhaengigkeiten");
  if (abh >= 0 && abh !== abschnitte.length - 1) meldungen.push("'## Abhaengigkeiten' ist nicht der letzte Abschnitt");
  return meldungen;
}

/** I3 und I4 am Abhaengigkeiten-Abschnitt. */
function pruefeAbhaengigkeiten(zeilen) {
  const verstoesse = [];
  const erste = ersteNichtLeere(zeilen);
  if (erste === null) {
    verstoesse.push({ gate: "I3", meldung: "'## Abhaengigkeiten' ist leer — 'Keine.' oder 'Issue #N'" });
  } else if (!erste.startsWith("Keine.") && !zeilen.some((z) => /#\d+/.test(z))) {
    verstoesse.push({ gate: "I3", meldung: "'## Abhaengigkeiten' nennt weder 'Keine.' noch eine #N-Referenz — der Nacht-Runner liest nur #N" });
  }
  for (const z of zeilenMitPraefix(zeilen, /^(Fachliche Quelle|Plan):/)) {
    verstoesse.push({ gate: "I4", meldung: `'${z.trim()}' gehoert in '## Kontext', nicht in die Abhaengigkeiten — der Runner laese sie als Abhaengigkeit` });
  }
  return verstoesse;
}

// Die Vorlage-Zeile im Kontext (Issue #683): `Vorlage: <Pfad> — verbindlich | Anregung`.
const VORLAGE_VERBINDLICH = /^Vorlage:[^\S\n]*\S.*[—–-][^\S\n]*verbindlich[^\S\n]*$/i;

/**
 * I5: Eine verbindliche Vorlage verlangt die Abnahme per Bildschirmfoto im Akzeptanzkriterium
 * (Issue #683). Ohne Pruefung verdunstet die Vorlage zwischen Plan und Paket — alle Checks
 * gruen, und die Ansicht sieht aus wie vorher. Der Block unter dem Kriterium zaehlt mit.
 */
function pruefeVorlage(kontext, akzeptanz) {
  if (!kontext?.zeilen.some((z) => VORLAGE_VERBINDLICH.test(z.trim()))) return [];
  if (akzeptanz?.zeilen.some((z) => /bildschirmfoto/i.test(z))) return [];
  return [{ gate: "I5", meldung: "'Vorlage: … — verbindlich' im Kontext, aber '## Akzeptanzkriterium' nennt keine Abnahme per Bildschirmfoto" }];
}

// Ein Dateipfad unter den Pfad-Token (E7): mit Schraegstrich oder mit Dateiendung. Ein Label
// wie `kit:klaeren` oder eine Konstante wie `KOPIE_PFADE` nennt keine Datei.
const DATEIPFAD = /(?:\/)|(?:\.[a-z0-9]+$)/;

const KOPIE_MELDUNG = "Die installierte Kopie unter `.claude/kit/`/`.claude/skills/` wird nie von Hand geändert; "
  + "im Kit ist die Quelle unter `kit/`/`skills/` gemeint, in einem installierten Projekt ein Kit-Update.";

/**
 * I7 bis I9 (Issue #1044, Plan #987, E7): Ein Paket, das eine geschuetzte Datei aendern muss,
 * faellt beim Schneiden auf, nicht erst nachts an der abgewiesenen Schreibanfrage.
 *
 * I7 — `## Aufgabe` nennt mindestens einen Dateipfad als Backtick-Token; ohne ihn findet die
 * Erkennung nichts. I8 — ein Token aus Aufgabe oder Akzeptanzkriterium ist geschuetzt
 * (`geschuetzteTreffer`); die Aenderung gehoert als `[Mensch]`-Karte heraus. Ein als
 * ` (nur genannt)` gekennzeichnetes Token zaehlt fuer I7 und I8 nicht (Issue #1179). I9 — ein Token
 * nur aus `## Aufgabe` liegt in der installierten Kopie: Das Kriterium darf sie aufrufen
 * (`node .claude/kit/checks.mjs run`), bauen soll das Paket an der Quelle.
 *
 * Ein `[Mensch]`-Paket besteht alle drei (E8): Seine Aufgabe liegt ausserhalb des
 * Repositories, und es ist genau die Karte, die I8 verlangt.
 */
function pruefeGeschuetzt(abschnitte, title, wurzel) {
  if (istMensch(title)) return [];
  const verstoesse = [];
  const aufgabe = abschnitte.find((a) => a.titel === "aufgabe")?.zeilen ?? [];
  if (!pfadTokens(aufgabe).some(({ token, genannt }) => !genannt && DATEIPFAD.test(token))) {
    verstoesse.push({ gate: "I7", meldung: "'## Aufgabe' nennt keine Datei als Backtick-Pfad (z. B. `kit/board.mjs`) — ohne genannte Datei erkennt das Kit keine geschuetzte" });
  }
  const zeilen = abschnitte.filter((a) => GESCHUETZT_ABSCHNITTE.has(a.titel)).flatMap((a) => a.zeilen);
  for (const { pfad, zeile } of listenTreffer(zeilen, geschuetztePfade(wurzel), wurzel, { ohneGenannt: true })) {
    verstoesse.push({
      gate: "I8",
      meldung: `'${pfad}' ist geschuetzt, nur ein Mensch darf die Datei schreiben (Zeile: '${zeile.trim()}') — die Aenderung gehoert als eigene [Mensch]-Karte heraus, dieses Paket nennt die Datei dann nicht mehr`,
    });
  }
  for (const { pfad, zeile } of listenTreffer(aufgabe, KOPIE_PFADE, wurzel)) {
    verstoesse.push({ gate: "I9", meldung: `'${pfad}' in '## Aufgabe' (Zeile: '${zeile.trim()}') — ${KOPIE_MELDUNG}` });
  }
  return verstoesse;
}

/**
 * Die Kommandos, die eine Guetemessung starten: `mutationCommand`, das `cmd` des
 * `buildChecks`-Eintrags mit `guete`-Block und die Liste `guetekommandos`, alle drei
 * aus der Konfiguration des Projekts.
 *
 * Bewusst keine eingebaute Namensliste (`stryker`, `pitest`, …): Die veraltet und trifft
 * fremde Werkzeuge nicht, die Konfiguration weiss es genau. Ein Projekt ohne alle drei
 * Felder liefert eine leere Liste — dort weist I6 nichts ab.
 *
 * `guetekommandos` ist der Weg fuer einen Treiber, den die Config noch nicht als Pruefung
 * fuehren kann, weil ihn erst ein kommendes Paket baut (Issue #942): Das Projekt nennt sein
 * Kommando-Praefix, und I6 greift schon, bevor der Treiber existiert.
 */
function guetekommandos(config) {
  const checks = Array.isArray(config?.buildChecks) ? config.buildChecks : [];
  const ausChecks = checks.filter((c) => c && typeof c === "object" && c.guete).map((c) => c.cmd);
  const benannt = Array.isArray(config?.guetekommandos) ? config.guetekommandos : [];
  return [config?.mutationCommand, ...ausChecks, ...benannt]
    .map((cmd) => (typeof cmd === "string" ? cmd.trim().replaceAll(/\s+/g, " ") : ""))
    .filter((cmd) => cmd !== "");
}

// Der Anker des Blocks, der den Session-Abschluss nicht blockiert (Issue #215).
// `###` ist keine Abschnittsgrenze, der Block steht also in den Zeilen des
// Akzeptanzkriteriums — I6 liest nur, was davor steht.
const MANUELLE_PRUEFUNG_ZEILE = /^###[ \t]+manuelle[ \t]+pr(ü|ue)fung/i;

// Eine Entscheidungszeile im Kontext, die die Guetemess-Konvention aufhebt: Sie handelt
// von einem Vollauf oder einer Guetemessung und beantwortet das mit `Gewaehlt: ja`.
const ENTSCHEIDUNG_ZEILE = /^Entscheidung:/;
const GUETE_BEZUG = /vollauf|g(ü|ue)temessung|mutationspruefung|mutationspr(ü|ue)fung/i;

// Die Antwort ist das erste Wort nach dem **ersten** `Gewaehlt:` der Zeile — nicht irgendein
// `Gewaehlt: ja` im Text. Ein Paket, das diese Regel selbst baut, zitiert den Wortlaut naemlich
// in seinem eigenen Kontext, und die Regel wies sich prompt selbst ab.
const GEWAEHLT_ANTWORT = /gew(ä|ae)hlt:[ \t]*(\S+)/i;

/** Beantwortet die Entscheidungszeile ihre Frage mit `ja`? */
function mitJaEntschieden(zeile) {
  const treffer = GEWAEHLT_ANTWORT.exec(zeile);
  return treffer !== null && /^ja\b/i.test(treffer[2]);
}

/** Die Zeilen des Akzeptanzkriteriums bis zum Block `### Manuelle Pruefung`. */
function maschinelleKriterien(zeilen) {
  const ab = zeilen.findIndex((z) => MANUELLE_PRUEFUNG_ZEILE.test(z.trim()));
  return ab === -1 ? zeilen : zeilen.slice(0, ab);
}

/**
 * I6: Das Akzeptanzkriterium ruft keine Guetemessung auf (Issue #901), und keine
 * Entscheidung im Kontext hebt diese Konvention auf (Issue #942).
 *
 * Eine Mutationspruefung laeuft einmal je Veroeffentlichung an ihrer Stufe, nicht einmal
 * je Paket. Als Zeile in der Karte kostet sie die Zeit, die dem Paket fehlt: Ein Vollauf
 * hat eine Nacht-Runde exakt ins Rundenzeitlimit gefahren, samt verlorener Schlussmeldung.
 *
 * Die zweite Haelfte faengt den Fall, in dem der Planer die Regel selbst aushebelt — in
 * kanban-kit #1215 stand die Ausnahme als `Entscheidung:`-Zeile im Kontext, und der Code
 * des Pakets war fertig, als die Runde an den drei Vollaeufen starb.
 *
 * Der Block `### Manuelle Pruefung` zaehlt nicht mit: Dort gehoert der Nachweis hin, dass
 * ein neuer Treiber wirklich durchlaeuft, denn er blockiert den Abschluss nicht.
 */
function pruefeGuetemessung(akzeptanz, kontext, config) {
  const verstoesse = [];
  if (akzeptanz) {
    const text = maschinelleKriterien(akzeptanz.zeilen).join(" ").replaceAll(/\s+/g, " ");
    for (const cmd of guetekommandos(config).filter((c) => text.includes(c))) {
      verstoesse.push({
        gate: "I6",
        meldung: `'## Akzeptanzkriterium' ruft die Guetemessung '${cmd}' auf — sie gehoert als buildChecks-Eintrag mit 'stufe: push' einmal an die Veroeffentlichung, nicht einmal in jedes Paket`,
      });
    }
  }
  for (const zeile of zeilenMitPraefix(kontext?.zeilen ?? [], ENTSCHEIDUNG_ZEILE)) {
    const z = zeile.trim();
    if (!GUETE_BEZUG.test(z) || !mitJaEntschieden(z)) continue;
    verstoesse.push({
      gate: "I6",
      meldung: `'${z}' hebt die Guetemess-Konvention auf — sie gilt ohne Ausnahme, auch fuer ein Paket, das den Mess-Treiber selbst baut. Dass ein Vollauf durchlaeuft, steht unter '### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)'`,
    });
  }
  return verstoesse;
}

export function pruefeIssue(abschnitte, config, title, wurzel) {
  const finde = (name) => abschnitte.find((a) => a.titel === name);
  const verstoesse = [...pruefeReihenfolge(abschnitte, CHECK_FORM_ABSCHNITTE.issue), ...pruefeI1Lage(abschnitte)]
    .map((meldung) => ({ gate: "I1", meldung }));
  const kontext = finde("kontext");
  if (!kontext || !hatKennzeichnung(kontext.zeilen, "Autor-Modell")) {
    verstoesse.push({ gate: "I2", meldung: "'Autor-Modell:' steht nicht mit Wert im Abschnitt '## Kontext'" });
  }
  verstoesse.push(
    ...pruefeVorlage(kontext, finde("akzeptanzkriterium")),
    ...pruefeGuetemessung(finde("akzeptanzkriterium"), kontext, config),
    ...pruefeGeschuetzt(abschnitte, title, wurzel),
  );
  const abh = finde("abhaengigkeiten");
  return abh ? [...verstoesse, ...pruefeAbhaengigkeiten(abh.zeilen)] : verstoesse;
}


/** Ein Text woertlich als Teil eines regulaeren Ausdrucks. */
export function escapeRegex(text) {
  return String(text).replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
