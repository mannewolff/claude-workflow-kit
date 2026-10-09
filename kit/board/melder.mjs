/**
 * board/melder.mjs — Meldungen an `POST /api/kanban/night-runs` im Board-Werkzeug (Issue #1222,
 * Plan #1199, E17): die Einlieferung eines Nachtlaufs und der Sitzungs-Melder fuer den
 * interaktiven Verbrauch.
 *
 * Ein Teil von kit/board.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nie aus dem Einstieg: Der Einstieg laedt die Teile, ein Rueckimport waere
 * ein Zyklus. Darum bekommen `dispatchNightrun` und `dispatchSitzung` die Hilfe als Argument.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BoardError, fail, loadConfig, readWorkflowConfig } from "./grundlagen.mjs";
import { ToolboxIssueTracker, resolveToolboxToken, agentModelHeader } from "./adapter.mjs";
import { WEGMARKEN_SPALTEN, WEGMARKEN_DATEI } from "./dokumente.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// Nachtlauf einliefern (Issue #669)
// ============================================================
//
// Der Vertrag ist `POST /api/kanban/night-runs` in kanban-kit (NightRunIngestController,
// Plan #943): ein fertig gedeuteter Lauf mit Farbe je Arbeitspaket. Die Deutung folgt
// kanban-kit `frontend/src/lib/nightRunErgebnisstand.ts`, beschraenkt auf die beiden
// Lauf-Arten, die night.mjs heute schreibt. Anders als der Parser dort lehnt sie einen
// unbekannten Ausgang nicht ab: Der Runner kann nachts niemanden fragen, und ein roter
// UNEXPECTED_STATE ist ehrlicher als eine verlorene Nacht.

// Laengengrenzen des Vertrags (NightRunController, NightRunLimits).
const NACHTLAUF_TITEL_MAX = 300;
// Gilt fuer jeden Auszug des Vertrags: den `excerpt` eines Arbeitspakets und den
// `abortReason` des Laufs (Issue #881) — beide misst die Gegenstelle an EXCERPT_MAX.
const NACHTLAUF_AUSZUG_MAX = 4000;
const NACHTLAUF_COMMIT_MAX = 40;
const NACHTLAUF_EINHEITEN_MAX = 200;
// Die Gegenstelle kuerzt `noWorkReason` nicht selbst und weist es ab, wenn es laenger
// ist (Issue #744) — die Kuerzung passiert deshalb hier.
const NACHTLAUF_NOWORKREASON_MAX = 300;

const NACHTLAUF_MODUS = { implementierung: "IMPLEMENTATION", kette: "CHAIN" };

// Die Art des Laufs im Vertrag (mannewolff/kanban-kit#1012). Der Endpunkt faellt ohne das
// Feld auf NIGHT zurueck; ausgeschrieben steht es trotzdem hier, damit ein Nachtlauf nicht
// am Vorgabewert haengt, sobald derselbe Endpunkt auch andere Arten annimmt.
const NACHTLAUF_ART = "NIGHT";

// Farbe nach Pruefzustand, getrennt fuer erfolg und fehlschlag (NACH_ZUSTAND dort).
const NACHTLAUF_NACH_PRUEFUNG = {
  geprueft: { erfolg: ["GREEN", null] },
  // Der Runner hat den Nachweis selbst nachgefahren, weil der hinterlassene nicht zum
  // Commit des Pakets gehoerte (Issue #865) — gruen ist gruen, wie bei `geprueft`.
  nachgeprueft: { erfolg: ["GREEN", null] },
  leeresPaket: { erfolg: ["GREEN", null] },
  ungeprueft: { erfolg: ["YELLOW", "CHECKS_NOT_STARTED"], fehlschlag: ["RED", "CHECKS_NOT_STARTED"] },
  unlesbar: { erfolg: ["YELLOW", "CHECKS_NOT_STARTED"], fehlschlag: ["RED", "CHECKS_NOT_STARTED"] },
  rot: { erfolg: ["YELLOW", "CHECKS_RED"], fehlschlag: ["RED", "CHECKS_RED"] },
};

// Ausgaenge mit fester Farbe, in beiden Lauf-Arten.
const NACHTLAUF_FEST = {
  uebersprungen: ["GREY", null],
  liegengeblieben: ["GREY", null],
  unbekannt: ["RED", "HARD_ABORT"],
  harterStopp: ["RED", "HARD_ABORT"],
  // Eine Einheit, die der Waechter eines verstummten Laufs abgeschlossen hat (Issue #1085,
  // E18). `abgebrochen` steht bewusst NICHT hier: Die Kette fuehrt es als eigenen Ausgang
  // mit dem Zeitbudget als Unterscheidung (farbeAbgebrochen).
  verstummt: ["RED", "HARD_ABORT"],
  angehalten: ["RED", "AWAITING_DECISION"],
  // Der Vorgang lief durch und hat etwas Bestelltes nicht getan (Issue #862): die Kette,
  // deren Umsetzung an einer belegten Sperre ausblieb, und die Pruefung, deren Ergebnis
  // den Body nie erreichte. GELB, weil GRUEN das Fehlende verschwiege und ROT aus einem
  // vorgesehenen Ausgang eine Stoerung machte; ohne Fehlerklasse, weil keine der
  // vorhandenen ihn trifft — den Grund traegt der `excerpt` der Einheit.
  unvollstaendig: ["YELLOW", null],
  // Bruecke (Issue #1392, Plan #1386, E15): kanban-kit kennt den Ausgang noch nicht. Bis zur
  // eigenen Fehlerklasse meldet er als rote Pruefung statt als UNEXPECTED_STATE; Pruefung
  // und Fehler traegt der `excerpt` (nachtlaufAuszug).
  festgefahren: ["RED", "CHECKS_RED"],
  fertig: ["GREEN", null],
};

/** Die Farbe eines zurueckgestellten Pakets — erster Treffer gewinnt (ZURUECKGESTELLT dort). */
function farbeZurueckgestellt(grund) {
  if (grund.includes("Abhaengigkeit")) return ["GREY", "DEPENDENCY_UNMET"];
  if (grund.includes("kit:klaeren")) return ["RED", "AWAITING_DECISION"];
  if (grund.startsWith("Session ohne In-review-Ergebnis")) return ["RED", "UNEXPECTED_STATE"];
  return ["GREY", null];
}

/** Die Farbe eines abgebrochenen Ketten-Vorgangs (deuteKettenAusgang dort). */
function farbeAbgebrochen(einheit, grund) {
  if (!grund.startsWith("Zeitbudget ")) return ["RED", "HARD_ABORT"];
  const s = einheit.stufen;
  const dokument = typeof s?.plan?.id === "string" || (Array.isArray(s?.pakete?.ids) && s.pakete.ids.length > 0);
  return [dokument ? "YELLOW" : "RED", "TIME_BUDGET_EXCEEDED"];
}

function nachtlaufFarbe(einheit) {
  const grund = typeof einheit.grund === "string" ? einheit.grund : "";
  const ausgang = einheit.ausgang;
  if (NACHTLAUF_FEST[ausgang]) return NACHTLAUF_FEST[ausgang];
  if (ausgang === "zurueckgestellt") return farbeZurueckgestellt(grund);
  if (ausgang === "abgebrochen") return farbeAbgebrochen(einheit, grund);
  if (ausgang === "erfolg" || ausgang === "fehlschlag") {
    const zeile = NACHTLAUF_NACH_PRUEFUNG[einheit.pruefung?.zustand ?? "ungeprueft"];
    return zeile?.[ausgang] ?? ["RED", "UNEXPECTED_STATE"];
  }
  return ["RED", "UNEXPECTED_STATE"];
}

/** Der Auszug einer Einheit: ihr Grund, beim festgefahrenen Paket dazu Pruefung und Fehler. */
function nachtlaufAuszug(e) {
  const gefuellt = (text) => typeof text === "string" && text !== "";
  const grund = gefuellt(e.grund) ? e.grund : null;
  const f = e.ausgang === "festgefahren" ? e.festgefahren : null;
  const teile = [grund];
  if (f && gefuellt(f.pruefung)) teile.push(`Pruefung: ${f.pruefung}`);
  if (f && gefuellt(f.fehler)) teile.push(`Fehler: ${f.fehler}`);
  const text = teile.filter((t) => t !== null).join("\n");
  return text === "" ? null : text.slice(0, NACHTLAUF_AUSZUG_MAX);
}

/** Eine endliche Zahl oder `null` — die Waehrung aller gemeldeten Kennzahlen. */
function nachtlaufZahl(x) {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/**
 * Die Mengen im Vertragsformat, `null`, wenn nichts gemessen wurde. Eingabemenge ist alles
 * Verarbeitete — eigene Eingabe plus beide Zwischenspeicher-Mengen —, der Zwischenspeicher-
 * Anteil nur das daraus Gelesene. So ergibt das Beispiel aus Issue #669 die dort genannten
 * 97,8 Prozent.
 *
 * Seit Issue #808 kommen Modellzeit und Zuege aus den `kennzahlen` dazu — sie stehen nicht
 * im `verbrauch`, dessen Feldliste (VERBRAUCH_FELDER in night.mjs) unveraendert bleibt.
 */
function nachtlaufUsage(v, kennzahlen = null) {
  const zahl = nachtlaufZahl;
  const eingaben = [v?.eingabeTokens, v?.cacheErzeugtTokens, v?.cacheGelesenTokens].map(zahl).filter((x) => x !== null);
  const usage = {
    costUsd: zahl(v?.kostenUsd),
    inputTokens: eingaben.length ? eingaben.reduce((a, b) => a + b, 0) : null,
    outputTokens: zahl(v?.ausgabeTokens),
    cachedInputTokens: zahl(v?.cacheGelesenTokens),
    modelDurationMs: zahl(kennzahlen?.apiDauerMs),
    turns: zahl(kennzahlen?.zuege),
  };
  return Object.values(usage).every((x) => x === null) ? null : usage;
}

/**
 * Modellzeit und Zuege einer Einheit: die eigenen Kennzahlen, je Feld — traegt die Einheit
 * keins, die Summe ueber ihre Stufen, wie `zuegeDerEinheit` (kanban-kit,
 * nightRunErgebnisstand.ts) es im Browser tut. Ein Feld ohne jede Meldung bleibt `null`,
 * eine leere Summe stuende sonst als 0 da, wo nichts gemessen wurde.
 */
function nachtlaufKennzahlen(einheit) {
  const summe = {};
  for (const feld of ["apiDauerMs", "zuege"]) {
    const eigen = nachtlaufZahl(einheit.kennzahlen?.[feld]);
    if (eigen !== null) { summe[feld] = eigen; continue; }
    const gemeldet = Object.values(einheit.stufen ?? {}).map((s) => nachtlaufZahl(s?.kennzahlen?.[feld])).filter((x) => x !== null);
    summe[feld] = gemeldet.length ? gemeldet.reduce((a, b) => a + b, 0) : null;
  }
  return summe;
}

// Die vier Stufen, die eine Meldung je Ketten-Vorgang fuehrt (Issue #808, E17), in der
// Reihenfolge der Kette. `umsetzung` bleibt draussen: Der Vertrag nimmt hoechstens vier
// Stufen an, ein fuenfter Eintrag liesse die ganze Meldung scheitern — ihr Verbrauch
// bleibt im `usage` des Vorgangs und damit in jeder Gesamtsumme enthalten.
const NACHTLAUF_STUFEN = ["plan", "review", "pakete", "abdeckung"];

/** Die Stufen einer Ketten-Einheit fuer die Meldung; `null` ohne Stufen (Implementierung). */
function nachtlaufStages(einheit) {
  const stufen = einheit.stufen;
  if (!stufen || typeof stufen !== "object") return null;
  // Eine uebernommene Stufe (Plan-Auftrag, Issue #895) ist nie gelaufen: Sie traegt nur
  // die Plannummer. Gemeldet ergaebe sie `durationMs: 0` mit leerem `usage` — eine
  // Messung, die es nicht gab. Darum bleibt sie draussen, wie im Nachtbericht.
  const stages = NACHTLAUF_STUFEN.filter((stage) => stufen[stage] && stufen[stage].uebernommen !== true).map((stage) => ({
    stage,
    durationMs: nachtlaufZahl(stufen[stage].dauerMs),
    // Die Stufe fuehrt Mengen und Kennzahlen in EINEM Objekt (leseKennzahlen nutzt
    // dieselben Feldnamen wie der Verbrauch) — es bedient beide Parameter.
    usage: nachtlaufUsage(stufen[stage].kennzahlen, stufen[stage].kennzahlen),
  }));
  return stages.length ? stages : null;
}

// Die Budget-Felder, die die Fusszeile der Laeufe-Seite zeigt (Issue #808, E4) — nur auf
// sie wird Budget und Herkunft zugeschnitten. KETTE_BUDGET_DEFAULTS (night.mjs) fuehrt
// mehr; ungefiltert entstuende "aus Voreinstellungen" mit lauter Feldern, die niemand sieht.
const NACHTLAUF_BUDGET_FELDER = new Set(["planMin", "reviewMin", "paketeMin", "abdeckungMin", "kostenUsd"]);

/**
 * Das Budget des Laufs samt Herkunft fuer die Meldung; `null`, wenn der Stand keins fuehrt
 * (nur die Kette traegt eins). Ist nach dem Zuschnitt kein Default-Feld uebrig, heisst die
 * Herkunft CONFIGURED ohne Aufzaehlung — eine leere Liste saehe aus wie eine Aussage.
 */
function nachtlaufBudget(stand) {
  const b = stand?.budget;
  if (!b || typeof b !== "object") return null;
  const budget = {};
  for (const feld of NACHTLAUF_BUDGET_FELDER) {
    const wert = nachtlaufZahl(b[feld]);
    if (wert !== null) budget[feld] = wert;
  }
  const defaultFields = (Array.isArray(stand.budgetAusDefault) ? stand.budgetAusDefault : [])
    .filter((feld) => NACHTLAUF_BUDGET_FELDER.has(feld));
  budget.origin = defaultFields.length ? "DEFAULTED" : "CONFIGURED";
  if (defaultFields.length) budget.defaultFields = defaultFields;
  return budget;
}

/**
 * Der Grund, an dem ein Lauf hart gestoppt ist; `null`, solange keiner vorliegt (Issue #881).
 * Seit Issue #1085 ebenso fuer einen verstummten und einen abgebrochenen Lauf.
 *
 * Die Kaskade folgt den drei Stopp-Pfaden in night.mjs: `fail()` schreibt den Text an den
 * Lauf-Kopf, der Vorflug-Stopp und der harte Stopp der Implementierung lassen ihn dort
 * genau dann leer, wenn das Sicherheitsnetz aus Issue #558 den Grund an der betroffenen
 * Einheit sieht. Bleibt beides leer, ist die Fehlerklasse das Letzte, was der Lauf noch
 * ueber sich sagen kann — ein leerer Grund waere schlechter als ein grober.
 *
 * Reine Funktion wie `nachtlaufBudget`: Sie liest den Stand und schreibt nichts hinein.
 */
// Die Abschluesse, die eine Stoerung sind, mit dem Grund, der bleibt, wenn der Stand keinen
// nennt. `verstummt` setzt der Waechter, `abgebrochen` die Abbruch-Handler (Issue #1085,
// E18): Beide schliessen den Lauf ab, und ohne Grund stuende er am Leitstand wie ein
// regulaer beendeter.
const NACHTLAUF_ABBRUCH = { harterStopp: "Harter Stopp", verstummt: "Verstummt", abgebrochen: "Abgebrochen" };

export function nachtlaufAbbruchGrund(stand) {
  const ersatz = NACHTLAUF_ABBRUCH[stand?.abschluss];
  if (ersatz === undefined) return null;
  const gefuellt = (text) => typeof text === "string" && text !== "";
  if (gefuellt(stand.fehlerText)) return stand.fehlerText.slice(0, NACHTLAUF_AUSZUG_MAX);
  const einheiten = Array.isArray(stand.einheiten) ? stand.einheiten : [];
  const betroffen = stand.fehlerEinheit == null
    ? null
    : einheiten.find((e) => String(e?.id) === String(stand.fehlerEinheit));
  if (betroffen && gefuellt(betroffen.grund)) return betroffen.grund.slice(0, NACHTLAUF_AUSZUG_MAX);
  return gefuellt(stand.fehlerklasse) ? `${ersatz} (${stand.fehlerklasse})` : ersatz;
}

function nachtlaufDauer(einheit) {
  if (typeof einheit.dauerMs === "number") return einheit.dauerMs;
  const stufen = Object.values(einheit.stufen ?? {}).map((s) => s?.dauerMs).filter((d) => typeof d === "number");
  return stufen.length ? stufen.reduce((a, b) => a + b, 0) : null;
}

/**
 * Eine Einheit, der ihr Ausgang noch fehlt (Issue #794).
 *
 * `unbekannt` ist der Platzhalter, den `night.mjs` beim Anlegen einer Einheit setzt; ein
 * ganz fehlendes Feld zaehlt genauso. Beides heisst dasselbe: Hier steht noch kein
 * Ergebnis.
 */
function nachtlaufOhneAusgang(einheit) {
  const ausgang = einheit?.ausgang;
  return ausgang === undefined || ausgang === null || ausgang === "" || ausgang === "unbekannt";
}

/**
 * Uebersetzt einen Ergebnisstand in die Meldung fuer `POST /api/kanban/night-runs`.
 * Reine Funktion; `jetzt` bestimmt die Dauer seit dem Start, weil der Stand fortschreibend
 * und damit vor seinem Ende gemeldet wird.
 *
 * Solange der Lauf laeuft, gehen nur Einheiten mit Ausgang mit (Issue #794): Eine Kette
 * legt ihre Einheit beim Start an und traegt den Ausgang erst hinter der letzten Stufe
 * ein — in der ganzen Planungsphase stuende der Fachplan sonst als rotes Paket in der
 * Auswertung, obwohl nur noch nichts entschieden ist. Ein eigener Zustand "laeuft" waere
 * eine Vertragsaenderung ohne Nutzen: Der Lauf selbst gilt bei der Gegenstelle ohnehin
 * als laufend, solange er nicht abgeschlossen ist.
 *
 * NACH dem Abschluss bleibt dieselbe Einheit sichtbar: Dort ist der fehlende Ausgang
 * kein Zwischenstand mehr, sondern der Befund, dass sie nie zu ihrem Ergebnis kam — und
 * genau dafuer haelt `nachtlaufFarbe` den harten Abbruch bereit.
 */
export function nachtlaufMeldung(stand, jetzt = new Date()) {
  const mode = NACHTLAUF_MODUS[stand?.art];
  if (!mode) throw new BoardError(`Lauf-Art '${stand?.art}' hat keine Nachtlauf-Schnittstelle (erwartet: ${Object.keys(NACHTLAUF_MODUS).join(" | ")})`);
  const laeuft = stand.abschluss === null || stand.abschluss === undefined;
  const items = (Array.isArray(stand.einheiten) ? stand.einheiten : [])
    .filter((e) => /^\d+$/.test(String(e?.id)))
    // Vor dem Kappen auf NACHTLAUF_EINHEITEN_MAX, damit eine laufende Einheit den Platz
    // nicht einer belegt, die ihr Ergebnis schon hat.
    .filter((e) => !(laeuft && nachtlaufOhneAusgang(e)))
    .slice(0, NACHTLAUF_EINHEITEN_MAX)
    .map((e) => {
      const [state, errorClass] = nachtlaufFarbe(e);
      const stages = nachtlaufStages(e);
      return {
        cardNumber: Number(e.id),
        // @NotBlank im Vertrag: Ein leerer Titel faellt auf die Nummer zurueck.
        title: String(e.titel || `#${e.id}`).slice(0, NACHTLAUF_TITEL_MAX),
        state,
        errorClass,
        durationMs: nachtlaufDauer(e),
        commitHash: typeof e.commit === "string" ? e.commit.slice(0, NACHTLAUF_COMMIT_MAX) : null,
        excerpt: nachtlaufAuszug(e),
        usage: nachtlaufUsage(e.verbrauch, nachtlaufKennzahlen(e)),
        // Nur, wo der Stand Stufen fuehrt (Issue #808) — ein Implementierungs-Paket
        // meldet das Feld gar nicht erst, wie noWorkReason am Lauf-Kopf.
        ...(stages !== null ? { stages } : {}),
      };
    });
  const grau = items.filter((i) => i.state === "GREY").length;
  const noWorkReason = typeof stand.noWorkReason === "string" && stand.noWorkReason !== ""
    ? stand.noWorkReason.slice(0, NACHTLAUF_NOWORKREASON_MAX)
    : null;
  const budget = nachtlaufBudget(stand);
  const abortReason = nachtlaufAbbruchGrund(stand);
  const releasePreparation = nachtlaufVorbereitung(stand);
  return {
    startedAt: stand.start,
    kind: NACHTLAUF_ART,
    mode,
    durationMs: Math.max(0, jetzt.getTime() - new Date(stand.start).getTime()),
    processedCount: items.length - grau,
    skippedCount: grau,
    unparsedCount: 0,
    // Abgeschlossen ist ein Lauf am Board, sobald sein Ergebnisstand einen Abschluss
    // traegt — regulaer ODER hart gestoppt (Issue #881). Bis dahin kam die Aussage aus
    // `stand.complete`, das nur das regulaere Ende kennt: Ein hart gestoppter Lauf stand
    // dort ewig unter den aktiven Laeufen, obwohl er lange tot war. Der `abortReason`
    // daneben sagt der Gegenstelle, dass dieser Abschluss eine Stoerung ist.
    complete: !laeuft,
    usage: nachtlaufUsage(stand.verbrauch),
    items,
    // Nur bei einem Lauf ohne Arbeit gesetzt (Issue #744) — die Gegenstelle setzt den
    // gruenen Ersatztext sonst nur bei null Arbeitspaketen; ihn immer mitzuschicken
    // liesse zwei Stellen ueber dieselbe Frage entscheiden.
    ...(noWorkReason !== null ? { noWorkReason } : {}),
    // Nur, wo der Stand ein Budget fuehrt (Issue #808) — heute allein die Kette.
    ...(budget !== null ? { budget } : {}),
    // Nur bei einem hart gestoppten, verstummten oder abgebrochenen Lauf (Issue #881,
    // #1085) — wie noWorkReason und budget:
    // Das Feld immer mitzuschicken liesse zwei Stellen ueber dieselbe Frage entscheiden.
    ...(abortReason !== null ? { abortReason } : {}),
    // Nur, wo der Stand eine Vorbereitung der Veroeffentlichung fuehrt (Issue #1248, A7).
    ...(releasePreparation !== null ? { releasePreparation } : {}),
  };
}

// Das Ergebnis der Vorbereitung (A6) im Vertrag (A7).
const VORBEREITUNG_RESULT = { gruen: "GREEN", "gruen-offen": "GREEN_PENDING", rot: "RED", "nicht-vorbereitet": "NOT_PREPARED" };

/** Kartennummern als Zahlen; was keine Nummer ist, faellt heraus. */
function vorbereitungKarten(liste) {
  return (Array.isArray(liste) ? liste : []).filter((k) => /^\d+$/.test(String(k))).map(Number);
}

/**
 * Die vorbereitete Veroeffentlichung fuer die Meldung (Issue #1248, Plan #1243, A7); `null`,
 * wenn der Stand keine fuehrt. `stand.vorbereitung` hat die Form von
 * `.claude/push-vorbereitung.json` (A6). `stages` traegt die Stufe nicht: Der Vertrag
 * begrenzt sie auf vier.
 *
 * Ein unbekanntes Ergebnis laesst das Feld weg, statt die Meldung scheitern zu lassen — wie
 * beim unbekannten Ausgang oben: Nachts fragt niemand, und die Datei aus A6 traegt es ohnehin.
 */
function nachtlaufVorbereitung(stand) {
  const v = stand?.vorbereitung;
  if (!v || typeof v !== "object") return null;
  const result = VORBEREITUNG_RESULT[v.ergebnis];
  if (!result) return null;
  return {
    result,
    commitHash: typeof v.commit === "string" ? v.commit.slice(0, NACHTLAUF_COMMIT_MAX) : null,
    version: typeof v.version === "string" ? v.version : null,
    releaseFiles: v.releaseDateien === true,
    pending: (Array.isArray(v.offen) ? v.offen : []).map(String),
    cardNumbers: vorbereitungKarten(v.pakete),
    redCheck: typeof v.rot?.pruefung === "string" ? v.rot.pruefung : null,
    redCards: vorbereitungKarten(v.rot?.karten),
  };
}

/**
 * Schickt eine Meldung an `POST /api/kanban/night-runs` und liefert den Antwortrumpf, `null`
 * ohne JSON-Rumpf. Der eine Weg beider Melder ans Board; Token, Zeitgrenze und Wiederholung
 * traegt der Toolbox-Adapter. Der Tracker ist injizierbar, damit ein Test den Aufruf im
 * selben Prozess sieht (Plan #1199, E6).
 */
export async function meldungSenden(config, meldung, tracker = new ToolboxIssueTracker(config)) {
  const res = await tracker._fetch("/api/kanban/night-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meldung),
  });
  try { return await res.json(); } catch { return null; }
}

// Die Befehle unten liefern ihre Antwort zurueck, statt sie auszugeben; die Verteiler geben
// sie aus. Config, Datei, Uhr und Versand sind injiziert, damit ein Test jeden Ausgang im
// selben Prozess belegt (Plan #1199, E6). Ein Abbruch wirft BoardError statt `fail()`: Der
// Einstieg gibt ihn mit demselben Wortlaut und Exit 1 aus, und ein Test kann ihn fangen.
export async function nightrunMelden(args, {
  config = loadConfig(),
  lesen = (pfad) => readFileSync(pfad, "utf-8"),
  senden = meldungSenden,
  jetzt = () => new Date(),
  melde = (zeile) => process.stderr.write(`${zeile}\n`),
} = {}) {
  if (config.issueTracker !== "toolbox") {
    throw new BoardError(`Einlieferung nur mit issueTracker toolbox moeglich, konfiguriert ist '${config.issueTracker}'.`);
  }
  if (!args.datei) throw new BoardError("nightrun melden braucht --datei <ergebnisstand.json>");
  let stand;
  try {
    stand = JSON.parse(lesen(args.datei));
  } catch (e) {
    throw new BoardError(`Ergebnisstand ${args.datei} nicht lesbar: ${e.message}`);
  }
  const meldung = nachtlaufMeldung(stand, jetzt());
  try {
    const antwort = await senden(config, meldung);
    return { ok: true, outcome: antwort?.outcome ?? null };
  } catch (e) {
    // Kennt die Gegenstelle `releasePreparation` noch nicht, weist sie die Meldung mit 400
    // ab (Issue #1248, Plan #1243, E13). Die Laufmeldung darf an der Erweiterung nicht
    // verloren gehen: genau ein Nachversuch ohne das Feld. Jeder andere Fehler bleibt.
    if (!(e instanceof BoardError) || e.status !== 400 || !("releasePreparation" in meldung)) throw e;
    const { releasePreparation, ...ohneFeld } = meldung;
    melde(`Hinweis: Laufmeldung mit releasePreparation abgewiesen (HTTP 400), Nachversuch ohne das Feld: ${e.message.split("\n")[0]}`);
    const antwort = await senden(config, ohneFeld);
    return { ok: true, outcome: antwort?.outcome ?? null, rueckfall: "ohne releasePreparation nachgemeldet nach HTTP 400" };
  }
}

export async function dispatchNightrun(command, args, hilfe) {
  if (command === "melden") return ausgeben(await nightrunMelden(args));
  process.stdout.write(hilfe);
  fail(`Unbekannter nightrun-Befehl: '${command}'`);
}

/** Eine Antwort der Melder: eine Zeile JSON, wie die Hook-Aufrufer sie lesen. */
function ausgeben(antwort) {
  process.stdout.write(JSON.stringify(antwort) + "\n");
}

// ============================================================
// Sitzungs-Melder fuer den interaktiven Verbrauch (Issue #734)
// ============================================================
//
// WARUM IM BOARD-WERKZEUG UND NICHT IN EINER EIGENEN kit/sitzung.mjs (die Entscheidung,
// die das Arbeitspaket offen liess): Der Melder braucht `readWorkflowConfig`,
// `resolveToolboxToken`, `ToolboxIssueTracker._fetch` und `agentModelHeader` aus den
// Teilen grundlagen und adapter. Ein eigenes Werkzeug muesste sie nachbauen (zwei Wege
// zum selben Board, die auseinanderlaufen), und es braucht Blob, Stempel und eine Zeile
// im Installer — Aufwand, den das Paket nicht verlangt. Die Preistabelle liegt trotzdem daneben
// (kit/preise.mjs): Sie ist Pflegedaten mit eigenem Stand, kein Code, und genau
// deshalb hat sie eine eigene Datei verdient.
//
// Der Vertrag ist derselbe wie beim Nachtlauf (`POST /api/kanban/night-runs`,
// mannewolff/kanban-kit#1012), nur mit `kind`/`mode` INTERACTIVE und dem
// Sitzungsstart als fachlichem Schluessel.

const SITZUNG_ART = "INTERACTIVE";
const SITZUNG_ZUSTAND = "GREEN";
const SITZUNG_DROSSEL_MS = 5 * 60 * 1000;
const SITZUNG_STAND_DATEI = "sitzung-meldung.json";

// Das Verzeichnis, in dem board.mjs seine Nachbardateien sucht — heute allein
// kit/preise.mjs, eine Ebene ueber diesem Teil. BOARD_NACHBAR_DIR ist ein reiner
// Test-Hook (wie NIGHT_NACHBAR_DIR in night.mjs): Ohne ihn ist der Fallback-Zweig nur
// mit einer Kopie im Temp-Verzeichnis erreichbar. Bewusst nicht KIT_ROOT: Das verlegt
// die Suche in ein fremdes Projekt — eine Nachbardatei gehoert zum Werkzeug, nicht zum cwd.
const NACHBAR_DIR = process.env.BOARD_NACHBAR_DIR ? resolve(process.env.BOARD_NACHBAR_DIR) : join(__dirname, "..");

// Die Preistabelle als Nachbardatei: bedingtes `await import`, damit board.mjs
// auch als allein kopierte Datei laeuft (dieselbe Bauart wie die Fallbacks in
// night.mjs). Fehlt sie, kennt der Melder keinen Preis — und meldet dann eben
// keinen Betrag. Das ist genau das Verhalten, das board-15 fuer ein unbekanntes
// Modell verlangt, und deshalb braucht dieser Weg keinen zweiten Fehlerpfad.
const NACHBAR_PREISE = join(NACHBAR_DIR, "preise.mjs");
const { preisFuer } = existsSync(NACHBAR_PREISE)
  ? await import(pathToFileURL(NACHBAR_PREISE).href)
  : { preisFuer: () => null };

/**
 * Liest das Sitzungsprotokoll von Claude Code (JSON Lines).
 *
 * DER KERN IST DIE ENTDOPPLUNG. Ein Zug steht mit einer Zeile je Inhaltsblock im
 * Protokoll — Text, Werkzeugaufruf, Gedanke —, und JEDE dieser Zeilen traegt dieselbe
 * `message.id` und dieselbe `usage`. An den Protokollen dieses Projekts gemessen
 * (2026-09-18): 90 Zeilen mit usage auf 40 Zuege. Wer je Zeile addiert, meldet das
 * Zwei- bis Sechsfache des Verbrauchs. Es gewinnt die letzte Zeile einer id: Waehrend
 * ein Zug laeuft, waechst seine usage, und der letzte Stand ist der vollstaendige.
 *
 * `start` ist der frueheste Zeitstempel im Protokoll — auch aus einer Zeile ohne
 * usage, denn die Sitzung beginnt mit der Eingabe des Menschen, nicht mit der ersten
 * Antwort. Er ist der fachliche Schluessel der Meldung; derselbe Schluessel ersetzt
 * am Endpunkt die vorige Meldung derselben Sitzung.
 *
 * Unlesbare Zeilen werden gezaehlt, nicht geworfen: Ein Protokoll, das gerade
 * geschrieben wird, endet regelmaessig mitten in einer Zeile, und eine halbe Zeile
 * darf keine Meldung kosten. Die Zahl geht als `unparsedCount` in den Vertrag.
 */
export function sitzungProtokoll(text) {
  const proId = new Map();
  let start = null;
  let unlesbar = 0;
  for (const zeile of String(text ?? "").split(/\r\n|\r|\n/)) {
    if (zeile.trim() === "") continue;
    let obj;
    try { obj = JSON.parse(zeile); } catch { unlesbar++; continue; }
    const zeit = Date.parse(obj?.timestamp);
    if (Number.isFinite(zeit) && (start === null || zeit < start)) start = zeit;
    const zug = sitzungZug(obj, zeit);
    if (zug) proId.set(zug.id, zug);
  }
  return {
    start: start === null ? null : new Date(start).toISOString(),
    zuege: [...proId.values()].sort((a, b) => a.zeit - b.zeit),
    unlesbar,
  };
}

/** Ein Protokolleintrag als Zug, oder `null`, wenn er keine Mengen traegt. */
function sitzungZug(obj, zeit) {
  const usage = obj?.message?.usage;
  const id = obj?.message?.id;
  if (!usage || typeof usage !== "object" || typeof id !== "string" || !Number.isFinite(zeit)) return null;
  const zahl = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  // Der Zwischenspeicher wird nach Haltedauer getrennt gefuehrt: Der Stunden-Speicher
  // kostet das Doppelte der Eingabe, der Fuenf-Minuten-Speicher das 1,25-fache. Das
  // Protokoll fuehrt beide Mengen unter `cache_creation`, und ihre Summe ist immer
  // `cache_creation_input_tokens` (an allen Protokollen dieses Projekts geprueft).
  // Fehlt die Aufschluesselung, faellt alles auf den Fuenf-Minuten-Satz — die Angabe
  // gibt es seit es die Stunden-Variante gibt, und der kleinere Satz behauptet im
  // Zweifel weniger.
  const teile = usage.cache_creation;
  const erzeugt = zahl(usage.cache_creation_input_tokens);
  const cache1h = teile && typeof teile === "object" ? zahl(teile.ephemeral_1h_input_tokens) : 0;
  return {
    id,
    zeit,
    modell: typeof obj?.message?.model === "string" ? obj.message.model : null,
    eingabe: zahl(usage.input_tokens),
    ausgabe: zahl(usage.output_tokens),
    cache1h,
    cache5m: erzeugt - cache1h,
    cacheGelesen: zahl(usage.cache_read_input_tokens),
  };
}

// Die beiden Spalten, die `issue move` vermerkt (WEGMARKEN_SPALTEN im Teil dokumente). `in_review`
// SCHLIESST den Abschnitt seiner Karte, `in_progress` oeffnet ihn.
const WEGMARKE_SCHLIESST = "in_review";

/**
 * Uebersetzt `.claude/wegmarken.tsv` in Abschnitte `{ karte, von, bis }` in
 * Millisekunden; `bis === null` heisst "bis zum Ende der Sitzung".
 *
 * ZWEI DURCHGAENGE, UND DAS IST DER GANZE PUNKT. Die Datei ist eine flache,
 * angehaengte Liste ohne Sitzungskennung — laufen zwei Sitzungen im selben
 * Verzeichnis, mischen sich ihre Wegmarken darin. Nur die Paarung aus eigenem
 * `in_progress` und eigenem `in_review` macht sichtbar, dass zwei Karten
 * GLEICHZEITIG offen waren (E21). Wer die Marken bloss der Reihe nach als Grenzen
 * liest, sieht diese Ueberlappung nie und schreibt den Verbrauch der einen Sitzung
 * der Karte der anderen zu.
 *
 * Durchgang 1 paart jedes `in_review` mit dem juengsten offenen `in_progress`
 * derselben Karte — das ergibt die geschlossenen Abschnitte.
 * Durchgang 2 nimmt die `in_progress` ohne eigenen Abschluss: Sie enden an der
 * naechsten Wegmarke einer ANDEREN Karte (der Normalfall der gestaffelten Arbeit) —
 * oder gar nicht, wenn keine mehr kommt.
 *
 * Was kein Abschnitt abdeckt oder was zwei Abschnitte abdecken, bekommt keine Karte.
 * Geraten wird nicht; die Zuordnung selbst macht `sitzungMeldung`.
 */
export function wegmarkenAbschnitte(text) {
  const marken = [];
  for (const zeile of String(text ?? "").split(/\r\n|\r|\n/)) {
    const [zeitText, karte, status] = zeile.split("\t");
    const zeit = Date.parse(zeitText);
    if (!Number.isFinite(zeit) || !karte || !WEGMARKEN_SPALTEN.has(status)) continue;
    marken.push({ zeit, karte, status });
  }
  marken.sort((a, b) => a.zeit - b.zeit);

  const abschnitte = [];
  const offen = new Map(); // karte -> Index der eroeffnenden Marke
  for (const [i, marke] of marken.entries()) {
    if (marke.status === WEGMARKE_SCHLIESST) {
      const start = offen.get(marke.karte);
      if (start !== undefined) {
        abschnitte.push({ karte: marke.karte, von: marken[start].zeit, bis: marke.zeit });
        offen.delete(marke.karte);
      }
      continue;
    }
    if (!offen.has(marke.karte)) offen.set(marke.karte, i);
  }
  for (const [karte, start] of offen) {
    const naechste = marken.slice(start + 1).find((m) => m.karte !== karte);
    abschnitte.push({ karte, von: marken[start].zeit, bis: naechste ? naechste.zeit : null });
  }
  return abschnitte.sort((a, b) => a.von - b.von);
}

/**
 * Die Karte eines Zeitpunkts — `null`, wenn ihn kein Abschnitt abdeckt oder mehr als
 * einer. Beides ist "ohne Karte": kein Abschnitt heisst, es lief keine Karte; zwei
 * Abschnitte heissen, es liefen zwei Sitzungen und keine Zuordnung waere belegbar.
 */
function sitzungKarte(abschnitte, zeit) {
  const treffer = abschnitte.filter((a) => zeit >= a.von && (a.bis === null || zeit < a.bis));
  return treffer.length === 1 ? treffer[0].karte : null;
}

/**
 * Der Dollarbetrag einer Menge Zuege, oder `null`, wenn er nicht bestimmbar ist.
 *
 * `null` statt 0, sobald EIN Zug ein Modell fuehrt, das die Preistabelle nicht kennt
 * und das Token verbraucht hat: Die Summe waere dann zu klein, saehe aber aus wie
 * gemessen. Ein unbekanntes Modell OHNE Token kostet dagegen zu jedem Preis nichts —
 * das ist Rechnen, kein Raten, und es haelt Claude Codes eigene Platzhalter-Eintraege
 * (`<synthetic>`, immer null Token) aus dem Ergebnis heraus.
 *
 * Auf sechs Stellen gerundet, wie `verbrauchOhneEinheit` in night.mjs: Sonst stuende
 * Gleitkomma-Rauschen im Betrag.
 */
function sitzungKosten(zuege) {
  let summe = 0;
  for (const z of zuege) {
    const mengen = [z.eingabe, z.ausgabe, z.cache5m, z.cache1h, z.cacheGelesen];
    if (mengen.every((m) => m === 0)) continue;
    const preis = preisFuer(z.modell);
    if (!preis) return null;
    const saetze = [preis.eingabe, preis.ausgabe, preis.cacheSchreiben5m, preis.cacheSchreiben1h, preis.cacheLesen];
    summe += mengen.reduce((s, menge, i) => s + (menge * saetze[i]) / 1e6, 0);
  }
  return Math.round(summe * 1e6) / 1e6 + 0;
}

/**
 * Die Mengen einer Menge Zuege im Vertragsformat — dieselbe Deutung wie
 * `nachtlaufUsage`: Eingabemenge ist alles Verarbeitete (eigene Eingabe plus beide
 * Zwischenspeicher-Mengen), der Zwischenspeicher-Anteil nur das Gelesene.
 */
function sitzungUsage(zuege) {
  const summe = (feld) => zuege.reduce((s, z) => s + z[feld], 0);
  return {
    costUsd: sitzungKosten(zuege),
    inputTokens: summe("eingabe") + summe("cache5m") + summe("cache1h") + summe("cacheGelesen"),
    outputTokens: summe("ausgabe"),
    cachedInputTokens: summe("cacheGelesen"),
  };
}

/**
 * Baut den Rumpf fuer `POST /api/kanban/night-runs`. Reine Funktion; `jetzt` bestimmt
 * die Dauer, weil fortschreibend gemeldet wird.
 *
 * Der Rest ohne Kartennummer steht NICHT als eigener Eintrag in `items` — er ergibt
 * sich als Sitzungssumme minus Summe der Karten, genau wie `verbrauchOhneEinheit`
 * beim Nachtlauf. Ein Eintrag ohne `cardNumber` waere ein neues Feld im Vertrag eines
 * fremden Dienstes; die Differenz ist dieselbe Auskunft ohne Vertragsaenderung.
 *
 * `state: GREEN` mit `errorClass: null` fuer jede Karte: Eine interaktive Sitzung
 * meldet Verbrauch, keinen Ausgang. GREY hiesse "uebersprungen" und waere falsch — an
 * der Karte wurde gearbeitet.
 */
export function sitzungMeldung({ start, zuege, unlesbar = 0, abschnitte = [], complete = false, jetzt = new Date() }) {
  const jeKarte = new Map();
  for (const z of zuege) {
    const karte = sitzungKarte(abschnitte, z.zeit);
    if (karte === null) continue;
    if (!jeKarte.has(karte)) jeKarte.set(karte, []);
    jeKarte.get(karte).push(z);
  }
  const ende = jetzt.getTime();
  const items = [...jeKarte.entries()]
    .filter(([karte]) => /^\d+$/.test(karte))
    .slice(0, NACHTLAUF_EINHEITEN_MAX)
    .map(([karte, eigene]) => ({
      cardNumber: Number(karte),
      // @NotBlank im Vertrag. Den Titel kennt der Melder nicht — ihn zu holen waere ein
      // Board-Aufruf je Karte fuer eine Angabe, die am Board ohnehin steht.
      title: `#${karte}`.slice(0, NACHTLAUF_TITEL_MAX),
      state: SITZUNG_ZUSTAND,
      errorClass: null,
      durationMs: abschnitte
        .filter((a) => a.karte === karte)
        .reduce((s, a) => s + Math.max(0, Math.min(a.bis ?? ende, ende) - a.von), 0),
      commitHash: null,
      excerpt: null,
      usage: sitzungUsage(eigene),
    }));
  const beginn = start === null ? ende : Date.parse(start);
  return {
    startedAt: start,
    kind: SITZUNG_ART,
    mode: SITZUNG_ART,
    durationMs: Math.max(0, ende - beginn),
    processedCount: items.length,
    skippedCount: 0,
    unparsedCount: unlesbar,
    complete,
    usage: sitzungUsage(zuege),
    items,
  };
}

/** Der Pfad des Protokolls: `--protokoll`, sonst `transcript_path` aus dem Hook-Rumpf. */
function sitzungProtokollPfad(args, stdinLesen) {
  if (typeof args.protokoll === "string") return args.protokoll;
  // Ein Claude-Code-Hook reicht seinen Rumpf ueber stdin herein. Ist keine da oder
  // steht nichts Brauchbares drin, meldet der Melder nichts — er soll nie raten,
  // welches der Protokolle im Benutzerverzeichnis die laufende Sitzung ist.
  try {
    const rumpf = JSON.parse(stdinLesen());
    return typeof rumpf?.transcript_path === "string" ? rumpf.transcript_path : null;
  } catch {
    return null;
  }
}

/** Das Ergebnis eines Laufs ohne Meldung — immer Exit 0, nie ein Fehler. */
function sitzungSchweigt(grund) {
  return { ok: true, gemeldet: false, grund };
}

/**
 * Der Stand der letzten Meldung dieser Sitzung, fuer die Drosselung. Liegt neben den
 * Wegmarken unter `.claude/`; eine fremde oder kaputte Datei zaehlt als "noch nie
 * gemeldet" — im Zweifel wird gemeldet, nicht geschwiegen.
 */
function sitzungStandLesen(start, ablage) {
  try {
    const stand = JSON.parse(readFileSync(join(ablage, SITZUNG_STAND_DATEI), "utf-8"));
    return stand?.sitzung === start ? Date.parse(stand.zuletzt) : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

/**
 * Verbucht eine gelungene Meldung: Zwischenmeldung -> Zeitpunkt merken (Drosselung),
 * Sitzungsende -> Wegmarken leeren und den Stand wegraeumen.
 *
 * Geleert, nicht geloescht: Die Datei ist der Ort, an den `issue move` anhaengt, und
 * sie zu entfernen hiesse, das naechste Anhaengen auf `mkdir` zurueckzuwerfen.
 * Scheitert das Schreiben, bleibt es beim Hinweis — die Meldung ist raus, und daran
 * aendert eine klemmende Datei nichts mehr.
 */
function sitzungVerbuchen(start, complete, jetzt, { ablage, melde }) {
  const stand = join(ablage, SITZUNG_STAND_DATEI);
  try {
    mkdirSync(ablage, { recursive: true });
    if (complete) {
      writeFileSync(join(ablage, WEGMARKEN_DATEI), "", "utf-8");
      writeFileSync(stand, JSON.stringify({ sitzung: start, zuletzt: null }) + "\n", "utf-8");
    } else {
      writeFileSync(stand, JSON.stringify({ sitzung: start, zuletzt: jetzt.toISOString() }) + "\n", "utf-8");
    }
  } catch (e) {
    melde(`Hinweis: Sitzungs-Stand nicht geschrieben (${stand}): ${e.message}`);
  }
}

/**
 * `sitzung melden` — der Verbrauch der laufenden Sitzung ans Board (Issue #734).
 *
 * Jeder Grund zu schweigen endet mit Exit 0 und ohne HTTP-Aufruf. Der Melder laeuft
 * an einem Hook und darf eine Sitzung niemals stoeren: Er ist Buchhaltung, keine
 * Bedingung — dieselbe Haltung wie bei `wegmarkeSchreiben`.
 *
 * Die Reihenfolge der Pruefungen ist bindend. KIT_AGENT_MODEL steht ganz vorn, VOR
 * jedem Config- und Dateizugriff: Nachts ist diese Sitzung bereits in der Meldung des
 * Runners enthalten (E15), und ein Melder, der erst die Config liest, koennte an ihr
 * scheitern statt zu schweigen. Darum ist auch die Config ein Leser und kein Wert.
 *
 * Umgebung, Config, Ablage unter `.claude/`, stdin, Uhr, Versand und Hinweiskanal sind
 * injiziert; der Befehl liefert seine Antwort zurueck (Plan #1199, E6).
 */
export async function sitzungMelden(args, {
  env = process.env,
  leseConfig = readWorkflowConfig,
  ablage = resolve(".claude"),
  stdinLesen = () => readFileSync(0, "utf-8"),
  jetzt = () => new Date(),
  senden = meldungSenden,
  melde = (zeile) => process.stderr.write(`${zeile}\n`),
} = {}) {
  if (agentModelHeader(env)["X-Agent-Model"]) return sitzungSchweigt("nachtbetrieb");

  const config = leseConfig();
  if (config?.issueTracker !== "toolbox") return sitzungSchweigt("kein-board");
  // E3: Ohne projektgebundenes Token gibt es kein Zielprojekt — und es wird auch
  // keines aus dem Aufruf geraten. Die Bindung des Tokens bestimmt, wohin gemeldet wird.
  try {
    resolveToolboxToken({ cfg: config, env, readFile: (p) => readFileSync(p, "utf-8") });
  } catch {
    return sitzungSchweigt("kein-token");
  }

  const pfad = sitzungProtokollPfad(args, stdinLesen);
  if (!pfad) return sitzungSchweigt("kein-protokoll");
  let protokoll;
  try {
    protokoll = sitzungProtokoll(readFileSync(pfad, "utf-8"));
  } catch {
    return sitzungSchweigt("protokoll-nicht-lesbar");
  }
  if (protokoll.zuege.length === 0) return sitzungSchweigt("nichts-gemessen");

  // E16: Das Sitzungsende meldet immer. Dazwischen hoechstens einmal je fuenf Minuten —
  // nur am Ende zu melden verloere jede abgestuerzte Sitzung, ungedrosselt erzeugte
  // jeder Zug einen HTTP-Aufruf.
  const complete = args.complete === true;
  const zeitpunkt = jetzt();
  const zuletzt = sitzungStandLesen(protokoll.start, ablage);
  if (!complete && Number.isFinite(zuletzt) && zeitpunkt.getTime() - zuletzt < SITZUNG_DROSSEL_MS) {
    return sitzungSchweigt("gedrosselt");
  }

  let wegmarken = "";
  try { wegmarken = readFileSync(join(ablage, WEGMARKEN_DATEI), "utf-8"); } catch { /* keine Wegmarke: alles Rest */ }
  const meldung = sitzungMeldung({
    ...protokoll,
    abschnitte: wegmarkenAbschnitte(wegmarken),
    complete,
    jetzt: zeitpunkt,
  });

  let antwort;
  try {
    antwort = await senden(config, meldung);
  } catch (e) {
    // Nicht eingeliefert heisst nicht verbucht: Weder wird gedrosselt noch werden die
    // Wegmarken geleert — der naechste Versuch soll denselben Abschnitt noch sehen.
    melde(`Hinweis: Sitzungs-Meldung nicht eingeliefert: ${e.message}`);
    return sitzungSchweigt("nicht-eingeliefert");
  }
  sitzungVerbuchen(protokoll.start, complete, zeitpunkt, { ablage, melde });
  return { ok: true, gemeldet: true, complete, karten: meldung.items.length, outcome: antwort?.outcome ?? null };
}

export async function dispatchSitzung(command, args, hilfe) {
  if (command === "melden") return ausgeben(await sitzungMelden(args));
  process.stdout.write(hilfe);
  fail(`Unbekannter sitzung-Befehl: '${command}'`);
}
