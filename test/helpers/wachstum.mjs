// Die Wachstumsprobe (Issue #1080).
//
// Die Laufzeitproben der Suite sollen katastrophales Backtracking erkennen, also
// ueberlineares Wachstum. Frueher prueften sie dafuer eine absolute Grenze von
// 100 ms. Unter Last — seit #1071 fahren die Pruefgruppen gleichzeitig, und die
// Maschine lastet sich selbst aus — riss diese Grenze zufaellig: In der Nacht zum
// 30.09.2026 kippte bei #1065 in jedem Abschlusslauf ein anderer dieser Tests,
// jeder einzeln gruen.
//
// Gemessen wird deshalb das Verhaeltnis: dieselbe Funktion bei Eingabe n/8 und n,
// jeweils das Minimum mehrerer Laeufe. Last verlangsamt beide Messungen, das
// Verhaeltnis bleibt; das Minimum filtert Lastspitzen heraus. Linear ergibt etwa
// 8, quadratisch etwa 64 — die Schranke 32 liegt dazwischen.
//
// Zwei Vorkehrungen gegen Rauschen, beide aus dem ersten vollen Lauf unter Last:
// - Jede Messung wiederholt den Aufruf so oft, dass die KLEINE Messung mindestens
//   MINDEST_MS dauert. Eine Messung von 0,1 ms ist unter Last fast nur Unterbrechung
//   (dort ergab eine lineare Funktion 45,8). Die grosse Messung nimmt dieselbe Zahl.
// - Klein und gross werden abwechselnd gemessen, damit beide dieselbe Last sehen
//   (dort ergab eine quadratische Funktion nur 26,5).
//
// Der Boden: Rot wird eine Probe nur, wenn die grosse Messung mindestens BODEN_MS
// dauert UND das Wachstum ueberlinear ist. Das Verhaeltnis allein trug nicht: Im
// vollen gleichzeitigen Prueflauf teilen sich achtzehn Gruppen die Caches, die grosse
// Eingabe faellt heraus, die kleine nicht — lineare Regex-Proben kamen bei 256 KiB auf
// Verhaeltnisse von 35 bis 124, bei hoechstens 7 ms je Aufruf. Katastrophales
// Backtracking dauert bei diesen Groessen dagegen Sekunden (gemessen 18 bis 61 s, siehe
// die Kommentare der Proben). 250 ms liegen dazwischen, mit Abstand zu beiden Seiten.
// Eine milde Quadratik von wenigen Millisekunden faellt nicht mehr auf; die alte Grenze
// von 100 ms sah sie auch nicht.

import assert from "node:assert/strict";

/** Um diesen Faktor ist die grosse Eingabe groesser als die kleine. */
export const FAKTOR = 8;
/** Hoechstes erlaubtes Verhaeltnis der Laufzeiten; linear ~8, quadratisch ~64. */
export const SCHRANKE = 32;
/** Unter dieser Dauer der grossen Messung (je Aufruf) zaehlt das Verhaeltnis nicht. */
export const BODEN_MS = 250;
/** Wiederholungen je Groesse; gezaehlt wird das Minimum. */
export const WIEDERHOLUNGEN = 7;
/** So lange dauert die kleine Messung mindestens; dafuer wird der Aufruf wiederholt. */
const MINDEST_MS = 2;
/** Hoechstens so oft wird ein Aufruf je Messung wiederholt. */
const HOECHSTENS_AUFRUFE = 4096;
/** Braucht ein Lauf laenger, wird nicht wiederholt — er ist ohnehin ein Befund. */
const ABBRUCH_MS = 2000;

function dauerMs(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

function mehrfach(fn, aufrufe) {
  return () => {
    for (let i = 0; i < aufrufe; i++) fn();
  };
}

/** So viele Aufrufe, dass `fn` zusammen mindestens MINDEST_MS braucht. */
function kalibriere(fn) {
  let aufrufe = 1;
  while (aufrufe < HOECHSTENS_AUFRUFE && dauerMs(mehrfach(fn, aufrufe)) < MINDEST_MS) aufrufe *= 2;
  return aufrufe;
}

/**
 * Misst `lauf` an `bau(gross / FAKTOR)` und `bau(gross)`. Die Eingaben entstehen
 * vor der Messung, gemessen wird nur `lauf`.
 */
export function wachstum(lauf, bau, { gross, wiederholungen = WIEDERHOLUNGEN } = {}) {
  if (!Number.isFinite(gross) || gross < FAKTOR) throw new Error(`gross muss mindestens ${FAKTOR} sein`);
  const klein = bau(Math.floor(gross / FAKTOR));
  const voll = bau(gross);
  const aufrufe = kalibriere(() => lauf(klein));
  const messeKlein = mehrfach(() => lauf(klein), aufrufe);
  const messeGross = mehrfach(() => lauf(voll), aufrufe);
  let kleinMs = Infinity;
  let grossMs = Infinity;
  for (let i = 0; i < wiederholungen; i++) {
    kleinMs = Math.min(kleinMs, dauerMs(messeKlein));
    const g = dauerMs(messeGross);
    grossMs = Math.min(grossMs, g);
    if (g > ABBRUCH_MS) break;
  }
  // Die Dauern gelten je Aufruf, damit Meldung und Boden dieselbe Einheit sprechen wie vorher.
  kleinMs /= aufrufe;
  grossMs /= aufrufe;
  return { kleinMs, grossMs, aufrufe, verhaeltnis: grossMs / Math.max(kleinMs, 1e-6) };
}

/** Das Urteil zu einer Messung aus `wachstum`. */
export function waechstLinear({ grossMs, verhaeltnis }) {
  return grossMs < BODEN_MS || verhaeltnis < SCHRANKE;
}

/** Misst und prueft in einem; die Meldung nennt beide Dauern und das Verhaeltnis. */
export function pruefeLinear(name, lauf, bau, optionen) {
  const e = wachstum(lauf, bau, optionen);
  assert.ok(
    waechstLinear(e),
    `${name}: ${e.kleinMs.toFixed(2)} ms -> ${e.grossMs.toFixed(2)} ms bei ${FAKTOR}-facher Eingabe, ` +
      `Verhaeltnis ${e.verhaeltnis.toFixed(1)} — erwartet unter ${SCHRANKE}`,
  );
  return e;
}
