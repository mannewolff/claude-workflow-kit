/**
 * night/bericht.mjs — der Bericht des Nacht-Runners (Issue #1230, Plan #1199, E17): die
 * Pruef-Zusammenfassungen der Sessions, ob der Nachweis zum Commit des Pakets gehoert, die
 * Prueflaeufe und die Zielmarke im Bericht und der Nachtbericht am Fachplan.
 *
 * Ein Teil von kit/night.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nur aus Teilen unter kit/night/ und kit/board/, nie aus dem Einstieg:
 * Der Einstieg laedt die Teile, ein Rueckimport waere ein Zyklus.
 *
 * Mitgezogen, obwohl E17 sie nicht nennt: die Pruefer-Vermerke an Plan und Anforderung
 * (`planReviewWert` und ihre Geschwister). Der Nachtbericht nennt den Pruefer des Plans, und
 * die Kette, ihr Hauptaufrufer, ist noch nicht ausgelagert — sie nimmt sie spaeter von hier.
 * Im Abschnitt des Nachtberichts bleiben im Einstieg, was allein die Kette ruft: der
 * gescheiterte Vorflug, der Hinweis an ungeprueften Anforderungen und `mitMeldung`.
 *
 * git und das Board erreicht der Teil ueber `git` und `boardRoh`; beide lassen sich ueber
 * `berichtAbhaengigkeiten` einsetzen (Plan #1199, E6). So pruefen die Tests den Abgleich von
 * Nachweis und Commit und das Schreiben des Berichts im selben Prozess, ohne Kindprozess.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, rmSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import { ZUSTAND, NACHBAR_CHECKS, log, boardRoh, vergleicheText } from "./grundlagen.mjs";
import { VORBEREITUNG_DATEI, pidAusInhalt, prozessLaeuft, kitStandZeile } from "./kitstand.mjs";
import { abschnittLesen, leseKarte } from "./abhaengigkeiten.mjs";
import { COLUMN_DEFAULTS } from "../board/grundlagen.mjs";
// Die Marker in Body und Kommentaren gelten unter beiden Namen (Issue #1443, Plan #1420 E15).
import { leseMarker, erkenneMarker, ueberschriftZeile, markerName, prozessSprache, text } from "../board/namen.mjs";
import { endlicheZahl, lesePruefung, paketstufenChecks, runBuildChecksSync,
  LOKALER_KOMMENTARKOPF } from "./session.mjs";

// Die Texte an den Menschen liegen unter kit/texte/night-bericht.mjs (Issue #1525).
import { TEXTE } from "../texte/night-bericht.mjs";

export { TEXTE };

const t = (schluessel, werte = {}) => text(TEXTE, schluessel, werte);

/** Ein Wert des Ergebnisstands als Anzeige (`ausgang_fertig` …); ein unbekannter erscheint, wie er ist. */
function anzeige(art, wert) {
  const schluessel = `${art}_${wert}`;
  return Object.hasOwn(TEXTE.de, schluessel) ? t(schluessel) : String(wert);
}

// Der Ort der Pruef-Zusammenfassung kommt aus checks.mjs und wird NICHT nachgerechnet (Issue
// #428). Bedingt und mit werfendem Ersatz wie im Einstieg: Fehlt der Nachbar, wirft der Stub
// erst, wenn wirklich jemand den Pfad braucht. Der Pfad ist nicht literal, deshalb nennt die
// Gruppe dieses Teils den Bereich pruefungen von Hand (E3).
const { zusammenfassungPfad } = existsSync(NACHBAR_CHECKS)
  ? await import(pathToFileURL(NACHBAR_CHECKS).href)
  : {
      zusammenfassungPfad: () => {
        throw new Error(t("checksFehlt", { pfad: NACHBAR_CHECKS }));
      },
    };

// --- Abhaengigkeiten nach aussen (Plan #1199, E6) ---

const VORGABEN = Object.freeze({
  git: (args) => spawnSync("git", args, { encoding: "utf-8", cwd: process.cwd() }),
  boardRoh,
});
const abh = { ...VORGABEN };

/**
 * Setzt Abhaengigkeiten des Teils ein; nicht genannte behalten ihren Wert, ohne Argument
 * gelten wieder alle Vorgaben. Nur fuer Tests — der Runner arbeitet mit den Vorgaben.
 */
export function berichtAbhaengigkeiten(neu) {
  if (neu === undefined) {
    Object.assign(abh, VORGABEN);
    return;
  }
  for (const [name, fn] of Object.entries(neu)) {
    if (!Object.hasOwn(VORGABEN, name)) throw new Error(t("abhaengigkeitUnbekannt", { name }));
    abh[name] = fn;
  }
}

// --- Pruefer-Vermerke an Plan und Anforderung (mitgezogen, siehe Kopf) ---

// Der Pruefer-Vermerk am Plan, den /issue-review dort hinterlaesst.
//
// Derselbe Ausdruck trug bisher an drei Stellen dieselbe Arbeit — zweimal als blosse
// Marker-Probe (`\s*\S`), einmal als Wert-Auslese (`\s*(.+?)\s*$`) —, und die beiden
// Fassungen waren sich uneinig: 'Plan-Review:   ' war der einen ein Wert, der anderen
// keiner. Jetzt liest eine Funktion den Wert, und die Marker-Probe fragt sie.
//
// Der Ausdruck sieht nur noch die getrimmte Zeile: Das fuehrende `\s*` hinter `^` mit
// m-Flag war der SonarQube-Fund (S8786, Issue #877) — derselbe, den Issue #496 fuer
// REVIEW_MARKER_ZEILE behoben hat, und er wird auf demselben Weg behoben. Die Form des
// Werts ist die von AUTOR_MODELL_ZEILE: vom ersten bis zum letzten Nicht-Leerzeichen.
export const PLAN_REVIEW_ZEILE = /^Plan-Review:[^\S\n]*(\S(?:[^\n]*\S)?)[^\S\n]*$/;

/**
 * Der Wert der ersten Zeile mit dem Marker `sache` und nicht leerem Wert — sonst `null`.
 *
 * Der Marker gilt unter beiden Namen (Issue #1443); der Wert hat die Form von
 * PLAN_REVIEW_ZEILE, vom ersten bis zum letzten Nicht-Leerzeichen, `\r` aus CRLF nicht
 * eingeschlossen. Die exportierten Ausdruecke bleiben die Form der deutschen Zeile.
 */
function markerWert(body, sache) {
  for (const zeile of String(body ?? "").split("\n")) {
    const m = leseMarker(zeile);
    const wert = m?.sache === sache ? m.rest.trim() : "";
    if (wert !== "") return wert;
  }
  return null;
}

/** Der Pruefer aus der Zeile 'Plan-Review: <pruefer>' eines Plan-Bodys — sonst `null`. */
export function planReviewWert(body) {
  return markerWert(body, "planReview");
}

/** Ob der Body eines Plans den Plan-Review-Marker mit einem Wert traegt. */
export function hatPlanReviewMarker(body) {
  return planReviewWert(body) !== null;
}

// Der Pruefer-Vermerk an der fachlichen Anforderung, den /issue-review dort hinterlaesst
// (Fachplan #899, Plan #904, Issue #907). Gebaut wie PLAN_REVIEW_ZEILE, weil er dasselbe
// leistet — nur an der anderen Kartenart. Den Namen kennt `kit/board.mjs` bereits als
// Gate F11 der fachlichen Anforderung.
export const FACHPLAN_REVIEW_ZEILE = /^Fachplan-Review:[^\S\n]*(\S(?:[^\n]*\S)?)[^\S\n]*$/;

/** Der Pruefer aus der Zeile 'Fachplan-Review: <pruefer>' — sonst `null`. */
export function fachplanReviewWert(body) {
  return markerWert(body, "fachplanReview");
}

/** Ob der Body einer fachlichen Anforderung den Fachplan-Review-Marker mit Wert traegt. */
export function hatFachplanReviewMarker(body) {
  return fachplanReviewWert(body) !== null;
}

// --- Pruef-Zusammenfassungen der Sessions (Issue #428) ---
//
// Der Runner sieht von einer Session nur Exit-Code, Board-Zustand und Working Tree.
// Was sie INNERHALB gepruft und was sie ausgelassen hat, erfaehrt er allein aus der
// Zusammenfassung, die `checks.mjs run` hinterlaesst (Issue #424). Bewusst NICHT aus
// dem Abschlussbericht: Der ist von einem Modell formulierter Text, und was die
// Maschine braucht, geht in diesem Repo nirgends durch Text.
//
// Nur die regulaeren Implementierungs-Runden liefern hier etwas ab. Die
// Salvage-Session ist strukturell aussen vor — sie laeuft erst nach dem Einsammeln,
// und ihr Prompt verbietet ihr Checks ausdruecklich; sie erschiene sonst als
// "ungeprueft", obwohl verifyChecksForSalvage extern die volle Liste gruen gefahren
// hat. Der Vorflug ebenso: Er gehoert zum Review-Modus, der diese Schleife nicht
// durchlaeuft.

/**
 * Loescht die Zusammenfassung vor dem Start einer Runde. Ohne diesen Schritt liesse
 * eine liegengebliebene Datei — vom Vortag oder von einer Session, die vor ihrer
 * Pruefung starb — eine ungepruefte Session als geprueft erscheinen. Erst dadurch
 * genuegt der feste Dateiname aus Issue #424.
 */
export function verwerfeZusammenfassung() {
  try {
    rmSync(zusammenfassungPfad(process.cwd()), { force: true });
  } catch (err) {
    // Nicht loeschbar ist ein Grund, der Datei danach nicht zu glauben — aber kein
    // Grund, einen Nachtlauf zu beenden. Die Runde laeuft, der Vermerk steht im Log.
    log(t("zusammenfassungNichtGeloescht", { fehler: err.message }));
  }
}

// --- Gehoert der Nachweis zum Commit des Pakets? (Issue #865) ---
//
// Die Zusammenfassung traegt keinen Vermerk darueber, welchen Stand sie gemessen hat —
// sie ist schlicht die letzte, die eine Session hinterlassen hat. Lauf #118 zeigte, was
// daraus folgt: Nach einem gruen geprueften Commit startete die Session eine weitere
// Pruefung und brach sie ab; deren Zwischenfassung ("nicht gestartet") stand danach in
// der Datei, und der Runner meldete ein sauberes Paket als "Nachweis rot".
//
// Die Frage ist dieselbe, die das Commit-Gate (.githooks/gate.mjs) vor jedem Commit
// stellt, nur gegen den Commit statt gegen den Index: Traegt die Zusammenfassung fuer
// JEDE Datei, die der Commit aendert, genau den Blob, der dort gelandet ist?
//
// Die Richtung ist mit Bedacht die des Gates (Commit -> Nachweis) und nicht die
// umgekehrte: Eine Zusammenfassung enthaelt regelmaessig mehr, als der Commit aufnimmt
// — der Board-Move nach In progress aendert beim lokalen Tracker issues/<id>.md, und
// die Session committet die Datei nicht. Gegen diese Beifaenge zu pruefen, hiesse den
// Nachweis in jedem Lauf dieses Repos als fremd zu verwerfen.

/** Die Pfade samt Status, die ein Commit aendert. `null`, wenn git nicht antwortet. */
function commitEintraege(commit) {
  // `--root`, damit auch ein erster Commit ohne Eltern Eintraege liefert; `-z` und
  // `--no-renames` aus denselben Gruenden wie im Gate (quotePath, R-Zeilen mit zwei Pfaden).
  const res = abh.git(["diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--no-renames", "--root", commit]);
  if (res.status !== 0) return null;
  const felder = res.stdout.split("\0");
  const eintraege = [];
  for (let i = 0; i + 1 < felder.length; i += 2) {
    if (felder[i]) eintraege.push({ status: felder[i], pfad: felder[i + 1] });
  }
  return eintraege;
}

/** Der Blob eines Pfads im Commit, oder `null`, wenn er dort nicht liegt. */
function blobImCommit(commit, pfad) {
  const res = abh.git(["rev-parse", `${commit}:${pfad}`]);
  return res.status === 0 ? res.stdout.trim() : null;
}

/**
 * Passt die Zusammenfassung `daten` zum Commit `commit`? Mit dem Grund, wenn nicht —
 * er nennt die erste abweichende Stelle und geht so, wie er ist, in Log und Bericht.
 *
 * Zwei Faelle heissen "nicht beurteilbar" und gelten darum als passend: eine
 * Zusammenfassung ohne `hashes` (Format vor Issue #469) und ein git-Aufruf, der
 * scheitert. Ein Nachweis, den dieser Abgleich nicht lesen kann, soll denselben Weg
 * gehen wie vor diesem Paket — nicht einen strengeren.
 */
export function nachweisPasstZuCommit(daten, commit) {
  if (!daten || daten.hashes === null || typeof daten.hashes !== "object") return { passt: true, grund: null };
  // `abgeschlossen: false` heisst: Diese Fassung hat ein Abbruch hinterlassen (Issue
  // #857). Sie kann nie der Nachweis eines Commits sein, unabhaengig von den Blobs.
  if (daten.abgeschlossen === false) return { passt: false, grund: t("nachweisAbgebrochen") };
  const eintraege = commitEintraege(commit);
  if (eintraege === null) return { passt: true, grund: null };
  for (const { status, pfad } of eintraege) {
    if (!(pfad in daten.hashes)) return { passt: false, grund: t("nachweisOhnePfad", { pfad }) };
    // Bei einer Loeschung genuegt, dass der Pfad geprueft wurde — einen Blob gibt es
    // im Commit nicht mehr, und die Zusammenfassung fuehrt ihn mit `null`.
    if (status.startsWith("D")) continue;
    if (daten.hashes[pfad] !== blobImCommit(commit, pfad)) {
      return { passt: false, grund: t("nachweisAndereFassung", { pfad }) };
    }
  }
  return { passt: true, grund: null };
}

/**
 * Der Pruefstand der Nachpruefung: der Abschlussumfang, bis einschliesslich des roten
 * Kommandos. Was `paketstufenChecks` auslaesst, erscheint auch hier nicht — die
 * Nachpruefung vollzieht den Abschluss nach und faehrt nie mehr als er (Plan #944, E14).
 */
function nachpruefLaufen(cfg, nach) {
  const laufen = [];
  for (const eintrag of paketstufenChecks(cfg)) {
    const cmd = typeof eintrag === "string" ? eintrag : eintrag.cmd;
    const rot = !nach.ok && cmd === nach.rotesKommando;
    laufen.push({ cmd, grund: t("nachpruefGrund"), ergebnis: rot ? "rot" : "gruen" });
    if (rot) break;
  }
  return laufen;
}

/**
 * Der Pruefstand einer Session, gegen den Commit des Pakets gehalten (Issue #865).
 *
 * Ohne Commit — die Runde hat nichts abgeliefert — bleibt alles, wie `lesePruefung` es
 * gelesen hat: Es gibt keinen Stand, zu dem der Nachweis gehoeren muesste.
 *
 * Passt er nicht, faehrt der Runner die Paketstufe selbst nach, statt den Fall nur zu
 * melden. Ein Morgen mit "unklar" zwingt den Menschen zu genau der Pruefung, die der
 * Runner nachts billiger hat.
 */
export function bewertePruefung(issueId, commit, cfg) {
  const { roh, ...pruefung } = lesePruefung(issueId);
  if (!commit || !roh) return pruefung;
  const abgleich = nachweisPasstZuCommit(roh, commit);
  if (abgleich.passt) return pruefung;

  log(t("nachweisFremdLog", { commit, grund: abgleich.grund }));
  const nach = runBuildChecksSync(cfg);
  log(nach.ok ? t("nachpruefungGruenLog") : t("nachpruefungRotLog", { kommando: nach.rotesKommando }));
  return {
    ...pruefung,
    zustand: nach.ok ? "nachgeprueft" : "rot",
    ...(nach.ok ? {} : { rotesKommando: nach.rotesKommando, rotesErgebnis: "rot" }),
    // Der Umfang ist der der Nachpruefung, nicht der des fremden Nachweises: Sie faehrt
    // den Abschlussumfang ohne Bereichsauswahl.
    laufen: nachpruefLaufen(cfg, nach),
    ausgelassen: [],
    vollerUmfang: true,
    leeresPaket: false,
    basis: commit,
    bereiche: null,
    dauerGesamtMs: null,
    // Ganz hinten (Issue #776): Neue Felder haengen an, die bestehenden behalten Namen
    // und Reihenfolge.
    nachweisFremd: true,
    nachweisGrund: abgleich.grund,
  };
}

function pruefListe(eintraege) {
  return eintraege.length === 0 ? t("listeLeer") : eintraege.map((e) => `${e.cmd} (${e.grund})`).join("; ");
}

/** Eine Zeile je Session — auch die ohne Pruefung, sonst saehe sie aus wie keine. */
function pruefZeile(p) {
  // Der fremde Nachweis zuerst (Issue #865): Was hier zaehlt, ist nicht das Ergebnis der
  // Session, sondern das der Nachpruefung — und der Grund, aus dem sie noetig war.
  if (p.nachweisFremd) {
    const schluessel = p.zustand === "rot" ? "pruefFremdRot" : "pruefFremdGruen";
    return t(schluessel, { id: p.id, grund: p.nachweisGrund, kommando: p.rotesKommando });
  }
  if (p.zustand === "ungeprueft") return t("pruefUngeprueft", { id: p.id });
  if (p.zustand === "unlesbar") return t("pruefUnlesbar", { id: p.id, fehler: p.fehler });
  if (p.zustand === "leeresPaket") return t("pruefLeer", { id: p.id });
  if (p.zustand === "rot") return t("pruefRot", { id: p.id, kommando: p.rotesKommando, ergebnis: p.rotesErgebnis });
  const gelaufen = p.laufen.map((e) => `${e.cmd} -> ${e.ergebnis} (${e.grund})`).join("; ") || t("listeLeer");
  return t("pruefGelaufen", { id: p.id, gelaufen, ausgelassen: pruefListe(p.ausgelassen) });
}

/**
 * Die Guete-Zeile einer Session (Issue #764, AK 9 aus #738): der erreichte Anteil und die
 * Marke, nach JEDEM Lauf — auch wenn er genuegt. Sonst bliebe genau das Problem des
 * Fachplans bestehen: Das Ergebnis wird angesehen, und dann passiert nichts. Hier faellt
 * ein Absinken frueh auf (Plan #753, E6).
 *
 * Eine eigene Zeile und kein Anhaengsel der Pruefzeile: Die traegt je nach Zustand
 * Verschiedenes, und der Anteil gehoert in keinen ihrer Saetze.
 */
function pruefGueteZeile(p) {
  const g = p.guete;
  const anteil = typeof g.anteil === "number" ? t("gueteAnteil", { anteil: g.anteil }) : t("gueteKeinAnteil", { grund: g.grund });
  const bewertung = typeof g.anteil === "number" ? ` — ${g.grund}` : "";
  return t("gueteZeile", { id: p.id, anteil, marke: g.marke, bewertung });
}

/** Die Zeilen einer Session: die Pruefzeile, und darunter die Guete-Zeile, wenn gemessen wurde. */
function pruefZeilen(p) {
  return p.guete ? [pruefZeile(p), pruefGueteZeile(p)] : [pruefZeile(p)];
}

function pruefSummenzeile(pruefungen) {
  const zaehle = (zustand) => pruefungen.filter((p) => p.zustand === zustand).length;
  const geprueft = pruefungen.filter((p) => p.zustand === "geprueft");
  // Die Nachpruefung zaehlt mit (Issue #865): Sie ist gelaufen, ihre Kommandos stehen im
  // Pruefstand, und "0 Pruefung(en) gelaufen" waere nach einem nachgefahrenen Lauf falsch.
  // Die Session-Zahl davor bleibt getrennt — `nachgeprueft` hat dort seine eigene Stelle.
  const mitLaeufen = pruefungen.filter((p) => p.zustand === "geprueft" || p.zustand === "nachgeprueft");
  const summe = (feld, filter = () => true) =>
    mitLaeufen.reduce((n, p) => n + p[feld].filter(filter).length, 0);
  const rot = summe("laufen", (e) => e.ergebnis === "rot");
  return t("pruefSumme", {
    sessions: pruefungen.length, geprueft: geprueft.length, nachgeprueft: zaehle("nachgeprueft"), leer: zaehle("leeresPaket"),
    ungeprueft: zaehle("ungeprueft") + zaehle("unlesbar"), rot: zaehle("rot"), gelaufen: summe("laufen"), gelaufenRot: rot,
    ausgelassen: summe("ausgelassen"),
  });
}

/**
 * Der Pruefteil des Lauf-Berichts: je Session eine Zeile, darunter eine Summe.
 * Kriterium 11 aus Issue #420 verlangt die Auslassungen an zwei Stellen — am
 * Arbeitspaket (Abschlussbericht, Issue #426) und hier.
 */
export function pruefBericht(pruefungen, einheiten = [], zielMin = undefined) {
  const zahlen = prueflaufZeilen(einheiten, zielMin);
  if (pruefungen.length === 0) return [t("pruefKeineRunde"), ...zahlen];
  return [t("pruefKopf"), ...pruefungen.flatMap(pruefZeilen), pruefSummenzeile(pruefungen), ...zahlen];
}

// --- Prueflaeufe und Zielmarke im Bericht (Issue #926, Plan #917, E6-E9) ---

/**
 * Die Zielmarke einer Umsetzung in Minuten — aus der Konfiguration, sonst die Vorgabe.
 *
 * Abschalten ist nicht vorgesehen: Fehlt `night.zielUmsetzungMin`, gilt die Vorgabe des
 * Schemas. Eine Marke, die sich wegkonfigurieren laesst, waere eine Messung, die genau
 * dort verschwindet, wo sie unangenehm wird.
 */
// SYNC: dieselbe Vorgabe steht im Schema von kit/einstellungen.mjs (night.zielUmsetzungMin).
const ZIEL_UMSETZUNG_VORGABE_MIN = 10;

export function zielUmsetzungMin(wert) {
  const zahl = endlicheZahl(wert);
  return zahl !== null && zahl > 0 ? zahl : ZIEL_UMSETZUNG_VORGABE_MIN;
}

/**
 * Die Zahlenzeile eines Pakets: gemessene Dauer, dazu die Prueflaeufe — oder deren Fehlen.
 *
 * Hinter den Abschlussversuchen steht die Wartezeit auf den Abschluss (Issue #1073, Plan
 * #1066, A9): der letzte Abschluss aus `wartezeitMs` des Pruefstands, die Summe aller
 * Abschlussversuche aus dem Zaehler des Runners. Fehlt eine der beiden Zahlen, entfaellt
 * ihr Teil — dieselbe Haltung wie beim fehlenden Zaehler, und die Zeile bleibt kurz.
 */
function prueflaufPaketZeile(einheit) {
  return [prueflaufZahlenZeile(einheit), ...festgefahrenZeile(einheit)];
}

function prueflaufZahlenZeile(einheit) {
  const kopf = t("prueflaufKopfZeile", { id: einheit.id, minuten: minutenText(einheit.dauerMs) });
  const arbeit = einheit.prueflaeufe?.arbeit;
  // "nicht gemessen" und keine Null (E9): Eine 0 hiesse, die Session habe nichts geprueft —
  // hier ist nur niemand dabei gewesen (Stufe ohne Strom).
  if (!arbeit) return t("prueflaufNichtGemessen", { kopf });
  const abschluss = einheit.prueflaeufe?.abschluss;
  const abschlussText = abschluss ? t("prueflaufAbschluss", { anzahl: abschluss.anzahl ?? 0 }) : "";
  const letzter = endlicheZahl(einheit.pruefung?.wartezeitMs);
  const summe = (abschluss?.anzahl ?? 0) > 0 ? endlicheZahl(abschluss.dauerMs) : null;
  const letzterText = letzter === null ? "" : t("prueflaufLetzter", { sekunden: (letzter / 1000).toFixed(1) });
  const summeText = summe === null ? "" : t("prueflaufSumme", { minuten: minutenText(summe) });
  return t("prueflaufZahlen", {
    kopf, anzahl: arbeit.anzahl ?? 0, volle: arbeit.volle ?? 0, gruppen: arbeit.volleNoetig ?? 0,
    abschluss: abschlussText, letzter: letzterText, summe: summeText,
  });
}

/**
 * Die Zeile einer Bremsung (Issue #1391, Plan #1386, E13): Pruefung, Laufzeit bis zum
 * Abbruch, Zeitgrenze der Sitzung und die Differenz als geschaetzte gesparte Zeit — nie
 * unter 0. Die Schaetzung wird hier gerechnet und nicht in der Einheit gespeichert (E8).
 * Ohne Bremsung keine Zeile.
 */
function festgefahrenZeile(einheit) {
  const f = einheit.festgefahren;
  if (einheit.ausgang !== "festgefahren" || !f) return [];
  const dauer = endlicheZahl(einheit.dauerMs) ?? 0;
  const grenze = endlicheZahl(f.zeitgrenzeMs) ?? 0;
  return [t("festgefahrenZeile", {
    id: einheit.id, pruefung: f.pruefung, versuche: f.versuche ?? 0, dauer: minutenText(dauer), grenze: minutenText(grenze),
    gespart: minutenText(Math.max(0, grenze - dauer)),
  })];
}

/**
 * Die Wackler der Nacht je Pruefung (Issue #1399, Plan #1395, E11): jeder Eintrag in
 * `pruefung.gewackelt` ist ein Fall, die Karten stehen in der Reihenfolge der Einheiten.
 * Ohne Wackler keine Zeile.
 */
function gewackeltZeilen(pakete) {
  const jePruefung = new Map();
  for (const e of pakete) {
    for (const w of e.pruefung?.gewackelt ?? []) {
      if (typeof w?.cmd !== "string") continue;
      const stand = jePruefung.get(w.cmd) ?? { faelle: 0, karten: [] };
      stand.faelle += 1;
      if (!stand.karten.includes(String(e.id))) stand.karten.push(String(e.id));
      jePruefung.set(w.cmd, stand);
    }
  }
  return [...jePruefung].map(([cmd, { faelle, karten }]) =>
    t("gewackelt", { cmd, faelle, karten: karten.join(", #") }));
}

/**
 * Die Prueflaeufe je Paket und die Summe gegen die Zielmarke — derselbe Block in BEIDEN
 * Berichten (E6): im `pruefBericht` der Umsetzungsnacht und unter `### Umsetzung` des
 * Kettenberichts. Der Anlassfall — ein Paket von 43 Minuten — lief in einer
 * Umsetzungsnacht; stuende die Zahl nur im Kettenbericht, blieb genau dieser Lauf
 * unbeobachtet.
 *
 * Gezaehlt werden die Einheiten, die eine Implementierungs-Runde durchlaufen haben —
 * erkennbar an ihrem `pruefung`. Die Fachplan-Einheit der Kette und die Einheiten ohne
 * Session (zurueckgestellt, uebersprungen, ohne startbare Stufe) tragen keines und bleiben
 * draussen: Sie haben keine Umsetzung, deren Dauer sich an einer Marke messen liesse.
 *
 * Gerechnet wird mit `einheit.dauerMs`, der Rundendauer einschliesslich aller Pruefungen
 * und Korrekturen (Konvention aus `kit/effort.mjs`) — nicht mit `zeiten.dauerMs`.
 * Gerechnet wird hier und nicht in der Datei (E7): Zwei Rechnungen ueber dieselbe Messung
 * driften auseinander.
 */
export function prueflaufZeilen(einheiten, ziel = undefined) {
  const marke = zielUmsetzungMin(ziel);
  const pakete = (Array.isArray(einheiten) ? einheiten : []).filter((e) => e?.pruefung);
  if (pakete.length === 0) return [t("prueflaufKeine")];
  const zeilen = [t("prueflaufKopf")];
  for (const e of pakete) {
    zeilen.push(...prueflaufPaketZeile(e));
    // Jede Datei mit Namen (E8): Eine Zahl sagte nicht, wo das Loch ist. Der Abschluss
    // bleibt davon unberuehrt — die Luecke ist ein Befund, kein rotes Ergebnis.
    const ohne = e.pruefung?.ohneZuordnung ?? [];
    if (ohne.length > 0) zeilen.push(t("ohneZuordnung", { id: e.id, dateien: ohne.join(", ") }));
    // Je Hinweis eine Zeile, Datei und Grund stehen im Text des Werkzeugs (Issue #1156,
    // E12): gemeldet, nicht gewertet — die Einheit bleibt erfolgreich.
    for (const h of e.pruefung?.hinweise ?? []) {
      for (const zeile of h?.zeilen ?? []) zeilen.push(t("prueflaufHinweis", { id: e.id, zeile }));
    }
  }
  zeilen.push(...gewackeltZeilen(pakete));
  const erreicht = pakete.filter((e) => (endlicheZahl(e.dauerMs) ?? Infinity) <= marke * 60000).length;
  zeilen.push(t("unterMarke", { erreicht, gesamt: pakete.length, marke }));
  return zeilen;
}

// --- Der Nachtbericht am Fachplan (Plan #638, A10, A11; Issue #645) ---
//
// Der Mensch liest morgens am Fachplan, was die Nacht entschieden hat — bei jedem
// Ausgang. Der Bericht ist Verlauf, kein Vertrag: Verbindlich wird eine Entscheidung
// erst als Satz im Fachplan. Kann der Tracker ihn nicht annehmen, wartet er als Datei in
// der Hauptkopie und geht beim naechsten Start jeder Betriebsart nach.

// Die deutschen Fassungen, wie Einstieg und Tests sie kennen; geschrieben wird der Anker aus dem
// Register (`nachtbericht`) und der Schluss aus TEXTE, beide in der Projektsprache.
export const BERICHT_ANKER = markerName("nachtbericht", "de");
export const BERICHT_SCHLUSS = TEXTE.de.berichtSchluss;
const berichtAnker = () => markerName("nachtbericht", prozessSprache());
const BERICHT_DATEI_PRAEFIX = "night-bericht-";
// Plan und Abschlussbericht unter beiden Namen (Issue #1460).
const ENTSCHEIDUNGEN_UEBERSCHRIFT = ueberschriftZeile("architektonischeEntscheidungen");
// Die Kontextueberschrift unter beiden Namen (Issue #1443): `## Kontext` allein auf der Zeile.
// Ein Objekt mit `test`, weil `abschnittLesen` eine Ueberschrift so prueft.
const KONTEXT_UEBERSCHRIFT = {
  test: (zeile) => /^ {0,3}##/.test(zeile) && ((m) => m?.sache === "kontext" && m.rest.trim() === "")(leseMarker(zeile)),
};
const ENTSCHEIDUNGEN_KOMMENTAR_UEBERSCHRIFT = ueberschriftZeile("entscheidungen", 3);
// `### Vorgeschichte` bzw. `### History` im Plan (Issue #1541, Plan #1534).
const VORGESCHICHTE_UEBERSCHRIFT = ueberschriftZeile("vorgeschichte", 3);
// `## Einarbeitung, Runde N` unter beiden Namen (Issue #1443).
const istEinarbeitung = (kommentar) => ((m) => m?.sache === "einarbeitungRunde" && /^ \d/.test(m.rest))(leseMarker(kommentar));

function minutenText(ms) {
  return ((ms ?? 0) / 60000).toFixed(1);
}

/**
 * Alle Kommentare einer Karte, aelteste zuerst — dieselbe Zweiteilung wie in
 * `neueKommentare`: GitHub, GitLab und Toolbox liefern ein Array, der lokale Tracker
 * haengt sie an den Body.
 */
export function kommentareVon(issue) {
  if (Array.isArray(issue?.comments)) return issue.comments.map((k) => String(k?.body ?? ""));
  return String(issue?.body || "").split(LOKALER_KOMMENTARKOPF).slice(1).map((k) => k.trim()).filter(Boolean);
}

/** Der Kommentar `## Einarbeitung, Runde N` am Plan — bei mehreren der letzte; null ohne. */
export function einarbeitungVon(plan) {
  const treffer = kommentareVon(plan).filter(istEinarbeitung);
  return treffer.length > 0 ? treffer.at(-1) : null;
}

/** Die Aufzaehlungspunkte erster Ebene eines Abschnitts, ausserhalb von Codebloecken, ohne `- Keine.`. */
function punkteErsterEbene(body, ueberschrift) {
  const abschnitt = abschnittLesen(body, ueberschrift);
  if (!abschnitt) return [];
  return abschnitt.zeilen
    .filter((z, i) => abschnitt.ausserhalb[i] && /^[-*+]\s+\S/.test(z))
    .map((z) => z.replace(/^[-*+]\s+/, "").trim())
    .filter((z) => !/^keine\.?$/i.test(z));
}

/**
 * Die `- Widerspruch:`-Zeilen aus `### Vorgeschichte` des Plans, woertlich (Issue #1541).
 * `/techplan` uebernimmt sie aus der Fachlichen Quelle; gelesen wird darum nur der Plan.
 * Der Unterabschnitt endet an der naechsten `##`- oder `###`-Zeile — `abschnittLesen`
 * endet nur an `##` und liefe ueber eine folgende `###`-Ueberschrift hinaus.
 */
function widerspruchsZeilen(body) {
  const abschnitt = abschnittLesen(body, VORGESCHICHTE_UEBERSCHRIFT);
  if (!abschnitt) return [];
  const ende = abschnitt.zeilen.findIndex((z, i) => abschnitt.ausserhalb[i] && /^ {0,3}###\s/.test(z));
  const bis = ende < 0 ? abschnitt.zeilen.length : ende;
  return abschnitt.zeilen.slice(0, bis)
    .filter((z, i) => abschnitt.ausserhalb[i] && /^- Widerspruch:/.test(z))
    .map((z) => z.trimEnd());
}

/** Die `Entscheidung:`-Zeilen aus `## Kontext` eines Pakets. */
function entscheidungsZeilen(body) {
  const abschnitt = abschnittLesen(body, KONTEXT_UEBERSCHRIFT);
  if (!abschnitt) return [];
  return abschnitt.zeilen.filter((z, i) => abschnitt.ausserhalb[i] && erkenneMarker(z) === "entscheidung").map((z) => z.trim());
}

/**
 * Die Aufzaehlungspunkte aus `### Entscheidungen` in den Kommentaren eines Pakets —
 * Format des Abschlussberichts (`skills/implement-ready/SKILL.md`, Issue #697). Ein
 * Paket ohne diesen Block und eines ganz ohne Kommentare liefern beide `[]`, kein Wurf.
 */
function entscheidungenAusKommentaren(paket) {
  const eintraege = [];
  for (const kommentar of kommentareVon(paket)) eintraege.push(...punkteErsterEbene(kommentar, ENTSCHEIDUNGEN_KOMMENTAR_UEBERSCHRIFT));
  return eintraege;
}

/**
 * Der Wert der Zeile `Sitzungsumfang: passt | reisst — <ein Satz>` aus dem `## Kontext`
 * eines Pakets (Konvention aus Issue #979): `"reisst"`, `"passt"` oder `null`, wenn die
 * Karte die Zeile nicht traegt. Zwei Werte und kein dritter — eine Zwischenstufe naehme
 * der Einschaetzung ihre einzige Aussage, und `null` heisst darum "nicht eingeschaetzt",
 * nicht "passt".
 */
function sitzungsumfangVon(body) {
  const abschnitt = abschnittLesen(body, KONTEXT_UEBERSCHRIFT);
  if (!abschnitt) return null;
  for (let i = 0; i < abschnitt.zeilen.length; i++) {
    if (!abschnitt.ausserhalb[i]) continue;
    const m = leseMarker(abschnitt.zeilen[i]);
    if (m?.sache !== "sitzungsumfang") continue;
    const wert = m.rest.trim();
    if (/^rei(?:ss|ß)t\b/i.test(wert)) return "reisst";
    if (/^passt\b/i.test(wert)) return "passt";
  }
  return null;
}

/**
 * Die letzte Zeile des Stufen-Blocks: welche Pakete voraussichtlich ueber der
 * Sitzungszeitgrenze liegen (Issue #980, Kriterium 1 des Fachplans #963).
 *
 * Ohne sie steht die Einschaetzung nur im `## Kontext` der Karten, und wer morgens den
 * Kettenbericht liest, muesste jede einzelne oeffnen. Genannt werden die Pakete mit
 * `reisst`; ein Paket ohne die Zeile erscheint als "nicht eingeschaetzt", weil ein
 * fehlendes Urteil kein gutes ist.
 */
function berichtSitzungsumfangZeile(ids, pakete) {
  const teile = [];
  for (const id of ids) {
    const wert = sitzungsumfangVon(pakete.find((k) => String(k.id) === String(id))?.body);
    if (wert === "reisst") teile.push(`#${id}`);
    else if (wert === null) teile.push(t("nichtEingeschaetzt", { id }));
  }
  return t("sitzungsumfangZeile", { liste: teile.length > 0 ? teile.join(", ") : t("listeLeer") });
}

/** `#<id> <Titel>` fuer den Bericht — nur `#<id>`, wenn die Karte ihren Titel nicht mitbringt. */
function paketBezeichnung(pakete, id) {
  const titel = pakete.find((k) => String(k.id) === String(id))?.title;
  return titel ? `#${id} ${titel}` : `#${id}`;
}

/**
 * Der Abschnitt `### Umsetzung`, ausschliesslich unter Variante B (Issue #697): die
 * Listen umgesetzt / angehalten / festgefahren / nicht begonnen, jede mit `keine` statt
 * Weglassen. Die Rueckstellungen (`zurueckgestellt` — gezogen, aber ohne In-review-Ergebnis)
 * zaehlen im Bericht zu "nicht begonnen": Kriterium 4 des Fachplans #681 nennt drei
 * Zustaende, und fuer den Menschen zaehlt an dieser Stelle nur, ob ein Paket in Review
 * liegt. Ein von der Bremse beendetes Paket steht dagegen in einer eigenen Liste "festgefahren"
 * mit Pruefung und Fehler (Issue #1391, Plan #1386, E13): Unter "nicht begonnen" verloere der
 * Mensch, woran es hing.
 */
function berichtUmsetzungMitGrund(pakete, id, grund) {
  const bezeichnung = paketBezeichnung(pakete, id);
  return `${bezeichnung} (${grund})`;
}

/**
 * Stufe und Modell hinter einem umgesetzten Paket, als Klammerzusatz (Issue #713).
 *
 * Ein Eintrag ohne `stufe` — auch ein reiner Id-String aus einem Ergebnisstand vor
 * dieser Aenderung, dem die neuen Felder ganz fehlen — erscheint als "ohne Stufe"; die
 * Funktion wirft dafuer nie. Wich der Lauf auf eine hoehere Stufe aus, stehen beide
 * Stufen da, wie in `rundenHinweis`.
 */
function berichtUmsetzungStufe(eintrag) {
  const stufe = eintrag && typeof eintrag === "object" ? eintrag.stufe : null;
  if (!stufe) return t("ohneStufe");
  const { stufeVerwendet, modell, effort } = eintrag;
  const stufeText = stufeVerwendet && stufeVerwendet !== stufe
    ? t("stufeUeber", { stufe, verwendet: stufeVerwendet })
    : t("stufe", { stufe });
  // Die Gruendlichkeit hinten und nur, wenn gesetzt (Issue #846) — dieselbe Regel wie in
  // `rundenHinweis` und im Dry-Run; ein Eintrag aus einem aelteren Ergebnisstand kennt
  // das Feld nicht und erscheint darum wie bisher.
  const effortText = effort ? t("gruendlichkeit", { effort }) : "";
  return modell ? t("stufeModell", { stufe: stufeText, modell, effort: effortText }) : `${stufeText}${effortText}`;
}

/** `#<id> <Titel> (<Pruefung>, <n> Versuche: <Fehler>)` — ein festgefahrenes Paket im Bericht. */
function berichtFestgefahrenEintrag(pakete, eintrag) {
  return t("festgefahrenEintrag", {
    bezeichnung: paketBezeichnung(pakete, eintrag.id), pruefung: eintrag.pruefung, versuche: eintrag.versuche ?? 0, fehler: eintrag.fehler,
  });
}

function berichtUmsetzungEintrag(pakete, eintrag) {
  const id = eintrag && typeof eintrag === "object" ? eintrag.id : eintrag;
  return `${paketBezeichnung(pakete, id)} (${berichtUmsetzungStufe(eintrag)})`;
}

function berichtUmsetzung(einheit, pakete, einheiten, ziel) {
  const stand = einheit.stufen?.umsetzung ?? {};
  const liste = (ids) => (ids.length > 0 ? `${ids.map((id) => paketBezeichnung(pakete, id)).join(", ")}.` : t("listeLeer"));
  const umgesetzt = stand.umgesetzt ?? [];
  const umgesetztText = umgesetzt.length > 0
    ? `${umgesetzt.map((e) => berichtUmsetzungEintrag(pakete, e)).join(", ")}.`
    : t("listeLeer");
  const festgefahren = stand.festgefahren ?? [];
  const festgefahrenText = festgefahren.length > 0
    ? `${festgefahren.map((e) => berichtFestgefahrenEintrag(pakete, e)).join(", ")}.`
    : t("listeLeer");
  const nichtBegonnen = [...(stand.nichtBegonnen ?? []), ...(stand.zurueckgestellt ?? [])];
  const nichtBegonnenText = nichtBegonnen.length > 0
    ? `${nichtBegonnen.map((e) => berichtUmsetzungMitGrund(pakete, e.id, e.grund)).join(", ")}.`
    : t("listeLeer");
  return [
    t("umsetzungKopf"), "",
    // Die Auslassung zuerst und als eigene Zeile (Issue #862): Sie sagt, dass die
    // bestellte Umsetzung gar nicht erst anlief, was sie verhindert hat und wo die Pakete
    // danach liegen. Aus den drei Listen darunter waere das nur zu erschliessen — und wer
    // erschliessen muss, sieht nicht nach.
    ...(stand.ausgelassen ? [t("umsetzungAusgelassen", { grund: stand.ausgelassen })] : []),
    t("umsetzungUmgesetzt", { liste: umgesetztText }),
    t("umsetzungAngehalten", { liste: liste(stand.angehalten ?? []) }),
    t("umsetzungFestgefahren", { liste: festgefahrenText }),
    t("umsetzungNichtBegonnen", { liste: nichtBegonnenText }),
    // Die Prueflaeufe und die Zielmarke (Issue #926, E6) — derselbe Block, den die
    // Umsetzungsnacht ins Protokoll schreibt. Beide Berichtsorte nennen dieselben Zahlen,
    // damit keiner von beiden der Ort ist, an dem eine Messung fehlt.
    ...prueflaufZeilen(einheiten, ziel),
    "",
  ];
}

const URSPRUNG_ERLEDIGT = new Set(["in_review", "done"]);
const spaltenText = (spalte) => COLUMN_DEFAULTS[spalte] ?? spalte;
const ursprungName = (d) => t(d.art === "fachlich" ? "ursprungFachlich" : "ursprungPlan", { id: d.id });

/** Die Zeile eines Ursprungsdokuments: gewandert, lag bereits, bleibt oder nicht bewegt. */
function ursprungDokumentZeile(d, vorher, fehler) {
  const davor = vorher[d.id] ?? null;
  const name = ursprungName(d);
  if (davor && URSPRUNG_ERLEDIGT.has(davor)) return t("ursprungLagBereits", { name, spalte: spaltenText(davor) });
  if (davor && d.spalte === "in_review") return t("ursprungGewandert", { name });
  if (d.aktion === "bleibt") return t("ursprungBleibt", { name, spalte: spaltenText(davor ?? d.spalte ?? t("unbekannteSpalte")), grund: d.grund });
  if (d.aktion === "wandert") {
    const f = (fehler ?? []).find((x) => String(x.id) === String(d.id));
    const warum = f ? " (" + f.grund + ")" : "";
    return t("ursprungNichtBewegt", { name, warum, id: d.id });
  }
  return t("ursprungAktion", { name, aktion: d.aktion });
}

const ohneNullen = (id) => String(id).replace(/^0+(?=\d)/, "");

/**
 * Warum ein Paket fehlt, aus dem Stand der Umsetzungsstufe (Kriterium 5 des Fachplans #1279).
 * Verglichen ohne fuehrende Nullen: Die Stufe fuehrt die Nummern des Trackers (lokal `0003`),
 * `issue ursprung` nennt sie ohne (Issue #1290).
 */
function fehlendGrund(umsetzung, id) {
  const gleich = (e) => ohneNullen(e && typeof e === "object" ? e.id : e) === ohneNullen(id);
  if (umsetzung.ausgelassen) return t("fehlendAusgelassen", { grund: umsetzung.ausgelassen });
  const zurueck = (umsetzung.zurueckgestellt ?? []).find(gleich);
  if (zurueck) return t("fehlendZurueck", { grund: zurueck.grund });
  if ((umsetzung.angehalten ?? []).some(gleich)) return t("fehlendAngehalten");
  const fest = (umsetzung.festgefahren ?? []).find(gleich);
  if (fest) return t("fehlendFestgefahren", { pruefung: fest.pruefung });
  const offen = (umsetzung.nichtBegonnen ?? []).find(gleich);
  // Der Grund des Wartens auf einen Push kommt aus der Kette, in beiden Sprachen erkannt.
  if (offen) return /^(?:wartet auf einen Push|waits for a push)/.test(offen.grund ?? "") ? t("fehlendPush", { grund: offen.grund }) : t("fehlendNichtBegonnen", { grund: offen.grund });
  return t("fehlendNichtErfasst");
}

/** Die Zeilen fuer eine Kette, deren Umsetzung nicht begonnen hat: Dokumente bleiben, Pakete mit Spalte. */
function ursprungOhneUmsetzung(einheit, plan, pakete) {
  const stufen = einheit.stufen ?? {};
  const planId = stufen.plan?.id ?? (einheit.auftrag === "plan" ? einheit.id : null);
  const anforderung = einheit.auftrag === "plan" ? einheit.fachplan : einheit.id;
  const namen = [...(planId ? [t("ursprungPlan", { id: planId })] : []), ...(anforderung ? [t("ursprungFachlich", { id: anforderung })] : [])];
  const planSpalte = plan?.status ? t("planSpalte", { id: planId, spalte: spaltenText(plan.status) }) : "";
  const ids = stufen.pakete?.ids ?? [];
  const paketText = (id) => {
    const status = pakete.find((k) => String(k.id) === String(id))?.status;
    return status ? t("paketInSpalte", { bezeichnung: paketBezeichnung(pakete, id), spalte: spaltenText(status) }) : paketBezeichnung(pakete, id);
  };
  return [
    t("ursprungBleibenSpalte", {
      namen: namen.join(", ") || t("dieUrsprungsdokumente"), planSpalte, ausgang: anzeige("ausgang", einheit.ausgang), stufe: einheit.stufe,
    }),
    t("paketeListe", { liste: ids.length > 0 ? ids.map(paketText).join(", ") : t("nochNichtGeschnitten") }),
  ];
}

/**
 * Der Abschnitt `### Ursprungsdokumente`, unter demselben Tor wie `### Umsetzung` (Issue #1289,
 * Plan #1283 E8): ob Plan und Anforderung nach In review gewandert sind und, wenn nicht, warum
 * — mit den fehlenden Paketen (Kriterien 5 und 7 des Fachplans #1279). Der Stand liegt unter
 * `stufen.umsetzung.ursprung`: `{ vorher: {<nr>: spalte}, auswertung }` mit der Ausgabe von
 * `issue ursprung`, oder `{ fehler }`. Gewandert heisst: vorher ausserhalb von In review/Done,
 * laut Auswertung jetzt in In review. Fehlt der Stand, hat die Umsetzung nicht begonnen —
 * es sei denn, sie lief und hat ihn nicht festgehalten; das sagt der Bericht dann so.
 */
function berichtUrsprung(einheit, plan, pakete) {
  const umsetzung = einheit.stufen?.umsetzung;
  const ursprung = umsetzung?.ursprung;
  const z = [t("ursprungKopf"), ""];
  if (!ursprung) {
    if (umsetzung && !einheit.stufe) z.push(t("ursprungNichtFestgehalten"));
    else z.push(...ursprungOhneUmsetzung(einheit, plan, pakete));
    return [...z, ""];
  }
  if (ursprung.fehler) return [...z, t("ursprungNichtFeststellbar", { fehler: ursprung.fehler }), ""];
  const a = ursprung.auswertung ?? {};
  const dokumente = a.dokumente ?? [];
  if (dokumente.length === 0) z.push(t("ursprungPlanGrund", { plan: a.plan, grund: a.grund ?? t("keineUrsprungsdokumente") }));
  for (const d of dokumente) z.push(ursprungDokumentZeile(d, ursprung.vorher ?? {}, a.fehler));
  if ((a.fehlend ?? []).length > 0) {
    z.push(t("fehlendePakete"));
    for (const k of a.fehlend) {
      const titel = k.titel ?? pakete.find((p) => String(p.id) === String(k.id))?.title;
      const bezeichnung = titel ? `#${k.id} ${titel}` : `#${k.id}`;
      z.push(t("fehlendZeile", { bezeichnung, spalte: spaltenText(k.spalte), grund: fehlendGrund(umsetzung, k.id) }));
    }
  }
  return [...z, ""];
}

/**
 * Die erste Zeile der Stufen: welcher Auftrag diese Kette war (Issue #896) — `null`, wenn
 * die Einheit keine der beiden Arten ausweist.
 *
 * Ohne sie waere dem Bericht nicht anzusehen, was der Mensch abends gezeichnet hat: Beim
 * Plan-Auftrag traegt die Einheit die Nummer des Plans, beim Fachplan-Auftrag die der
 * Anforderung — dieselbe Zahl an derselben Stelle, zwei verschiedene Gesten.
 */
function berichtAuftragZeile(einheit) {
  if (einheit.auftrag === "plan") return t("auftragPlan", { plan: einheit.stufen?.plan?.id, fachplan: einheit.fachplan });
  return einheit.id ? t("auftragFachlich", { id: einheit.id }) : null;
}

/**
 * Die Planzeile der Stufen — je nachdem, ob der Plan in dieser Nacht entstanden ist.
 *
 * Eine uebernommene Stufe hat keine Dauer, keine Kosten und keine Korrekturrunden:
 * `Dauer 0.0 min` behauptete eine Messung, die es nicht gab (Issue #896).
 */
function berichtPlanZeile(stufen, plan) {
  const p = stufen.plan;
  const pruefer = planReviewWert(plan?.body) ?? t("prueferKeiner");
  const titel = plan?.title ? ` (${plan.title})` : "";
  if (p.uebernommen) return t("planUebernommen", { id: p.id, titel, pruefer });
  const kosten = p.kennzahlen?.kostenUsd;
  const kostenText = typeof kosten === "number" ? `${kosten.toFixed(2)} $` : t("kostenUnbekanntWert");
  return t("planZeile", {
    id: p.id, titel, minuten: minutenText(p.dauerMs), kosten: kostenText, runden: p.korrekturrunden ?? 0, pruefer,
    marker: t(stufen.review?.marker ? "markerGesetzt" : "markerFehlt"),
  });
}

function berichtStufen(einheit, plan, pakete) {
  const stufen = einheit.stufen ?? {};
  const auftrag = berichtAuftragZeile(einheit);
  const zeilen = [...(auftrag ? [auftrag] : []), t("variante", { variante: einheit.variante === "B" ? "B" : "A" })];
  // Unmittelbar nach der Variante (Plan #1243, E5): Die Endzeilen des Blocks bleiben fest.
  if (einheit.ziel) zeilen.push(t("ziel", { ziel: einheit.ziel }));
  zeilen.push(stufen.plan?.id ? berichtPlanZeile(stufen, plan) : t("keinPlan"));
  const ids = stufen.pakete?.ids ?? [];
  zeilen.push(ids.length > 0
    ? t("pakete", { anzahl: ids.length, runden: stufen.pakete?.korrekturrunden ?? 0, liste: ids.map((id) => paketBezeichnung(pakete, id)).join(", ") })
    : t("keinePakete"));
  const fremd = stufen.pakete?.nichtZuordenbar ?? [];
  if (fremd.length > 0) zeilen.push(t("nichtZuordenbar", { plan: stufen.plan?.id, liste: fremd.map((id) => "#" + id).join(", ") }));
  // Als letzte Zeile des Blocks (Issue #980): `test/night-bericht-kette.test.mjs` fixiert
  // die Folge bis einschliesslich `- Pakete: …`, und hinten angehaengt bleibt sie gueltig.
  zeilen.push(berichtSitzungsumfangZeile(ids, pakete));
  return zeilen;
}

function berichtAbgelehnt(einarbeitung) {
  if (einarbeitung === null) return [t("keineEinarbeitung")];
  // Die Einarbeitung schreibt eine Session in der Projektsprache; erkannt werden beide Woerter.
  const abgelehnt = einarbeitung.split(/\r\n|\r|\n/).map((z) => z.trim()).filter((z) => /abgelehnt|rejected/i.test(z));
  if (abgelehnt.length === 0) return [t("keineAbgelehnten")];
  return abgelehnt.map((z) => (/^[-*+]\s/.test(z) ? z : `- ${z}`));
}

/**
 * Der Nachtbericht als Markdown (Plan #638, A10). Reine Funktion ueber der Einheit und
 * den gelesenen Karten, damit sie an Fixtures pruefbar ist; `jetzt` nur fuer Tests.
 *
 * Die Entscheidungen der Nacht sind die Aufzaehlungspunkte erster Ebene aus den
 * Architektonischen Entscheidungen des Plans, woertlich, die `Entscheidung:`-Zeilen aus
 * dem Kontext jedes Pakets und die `### Entscheidungen`-Bloecke aus dessen Kommentaren
 * (Abschlussbericht, Issue #697) — fortlaufend nummeriert, mit dem Ort in Klammern.
 */
/** Alle Entscheidungen der Nacht, woertlich, mit dem Ort in Klammern — siehe `berichtBauen`. */
function berichtEntscheidungen(stufen, plan, pakete) {
  const entscheidungen = punkteErsterEbene(plan?.body, ENTSCHEIDUNGEN_UEBERSCHRIFT).map((eintrag) => t("ortPlan", { eintrag, id: stufen.plan?.id }));
  for (const k of pakete) {
    for (const eintrag of entscheidungsZeilen(k.body)) entscheidungen.push(t("ortPaket", { eintrag, id: k.id }));
    for (const eintrag of entscheidungenAusKommentaren(k)) entscheidungen.push(t("ortPaket", { eintrag, id: k.id }));
  }
  return entscheidungen;
}

/**
 * Was ein Halt der Kette fuer den Bericht ist (Issue #1050, E12): eine Stopp-Frage, und wie
 * viele Pakete an einer geschuetzten Datei warten. Ein geschuetzter Halt ist keine Frage —
 * er erscheint weder im Zaehler `Stopp-Fragen` noch unter `### Offene Stopp-Frage`.
 */
function berichtHaltArten(einheit) {
  if (einheit.ausgang !== "angehalten") return { stoppFrage: false, geschuetzt: 0 };
  const stand = einheit.stufen?.umsetzung;
  // Ein Halt ausserhalb der Umsetzung ist immer eine Stopp-Frage (Plan, Review, Schneiden).
  if ((stand?.angehalten?.length ?? 0) === 0) return { stoppFrage: true, geschuetzt: 0 };
  const arten = stand.angehalten.map((id) => stand.haltArten?.[id] ?? "klaeren");
  return { stoppFrage: arten.includes("klaeren"), geschuetzt: arten.filter((a) => a === "geschuetzt").length };
}

/**
 * Die Menschenschritte unter den nicht begonnenen Paketen einer Umsetzung, je mit den
 * Paketen, die an ihm haengen (Issue #1281) — in der Folge der Liste `nichtBegonnen`.
 *
 * Erkannt wird ein Menschenschritt am Feld `mensch`, das die Kette aus `istMensch` setzt,
 * nicht am Grundtext. Es haengt jedes nicht begonnene Paket daran, dessen unerfuellte
 * Abhaengigkeiten (`unmet`) direkt oder ueber andere nicht begonnene Pakete auf ihn
 * zurueckgehen: Im Anlass hing #1275 nur ueber #1274 an #1273.
 */
export function wartendeMenschenschritte(stand) {
  const nicht = (stand?.nichtBegonnen ?? []).map((e) => ({ ...e, id: String(e.id), unmet: (e.unmet ?? []).map(String) }));
  return nicht.filter((e) => e.mensch).map(({ id }) => {
    const erreicht = new Set([id]);
    for (let neu = true; neu;) {
      neu = false;
      for (const e of nicht) {
        if (erreicht.has(e.id) || !e.unmet.some((d) => erreicht.has(d))) continue;
        erreicht.add(e.id);
        neu = true;
      }
    }
    return { id, haengen: nicht.map((e) => e.id).filter((n) => n !== id && erreicht.has(n)) };
  });
}

/**
 * Die Zeilen unter `### Ausgang`. Blieb die Kette an der Projektgrenze vor ihrem Ziel stehen,
 * steht das zusaetzlich zum Wartetext da, kein fuenfter Ausgang (Plan #1243, E6): Die
 * Ausgaenge sind Vertrag mit der Laufmeldung. Ebenso je wartendem Menschenschritt eine
 * Zeile (Issue #1281) — dort, wo der Mensch zuerst liest, nicht nur unter `nicht begonnen`.
 */
function berichtAusgang(einheit, pakete) {
  const ausgang = anzeige("ausgang", einheit.ausgang);
  const zeilen = [einheit.grund ? t("ausgangGrund", { ausgang, grund: einheit.grund }) : ausgang];
  if (einheit.ziel && einheit.projektgrenze) zeilen.push(t("projektgrenze", { ziel: einheit.ziel }));
  for (const { id, haengen } of wartendeMenschenschritte(einheit.stufen?.umsetzung)) {
    const daran = haengen.length > 0 ? t("daranHaengen", { liste: haengen.map((n) => "#" + n).join(", ") }) : t("daranHaengtNichts");
    zeilen.push(t("wartetAufMensch", { bezeichnung: paketBezeichnung(pakete, id), daran }));
  }
  return zeilen;
}

export function berichtBauen(einheit, {
  plan = null, pakete = [], einarbeitung = null, abdeckung = null, budget = {}, start, stempel, frage = null, jetzt = Date.now(),
  // Die Paket-Einheiten des Laufs und die Zielmarke (Issue #926): Der Bericht rechnet die
  // Prueflaeufe daraus, und als Argumente bleibt er eine reine Funktion ueber Fixtures.
  einheiten = [], zielUmsetzungMin: ziel = undefined,
  // Der feste Kit-Stand des Laufs (Issue #1103). Er steht im Text selbst: Ein wartender
  // Bericht, den ein spaeterer Lauf nachtraegt, nennt so den Stand des Laufs, der ihn schrieb.
  kitStand = ZUSTAND.LAUF?.kitStand ?? null,
} = {}) {
  const stufen = einheit.stufen ?? {};
  const z = [`${berichtAnker()} ${stempel ?? ZUSTAND.LAUF_STEMPEL ?? t("ohneStempel")}`, ""];
  z.push(
    t("ausgangKopf"), "", ...berichtAusgang(einheit, pakete), "",
    t("stufenKopf"), "", ...berichtStufen(einheit, plan, pakete), "",
  );
  if (einheit.variante === "B") z.push(...berichtUmsetzung(einheit, pakete, einheiten, ziel), ...berichtUrsprung(einheit, plan, pakete));

  const entscheidungen = berichtEntscheidungen(stufen, plan, pakete);
  z.push(t("entscheidungenKopf"), "");
  if (entscheidungen.length === 0) z.push(t("keineEntscheidungen"));
  entscheidungen.forEach((e, i) => z.push(`${i + 1}. ${e}`));
  // Ohne Widerspruch entfaellt der Kopf (Issue #1541): Die Zeilenfolge jeder anderen Kette bleibt.
  const widersprueche = widerspruchsZeilen(plan?.body);
  if (widersprueche.length > 0) z.push("", t("widerspruecheKopf"), "", ...widersprueche);

  z.push(
    "",
    t("abgelehntKopf"), "", ...berichtAbgelehnt(einarbeitung), "",
    t("abdeckungKopf"), "",
  );
  if (abdeckung?.text) z.push(abdeckung.text);
  else z.push(t("keineAbdeckung", { grund: abdeckung?.grund ?? t("abdeckungNichtErreicht") }));
  if (einheit.abdeckungSchrieb) z.push("", t("abdeckungSchrieb"));
  z.push("");

  const halt = berichtHaltArten(einheit);
  const startZeit = start instanceof Date ? start : new Date(start ?? jetzt);
  const paketeErreicht = (stufen.pakete?.ids ?? []).length > 0;
  z.push(t("kennzahlenKopf"), "",
    t("paketeErreicht", { wert: t(paketeErreicht ? "ja" : "nein") }),
    t("dauerKette", { minuten: minutenText(jetzt - startZeit.getTime()), start: startZeit.toISOString() }),
    t("anzahlEntscheidungen", { anzahl: entscheidungen.length }),
    t("stoppFragen", { anzahl: halt.stoppFrage ? 1 : 0 }),
    ...(halt.geschuetzt > 0 ? [t("geschuetzteDateien", { anzahl: halt.geschuetzt })] : []),
    t("kosten", { kosten: Number(einheit.kostenUsd ?? 0).toFixed(2), budget: budget.kostenUsd ?? "?" }),
    t("kostenUnbekannt", { anzahl: einheit.kostenUnbekannt ?? 0 }),
    "");
  if (halt.stoppFrage) z.push(t("stoppFrageKopf"), "", frage ?? einheit.grund ?? t("siehHaltKarte"), "");
  if (halt.geschuetzt > 0) z.push(t("geschuetztKopf"), "", einheit.grund ?? t("siehHaltPaket"), "");
  if ((einheit.ueberholt ?? []).length > 0) z.push(t("ueberholtKopf"), "", ...einheit.ueberholt.map((id) => t("ueberholtZeile", { id })), "");
  if ((einheit.ueberholtUnbestaetigt ?? []).length > 0) {
    z.push(t("unbestaetigtKopf"), "", ...einheit.ueberholtUnbestaetigt.map((e) => t("unbestaetigtZeile", { id: e.id, grund: e.grund })), "");
  }
  if (kitStand) z.push(kitStandZeile(kitStand), "");
  z.push(t("berichtSchluss"), "");
  return z.join("\n");
}

// Die Ergebnisse der Vorbereitung im Wortlaut des Fachplans (#1192, Kriterium 16) stehen als
// `ergebnis_<wert>` in TEXTE.
const kartenListe = (ids) => ((ids ?? []).length > 0 ? ids.map((id) => `#${id}`).join(", ") : t("listeLeer"));

/**
 * Der eigene Nachtbericht der Vorbereitung an einer ausloesenden Karte (Plan #1243, E12;
 * Issue #1254): Ergebnis, gepruefter Stand, Pakete, offene Pruefungen samt Build-Dienst-Punkt
 * (E17) und eine rote Pruefung mit ihren Verursachern. `vorbereitung` hat die Form von
 * `.claude/push-vorbereitung.json`; bei `nicht-vorbereitet` traegt sie nur `grund`. Der
 * Bericht der Kette bleibt unberuehrt — er steht zu diesem Zeitpunkt schon an der Karte.
 * Die Karte nennt der Text nicht: Er steht an ihr, und die Meldung gilt dem ganzen Stand.
 */
export function vorbereitungsBericht(_karte, vorbereitung, { stempel = ZUSTAND.LAUF_STEMPEL } = {}) {
  const v = vorbereitung ?? {};
  const ergebnis = anzeige("ergebnis", v.ergebnis);
  const unbekannt = t("unbekannt");
  const z = [t("vorbereitungAnker", { anker: berichtAnker(), stempel: stempel ?? t("ohneStempel") }), ""];
  const releaseText = v.releaseDateien ? t("releaseBereit", { version: v.version }) : t("releaseNicht");
  z.push(t("ergebnisKopf"), "", v.grund ? `${ergebnis} — ${v.grund}` : ergebnis, "");
  if (v.ergebnis !== "nicht-vorbereitet") {
    z.push(t("standKopf"), "",
      t("standCommit", { commit: v.commit ?? unbekannt, basis: v.basis ?? unbekannt, origin: v.origin ?? unbekannt }),
      t("standRelease", { release: releaseText }),
      t(v.fetch === "fehlgeschlagen" ? "standFetchFehl" : "standFetchOk"),
      t("standZeitpunkt", { zeitpunkt: v.zeitpunkt ?? unbekannt }),
      ...(v.abweichung ? [t("standAbweichung", { abweichung: v.abweichung })] : []),
      "",
      t("paketeImStandKopf"), "", kartenListe(v.pakete), "",
      t("offenKopf"), "", ...((v.offen ?? []).length > 0 ? v.offen.map((o) => `- ${o}`) : [t("offenKeine")]), "");
    if (v.rot) {
      z.push(t("rotKopf"), "",
        t("rotPruefung", { pruefung: v.rot.pruefung ?? unbekannt }),
        t("rotVerursacher", { karten: kartenListe(v.rot.karten) }),
        ...(v.rot.hinweis ? [t("rotHinweis", { hinweis: v.rot.hinweis })] : []),
        "");
    }
  }
  z.push(t("vorbereitungSchluss", { datei: VORBEREITUNG_DATEI }), "");
  return z.join("\n");
}

/**
 * Schreibt den Bericht als Kommentar an die gekennzeichnete Karte (A11; Issue #896) —
 * ueber eine Datei ausserhalb des Projekts, nie als Argument. Nimmt der Tracker ihn nicht
 * an, wartet er als `.claude/night-bericht-<zielId>-<stempel>.md` in der Hauptkopie.
 * Rueckgabe ist der Wert fuer `einheit.bericht`: "veroeffentlicht" oder der wartende Pfad.
 * Kein `fail`: Ein toter Tracker beim letzten Schritt darf die Kette nicht als Absturz
 * enden lassen.
 *
 * `zielId` ist die Nummer der Karte, die das Kennzeichen trug — beim Plan-Auftrag der
 * Plan. Der Bericht gehoert dorthin, wo der Mensch morgens nachsieht: an die Karte, die
 * er abends gezeichnet hat. `berichteNachtragen` liest die Nummer weiter aus dem
 * Dateinamen und bleibt davon unberuehrt.
 */
export function berichtSchreiben(zielId, text, { stempel = ZUSTAND.LAUF_STEMPEL, repoRoot = process.cwd() } = {}) {
  const name = `${BERICHT_DATEI_PRAEFIX}${zielId}-${stempel ?? Date.now()}.md`;
  // Mit der Prozess-Id: Zwei Runner in derselben Sekunde teilten sich sonst die Zwischendatei.
  const pfad = join(tmpdir(), `${process.pid}-${name}`);
  writeFileSync(pfad, text, "utf-8");
  try {
    const res = abh.boardRoh("issue", "comment", String(zielId), "--text-file", pfad);
    if (res.status === 0) {
      log(t("berichtVeroeffentlicht", { id: zielId }));
      return "veroeffentlicht";
    }
    const wartend = join(".claude", name);
    mkdirSync(join(repoRoot, ".claude"), { recursive: true });
    writeFileSync(join(repoRoot, wartend), text, "utf-8");
    log(t("berichtWartet", { id: zielId, antwort: res.text.slice(0, 200), pfad: wartend }));
    return wartend;
  } finally {
    rmSync(pfad, { force: true });
  }
}

/**
 * Traegt wartende Berichte nach — beim Start jeder Betriebsart, nach `vorbereiten`.
 * Aufsteigend nach Dateiname, jeder genau einmal; gelingt das Schreiben, ist die Datei
 * weg, sonst bleibt sie liegen und der Lauf geht weiter. Liefert die nachgetragenen Namen.
 *
 * Genau einmal auch bei zwei Runnern (Plan #1113, E12; Issue #1190): Vor dem Posten wird
 * der Bericht auf `<name>.sendet-<pid>` umbenannt. Das Umbenennen ist atomar — wem es nicht
 * gelingt, dem hat ein anderer Runner den Bericht abgenommen, und er ueberspringt ihn.
 * Scheitert das Posten, wird zurueckbenannt. Eine `.sendet-`-Datei, deren Prozess nicht
 * mehr lebt, benennt der naechste Start zurueck und traegt sie im selben Zug nach.
 * `posten` und `pid` sind fuer die Tests einspeisbar.
 */
export function berichteNachtragen(repoRoot = process.cwd(), {
  posten = (F, pfad) => abh.boardRoh("issue", "comment", F, "--text-file", pfad),
  pid = process.pid,
} = {}) {
  const ordner = join(repoRoot, ".claude");
  if (!existsSync(ordner)) return [];
  verwaisteSendungenZurueck(ordner);
  // Codepoint-Ordnung wie bisher (Issue #956, S2871): Die Berichte tragen den
  // Zeitstempel im Namen, aufsteigend nach Dateiname ist aufsteigend nach Zeit.
  const dateien = readdirSync(ordner)
    .filter((n) => n.startsWith(BERICHT_DATEI_PRAEFIX) && n.endsWith(".md")).sort(vergleicheText);
  const nachgetragen = [];
  for (const name of dateien) {
    const F = name.slice(BERICHT_DATEI_PRAEFIX.length).split("-")[0];
    const pfad = join(ordner, name);
    const sendet = `${pfad}${SENDET_MARKE}${pid}`;
    try {
      renameSync(pfad, sendet);
    } catch {
      log(t("nachtragenUebersprungen", { name }));
      continue;
    }
    const res = posten(F, sendet);
    if (res.status === 0) {
      rmSync(sendet, { force: true });
      nachgetragen.push(name);
      log(t("nachgetragen", { name, id: F }));
    } else {
      renameSync(sendet, pfad);
      log(t("bleibtLiegen", { name, antwort: res.text.slice(0, 200) }));
    }
  }
  return nachgetragen;
}

/** Die Marke zwischen Berichtsname und Prozess-Id eines gerade gesendeten Berichts (E12). */
const SENDET_MARKE = ".sendet-";

/**
 * Benennt jede `.sendet-<pid>`-Datei zurueck, deren Prozess nicht mehr lebt (Plan #1113,
 * E12): Ein Runner, der beim Posten starb, liess den Bericht unter dem Sendenamen liegen,
 * und ohne Rueckbenennung truege ihn niemand mehr nach.
 */
function verwaisteSendungenZurueck(ordner) {
  for (const n of readdirSync(ordner)) {
    if (!n.startsWith(BERICHT_DATEI_PRAEFIX)) continue;
    const stelle = n.lastIndexOf(SENDET_MARKE);
    if (stelle < 0) continue;
    const halter = pidAusInhalt(n.slice(stelle + SENDET_MARKE.length));
    if (halter !== null && prozessLaeuft(halter)) continue;
    const name = n.slice(0, stelle);
    try {
      renameSync(join(ordner, n), join(ordner, name));
      log(t("zurueckbenannt", { von: n, nach: name, pid: halter ?? t("unbekannt") }));
    } catch {
      // Ein anderer Start benannte ihn im selben Augenblick zurueck — dann liegt er schon da.
    }
  }
}

/**
 * Die Paket-Einheiten genau dieser Kette, in der Reihenfolge des Laufs (Issue #926).
 *
 * `LAUF.einheiten` fuehrt jede Einheit des Nachtlaufs — auch die frueherer Ketten und
 * die Ketten-Einheiten selbst. Fuer den Bericht einer Karte zaehlen allein die Pakete,
 * die diese Kette bestellt hat.
 */
export function ketteEinheiten(kette, alle = undefined) {
  const ids = new Set((kette?.stufen?.pakete?.ids ?? []).map(String));
  if (ids.size === 0) return [];
  const quelle = alle ?? ZUSTAND.LAUF?.einheiten ?? [];
  return quelle.filter((e) => ids.has(String(e?.id)));
}

/** Sammelt Plan, Pakete, Einarbeitung und Abdeckung der Kette und baut den Bericht. */
export function berichtFuerKette(kette, einheit, ergebnis) {
  const planId = kette.stufen.plan?.id;
  const plan = planId ? leseKarte(planId) : null;
  const pakete = (kette.stufen.pakete?.ids ?? []).map(leseKarte).filter(Boolean);
  const a = kette.stufen.abdeckung;
  return berichtBauen(einheit, {
    plan, pakete, einarbeitung: plan ? einarbeitungVon(plan) : null,
    abdeckung: a ? { text: a.text, grund: a.grund } : null,
    budget: kette.budget, start: kette.start, stempel: ZUSTAND.LAUF_STEMPEL, frage: ergebnis.frage ?? null,
    // Die Paket-Einheiten DIESER Kette (Issue #926, eingegrenzt im Code-Review): Aus
    // ihnen rechnet der Bericht die Prueflaeufe und die Zielmarke; die Ketten-Einheit
    // selbst traegt sie nicht. Die Eingrenzung auf `kette.stufen.pakete.ids` ist noetig,
    // weil `LAUF.einheiten` ALLE Einheiten des Nachtlaufs fuehrt: Ab der zweiten Kette
    // eines Laufs stuenden sonst fremde Pakete im Kommentar dieser Karte, und die Zeile
    // "N von M" zaehlte sie mit.
    einheiten: ketteEinheiten(kette), zielUmsetzungMin: ZUSTAND.config?.night?.zielUmsetzungMin,
  });
}