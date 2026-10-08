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

const OFFEN = new Set(["backlog", "ready", "in_progress"]);
const ERLEDIGT = new Set(["in_review", "done"]);
const UEBERHOLT_ANKER = "Ueberholt durch Plan #";
const NICHT_FESTSTELLBAR = "nicht feststellbar";
const SPALTEN_NICHT_LESBAR = `${NICHT_FESTSTELLBAR}: Spalten der Pakete nicht lesbar`;

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
  if (pakete.length === 0) return { durch: false, fehlend, grund: `Plan #${planNr} hat keine Pakete (noch nicht geschnitten)` };
  if (fehlend.length > 0) {
    const liste = fehlend.map((k) => `#${k.id} in ${spaltenName(k.spalte)}`).join(", ");
    return { durch: false, fehlend, grund: `Plan #${planNr} nicht durch: ${liste}` };
  }
  if (!pakete.some((k) => ERLEDIGT.has(k.spalte))) return { durch: false, fehlend, grund: SPALTEN_NICHT_LESBAR };
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
  const ueberholt = (kommentare ?? []).some((k) => String(typeof k === "string" ? k : k?.body ?? "").trimStart().startsWith(UEBERHOLT_ANKER));
  return ueberholt ? null : `Plan #${nr} ohne Vermerk „${UEBERHOLT_ANKER}…“ — ${stand.grund}`;
}

/** Die fachliche Anforderung hinter dem Plan, oder null, wenn der Plan keine nennt (A6, E3, E4). */
async function anforderungAuswerten(karten, planNr, planKarte, stand, kommentareVon) {
  const quelle = herkunftNummern(planKarte.body, "Fachliche Quelle")[0];
  if (quelle === undefined) return null;
  const karte = karten.find((k) => k.id === quelle);
  const bleibt = (grund) => dokument(karte, quelle, "fachlich", "bleibt", grund);
  if (!karte) return bleibt(`${NICHT_FESTSTELLBAR}: #${quelle} steht in keiner Spalte des Boards`);
  if (!istFachlich(karte.titel)) return bleibt(`kein Ursprungsdokument: #${quelle} trägt kein Präfix [Fachlich]`);
  const bereits = lagBereits(karte.spalte);
  if (bereits) return dokument(karte, quelle, "fachlich", bereits, null);
  if (!stand.durch) return bleibt(stand.grund);
  if (karte.spalte === null) return bleibt(`${NICHT_FESTSTELLBAR}: Spalte von #${quelle} nicht lesbar`);
  const weitere = karten.filter((k) => k.id !== planNr && istPlan(k.titel)
    && herkunftNummern(k.body, "Fachliche Quelle").includes(quelle)).sort(nachNummer);
  const halten = [];
  for (const p of weitere) {
    try {
      const grund = await haltenderPlan(karten, p.id, kommentareVon);
      if (grund) halten.push(grund);
    } catch (e) {
      return bleibt(`${NICHT_FESTSTELLBAR}: Kommentare von Plan #${p.id} nicht lesbar (${e.message})`);
    }
  }
  if (halten.length > 0) return bleibt(halten.join("; "));
  return dokument(karte, quelle, "fachlich", "wandert", "alle Pläne der Anforderung sind durch");
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
  if (!planKarte) return leer(`${NICHT_FESTSTELLBAR}: Plan #${plan} steht in keiner Spalte des Boards`);
  if (!istPlan(planKarte.titel)) {
    const grund = `${NICHT_FESTSTELLBAR}: #${plan} trägt kein Präfix [Plan]`;
    return leer(grund, [dokument(planKarte, plan, "plan", "bleibt", grund)]);
  }
  const stand = planStand(karten, plan);
  const bereits = lagBereits(planKarte.spalte);
  let planDok;
  if (bereits) planDok = dokument(planKarte, plan, "plan", bereits, null);
  else if (!stand.durch) planDok = dokument(planKarte, plan, "plan", "bleibt", stand.grund);
  else if (planKarte.spalte === null) planDok = dokument(planKarte, plan, "plan", "bleibt", `${NICHT_FESTSTELLBAR}: Spalte von #${plan} nicht lesbar`);
  else planDok = dokument(planKarte, plan, "plan", "wandert", "alle Pakete liegen in In review oder Done");
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
    return { plan: ohneFuehrendeNullen(planNr), durch: false, grund: `${NICHT_FESTSTELLBAR}: Karten nicht lesbar (${e.message})`, fehlend: [], dokumente: [] };
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
      fehler.push({ id: d.id, art: "Dokument nicht bewegt", grund: e.message, kommando: `node .claude/kit/board.mjs issue move ${d.id} in_review` });
    }
  }
  return { ...auswertung, fehler };
}
