/**
 * night/abhaengigkeiten.mjs — die Abhaengigkeiten des Nacht-Runners (Issue #1227, Plan #1199,
 * E17): Lesung des Abschnitts `## Abhaengigkeiten`, der Lauf-Cache der Karten, die Kreis-Suche,
 * die erfuellten Abhaengigkeiten und der Befund samt Block und Probelauf-Zeilen.
 *
 * Ein Teil von kit/night.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nur aus den Grundlagen und dem Board-Teil dokumente, nie aus dem Einstieg:
 * Der Einstieg laedt die Teile, ein Rueckimport waere ein Zyklus.
 *
 * Mitgezogen, obwohl E17 sie nicht nennt: `abschnittLesen` mit den Ueberschriften der
 * Stopp-Fragen-Pruefung (sie standen im Abschnitt und teilen die Fence-Regel mit
 * `parseDeps`) und `leseKarte`, die Karte ohne harten Stopp — der Lauf-Cache liest ueber sie,
 * und die Kette nimmt sie von hier.
 *
 * Das Board erreicht der Teil ueber `board` und `boardRoh`; beide lassen sich ueber
 * `abhaengigkeitenAbhaengigkeiten` einsetzen (Plan #1199, E6). So pruefen die Tests den
 * Befund im selben Prozess, ohne Kindprozess.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { NACHBAR_DIR, NACHBAR_BOARD, board, boardRoh } from "./grundlagen.mjs";

// Fence-Regel, Praefixe und die Lesung mit Herkunft kommen aus dem Board-Teil dokumente,
// der sie fuehrt (Issue #1218). Abgefangen wie im Einstieg: Fehlt der Teil, wirft jede
// Funktion erst, wenn jemand sie braucht — ein stilles Ergebnis liesse ein Plandokument als
// Arbeitspaket durch oder den Befund ohne Herkunft stehen. Der Pfad ist nicht literal,
// deshalb nennt die Gruppe dieses Teils den Bereich board-dokumente von Hand (E3).
const dokumenteFehlt = (was) => () => {
  throw new Error(`board/dokumente.mjs fehlt neben night.mjs (${NACHBAR_BOARD}) — ${was} ist nicht verfuegbar.`);
};
const {
  fenceLauf,
  istFachlich: isFachlich,
  istPlan: isPlan,
  istIdee: isIdee,
  abhaengigkeitenMitHerkunft,
} = await import(pathToFileURL(join(NACHBAR_DIR, "board", "dokumente.mjs")).href).catch(() => ({
  fenceLauf: dokumenteFehlt("die Fence-Regel"),
  istFachlich: dokumenteFehlt("das Praefix [Fachlich]"),
  istPlan: dokumenteFehlt("das Praefix [Plan]"),
  istIdee: dokumenteFehlt("das Praefix [Idee]"),
  abhaengigkeitenMitHerkunft: dokumenteFehlt("die Herkunft der Abhaengigkeiten"),
}));

// --- Abhaengigkeiten nach aussen (Plan #1199, E6) ---

const VORGABEN = Object.freeze({ board, boardRoh });
const abh = { ...VORGABEN };

/**
 * Setzt Abhaengigkeiten des Teils ein; nicht genannte behalten ihren Wert, ohne Argument
 * gelten wieder alle Vorgaben. Jeder Aufruf leert den Lauf-Cache der Karten, damit ein Test
 * nicht die Karten des vorigen liest. Nur fuer Tests — der Runner arbeitet mit den Vorgaben.
 */
export function abhaengigkeitenAbhaengigkeiten(neu) {
  KARTEN_CACHE.clear();
  if (neu === undefined) {
    Object.assign(abh, VORGABEN);
    return;
  }
  for (const [name, fn] of Object.entries(neu)) {
    if (!Object.hasOwn(VORGABEN, name)) throw new Error(`abhaengigkeitenAbhaengigkeiten kennt keine Abhaengigkeit '${name}'`);
    abh[name] = fn;
  }
}

/** Eine Karte ohne harten Stopp — null, wenn der Tracker sie nicht liefert. */
export function leseKarte(id) {
  const res = abh.boardRoh("issue", "get", String(id));
  return res.status === 0 && res.json ? res.json : null;
}

// --- Abhaengigkeiten ---

const DEPS_UEBERSCHRIFT = /^ {0,3}##\s*Abh(?:ä|ae)ngigkeiten\s*$/i;
const ABSCHNITTS_ENDE = /^ {0,3}##\s/;
const LOKALE_REFERENZ = /(?<![\w`/#])#(\d+)/g;
// Der Pflichtabschnitt eines Plandokuments (Regel P6), gelesen von der Stopp-Fragen-
// Pruefung des Erzeugungsmodus. Name und Ausdruck gehoeren zusammen: Der Name steht in
// den Gruenden, damit dort keine zweite Schreibweise entsteht.
export const OFFENE_FRAGEN_NAME = "Offene Fragen";
export const OFFENE_FRAGEN_UEBERSCHRIFT = /^ {0,3}##\s*Offene\s+Fragen\s*$/i;
// Der Abschnitt, in den eine Antwort auf eine Stopp-Frage gehoert. Er steht in den
// Gruenden von `planAusschluss` und im Weg nach vorn des Halt-Kommentars (Issue #896) —
// zwei Schreibweisen desselben Abschnitts liessen den Menschen den falschen suchen.
export const ENTSCHEIDUNGEN_NAME = "Architektonische Entscheidungen";
// Der Pflichtabschnitt einer fachlichen Anforderung (Gate F7), gelesen von
// `offeneFragenGrund`. Eigene Konstante neben `OFFENE_FRAGEN_NAME`: Die Ueberschrift
// lautet anders, und die beiden Regeln koennen getrennt wandern.
export const PO_FRAGEN_NAME = "Offene Fragen an den PO";
export const PO_FRAGEN_UEBERSCHRIFT = /^ {0,3}##\s*Offene\s+Fragen\s+an\s+den\s+PO\s*$/i;

/**
 * Die Zeilen eines Markdown-Abschnitts — `null`, wenn die Ueberschrift fehlt.
 *
 * Herausgezogen aus `parseDeps` (Issue #519), weil die Stopp-Fragen-Pruefung des
 * Erzeugungsmodus dieselbe Fence-Regel braucht. Zwei Ausdruecke fuer "Abschnitt lesen"
 * liefen auseinander, und die Regel ist zu fein, um sie zweimal richtig zu treffen.
 *
 * `ausserhalb` liegt bei, weil die beiden Leser den Inhalt verschieden brauchen:
 * `parseDeps` sucht Referenzen im GANZEN Abschnitt (auch in Codebloecken — eine dort
 * zitierte Nummer ist trotzdem eine Abhaengigkeit), die Stopp-Fragen-Pruefung nur
 * ausserhalb (eine dort gezeigte Regelform ist kein Nachweis).
 */
export function abschnittLesen(body, ueberschrift) {
  const zeilen = String(body || "").split(/\r\n|\r|\n/);
  const imFence = fenceLauf();
  const ausserhalb = [];
  let start = -1;

  for (let i = 0; i < zeilen.length; i++) {
    ausserhalb[i] = !imFence(zeilen[i]);
    if (ausserhalb[i] && ueberschrift.test(zeilen[i])) start = i;
  }
  if (start < 0) return null;

  let ende = zeilen.length;
  for (let i = start + 1; i < zeilen.length; i++) {
    if (ausserhalb[i] && ABSCHNITTS_ENDE.test(zeilen[i])) { ende = i; break; }
  }
  return { zeilen: zeilen.slice(start + 1, ende), ausserhalb: ausserhalb.slice(start + 1, ende) };
}

/**
 * Liest #N-Referenzen aus dem Abschnitt "## Abhaengigkeiten" (auch "Abhängigkeiten").
 *
 * Bewusst nur nackte #N-Tokens: Referenzen wie `owner/repo`#245 (Backtick/Slash
 * davor) sind fremde Repos und werden nicht als lokale Issues gewertet.
 *
 * Die Ueberschrift zaehlt nur als EIGENE ZEILE und nur AUSSERHALB eines Code-Fence
 * (Issue #308). Vorher traf der Ausdruck auch eine Nennung im Fliesstext und nahm
 * die erste Fundstelle — bei einem Issue, das ueber das Issue-Format selbst
 * handelt, las er dann einen Teil des Aufgabentextes. Das Schadensbild geht in
 * beide Richtungen und faellt am Board nie auf: Eine echte Referenz im richtigen
 * Abschnitt wird unsichtbar (der Runner implementiert zu frueh), oder eine
 * Referenz im falsch gelesenen Bereich erfindet eine Abhaengigkeit (das Issue
 * bleibt dauerhaft liegen).
 *
 * Die Fence-Regel gilt an BEIDEN Enden: Eine `##`-Zeile innerhalb eines Fence
 * beendet den echten Abschnitt nicht. Sonst haette ein Beispielblock im Abschnitt
 * selbst ihn vorzeitig geschlossen — zwei Auslegungen, beide mit dem Anspruch,
 * "Fences ausnehmen" zu erfuellen.
 *
 * Bei mehreren echten Ueberschriften gilt die LETZTE: In einem korrekt
 * formatierten Issue ist der Abschnitt der letzte des Dokuments, und ein
 * vorangestelltes Beispiel ausserhalb eines Fence bleibt damit wirkungslos.
 *
 * SYNC: `abhaengigkeitenLesen` in kit/board.mjs baut diese Lesung nach (`issue auftrag`,
 * Issue #1023). Der Gleichlauf-Test in test/ablauf-board-dokumente-auftrag.test.mjs faehrt beide ueber
 * dieselben Fixtures.
 */
export function parseDeps(body) {
  const gelesen = abschnittLesen(body, DEPS_UEBERSCHRIFT);
  if (gelesen === null) return [];

  const abschnitt = gelesen.zeilen.join("\n");
  const refs = [...abschnitt.matchAll(LOKALE_REFERENZ)].map((x) => Number(x[1]));
  return [...new Set(refs)];
}

// Der Zusatz an einer Verweiszeile, mit dem ein Paket sagt, dass es das geaenderte Werkzeug
// eines anderen Pakets als Werkzeug braucht (Issue #1104, Plan #1101 A8). Seit #1102 wirkt
// ein solches Werkzeug in unbeaufsichtigten Laeufen erst nach `push main`.
const WARTET_AUF_PUSH = /^\s*(?:(?:[-*+]|\d+\.)\s+)?Issue #(\d+)\s*\(wartet auf Push\)/i;

/**
 * Die Nummern, auf deren Push ein Paket wartet — aus den Verweiszeilen seines Abschnitts
 * `## Abhaengigkeiten` mit dem Zusatz `(wartet auf Push)`. Den Zusatz setzt allein `/issues`
 * beim Schneiden; der Runner liest ihn nur (E7).
 */
export function wartetAufPush(body) {
  const gelesen = abschnittLesen(body, DEPS_UEBERSCHRIFT);
  if (gelesen === null) return [];
  const nummern = gelesen.zeilen.map((z) => z.match(WARTET_AUF_PUSH)?.[1]).filter(Boolean).map(Number);
  return [...new Set(nummern)];
}

/**
 * Der Lauf-Cache der Karten, auf die Abhaengigkeiten zeigen: Nummer -> Karte (Issue #1062,
 * Plan #1057 E6). Die Gates laufen je Ready-Paket und je Runde; ohne Cache wuechse die Zahl
 * der Abrufe mit der Groesse der Kette. `satisfiedIds` fuellt ihn aus den Listen, die es
 * ohnehin abruft — diese Eintraege tragen den Titel, nicht zwingend den Body. Eine Nummer,
 * deren Abruf scheitert, steht mit `null` darin und wird im Lauf nicht erneut gefragt.
 */
const KARTEN_CACHE = new Map();

function karteAusCache(nummer) {
  if (!KARTEN_CACHE.has(nummer)) KARTEN_CACHE.set(nummer, leseKarte(nummer));
  return KARTEN_CACHE.get(nummer);
}

/**
 * Eine Karte mit Body aus dem Lauf-Cache (Issue #1063): Ein Eintrag aus den Listen von
 * `satisfiedIds` traegt den Body nicht zwingend, dann wird die Karte einmal geholt.
 * `null` heisst: Der Abruf scheiterte, und das bleibt im Lauf so.
 */
function karteMitBody(nummer) {
  const gecacht = KARTEN_CACHE.get(nummer);
  if (gecacht === null || typeof gecacht?.body === "string") return gecacht;
  KARTEN_CACHE.set(nummer, leseKarte(nummer));
  return KARTEN_CACHE.get(nummer);
}

/**
 * Der volle Body des geprueften Pakets fuer die Gates, ueber den Lauf-Cache (Issue #1063):
 * Hat die Kreis-Suche eines frueheren Pakets die Karte schon geholt, wird sie nicht noch
 * einmal abgerufen. Anders als in der Kreis-Suche ueber `board()` — das Paket selbst nicht
 * lesen zu koennen, ist wie bisher ein Ausfall des Trackers.
 */
export function gateKarte(top) {
  const nummer = Number(top.id);
  const gecacht = KARTEN_CACHE.get(nummer);
  if (typeof gecacht?.body === "string") return gecacht;
  const full = abh.board("issue", "get", String(top.id));
  KARTEN_CACHE.set(nummer, full);
  return full;
}

/**
 * Die Kreise, die ein Paket ueber seine unerfuellten Abhaengigkeiten erreicht (Issue #1063,
 * Plan #1057 E7, E8): Tiefensuche, je Karte ueber `parseDeps` ihres Bodies aus dem Lauf-Cache.
 * Ein Kreis ist eine Rueckkante auf eine Karte im aktuellen Suchpfad; ein Paket, das von sich
 * selbst abhaengt, ist ein Kreis aus einem Paket. Eine erfuellte Abhaengigkeit haelt nichts
 * fest und beendet den Pfad, ein gescheiterter Abruf ebenso — der Lauf geht weiter. Jeder
 * Kreis beginnt bei seiner kleinsten Nummer, damit er an jedem Paket gleich lautet.
 * Rueckgabe: Liste von Nummernlisten, ohne Doppel.
 */
export function kreiseAb(start, erfuellt) {
  const kreise = new Map();
  const pfad = [];
  const fertig = new Set();
  const besuche = (nummer) => {
    const karte = karteMitBody(nummer);
    if (!karte) return;
    pfad.push(nummer);
    for (const dep of parseDeps(karte.body)) {
      if (erfuellt.has(dep)) continue;
      const imPfad = pfad.indexOf(dep);
      if (imPfad >= 0) {
        const kreis = kreisAbKleinster(pfad.slice(imPfad));
        kreise.set(kreis.join(","), kreis);
      } else if (!fertig.has(dep)) {
        besuche(dep);
      }
    }
    pfad.pop();
    fertig.add(nummer);
  };
  besuche(Number(start));
  return [...kreise.values()];
}

function kreisAbKleinster(kreis) {
  const ab = kreis.indexOf(Math.min(...kreis));
  return [...kreis.slice(ab), ...kreis.slice(0, ab)];
}

/** Ein Kreis als Text `#A -> #B -> #A`. */
function kreisText(kreis) {
  return [...kreis, kreis[0]].map((k) => `#${k}`).join(" -> ");
}

// Die Spalten, in denen eine Abhaengigkeit unerfuellt ist (Issue #1149). Jede andere Lage —
// In review, Done, archiviert, nicht mehr auf dem Board — gilt als erfuellt.
const SPERR_SPALTEN = ["backlog", "ready", "in_progress"];

/**
 * Die erfuellten Abhaengigkeiten als Menge mit `has` und `add` (Issue #1149): erfuellt ist
 * jede Nummer, die nicht in einer Sperrspalte liegt. Umgekehrt bestimmt, weil das Board
 * archivierte und alte erledigte Karten nicht mehr listet. Scheitert ein Abruf, greift wie
 * bisher der Board-Fehler von `board()`.
 */
export function satisfiedIds() {
  const gesperrt = SPERR_SPALTEN.flatMap((spalte) => abh.board("issue", "list", "--status", spalte));
  // Nur fehlende Eintraege: Die Sperrspalten tragen auch Karten, die der Lauf schon
  // kommentiert hat — ihr frischer Body (lokaler Tracker: samt Kommentar) truege fremde
  // Nummern in die Kreis-Suche.
  for (const k of gesperrt) if (!KARTEN_CACHE.has(Number(k.id))) KARTEN_CACHE.set(Number(k.id), k);
  return erfuelltAusser(gesperrt.map((i) => Number(i.id)));
}

/** Erfuellt ist jede Nummer ausser `offen`; `add` nimmt eine Nummer aus `offen` heraus. */
function erfuelltAusser(offen) {
  const rest = new Set(offen);
  return {
    has: (nummer) => !rest.has(nummer),
    add: (nummer) => { rest.delete(nummer); },
  };
}

// Der Satz je Dokument-Art, dem Wortlaut von `dokumentArt` in kit/board.mjs folgend
// (Issue #1060): Beim Schreiben und im Nachtlauf sagt derselbe Hinweis dasselbe.
const DOKUMENT_SATZ_ERST = "eine fachliche Anforderung oder Idee ist erst erledigt, wenn ihre Pakete fertig sind";
const DOKUMENT_ARTEN = [
  [isPlan, "[Plan]", "ein Plandokument wird nie durch Umsetzung erledigt"],
  [isFachlich, "[Fachlich]", DOKUMENT_SATZ_ERST],
  [isIdee, "[Idee]", DOKUMENT_SATZ_ERST],
];

/**
 * Der Abhaengigkeitsbefund eines Pakets (Issue #1062, Plan #1057 E6, E10): je Abhaengigkeit
 * `{ nummer, erfuellt, herkunft, stelle, titel, dokument }`. Die Menge der Nummern kommt
 * aus `parseDeps` — sie entscheidet ueber das Zurueckstellen und bleibt die eine Lesung
 * dafuer; `abhaengigkeitenMitHerkunft` liefert nur Herkunft und Stelle dazu. `dokument` ist
 * `[Fachlich]`, `[Plan]`, `[Idee]` oder `null`; eine Karte, die sich nicht abrufen laesst,
 * bleibt ohne Titel und ohne Dokument-Art. `erfuellt` ist die Menge aus `satisfiedIds`.
 */
export function abhaengigkeitsBefund(top, body, erfuellt) {
  const herkunft = new Map(abhaengigkeitenMitHerkunft(body).map((h) => [h.nummer, h]));
  const abhaengigkeiten = parseDeps(body).map((nummer) => {
    const karte = karteAusCache(nummer);
    const titel = karte?.title ?? null;
    const art = titel === null ? null : DOKUMENT_ARTEN.find(([passt]) => passt(titel));
    return {
      nummer,
      erfuellt: erfuellt.has(nummer),
      herkunft: herkunft.get(nummer)?.herkunft ?? "text",
      stelle: herkunft.get(nummer)?.stelle ?? "",
      titel,
      dokument: art ? art[1] : null,
      dokumentSatz: art ? art[2] : null,
    };
  });
  // Die Kreise nur, wenn etwas unerfuellt ist: Sonst fuehrt kein Pfad weiter (E7), und ein
  // startendes Paket kostet keinen Abruf mehr als vorher.
  const paket = Number(top.id);
  const kreise = abhaengigkeiten.every((a) => a.erfuellt)
    ? []
    : kreiseAb(paket, erfuellt).map((karten) => ({ karten, steht: karten.includes(paket) }));
  return { paket, abhaengigkeiten, kreise };
}

/**
 * Die Zeile eines Kreises unter den Abhaengigkeitszeilen (E9, E10): Steht das Paket nicht
 * selbst darin, haengt es nur daran und wartet auf einen Kreis.
 */
function kreisZeile(kreis) {
  return `Kreis: ${kreisText(kreis.karten)}${kreis.steht ? "" : " — dieses Paket wartet auf einen Kreis."}`;
}

/** Die zweite Logzeile des Abhaengigkeits-Gates je Kreis (E10). */
export function kreisLogZeile(paket, kreis) {
  return `#${paket} ${kreis.steht ? "steht in einem Kreis" : "wartet auf einen Kreis"}: ${kreisText(kreis.karten)}`;
}

/** Eine Zeile des Blocks je Abhaengigkeit (E10), ohne Titel bei unbekannter Karte. */
function abhaengigkeitsZeile(a) {
  const titel = a.titel === null ? "" : ` (${a.titel})`;
  const stand = a.erfuellt ? "erfuellt" : "unerfuellt";
  const herkunft = a.herkunft === "verweiszeile" ? "aus einer Verweiszeile" : "aus erlaeuterndem Text";
  const dokument = a.dokument ? ` — Dokument (${a.dokument}), kein Arbeitspaket: ${a.dokumentSatz}.` : "";
  return `- #${a.nummer}${titel}: ${stand}, ${herkunft}: „${a.stelle}“${dokument}`;
}

/**
 * Der Block unter dem Rueckstell-Kommentar (Issue #1062, Plan #1057 E10): Kopfzeile, dann
 * je Abhaengigkeit eine Zeile. Er gehoert an die Karte, nicht in Logzeile, Einheit oder
 * Kettenbericht — die lesen den einzeiligen `kommentar`.
 */
export function abhaengigkeitsBlock(befund) {
  return [
    "Abhaengigkeiten, wie der Nachtlauf sie liest:",
    ...befund.abhaengigkeiten.map(abhaengigkeitsZeile),
    ...(befund.kreise ?? []).map(kreisZeile),
  ].join("\n");
}

/**
 * Derselbe Befund als eingerueckte Zeilen unter der Zeile eines Pakets im Probelauf (Issue
 * #1064, Plan #1057 E12): je Abhaengigkeit eine Zeile wie im Block, danach die Kreise. Ohne
 * Abhaengigkeit keine Zeile — die erste Zeile des Pakets bleibt dann allein.
 */
export function abhaengigkeitsZeilen(befund) {
  if (!befund || befund.abhaengigkeiten.length === 0) return [];
  return [
    ...befund.abhaengigkeiten.map(abhaengigkeitsZeile),
    ...(befund.kreise ?? []).map(kreisZeile),
  ].map((zeile) => `    ${zeile}`);
}
