/**
 * board/grooming.mjs — die mechanischen Fragen des Grooming eines Fachplans (Issue #1511,
 * Plan #1510 A1, A2, A4, A5, E2–E4, E6, E7, E13): welche Fragen unter `## Offene Fragen an
 * den PO` offen sind, ob `/groom` beginnen darf, welcher Kommentar die Stopp-Frage traegt und
 * wie der Vermerk „Keine“ lautet.
 *
 * Reine Funktionen ohne Board-Zugriff; den Zugriff traegt allein der Einstieg in
 * kit/board.mjs. Sie lesen nur und aendern keine Labels (A4). Empfehlung, Einarbeitung und
 * Folgefragen sind Urteil der Session und stehen im Skill, nicht hier (A1).
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { ABSCHNITT_ZEILE, fenceLauf, istFachlich, normalisiereZeilenenden } from "./dokumente.mjs";
import { erkenneLabel, erkenneMarker, labelName, markerName, praefix, prozessSprache, text,
  ueberschriftZeile } from "./namen.mjs";

// Die Texte an den Menschen liegen unter kit/texte/board-grooming.mjs.
import { TEXTE } from "../texte/board-grooming.mjs";

export { TEXTE };

const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

// Der Anker des Halt-Kommentars der Nacht-Kette, wie kit/night/kette.mjs ihn als
// KETTE_HALT_ANKER schreibt — nur deutsch, das Register kennt ihn noch nicht. Ein Import aus
// kit/night/ koppelte das Board-Werkzeug an den Nacht-Runner; der Gleichlauf steht als Test
// in test/board-grooming-einstieg.test.mjs.
export const KETTE_HALT_ANKER = "## Kette angehalten";

// Der Vermerk, wie `offeneFragenGrund` in kit/night/kette.mjs ihn als erledigt liest
// (`KEINE_PO_FRAGEN`): erste nichtleere Zeile, ein Listenstrich davor erlaubt.
const VERMERK = /^(?:[-*+]\s+)?Keine/;

// Eine Frage: Listenelement oberster Ebene, also ohne Einrueckung (E3).
const FRAGE = /^(?:\d+\.|[-*+])[ \t]+(\S.*)$/;

// Eine Antwortzeile nach E2: nach Einrueckung und optionalem `**` `Antwort (<Urheber>, <Datum>):`.
const ANTWORT = /^\s*(?:\*\*)?Antwort \(\s*[^,()\s][^,()]*,\s*\d{4}-\d{2}-\d{2}\s*\):/;

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Die Zeilen des Abschnitts `## Offene Fragen an den PO` (beide Sprachen) mit ihrer Lage zum
 * Code-Fence, oder null ohne Abschnitt. Dieselbe Fence-Auslegung wie `zerlegeAbschnitte`;
 * anders als dort bleiben Codezeilen erhalten, weil sie zum Text einer Frage gehoeren koennen.
 */
function abschnittZeilen(body) {
  const kopf = ueberschriftZeile("poFragen");
  const imFence = fenceLauf();
  let zeilen = null;
  for (const zeile of normalisiereZeilenenden(body).split("\n")) {
    const fence = imFence(zeile);
    if (zeilen === null) {
      if (!fence && kopf.test(zeile)) zeilen = [];
      continue;
    }
    if (!fence && ABSCHNITT_ZEILE.test(zeile)) break;
    zeilen.push({ zeile, fence });
  }
  return zeilen;
}

/**
 * Der Abschnitt `## Offene Fragen an den PO` eines Fachplans, zerlegt nach E2 bis E4:
 * `{ vermerk, fragen: [{ nr, text, entschieden, antwortZeile }], ungegliedert, offen }`.
 *
 * `vermerk` ist die erste nichtleere Zeile, wenn sie mit „Keine“ beginnt, sonst null. Eine
 * Frage ist jedes Listenelement oberster Ebene ausserhalb eines Code-Fence; eingerueckte
 * Zeilen und Codezeilen gehoeren zur Frage davor, `text` traegt sie bis zur Antwortzeile.
 * `nr` zaehlt die Fragen ab 1. Nicht eingerueckter Text ohne Listenform steht absatzweise in
 * `ungegliedert`. `offen` zaehlt die Fragen ohne Antwortzeile.
 */
export function fragenLesen(body) {
  const zeilen = abschnittZeilen(body);
  if (zeilen === null) return { vermerk: null, fragen: [], ungegliedert: [], offen: 0 };

  const leser = new AbschnittLeser();
  for (const { zeile, fence } of zeilen) leser.zeile(zeile, fence);
  leser.absatzSchliessen();

  const fragen = leser.fragen.map(({ nr, zeilen: z, antwortZeile }) => ({
    nr, text: z.join("\n").trimEnd(), entschieden: antwortZeile !== null, antwortZeile,
  }));
  return { vermerk: leser.vermerk, fragen, ungegliedert: leser.ungegliedert, offen: fragen.filter((f) => !f.entschieden).length };
}

/** Der Zustand beim zeilenweisen Lesen des Abschnitts fuer `fragenLesen`. */
class AbschnittLeser {
  vermerk = null;
  fragen = [];
  ungegliedert = [];
  frage = null;
  absatz = null;
  ersteGesehen = false;

  zeile(zeile, fence) {
    const leer = zeile.trim() === "";
    if (!fence && !leer && !this.ersteGesehen) {
      this.ersteGesehen = true;
      if (VERMERK.test(zeile.trim())) {
        this.vermerk = zeile.trim();
        return;
      }
    }
    if (fence || leer || /^\s/.test(zeile)) {
      if (leer) this.absatzSchliessen();
      if (this.frage) this.folgeZeile(zeile, fence);
      return;
    }
    const m = FRAGE.exec(zeile);
    if (m) {
      this.absatzSchliessen();
      this.frage = { nr: this.fragen.length + 1, zeilen: [m[1].trimEnd()], antwortZeile: null };
      this.fragen.push(this.frage);
      return;
    }
    this.frage = null;
    this.absatz ??= [];
    this.absatz.push(zeile.trim());
  }

  /** Eine Folgezeile der Frage: die erste Antwortzeile ausserhalb eines Fence beendet ihren Text. */
  folgeZeile(zeile, fence) {
    if (this.frage.antwortZeile !== null) return;
    if (!fence && ANTWORT.test(zeile)) this.frage.antwortZeile = zeile.trim();
    else this.frage.zeilen.push(zeile.trim());
  }

  absatzSchliessen() {
    if (this.absatz) this.ungegliedert.push(this.absatz.join("\n"));
    this.absatz = null;
  }
}

/** Die Labelnamen einer Karte, ob als Text oder als `{ name }`. */
const labelSachen = (labels) => new Set((labels ?? []).map((l) => erkenneLabel(typeof l === "string" ? l : l?.name)));

/**
 * Darf `/groom` an dieser Karte beginnen? `{ start, grund }`, bei einer Abweisung dazu
 * `meldung`, bei `nichts-offen` mit offener Frage unter dem Vermerk dazu `hinweis` (E13).
 * Die Gruende in dieser Reihenfolge: `kein-fachplan`, `unbeaufsichtigt` (E7), `ungeprueft`,
 * `nichts-offen`. `env` ist die Umgebung des Aufrufs, in der Regel `process.env`.
 */
export function groomEinstieg(issue, env = {}) {
  const id = issue?.id ?? "?";
  const sprache = prozessSprache();
  if (!istFachlich(issue?.title ?? "")) {
    return abweisung("kein-fachplan", t("keinFachplan", { id, praefix: praefix("fachlich", sprache) }));
  }
  if (String(env?.KIT_AGENT_MODEL ?? "").trim() !== "") {
    return abweisung("unbeaufsichtigt", t("unbeaufsichtigt"));
  }
  const sachen = labelSachen(issue.labels);
  const klaeren = labelName("klaeren", sprache);
  if (!sachen.has("reviewFertig") && !sachen.has("klaeren")) {
    return abweisung("ungeprueft", t("ungeprueft", { id, fertig: labelName("reviewFertig", sprache), klaeren }));
  }
  const fragen = fragenLesen(issue.body);
  if (fragen.vermerk !== null && !sachen.has("klaeren")) {
    const e = abweisung("nichts-offen", t("nichtsOffen", { id, klaeren }));
    const offen = fragen.fragen.filter((f) => !f.entschieden);
    if (offen.length > 0) {
      const liste = offen.map((f) => `${f.nr}. ${f.text.split("\n")[0]}`).join("; ");
      e.hinweis = t("vermerkWiderspruch", { zahl: offen.length, liste });
    }
    return e;
  }
  return { start: true, grund: null };
}

const abweisung = (grund, meldung) => ({ start: false, grund, meldung });

/** Die erste nichtleere Zeile eines Kommentars. */
const ersteZeile = (body) => String(body ?? "").split(/\r\n|\r|\n/).find((z) => z.trim() !== "") ?? "";

/**
 * Der Kommentar mit der Stopp-Frage (A5, E6): der juengste, dessen erste Zeile der Anker
 * `## Einarbeitung, Runde <n>` ist (beide Sprachen, ueber das Namensregister). Ergebnis
 * `{ kommentar: { id, datum, text }, grund: null }`, sonst `{ kommentar: null, grund }` —
 * ohne einen solchen Kommentar oder wenn juenger als er ein `## Kette angehalten` steht.
 * Die Kommentare kommen in der Reihenfolge des Boards, der juengste zuletzt.
 */
export function stoppKommentar(comments) {
  const liste = (comments ?? []).map((k) => (typeof k === "string" ? { id: null, createdAt: null, body: k } : k ?? {}));
  let einarbeitung = -1;
  let halt = -1;
  liste.forEach((k, i) => {
    const zeile = ersteZeile(k.body);
    if (erkenneMarker(zeile) === "einarbeitungRunde") einarbeitung = i;
    else if (zeile.trimStart().startsWith(KETTE_HALT_ANKER)) halt = i;
  });
  if (einarbeitung === -1) {
    return { kommentar: null, grund: t("keinEinarbeitungsKommentar", { anker: markerName("einarbeitungRunde", prozessSprache()) }) };
  }
  if (halt > einarbeitung) return { kommentar: null, grund: t("ketteJuenger", { anker: KETTE_HALT_ANKER }) };
  const k = liste[einarbeitung];
  return { kommentar: { id: k.id ?? null, datum: k.createdAt ?? null, text: String(k.body) }, grund: null };
}

/**
 * Der Vermerk „Keine“ nach E4, den die Session woertlich als erste Zeile des Abschnitts
 * uebernimmt. Deutsch in jedem Projekt: `offeneFragenGrund` in kit/night/kette.mjs erkennt nur
 * „Keine“. `datum` als `JJJJ-MM-TT` oder als Date.
 */
export function vermerkZeile(zahl, datum) {
  if (!Number.isInteger(zahl) || zahl < 1) throw new Error(`vermerkZeile: Zahl der Fragen muss eine ganze Zahl ab 1 sein, nicht ${zahl}`);
  const tag = datum instanceof Date ? datum.toISOString().slice(0, 10) : String(datum ?? "");
  if (!DATUM.test(tag)) throw new Error(`vermerkZeile: Datum muss JJJJ-MM-TT sein, nicht ${datum}`);
  return zahl === 1
    ? `Keine. Die 1 Frage hat der PO am ${tag} entschieden, die Antwort steht unter der Frage.`
    : `Keine. Die ${zahl} Fragen hat der PO am ${tag} entschieden, die Antworten stehen unter der jeweiligen Frage.`;
}
