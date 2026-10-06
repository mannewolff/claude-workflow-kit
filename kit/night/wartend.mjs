/**
 * night/wartend.mjs — die Runde der Umsetzungsnacht (Issue #1231, Plan #1199, E17): die
 * wartende Sitzung, der Zeitabbruch-Vermerk, die Gruende einer Runde ohne Ergebnis, die
 * Auswertung einer Runde mit Halt, Salvage und Stash, die Runde selbst und die
 * Implementierungsschleife.
 *
 * Ein Teil von kit/night.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nur aus Teilen unter kit/night/ und kit/board/, nie aus dem Einstieg:
 * Der Einstieg laedt die Teile, ein Rueckimport waere ein Zyklus.
 *
 * Mitgezogen, obwohl E17 sie nicht nennt, weil die Runde ihr Hauptaufrufer ist: die Gates
 * eines Ready-Issues (`pruefeIssueGates` samt Review-Marker, `kit:klaeren`,
 * `kit:geschuetzt` und dem Gate geschuetzter Dateien), der Folgesatz des Halts
 * (`HALT_FOLGESATZ`), der Salvage-Versuch, die Warnung zum Routing-Label und die
 * Modul-Merker der laufenden Runde. Kette und Probelauf nehmen sie von hier.
 *
 * Den Abschluss des Laufs (`laufAbschliessen`) ruft die Schleife, ohne ihn zu importieren:
 * Er steht noch im Einstieg, und ein Import waere ein Zyklus. Der Einstieg bindet ihn ueber
 * `wartendAnbinden` an (Plan #1199, E16).
 *
 * Das Board und git erreicht der Teil ueber `board`, `boardRoh`, `leseKarte`, `gitClean` und
 * `gitReste`; alle lassen sich ueber `wartendAbhaengigkeiten` einsetzen (Plan #1199, E6). So
 * pruefen die Tests die Auswertung einer Runde im selben Prozess, ohne Kindprozess.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, dirname, resolve, basename, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import { ZUSTAND, NACHBAR_DIR, log, board, boardRoh, einheitAnlegen, einheitErgaenzen, ersteZeile, gitClean,
  gitReste, gitResteAusnahmen, gitRestePathspec, hefteStoppGrund, hefteStoppGrundAnLauf, lastCommitHash,
  merkeHartenStopp, resteText, schrittBeginnen, schrittEnden, vermerkeOhneArbeit } from "./grundlagen.mjs";
import { LAUF_KONTEXT, anhaltenLaeuft, anhaltenVermerken, exitText, hatSitzungsereignis,
  standSetzen } from "./laufstand.mjs";
import { umsetzungLockNehmen, kitStandAbgeben, kitStandInBaum } from "./kitstand.mjs";
import { abhaengigkeitsBefund, abhaengigkeitsBlock, parseDeps, gateKarte, kreisLogZeile, leseKarte,
  satisfiedIds } from "./abhaengigkeiten.mjs";
import { frischeStufenFelder, leseErgebnisText, leseKennzahlen, neueKommentare, paketWahl, runSession,
  salvagePrompt, stufenEinstellung, SALVAGE_TIMEOUT_MS, verifyChecksForSalvage } from "./session.mjs";
import { bewertePruefung, verwerfeZusammenfassung, kommentareVon } from "./bericht.mjs";

// Die Praefixe kommen aus dem Board-Teil dokumente, die Erkennung geschuetzter Dateien aus dem
// Board-Teil geschuetzt (Issue #1218, #1219). Abgefangen wie im Einstieg: Fehlt ein Teil, wirft
// jede Funktion erst, wenn jemand sie braucht — ein stilles `false` liesse ein Plandokument als
// Arbeitspaket durch, ein stilles "keine Treffer" ein Paket mit geschuetzter Datei in eine
// Session. Die Pfade sind nicht literal, deshalb nennt die Gruppe dieses Teils die Bereiche
// board-dokumente und board-geschuetzt von Hand (E3).
const boardTeilFehlt = (teil, was) => () => {
  throw new Error(`board/${teil} fehlt neben night.mjs (${join(NACHBAR_DIR, "board")}) — ${was} ist nicht verfuegbar.`);
};
const {
  istFachlich: isFachlich,
  istPlan: isPlan,
  istIdee: isIdee,
  istMensch: isMensch,
} = await import(pathToFileURL(join(NACHBAR_DIR, "board", "dokumente.mjs")).href).catch(() => ({
  istFachlich: boardTeilFehlt("dokumente.mjs", "das Praefix [Fachlich]"),
  istPlan: boardTeilFehlt("dokumente.mjs", "das Praefix [Plan]"),
  istIdee: boardTeilFehlt("dokumente.mjs", "das Praefix [Idee]"),
  istMensch: boardTeilFehlt("dokumente.mjs", "das Praefix [Mensch]"),
}));
const { geschuetzteTreffer, geschuetztKommentar, geschuetztFreigabe } = await import(
  pathToFileURL(join(NACHBAR_DIR, "board", "geschuetzt.mjs")).href,
).catch(() => ({
  geschuetzteTreffer: boardTeilFehlt("geschuetzt.mjs", "die Erkennung geschuetzter Dateien"),
  geschuetztKommentar: boardTeilFehlt("geschuetzt.mjs", "der Halt-Kommentar fuer geschuetzte Dateien"),
  geschuetztFreigabe: boardTeilFehlt("geschuetzt.mjs", "die Freigabe geschuetzter Dateien"),
}));

// --- Abhaengigkeiten nach aussen (Plan #1199, E6) ---

const VORGABEN = Object.freeze({ board, boardRoh, leseKarte, gitClean, gitReste });
const abh = { ...VORGABEN };

/**
 * Setzt Abhaengigkeiten des Teils ein; nicht genannte behalten ihren Wert, ohne Argument
 * gelten wieder alle Vorgaben. Nur fuer Tests — der Runner arbeitet mit den Vorgaben.
 */
export function wartendAbhaengigkeiten(neu) {
  if (neu === undefined) {
    Object.assign(abh, VORGABEN);
    return;
  }
  for (const [name, fn] of Object.entries(neu)) {
    if (!Object.hasOwn(VORGABEN, name)) throw new Error(`wartendAbhaengigkeiten kennt keine Abhaengigkeit '${name}'`);
    abh[name] = fn;
  }
}

// --- Anbindung an den Einstieg (Plan #1199, E16) ---

// Der Abschluss des Laufs steht im Einstieg; ein Teil, der allein geladen ist, hat keinen.
const anbindung = {
  laufAbschliessen: () => {
    throw new Error("laufAbschliessen ist nicht angebunden — der Einstieg kit/night.mjs setzt es beim Laden.");
  },
};

/** Setzt die Haken aus `anbindung`; nicht genannte behalten ihren Wert. */
export function wartendAnbinden(haken) {
  for (const [name, fn] of Object.entries(haken)) {
    if (!Object.hasOwn(anbindung, name)) throw new Error(`wartendAnbinden kennt keinen Haken '${name}'`);
    anbindung[name] = fn;
  }
}

// --- Merker der laufenden Runde ---

// Der Satz einer Rettung ohne Commit (Issue #1089) und der Grund eines abgebrochenen Pakets,
// dessen Reste im Stash liegen — dasselbe Muster wie STOPP_GRUND, fuer den Ausgang
// `abgebrochen`, der den Lauf nicht anhaelt.
let SALVAGE_GRUND = "";
let ABBRUCH_GRUND = "";
// Die Pakete, die in diesem Lauf abgebrochen sind (E15): Ein Paket, das von einem davon
// abhaengt, zeigt am Gate `wartet` statt nur zurueckzugehen.
const ABGEBROCHENE_PAKETE = new Set();

// Hat die Sitzung der laufenden Runde auf eine selbst angestossene Arbeit gewartet
// (Issue #776)? Modul-Zustand nach demselben Muster wie STOPP_GRUND darueber und aus
// demselben Grund: Der Befund faellt in der Auswertung, gebraucht wird er beim Fuellen der
// Einheit — und die Rueckgabewerte der Auswertungswege bleiben die Zaehlwoerter, die
// mehrere Stellen als String vergleichen. Vor jeder Session zurueckgesetzt, damit keine
// Runde den Befund ihrer Vorgaengerin erbt.
let WARTEND_BEENDET = false;

// Ist die Sitzung der laufenden Runde am Zeitlimit abgebrochen worden (Issue #977)?
// Derselbe Modul-Merker nach demselben Muster wie WARTEND_BEENDET darueber und aus
// demselben Grund: Der Befund faellt in den drei Auswertungswegen, gebraucht wird er beim
// Fuellen der Einheit — und deren Rueckgabewerte bleiben die Zaehlwoerter. Vor jeder
// Session zurueckgesetzt, damit keine Runde den Befund ihrer Vorgaengerin erbt.
//
// Gesetzt wird er allein in den Zweigen OHNE In-review-Ergebnis: Eine vom Salvage
// gerettete Karte ist fertig und soll in keiner Auswertung als Zeitabbruch zaehlen
// (Plan #974, E8).
let ZEITLIMIT_BEENDET = false;

// Die Art des Halts der laufenden Runde (Issue #1050, E12): `"klaeren"`, `"geschuetzt"` oder
// `null`. Derselbe Modul-Merker wie WARTEND_BEENDET und aus demselben Grund: Der Befund
// faellt in `werteRunde`, gebraucht wird er beim Fuellen der Einheit und in der Kette —
// und der Rueckgabewert bleibt das Zaehlwort `angehalten`. Vor jeder Session zurueckgesetzt.
let HALT_ART = null;

/**
 * Die Merker der zuletzt ausgewerteten Runde: wartend, Zeitabbruch und die Art des Halts —
 * `"klaeren"`, `"geschuetzt"` oder `null`. Die Kette liest die Art des Halts nach einer
 * Runde ihrer Umsetzungsstufe; setzen darf die Merker allein dieser Teil.
 */
export function rundenMerker() {
  return { wartend: WARTEND_BEENDET, zeitlimit: ZEITLIMIT_BEENDET, haltArt: HALT_ART };
}

/**
 * Setzt die Merker vor einer Runde zurueck. Der Merker der wartenden Sitzung gehoert dieser
 * einen Runde (Issue #776): Ohne das Zuruecksetzen truege die naechste Einheit den Befund der
 * vorigen — und im Ergebnisstand stuende eine Runde als wartend, die es nie war. Ebenso der
 * Merker des Zeitabbruchs (Issue #977) und die Art des Halts (Issue #1050).
 */
export function rundenMerkerZuruecksetzen() {
  WARTEND_BEENDET = false;
  ZEITLIMIT_BEENDET = false;
  HALT_ART = null;
}

const MAX_ITERATIONS = 500; // Notbremse gegen Endlosschleifen, weit ueber jedem realen Lauf

// --- Die Gates eines Ready-Issues (mitgezogen, siehe Kopf) ---

// Review-Marker aus /issue-review (Issue #223). Anders als die beiden Filter darueber
// greift dieser am BODY: Der Marker steht im Kontext-Abschnitt, nicht im Titel. Der
// Body liegt ohnehin vor, weil parseDeps ihn braucht — kein zusaetzlicher Board-Aufruf.
//
// Bewusst streng: Nur eine Zeile, die mit 'Issue-Review:' beginnt und danach etwas
// traegt, zaehlt. 'Issue-Review folgt noch' ist das Gegenteil einer Freigabe und darf
// nicht als eine durchgehen.
// `[^\S\n]*` statt `\s*` nach dem Doppelpunkt (Issue #403): Der Wert muss auf
// derselben Zeile stehen. Vorher lief `\s*` in die Folgezeile, sodass
// "Issue-Review:\nGO" als Marker galt — das Gegenteil dessen, was der Kommentar
// oben seit jeher beschreibt. Die einzige gewollte Verhaltensaenderung dieser Etappe.
//
// Kein fuehrender Leerraum mehr im Ausdruck (Issue #496): `^[^\S\n]*` mit m-Flag
// war der Teil, den SonarCloud als S8786 fuehrte — eine unbegrenzte Wiederholung
// direkt hinter einem Zeilenanfang, der an jeder Zeile ansetzen kann. #403 hatte
// den Ausdruck an dieser Stelle noch fuer harmlos gehalten und ihn nur gemessen;
// der Fund blieb trotzdem offen. Die Einrueckung raeumt jetzt `hasReviewMarker`
// je Zeile per `trimStart()` ab — derselbe Weg, den #403 fuer PRUEFUNG_ZEILE
// gegangen ist. Die Funktion antwortet auf jeden Body wie zuvor; der Ausdruck
// allein tut es nicht mehr, denn er sieht nur noch die getrimmte Zeile.
export const REVIEW_MARKER_ZEILE = /^Issue-Review:[^\S\n]*\S/i;

export function hasReviewMarker(body) {
  // `trimStart()` statt `[^\S\n]*` im Ausdruck: Es raeumt genau dieselben Zeichen
  // ab — jeden Leerraum ausser dem Zeilenumbruch, den `split` schon entfernt hat.
  // `[ \t]` waere hier zu eng gewesen: Ein `\r` aus CRLF-Zeilenenden faellt nicht
  // darunter.
  return (body || "").split("\n").some((zeile) => REVIEW_MARKER_ZEILE.test(zeile.trimStart()));
}

// Die Pruefer-Vermerke an Plan und Anforderung stehen seit Issue #1230 im Teil
// kit/night/bericht.mjs (Plan #1199, E17); der Einstieg laedt ihn oben und exportiert
// ihre Namen weiter.

/**
 * Der Freigabe-Befund eines Ready-Issues fuer das Gate `requiredBeforeReady` (#304,
 * gekuerzt in Plan #638, A17).
 *
 * Zwei Arten, und sie bleiben unterscheidbar, weil sie morgens Verschiedenes bedeuten:
 *   `marker`     — es ist geprueft worden (Issue-Review-Marker im Body), frei
 *   `ungeprueft` — kein Marker, zurueckgestellt
 *
 * Die Arten `verzicht`, `verfallen` und `ungueltig` hingen an der Pruefvorgabe
 * (`Pruefung:`-Zeile), die mit Stufe 2 des Umbaus entfaellt. Eine solche Zeile im Body
 * hat keine Wirkung mehr.
 */
export function reviewFreigabe(body) {
  if (hasReviewMarker(body)) return { frei: true, art: "marker" };
  return { frei: false, art: "ungeprueft" };
}

/** Protokollzeile, Board-Kommentar und Dry-Run-Grund je Ablehnungsart (#304). */
export const GATE_ABLEHNUNG = {
  ungeprueft: {
    kurz: () => "ungeprueft, kein Issue-Review-Marker",
    log: () => "uebersprungen: ungeprueft (kein Issue-Review-Marker im Body).",
    kommentar: (id) => `Ungeprueft — bitte erst /issue-review #${id} laufen lassen, dann wieder nach Ready.`,
  },
};

/**
 * Das Zeichen fuer eine offene menschliche Entscheidung (Plan #368, A4).
 *
 * Anders als die Titel-Praefixe haengt dieses Gate an einem Label — und es hat eine
 * Richtung: Die Maschine darf es SETZEN, aber nie ABNEHMEN. Ein Lauf, der sein
 * eigenes `kit:klaeren` abraeumen duerfte, koennte sich selbst freigeben. Deshalb
 * kommt `issue label remove` mit diesem Namen im ganzen Runner nicht vor.
 *
 * Die beiden Labelsorten leisten Verschiedenes: `review:*` **beschreibt** einen
 * abgeleiteten Zustand und ist jederzeit neu berechenbar, `kit:klaeren`
 * **entscheidet** und bleibt stehen, bis ein Mensch es abnimmt.
 */
export const KLAEREN_LABEL = "kit:klaeren";

export function hatKlaerenLabel(issue) {
  return (issue?.labels || []).includes(KLAEREN_LABEL);
}

/**
 * Das Zeichen fuer eine wartende menschliche Handlung an einer geschuetzten Datei (Issue
 * #1046, Plan #987, E11).
 *
 * Dieselbe Richtung wie bei `kit:klaeren`: Die Maschine SETZT das Label, abnehmen darf es
 * allein der Mensch — das Abnehmen ist zusammen mit dem Halt-Kommentar die Freigabe (E5).
 * Ein Lauf, der es abraeumen duerfte, gaebe sich selbst frei; `issue label remove` mit
 * diesem Namen kommt im Runner darum nicht vor. Ein eigenes Label und nicht `kit:klaeren`,
 * weil hier nichts zu entscheiden, sondern etwas zu tun ist.
 *
 * SYNC: `GESCHUETZT_LABEL` und `GESCHUETZT_ANKER` stehen gleichlautend in kit/board.mjs
 * (Issue #1045), wo `geschuetztKommentar` den Halt-Text baut und `geschuetztFreigabe` ihn
 * zurueckliest. Wer einen hier aendert, aendert ihn dort mit — der Gleichlauf-Test in
 * test/ablauf-night-geschuetzt-gate.test.mjs vergleicht beide Seiten.
 */
export const GESCHUETZT_LABEL = "kit:geschuetzt";
export const GESCHUETZT_ANKER = "## Geschuetzte Datei";
// Die Zeile, mit der `issue check-geschuetzt --pfad` einen beim Schreiben abgewiesenen Pfad
// fuehrt (Issue #1053). Der Auffang aus #1051 erkennt daran, dass der Pfad aus dem Stream der
// Session stammt und nicht aus der Aufgabe. SYNC: gleichlautend in kit/board.mjs.
export const GESCHUETZT_ABGEWIESEN = "beim Schreiben abgewiesen";

export function hatGeschuetztLabel(issue) {
  return (issue?.labels || []).includes(GESCHUETZT_LABEL);
}

// Der Kommentar des Label-Gates. SYNC: Ohne das Praefix `Nachtlauf: ` steht er als
// Backlog-Text von `issue auftrag` in kit/board.mjs (Issue #1052).
export const GESCHUETZT_LABEL_GATE_TEXT = `Nachtlauf: Traegt ${GESCHUETZT_LABEL} — eine menschliche Handlung an einer geschuetzten Datei wartet, wird nicht implementiert. Das Label nimmt nur ein Mensch ab.`;

/**
 * Der feste Folgesatz, an dem der Runner einen Halt-Kommentar erkennt (Issue #572).
 *
 * Eine Implementierungs-Session, bei der doch eine Abwaegung auftaucht, zeichnet die
 * Karte, benennt die Entscheidung in einem Kommentar und schiebt sie nach Backlog.
 * Dieser Satz schliesst den Kommentar ab — und nur an ihm ist er von jedem anderen
 * Kommentar zu unterscheiden. Dass irgendein Kommentar hinzukam, genuegt nicht: Das
 * ist im Regelbetrieb fast immer wahr, und der Abbruch VOR dem Kommentar bliebe
 * unerkannt.
 *
 * Exportiert, damit der Skill-Text (Issue #573) in einem Test gegen diese Konstante
 * geprueft werden kann statt gegen eine Abschrift — zwei Literale liefen auseinander,
 * und der Halt waere danach still wirkungslos.
 */
export const HALT_FOLGESATZ = "Daraus soll per /fachplan eine fachliche Anforderung entstehen.";

// Vorflug-Warnung zum Routing-Label (Issue #179). Ein Vertipper im --label-Wert ist
// syntaktisch gueltig: --label no filtert auf ein Label namens "no", findet nichts,
// und der Lauf endet ohne Arbeit — im Protokoll nicht von einem abgearbeiteten Board
// zu unterscheiden. Die Warnung trennt die beiden Faelle.
//
// Bewusst nur eine Warnung, kein Stopp: Ein Lauf ohne passende Issues ist ein
// legitimer Zustand. Ein zusaetzlicher naechtlicher Abbruchgrund waere schlimmer als
// das Problem, das er meldet (dieselbe Abwaegung wie bei der Versions-Drift, #172).
//
// Der "einmal zeigen"-Zustand steht im Kontext statt in einer Closure: Beide
// Programme, die warnen koennen (Dry-Run und Implementierung), teilen sich denselben
// Kontext, und die Warnung soll je Lauf einmal erscheinen — nicht je Programm.
export function warnWennLabelNirgendsVorkommt(ctx, ready) {
  if (ctx.labelWarnungGezeigt || ctx.labelFilter === null || ready.length === 0) return;
  if (ready.some(ctx.hasLabel)) return;
  ctx.labelWarnungGezeigt = true;
  const vorhanden = [...new Set(ready.flatMap((i) => i.labels || []))];
  log(`WARNUNG: kein Ready-Issue traegt das Label '${ctx.labelFilter}' — es wird nichts verarbeitet.`);
  log(`  In Ready vorhandene Labels: ${vorhanden.length ? vorhanden.join(", ") : "keine"}`);
  log(`  Tippfehler im --label-Wert? Mit --label none laeuft der Nachtlauf ohne Label-Filter.`);
}

/**
 * Die sieben Gruende, aus denen ein Ready-Issue nicht implementiert wird (Issue #404, #984).
 *
 * Rueckgabe: `null`, wenn das Issue drankommt — sonst `{ log, kommentar }` mit der
 * Protokollzeile und dem Text, der am Board haengen bleibt. Der Aufrufer verschiebt
 * das Issue danach ins Backlog; welcher Grund gilt, entscheidet allein diese
 * Funktion.
 *
 * Der volle Body wird erst geholt, wenn die fuenf Titel- und Label-Gates durch sind.
 * Ihn vorher zu laden waere ein Board-Aufruf je Issue, das ohnehin ausscheidet.
 *
 * SYNC: Die fuenf Backlog-Kommentare der Titel- und Label-Gates stehen ohne das Praefix
 * `Nachtlauf: ` als `AUFTRAG_BACKLOG_TEXTE` in kit/board.mjs (`issue auftrag`, Issue
 * #1023). Wer einen hier aendert, aendert ihn dort mit — der Gleichlauf-Test in
 * test/ablauf-board-dokumente-auftrag.test.mjs vergleicht beide Seiten.
 */
export function pruefeIssueGates(top) {
  if (isFachlich(top.title)) {
    return {
      log: `#${top.id} uebersprungen: fachliches Issue ([Fachlich]), wird nicht implementiert.`,
      kommentar: `Nachtlauf: Fachliches Issue — wird nicht implementiert, bitte per /techplan #${top.id} in technische Issues ueberfuehren.`,
    };
  }
  if (isIdee(top.title)) {
    return {
      log: `#${top.id} uebersprungen: Idee ([Idee]), wird nicht implementiert.`,
      kommentar: `Nachtlauf: Idee — mit Abwaegung erst /fachplan #${top.id}, ohne Abwaegung /task #${top.id}, wird nicht implementiert.`,
    };
  }
  if (isPlan(top.title)) {
    return {
      log: `#${top.id} uebersprungen: Plan-Dokument ([Plan]), wird nicht implementiert.`,
      kommentar: `Nachtlauf: Plan-Dokument — wird nicht implementiert, bitte per /issues #${top.id} in Arbeitspakete ueberfuehren.`,
    };
  }
  // Der Menschenschritt (Issue #984): Die Aufgabe liegt ausserhalb des Repositories, kein Zug
  // einer Sitzung erledigt sie. Der Kommentar sagt ausdruecklich, dass die Karte wartet und
  // nicht gescheitert ist — sonst sieht sie im Backlog aus wie ein gescheitertes Paket, und
  // wer morgens die Spalten liest, findet sie nicht mehr da, wo er sie hingelegt hat.
  if (isMensch(top.title)) {
    return {
      log: `#${top.id} uebersprungen: Menschenschritt ([Mensch]), wird nicht implementiert.`,
      kommentar: "Nachtlauf: Menschenschritt — wird nicht implementiert, die Karte wartet auf einen Menschen und ist nicht gescheitert.",
    };
  }
  // Das Label bleibt dabei stehen: Es abzunehmen ist Sache des Menschen (A4).
  if (hatKlaerenLabel(top)) {
    return {
      log: `#${top.id} uebersprungen: traegt ${KLAEREN_LABEL}, eine offene Entscheidung wartet.`,
      kommentar: "Nachtlauf: Traegt kit:klaeren — eine offene Entscheidung wartet auf einen Menschen, wird nicht implementiert.",
    };
  }
  // Auch dieses Label bleibt stehen (E11): Erst wenn der Mensch es abnimmt, prueft das
  // Body-Gate unten die Freigabe.
  if (hatGeschuetztLabel(top)) {
    return {
      log: `#${top.id} uebersprungen: traegt ${GESCHUETZT_LABEL}, eine menschliche Handlung an einer geschuetzten Datei wartet.`,
      kommentar: GESCHUETZT_LABEL_GATE_TEXT,
    };
  }

  const full = gateKarte(top);
  // Vor Review- und Abhaengigkeits-Gate (E10): Der Befund nennt dem Menschen eine Handlung,
  // die teurere Auskunft gehoert zuerst gemeldet.
  const geschuetzt = geschuetztGate(top, full);
  if (geschuetzt) return geschuetzt;
  // Ungepruefte Issues zurueckstellen (Issue #223). Nur wenn ausdruecklich aktiviert:
  // Ein Kit-Update darf keinem Bestandsprojekt ueber Nacht den Runner anhalten, deshalb
  // ist der Default false. Anders als bei [Fachlich]/[Idee] wuerde der Runner ein
  // ungepruftes Issue nicht ablehnen — er wuerde es implementieren, und die Maengel
  // fielen erst im Code auf.
  if (ZUSTAND.config.issueReview?.requiredBeforeReady) {
    const freigabe = reviewFreigabe(full.body);
    if (!freigabe.frei) {
      const texte = GATE_ABLEHNUNG[freigabe.art];
      return {
        log: `#${top.id} ${texte.log()}`,
        kommentar: `Nachtlauf: ${texte.kommentar(top.id)}`,
      };
    }
  }

  // Der Befund erst, wenn es Abhaengigkeiten gibt: Ein Paket mit "Keine." kostet so
  // keinen Abruf der Sperrspalten mehr als vorher.
  if (parseDeps(full.body).length === 0) return null;
  const befund = abhaengigkeitsBefund(top, full.body, satisfiedIds());
  const unmet = befund.abhaengigkeiten.filter((a) => !a.erfuellt).map((a) => a.nummer);
  if (unmet.length > 0) {
    return {
      unmet,
      log: `#${top.id} zurueckgestellt: Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt.`,
      kommentar: `Nachtlauf: Abhaengigkeit ${unmet.map((d) => "#" + d).join(", ")} nicht erfuellt (liegt in Backlog, Ready oder In progress) — Issue zurueckgestellt.`,
      block: abhaengigkeitsBlock(befund),
      kreisLog: befund.kreise.map((k) => kreisLogZeile(top.id, k)),
    };
  }
  // Ein startendes Paket wird nicht zurueckgestellt, also kein Kommentar (E11) — aber der
  // Dokument-Verweis steht im Protokoll.
  const dokumente = befund.abhaengigkeiten.filter((a) => a.dokument);
  if (dokumente.length > 0) {
    const verweise = dokumente.map((a) => `#${a.nummer} (${a.dokument})`).join(", ");
    log(`#${top.id} startet mit Dokument-Verweis: ${verweise} — ein Dokument ist kein Arbeitspaket.`);
  }
  return null;
}

/**
 * Das Gate fuer ein Paket, das eine geschuetzte Datei beim Namen nennt (Issue #1046, Plan
 * #987, E10). Rueckgabe `null`, wenn nichts getroffen ist oder der Mensch nach E5
 * freigegeben hat — sonst `{ art: "geschuetzt", log, kommentar }` mit dem Halt-Text aus
 * `geschuetztKommentar` ohne Label-Zeile; die setzt `geschuetztAmBoardVermerken`, weil erst
 * nach dem `label add` feststeht, wie sie lautet.
 *
 * Gemessen wird gegen die Wurzel der Hauptkopie, nicht gegen einen Worktree: Die lokalen
 * Einstellungen sind nicht versioniert und fehlen dort — ihre Schreibsperren gaelten sonst
 * in der Kette nicht.
 */
export function geschuetztGate(top, full) {
  const body = full?.body || "";
  const treffer = geschuetzteTreffer(body, top.title || full?.title || "", hauptWurzel());
  if (treffer.length === 0) return null;
  const kommentare = kommentareVon(full).map((k) => ({ body: k }));
  if (geschuetztFreigabe(treffer, kommentare, full?.labels || top.labels || [])) return null;
  const fundstellen = treffer.map((t) => `${t.pfad} (Zeile: '${t.zeile.trim()}')`).join("; ");
  return {
    art: "geschuetzt",
    log: `#${top.id} angehalten: nennt geschuetzte Datei ${fundstellen} — ein Mensch nimmt die Aenderung selbst vor und nimmt danach ${GESCHUETZT_LABEL} ab.`,
    kommentar: geschuetztKommentar(treffer),
  };
}

/** Die Wurzel der Hauptkopie: das Verzeichnis, aus dem die Lauf-Config stammt. */
export function hauptWurzel() {
  return ZUSTAND.CONFIG_PATH ? dirname(dirname(ZUSTAND.CONFIG_PATH)) : process.cwd();
}

/**
 * Label und Halt-Kommentar an einem Paket mit geschuetzter Datei (Issue #1046, Plan #987,
 * E11, E14), in dieser Reihenfolge: erst `label add`, dann der Kommentar, der dessen
 * Ausgang als eigene Zeile vermerkt — nur so traegt er die Freigabe-Bedingung aus E5.
 *
 * Das Label geht ueber `boardRoh`: `board()` beendete bei Exit != 0 die ganze Nacht, und
 * ein Board, an dem `kit:geschuetzt` (noch) nicht angelegt ist, weist es ab. Der Fehlschlag
 * steht im Protokoll und im Kommentar; der Lauf geht weiter.
 */
export function geschuetztAmBoardVermerken(karte, gate) {
  const id = String(karte.id);
  const res = abh.boardRoh("issue", "label", "add", id, GESCHUETZT_LABEL);
  const gesetzt = res.status === 0;
  if (!gesetzt) {
    const grund = res.text || "Exit " + res.status;
    log(`#${id}: Label ${GESCHUETZT_LABEL} nicht gesetzt — ${grund}. Der Halt-Kommentar vermerkt es; der Lauf geht weiter.`);
  }
  const zeile = `Label ${GESCHUETZT_LABEL} ${gesetzt ? "gesetzt" : "nicht gesetzt"}`;
  abh.board("issue", "comment", id, "--text", `${gate.kommentar}\n\n${zeile}`);
}

/**
 * Der Salvage-Versuch nach einer Runde, die nichts abgeschlossen hat (Issue #167).
 *
 * Bevor der Lauf hart stoppt, pruefen wir selbst, ob die Arbeit inhaltlich fertig
 * ist. Gruene buildChecks sind das Indiz dafuer, dass die Session nur ihr Ergebnis
 * verloren hat (Hintergrund-Check ohne Folge-Turn) und nicht wirklich gescheitert
 * ist. Genau ein Versuch pro Issue.
 *
 * Vier Ausgaenge, und sie sind nicht dasselbe: `erfolg` (der Lauf geht weiter),
 * `gescheitert` (harter Stopp, die Begruendung steht bereits im Protokoll), `ohneCommit`
 * (Issue #1089: kein Commit, kein Zug — der Aufrufer sichert die Reste im Stash) und
 * `nichtMoeglich` (rote Checks — danach gilt die regulaere Fehlschlag-Meldung des
 * Aufrufers). Wer die letzten beiden zusammenfasst, schreibt entweder eine
 * Fehlschlag-Zeile zu viel oder eine zu wenig.
 *
 * Der Ausgang `gescheitert` traegt seit Issue #672 drei unterscheidbare Endzustaende,
 * weil sie morgens drei verschiedene Griffe verlangen (seit Issue #1089 traegt der erste
 * den eigenen Rueckgabewert `ohneCommit`; die beiden anderen bleiben harter Stopp):
 *   - kein neuer Commit, Karte nicht bewegt -> die Session hat nichts hinterlassen
 *   - neuer Commit, Karte nicht bewegt      -> die Arbeit ist da, der Board-Zug fehlt
 *   - Karte in In review, Baum unsauber     -> die Karte behauptet mehr, als committet ist
 * Ob committet wurde, sagt der Vergleich des Commit-Hashes vor und nach der Session:
 * Der Arbeitsbaum ist vor der regulaeren Runde sauber, ein neuer Commit ist damit die
 * einzige Spur, die die Salvage-Session sicher hinterlaesst.
 */
async function versucheSalvage(top, args, sessionWahl, res, pruefung) {
  const checks = verifyChecksForSalvage(ZUSTAND.config, top.id);
  if (!checks.ok) {
    // Kommando und Ausgabe dazu (Issue #668): Ohne sie stand hier ein Satz, der nur das
    // Urteil nannte. Wer morgens sichtet, braucht den Befund — die letzten Zeilen sind
    // dieselbe Menge, die auch der Salvage-Prompt mitgibt.
    const tail = (checks.output || "").trim().split("\n").slice(-15).join("\n");
    log(`  Salvage nicht moeglich: ${grundCheckRot(checks.rotesKommando ?? "unbenanntes Kommando", "Vorpruefung des Runners")} — die Runde ist wirklich gescheitert.`);
    if (tail) log(`  Ausgabe des roten Checks:\n${tail}`);
    return "nichtMoeglich";
  }
  log(`  SALVAGE-VERSUCH gestartet (Checks extern verifiziert gruen): Issue #${top.id} — Zwischenstand wird gegen das Issue geprueft.`);
  const commitVorher = lastCommitHash();
  await runSession(top.id, args, {
    prompt: salvagePrompt(top.id, checks.output, checks.formatFixCmd),
    timeoutMs: SALVAGE_TIMEOUT_MS,
    // Derselbe Weg wie die regulaere Runde (Issue #665, erweitert um #711): Der Salvage
    // prueft deren Zwischenstand gegen das Issue. Ein anderes Modell beurteilte fremde
    // Arbeit nach anderem Massstab, und die Wahl galt der Karte, nicht der Betriebsart —
    // darum geht bei einer Kommando-Stufe auch die Kommandozeile mit.
    // Der Strom wie in der regulaeren Runde und in der Kette (Issue #871): `sessionStart`
    // haengt `--output-format stream-json` nur bei `args.verbose || opts.stream` an, und
    // `runProcess` misst unter derselben Bedingung. Ohne das Feld lief die Rettung unter
    // `--verbose no` ohne Strom, und ihre Kennzahlen fehlten im Verbrauch der Einheit —
    // entgegen der Zusage in docs/dokumentation.md, dass weder die Datei noch die
    // Kennzahlen an einem Flag haengen.
    stream: true,
    ...sessionWahl,
    extraEnv: { NIGHT_SALVAGE: "1" },
  });
  const salvaged = abh.board("issue", "list", "--status", "in_review").some((i) => Number(i.id) === Number(top.id));
  const reste = abh.gitReste();
  if (salvaged && reste.length === 0) {
    log(`  Salvage erfolgreich, Commit ${lastCommitHash()}, Issue #${top.id} in In review.`);
    // EIN Satz zum Zeitabbruch der regulaeren Runde, nicht der volle Vermerk (Plan #974,
    // E11): Kein Stand-Abschnitt und keine Empfehlung — an einer fertigen Karte ist nichts
    // zu teilen, und wer den Abbruch morgens einordnen will, braucht hier nur die Auskunft,
    // dass die Uhr und nicht die Arbeit die regulaere Runde beendet hat. `ZEITLIMIT_BEENDET`
    // bleibt aus demselben Grund ungesetzt (E8).
    //
    // Der Befund muss durchgereicht werden: `behandleDirtyRunde` kehrt bei `erfolg` sofort
    // zurueck und erreicht seinen eigenen `rundenGrund`-Aufruf nie.
    const zeitlimitSatz = rundenGrund(res, pruefung) === GRUND_ZEITLIMIT
      ? ` Die regulaere Runde endete am Zeitlimit — ${GRUND_ZEITLIMIT}, die Grenze dieser Runde: ${grenzeText(grenzeMinuten(res))}.`
      : "";
    abh.board("issue", "comment", String(top.id), "--text",
      `Nachtlauf: Die regulaere Runde endete ohne Board-Ergebnis, die Pflicht-Checks waren extern aber gruen. Eine Salvage-Session hat den Zwischenstand geprueft, committet und das Issue nach In review verschoben. Bitte beim Review besonders auf Vollstaendigkeit achten.${zeitlimitSatz}`);
    return "erfolg";
  }
  // Der Grund traegt den Protokollsatz woertlich. Wo der Satz die Reste bereits nennt,
  // waere ein zweites `resteText` dieselbe Liste ein zweites Mal — nur beim engen
  // "kein Commit"-Satz kommt sie hier dazu, denn morgens braucht auch er die Namen.
  const commitNachher = lastCommitHash();
  const committet = commitNachher !== commitVorher;
  let satz;
  let grund;
  let kommentar;
  if (salvaged) {
    satz = `SALVAGE WIDERSPRUECHLICH — harter Stopp. Issue #${top.id} steht in In review, obwohl Arbeit liegen blieb; ${resteText(reste)}.`;
    grund = satz;
    kommentar = "Nachtlauf: Die Salvage-Session hat das Issue nach In review verschoben, obwohl Arbeit im Working Tree liegen blieb — Lauf hart gestoppt. Die Karte behauptet mehr, als committet ist. Bitte morgens manuell sichten.";
  } else if (committet) {
    satz = `SALVAGE UNVOLLSTAENDIG — harter Stopp. Issue #${top.id}: Commit ${commitNachher}, Board nicht bewegt; ${resteText(reste)}.`;
    grund = satz;
    kommentar = `Nachtlauf: Die Salvage-Session hat committet, aber Arbeit liegen gelassen und das Board nicht bewegt — Lauf hart gestoppt. Der Commit ${commitNachher} liegt lokal. Bitte morgens manuell sichten.`;
  } else {
    // Ohne Commit und ohne Zug liegt nur der Arbeitsbaum da (Issue #1089, E14): Kein harter
    // Stopp mehr, der Aufrufer sichert die Reste im Stash, und die Nacht laeuft weiter. Die
    // beiden Faelle darueber bleiben harter Stopp — dort kann ein Commit unvollstaendig sein.
    const satzOhne = `SALVAGE-VERSUCH gescheitert. Issue #${top.id}: kein Commit, Board nicht bewegt.`;
    log(`  ${satzOhne}`);
    SALVAGE_GRUND = satzOhne;
    return "ohneCommit";
  }
  log(`  ${satz}`);
  abh.board("issue", "comment", String(top.id), "--text", kommentar);
  // Der Stopp wird HIER gemerkt und nicht beim Aufrufer (Issue #558): Der Text steht an
  // dieser Stelle, und eine Kopie in behandleDirtyRunde waere eine zweite, die
  // auseinanderlaeuft. Der Rueckgabewert bleibt derselbe String wie bisher.
  merkeHartenStopp("harterStopp", grund);
  return "gescheitert";
}

// Die Gruende einer Runde ohne Ergebnis (Issue #668).
//
// Woertliche Konstanten, weil Tests per Regex auf sie pruefen und weil sie in drei
// Ausgaben zugleich erscheinen: Protokoll, Board-Kommentar und `grund` des
// Ergebnisstands. Eine zweite Fassung an einer der drei Stellen waere eine zweite
// Wahrheit ueber denselben Vorgang.
//
// Sie beantworten die Frage, die der bisherige Text offenliess: nicht WAS der Runner
// vorgefunden hat — "nicht in In review UND Working Tree dirty" —, sondern WARUM. Die
// naechsten Schritte sind je Fall verschieden: Ein `end_turn` ohne Commit ist eine
// Session, die auf etwas gewartet hat; ein Zeitlimit heisst, dass die Zeit ausging —
// warum, folgt nicht aus dem Abbruch und steht allenfalls im Vermerk unter
// `ZEITLIMIT_ANKER` am Arbeitspaket; ein `is_error` ist ein Abbruch; ein roter
// Pflichtcheck ist Arbeit am Code.
const GRUND_END_TURN = "Grund: Session regulaer beendet ohne Commit (end_turn)";
const GRUND_ZEITLIMIT = "Grund: Session am Zeitlimit beendet";
const GRUND_IS_ERROR = "Grund: Session mit is_error beendet";
const GRUND_UNBEKANNT = "Grund: Session ohne auswertbares Ergebnis-Ereignis beendet";
const grundCheckRot = (kommando, quelle) => `Grund: Pflichtcheck rot — ${kommando} (${quelle})`;

// --- Die wartende Sitzung (Plan #773, Issue #775) ---
//
// Der fuenfte Grund, und der einzige, der nicht aus einem Feld der CLI kommt, sondern aus
// dem, was die Sitzung zuletzt gesagt hat: Sie hat eine lange Arbeit angestossen, darauf
// gewartet und damit ihren Zug beendet — headless gibt es keinen Folge-Turn. Bis hierher
// sah dieser Ausgang aus wie ein regulaeres Ende ohne Commit, also wie Aufgeben.
//
// Woertliche Konstante aus demselben Grund wie die vier darueber: Der Text erscheint in
// Protokoll, Board-Kommentar und `grund` des Ergebnisstands zugleich.
export const GRUND_WARTEND =
  "Grund: Sitzung hat auf eine selbst angestossene Arbeit gewartet und ist ohne Ergebnis beendet worden";

// Erkannt wird am Schlusstext, nicht am Werkzeug und nicht an der Zeit (Plan #773, A1).
// Die Muster sind benannt, weil sie zwei verschiedene Dinge beschreiben: das Warten auf
// eine selbst angestossene Arbeit — der Fall — und das Warten auf einen Menschen, das
// keiner ist. Eine Sitzung, die auf eine Antwort wartet, hat nichts verloren; ihre Frage
// steht am Board und der Halt-Weg hat sie schon verbucht.
//
// Ueberall `\b…\b`: Ohne Wortgrenze traefe das kurze "GO" der Ausnahmeliste in beliebigen
// Woertern (ALGOL, Logo) und zoege damit echte Faelle aus der Wertung — die Ausnahme hat
// Vorrang, also ist ein Fehltreffer dort teurer als einer in der Musterliste.
const WARTEN_MUSTER = [
  // Case-sensitiv (Issue #1207): Das Verb steht klein ("warte", "wartet", "warten") oder
  // gross am Satzanfang ("Warte", "Wartet"); "Warten" gross ist im Deutschen das
  // Substantiv ("begrenztes Warten auf eine Bedingung") und beschreibt keinen Zustand der
  // Sitzung. Die Versalform bleibt erkannt, wie vor der Schaerfung.
  /\b(?:warte[nt]?|Wartet?|WARTE[NT]?)\s+(?:auf|AUF)\b/,
  /\bl(?:ae|ä)uft\s+noch\b/i,
  // "sobald … fertig ist" — die beiden Woerter stehen selten direkt beieinander
  // ("sobald der Lauf durch ist"), darum eine begrenzte Spanne dazwischen und keine
  // Satzgrenze darin.
  /\bsobald\b[^.!?\n]{0,80}\b(?:fertig|durch)\b/i,
  /\bErgebnis\s+steht\s+noch\s+aus\b/i,
];

// "im Hintergrund" steht nicht in der Musterliste, weil die Wendung ueber den Zeitpunkt
// nichts sagt (Issue #819): Dieselben drei Woerter stehen im Rueckblick einer fertigen
// Sitzung ("die Checks liefen im Hintergrund durch, alles gruen"). Als eigenes Muster
// gewertet, endete eine erledigte Runde als abgebrochen und ihr Paket bekam den Vermerk
// der wartenden Sitzung. Sie zaehlt darum nur zusammen mit einem Warteverb im Praesens —
// das Praeteritum ("liefen") und ein Abschlusswort ("erledigt") bleiben draussen.
const HINTERGRUND_MUSTER = /\bim\s+Hintergrund\b/i;
const HINTERGRUND_PRAESENS_MUSTER = /\b(?:l(?:ae|ä)uft|laufen|warte[nt]?|noch\s+nicht\s+fertig)\b/i;

const WARTEN_AUSNAHME_MUSTER = [
  /\bAntwort\b/i,
  /\bR(?:ue|ü)ckmeldung\b/i,
  /\bFreigabe\b/i,
  // Case-sensitiv und ohne Bindestrich an den Raendern, waehrend die uebrigen Ausnahmen
  // `i` tragen: "GO" ist als kurzes Wort so unspezifisch, dass jede Lockerung es in
  // Bezeichnern treffen laesst ("Go-Test", "GO-Baustein") — und weil die Ausnahme Vorrang
  // hat, zoege jeder solche Treffer einen echten Wartefall aus der Wertung.
  /(?<![\w-])GO(?![\w-])/,
  /\bKl(?:ae|ä)rung\b/i,
  /\bReview\s+durch\b/i,
];

/**
 * Hat diese Sitzung auf eine selbst angestossene Arbeit gewartet (Plan #773, A2)?
 *
 * Reine Funktion neben `rundenGrund` und `istHalt`: nur Text hinein, nur Ja/Nein heraus —
 * kein Board, kein Dateisystem. Nur so ist die Zuordnung an Fixtures pruefbar, ohne eine
 * Nacht zu fahren.
 *
 * Gelesen wird ausschliesslich der Schlusstext. Eine Wartemeldung mitten im Strom bleibt
 * damit folgenlos: Wer spaeter fertig wird, sagt zum Schluss etwas anderes.
 *
 * Exportiert fuer die Tests.
 */
export function wartendeSession(text) {
  const s = typeof text === "string" ? text : "";
  if (s.trim() === "") return false;
  if (WARTEN_AUSNAHME_MUSTER.some((m) => m.test(s))) return false;
  if (HINTERGRUND_MUSTER.test(s) && HINTERGRUND_PRAESENS_MUSTER.test(s)) return true;
  return WARTEN_MUSTER.some((m) => m.test(s));
}

/**
 * Der Anker des Vermerks am Arbeitspaket (Plan #773, A8).
 *
 * Woertlich derselbe Text, den `implement-next` und `implement-done` nennen: Die Skills
 * weisen die naechste Sitzung an, ihn zu melden, statt stillschweigend auf halbem Weg
 * weiterzumachen. Zwei Fassungen waeren zwei Anker, und einer davon fuehrte ins Leere.
 *
 * Exportiert fuer die Tests und die Auswertungswege der Folgepakete.
 */
export const WARTEND_ANKER = "## Nachtlauf: wartende Sitzung";

// Mehr als 2.000 Zeichen Schlusstext sagen ueber den Stand nichts Neues, machen den
// Board-Kommentar aber unlesbar.
const WARTEND_STAND_MAX = 2000;

/**
 * Der Vermerk, den eine wartende Sitzung am Arbeitspaket hinterlaesst (Plan #773, A8).
 *
 * Reine Funktion: Schlusstext und die Pfade aus `gitReste()` hinein, Text heraus. Mehr
 * weiss der Runner nicht — eine Liste der angefangenen und nicht abgeschlossenen Schritte
 * waere geraten und saehe aus wie Wissen.
 *
 * Ist die Pfadliste leer, entfaellt der Abschnitt ersatzlos statt "keine" zu melden: Im
 * Rueckstellungsfall ist der Baum sauber, und eine Meldung ueber nichts ist keine.
 *
 * Einen Fall "Schlusstext fehlt" gibt es nicht — `leseErgebnisText` liefert bei leerem
 * Text `null`, und ohne Schlusstext erkennt `wartendeSession` den Fall gar nicht erst.
 *
 * Exportiert fuer die Tests und die Auswertungswege der Folgepakete.
 */
export function wartendVermerk(schlusstext, pfade = []) {
  const stand = String(schlusstext ?? "");
  const gekuerzt = stand.length > WARTEND_STAND_MAX
    ? `${stand.slice(0, WARTEND_STAND_MAX)}\n\n(Schlusstext auf ${WARTEND_STAND_MAX} Zeichen gekuerzt.)`
    : stand;

  const teile = [
    WARTEND_ANKER,
    "",
    GRUND_WARTEND,
    "",
    "### Zuletzt bekannter Stand",
    "",
    gekuerzt,
  ];

  if (Array.isArray(pfade) && pfade.length > 0) {
    // `resteText` kuerzt ab dem elften Eintrag auf Anzahl und die ersten zehn — dieselbe
    // Darstellung wie in jedem anderen Grund des Runners (night-11).
    teile.push("", "### Im Arbeitsverzeichnis", "", resteText(pfade));
  }

  return `${teile.join("\n")}\n`;
}

/**
 * Der Anker des Zeitabbruch-Vermerks am Arbeitspaket (Plan #974, Issue #976).
 *
 * Neben `WARTEND_ANKER` und aus demselben Grund woertlich: Die implement-Skills weisen die
 * naechste Sitzung an, einen Vermerk unter diesem Anker zu melden, statt stillschweigend
 * auf halbem Weg weiterzumachen. Zwei Fassungen waeren zwei Anker, und einer fuehrte ins
 * Leere.
 */
export const ZEITLIMIT_ANKER = "## Nachtlauf: Zeitgrenze erreicht";

/**
 * Die Grenze in Minuten fuer den Vermerkstext (Issue #976).
 *
 * Fehlt sie, steht das da — eine erfundene Zahl an der Karte waere schlimmer als keine,
 * und "unbekannt" ist dieselbe Regel wie "nicht gemessen" statt 0. Nicht ganze Werte
 * behalten eine Nachkommastelle: Unter `NIGHT_TIMEOUT_MS` sind Grenzen unter einer Minute
 * ueblich, und "0 Minuten" waere falsch.
 */
function grenzeText(grenzeMin) {
  if (typeof grenzeMin !== "number" || !Number.isFinite(grenzeMin)) return "Grenze nicht bekannt";
  return `${Number.isInteger(grenzeMin) ? grenzeMin : grenzeMin.toFixed(1)} Minuten`;
}

/**
 * Die wirksame Grenze dieser Runde in Minuten — oder `null` (Issue #977).
 *
 * Aus `res.timeoutMs`, das `runSession` seit Issue #976 fuehrt, und NICHT aus
 * `args.timeoutMin`: Gerechnet hat die Runde mit dem einen Wert, den `runSession`
 * bestimmt hat — `NIGHT_TIMEOUT_MS`, `opts.timeoutMs` oder das Flag. Eine zweite
 * Herleitung aus dem Flag laege an genau den Stellen daneben, an denen es darauf ankommt.
 *
 * Fehlt das Feld, bleibt es bei `null`; `grenzeText` macht daraus "Grenze nicht bekannt"
 * statt einer erfundenen Zahl.
 */
function grenzeMinuten(res) {
  const ms = res?.timeoutMs;
  return typeof ms === "number" && Number.isFinite(ms) ? ms / 60000 : null;
}

/**
 * Der Vermerk, den ein Zeitabbruch am Arbeitspaket hinterlaesst (Plan #974, Issue #976).
 *
 * Reine Funktion wie `wartendVermerk`: die wirksame Grenze, das Ergebnis des
 * `fortschrittBeobachter` und die Pfade aus `gitReste()` hinein, Text heraus. Wer ihn an
 * die Karte schreibt, entsteht im Folgepaket.
 *
 * `fortschritt` traegt drei unterscheidbare Zustaende, und alle drei stehen verschieden im
 * Text: `null` heisst "nicht beobachtet" (kein Strom — die Kommando-Stufe, ein Lauf ohne
 * `stream`), eine leere Liste heisst "nichts gemeldet", und eine gefuellte traegt den
 * Stand. Die beiden ersten zusammenzufassen waere dieselbe Luege wie eine 0 fuer einen
 * fehlenden Messwert.
 *
 * Der Schlusstext fehlt hier strukturell: Am Zeitlimit wird die Sitzung samt Prozessgruppe
 * gekillt, ein `result`-Ereignis kommt nie an, und `leseErgebnisText` liefert `null`. Was
 * die Sitzung unterwegs gesagt hat, ist alles, was bleibt.
 *
 * Exportiert fuer die Tests und die Verdrahtung des Folgepakets.
 */
export function zeitlimitVermerk(grenzeMin, fortschritt, pfade = []) {
  const zeilen = Array.isArray(fortschritt?.zeilen) ? fortschritt.zeilen : null;

  const stand = [];
  if (zeilen === null) {
    stand.push("Fortschritt nicht beobachtet (kein Strom) — ueber den Stand dieser Sitzung liegt nichts vor.");
  } else if (zeilen.length === 0) {
    stand.push("keine Auskunft der Sitzung — sie hat bis zum Abbruch keine Fortschrittszeile gemeldet.");
  } else {
    stand.push(...zeilen);
    const gesehen = fortschritt.gesehen;
    if (typeof gesehen === "number" && gesehen > zeilen.length) {
      // Ohne diesen Satz saehe eine gekappte Liste wie die ganze aus.
      stand.push("", `(${gesehen} Fortschrittszeilen gemeldet, die juengsten ${zeilen.length} stehen hier.)`);
    }
  }

  const teile = [
    ZEITLIMIT_ANKER,
    "",
    `${GRUND_ZEITLIMIT} — die Grenze dieser Runde: ${grenzeText(grenzeMin)}.`,
    "Das ist kein inhaltlicher Fehlschlag: Die Sitzung wurde an der Uhr abgebrochen, nicht an ihrer Arbeit.",
    "",
    "### Stand nach eigener Auskunft der Sitzung",
    "",
    ...stand,
    "",
    "### Naechster Schritt (Mensch)",
    "",
    "Empfehlung (keine Vorgabe): dieses Paket in Teile schneiden, die je in eine Sitzung passen.",
    "Ob geteilt wird und wie, entscheidet ein Mensch — hier steht keine Aufgabe, sondern ein Vorschlag.",
    "",
    // Kriterium 5 des Fachplans: Der Abbruch ist ein Befund ueber die Uhr und keiner ueber
    // das Paket. Wer ihn als "zu gross geschnitten" liest, hat die Ursache geraten.
    "Aus dem Abbruch folgt keine Aussage ueber seine Ursache: Dass die Zeit ausging, sagt nicht,",
    "ob das Paket zu gross geschnitten war, ob die Sitzung sich verlaufen hat oder ob ein einzelner",
    "Lauf ungewoehnlich lange gebraucht hat.",
  ];

  if (Array.isArray(pfade) && pfade.length > 0) {
    // Wie bei `wartendVermerk`: ohne Pfade entfaellt der Abschnitt ersatzlos, statt "keine"
    // zu melden — und `resteText` kuerzt lange Listen wie in jedem anderen Grund des Runners.
    teile.push("", "### Im Arbeitsverzeichnis", "", resteText(pfade));
  }

  return `${teile.join("\n")}\n`;
}

/**
 * Warum hat diese Runde nichts abgeschlossen (Issue #668)?
 *
 * Reine Funktion ueber dem Ergebnis von `runSession` und der Pruef-Zusammenfassung der
 * Session, damit die Zuordnung an Fixtures pruefbar ist. Die Reihenfolge ist die
 * Rangfolge: Das Zeitlimit schlaegt alles, weil ein gekillter Baum ueber seinen
 * `stop_reason` nichts mehr sagt; danach der Abbruch; danach ein roter Pflichtcheck der
 * Session, weil er konkreter ist als jedes Ende; zuletzt das regulaere Ende.
 *
 * Der Grund der wartenden Sitzung (Plan #773, A4) sitzt hinter dem roten Pflichtcheck und
 * vor `end_turn`: Er VERFEINERT das regulaere Ende und loest es nicht ab — eine Sitzung,
 * die regulaer endet, ohne zu warten, behaelt `GRUND_END_TURN`. Ein anderer `stop_reason`
 * sagt ueber den Ausgang zu wenig, um den Fall zu behaupten.
 *
 * Exportiert fuer die Tests.
 */
export function rundenGrund(res, pruefung) {
  if (res?.error?.code === "ETIMEDOUT" || res?.signal === "SIGTERM") return GRUND_ZEITLIMIT;
  const kennzahlen = leseKennzahlen(res?.stdout);
  if (kennzahlen?.isError === true) return GRUND_IS_ERROR;
  if (pruefung?.zustand === "rot") return grundCheckRot(pruefung.rotesKommando ?? "unbenanntes Kommando", "Session");
  if (kennzahlen?.stopReason === "end_turn") {
    return wartendeSession(leseErgebnisText(res?.stdout)) ? GRUND_WARTEND : GRUND_END_TURN;
  }
  return GRUND_UNBEKANNT;
}

/**
 * Der Vermerk zu einem Grund — oder `null`, wenn dieser Grund keinen traegt (Issue #977).
 *
 * Zwei der Gruende haben einen eigenen Text am Paket: die wartende Sitzung (Plan #773) und
 * der Zeitabbruch (Plan #974). Sie hier zusammenzuführen hat einen Grund: Beide Zweige der
 * Auswertung — Rueckstellung bei sauberem Baum und Fehlschlag bei unsauberem — treffen
 * dieselbe Wahl, und zwei Fassungen davon liefen auseinander. Der Aufrufer entscheidet
 * allein, WIE er den Vermerk setzt: als ganzen Kommentar oder angehaengt an seinen eigenen.
 *
 * `pfade` reicht durch: Im Rueckstellungszweig ist der Baum sauber und die Liste leer, im
 * Fehlschlag-Zweig traegt sie die Reste. Beide Vermerke lassen den Abschnitt bei leerer
 * Liste ersatzlos weg.
 */
/**
 * Der Grund, der eine Rueckstellung bei SAUBEREM Baum benennt — oder `null` (Issue #977).
 *
 * Nur zwei der Gruende erscheinen hier: die wartende Sitzung und der Zeitabbruch. Die
 * uebrigen (is_error, roter Pflichtcheck, regulaeres Ende) bleiben stumm — in diesem Zweig
 * ist der Baum sauber, und der bisherige Rueckstellungstext war fuer sie nie falsch.
 *
 * Die Wartend-Erkennung bleibt bei `wartendeSession` und wechselt NICHT zu `rundenGrund`:
 * Die beiden sind nicht deckungsgleich — `rundenGrund` liefert `GRUND_WARTEND` nur bei
 * `stopReason === "end_turn"` —, und ein stiller Wechsel aenderte das Verhalten von
 * night-55. `rundenGrund` wird allein fuer den Zeitlimit-Fall befragt.
 *
 * Die Reihenfolge entscheidet nichts, sie macht nur sichtbar, dass beides zugleich nicht
 * eintreten kann: Am Zeitlimit wird die Sitzung samt Prozessgruppe gekillt,
 * `leseErgebnisText` liefert `null`, und ohne Schlusstext ist `wartendeSession` nie wahr.
 */
function rueckstellungsGrund(res, pruefung) {
  if (wartendeSession(leseErgebnisText(res?.stdout))) return GRUND_WARTEND;
  if (rundenGrund(res, pruefung) === GRUND_ZEITLIMIT) return GRUND_ZEITLIMIT;
  return null;
}

function rundenVermerk(grund, res, pfade = []) {
  if (grund === GRUND_WARTEND) return wartendVermerk(leseErgebnisText(res?.stdout), pfade);
  if (grund === GRUND_ZEITLIMIT) return zeitlimitVermerk(grenzeMinuten(res), res?.fortschritt, pfade);
  return null;
}

/**
 * Der Halt mit unsauberem Baum (Issue #572, beide Arten seit #1050, E12) — `null`, wenn die
 * Session keinen Halt hinterliess, sonst `hardStop`. Steht VOR dem Salvage: Dessen Auftrag
 * lautet, einen passenden Stand zu committen und die Karte nach In review zu schieben — an
 * einer angehaltenen Karte waere das genau der halbfertige Stand, den der Halt verworfen hat.
 *
 * `kit:klaeren` gilt wie bisher schon am Label allein, der geschuetzte Halt an seinem
 * vollstaendigen Nachweis — sein Label kann fehlen (E11).
 */
function haltMitUnsauberemBaum(top, minutes, vorher) {
  // Frisch gelesen: `top` stammt aus der Ready-Liste VOR der Session und kennt das
  // Label nicht, das die Session selbst gesetzt hat.
  const nachher = abh.board("issue", "get", String(top.id));
  const haltArt = hatKlaerenLabel(nachher) ? "klaeren" : istHalt(vorher, nachher);
  if (!haltArt) return null;
  const befund = haltArt === "klaeren" ? `traegt ${KLAEREN_LABEL}` : "haelt an einer geschuetzten Datei";
  const satz = `HALT MIT UNSAUBEREM BAUM nach ${minutes} min: Issue #${top.id} ${befund}, aber der Working Tree ist dirty — kein Salvage, harter Stopp.`;
  log(`  ${satz}`);
  const getan = haltArt === "klaeren" ? "hat kit:klaeren gesetzt" : "hat den Halt an einer geschuetzten Datei vermerkt";
  abh.board("issue", "comment", String(top.id), "--text",
    `Nachtlauf: Halt mit unsauberem Working Tree — die Session ${getan}, aber Aenderungen liegen gelassen; kein Salvage, Lauf hart gestoppt. Bitte morgens manuell sichten.`);
  merkeHartenStopp("harterStopp", `${satz} ${resteText(abh.gitReste())}`);
  return "hardStop";
}

/**
 * Die Runde hat nichts abgeschlossen und den Baum veraendert (Issue #404). Bis Issue
 * #1089 der vierte harte Stopp; seitdem gehen die Reste in den Stash, und der Lauf geht
 * weiter (E14). Harter Stopp bleibt der Halt mit unsauberem Baum und eine Rettung, die
 * committet oder gezogen hat.
 *
 * Zuerst bekommt der Salvage seinen einen Versuch. Erst wenn der nicht moeglich war
 * — rote Checks —, gilt die regulaere Fehlschlag-Meldung. Ein GESCHEITERTER Salvage
 * hat seine Begruendung dagegen schon protokolliert und kommentiert; die Zeile hier
 * waere die zweite zum selben Fall.
 *
 * Die wartende Sitzung (Plan #773, night-56) wird in BEIDEN Fehlschlag-Wegen vermerkt,
 * nicht nur im Fehlschlag-Zweig unten: Bei `gescheitert` kehrt die Funktion vor
 * `rundenGrund` zurueck, und ohne den eigenen Griff dort entstuende der Befund nur fuer
 * die Haelfte der Faelle. Geprueft wird allein der Schlusstext der REGULAEREN Runde —
 * die Salvage-Session hat mit night-27 bereits drei eigene Endzustaende samt Grund, und
 * ein zweites Urteil ueber denselben Vorgang waere eine zweite Wahrheit.
 *
 * Mit dem Stash geht das Issue ins Backlog (Issue #1089): Bliebe es in Ready, zoege der Lauf
 * es erneut. Vom zurueckgestellten Ticket unterscheiden es Laufstand `abgebrochen` und
 * Kommentar, die beide den Stash nennen. Beim harten Stopp bleibt es liegen, wo es ist.
 *
 * Den Ausschluss der angehaltenen Karte (Issue #572) prueft der Aufrufer vorher, seit
 * Issue #1050 in `haltMitUnsauberemBaum` — er braucht die Karte vor der Session.
 */
async function behandleDirtyRunde(top, args, minutes, salvageAttempted, res, pruefung, sessionWahl) {
  // Vor Salvage und Stash (Issue #1051, E20): Scheiterte die Session am Schutz einer Datei und
  // vermerkte keinen Halt, haelt der Runner das Paket selbst an.
  const auffang = geschuetztAuffangen(top, res, minutes);
  if (auffang) return auffang;
  if (!salvageAttempted.has(String(top.id))) {
    salvageAttempted.add(String(top.id));
    const salvage = await versucheSalvage(top, args, sessionWahl, res, pruefung);
    if (salvage === "erfolg") return "erfolg";
    // Klasse und Grund hat versucheSalvage bereits gemerkt — hier bleibt nur der Ausgang.
    // Ohne Commit (Issue #1089, E14) dieselben Vermerke, danach der Stash statt des Stopps.
    if (salvage === "gescheitert" || salvage === "ohneCommit") return salvageGescheitert(top, salvage, res, pruefung);
  }
  // Der Grund steht VOR dem Zustand (Issue #668): Wer morgens sichtet, liest zuerst,
  // warum die Runde nichts abgeschlossen hat, und danach, was der Runner vorgefunden hat.
  // Der Zustandstext bleibt erhalten — er war nie falsch, nur unvollstaendig.
  const grund = rundenGrund(res, pruefung);
  // `rundenGrund` traegt den Fall der wartenden Sitzung bereits mit seiner Rangfolge —
  // ein zweiter Aufruf von `wartendeSession` hier waere eine zweite Herleitung desselben
  // Befunds, ohne Zeitlimit, Abbruch und roten Pflichtcheck davor.
  const wartend = grund === GRUND_WARTEND;
  if (wartend) WARTEND_BEENDET = true;
  // Derselbe Griff fuer den Zeitabbruch (Issue #977): Der Grund steht schon heute im Text,
  // neu sind Auskunft, Empfehlung und Ursachen-Vorbehalt des Vermerks.
  if (grund === GRUND_ZEITLIMIT) ZEITLIMIT_BEENDET = true;
  const satz = `FEHLSCHLAG nach ${minutes} min: Issue #${top.id} — ${grund}; nicht in In review UND Working Tree dirty.`;
  log(`  ${satz}`);
  // Der Vermerk ERWEITERT den Kommentar, anders als im Rueckstellungsfall: Dort ist er
  // die ganze Botschaft, hier steht der Fehlschlag davor — mit den Pfaden aus
  // `gitReste()`, denn der Baum ist unsauber.
  const vermerk = rundenVermerk(grund, res, abh.gitReste());
  return resteSichern(top, `${satz} ${resteText(abh.gitReste())}`, `Nachtlauf: Runde fehlgeschlagen und Working Tree nicht sauber hinterlassen. ${grund}.`, vermerk);
}

// Die Werkzeuge, mit denen eine Session Dateien schreibt. Abweisungen anderer Werkzeuge —
// vor allem `Bash` durch den Hook `bash-pruefen` — stehen in derselben Liste und zaehlen
// hier nicht.
const SCHREIBWERKZEUGE = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * Ein Pfad mit aufgeloesten Verweisen, auch wenn die Datei oder ihre Ordner (noch) fehlen:
 * aufgeloest wird der naechste vorhandene Vorfahre, der Rest haengt woertlich daran. Sonst
 * stuende unter macOS `/var/…` neben `/private/var/…`, und kein Pfad laege im Baum.
 */
function echterPfad(pfad) {
  let kopf = resolve(pfad);
  const rest = [];
  while (!existsSync(kopf) && dirname(kopf) !== kopf) {
    rest.unshift(basename(kopf));
    kopf = dirname(kopf);
  }
  try {
    return join(realpathSync(kopf), ...rest);
  } catch {
    return resolve(pfad);
  }
}

/** Die `permission_denials` einer Zeile des Streams, wenn sie eine `result`-Zeile ist, sonst `[]`. */
function abweisungenDerZeile(zeile) {
  if (!zeile.includes("permission_denials")) return [];
  try {
    const ereignis = JSON.parse(zeile);
    return ereignis?.type === "result" && Array.isArray(ereignis.permission_denials) ? ereignis.permission_denials : [];
  } catch {
    return [];
  }
}

/**
 * Die Pfade, deren Schreibanfrage die Session abgewiesen bekam (Issue #1051, Beleg an Issue
 * #1042): aus `permission_denials` der `result`-Zeilen des `stream-json`, je Eintrag mit
 * `tool_name` eines Schreibwerkzeugs und `tool_input.file_path`. Relativ zum Arbeitsbaum der
 * Session, damit sie gegen die Sperrliste der Projektwurzel gelesen werden koennen; ein Pfad
 * ausserhalb des Baums faellt weg. Reine Funktion ueber den Text.
 */
export function abgewieseneSchreibpfade(stream, baum = process.cwd()) {
  const wurzel = echterPfad(baum);
  const pfade = [];
  for (const d of String(stream ?? "").split("\n").flatMap(abweisungenDerZeile)) {
    const datei = d?.tool_input?.file_path ?? d?.tool_input?.notebook_path;
    if (!SCHREIBWERKZEUGE.has(d?.tool_name) || typeof datei !== "string") continue;
    const rel = relative(wurzel, echterPfad(isAbsolute(datei) ? datei : join(wurzel, datei)));
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) pfade.push(rel.split("\\").join("/"));
  }
  return [...new Set(pfade)];
}

/**
 * Der Auffang aus E20 (Issue #1051): Traegt der Stream der Session eine abgewiesene
 * Schreibanfrage auf einen geschuetzten Pfad, sichert der Runner den Zwischenstand im Stash,
 * zieht die Karte nach Backlog, vermerkt den Halt wie der Rueckfall der Skills (Label, dann
 * Anker-Kommentar mit dem Ort des Zwischenstands) und macht mit dem naechsten Paket weiter.
 * `null`, wenn kein solcher Pfad abgewiesen wurde oder sich der Baum nicht sichern liess —
 * dann greift der Bestand (Salvage, Stash oder harter Stopp).
 */
function geschuetztAuffangen(top, res, minutes) {
  const pfade = abgewieseneSchreibpfade(res?.stdout);
  if (pfade.length === 0) return null;
  const id = String(top.id);
  const pruef = abh.boardRoh("issue", "check-geschuetzt", id, ...pfade.flatMap((p) => ["--pfad", p]));
  const abgewiesen = (pruef.json?.treffer ?? []).filter((t) => t.zeile === GESCHUETZT_ABGEWIESEN);
  if (abgewiesen.length === 0 || !pruef.json?.kommentar) return null;

  const { ok, name, meldung } = resteInStash(top);
  if (!ok) {
    log(`  Auffang an geschuetzter Datei fuer Issue #${id} nicht moeglich: Reste nicht im Stash gesichert (${meldung}).`);
    return null;
  }
  const dateien = [...new Set(abgewiesen.map((t) => t.pfad))].join(", ");
  log(`  AUFFANG GESCHUETZT nach ${minutes} min: Issue #${id} — die Session scheiterte beim Schreiben an ${dateien} und vermerkte keinen Halt; Zwischenstand im Stash „${name}“, Issue ins Backlog, weiter.`);
  abh.board("issue", "move", id, "backlog");
  geschuetztAmBoardVermerken(top, { kommentar: `${pruef.json.kommentar}\n\nZwischenstand: Stash „${name}“ (\`git stash list\`).` });
  HALT_ART = "geschuetzt";
  return "angehalten";
}

/**
 * Die Rettung ist gescheitert (`gescheitert`) oder blieb ohne Commit (`ohneCommit`, Issue
 * #1089): erst die Vermerke der regulaeren Runde, dann harter Stopp oder Stash.
 */
function salvageGescheitert(top, salvage, res, pruefung) {
  const schlusstext = leseErgebnisText(res?.stdout);
  if (wartendeSession(schlusstext)) {
    WARTEND_BEENDET = true;
    // Vorangestellt, nicht ersetzt: Der night-27-Grund ist die konkretere Auskunft
    // ueber das, was morgens im Arbeitsverzeichnis liegt, und war nie falsch — zwei
    // Vorgaenge sind zu berichten: warum die regulaere Runde nichts hinterliess, und
    // was der Salvage vorfand.
    if (salvage === "gescheitert") merkeHartenStopp("harterStopp", `${GRUND_WARTEND}; ${ZUSTAND.STOPP_GRUND}`);
    else SALVAGE_GRUND = `${GRUND_WARTEND}; ${SALVAGE_GRUND}`;
    abh.board("issue", "comment", String(top.id), "--text", wartendVermerk(schlusstext, abh.gitReste()));
  } else if (rundenGrund(res, pruefung) === GRUND_ZEITLIMIT) {
    // Derselbe eigene Griff wie fuer die wartende Sitzung darueber, und aus demselben
    // Grund (Issue #977): Dieser Zweig kehrt zurueck, bevor der Fehlschlag-Zweig unten
    // mit `rundenGrund` erreicht ist — ohne ihn entstuende der Befund nur fuer die
    // Haelfte der Faelle. Der Stopp-Grund bleibt unangetastet: Der night-27-Satz
    // benennt, was morgens im Arbeitsverzeichnis liegt, der Zeitabbruch steht im
    // Vermerk und am Feld `zeitlimitBeendet` der Einheit.
    //
    // `else if`, nicht ein zweites `if`: Zeitlimit und wartend schliessen einander aus
    // (am Zeitlimit kommt kein `result`-Ereignis an, `leseErgebnisText` liefert `null`),
    // und zwei Vermerke zu derselben Runde waeren zwei Wahrheiten ueber sie.
    ZEITLIMIT_BEENDET = true;
    abh.board("issue", "comment", String(top.id), "--text",
      zeitlimitVermerk(grenzeMinuten(res), res?.fortschritt, abh.gitReste()));
  }
  if (salvage === "gescheitert") return "hardStop";
  return resteSichern(top, `${SALVAGE_GRUND} ${resteText(abh.gitReste())}`,
    "Nachtlauf: Pflicht-Checks extern gruen, aber die Salvage-Session hat weder committet noch das Board bewegt.");
}

/**
 * Die Pfade der Reste, wie `gitReste()` sie zaehlt — aus `git status -z`, damit Leerzeichen,
 * Anfuehrungszeichen und Umbenennungen (beide Pfade) heil ankommen.
 */
function restPfade(cwd = process.cwd()) {
  const res = spawnSync("git", ["status", "--porcelain", "-z", ...gitRestePathspec(gitResteAusnahmen())], { encoding: "utf-8", cwd });
  if (res.status !== 0) return [];
  const teile = res.stdout.split("\0").filter(Boolean);
  const pfade = [];
  let i = 0;
  while (i < teile.length) {
    pfade.push(teile[i].slice(3));
    // Eine Umbenennung traegt ihren alten Pfad als naechsten Eintrag.
    if (/^[RC]/.test(teile[i])) pfade.push(teile[i + 1]);
    i += /^[RC]/.test(teile[i]) ? 2 : 1;
  }
  return pfade;
}

/** Der Name des Stashs, in dem die Reste eines abgebrochenen Pakets liegen (E14). */
const nachtrestName = (id, lauf) => `nachtrest #${id} ${lauf ?? "ohne-lauf"}`;

/**
 * Legt die Reste eines Pakets in den Stash `nachtrest #<id> <lauf>`. Gesichert wird genau,
 * was `gitReste()` als Rest zaehlt — samt unversionierter Dateien, ohne Journal, Protokoll und
 * Board-Dateien. `ok` erst, wenn der Baum danach sauber ist.
 */
function resteInStash(top) {
  const name = nachtrestName(top.id, ZUSTAND.LAUF_STEMPEL);
  // Die Pfade einzeln und woertlich, nicht die Ausschluesse als Pathspec: `git stash push`
  // bricht ab, sobald ein Ausschluss auf eine ignorierte Datei zeigt.
  // Ohne Pfad kein Aufruf: `git stash push` ohne Pathspec saehe alles, auch Journal und Protokoll.
  const pfade = restPfade();
  const res = pfade.length > 0
    ? spawnSync("git", ["stash", "push", "--include-untracked", "-m", name, "--", ...pfade.map((p) => `:(literal)${p}`)], { encoding: "utf-8", cwd: process.cwd() })
    : { status: 1, stderr: "keine Pfade der Reste lesbar" };
  if (res.status === 0 && abh.gitClean()) return { ok: true, name };
  return { ok: false, name, meldung: ersteZeile(res.stderr || res.stdout || "Exit " + res.status) };
}

/**
 * Sichert die Reste eines gescheiterten Pakets im Stash (Issue #1089, Plan #1079 E14) und
 * legt die Karte nach Backlog: Die Nacht laeuft weiter, und das naechste Paket baut nicht auf
 * halben Aenderungen auf. Laesst sich der Baum so nicht saeubern, bleibt es beim harten
 * Stopp: Weiterbauen auf einem unsauberen Baum ist genau das, was der Stash verhindern soll.
 */
function resteSichern(top, grund, kommentar, vermerk = null) {
  const { ok, name, meldung } = resteInStash(top);
  if (!ok) {
    const satz = `HARTER STOPP: Reste zu Issue #${top.id} liessen sich nicht im Stash sichern (${meldung}).`;
    log(`  ${satz}`);
    abh.board("issue", "comment", String(top.id), "--text", `${kommentar} Die Reste liessen sich nicht im Stash sichern — Lauf hart gestoppt. Bitte morgens manuell sichten.`);
    merkeHartenStopp("harterStopp", `${satz} ${grund}`);
    return "hardStop";
  }
  log(`  Reste zu Issue #${top.id} im Stash „${name}“ gesichert — Issue ins Backlog, weiter.`);
  const text = `${kommentar} Die Reste liegen im Stash „${name}“ (\`git stash list\`), die Karte geht ins Backlog, und der Lauf geht weiter.`;
  abh.board("issue", "comment", String(top.id), "--text", vermerk ? `${text}\n\n${vermerk}` : text);
  abh.board("issue", "move", String(top.id), "backlog");
  ABBRUCH_GRUND = `${grund} Reste im Stash „${name}“.`;
  return "abgebrochen";
}

/**
 * Wertet aus, was eine Implementierungs-Runde hinterlassen hat (Issue #404).
 *
 * Rueckgabe: `"erfolg"`, `"fehlschlag"`, `"hardStop"`, `"angehalten"` (Issue #572)
 * oder `"deferred"`. Die Worte sind die Zaehler des Laufs; der Unterschied zwischen
 * ihnen ist das Signal, das der Morgen liest.
 */
/**
 * Der Mangel am Nachweis, oder `null` — Grund fuer Log und Board in einem.
 *
 * `geprueft` und `leeresPaket` sind Erfolg wie bisher; die drei uebrigen Zustaende
 * sind es nicht. Jeder traegt seinen eigenen Text: #463 verlangt, dass der Betreiber
 * den Grund von Absturz und Infrastrukturfehler unterscheiden kann, und der
 * generische "Session ohne In-review-Ergebnis" leistet das nicht.
 */
function nachweisMangel(pruefung) {
  const zustand = pruefung?.zustand;
  if (zustand === "ungeprueft") {
    return "Nachweis fehlt — die Session hat keine Pruefung gefahren";
  }
  if (zustand === "unlesbar") {
    return `Nachweis unlesbar (${pruefung.fehler})`;
  }
  if (zustand === "rot") {
    return `Nachweis rot — ${pruefung.rotesKommando} endete ${pruefung.rotesErgebnis}`;
  }
  return null;
}

/**
 * Der Grund, aus dem werteRunde ein Paket zuruecklegt (Issue #488).
 *
 * Ein Text fuer Board-Kommentar und Ergebnisstand: Zwei Formulierungen desselben
 * Vorgangs waeren zwei Wahrheiten darueber, warum das Paket liegen blieb.
 */
const DEFERRED_GRUND = "Session ohne In-review-Ergebnis beendet — Issue zurueckgestellt, Lauf ging mit dem naechsten Issue weiter.";

/**
 * Der Grund, aus dem eine Runde ohne jede Board-Aenderung endet (Issue #927).
 *
 * Eine EIGENE Konstante neben `DEFERRED_GRUND`, nicht dessen zweite Verwendung: Die
 * Faelle sind verschieden — dort wurde ein Zustand gelesen und war nicht `in_review`,
 * hier ist er unbekannt —, und ihr Text ist das Einzige, woran der Morgen sie
 * unterscheidet. Ein nicht lesbarer Zustand ist keine Aussage ueber die Spalte, also
 * folgt ihm auch keine Rueckstellung.
 */
const ZUSTAND_UNLESBAR_GRUND = "Zustand der Karte war nicht lesbar — Karte und Commit bleiben unangetastet, Lauf geht mit dem naechsten Issue weiter.";

/**
 * Uebersetzt den Rueckgabewert von werteRunde in die Felder der Einheit (Issue #488).
 *
 * Die Woerter der Zaehler (`deferred`, `hardStop`) und das Vokabular des
 * Ergebnisstands (`zurueckgestellt`, `harterStopp`) bleiben getrennt: Die Zaehler
 * gehoeren dem Textprotokoll und den bestehenden Tests, die Einheit dem Leitstand.
 */
/**
 * Das Feld `wartendBeendet` fuer die Einheit — oder gar keines (Issue #776).
 *
 * Die eine Stelle, an der alle drei Auswertungswege des Plans #773 ihren Befund in die
 * Einheit bringen. Ohne den Fall bleibt das Feld WEG statt `false` zu tragen: Dieselbe
 * Linie wie bei den nicht gemessenen Feldern des Ergebnisstands — ein `false` behauptete
 * eine Messung, die es nicht gab, und eine Zaehlung ueber mehrere Naechte kaeme auf
 * dieselbe Zahl, egal ob gemessen wurde oder nicht.
 *
 * `ausgang` ruehrt es nicht an: Ausgang und Weiterlauf haengen am Zustand des
 * Arbeitsverzeichnisses und nicht an diesem Fall.
 */
function wartendFelder() {
  return WARTEND_BEENDET ? { wartendBeendet: true } : {};
}

/**
 * Das Feld `zeitlimitBeendet` fuer die Einheit — oder gar keines (Issue #977).
 *
 * Dieselbe Anlage wie `wartendFelder` darueber und aus demselben Grund: Ohne den Fall
 * bleibt das Feld WEG statt `false` zu tragen. Ein `false` behauptete eine Messung, die es
 * nicht gab, und eine Zaehlung ueber mehrere Naechte kaeme auf dieselbe Zahl, egal ob
 * gemessen wurde oder nicht. Die Auswertung der Zielmarke (Issue #978) liest genau dieses
 * Feld, um Zeitabbrueche aus ihren Mittelwerten herauszuhalten.
 */
function zeitlimitFelder() {
  return ZEITLIMIT_BEENDET ? { zeitlimitBeendet: true } : {};
}

function ausgangsFelder(ausgang) {
  if (ausgang === "deferred") return { ausgang: "zurueckgestellt", grund: DEFERRED_GRUND };
  if (ausgang === "hardStop") return { ausgang: "harterStopp" };
  // Das Paket ist an sich selbst gescheitert, seine Reste liegen im Stash (Issue #1089).
  if (ausgang === "abgebrochen") return { ausgang, grund: ABBRUCH_GRUND };
  // `angehalten` braucht keinen eigenen Zweig (Issue #572): Der Default liefert
  // `{ ausgang: "angehalten" }`, und einen Grund traegt der Halt nicht — er steht
  // als Kommentar der Session an der Karte, und eine zweite Fassung waere eine
  // zweite Wahrheit ueber denselben Vorgang.
  return { ausgang };
}

/**
 * Hat die Session einen VOLLSTAENDIG nachgewiesenen Halt hinterlassen (Issue #572)?
 *
 * Drei Spuren muessen zusammenkommen — die vierte, der saubere Arbeitsbaum, hat der
 * Dirty-Guard beim Aufrufer bereits geprueft. Das Label allein genuegt ausdruecklich
 * nicht: Eine Session kann nach dem Label und vor Kommentar oder Move abbrechen, und
 * der Infrastruktur-Guard laesst ein Timeout absichtlich passieren. Fehlt eine Spur,
 * faellt die Runde auf den bisherigen Rueckstellungsweg zurueck.
 *
 * Gewertet wird nur, was WAEHREND der Session hinzukam — ueber `neueKommentare`,
 * dieselbe Funktion, die auch der Review-Modus benutzt. Ein Zeitstempel wird nicht
 * herangezogen: Ein Zeitfenster belegt keine Urheberschaft (Issue #568).
 *
 * Rueckgabe ist die ART des Halts (Issue #1050, Plan #987, E12): `"klaeren"` fuer eine
 * Stopp-Frage (`kit:klaeren` samt `HALT_FOLGESATZ`), `"geschuetzt"` fuer eine Session, die
 * erst beim Schreiben am Schutz scheiterte (`GESCHUETZT_ANKER` in einem neuen Kommentar),
 * sonst `null`. Das Label ist fuer den geschuetzten Halt keine Spur: Es kann nach E11
 * fehlen, wenn es am Board nicht angelegt ist. Wer beide Arten zu einem `true` faltete,
 * meldete morgens eine Entscheidung, wo eine Handlung wartet.
 */
export function istHalt(vorher, nachher) {
  if (nachher?.status !== "backlog") return null;
  const neue = neueKommentare(vorher, nachher).map(String);
  if (hatKlaerenLabel(nachher) && neue.some((text) => text.includes(HALT_FOLGESATZ))) return "klaeren";
  if (neue.some((text) => text.includes(GESCHUETZT_ANKER))) return "geschuetzt";
  return null;
}

/** Die Logzeile nach `istHalt`, je Art des Halts (Issue #1050). */
const HALT_LOG_TEXT = {
  klaeren: "eine offene Entscheidung wartet auf einen Menschen",
  geschuetzt: "eine Handlung an einer geschuetzten Datei wartet auf einen Menschen",
};

/** Der Laufstand eines angehaltenen Pakets, je Art des Halts (Issue #1050). */
const HALT_STAND_TEXT = {
  klaeren: "eine offene Entscheidung wartet am Board auf einen Menschen",
  geschuetzt: "eine Handlung an einer geschuetzten Datei wartet am Board auf einen Menschen",
};

/**
 * Wertet eine gelaufene Runde aus. Die Angaben kommen als EIN Objekt statt als acht
 * Parameter (Sonar S107): Die einzige Aufrufstelle uebergibt ohnehin die Felder einer
 * Runde, und benannt gelesen kann keine zwei von ihnen die Reihenfolge vertauschen.
 *
 * Exportiert fuer die Tests: Mit eingesetztem Board und git pruefen sie die Auswertung im
 * selben Prozess (Plan #1199, E6).
 */
export async function werteRunde({ top, res, minutes, args, salvageAttempted, pruefung, vorher, sessionWahl }) {
  // Der Zustand kommt vom Einzelabruf an der Karte, nicht aus der Sammelliste
  // `issue list --status in_review` (Issue #927): Im Lauf night-run-2026-09-25-061517
  // fuehrte die Liste eine Karte nicht, die nachweislich in In review stand — die
  // Session hatte sie dorthin gezogen, gruen geprueft und committet —, und der Runner
  // stellte ein fertiges Paket zurueck. `leseKarte` fragt dort, wo die Antwort
  // eindeutig ist; denselben Weg geht der Ketten-Pfad in `paketeAbschliessen`.
  const kartenStatus = abh.leseKarte(top.id)?.status ?? null;
  // Unbekannter Zustand: KEINE Board-Mutation. Aus fehlendem Wissen eine
  // Rueckstellung zu machen ist genau der Fehlgriff, den dieses Paket behebt. Der
  // Ausgang ist `fehlschlag` — das Wort des Laufs fuer "Karte bleibt, Commit bleibt,
  // weiter"; WARUM sie bleibt, sagt allein diese Log-Zeile.
  if (kartenStatus === null) {
    log(`  Fehlschlag nach ${minutes} min: Issue #${top.id} — ${ZUSTAND_UNLESBAR_GRUND}`);
    return "fehlschlag";
  }
  if (kartenStatus === "in_review") return werteInReview(top, minutes, pruefung);

  // Infrastruktur-Guard (Issue #149): Exit != 0 ohne Timeout heisst, das CLI selbst
  // ist gescheitert (Auth abgelaufen, Fehlkonfiguration) — mit dem Issue ist nichts
  // falsch. Harter Stopp ohne Kommentar und ohne Backlog-Move, sonst raeumt eine
  // kaputte Umgebung die ganze Ready-Spalte leer.
  //
  // Seit Issue #1088 (E13) nur noch, wenn die Sitzung kein Ereignis gemeldet hat, und erst
  // nach dem einen Versuch in runSession: Eine Sitzung, die zustande kam und mit Exit
  // ungleich 0 endete, ist ein Paketfehler und geht den Weg jeder Runde ohne Ergebnis.
  // Die Kommando-Stufe meldet keine Ereignisse und bleibt beim harten Stopp.
  const timedOut = res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM";
  const kommando = Boolean(sessionWahl?.kommando);
  if (!timedOut && (res.error || res.status !== 0) && (kommando || !hatSitzungsereignis(res.stdout))) {
    const exitInfo = exitText(res);
    const detail = (res.stderr || res.stdout || "").trim().split(/\r?\n/).slice(0, 3).join(" | ");
    const kopf = `INFRASTRUKTUR-FEHLSCHLAG nach ${minutes} min (${exitInfo}): Session-Start gescheitert — harter Stopp, Issue #${top.id} bleibt unangetastet.`;
    log(`  ${kopf}`);
    if (detail) log(`  CLI-Meldung: ${detail}`);
    // Beide Protokollzeilen, in derselben Reihenfolge (Issue #558): Die CLI-Meldung ist
    // hier das Einzige, was den Ausfall benennt — exitInfo allein sagt nur, dass es ihn gab.
    merkeHartenStopp("umgebung", detail ? `${kopf}\nCLI-Meldung: ${detail}` : kopf);
    anhaltenVermerken(detail ? `Sitzungsstart gescheitert (${exitInfo}): ${detail}` : `Sitzungsstart gescheitert (${exitInfo})`);
    return "hardStop";
  }

  if (!abh.gitClean()) return haltMitUnsauberemBaum(top, minutes, vorher) ?? behandleDirtyRunde(top, args, minutes, salvageAttempted, res, pruefung, sessionWahl);

  // Der Halt-Zweig (Issue #572) — NACH dem Infrastruktur- und dem Dirty-Guard und VOR
  // der Rueckstellung. Ein abgestuerztes CLI und ein unsauberer Baum sind auch dann
  // kein Halt, wenn das Label steht. Hier ist der Halt kein Fehler: eigene Log-Zeile,
  // kein Board-Kommentar und kein Move — beides hat die Session bereits getan.
  const haltArt = istHalt(vorher, abh.board("issue", "get", String(top.id)));
  if (haltArt) {
    HALT_ART = haltArt;
    log(`  angehalten: ${HALT_LOG_TEXT[haltArt]} — Issue #${top.id} nach ${minutes} min von der Session ins Backlog gezeichnet, kein Kommentar und kein Move durch den Runner, weiter.`);
    return "angehalten";
  }

  return stelleRundeZurueck(top, res, minutes, pruefung);
}

/**
 * Der Erfolgspfad: Die Karte steht in In review (Issue #404, herausgezogen in #927).
 *
 * Steht getrennt von `werteRunde`, seit dort mit dem unlesbaren Zustand eine dritte
 * Verzweigung hinzukam: Die Auswertung liest sich sonst als eine Folge von Guards, in
 * deren erstem Zweig zwei weitere Guards stecken.
 */
function werteInReview(top, minutes, pruefung) {
  log(`  Erfolg nach ${minutes} min, Commit ${lastCommitHash()}, Issue #${top.id} in In review.`);
  // Rest-Guard (Issue #152): Eine erfolgreiche Runde muss den Tree sauber
  // hinterlassen. Unkommittete Reste (z. B. Temp-Dateien) wuerden die
  // Diagnose der Folgerunde verfaelschen und koennten sie faelschlich als
  // dirty hart stoppen — darum hier stoppen, wo die Ursache noch klar ist.
  const reste = abh.gitReste();
  if (reste.length > 0) {
    const satz = `HARTER STOPP: erfolgreiche Runde zu Issue #${top.id} hat unkommittete Reste hinterlassen — bitte morgens sichten und aufraeumen.`;
    log(`  ${satz}`);
    merkeHartenStopp("harterStopp", `${satz} ${resteText(reste)}`);
    return "hardStop";
  }
  // Nachweis-Guard (Issue #471): NACH dem Rest-Guard und nur hier, im
  // In-review-Pfad. Stuende er weiter oben, griffe er auch fuer eine Karte in
  // Ready — und weil die Karte dabei liegen bleibt, zoege die naechste Iteration
  // dasselbe Issue erneut, bis MAX_ITERATIONS erschoepft ist. Dazu bekaeme ein
  // gescheiterter CLI-Start (Infrastruktur-Guard, #149) den Kommentar "keine
  // Pruefung gefahren", und der Dirty-Guard waere umgangen.
  const mangel = nachweisMangel(pruefung);
  if (mangel) {
    log(`  Fehlschlag nach ${minutes} min: Issue #${top.id} in In review, aber ${mangel} — Karte bleibt, Commit bleibt, weiter.`);
    abh.board("issue", "comment", String(top.id),
      "--text", `Nachtlauf: ${mangel}. Die Karte bleibt in In review und der Commit unangetastet — bitte den Stand pruefen.`);
    return "fehlschlag";
  }
  return "erfolg";
}

/**
 * Der Rueckstellungsweg: kein In-review-Ergebnis, Arbeitsbaum sauber, kein Halt
 * (Issue #488, um die wartende Sitzung erweitert in #776).
 *
 * Steht getrennt von `werteRunde`, seit der Zweig zwei Faelle unterscheidet — die
 * Auswertung liest sich sonst als eine Folge von Guards mit einem Schluss, der selbst
 * wieder verzweigt.
 *
 * Der Fall der wartenden Sitzung (Plan #773) VERFEINERT die Rueckstellung und loest sie
 * nicht ab: Ausgangsart, Backlog-Move und Weiterlauf haengen am Zustand des
 * Arbeitsverzeichnisses, und der ist hier sauber. Anders ist nur, was der Morgen liest —
 * ein Text, der den Fall benennt, statt eine geordnete Rueckstellung zu behaupten.
 */
function stelleRundeZurueck(top, res, minutes, pruefung) {
  const grund = rueckstellungsGrund(res, pruefung);
  if (grund === GRUND_WARTEND) WARTEND_BEENDET = true;
  if (grund === GRUND_ZEITLIMIT) ZEITLIMIT_BEENDET = true;
  // Der Grund steht VOR dem Zustand — dieselbe Ordnung wie im Dirty-Zweig (Issue #668):
  // erst warum die Runde nichts abgeschlossen hat, dann was der Runner vorgefunden hat.
  const grundTeil = grund ? ` — ${grund};` : "";
  log(`  Fehlschlag nach ${minutes} min: Issue #${top.id}${grundTeil} nicht in In review, Tree sauber — Issue ins Backlog, weiter.`);
  // Der Vermerk IST der Kommentar: Er traegt seinen Grund bereits im Wortlaut, und ein
  // vorangestelltes zweites Mal waere dieselbe Aussage doppelt. Ohne Pfade — in diesem
  // Zweig ist der Baum sauber, und eine Meldung ueber nichts ist keine.
  const vermerk = rundenVermerk(grund, res);
  abh.board("issue", "comment", String(top.id), "--text", vermerk ?? `Nachtlauf: ${DEFERRED_GRUND}`);
  abh.board("issue", "move", String(top.id), "backlog");
  return "deferred";
}

/**
 * Ein Paket, das an einem Gate haengenbleibt: Log, Board-Kommentar, Backlog — und
 * seine Einheit im Ergebnisstand (Issue #404, erweitert um #488).
 *
 * Die Einheit traegt denselben Text, der am Board haengt. Als blosser Zaehler bliebe
 * morgens offen, WELCHES Issue an welchem Gate liegt.
 */
function stelleAmGateZurueck(top, gate) {
  log(gate.log);
  // Beim geschuetzten Treffer erst der Move, dann Label und Kommentar (E11) — der Kommentar
  // ist der Halt-Text samt Label-Zeile, ein zweiter entsteht nicht.
  if (gate.art === "geschuetzt") {
    abh.board("issue", "move", String(top.id), "backlog");
    geschuetztAmBoardVermerken(top, gate);
    einheitErgaenzen(einheitAnlegen(top.id, top.title), { ausgang: "zurueckgestellt", grund: gate.log });
    return;
  }
  // Die zweite Logzeile je Kreis (Issue #1063, E10) — die erste bleibt einzeilig wie bisher.
  for (const zeile of gate.kreisLog ?? []) log(zeile);
  // Der Befund-Block des Abhaengigkeits-Gates (Issue #1062, E10) nur hier, an der Karte.
  const text = gate.block ? `${gate.kommentar}\n\n${gate.block}` : gate.kommentar;
  abh.board("issue", "comment", String(top.id), "--text", text);
  abh.board("issue", "move", String(top.id), "backlog");
  einheitErgaenzen(einheitAnlegen(top.id, top.title), { ausgang: "zurueckgestellt", grund: gate.kommentar });
  // Haengt das Paket an einem Paket, das in diesem Lauf abgebrochen ist, wartet es (E15) —
  // zusaetzlich zum Rueckstell-Kommentar, der unveraendert bleibt.
  const an = (gate.unmet ?? []).filter((n) => ABGEBROCHENE_PAKETE.has(Number(n)));
  if (an.length > 0) standSetzen(top.id, "wartet", an.map((n) => `hängt an #${n} (abgebrochen in diesem Lauf)`).join("\n"));
}

/**
 * Uebernimmt `night.stufen` und `night.stufenRegel` frisch von Platte in die Lauf-Config
 * (Issue #711, Plan #707, E19).
 *
 * Geschrieben wird in dieselbe `config`, mit der der Lauf ohnehin arbeitet: Eine zweite,
 * daneben gefuehrte Fassung der Einstellung waere eine zweite Wahrheit darueber, was
 * gerade gilt. Ein Feld, das auf Platte verschwunden ist, verschwindet auch hier — sonst
 * bliebe eine geloeschte Stufe bis zum Laufende aktiv.
 */
function stufenFelderAuffrischen() {
  const { stufen, stufenRegel, grund } = frischeStufenFelder(ZUSTAND.CONFIG_PATH, ZUSTAND.config);
  if (grund) log(`  ${grund}`);
  ZUSTAND.config.night ??= {};
  for (const [feld, wert] of [["stufen", stufen], ["stufenRegel", stufenRegel]]) {
    if (wert === undefined) delete ZUSTAND.config.night[feld];
    else ZUSTAND.config.night[feld] = wert;
  }
}

/**
 * Die Hinweiszeile einer Runde zur Modellwahl, oder `null` (Issue #665, erweitert um #711
 * und #846).
 *
 * Sie erscheint nur, wenn es etwas zu sagen gibt — eine Stufe im Spiel oder ein Grund.
 * Ein Paket ohne beides protokolliert wie bisher nichts: Eine Zeile je Paket, die nur
 * "Modell des Laufs" wiederholt, machte die interessanten Zeilen unsichtbar.
 */
function rundenHinweis({ modell, herkunft, grund, stufe, stufeVerwendet, effort }) {
  if (!stufe && !grund) return null;
  const teile = [];
  if (stufe) teile.push(`Aufgabenstufe ${stufe}`);
  teile.push(modell ? `Modell ${modell} (${herkunft})` : `kein Modell (${herkunft})`);
  if (stufeVerwendet && stufeVerwendet !== stufe) teile.push(`ueber Stufe ${stufeVerwendet}`);
  // Nur wenn gesetzt (Issue #846): Ohne Gruendlichkeit bleibt die Zeile wortgleich mit
  // der von vorher — eine Stufe ohne `effort` faehrt mit der Voreinstellung der CLI, und
  // das ist keine Auskunft, die eine eigene Angabe verdient.
  if (effort) teile.push(`Gruendlichkeit ${effort}`);
  return grund ? `${teile.join(", ")} — ${grund}` : teile.join(", ");
}

/**
 * Ein Paket, dessen Stufe auf keiner Ebene startet (Issue #711, Kriterium 10).
 *
 * Fehlschlag und nicht Rueckstellung: Zurueckgestellt ist ein Paket, das an einem Gate
 * haengt oder dessen Session nichts abgeschlossen hat — hier ist die Einstellung des
 * Projekts unvollstaendig, und das soll morgens als Fehlschlag sichtbar sein. Das Issue
 * wandert nach Backlog wie bei jeder Runde ohne Ergebnis; bliebe es in Ready, zoege die
 * naechste Iteration dasselbe Paket erneut, bis MAX_ITERATIONS erschoepft ist.
 */
function ohneSessionGescheitert(top, einheit, modellStand, started) {
  const grund = `Keine startbare Stufe fuer Aufgabenstufe ${modellStand.stufe}: ${modellStand.grund}`;
  log(`  Fehlschlag ohne Session: Issue #${top.id} — ${grund} — Issue ins Backlog, weiter.`);
  abh.board("issue", "comment", String(top.id), "--text", `Nachtlauf: ${grund} Es wurde keine Session gestartet.`);
  abh.board("issue", "move", String(top.id), "backlog");
  einheitErgaenzen(einheit, {
    ausgang: "fehlschlag",
    grund,
    dauerMs: Date.now() - started,
    commit: null,
    endStatus: abh.board("issue", "get", String(top.id)).status,
    // Ohne Session gibt es weder Pruefstand noch Kennzahlen. Beide Felder stehen trotzdem
    // da: Ein fehlendes Feld liesse offen, ob niemand gemessen hat oder ob nichts lief.
    pruefung: null,
    kennzahlen: null,
  });
  return "fehlschlag";
}

/**
 * Eine vollstaendige Runde: Session starten, auswerten, Einheit fuellen (Issue #488).
 *
 * Liefert den Ausgang aus `werteRunde` unveraendert zurueck — die Uebersetzung ins
 * Vokabular des Ergebnisstands passiert hier drin, die Zaehler des Aufrufers bleiben
 * bei ihren alten Woertern.
 */
export async function laufeRunde(top, args, salvageAttempted, pruefungen) {
  // Jede Runde ist ein Schritt ihres Pakets mit eigenem Protokoll (Issue #1090, E16) —
  // die Salvage-Session derselben Runde schreibt mit hinein.
  const vorherLog = schrittBeginnen(top.id, "umsetzung");
  try {
    return await rundeLaufen(top, args, salvageAttempted, pruefungen);
  } finally {
    schrittEnden(vorherLog);
  }
}

/** Der Inhalt von `laufeRunde`, ganz im Protokoll ihres Schritts. */
async function rundeLaufen(top, args, salvageAttempted, pruefungen) {
  // Die Einheit entsteht VOR der Session und wird sofort geschrieben: Bricht der Lauf
  // mitten in der Runde ab, steht das gezogene Paket trotzdem im Stand — mit ausgang
  // "unbekannt", was etwas anderes sagt als ein Fehlschlag.
  const commitVorher = lastCommitHash();
  const started = Date.now();
  // Der Laufstand des Pakets an der Paketkarte (Issue #1089, E2) — in Kette und
  // Umsetzungsnacht gleich, denn beide gehen durch diese Runde.
  standSetzen(top.id, "laeuft", `Umsetzung laeuft seit ${new Date(started).toISOString()}`);
  ABBRUCH_GRUND = "";
  // Vor dem Start verwerfen, direkt danach lesen (Issue #428): So zaehlt fuer eine
  // Session nur, was sie selbst geschrieben hat — und die Salvage-Session, die
  // weiter unten in werteRunde laufen kann, ist aussen vor.
  verwerfeZusammenfassung();
  // Ebenfalls vor dem Start: die Merker der wartenden Sitzung, des Zeitabbruchs und des Halts.
  rundenMerkerZuruecksetzen();
  // Die Karte VOR der Session, vollstaendig (Issue #572): Nur gegen diesen Stand
  // laesst sich sagen, welche Kommentare die Session selbst beigetragen hat — und nur
  // ein eigener Kommentar belegt den Halt. `top` stammt aus der Ready-Liste und
  // traegt den Body nicht in jeder Adapter-Fassung.
  const vorher = abh.board("issue", "get", String(top.id));
  // Die Einstellung frisch von Platte, unmittelbar vor diesem Paket (Issue #711, E19):
  // Eine Aenderung an den Stufen soll noch in derselben Nacht wirken. Alles andere bleibt
  // beim Stand des Laufbeginns.
  stufenFelderAuffrischen();
  // Modell und Stufe dieser Karte (Issue #665, #711) — aus dem Body, den `vorher` ohnehin
  // traegt. Ein eigener `issue get` je Karte waere ein zweiter Aufruf gegen eine API, die
  // drosselt, fuer einen Wert, der bereits vorliegt.
  const modellStand = paketWahl({
    body: vorher?.body,
    einstellung: stufenEinstellung(ZUSTAND.config),
    erlaubteModelle: ZUSTAND.config.night?.modelle,
    laufModell: args.model,
  });
  // Die Einheit entsteht erst hier, weil sie das Modell traegt — und das steht erst fest,
  // wenn der Body gelesen ist. Sie wird weiterhin VOR der Session geschrieben: Bricht der
  // Lauf mitten in der Runde ab, steht das gezogene Paket trotzdem im Stand.
  const einheit = einheitAnlegen(top.id, top.title, modellStand);
  const hinweis = rundenHinweis(modellStand);
  if (hinweis) log(`  Hinweis zu #${top.id}: ${hinweis}`);

  // Kein startbarer Weg fuer die Stufe dieses Pakets (Issue #711, Kriterium 10): Das Paket
  // wird OHNE Session als Fehlschlag verbucht und der Lauf zieht das naechste. Der Rueckfall
  // auf das Modell des Laufs waere hier falsch — wer eine Stufe setzt, will dieses Paket auf
  // dieser Ebene laufen lassen. Und weil die Entscheidung vor dem ersten Arbeitsschritt
  // faellt, wird keine begonnene Umsetzung mit einem zweiten Modell wiederholt.
  if (!modellStand.startbar) {
    const ohne = ohneSessionGescheitert(top, einheit, modellStand, started);
    paketStandAbschliessen(top, ohne, einheit.grund);
    return ohne;
  }

  // Womit die Session startet (Issue #711): Modellname oder die Kommandozeile der Stufe.
  // Dasselbe Buendel geht spaeter an die Salvage-Session desselben Pakets — sie prueft den
  // Zwischenstand der regulaeren Runde und muss dafuer auf demselben Weg laufen.
  // `effort` gehoert ins selbe Buendel (Issue #846): Es ist die Gruendlichkeit der Stufe,
  // die auch das Modell gestellt hat, und die Salvage-Session desselben Pakets soll auf
  // demselben Weg laufen — mit demselben Modell und derselben Gruendlichkeit.
  const sessionWahl = modellStand.kommando
    ? { model: modellStand.modell, kommando: modellStand.kommando, stufenName: modellStand.stufenName, aufgabenstufe: modellStand.stufe }
    : { model: modellStand.modell, effort: modellStand.effort };
  // `stream` und `vordergrundCheck` seit Issue #668. Der Strom traegt `stop_reason`, an
  // dem der Grund-Praefix haengt — ohne ihn waere der Fall, den dieses Paket erkennbar
  // macht, in genau den Laeufen unsichtbar, die mit `--verbose no` fahren. `vordergrundCheck`
  // sperrt `Monitor` und hebt die Bash-Zeitlimits; beides gilt nur fuer die
  // Implementierungs-Runde.
  const res = await runSession(top.id, args, { stream: true, vordergrundCheck: true, ...sessionWahl });
  // Einmal lesen und durchreichen (Issue #471): Die Salvage-Session, die in
  // werteRunde laufen kann, wuerde die Datei sonst ueberschreiben, und der
  // zweite Lesevorgang bewertete ihren Lauf statt den der regulaeren Session.
  //
  // Der Commit dieser Session, sofort nach ihr (Issue #865): Er ist der Stand, zu dem
  // der Nachweis gehoeren muss. `commitNachher` weiter unten taugt dafuer nicht — es
  // steht hinter werteRunde und kann der Commit einer Salvage-Session sein.
  const commitDerSession = lastCommitHash();
  const pruefung = bewertePruefung(top.id, commitDerSession === commitVorher ? null : commitDerSession, ZUSTAND.config);
  pruefungen.push(pruefung);
  // Die gerundete Minutenangabe fuer die Textzeilen der Auswertung: Sie benennt die
  // Dauer der Implementierungs-Session und wird deshalb VOR werteRunde bestimmt.
  const minutes = ((Date.now() - started) / 60000).toFixed(1);

  const ausgang = await werteRunde({ top, res, minutes, args, salvageAttempted, pruefung, vorher, sessionWahl });
  // Die Rohdifferenz fuer den Ergebnisstand, NACH werteRunde (Issue #488, korrigiert im
  // Code-Review zu #924): In werteRunde kann eine Salvage-Session laufen, samt ihrer
  // Vorpruefungen. Vor dem Aufruf gemessen fehlte diese Zeit, und ein Paket mit langer
  // Rettung erschiene faelschlich unter der Zielmarke — die Quelle verlangt die Dauer
  // "bis zum bestandenen Abschluss, einschliesslich aller Pruefungen und Korrekturen".
  const dauerMs = Date.now() - started;
  // Unmittelbar nach der Auswertung (Issue #558): Die Guards kennen den Grund, aber
  // nicht die Einheit — hier liegt beides vor.
  if (ausgang === "hardStop") hefteStoppGrund(einheit);
  const commitNachher = lastCommitHash();
  einheitErgaenzen(einheit, {
    ...ausgangsFelder(ausgang),
    dauerMs,
    // Nur ein WIRKLICH neuer Hash zaehlt: Ein unveraenderter Stand hiesse sonst,
    // dem Paket den Commit des vorigen zuzuschreiben.
    commit: commitNachher === commitVorher ? null : commitNachher,
    endStatus: abh.board("issue", "get", String(top.id)).status,
    pruefung,
    kennzahlen: leseKennzahlen(res.stdout),
    // Ganz hinten (Issue #776): Neue Felder haengen an, die bestehenden behalten Namen und
    // Reihenfolge — sie sind der Vertrag mit den Auswertungen.
    ...wartendFelder(),
    ...zeitlimitFelder(),
    // Die Art des Halts (Issue #1050), nur beim Halt — sonst WEG, wie die beiden davor.
    ...(ausgang === "angehalten" && HALT_ART ? { haltArt: HALT_ART } : {}),
  });
  paketStandAbschliessen(top, ausgang, rundenStandGrund(ausgang, { einheit, pruefung, res, commit: commitNachher }));
  return ausgang;
}

// Der Laufstand eines Pakets nach dem Ausgang seiner Runde (E2); alles Uebrige ist `abgebrochen`.
const RUNDEN_STAND = { erfolg: "fertig", angehalten: "wartet" };

/** Der Grund im Laufstand einer Runde, je Ausgang aus dem, was die Auswertung schon weiss. */
function rundenStandGrund(ausgang, { einheit, pruefung, res, commit }) {
  if (ausgang === "erfolg") return `In review mit Nachweis (${pruefung?.zustand ?? "ungeprueft"}), Commit ${commit}`;
  if (ausgang === "angehalten") return HALT_STAND_TEXT[HALT_ART ?? "klaeren"];
  if (ausgang === "deferred") return `${rundenGrund(res, pruefung)}; die Karte ging ins Backlog, der Lauf weiter`;
  if (ausgang === "fehlschlag") return nachweisMangel(pruefung) ?? ZUSTAND_UNLESBAR_GRUND;
  return einheit.grund ?? ZUSTAND.STOPP_GRUND;
}

/**
 * Setzt den Laufstand eines Pakets zum Ende seiner Runde (Issue #1089, E2): `fertig` bei In
 * review mit Nachweis, `wartet` beim Halt, sonst `abgebrochen` mit Grund. Nach dem Anhalten
 * steht der Stand schon (E15). Ein abgebrochenes Paket merkt sich der Lauf fuer das Gate.
 */
function paketStandAbschliessen(top, ausgang, grund) {
  if (anhaltenLaeuft()) return;
  const zustand = RUNDEN_STAND[ausgang] ?? "abgebrochen";
  if (zustand === "abgebrochen") ABGEBROCHENE_PAKETE.add(Number(top.id));
  standSetzen(top.id, zustand, `Runde beendet: ${ausgang} um ${new Date().toISOString()}\n\n${grund}`);
}

/**
 * Nimmt den Umsetzungs-Lock und meldet, was daraus wurde (Issue #696).
 *
 * Steht getrennt, damit die Schleife nur zwei Zeilen dafuer braucht: Sie ruft die Funktion
 * ueber `??=` genau einmal — vor der ersten Session — und liest danach nur noch `ok`.
 */
function lockVorErsterSession() {
  const lock = umsetzungLockNehmen(process.cwd());
  if (!lock.ok) log(`Umsetzung ausgelassen: ${lock.grund}. Der Lauf endet ohne Paket.`);
  else if (lock.hinweis) log(lock.hinweis);
  return lock;
}

/**
 * Der Fall eines Laufs, dem Ready ausgegangen ist (Issue #887).
 *
 * Eine leere Spalte, die dieser Lauf selbst geraeumt hat, ist keine leere Spalte:
 * "Ready ist leer" schickte den Morgen dann in die falsche Richtung.
 */
function fallLeeresReady(lauf) {
  return lauf.zaehler.deferred > 0
    ? { fall: "alleZurueckgestellt", daten: { anzahl: lauf.zaehler.deferred } }
    : { fall: "readyLeer", daten: {} };
}

/**
 * Vermerkt am Lauf, was ein nicht genommener Umsetzungs-Lock bedeutet (Issue #887).
 *
 * Die beiden Arten stehen fuer Verschiedenes (Issue #886): Ein belegter Lock ist ein
 * ruhiger Lauf neben einem anderen und endet ohne Paket; ein Schreibfehler ist eine
 * Stoerung der Umgebung und gehoert als harter Stopp gemeldet, nicht als ruhige Nacht
 * weggeschrieben. Der Schreibfehler geht denselben Weg wie der Vorflug-Guard: Hier ist
 * kein Paket gezogen, der Grund gehoert deshalb an den Lauf und nicht an eine Einheit.
 *
 * Die Schleife ruft das und bricht danach ab — sie bricht also nicht ohne Auskunft ab.
 */
function lockFehlschlagVermerken(lauf) {
  if (lauf.lock.art === "schreibfehler") {
    merkeHartenStopp("umgebung", lauf.lock.grund);
    hefteStoppGrundAnLauf();
    lauf.hardStop = true;
    return;
  }
  lauf.ohneArbeit = { fall: "umsetzungBelegt", daten: { grund: lauf.lock.grund } };
}

/**
 * Die Runden der Umsetzungsnacht, eine nach der anderen.
 *
 * Fuehrt ihren Zustand in `lauf`, nicht ueber Rueckgaben: Bricht sie mit `break` ab — und
 * das tun vier harte Stopps —, muss der Aufrufer trotzdem wissen, wie weit sie kam.
 *
 * Kein `break` ohne Auskunft (Fachliche Quelle #880): Jedes Ende ohne Paket merkt sich
 * seinen Fall auf `lauf.ohneArbeit`, ausgewertet wird er EINMAL nach der Schleife. Dass
 * die Faelle hier nur gemerkt und nicht schon vermerkt werden, ist der Punkt: Ob der
 * Lauf ueberhaupt ohne Arbeit blieb, weiss erst der Aufrufer — und vier Stellen, die
 * dieselbe Frage beantworten, laufen auseinander.
 */
async function implementierungsSchleife(args, ctx, lauf) {
  let iterations = 0;
  Object.assign(LAUF_KONTEXT, { karte: null, kandidaten: () => umsetzungsKandidaten(ctx) });
  while (lauf.sessions < args.max && iterations < MAX_ITERATIONS) {
    iterations++;
    LAUF_KONTEXT.karte = null;
    const ready = abh.board("issue", "list", "--status", "ready");
    if (ready.length === 0) {
      lauf.ohneArbeit = fallLeeresReady(lauf);
      break;
    }
    warnWennLabelNirgendsVorkommt(ctx, ready);

    // Routing-Label (#159): erstes Ready-Issue mit dem gesuchten Label; ungelabelte
    // Issues davor bleiben unangetastet. Kein Treffer -> Lauf endet wie bei leerem Ready.
    const top = ctx.labelFilter === null ? ready[0] : ready.find(ctx.hasLabel);
    if (!top) {
      lauf.ohneArbeit = { fall: "keinLabel", daten: { label: ctx.labelFilter, anzahl: ready.length } };
      break;
    }
    // Ab hier ist es die Karte des Laufs: Ein Umgebungsfehler wird an ihr vermerkt (E13).
    LAUF_KONTEXT.karte = String(top.id);

    const gate = pruefeIssueGates(top);
    if (gate) {
      stelleAmGateZurueck(top, gate);
      lauf.zaehler.deferred++;
      continue;
    }

    // Erst hier, nicht beim Eintritt: Ein Lauf, der an leerem Ready, am Routing-Label oder
    // an lauter Gates endet, setzt keine Umsetzung in Gang und darf keine Kette abhalten.
    lauf.lock ??= lockVorErsterSession();
    if (!lauf.lock.ok) {
      lockFehlschlagVermerken(lauf);
      break;
    }
    // Der feste Kit-Stand in der Hauptkopie (Issue #1102, A3): nach dem Zustands-Vorflug und
    // erst mit dem Lock — ein Lauf ohne ihn ueberschriebe die Kopie dessen, der gerade baut.
    kitStandInBaum(process.cwd());

    lauf.sessions++;
    log(`Session ${lauf.sessions}/${args.max}: Issue #${top.id} — ${top.title}`);
    const ausgang = await laufeRunde(top, args, lauf.salvageAttempted, lauf.pruefungen);
    // Kein `break` bei Paketfehlern (Issue #1089, E14): Ein abgebrochenes Paket haelt nur
    // sich und die von ihm abhaengigen an. Der harte Stopp bleibt fuer Umgebung und Reste
    // nach einem Erfolg.
    if (ausgang === "hardStop") {
      lauf.hardStop = true;
      break;
    }
    lauf.zaehler[ausgang]++;
  }
}

/**
 * Die Karten, die die Schleife jetzt als naechste aufnaehme (E15): Ready mit Routing-Label,
 * die `pruefeIssueGates` bestehen — so, wie sie im Moment des Anhaltens am Board liegen.
 */
function umsetzungsKandidaten(ctx) {
  const ready = abh.board("issue", "list", "--status", "ready");
  return ready
    .filter((issue) => ctx.labelFilter === null || ctx.hasLabel(issue))
    .filter((issue) => !pruefeIssueGates(issue))
    .map((issue) => String(issue.id));
}

/**
 * Die Implementierungsschleife (Phase 9 aus Issue #398).
 *
 * Liefert ein Ergebnisobjekt und beendet den Prozess NIE selbst. In der Phase endete
 * bis Issue #404 kein Pfad mit `return`: Die vier harten Stopps setzten `hardStop`
 * und brachen mit `break` ab, die uebrigen Enden liessen es ungesetzt, und der
 * Exit-Code entstand am Ende von main(). Wuerde die Schleife selbst exiten, ginge der
 * Unterschied zwischen "sauber beendet" und "hart gestoppt" verloren — und das ist
 * das Signal, das der Morgen liest.
 */
export async function laufeImplementierung(args, ctx) {
  const lauf = {
    sessions: 0,
    hardStop: false,
    // Die Ausgaenge von werteRunde als Zaehler, unter ihren eigenen Namen. Der
    // Ausgang indiziert direkt — eine if/else-Kette waere eine zweite Stelle, an der
    // die Woerter des Laufs stehen. `angehalten` (Issue #572) ist kein Fehlschlag und
    // keine Rueckstellung: Es steht als eigener Zaehler daneben, damit der Morgen die
    // wartende Entscheidung nicht in der Rueckstellungszahl sucht.
    zaehler: { erfolg: 0, deferred: 0, fehlschlag: 0, angehalten: 0, abgebrochen: 0 },
    // Genau ein Salvage-Versuch pro Issue und Lauf (#167).
    salvageAttempted: new Set(),
    // Der Fall, an dem die Schleife ohne Paket endete (Issue #887) — gemerkt in der
    // Schleife, ausgewertet danach.
    ohneArbeit: null,
    // Was jede Session gepruft und was sie ausgelassen hat (#428) — je Runde ein Eintrag,
    // auch bei hartem Stopp: Der Bericht soll gerade dann sagen, was noch geprueft wurde.
    pruefungen: [],
    lock: null,
  };
  const { zaehler, pruefungen } = lauf;

  try {
    await implementierungsSchleife(args, ctx, lauf);
  } finally {
    // Nur den eigenen: Wer ihn nicht genommen hat, gibt ihn nicht frei.
    if (lauf.lock?.ok) lauf.lock.freigeben();
    kitStandAbgeben(process.cwd());
  }
  const { sessions, hardStop } = lauf;

  // Die eine Stelle, die "gab es Arbeit?" beantwortet (Issue #887). Ein harter Stopp ist
  // kein Lauf ohne Arbeit, sondern eine Stoerung: Er traegt seinen `fehlerText`, und ein
  // `noWorkReason` daneben liesse ihn wie eine ruhige Nacht aussehen. Fehlt der Fall,
  // sagt der Rueckfall ausdruecklich, dass hier eine Lage unbenannt geblieben ist.
  if (sessions === 0 && !hardStop) {
    const { fall, daten } = lauf.ohneArbeit ?? { fall: null, daten: {} };
    vermerkeOhneArbeit(fall, daten);
  }

  // Der Abschluss gehoert hierher und nicht in main(): Der Dry-Run beendet den Prozess
  // selbst und kaeme an einer Stelle in main() nie an.
  anbindung.laufAbschliessen(hardStop ? "harterStopp" : "regulaer");
  return {
    sessions, hardStop, pruefungen,
    succeeded: zaehler.erfolg,
    deferred: zaehler.deferred,
    ohneNachweis: zaehler.fehlschlag,
    angehalten: zaehler.angehalten,
    abgebrochen: zaehler.abgebrochen,
  };
}
