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

import { kontextGrenzen, fenceLauf } from "../kit/board.mjs";

/**
 * Die moeglichen Zustaende. In diesem Issue entstehen die ersten vier; `unbekannt`
 * und `selbstverweis` brauchen die ganze Kartenmenge und kommen mit Issue #365 dazu.
 */
export const ZUSTAENDE = ["vorfahr", "keiner", "mehrdeutig", "fehlplatziert"];

const PLAN_ZEILE = /^Plan: Issue #(\d+)[ \t]*$/;
const FACH_ZEILE = /^Fachliche Quelle: Issue #(\d+)[ \t]*$/;

// Dieselbe Praefix-Konvention wie in skills/issue-review/SKILL.md: unabhaengig von
// Gross-/Kleinschreibung, nach optional fuehrendem Leerraum, auch ohne Leerzeichen
// nach `]`. Ein Praefix mitten im Titel zaehlt nicht — deshalb `^`.
const PLAN_PRAEFIX = /^\s*\[plan\]/i;

/**
 * Zeilenenden vereinheitlichen, bevor irgendetwas gelesen wird.
 *
 * Ohne diesen Schritt liefen die zeilenverankerten Ausdruecke bei einem CRLF-Body
 * ins Leere und JEDE Karte fiele stumm auf `keiner` — der Fehler waere an keiner
 * Stelle sichtbar. `kontextGrenzen` setzt einen normalisierten Body ohnehin voraus;
 * board.mjs macht dasselbe vor jedem Parsen (`normalisiereZeilenenden`).
 */
function normalisiere(body) {
  return String(body || "").replace(/\r\n?/g, "\n");
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
  const grenzen = PLAN_PRAEFIX.test(String(title || "")) ? kopfGrenzen(text) : kontextGrenzen(text);

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
