/**
 * derived-from-report.mjs — Trockenlauf: naechster Vorfahr je Karte (Issue #364).
 *
 * Das Kit schreibt die Abstammung als Body-Zeilen `Plan: Issue #M` und
 * `Fachliche Quelle: Issue #N`. Dieses Werkzeug liest sie zurueck und weist aus,
 * welche Karte welchen Verweis bekaeme — als Vorbereitung einer moeglichen
 * Nachpflege des Bestands.
 *
 * ES SCHREIBT NICHTS, und das bleibt so, solange es keinen Schreibpfad fuer
 * `derivedFrom` gibt: Das Feld wird beim Anlegen gesetzt und danach nie geaendert.
 *
 * Zwei Fundorte, nach Dokumenttyp — das ist die Regel, nicht der Sonderfall:
 *   - Arbeitspaket        -> Abschnitt `## Kontext`
 *   - `[Plan]`-Dokument   -> Kopfbereich vor der ersten `##`-Ueberschrift
 * Plandokumente haben gar keinen Kontext-Abschnitt; ein Leser, der nur ihn kennt,
 * uebersaehe jede Zwischenstufe der Kette.
 *
 * Die Fence-Regel gilt an beiden Fundorten und an beiden Enden (Issue #308). Eine
 * gefencte Zeile existiert fuer diesen Leser gar nicht — auch nicht als
 * `fehlplatziert`.
 *
 * Warum es in tools/ liegt und nicht in kit/: Es importiert `kontextGrenzen` und
 * `fenceLauf` aus `kit/board.mjs` und ist damit bewusst NICHT eigenstaendig portabel.
 * Eine Datei in kit/ muesste das sein (Versionsstempel, Blob in install.mjs) und
 * braeuchte denselben dynamisch abgefangenen Import, den night.mjs seit #308 traegt —
 * fuer ein Analysewerkzeug der falsche Preis.
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// `istPlan` kommt seit Issue #464 aus board.mjs, wo die Praefix-Form genau einmal
// steht. Vorher lag hier die zweite Fassung derselben Regel.
import { kontextGrenzen, fenceLauf, istPlan } from "../kit/board.mjs";

/**
 * Die moeglichen Zustaende — die einzige Wahrheit darueber.
 *
 * Issue #366 liest diese Liste, um zu pruefen, dass die Doku vollstaendig ist. Wer
 * hier einen Zustand ergaenzt und die Doku vergisst, wird davon rot — waeren die
 * Namen dort fest verdrahtet, bliebe der Test gruen und die Doku still zurueck.
 */
export const ZUSTAENDE = [
  "vorfahr", "keiner", "mehrdeutig", "fehlplatziert", "unbekannt", "selbstverweis",
];

const PLAN_ZEILE = /^Plan: Issue #(\d+)[ \t]*$/;
const FACH_ZEILE = /^Fachliche Quelle: Issue #(\d+)[ \t]*$/;


/**
 * Zeilenenden vereinheitlichen, bevor irgendetwas gelesen wird.
 *
 * Ohne diesen Schritt liefen die zeilenverankerten Ausdruecke bei einem CRLF-Body
 * ins Leere und JEDE Karte fiele stumm auf `keiner` — der Fehler waere an keiner
 * Stelle sichtbar. `kontextGrenzen` setzt einen normalisierten Body ohnehin voraus;
 * board.mjs macht dasselbe vor jedem Parsen (`normalisiereZeilenenden`).
 */
function normalisiere(body) {
  return String(body || "").replaceAll(/\r\n?/g, "\n");
}

/**
 * Grenzen des Kopfbereichs eines Plandokuments: von Anfang bis zur ersten
 * `##`-Ueberschrift AUSSERHALB eines Fence. Gibt es keine, gilt der ganze Text.
 *
 * Die Fence-Bedingung ist nicht kosmetisch: Ein Plan, der das Plan-Format als
 * Beispiel zeigt, traegt `## Ziel` in einem Codeblock — ohne sie endete der
 * Kopfbereich dort und die Kopfzeilen darunter waeren unsichtbar.
 */
function kopfGrenzen(text) {
  const imFence = fenceLauf();
  let offset = 0;
  for (const zeile of text.split("\n")) {
    if (!imFence(zeile) && zeile.startsWith("## ")) return { start: 0, ende: offset };
    offset += zeile.length + 1;
  }
  return { start: 0, ende: text.length };
}

/** Alle Verweisnummern eines Textstuecks, Fences ausgenommen. */
function verweise(stueck) {
  const imFence = fenceLauf();
  const plan = [];
  const fach = [];
  for (const zeile of stueck.split("\n")) {
    if (imFence(zeile)) continue;
    const p = zeile.match(PLAN_ZEILE);
    if (p) plan.push(Number(p[1]));
    const f = zeile.match(FACH_ZEILE);
    if (f) fach.push(Number(f[1]));
  }
  return { plan, fach };
}

/**
 * Entscheidet ueber eine Gruppe gleichartiger Verweise. Gleichheit ist numerisch —
 * `#07` und `#7` sind derselbe Wert, wie `parseDeps` es mit `Number(...)` und `Set`
 * haelt. Mehrfach dieselbe Nummer ist kein Widerspruch.
 */
function ausGruppe(nummern) {
  const eindeutig = [...new Set(nummern)];
  if (eindeutig.length === 1) return { zustand: "vorfahr", vorfahr: eindeutig[0] };
  return { zustand: "mehrdeutig", vorfahr: null };
}

/**
 * Der naechste Vorfahr einer einzelnen Karte.
 *
 * Vorrang gilt VOR Mehrdeutigkeit: Gibt es am gueltigen Fundort mindestens eine
 * `Plan:`-Zeile, zaehlen nur die `Plan:`-Zeilen. Gefragt ist der naechste Vorfahr,
 * und das Plandokument steht naeher — was in der ferneren Ebene widerspruechlich
 * steht, aendert daran nichts.
 */
export function herkunftAusBody({ id, title, body }) {
  const text = normalisiere(body);
  const grenzen = istPlan(title) ? kopfGrenzen(text) : kontextGrenzen(text);

  // Kein gueltiger Fundort (Arbeitspaket ohne `## Kontext`): Es gibt kein "dort",
  // an dem eine Zeile stehen duerfte. Dann entscheidet allein, ob irgendwo im Body
  // eine steht.
  const drinnen = grenzen ? verweise(text.slice(grenzen.start, grenzen.ende)) : { plan: [], fach: [] };

  if (drinnen.plan.length > 0) return { id, ...ausGruppe(drinnen.plan) };
  if (drinnen.fach.length > 0) return { id, ...ausGruppe(drinnen.fach) };

  // Nichts am gueltigen Fundort: Steht anderswo eine Zeile, ist sie fehlplatziert.
  // Der Rest des Bodys wird dafuer ohne den Fundort betrachtet — sonst zaehlte eine
  // Zeile, die dort korrekt fehlt, doppelt.
  const draussen = grenzen
    ? verweise(text.slice(0, grenzen.start) + "\n" + text.slice(grenzen.ende))
    : verweise(text);
  if (draussen.plan.length > 0 || draussen.fach.length > 0) {
    return { id, zustand: "fehlplatziert", vorfahr: null };
  }
  return { id, zustand: "keiner", vorfahr: null };
}

/**
 * Verschaerft das Ergebnis von `herkunftAusBody` um die beiden Zustaende, die eine
 * einzelne Karte nicht hergibt: Existiert die genannte Nummer am Board, und zeigt
 * sie auf die eigene Karte?
 *
 * Warum das hier schon geprueft wird, obwohl der Server es beim Schreiben auch tut:
 * Der Server prueft pro Karte im Moment des Schreibens. Der Trockenlauf soll VORHER
 * und ueber den ganzen Bestand sagen, wie viele Karten scheitern wuerden. Ein
 * Migrationslauf, der bei Karte 17 von 44 auf einen unbekannten Verweis laeuft, ist
 * der teure Weg zu derselben Erkenntnis.
 *
 * ZYKLEN werden bewusst NICHT geprueft. Der Server tut das beim Schreiben, und ohne
 * Schreibpfad gibt es hier nichts zu verhindern; ein zweiter Zyklus-Erkenner waere
 * eine zweite Wahrheit ueber dieselbe Regel.
 */
export function bestandsPruefung(karten) {
  // Beide Seiten auf Zahlen bringen: `board.mjs issue list` liefert `id` als String
  // ("id": "364"), der Leser eine Zahl. Ein Set aus rohen ids meldete jede Karte als
  // `unbekannt` — und der Fixture-Test faenge das nur zufaellig.
  const vorhanden = new Set(karten.map((k) => Number(k.id)));

  return karten.map((k) => {
    const r = herkunftAusBody(k);
    if (r.zustand !== "vorfahr") return r;
    // `gelesen` traegt, worauf gezeigt wurde — nur bei den beiden Fehlzustaenden.
    // Bei `vorfahr` steht der Wert schon in `vorfahr`, ein zweites Feld waere eine
    // zweite Wahrheit.
    if (r.vorfahr === Number(k.id)) {
      return { id: r.id, zustand: "selbstverweis", vorfahr: null, gelesen: r.vorfahr };
    }
    if (!vorhanden.has(r.vorfahr)) {
      return { id: r.id, zustand: "unbekannt", vorfahr: null, gelesen: r.vorfahr };
    }
    return r;
  });
}

// --- CLI ---

const HELP = [
  "derived-from-report.mjs — Trockenlauf: naechster Vorfahr je Karte",
  "",
  "Nutzung:",
  "  node .claude/kit/board.mjs issue list | node tools/derived-from-report.mjs",
  "  node .claude/kit/board.mjs issue list | node tools/derived-from-report.mjs --json",
  "  node tools/derived-from-report.mjs --help",
  "",
  "Liest ein JSON-Array von Karten (id, title, body) von stdin. Ohne Flag eine",
  "lesbare Zusammenfassung, mit --json die Rohdaten fuer eine spaetere Migration.",
  "",
  "Das Werkzeug SCHREIBT NICHTS — weder ans Board noch ins Dateisystem.",
  `Zustaende: ${ZUSTAENDE.join(", ")}`,
  "",
].join("\n");

/** Fehler mit Meldung statt Stacktrace: ein Tippfehler in der Pipe ist kein Absturz. */
class ReportError extends Error {}

function leseKarten(roh) {
  let daten;
  try {
    daten = JSON.parse(roh);
  } catch (e) {
    throw new ReportError(`stdin ist kein gueltiges JSON: ${e.message}`);
  }
  if (!Array.isArray(daten)) {
    throw new ReportError("stdin muss ein JSON-Array von Karten sein (aus `board.mjs issue list`).");
  }
  return daten;
}

function zusammenfassung(bericht) {
  const zaehler = Object.fromEntries(ZUSTAENDE.map((z) => [z, 0]));
  for (const e of bericht) zaehler[e.zustand] = (zaehler[e.zustand] ?? 0) + 1;

  const zeilen = [`Karten: ${bericht.length}`];
  for (const z of ZUSTAENDE) zeilen.push(`  ${z.padEnd(14)} ${zaehler[z]}`);

  // Gemeldet wird, was Aufmerksamkeit braucht. `keiner` gehoert nicht dazu: Eine Karte
  // ohne Verweis ist kein Fehler, sondern der Normalfall fuer alles, was vor der
  // Konvention entstanden ist.
  const auffaellig = bericht.filter((e) => e.zustand !== "vorfahr" && e.zustand !== "keiner");
  if (auffaellig.length > 0) {
    zeilen.push("", "Zu klaeren:");
    for (const e of auffaellig) {
      const worauf = e.gelesen === undefined ? "" : ` (gelesen: #${e.gelesen})`;
      zeilen.push(`  #${e.id}  ${e.zustand}${worauf}`);
    }
  }
  return zeilen.join("\n") + "\n";
}

export async function main(argv) {
  // --help zuerst: Es darf nicht an einer fehlenden Pipe haengenbleiben.
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  try {
    const bericht = bestandsPruefung(leseKarten(readFileSync(0, "utf-8")));
    process.stdout.write(argv.includes("--json")
      ? JSON.stringify(bericht, null, 2) + "\n"
      : zusammenfassung(bericht));
    return 0;
  } catch (e) {
    if (e instanceof ReportError) {
      process.stderr.write(`Fehler: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

// Dieselbe Weiche wie in tools/migrate-issues.mjs: realpathSync, weil Node fuer
// import.meta.url Symlinks aufloest (macOS: /var -> /private/var).
let runAsCli = false;
if (process.argv[1]) {
  try {
    runAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { /* argv[1] nicht aufloesbar -> kein CLI-Start */ }
}
if (runAsCli) {
  process.exitCode = await main(process.argv.slice(2));
}
