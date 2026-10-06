/**
 * night/tag.mjs — der Prueflauf am Tag (Issue #1234, Plan #1199, E17; Fachplan #899, Plan
 * #904, Issue #909): Auswahl und Ausschluss der Karten, die gepruefte Fassung, die eine
 * Session je Karte, ihr Ergebnis am Unterschied der Board-Spuren, der Vermerk eines Abbruchs,
 * der Laufstand je Karte, die Ergebnisliste und der Lauf selbst.
 *
 * Ein Teil von kit/night.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nur aus Teilen unter kit/night/ und kit/board/, nie aus dem Einstieg:
 * Der Einstieg laedt die Teile, ein Rueckimport waere ein Zyklus.
 *
 * Mitgezogen, weil der Prueflauf ihr Hauptaufrufer ist: die Bausteine, die bis Issue #1232
 * im Abschnitt der Kette standen (Ausschluss, Auswahl, Fassung, Laufstand, Ergebnis und
 * Rest-Vermerk), und die Budgets des Prueflaufs samt ihrem Text fuer die Protokollzeile.
 * Die Zeile selbst (`budgetDefaultsZeile`), das Beanspruchen und die belegte Wurzel nimmt
 * der Prueflauf aus dem Teil der Kette.
 *
 * Den Abschluss des Laufs (`laufAbschliessen`) und den Reviewer-Vorflug (`fuehreVorflug`)
 * ruft der Prueflauf, ohne sie zu importieren: Beide stehen im Einstieg, und ein Import waere
 * ein Zyklus. Der Einstieg bindet sie ueber `tagAnbinden` an (Plan #1199, E16).
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { ZUSTAND, NACHBAR_DIR, log, board, boardRoh, einheitAnlegen, einheitErgaenzen, ersteZeile,
  schrittBeginnen, schrittEnden, vermerkeOhneArbeit } from "./grundlagen.mjs";
import { standSetzen } from "./laufstand.mjs";
import { befundeZurueckUndVorschlagen, kitStandInBaum, worktreeAnlegen, worktreeEntfernen,
  worktreesAufraeumen } from "./kitstand.mjs";
import { leseKarte } from "./abhaengigkeiten.mjs";
import { LOKALER_KOMMENTARKOPF, PRUEFLAUF_BUDGET_DEFAULTS, SESSION_ABHAENGIGKEITEN, kostenAddieren,
  ladePruefLaufBudget, leseErgebnisText, leseKennzahlen, neueKommentare, pruefLaufBudgetDefaults,
  runSession } from "./session.mjs";
import { hatFachplanReviewMarker } from "./bericht.mjs";
import { GRUND_WARTEND, KLAEREN_LABEL, WARTEND_ANKER, hatKlaerenLabel, wartendeSession } from "./wartend.mjs";
import { KETTE_ZUSATZ, REVIEW_FERTIG_LABEL, beanspruchtGrund, belegteWurzeln, budgetDefaultsZeile,
  hatReviewFertigLabel, trackerImWorktreeUmleiten, vorabStandSetzen, wartendVermerken } from "./kette.mjs";

// Die Praefixe kommen aus dem Board-Teil dokumente (Issue #1218). Abgefangen wie im Einstieg:
// Fehlt der Teil, wirft jede Funktion erst, wenn jemand sie braucht — ein stilles `false`
// liesse ein Plandokument in den Prueflauf. Der Pfad ist nicht literal, deshalb nennt die
// Gruppe dieses Teils den Bereich board-dokumente von Hand (E3).
const praefixFehlt = (was) => () => {
  throw new Error(`board/dokumente.mjs fehlt neben night.mjs (${join(NACHBAR_DIR, "board")}) — das Praefix ${was} ist nicht erkennbar.`);
};
const {
  istFachlich: isFachlich,
  istPlan: isPlan,
} = await import(pathToFileURL(join(NACHBAR_DIR, "board", "dokumente.mjs")).href).catch(() => ({
  istFachlich: praefixFehlt("[Fachlich]"),
  istPlan: praefixFehlt("[Plan]"),
}));

// --- Anbindung an den Einstieg (Plan #1199, E16) ---

// Abschluss des Laufs und Reviewer-Vorflug stehen im Einstieg; ein Teil, der allein geladen
// ist, hat keinen.
const anbindung = {
  laufAbschliessen: () => {
    throw new Error("laufAbschliessen ist nicht angebunden — der Einstieg kit/night.mjs setzt es beim Laden.");
  },
  fuehreVorflug: () => {
    throw new Error("fuehreVorflug ist nicht angebunden — der Einstieg kit/night.mjs setzt es beim Laden.");
  },
};

/** Setzt die Haken aus `anbindung`; nicht genannte behalten ihren Wert. */
export function tagAnbinden(haken) {
  for (const [name, fn] of Object.entries(haken)) {
    if (!Object.hasOwn(anbindung, name)) throw new Error(`tagAnbinden kennt keinen Haken '${name}'`);
    anbindung[name] = fn;
  }
}

// --- Die Abhaengigkeiten des Prueflaufs (Issue #1234, Plan #1199, E6) ---

/**
 * Was der Prueflauf von aussen braucht, jeweils mit der echten Implementierung als Vorgabe:
 * `spawn` startet die Session einer Karte und `spawnSync` fragt danach ihre Prozessgruppe ab
 * (beide gehen an `runSession`), `jetzt` ist die Uhr, `board` und `boardRoh` die Aufrufe des
 * Board-Werkzeugs, `beenden` das Ende des Prozesses.
 *
 * `laufePrueflauf` nimmt sie als Parameter, nach dem Muster von `laufeKette`: Ein Test im
 * selben Prozess setzt Attrappen ein, der Runner ruft ohne. Die Teile, die der Prueflauf ruft
 * (Laufstand, Worktree, Karte, Beanspruchen), haben ihre eigenen.
 */
export const TAG_ABHAENGIGKEITEN = Object.freeze({
  spawn: SESSION_ABHAENGIGKEITEN.spawn,
  spawnSync: SESSION_ABHAENGIGKEITEN.spawnSync,
  jetzt: () => new Date(),
  board,
  boardRoh,
  beenden: (code) => process.exit(code),
});

// Die Abhaengigkeiten des laufenden Laufs; `laufePrueflauf` setzt sie fuer seine Dauer.
// Ausserhalb eines Laufs gelten die Vorgaben.
const abh = { ...TAG_ABHAENGIGKEITEN };

// --- Die Budgets des Prueflaufs (Issue #909) ---

// Geladen in vorbereiten() des Einstiegs ueber pruefLaufBudgetSetzen() — getrennt von denen der
// Kette, weil die beiden Laeufe nebeneinander stehen koennen und jeder seine eigenen Zahlen
// traegt.
let PRUEFLAUF_BUDGET = null;
let PRUEFLAUF_BUDGET_AUS_DEFAULT = [];

/**
 * Laedt die Budgets des Prueflaufs aus der Config. Eine kaputte Zahl wirft; der Einstieg
 * macht daraus den Config-Fehler, mit dem der Lauf gar nicht erst beginnt.
 */
export function pruefLaufBudgetSetzen(config) {
  PRUEFLAUF_BUDGET = ladePruefLaufBudget(config);
  PRUEFLAUF_BUDGET_AUS_DEFAULT = pruefLaufBudgetDefaults(config);
}

/** Die geladenen Budgets des Prueflaufs und die Felder daraus, die aus den Defaults stammen. */
export function pruefLaufBudgetStand() {
  return { budget: PRUEFLAUF_BUDGET, ausDefault: PRUEFLAUF_BUDGET_AUS_DEFAULT };
}

// Was die Protokollzeile des Prueflaufs ueber ihren Config-Block sagen muss. Die Zeile selbst,
// budgetDefaultsZeile(), steht mit ihrem Hauptaufrufer im Teil kit/night/kette.mjs.
const PRUEFLAUF_BUDGET_TEXT = { name: "des Prueflaufs", block: "pruefLauf", defaults: PRUEFLAUF_BUDGET_DEFAULTS };

// --- Auswahl, Fassung, Ergebnis und Vermerk einer Pruefung ---

/**
 * Der Hinweis auf das Nicht-Ziel der fachlichen Anforderung #899: Der Prueflauf gilt
 * allein fachlichen Anforderungen. Er steht an jeder gekennzeichneten Karte, die keine
 * ist — am Plandokument wie am Arbeitspaket.
 */
const PRUEFLAUF_NICHT_FACHLICH = "der Prueflauf gilt allein fachlichen Anforderungen (Nicht-Ziel 'Plandokumente und Arbeitspakete')";

/**
 * Der Grund, aus dem eine gekennzeichnete Karte nicht geprueft wird — `null`, wenn sie
 * geprueft wird (Fachplan #899, Plan #904, Issue #906).
 *
 * Bewusst OHNE Spaltenbedingung, anders als `kettenAusschluss`: Ein
 * `[Fachlich]`-Dokument geht nie nach Ready, und die Geste des Menschen gilt der Karte,
 * nicht ihrem Ort. Die Reihenfolge folgt derselben Regel wie dort — der spezifischere
 * Grund gewinnt: erst das fehlende Kennzeichen (ohne die Geste steht die Karte hier gar
 * nicht zur Debatte), dann die Art der Karte (E6: ein Plandokument gehoert nie hierher,
 * auch nicht nach einer Antwort), zuletzt `kit:klaeren` — wer die wartende Frage
 * beantwortet, kommt weiter.
 */
export function pruefLaufAusschluss(issue, label) {
  if (!(issue?.labels || []).includes(label)) return `traegt das Kennzeichen ${label} nicht`;
  const titel = issue?.title ?? "";
  if (!isFachlich(titel)) {
    const art = isPlan(titel) ? "traegt [Plan]" : "traegt kein [Fachlich]";
    return `${art} — ${PRUEFLAUF_NICHT_FACHLICH}`;
  }
  if (hatKlaerenLabel(issue)) return `traegt ${KLAEREN_LABEL} — eine Entscheidung wartet auf einen Menschen, eine zweite Pruefung beantwortet sie nicht`;
  return null;
}

/**
 * Waehlt die Karten eines Prueflaufs aus allen Karten (Plan #904, E6, E9).
 *
 * Reine Funktion ueber `issue list` OHNE Status-Filter, nach dem Muster von
 * `waehleKettenKandidaten`: Was das Kennzeichen traegt, aber nicht geprueft wird, geht mit
 * Grund nach `uebersprungen` und behaelt sein Kennzeichen — abgenommen wird es erst im
 * Lauf, unmittelbar vor der Session. Kandidaten sind rohe Issues; eine Auftragsart wie bei
 * der Kette gibt es nicht, es laeuft nur eine.
 *
 * `max` darf `null` sein (E9: kein Zahlendeckel, begrenzt wird ueber die Budgets); dann
 * werden alle Kandidaten geliefert. Ab `max` bleiben sie liegen — das ist kein Ausschluss
 * und steht darum in `liegengeblieben`, nicht in `uebersprungen`.
 *
 * Nach den eigenen Gruenden steht die belegte Wurzel wie bei der Kette (Plan #1113, E8;
 * Issue #1189): Eine gekennzeichnete fachliche Anforderung ist ihre eigene Wurzel, und
 * `belegt(F)` liefert ihren lebenden Halter `{ karte, laufId }` oder `null`. Auch sie
 * verbraucht keinen Platz.
 */
export function waehlePruefLaufKandidaten(issues, label, max, { belegt = () => null } = {}) {
  const alle = (issues || []).filter((i) => (i?.labels || []).includes(label));
  const kandidaten = [];
  const uebersprungen = [];
  const liegengeblieben = [];
  const deckel = Number.isFinite(max) ? max : Infinity;
  for (const issue of alle) {
    const ausschluss = pruefLaufAusschluss(issue, label);
    const halter = ausschluss === null ? belegt(String(issue.id)) : null;
    const grund = halter ? beanspruchtGrund(halter.laufId) : ausschluss;
    if (grund !== null) uebersprungen.push({ id: String(issue.id), title: issue.title ?? "", grund });
    else if (kandidaten.length >= deckel) liegengeblieben.push({ id: String(issue.id), title: issue.title ?? "" });
    else kandidaten.push(issue);
  }
  return { kandidaten, uebersprungen, liegengeblieben };
}

/**
 * Der Fingerabdruck der geprueften Fassung eines Kartentexts (Plan #904, E7).
 *
 * Der Lauf bildet ihn unmittelbar vor der Session und nennt ihn in Liste, Protokoll und
 * Ergebnisstand. Damit steht hinterher fest, WAS geprueft wurde: Wer den Text waehrend der
 * Pruefung aendert, sieht am Fingerabdruck, dass die Pruefung eine andere Fassung gelesen
 * hat. Eine Erkennung der Aenderung selbst gibt es nicht — ein Aenderungsverlauf ist nur bei
 * zwei von vier Trackern zu haben und seine Feldform nirgends festgelegt.
 *
 * Zwoelf Hexstellen, nicht die ganzen vierundsechzig: Verglichen wird er von Menschen, und
 * innerhalb eines Laufs unterscheidet dieser Anfang jede Fassung.
 *
 * Der Laufstand gehoert nicht zur Fassung (Issue #1189): Der lokale Tracker haengt ihn an den
 * Body, und der Lauf schreibt ihn selbst zwischen Kandidatenliste und Session. Ohne den
 * Abzug nennte die Liste eine andere Fassung als die Einheit, obwohl niemand den Text
 * geaendert hat.
 */
export function pruefLaufFassung(body) {
  const ohneLaufstand = String(body ?? "")
    .split(new RegExp(`(?=${LOKALER_KOMMENTARKOPF.source})`))
    .filter((teil) => !new RegExp(`^${LOKALER_KOMMENTARKOPF.source}## Laufstand`).test(teil))
    .join("");
  return createHash("sha256").update(ohneLaufstand).digest("hex").slice(0, 12);
}

// Der Laufstand einer geprueften Karte je Ausgang (E8); alles Uebrige ist `abgebrochen`.
const PRUEFLAUF_STAND = { geprueft: "fertig", klaeren: "wartet" };

/**
 * Der Laufstand am Ende einer Karte des Prueflaufs (Plan #1113, E8; Issue #1189): `fertig`
 * bei geprueft, `wartet` bei klaeren mit der Frage, `abgebrochen` mit Grund bei
 * unvollstaendig und bei einer Karte, die der Lauf nach der Auswahl nicht mehr prueft —
 * etwa am Kostendeckel. Rueckgabe `{ zustand, text }` fuer `standSetzen`.
 */
export function pruefLaufStand({ ausgang, frage, schritt, grund }) {
  const zustand = PRUEFLAUF_STAND[ausgang] ?? "abgebrochen";
  const kopf = `Pruefung beendet: ${ausgang} um ${abh.jetzt().toISOString()}`;
  if (ausgang === "klaeren") return { zustand, text: `${kopf}\n\nWartende Entscheidung: ${ersteZeile(frage ?? "")}` };
  if (zustand === "fertig") return { zustand, text: kopf };
  const erreicht = schritt ? `, erreichter Schritt: ${schritt}` : "";
  return { zustand, text: `${kopf}${erreicht}\n\n${grund ?? "ohne Grund"}` };
}

/** Die ersten Zeilen der beiden Kommentare, die eine Pruefung an der Karte hinterlaesst. */
export const PRUEFLAUF_BEFUNDE_ANKER = "## Fachplan-Review, Runde 1";
export const PRUEFLAUF_EINARBEITUNG_ANKER = "## Einarbeitung, Runde 1";

/** Der zuletzt erreichte Schritt einer abgebrochenen Pruefung (E13) aus ihren neuen Spuren. */
function pruefLaufSchritt(neue) {
  if (neue.some((k) => k.includes(PRUEFLAUF_EINARBEITUNG_ANKER))) return "eingearbeitet";
  if (neue.some((k) => k.includes(PRUEFLAUF_BEFUNDE_ANKER))) return "befunde";
  return "gestartet";
}

/**
 * Das Ergebnis einer Prueflauf-Session am Unterschied der Board-Spuren (Plan #904, E16).
 *
 * Reine Funktion: Gelesen wird der UNTERSCHIED zwischen Vorher- und Nachher-Stand, nie der
 * Nachher-Stand allein. Eine erneut gepruefte Karte traegt Marker, `review:fertig` und den
 * Befunde-Kommentar schon aus dem Vorlauf; ohne die Beschraenkung auf neue Spuren meldete
 * die Erkennung "geprueft" fuer eine Pruefung, die nie lief.
 *
 * Marker und Label darf der Nachher-Stand trotzdem allein beantworten: Beides hat der Lauf
 * unmittelbar vor der Session selbst abgeraeumt (E16), es kann also nur aus ihr stammen.
 * Der Vorher-Stand dient allein dem Kommentar-Vergleich; seine Labels werden nicht gelesen.
 *
 * Drei Ausgaenge: `geprueft`, `klaeren` mit der wartenden Frage, sonst `unvollstaendig` mit
 * dem zuletzt erreichten Schritt.
 */
export function pruefLaufErgebnis(vorher, nachher) {
  if (hatFachplanReviewMarker(nachher?.body) && hatReviewFertigLabel(nachher)) {
    return { ausgang: "geprueft" };
  }
  const neue = neueKommentare(vorher, nachher);
  if (hatKlaerenLabel(nachher)) {
    const frage = neue.at(-1) ?? `siehe den letzten Kommentar an #${nachher?.id}`;
    return { ausgang: "klaeren", frage };
  }
  return { ausgang: "unvollstaendig", schritt: pruefLaufSchritt(neue) };
}

/**
 * Der Anker des Vermerks, den ein Abbruch des Prueflaufs an der fachlichen Anforderung
 * hinterlaesst (Plan #904, E14).
 *
 * Ein EIGENER Anker, nicht der `REVIEW_REST_ANKER` der Nacht-Kette: Der spricht von Kette,
 * Plan und Plan-Review-Marker und gehoert der Kette.
 */
export const PRUEFLAUF_REST_ANKER = "## Pruefung unvollstaendig";

/**
 * Der Vermerk an der Karte, wenn die Pruefung abbricht, nachdem sie Spuren hinterlassen hat
 * (Plan #904) — `true`, wenn er geschrieben wurde.
 *
 * Dieselbe Luecke wie bei `reviewRestVermerken`: Die Pruefung ist bezahlt, ihre Befunde
 * stehen am Board, der Body traegt keinen Marker. Wer die Karte spaeter sichtet, sieht eine
 * ungepruefte und prueft erneut.
 *
 * `spuren` sind die neuen Kommentare der Session. Eine WARTENDE Sitzung bekommt nur ihren
 * `wartendVermerk`, nicht zusaetzlich diesen Anker — ihr eigener Kommentar ist kurz zuvor an
 * die Karte gegangen (Issue #778), und zwei Kommentare fuer einen Abbruch sagen nichts, was
 * einer nicht sagt. Bleibt danach keine Spur, gibt es nichts zu vermerken.
 */
export function pruefLaufRestVermerken(id, grund, schritt, spuren = []) {
  const fremde = (spuren || []).filter((k) => !String(k).includes(WARTEND_ANKER));
  if (fremde.length === 0) return false;
  const pfad = join(tmpdir(), `night-prueflauf-rest-${process.pid}-${id}-${ZUSTAND.LAUF_STEMPEL ?? abh.jetzt().getTime()}.md`);
  const text = [
    PRUEFLAUF_REST_ANKER,
    "",
    `Prueflauf ${ZUSTAND.LAUF_STEMPEL ?? "ohne Stempel"}: Die Pruefung ist gelaufen, ihre Befunde stehen als Kommentar an dieser Karte.`,
    "",
    `Sie ist unvollstaendig geblieben — der Lauf endete davor (${grund}) —, zuletzt erreichter Schritt: ${schritt}. Der Body traegt deshalb keinen Fachplan-Review-Marker, obwohl geprueft wurde.`,
    "",
    `Weg nach vorn: /issue-review #${id} von Hand fahren.`,
    "",
  ].join("\n");
  writeFileSync(pfad, text, "utf-8");
  try {
    abh.board("issue", "comment", String(id), "--text-file", pfad);
    log(`  Pruefung #${id} abgebrochen (${schritt}) — Vermerk '${PRUEFLAUF_REST_ANKER}' an #${id} geschrieben.`);
  } finally {
    rmSync(pfad, { force: true });
  }
  return true;
}

// --- Der Prueflauf am Tag (Fachplan #899, Plan #904; Issue #909) ---
//
// Ein Lauf, der mehrere gekennzeichnete fachliche Anforderungen nacheinander pruefen laesst:
// je Karte eine Session `/issue-review #N`, alle in EINEM Worktree je Lauf. Er bewegt keine
// Karte, zieht nichts nach Ready, setzt kein `kit:night` und nimmt kein `kit:klaeren` ab. Er
// laeuft am Tag, neben dem arbeitenden Menschen und neben einer Nacht-Kette — deshalb faellt
// er weder auf einen unsauberen Arbeitsbaum noch auf ein Paket in In progress herein.
//
// Der dritte Modus des vorhandenen Runners und keine eigene Kit-Datei (Plan #904, E1):
// Sessionstart, Worktree, Ergebnisstand, Protokoll und die Kosten- und Wartend-Erkennung
// teilt er mit den uebrigen Teilen; seit Issue #1234 steht er im eigenen Teil.

/** Der Worktree-Praefix des Prueflaufs — getrennt von dem der Kette (Issue #908). */
const PRUEFLAUF_PRAEFIX = "pruefung";

/** Die Stufe, unter der die Sessions des Prueflaufs laufen (NIGHT_KETTE_STUFE). */
const PRUEFLAUF_STUFE = "pruefung";

/**
 * Der Vorflug ist vor der ersten Pruefung gescheitert: jeder Kandidat bekommt den Kommentar
 * `Pruefung nicht gestartet` mit Grund, das Kennzeichen bleibt — die Geste ist nicht
 * verbraucht, denn es lief nichts. Ohne `fail`, weil der Aufrufer gleich selbst hart stoppt.
 *
 * Zwilling von `ketteNichtGestartet` und bewusst nicht mit ihm geteilt: Der erste Satz nennt
 * den Lauf, und ein Kommentar, der am Tag von einer Kette spraeche, schickte den Leser in die
 * falsche Ecke.
 */
function pruefungNichtGestartet(kandidaten, grund) {
  for (const k of kandidaten) {
    const res = abh.boardRoh("issue", "comment", String(k.id), "--text", `Pruefung nicht gestartet: ${grund}`);
    log(res.status === 0
      ? `  #${k.id}: Kommentar 'Pruefung nicht gestartet' geschrieben, Kennzeichen bleibt.`
      : `  #${k.id}: Kommentar 'Pruefung nicht gestartet' nicht geschrieben (${res.text.slice(0, 120)}).`);
  }
}

/**
 * Die eine Session einer Pruefung, mit Zeitbudget (Plan #904).
 *
 * Nach dem Muster von `ketteSession`, aber ohne Stufen: Es gibt genau eine Session je Karte,
 * ihr Zeitbudget ist `pruefungMin`, und Korrekturrunden kennt der Lauf nicht. Die Kosten
 * gehen auf den LAUF, nicht auf die Karte — der Deckel gilt dem Lauf.
 *
 * Rueckgabe: `{ dauerMs, kennzahlen, kosten }`, bei einem Abbruch dazu `abbruch` mit dem
 * Grund. Ob daraus `unvollstaendig` wird, entscheidet allein der Unterschied der Board-Spuren
 * (`pruefLaufErgebnis`): Eine Session kann am Zeitlimit sterben, nachdem sie fertig war.
 */
async function pruefLaufSession(lauf, id) {
  const budgetMs = lauf.budget.pruefungMin * 60 * 1000;
  const t = abh.jetzt().getTime();
  const res = await runSession(id, lauf.args, {
    prompt: `/issue-review #${id}\n\n${KETTE_ZUSATZ}`,
    cwd: lauf.wt, stream: true, stufe: PRUEFLAUF_STUFE, timeoutMs: budgetMs,
  }, { spawn: abh.spawn, spawnSync: abh.spawnSync });
  const dauerMs = abh.jetzt().getTime() - t;
  const kennzahlen = leseKennzahlen(res.stdout);
  // Dreimal dieselbe Kennzahl, drei verschiedene Empfaenger: die Karte (ihre Einheit), der
  // Lauf (sein Deckel) und der Lauf-Kopf (sein Verbrauch).
  const messung = { dauerMs, kennzahlen, kosten: kostenAddieren({}, kennzahlen) };
  kostenAddieren(lauf.kosten, kennzahlen);
  if (ZUSTAND.LAUF) kostenAddieren(ZUSTAND.LAUF, kennzahlen);

  const minuten = (dauerMs / 60000).toFixed(1);
  if (res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM") {
    return { ...messung, abbruch: `Zeitbudget: die Session wurde nach ${minuten} min am Limit beendet` };
  }
  if (res.error || res.status !== 0) {
    const exitInfo = res.error ? `${res.error.code || res.error.message}` : `Exit ${res.status ?? res.signal}`;
    return { ...messung, abbruch: `technischer Fehler: die Session endete mit ${exitInfo}` };
  }
  // Die wartende Sitzung (Plan #773) hinter Zeitbudget und technischem Fehler, weil sie ein
  // REGULAERES Ende verfeinert: Die Session hat eine lange Arbeit angestossen, darauf
  // gewartet und damit ihren Zug beendet.
  const schlusstext = leseErgebnisText(res.stdout);
  if (wartendeSession(schlusstext)) return { ...messung, abbruch: GRUND_WARTEND, wartend: true, schlusstext };
  return messung;
}

/**
 * Eine Karte pruefen lassen: Fassung, Kennzeichen, Session, Ergebnis, Vermerk, Einheit.
 *
 * Rueckgabe ist die Zeile der Ergebnisliste als Objekt — der Lauf sammelt sie und schreibt
 * sie am Ende aus.
 */
async function pruefeEineKarte(lauf, issue, nummer) {
  const id = String(issue.id);
  const titel = issue.title ?? "";
  const einheit = einheitAnlegen(id, titel);
  // Der Vorher-Stand kommt frisch vom Board und nicht aus der Kandidatenliste: Zwischen der
  // Auswahl und dieser Zeile liegen der Vorflug und alle vorigen Pruefungen des Laufs.
  const vorher = leseKarte(id);
  if (!vorher) {
    const grund = "die Karte ist nicht lesbar — es lief keine Session, das Kennzeichen bleibt";
    log(`Pruefung ${nummer}/${lauf.gesamt}: Issue #${id} uebersprungen (${grund}).`);
    pruefLaufStandSetzen(id, { ausgang: "uebersprungen", grund });
    einheitErgaenzen(einheit, { ausgang: "uebersprungen", grund });
    return { id, titel, ausgang: "uebersprungen", grund };
  }

  // Die gepruefte Fassung (E7): gebildet unmittelbar vor der Session. Wer den Text waehrend
  // der Pruefung aendert, sieht hinterher am Fingerabdruck, dass eine andere Fassung gelesen
  // wurde — erkennen kann der Lauf die Aenderung nicht.
  const fassung = pruefLaufFassung(vorher.body);
  log(`Pruefung ${nummer}/${lauf.gesamt}: Issue #${id} — ${titel} (Fassung ${fassung})`);
  // Das Kennzeichen ist mit dem Start verbraucht (E2): Ein Abbruch fuehrt zu einem Vermerk
  // mit Grund und einer neuen Geste, nicht zur stillen Wiederholung.
  abh.board("issue", "label", "remove", id, lauf.budget.label);
  log(`  Label '${lauf.budget.label}' entfernt — jedes Setzen autorisiert genau eine Pruefung.`);
  // Und `review:fertig` gleich mit (E16): Nur so beantwortet der Nachher-Stand die Frage nach
  // DIESER Session und nicht die nach einem Vorlauf. `kit:klaeren` nimmt der Lauf nie ab —
  // das darf allein ein Mensch.
  if (hatReviewFertigLabel(vorher)) {
    abh.board("issue", "label", "remove", id, REVIEW_FERTIG_LABEL);
    log(`  Label '${REVIEW_FERTIG_LABEL}' aus einem Vorlauf entfernt — nur diese Session darf es neu setzen.`);
  }

  // Die Session hat ihr eigenes Protokoll (Issue #1090, E16): Laeuft daneben eine Kette,
  // stehen ihre Zeilen sonst verschraenkt im selben Tagesprotokoll (Belegfall 5).
  const vorherLog = schrittBeginnen(id, PRUEFLAUF_STUFE);
  let s;
  try {
    s = await pruefLaufSession(lauf, id);
  } finally {
    schrittEnden(vorherLog);
  }
  const nachher = leseKarte(id) ?? vorher;
  const ergebnis = pruefLaufErgebnis(vorher, nachher);

  if (s.wartend) {
    // Eine wartende Sitzung bekommt NUR diesen Vermerk und keinen zweiten: Zwei Kommentare
    // fuer einen Abbruch sagen nichts, was einer nicht sagt.
    wartendVermerken(id, PRUEFLAUF_STUFE, s.schlusstext);
  } else if (ergebnis.ausgang === "unvollstaendig") {
    pruefLaufRestVermerken(id, s.abbruch ?? PRUEFLAUF_OHNE_MARKER, ergebnis.schritt, neueKommentare(vorher, nachher));
  }
  pruefLaufStandSetzen(id, { ...ergebnis, grund: s.abbruch ?? PRUEFLAUF_OHNE_MARKER });

  einheitErgaenzen(einheit, {
    ausgang: ergebnis.ausgang,
    fassung,
    ...(ergebnis.schritt ? { schritt: ergebnis.schritt } : {}),
    ...(ergebnis.frage ? { frage: ergebnis.frage } : {}),
    ...(s.abbruch ? { grund: s.abbruch } : {}),
    // Derselbe Feldname wie an der Einheit einer Implementierungsrunde (Issue #776) und aus
    // demselben Grund WEG statt `false`, wenn der Fall nicht eintrat.
    ...(s.wartend ? { wartendBeendet: true } : {}),
    dauerMs: s.dauerMs,
    kennzahlen: s.kennzahlen,
    kostenUsd: s.kosten.kostenSumme,
    kostenUnbekannt: s.kosten.kostenUnbekannt,
  });
  const zusatz = s.abbruch ? ` — ${s.abbruch}` : "";
  log(`  Pruefung #${id}: ${ergebnis.ausgang}${zusatz} (${s.kosten.kostenSumme.toFixed(2)} $).`);
  return { id, titel, fassung, ...ergebnis, ...(s.abbruch ? { grund: s.abbruch } : {}) };
}

/** Der Grund einer unvollstaendigen Pruefung, deren Session ohne Abbruch endete. */
const PRUEFLAUF_OHNE_MARKER = "die Session endete, ohne den Fachplan-Review-Marker zu setzen";

/** Setzt den Laufstand einer Karte des Prueflaufs nach ihrem Ausgang (E8). */
function pruefLaufStandSetzen(id, ergebnis) {
  const { zustand, text } = pruefLaufStand(ergebnis);
  standSetzen(id, zustand, text);
}

/**
 * Eine Zeile der Ergebnisliste (Plan #904, E4).
 *
 * Die Liste steht auf der Konsole, weil der Lauf dem Tag gehoert: Wer ihn startet, sieht sein
 * Ergebnis. Je Ausgang steht genau das dabei, was den naechsten Schritt bestimmt — bei einer
 * wartenden Entscheidung die Frage, bei einem Abbruch der erreichte Schritt.
 */
function pruefLaufZeile(e) {
  const fassung = e.fassung ? `, Fassung ${e.fassung}` : "";
  switch (e.ausgang) {
    case "geprueft":
      return `  #${e.id} ${e.titel}: geprueft${fassung}`;
    case "klaeren":
      return `  #${e.id} ${e.titel}: wartende Entscheidung${fassung}, Frage: ${ersteZeile(e.frage)}`;
    case "unvollstaendig":
      return `  #${e.id} ${e.titel}: unvollstaendig${fassung}, erreichter Schritt: ${e.schritt}`;
    default:
      return `  #${e.id} ${e.titel}: ${e.ausgang} — ${e.grund}`;
  }
}

/**
 * Eine Karte, die dieser Lauf nicht (mehr) prueft: Protokollzeile, Einheit, Listenzeile.
 *
 * Drei Anlaesse, ein Weg — der Ausschluss bei der Auswahl, der Zahlendeckel und der
 * erschoepfte Kostendeckel. Sie unterscheiden sich allein im Ausgang und im Grund, und drei
 * Stellen, die dasselbe verbuchen, liefen bei der ersten Aenderung auseinander.
 */
function pruefLaufOhneSession(ergebnisse, id, titel, ausgang, grund) {
  log(`  #${id} ${titel} -> ${ausgang} (${grund})`);
  einheitErgaenzen(einheitAnlegen(id, titel), { ausgang, grund });
  ergebnisse.push({ id: String(id), titel, ausgang, grund });
}

/**
 * Verbucht die Auswahl des Prueflaufs und nennt die Kandidaten (Plan #904, E7, E10).
 *
 * Alles vor der ersten Session an einer Stelle: die Karten, die nicht laufen, die Warnung bei
 * einem Label, das nirgends vorkommt, und die Kandidatenliste samt Fassung. Eine Vorschau
 * bekommt der Lauf nicht, also ist diese Liste die einzige Stelle, an der VORHER steht, was
 * laufen wird.
 */
function pruefLaufAuswahlMelden(args, budget, alle, auswahl, ergebnisse) {
  const { kandidaten, uebersprungen, liegengeblieben } = auswahl;
  for (const u of uebersprungen) {
    pruefLaufOhneSession(ergebnisse, u.id, u.title, "uebersprungen", u.grund);
  }
  for (const l of liegengeblieben) {
    pruefLaufOhneSession(ergebnisse, l.id, l.title, "liegengeblieben", `ueber --max ${args.max}, bleibt liegen`);
  }
  if (kandidaten.length === 0 && uebersprungen.length === 0 && liegengeblieben.length === 0) {
    const vorhanden = [...new Set(alle.flatMap((i) => i.labels || []))];
    log(`WARNUNG: keine Karte traegt das Label '${budget.label}' — es wird nichts geprueft.`);
    log(`  Vorhandene Labels: ${vorhanden.length ? vorhanden.join(", ") : "keine"}`);
  }
  kandidaten.forEach((k, i) => {
    log(`  #${k.id} ${k.title} -> Pruefung ${i + 1}/${kandidaten.length} (Fassung ${pruefLaufFassung(k.body)})`);
  });
}

/**
 * Die Pruefungen eines Laufs, eine nach der anderen, in EINEM Worktree (Plan #904, E11).
 *
 * Der Worktree wird in jedem Fall entfernt — auch nach einem Wurf mitten in einer Pruefung;
 * einen liegengebliebenen raeumt der naechste Start ab.
 */
async function pruefLaufRunden(lauf, kandidaten, ergebnisse) {
  try {
    // Die Sessions lesen und schreiben am Board, nicht im Arbeitsbaum — ein Worktree je Karte
    // kostete Zeit fuer eine Trennung ohne Gegenstand.
    lauf.wt = worktreeAnlegen({ repoRoot: lauf.repoRoot, stempel: ZUSTAND.LAUF_STEMPEL ?? String(abh.jetzt().getTime()), praefix: PRUEFLAUF_PRAEFIX });
    // Nach dem Spiegel: Der Stand ueberschreibt die gespiegelte Kopie der Hauptkopie (Issue #1102, A3).
    kitStandInBaum(lauf.wt);
    trackerImWorktreeUmleiten(lauf.wt, lauf.repoRoot);
    log(`Worktree des Laufs: ${lauf.wt}`);

    let nummer = 0;
    for (const issue of kandidaten) {
      nummer++;
      // Ein Abbruch beendet nur diese Karte (E3): Die naechste kommt dran, und der Grund steht
      // an ihrer Einheit und in der Liste.
      ergebnisse.push(await pruefeEineKarte(lauf, issue, nummer));
      // Der Kostendeckel gilt dem LAUF und wird NACH jeder Session geprueft, nie mittendrin:
      // Eine halb gelesene Pruefung waere der teurere Fehler.
      if (lauf.kosten.kostenSumme > lauf.budget.kostenUsd) {
        const grund = `Kostenbudget: ${lauf.kosten.kostenSumme.toFixed(2)} $ von ${lauf.budget.kostenUsd} $ nach Pruefung ${nummer}`;
        for (const rest of kandidaten.slice(nummer)) {
          pruefLaufOhneSession(ergebnisse, rest.id, rest.title ?? "", "uebersprungen", grund);
          pruefLaufStandSetzen(rest.id, { ausgang: "uebersprungen", grund });
        }
        return;
      }
    }
  } finally {
    // Erst die im Worktree gebuchten Befunde zurueck, dann der Abbau (Issue #1028) — auch
    // nach einem Wurf, sonst gingen sie mit dem Worktree verloren.
    if (lauf.wt) {
      befundeZurueckUndVorschlagen(lauf);
      worktreeEntfernen(lauf.wt, lauf.repoRoot);
    }
  }
}

/**
 * Programm Prueflauf (Plan #904): Kandidaten, Vorflug, ein Worktree, Karte fuer Karte.
 * Beendet den Prozess selbst ueber `beenden`, wie die Kette und der Dry-Run.
 *
 * `abhaengigkeiten` ersetzt fuer die Dauer des Laufs einzelne Eintraege aus
 * `TAG_ABHAENGIGKEITEN` (Issue #1234, E6); ein unbekannter Name ist ein Fehler.
 */
export async function laufePrueflauf(args, abhaengigkeiten = {}) {
  for (const name of Object.keys(abhaengigkeiten)) {
    if (!Object.hasOwn(TAG_ABHAENGIGKEITEN, name)) throw new Error(`laufePrueflauf kennt keine Abhaengigkeit '${name}'`);
  }
  const vorher = { ...abh };
  Object.assign(abh, abhaengigkeiten);
  try {
    return await pruefLaufFahren(args);
  } finally {
    Object.assign(abh, vorher);
  }
}

async function pruefLaufFahren(args) {
  const budget = PRUEFLAUF_BUDGET;
  const repoRoot = process.cwd();
  const defaultsZeile = budgetDefaultsZeile(budget, PRUEFLAUF_BUDGET_AUS_DEFAULT, PRUEFLAUF_BUDGET_TEXT);
  if (defaultsZeile) log(defaultsZeile);
  // Nur der eigene Praefix (Issue #908): Eine Nacht-Kette kann daneben laufen, und ihr
  // Worktree gehoert ihr.
  for (const p of worktreesAufraeumen(repoRoot, PRUEFLAUF_PRAEFIX)) log(`Liegengebliebenen Worktree entfernt: ${p}`);

  const alle = abh.board("issue", "list");
  const gewaehlt = waehlePruefLaufKandidaten(alle, budget.label, args.max, { belegt: belegteWurzeln(alle, budget.label) });
  // Direkt nach der Auswahl beanspruchen wie die Kette (Plan #1113, E8): Erst damit sieht
  // eine Kette oder ein zweiter Prueflauf, dass dieser Lauf die Wurzel haelt. Wer die
  // Bestaetigung verliert, weicht wie eine belegte Wurzel.
  const { beansprucht, abgegeben } = vorabStandSetzen(args, gewaehlt.kandidaten.map((karte) => ({ karte, F: String(karte.id) })));
  const kandidaten = beansprucht.map((a) => a.karte);
  const uebersprungen = [...gewaehlt.uebersprungen, ...abgegeben];
  const auswahl = { ...gewaehlt, kandidaten, uebersprungen };
  const ergebnisse = [];
  pruefLaufAuswahlMelden(args, budget, alle, auswahl, ergebnisse);

  // Der Reviewer-Vorflug wie bei der Kette: Die Pruefer-Session braucht die Reviewer in ihrer
  // eigenen Sandbox, und die Vorflug-Session ist die einzige Probe dafuer. Scheitert er,
  // behaelt jeder Kandidat sein Kennzeichen und bekommt einen Kommentar — es lief nichts.
  await anbindung.fuehreVorflug(args, kandidaten, "/issue-review --dry-run", (grund) => pruefungNichtGestartet(kandidaten, grund));

  if (kandidaten.length === 0) {
    if (uebersprungen.length > 0) {
      vermerkeOhneArbeit("pruefLaufAlleUebersprungen", { anzahl: uebersprungen.length, label: budget.label });
    } else {
      vermerkeOhneArbeit("pruefLaufKeinLabel", { label: budget.label });
    }
    anbindung.laufAbschliessen("regulaer");
    return abh.beenden(0);
  }

  const lauf = {
    args, budget, repoRoot, wt: null, gesamt: kandidaten.length,
    kosten: { kostenSumme: 0, kostenUnbekannt: 0 },
  };
  await pruefLaufRunden(lauf, kandidaten, ergebnisse);

  log("Ergebnisliste des Prueflaufs:");
  for (const e of ergebnisse) log(pruefLaufZeile(e));
  const zahl = (ausgang) => ergebnisse.filter((e) => e.ausgang === ausgang).length;
  log(`Prueflauf beendet: ${zahl("geprueft")} geprueft, ${zahl("klaeren")} mit wartender Entscheidung, `
    + `${zahl("unvollstaendig")} unvollstaendig, ${zahl("uebersprungen")} uebersprungen, ${zahl("liegengeblieben")} liegengeblieben.`);
  log(`Danach: Eine geprueft hinterlassene Karte erfuellt die Aufnahmevoraussetzung der Nacht-Kette — das GO bleibt deins. `
    + `Eine Karte mit '${KLAEREN_LABEL}' wartet auf deine Antwort; das Label nimmt nur ein Mensch ab. Protokoll: ${ZUSTAND.LOG_FILE}`);
  anbindung.laufAbschliessen("regulaer");
  return abh.beenden(0);
}
