/**
 * board/vorgeschichte.mjs — Vorgeschichte eines neuen Fachplans und Plans (Issue #1537,
 * Plan #1534 A7): frühere Fachpläne des eigenen Boards vor dem Schreiben lesen.
 *
 * `vorgeschichteAktiv` ist die eine Stelle, über die Formprüfung, Kommando und Prüfauftrag
 * lesen, ob ein Projekt die Vorgeschichte sucht. Die Typprüfung übernimmt das Schema; beim
 * Lesen gilt alles außer `true` als aus, ohne Abbruch.
 *
 * `issue vorgeschichte` (Issue #1539) sucht die früheren Fachpläne auf zwei Wegen: je Begriff
 * über die Suche des Boards (archivierte Karten eingeschlossen), je Datei über die
 * Kartennummern ihrer letzten Commits und deren Herkunftskette (A4). Es führt die Treffer
 * über die Nummer zusammen, ordnet und begrenzt sie (A2) und holt je Treffer die Karte.
 * Fehlende Vorgeschichte hält kein Dokument auf: Jeder Ausgang ist ein Ergebnis mit Exit 0,
 * und der erste Fehlschlag am Board beendet die Suche sofort (A8, E5) — `_fetch` wiederholt
 * Netzfehler bis zum Budget, weitere Aufrufe summierten sich zu einer langen Wartezeit.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { spawnSync } from "node:child_process";

import { BoardError, out } from "./grundlagen.mjs";
import { zerlegeAbschnitte } from "./dokumente.mjs";
import { BEFEHLSNAMEN, erkennePraefix, kanonischeUeberschrift, prozessSprache, text } from "./namen.mjs";

// Die Texte an den Menschen liegen unter kit/texte/board-vorgeschichte.mjs.
import { TEXTE } from "../texte/board-vorgeschichte.mjs";

export { TEXTE };

const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

/** Sucht das Projekt vor einem Fachplan oder Plan die Vorgeschichte? Nur bei `true`. */
export function vorgeschichteAktiv(config) {
  return config?.vorgeschichte === true;
}

/** Höchstzahl der Treffer im Ergebnis; die Zahl darüber steht in `weitere` (A2). */
export const TREFFER_GRENZE = 20;
/** Gelesene Commits je Datei (E4). */
export const COMMITS_JE_DATEI = 30;
/** Suchtreffer je Begriff, die das Board liefern soll, bevor der Präfixfilter greift. */
export const SUCHE_GRENZE = 100;
/** Länge des Auszugs aus dem Abschnitt `## Ziel`. */
export const AUSZUG_LAENGE = 200;

const ARCHIV_METHODEN = ["sucheFachplaene", "karteNachNummer", "herkunftskette"];
const LOG_FELD = "\x1f";
const LOG_SATZ = "\x1e";

/** Ein Fehlschlag am Board; nur er wird zu `archiv-nicht-erreichbar`, kein Fehler im Kommando selbst. */
class ArchivFehler extends Error {}

/** Ruft das Board und markiert jeden Fehlschlag als Archiv-Fehler. */
async function amBoard(aufruf) {
  try {
    return await aufruf();
  } catch (e) {
    throw new ArchivFehler(e?.message ?? String(e));
  }
}

const istFachplan = (titel) => erkennePraefix(titel) === "fachlich";

/** Die ersten Zeichen des Abschnitts `## Ziel`, leer ohne ihn. */
export function zielAuszug(body) {
  const ziel = kanonischeUeberschrift("Ziel");
  const abschnitt = zerlegeAbschnitte(body ?? "").abschnitte.find((a) => a.titel === ziel);
  return abschnitt ? abschnitt.zeilen.join("\n").trim().slice(0, AUSZUG_LAENGE) : "";
}

/**
 * Die Kartennummern der letzten Commits an einer Datei, jüngste zuerst und ohne Doppel. Gelesen
 * wird die Commit-Konvention über den Leser aus checks.mjs. Scheitert `git log` (kein
 * Repository), trägt die Datei nichts bei — das ist kein Fehlschlag am Board.
 */
export async function kartenAusCommits(datei, { cwd = process.cwd() } = {}) {
  const { kartennummerAusBotschaft } = await import("../checks.mjs");
  const res = spawnSync("git", ["log", "-n", String(COMMITS_JE_DATEI), `--format=%s${LOG_FELD}%b${LOG_SATZ}`, "--", datei],
    { cwd, encoding: "utf-8" });
  if (res.status !== 0) return [];
  const nummern = [];
  for (const satz of res.stdout.split(LOG_SATZ)) {
    const [betreff, rumpf = ""] = satz.replace(/^\n/, "").split(LOG_FELD);
    if (!betreff) continue;
    const karte = kartennummerAusBotschaft(betreff, rumpf);
    if (karte !== null && !nummern.includes(Number(karte))) nummern.push(Number(karte));
  }
  return nummern;
}

/** Trägt einen Treffer unter seiner Nummer ein oder ergänzt den vorhandenen. */
function eintragen(kandidaten, { nummer, titel, archiviert }, begriff) {
  const vorhanden = kandidaten.get(nummer) ?? { nummer, titel, archiviert, begriffe: new Set() };
  if (begriff !== undefined) vorhanden.begriffe.add(begriff);
  kandidaten.set(nummer, vorhanden);
}

/** Der erste Fachplan der Herkunftskette, Lücken übersprungen (A4); sonst `null`. */
function fachplanDerKette(glieder) {
  return glieder.find((g) => !g.gap && istFachplan(g.titel)) ?? null;
}

/**
 * Sucht die früheren Fachpläne. `begriffe`, `dateien` und `ohne` sind Listen; `bodies` legt den
 * ungekürzten Body jedes Treffers bei. Liefert das Ergebnis des Kommandos, wirft nie wegen des
 * Boards.
 */
export async function vorgeschichteSuchen(tracker, config, { begriffe = [], dateien = [], ohne = [], bodies = false, cwd } = {}) {
  if (!vorgeschichteAktiv(config)) return { ok: false, grund: "abgeschaltet" };
  if (!ARCHIV_METHODEN.every((m) => typeof tracker?.[m] === "function")) return { ok: false, grund: "tracker-ohne-suche" };
  const ergebnis = { ok: true, suchbegriffe: begriffe, dateien, treffer: [], weitere: 0 };
  if (begriffe.length === 0 && dateien.length === 0) return ergebnis;
  try {
    return { ...ergebnis, ...await treffenUndHolen(tracker, { begriffe, dateien, ohne: new Set(ohne), bodies, cwd }) };
  } catch (e) {
    if (e instanceof ArchivFehler) return { ok: false, grund: "archiv-nicht-erreichbar", meldung: e.message };
    throw e;
  }
}

/** Der Suchweg: je Begriff die Treffer mit [Fachlich]-Präfix (E8). */
async function ausSuche(tracker, kandidaten, begriffe, ohne) {
  for (const begriff of begriffe) {
    const { treffer } = await amBoard(() => tracker.sucheFachplaene(begriff, { limit: SUCHE_GRENZE }));
    for (const hit of treffer) if (istFachplan(hit.titel) && !ohne.has(hit.nummer)) eintragen(kandidaten, hit, begriff);
  }
}

/** Der Dateiweg (A4): je Kartennummer der Commits der erste Fachplan ihrer Herkunftskette. */
async function ausDateien(tracker, kandidaten, dateien, ohne, cwd) {
  const gelesen = new Set();
  for (const datei of dateien) {
    for (const nummer of await kartenAusCommits(datei, { cwd })) {
      if (gelesen.has(nummer)) continue;
      gelesen.add(nummer);
      const fachplan = fachplanDerKette(await amBoard(() => tracker.herkunftskette(nummer)));
      if (fachplan && !ohne.has(fachplan.nummer)) eintragen(kandidaten, fachplan);
    }
  }
}

/** Je Kandidat die Karte; eine 404 überspringt ihn (E7), ohne ihn zu zählen. */
async function kartenHolen(tracker, auswahl, bodies) {
  const treffer = [];
  for (const kandidat of auswahl) {
    const karte = await amBoard(() => tracker.karteNachNummer(kandidat.nummer));
    if (karte === null) continue;
    const eintrag = {
      nummer: kandidat.nummer,
      titel: karte.titel ?? kandidat.titel,
      archiviert: karte.archiviert,
      weg: kandidat.begriffe.size > 0 ? "suche" : "datei",
      auszug: zielAuszug(karte.body),
    };
    if (bodies) eintrag.body = karte.body;
    treffer.push(eintrag);
  }
  return treffer;
}

async function treffenUndHolen(tracker, { begriffe, dateien, ohne, bodies, cwd }) {
  const kandidaten = new Map();
  await ausSuche(tracker, kandidaten, begriffe, ohne);
  await ausDateien(tracker, kandidaten, dateien, ohne, cwd);
  const geordnet = [...kandidaten.values()]
    .sort((a, b) => b.begriffe.size - a.begriffe.size || b.nummer - a.nummer);
  const auswahl = geordnet.slice(0, TREFFER_GRENZE);
  const treffer = await kartenHolen(tracker, auswahl, bodies);
  // Fehlt jede Karte, fehlt der Endpunkt — nicht „nichts gefunden“ (E7).
  if (auswahl.length > 0 && treffer.length === 0) throw new ArchivFehler(t("alleNichtGefunden", { zahl: auswahl.length }));
  return { treffer, weitere: geordnet.length - auswahl.length };
}

/** Der Name einer Option in der Projektsprache. */
const optionsName = (name) => (prozessSprache() === "en" ? BEFEHLSNAMEN.optionen[name] ?? name : name);

/** Alle Werte einer mehrfach erlaubten Option; eine Option ohne Wert bricht ab. */
function werteVon(args, name) {
  if (args[name] === true) throw new BoardError(t("optionOhneWert", { option: optionsName(name) }));
  return args.werte?.[name] ?? [];
}

/** `issue vorgeschichte` (Issue #1539): Ergebnis als JSON, Exit 0 auch ohne Archiv. */
export async function issueVorgeschichte(tracker, config, args, hilfe) {
  if (args.help) {
    process.stdout.write(hilfe);
    return;
  }
  const ohne = werteVon(args, "ohne").map((wert) => {
    if (!/^#?\d+$/.test(wert)) throw new BoardError(t("keineNummer", { option: optionsName("ohne"), wert }));
    return Number(wert.replace("#", ""));
  });
  out(await vorgeschichteSuchen(tracker, config, {
    begriffe: werteVon(args, "begriffe"),
    dateien: werteVon(args, "dateien"),
    ohne,
    bodies: args.bodies !== undefined,
  }));
}
