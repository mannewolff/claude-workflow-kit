/**
 * board/triage.mjs — das Mechanische von /triage (Issue #1628, Plan #1623 A2–A6, A10–A12, E1,
 * E5): ob `/triage` an einer Karte beginnen darf, was in der Ablage `.claude/ideas/<N>/` einer
 * Idee liegt, wie weit der geklaerte Stand im Body der Idee ist und ob ein neuer Body den Text
 * der Idee und die bestaetigten Punkte behaelt.
 *
 * Reine Funktionen ohne Board-Zugriff; den Zugriff traegt allein der Einstieg in
 * kit/board.mjs, `issue triage`. Gespraechsfuehrung, Empfehlung und Bahnvorschlag sind Urteil
 * der Session und stehen im Skill, nicht hier (A2). Das Abschliessen der Ablage (`--finish`)
 * folgt in einem eigenen Paket.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

import { fenceLauf, istIdee, normalisiereZeilenenden, zerlegeAbschnitte } from "./dokumente.mjs";
import { fragenLesen } from "./grooming.mjs";
import { kanonischeUeberschrift, leseMarker, praefix, prozessSprache, text, ueberschriftName,
  ueberschriftZeile } from "./namen.mjs";

// Die Texte an den Menschen liegen unter kit/texte/board-triage.mjs.
import { TEXTE } from "../texte/board-triage.mjs";

export { TEXTE };

const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

// Die Ablage je Idee relativ zur Projektwurzel (A11) und der dauerhafte Ort einer Vorlage (E2).
export const ABLAGE = ".claude/ideas";
export const VORLAGE_ORT = "design/ideas";

// Die Endungen, die die Session liest (A12); gross/klein gleichgueltig.
const GELESEN = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".md"]);

const nummer = (id) => String(id ?? "").trim().replace(/^#/, "");

/**
 * Darf `/triage` an dieser Karte beginnen? `{ start, grund, meldung }`. Die Gruende in dieser
 * Reihenfolge (A3): `keine-idee` (Titel ohne `[Idea]`, auch ohne den frueheren deutschen
 * Namen `[Idee]`), `unbeaufsichtigt` (gesetztes, nicht leeres `KIT_AGENT_MODEL`). `env` ist
 * die Umgebung des Aufrufs, in der Regel `process.env`.
 */
export function triageEinstieg(issue, env = {}) {
  const id = issue?.id ?? "?";
  if (!istIdee(issue?.title ?? "")) {
    return { start: false, grund: "keine-idee", meldung: t("keineIdee", { id, praefix: praefix("idee", prozessSprache()) }) };
  }
  if (String(env?.KIT_AGENT_MODEL ?? "").trim() !== "") {
    return { start: false, grund: "unbeaufsichtigt", meldung: t("unbeaufsichtigt") };
  }
  return { start: true, grund: null, meldung: null };
}

/**
 * Die Ablage `.claude/ideas/<id>/` unter `wurzel` (A11, A12): `{ pfad, vorhanden, dateien:
 * [{ name, gelesen, vorlageZiel }] }`, nach Namen geordnet. `pfad` ist relativ zur Wurzel.
 * Gelesen sind Dateien der Endungen aus A12 direkt in der Ablage; jede andere Datei und jedes
 * Unterverzeichnis ist `gelesen: false`. `vorlageZiel` ist der dauerhafte Ort einer Datei als
 * Vorlage (`design/ideas/<id>/<datei>`), bei einem Unterverzeichnis null. Legt nie etwas an.
 */
export function ablageLesen(wurzel, id) {
  const n = nummer(id);
  const pfad = `${ABLAGE}/${n}`;
  const verzeichnis = join(wurzel, ABLAGE, n);
  if (!existsSync(verzeichnis)) return { pfad, vorhanden: false, dateien: [] };
  const dateien = readdirSync(verzeichnis, { withFileTypes: true })
    .map((e) => (e.isDirectory()
      ? { name: e.name, gelesen: false, vorlageZiel: null }
      : { name: e.name, gelesen: GELESEN.has(extname(e.name).toLowerCase()), vorlageZiel: `${VORLAGE_ORT}/${n}/${e.name}` }))
    .sort((a, b) => (a.name < b.name ? -1 : Number(a.name > b.name)));
  return { pfad, vorhanden: true, dateien };
}

/** Die Zeilen des Abschnitts `## Geklärter Stand` (beide Sprachen) ohne Codezeilen. */
function standZeilen(body) {
  const titel = kanonischeUeberschrift(ueberschriftName("geklaerterStand", "de"));
  return zerlegeAbschnitte(body ?? "").abschnitte.find((a) => a.titel === titel)?.zeilen ?? [];
}

/** Die Werte des Markers `sache` im Abschnitt, in der Reihenfolge des Body. */
const werteIm = (zeilen, sache) => zeilen.map(leseMarker).filter((m) => m?.sache === sache).map((m) => m.rest.trim());

// Der gewaehlte Wert der Bahn-Zeile (A6, E1) steht vor dem Gedankenstrich; der vorgeschlagene dahinter.
const BAHN = /^(?:([13])|2\s*,\s*(fachlich|business|technisch|technical))(?:\s+[—–-]\s|\s*$)/i;
const BAHN_ZWEI = { fachlich: "2, fachlich", business: "2, fachlich", technisch: "2, technisch", technical: "2, technisch" };

/** Die gewaehlte Bahn kanonisch (`1`, `2, fachlich`, `2, technisch`, `3`), sonst null. */
function bahnWert(rest) {
  const m = BAHN.exec(rest);
  if (!m) return null;
  return m[1] ?? BAHN_ZWEI[m[2].toLowerCase()];
}

// Der Wert der Ergebnis-Zeile (A10): `Issue #M`, `Idee <ideaId>` bzw. `Idea <ideaId>`, `Commit <sha>`.
const ERGEBNIS = /^(?:Issue\s+#(\d+)|(?:Idee|Idea)\s+(\S+)|Commit\s+([0-9a-f]{7,40}))(?:\s|$)/i;
// Der Spur-Kommentar der Zielskills als erste nichtleere Zeile: `Fortsetzung: Issue #M` bzw. `Fortsetzung: Idee <ideaId> …`.
const FORTSETZUNG = /^Fortsetzung:\s*(?:Issue\s+#(\d+)|Idee\s+(\S+))(?:\s|$)/;

function ergebnisAus(m, quelle) {
  if (!m) return null;
  if (m[1] !== undefined) return { art: "issue", wert: m[1], quelle };
  if (m[2] !== undefined) return { art: "idee", wert: m[2], quelle };
  return { art: "commit", wert: m[3], quelle };
}

/** Das Ergebnis aus dem juengsten Spur-Kommentar; die Kommentare kommen juengster zuletzt. */
function ergebnisAusKommentaren(comments) {
  for (const k of [...(comments ?? [])].reverse()) {
    const body = typeof k === "string" ? k : k?.body;
    const erste = String(body ?? "").split(/\r\n|\r|\n/).find((z) => z.trim() !== "") ?? "";
    const ergebnis = ergebnisAus(FORTSETZUNG.exec(erste.trim()), "kommentar");
    if (ergebnis) return ergebnis;
  }
  return null;
}

/**
 * Der geklaerte Stand einer Idee (A4, A6, A10): `{ punkte, offen, bahn, vorlage, ergebnis }`.
 * `punkte` liest der Leser von /groom unter `## Geklärter Stand` (A5), je Punkt `{ nr, text,
 * entschieden, antwortZeile }`; `offen` zaehlt die ohne Antwortzeile. `bahn` ist der gewaehlte
 * Wert der letzten Bahn-Zeile im Abschnitt, kanonisch deutsch, sonst null. `vorlage` ist der
 * Wert der letzten Vorlage-Zeile im Abschnitt. `ergebnis` ist `{ art, wert, quelle }` mit `art`
 * `issue`, `idee` oder `commit`: aus der Ergebnis-Zeile (`quelle: "zeile"`), fehlt sie oder ist
 * sie unlesbar, aus dem juengsten Kommentar `Fortsetzung: …` (`quelle: "kommentar"`), sonst null.
 */
export function standLesen(body, comments) {
  const r = fragenLesen(body ?? "", "geklaerterStand");
  const zeilen = standZeilen(body);
  const bahn = werteIm(zeilen, "bahn").at(-1);
  const ergebnisZeile = werteIm(zeilen, "ergebnis").at(-1);
  return {
    punkte: r.fragen,
    offen: r.offen,
    bahn: bahn === undefined ? null : bahnWert(bahn),
    vorlage: werteIm(zeilen, "vorlage").at(-1) ?? null,
    ergebnis: ergebnisAus(ERGEBNIS.exec(ergebnisZeile ?? ""), "zeile") ?? ergebnisAusKommentaren(comments),
  };
}

/** Der Text der Idee oberhalb von `## Geklärter Stand`, ohne Leerraum am Ende. */
function ideentext(body) {
  const kopf = ueberschriftZeile("geklaerterStand");
  const imFence = fenceLauf();
  const zeilen = [];
  for (const zeile of normalisiereZeilenenden(body ?? "").split("\n")) {
    if (!imFence(zeile) && kopf.test(zeile)) break;
    zeilen.push(zeile);
  }
  return zeilen.join("\n").trimEnd();
}

/**
 * Prueft einen neuen Idee-Body gegen den alten nach E5: `{ ok, verstoesse: [{ regel, meldung
 * }] }`. Regeln: `ideentext` (der Text oberhalb von `## Geklärter Stand` hat sich geaendert)
 * und `antwort` (ein bestaetigter Punkt hat seine Antwortzeile verloren oder traegt eine
 * andere). Ein bestaetigter Punkt findet sich im neuen Body ueber seinen Text, sonst ueber
 * seine Nummer. Angehaengte Punkte und neue Antwortzeilen sind erlaubt.
 */
export function triageKoerperPruefen(alt, neu) {
  const verstoesse = [];
  if (ideentext(alt) !== ideentext(neu)) {
    const ueberschrift = `## ${ueberschriftName("geklaerterStand", prozessSprache())}`;
    verstoesse.push({ regel: "ideentext", meldung: t("ideentext", { ueberschrift }) });
  }
  const nachher = fragenLesen(neu ?? "", "geklaerterStand").fragen;
  for (const punkt of fragenLesen(alt ?? "", "geklaerterStand").fragen.filter((p) => p.entschieden)) {
    const gegenstueck = nachher.find((p) => p.text === punkt.text) ?? nachher.find((p) => p.nr === punkt.nr);
    if (gegenstueck?.antwortZeile === punkt.antwortZeile) continue;
    verstoesse.push({ regel: "antwort", meldung: t("antwortVerloren", { punkt: punkt.text.split("\n")[0], antwort: punkt.antwortZeile }) });
  }
  return { ok: verstoesse.length === 0, verstoesse };
}
