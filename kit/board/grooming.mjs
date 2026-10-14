/**
 * board/grooming.mjs — die mechanischen Fragen des Grooming eines Fachplans (Issue #1511,
 * Plan #1510 A1, A2, A4, A5, E2–E4, E6, E7, E13): welche Fragen unter `## Offene Fragen an
 * den PO` offen sind, ob `/groom` beginnen darf, welcher Kommentar die Stopp-Frage traegt und
 * wie der Vermerk „Keine“ lautet. Dazu (Issue #1512, Plan #1510 E8, E9) die Pruefung eines neuen
 * Body gegen den alten und der Vergleich von Kriterien und Nicht-Zielen. Dazu (Issue #1592,
 * Plan #1588 A8, E8) der Einstieg einer pflichtigen Karte ohne Szenario und der Vergleich der
 * Szenarien.
 *
 * Reine Funktionen ohne Board-Zugriff; den Zugriff traegt allein der Einstieg in
 * kit/board.mjs, `issue questions` (Issue #1555, Plan #1548 E8). Sie lesen nur und aendern keine Labels (A4). Empfehlung, Einarbeitung und
 * Folgefragen sind Urteil der Session und stehen im Skill, nicht hier (A1).
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { ABSCHNITT_ZEILE, CHECK_FORM_ABSCHNITTE, fenceLauf, istFachlich, normalisiereZeilenenden,
  zerlegeAbschnitte } from "./dokumente.mjs";
import { erkenneLabel, erkenneMarker, erkenneUeberschrift, kanonischeUeberschrift, labelName, markerName,
  markerWerte, praefix, prozessSprache, text, ueberschriftName, ueberschriftZeile } from "./namen.mjs";

// Die Texte an den Menschen liegen unter kit/texte/board-grooming.mjs.
import { TEXTE } from "../texte/board-grooming.mjs";
import { szenarienLesen, szenarienPflicht, szenarienVerstoss } from "./szenarien.mjs";

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
 * Die Zeilen des Abschnitts mit der Ueberschrift `sache` (beide Sprachen) mit ihrer Lage zum
 * Code-Fence, oder null ohne Abschnitt. Dieselbe Fence-Auslegung wie `zerlegeAbschnitte`;
 * anders als dort bleiben Codezeilen erhalten, weil sie zum Text einer Frage gehoeren koennen.
 */
function abschnittZeilen(body, sache) {
  const kopf = ueberschriftZeile(sache);
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
 *
 * `sache` ist der Name der Ueberschrift im Register; ohne ihn die offenen Fragen an den PO.
 * Den geklaerten Stand einer Idee aus /triage liest derselbe Leser mit `geklaerterStand`
 * (Issue #1627, Plan #1623 A5).
 */
export function fragenLesen(body, sache = "poFragen") {
  const zeilen = abschnittZeilen(body, sache);
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
 *
 * Steht der Vermerk, ist die Karte aber ab dem Stichtag `szenarienAb` aus `config` pflichtig
 * und traegt kein vollstaendiges Szenario, beginnt der Ablauf doch: `start: true` mit dem
 * Grund `szenarien-fehlen` und einer `meldung` (Issue #1592, Plan #1588 A8, E13). Altbestand
 * unter dem Stichtag oder ohne Stichtag bleibt bei `nichts-offen`.
 */
export function groomEinstieg(issue, env = {}, config = {}) {
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
    if (szenarienPflicht(id, config) === true && !szenarienVollstaendig(issue.body)) {
      return { start: true, grund: "szenarien-fehlen", meldung: t("szenarienFehlen", { id }) };
    }
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

/** Ob der Body mindestens ein vollstaendiges Szenario traegt (A3). */
export const szenarienVollstaendig = (body) => szenarienLesen(body ?? "").szenarien.some((s) => s.vollstaendig);

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

// --- Body-Pruefung und Vergleich (Issue #1512) ------------------------------------------

// Die Kennzeichnungszeilen, die ein neuer Body behalten muss (E8 a).
const KENNZEICHNUNGEN = ["autorModell", "fachplanReview", "vorlage", "ereignis"];

// Ein Vermerk „Keine“ an anderer Stelle als der ersten Zeile, als Absatz oder Listenelement.
const VERMERK_ANFANG = /^Keine\b/;

// Die Zahl der Fragen im Vermerk, wie `vermerkZeile` sie schreibt.
const VERMERK_ZAHL = /(?<!\d)(\d+) Frage/;

/** Die erste Zeile einer Frage, als Name in einer Meldung. */
const frageName = (f) => f.text.split("\n")[0];

/**
 * Prueft einen neuen Fachplan-Body gegen den alten nach E8: `{ ok, verstoesse: [{ regel,
 * meldung }] }`. Die Regeln in dieser Reihenfolge: `kennzeichnung` (a), `antwort` (b),
 * `fragenzahl` (c), `vermerk` (d), `pflichtabschnitt` (e), `szenarien` (f, Issue #1626: traegt
 * der neue Body den Abschnitt Szenarien, muss er `szenarienVerstoss` genuegen). Eine entschiedene Frage findet sich
 * im neuen Body ueber ihren Text, sonst ueber ihre Nummer — eine vorangestellte Stopp-Frage
 * verschiebt die Nummern. Pflichtabschnitte zaehlen, wenn der alte Body sie trug.
 */
export function koerperPruefen(alt, neu) {
  const verstoesse = [
    ...kennzeichnungVerstoesse(alt, neu),
    ...fragenVerstoesse(fragenLesen(alt), fragenLesen(neu)),
    ...vermerkVerstoesse(neu),
    ...abschnittVerstoesse(alt, neu),
    ...szenarienVerstoesse(neu),
  ];
  return { ok: verstoesse.length === 0, verstoesse };
}

const verstoss = (regel, schluessel, werte) => ({ regel, meldung: t(schluessel, werte) });

function kennzeichnungVerstoesse(alt, neu) {
  const verstoesse = [];
  for (const sache of KENNZEICHNUNGEN) {
    const neuWerte = new Set(markerWerte(neu, sache).map((w) => w.trim()));
    for (const wert of markerWerte(alt, sache).map((w) => w.trim())) {
      if (neuWerte.has(wert)) continue;
      verstoesse.push(verstoss("kennzeichnung", "kennzeichnung", { zeile: `${markerName(sache, prozessSprache())} ${wert}` }));
    }
  }
  return verstoesse;
}

function fragenVerstoesse(alt, neu) {
  const verstoesse = [];
  for (const frage of alt.fragen.filter((f) => f.entschieden)) {
    const gegenstueck = neu.fragen.find((f) => f.text === frage.text) ?? neu.fragen.find((f) => f.nr === frage.nr);
    if (!gegenstueck?.entschieden) {
      verstoesse.push(verstoss("antwort", "antwortOffen", { frage: frageName(frage), antwort: frage.antwortZeile }));
    } else if (gegenstueck.antwortZeile !== frage.antwortZeile) {
      verstoesse.push(verstoss("antwort", "antwortAnders", { frage: frageName(frage), vorher: frage.antwortZeile, nachher: gegenstueck.antwortZeile }));
    }
  }
  if (neu.fragen.length < alt.fragen.length) {
    verstoesse.push(verstoss("fragenzahl", "fragenzahl", { alt: alt.fragen.length, neu: neu.fragen.length }));
  }
  return verstoesse;
}

function vermerkVerstoesse(body) {
  const r = fragenLesen(body);
  const verstoesse = [];
  const verirrt = [
    ...r.ungegliedert.map((absatz) => absatz.split("\n")[0]),
    ...r.fragen.map(frageName),
  ].filter((zeile) => VERMERK_ANFANG.test(zeile));
  for (const zeile of verirrt) verstoesse.push(verstoss("vermerk", "vermerkStelle", { zeile }));
  if (r.vermerk === null) return verstoesse;
  if (r.offen > 0) verstoesse.push(verstoss("vermerk", "vermerkOffen", { zahl: r.offen }));
  const genannt = VERMERK_ZAHL.exec(r.vermerk)?.[1];
  const zahl = r.fragen.length;
  if (genannt === undefined ? zahl > 0 : Number(genannt) !== zahl) {
    verstoesse.push(verstoss("vermerk", "vermerkZahl", { genannt: genannt ?? "-", zahl }));
  }
  return verstoesse;
}

function szenarienVerstoesse(body) {
  if (!szenarienLesen(body).vorhanden) return [];
  const meldung = szenarienVerstoss(body);
  return meldung === null ? [] : [{ regel: "szenarien", meldung }];
}

function abschnittVerstoesse(alt, neu) {
  const titel = (body) => new Set(zerlegeAbschnitte(body).abschnitte.map((a) => a.titel));
  const vorher = titel(alt);
  const nachher = titel(neu);
  const sprache = prozessSprache();
  return CHECK_FORM_ABSCHNITTE.fachlich
    .filter((kanonisch) => vorher.has(kanonisch) && !nachher.has(kanonisch))
    .map((kanonisch) => verstoss("pflichtabschnitt", "pflichtabschnitt", { abschnitt: `## ${ueberschriftName(erkenneUeberschrift(kanonisch), sprache)}` }));
}

// Ein Listenelement oberster Ebene: Gruppe 1 die Nummer einer nummerierten Liste, Gruppe 2 der Text.
const LISTENELEMENT = /^(?:(\d+)\.|[-*+])[ \t]+(\S.*)$/;

/**
 * Die Listenelemente des Abschnitts `sache` (beide Sprachen): `[{ nummer, text }]`, `nummer`
 * null bei einer Aufzaehlung ohne Nummer. Eingerueckte Folgezeilen gehoeren zum Element davor,
 * Leerraum zaehlt beim Vergleich nicht.
 */
function listenElemente(body, sache) {
  const titel = kanonischeUeberschrift(ueberschriftName(sache, "de"));
  const abschnitt = zerlegeAbschnitte(body).abschnitte.find((a) => a.titel === titel);
  const elemente = [];
  for (const zeile of abschnitt?.zeilen ?? []) {
    const m = LISTENELEMENT.exec(zeile);
    if (m) elemente.push({ nummer: m[1] === undefined ? null : Number(m[1]), zeilen: [m[2].trim()] });
    else if (/^\s+\S/.test(zeile) && elemente.length > 0) elemente.at(-1).zeilen.push(zeile.trim());
  }
  return elemente.map(({ nummer, zeilen }) => ({ nummer, text: zeilen.join("\n").replaceAll(/[ \t]+/g, " ") }));
}

/**
 * Vergleicht zwei Listen nach E9: nummeriert (jedes Element beider Seiten traegt eine Nummer)
 * ueber die Nummer, sonst ueber die Position ab 1. `nr` ist die Nummer bzw. die Position.
 */
function listenVergleich(start, ende) {
  const nummeriert = [...start, ...ende].every((e) => e.nummer !== null);
  const schluessel = (liste) => new Map(liste.map((e, i) => [nummeriert ? e.nummer : i + 1, e.text]));
  const vorher = schluessel(start);
  const nachher = schluessel(ende);
  const r = { ergaenzt: [], gestrichen: [], umformuliert: [] };
  for (const [nr, text] of vorher) {
    if (!nachher.has(nr)) r.gestrichen.push({ nr, text });
    else if (nachher.get(nr) !== text) r.umformuliert.push({ nr, vorher: text, nachher: nachher.get(nr) });
  }
  for (const [nr, text] of nachher) if (!vorher.has(nr)) r.ergaenzt.push({ nr, text });
  return r;
}

/**
 * Die Szenarien eines Body als Abbildung Titel → Wortlaut (E8). Leerraum zaehlt nicht; ein
 * zweites Szenario mit demselben Titel heisst `<Titel> (2)`, damit keines verloren geht.
 */
function szenarienNachTitel(body) {
  const gesehen = new Map();
  const ergebnis = new Map();
  for (const { titel, zeilen } of szenarienLesen(body).szenarien) {
    const zahl = (gesehen.get(titel) ?? 0) + 1;
    gesehen.set(titel, zahl);
    const wortlaut = zeilen.map((z) => z.trim().replaceAll(/[ \t]+/g, " ")).join("\n");
    ergebnis.set(zahl === 1 ? titel : `${titel} (${zahl})`, wortlaut);
  }
  return ergebnis;
}

/** Vergleicht die Szenarien zweier Body nach Titel und Wortlaut (E8). */
function szenarienVergleich(start, ende) {
  const vorher = szenarienNachTitel(start);
  const nachher = szenarienNachTitel(ende);
  const r = { ergaenzt: [], gestrichen: [], umformuliert: [] };
  for (const [titel, text] of vorher) {
    if (!nachher.has(titel)) r.gestrichen.push({ titel, text });
    else if (nachher.get(titel) !== text) r.umformuliert.push({ titel, vorher: text, nachher: nachher.get(titel) });
  }
  for (const [titel, text] of nachher) if (!vorher.has(titel)) r.ergaenzt.push({ titel, text });
  return r;
}

const geaendert = (v) => v.ergaenzt.length + v.gestrichen.length + v.umformuliert.length > 0;

/**
 * Die ergaenzten, gestrichenen und umformulierten Elemente von `## Fachliche
 * Akzeptanzkriterien` und `## Nicht-Ziele` (E9) und die Szenarien nach Titel (Issue #1592,
 * Plan #1588 E8) zwischen dem Body zu Beginn und am Ende des Grooming:
 * `{ kriterien: { ergaenzt, gestrichen, umformuliert }, nichtZiele: {…}, szenarien: {…},
 * vorschlag }`. Die Listenzeilen der Szenarien zaehlen nicht als Kriterien (A1). `vorschlag`
 * ist `/issue-review #<id>`, sobald eine der neun Listen nicht leer ist, sonst null.
 */
export function kriterienVergleich(start, ende, id = "?") {
  const r = {
    kriterien: listenVergleich(listenElemente(start, "fachlicheKriterien"), listenElemente(ende, "fachlicheKriterien")),
    nichtZiele: listenVergleich(listenElemente(start, "nichtZiele"), listenElemente(ende, "nichtZiele")),
    szenarien: szenarienVergleich(start, ende),
  };
  const pruefen = Object.values(r).some(geaendert);
  return { ...r, vorschlag: pruefen ? `/issue-review #${id}` : null };
}
