/**
 * board/ursprung.mjs — Ist ein Plan durch, und welche Ursprungsdokumente wandern nach In
 * review (Issue #1285, Plan #1283 A3–A8, A11, E2–E4, E9)?
 *
 * Ursprungsdokumente sind das Plandokument und die fachliche Anforderung dahinter. Ein Plan
 * ist durch, wenn mindestens ein Paket feststellbar in In review oder Done liegt und keines
 * in Backlog, Ready oder In progress — dieselbe Spaltenregel wie bei Voraussetzungen.
 * Bewusst nicht `paketUmgesetzt` aus kit/night/kette.mjs: Ein Nachweis-Mangel haelt die
 * Karte in In review, und gezaehlt wird die Spalte.
 *
 * `ursprungAuswerten` entscheidet ohne Board-Zugriff ueber die Kartenliste aus
 * `auftragAlleKarten`; nur die Kommentare weiterer Plaene holt es ueber `kommentareVon`,
 * und zwar erst, wenn der eigene Plan durch ist und die Anforderung noch nicht in In review
 * oder Done liegt (E4). `ursprungLesen` und `ursprungNachziehen` sind der Board-Zugriff
 * dazu. Gezogen wird nur nach In review, nie nach Done, und ohne Wegmarke und Bewegung
 * (E9): Beide Protokolle messen Pakete.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { COLUMN_DEFAULTS } from "./grundlagen.mjs";
import { auftragAlleKarten, herkunftNummern, istPlan, istFachlich } from "./dokumente.mjs";
import { erkenneMarker, markerName, praefix, prozessSprache, text } from "./namen.mjs";

// ============================================================
// Texte an den Menschen (Issue #1483, Plan #1420 E13/E14)
// ============================================================

/**
 * Die Gruende der Auswertung je Sprache. Vertragswerte bleiben ausserhalb (E14): die Werte
 * von `aktion` (`wandert`, `bleibt`, `lag bereits in <Spalte>`, kit/board/dokumente.mjs liest
 * sie zurueck), von `art` der Dokumente und die Spaltennamen.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    nichtFeststellbar: "nicht feststellbar: {grund}",
    spaltenNichtLesbar: "Spalten der Pakete nicht lesbar",
    keinePakete: "Plan #{plan} hat keine Pakete (noch nicht geschnitten)",
    nichtDurch: "Plan #{plan} nicht durch: {liste}",
    paketInSpalte: "#{id} in {spalte}",
    ohneVermerk: "Plan #{plan} ohne Vermerk „{anker}…“ — {grund}",
    planNichtAufBoard: "Plan #{plan} steht in keiner Spalte des Boards",
    nichtAufBoard: "#{id} steht in keiner Spalte des Boards",
    keinUrsprung: "kein Ursprungsdokument: #{id} trägt kein Präfix {praefix}",
    keinPraefix: "#{id} trägt kein Präfix {praefix}",
    spalteNichtLesbar: "Spalte von #{id} nicht lesbar",
    kommentareNichtLesbar: "Kommentare von Plan #{plan} nicht lesbar ({fehler})",
    kartenNichtLesbar: "Karten nicht lesbar ({fehler})",
    allePlaeneDurch: "alle Pläne der Anforderung sind durch",
    allePaketeDurch: "alle Pakete liegen in In review oder Done",
    nichtBewegt: "Dokument nicht bewegt",
  }),
  en: Object.freeze({
    nichtFeststellbar: "not determinable: {grund}",
    spaltenNichtLesbar: "columns of the packages not readable",
    keinePakete: "Plan #{plan} has no packages (not cut yet)",
    nichtDurch: "Plan #{plan} not done: {liste}",
    paketInSpalte: "#{id} in {spalte}",
    ohneVermerk: "Plan #{plan} without note “{anker}…” — {grund}",
    planNichtAufBoard: "plan #{plan} is in no column of the board",
    nichtAufBoard: "#{id} is in no column of the board",
    keinUrsprung: "not an origin document: #{id} does not carry the prefix {praefix}",
    keinPraefix: "#{id} does not carry the prefix {praefix}",
    spalteNichtLesbar: "column of #{id} not readable",
    kommentareNichtLesbar: "comments of plan #{plan} not readable ({fehler})",
    kartenNichtLesbar: "cards not readable ({fehler})",
    allePlaeneDurch: "all plans of the requirement are done",
    allePaketeDurch: "all packages are in In review or Done",
    nichtBewegt: "document not moved",
  }),
});

const t = (schluessel, werte) => text(TEXTE, schluessel, werte);
const nichtFeststellbar = (schluessel, werte) => t("nichtFeststellbar", { grund: t(schluessel, werte) });

const OFFEN = new Set(["backlog", "ready", "in_progress"]);
const ERLEDIGT = new Set(["in_review", "done"]);

const ohneFuehrendeNullen = (id) => String(id).replace(/^0+(?=\d)/, "");
const spaltenName = (spalte) => COLUMN_DEFAULTS[spalte] ?? spalte;
const nachNummer = (a, b) => Number(a.id) - Number(b.id);

/**
 * Durch-Urteil eines Plans nach A5: `{ durch, fehlend, grund }`. `grund` ist null, wenn der
 * Plan durch ist, sonst ein Satz, der sagt, warum nicht.
 */
function planStand(karten, planNr) {
  const pakete = karten.filter((k) => k.id !== planNr && herkunftNummern(k.body, "Plan").includes(planNr));
  const fehlend = pakete.filter((k) => OFFEN.has(k.spalte)).sort(nachNummer)
    .map(({ id, titel, spalte }) => ({ id, titel, spalte }));
  if (pakete.length === 0) return { durch: false, fehlend, grund: t("keinePakete", { plan: planNr }) };
  if (fehlend.length > 0) {
    const liste = fehlend.map((k) => t("paketInSpalte", { id: k.id, spalte: spaltenName(k.spalte) })).join(", ");
    return { durch: false, fehlend, grund: t("nichtDurch", { plan: planNr, liste }) };
  }
  if (!pakete.some((k) => ERLEDIGT.has(k.spalte))) return { durch: false, fehlend, grund: nichtFeststellbar("spaltenNichtLesbar") };
  return { durch: true, fehlend, grund: null };
}

/** Der Ausgang eines Dokuments, das schon in In review oder Done liegt, sonst null (A7). */
function lagBereits(spalte) {
  return ERLEDIGT.has(spalte) ? `lag bereits in ${spaltenName(spalte)}` : null;
}

function dokument(karte, id, art, aktion, grund) {
  return { id, art, spalte: karte?.spalte ?? null, aktion, grund };
}

/** Ein weiterer Plan haelt die Anforderung fest, wenn er nicht durch und nicht als ueberholt vermerkt ist (A6). */
async function haltenderPlan(karten, nr, kommentareVon) {
  const stand = planStand(karten, nr);
  if (stand.durch) return null;
  const kommentare = await kommentareVon(nr);
  // Der Vermerk unter beiden Namen (Issue #1443).
  const ueberholt = (kommentare ?? []).some((k) => erkenneMarker(String(typeof k === "string" ? k : k?.body ?? "")) === "ueberholt");
  return ueberholt ? null : t("ohneVermerk", { plan: nr, anker: markerName("ueberholt", prozessSprache()), grund: stand.grund });
}

/** Die fachliche Anforderung hinter dem Plan, oder null, wenn der Plan keine nennt (A6, E3, E4). */
async function anforderungAuswerten(karten, planNr, planKarte, stand, kommentareVon) {
  const quelle = herkunftNummern(planKarte.body, "Fachliche Quelle")[0];
  if (quelle === undefined) return null;
  const karte = karten.find((k) => k.id === quelle);
  const bleibt = (grund) => dokument(karte, quelle, "fachlich", "bleibt", grund);
  if (!karte) return bleibt(nichtFeststellbar("nichtAufBoard", { id: quelle }));
  if (!istFachlich(karte.titel)) return bleibt(t("keinUrsprung", { id: quelle, praefix: praefix("fachlich", prozessSprache()) }));
  const bereits = lagBereits(karte.spalte);
  if (bereits) return dokument(karte, quelle, "fachlich", bereits, null);
  if (!stand.durch) return bleibt(stand.grund);
  if (karte.spalte === null) return bleibt(nichtFeststellbar("spalteNichtLesbar", { id: quelle }));
  const weitere = karten.filter((k) => k.id !== planNr && istPlan(k.titel)
    && herkunftNummern(k.body, "Fachliche Quelle").includes(quelle)).sort(nachNummer);
  const halten = [];
  for (const p of weitere) {
    try {
      const grund = await haltenderPlan(karten, p.id, kommentareVon);
      if (grund) halten.push(grund);
    } catch (e) {
      return bleibt(nichtFeststellbar("kommentareNichtLesbar", { plan: p.id, fehler: e.message }));
    }
  }
  if (halten.length > 0) return bleibt(halten.join("; "));
  return dokument(karte, quelle, "fachlich", "wandert", t("allePlaeneDurch"));
}

/**
 * Die Auswertung eines Plans: `{ plan, durch, grund, fehlend: [{id, titel, spalte}],
 * dokumente: [{id, art: "plan"|"fachlich", spalte, aktion, grund}] }`. `aktion` ist
 * `wandert`, `lag bereits in In review`, `lag bereits in Done` oder `bleibt`. `grund` oben
 * ist null, wenn der Plan durch ist, sonst der Satz, warum nichts wegen des Plans wandert.
 */
export async function ursprungAuswerten({ karten, planNr, kommentareVon }) {
  const plan = ohneFuehrendeNullen(planNr);
  const leer = (grund, dokumente = []) => ({ plan, durch: false, grund, fehlend: [], dokumente });
  const planKarte = karten.find((k) => k.id === plan);
  if (!planKarte) return leer(nichtFeststellbar("planNichtAufBoard", { plan }));
  if (!istPlan(planKarte.titel)) {
    const grund = nichtFeststellbar("keinPraefix", { id: plan, praefix: praefix("plan", prozessSprache()) });
    return leer(grund, [dokument(planKarte, plan, "plan", "bleibt", grund)]);
  }
  const stand = planStand(karten, plan);
  const bereits = lagBereits(planKarte.spalte);
  let planDok;
  if (bereits) planDok = dokument(planKarte, plan, "plan", bereits, null);
  else if (!stand.durch) planDok = dokument(planKarte, plan, "plan", "bleibt", stand.grund);
  else if (planKarte.spalte === null) planDok = dokument(planKarte, plan, "plan", "bleibt", nichtFeststellbar("spalteNichtLesbar", { id: plan }));
  else planDok = dokument(planKarte, plan, "plan", "wandert", t("allePaketeDurch"));
  const anforderung = await anforderungAuswerten(karten, plan, planKarte, stand, kommentareVon);
  return {
    plan, durch: stand.durch, grund: stand.grund, fehlend: stand.fehlend,
    dokumente: anforderung ? [planDok, anforderung] : [planDok],
  };
}

/** Die Kommentare einer Karte, streng gelesen: Ein Fehler wirft, statt still leer zu sein. */
async function kommentareStreng(tracker, nr) {
  if (typeof tracker.kommentareStreng === "function") return tracker.kommentareStreng(nr);
  return (await tracker.getIssue(nr)).comments ?? [];
}

/** Die Auswertung am Board, rein lesend (A11). Ein Lesefehler der Listen heisst „nicht feststellbar“. */
export async function ursprungLesen(tracker, planNr) {
  let karten;
  try {
    karten = await auftragAlleKarten(tracker, new Map());
  } catch (e) {
    return { plan: ohneFuehrendeNullen(planNr), durch: false, grund: nichtFeststellbar("kartenNichtLesbar", { fehler: e.message }), fehlend: [], dokumente: [] };
  }
  return ursprungAuswerten({ karten, planNr, kommentareVon: (nr) => kommentareStreng(tracker, nr) });
}

/**
 * Liest die Auswertung und zieht jedes Dokument mit Aktion `wandert` nach In review (A3,
 * A8, E9). Ein gescheiterter Zug haelt die uebrigen nicht auf; er steht in `fehler` mit dem
 * Kommando, mit dem der Mensch nachzieht.
 */
export async function ursprungNachziehen(tracker, planNr) {
  const auswertung = await ursprungLesen(tracker, planNr);
  const fehler = [];
  for (const d of auswertung.dokumente.filter((x) => x.aktion === "wandert")) {
    try {
      await tracker.moveIssue(d.id, "in_review");
    } catch (e) {
      fehler.push({ id: d.id, art: t("nichtBewegt"), grund: e.message, kommando: `node .claude/kit/board.mjs issue move ${d.id} in_review` });
    }
  }
  return { ...auswertung, fehler };
}
