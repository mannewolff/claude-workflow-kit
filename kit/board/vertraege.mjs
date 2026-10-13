/**
 * board/vertraege.mjs — der Unterabschnitt Verträge im Plan und Gate P14 (Issue #1612, Plan
 * #1611 E1 bis E4, E14): lesen, welche Verträge ein Plan mit dem anderen Repo des Paars Kit und
 * kanban-kit fuehrt, und pruefen, ob sie in fester Form stehen und offen gefragt sind.
 *
 * Ein Vertrag ist ein Eintrag `- V<n>: <Festlegung> — <Repo>, <liest | schreibt>` unter
 * `### Verträge` am Ende von `## Architektonische Entscheidungen`, mit den Zeilen
 * `Gebauter Stand:`, `Abgleich:` und je nach Fall `Wortlaut:`, `Vorgelegt laut Fachplan:`,
 * `Installiert:`, `Entschieden:` darunter (E1). Die Ueberschrift gilt in beiden Sprachen, die
 * festen Woerter nur in der Projektsprache (E3). Pflicht ist der Unterabschnitt nur, wenn die
 * Config `vertragsRepos` setzt (E2). Was in einem Codeblock steht, existiert fuer die Pruefung
 * nicht — dieselbe Fence-Auslegung wie `zerlegeAbschnitte`.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { abschnittsTitel } from "./dokumente.mjs";
import { prozessSprache, text, ueberschriftName, ueberschriftZeile, vertragWort } from "./namen.mjs";

// Die Texte an den Menschen liegen unter kit/texte/board-vertraege.mjs.
import { TEXTE } from "../texte/board-vertraege.mjs";

export { TEXTE };

const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

const [ENTSCHEIDUNGEN, OFFENE_FRAGEN] = abschnittsTitel("architektonischeEntscheidungen", "offeneFragen");

const VERTRAEGE_KOPF = ueberschriftZeile("vertraege", 3);
// Jede `###`-Zeile beendet den Unterabschnitt.
const UNTERKOPF = /^ {0,3}###(?!#)/;
// Der Kopf eines Eintrags: `- V<n>:` und der Rest.
const EINTRAG = /^ {0,3}[-*+][ \t]+V(\d+):(.*)$/;
// Ein anderer Listenpunkt auf der Ebene der Eintraege beendet den Eintrag.
const LISTENPUNKT = /^ ?[-*+][ \t]/;

// Die Zeilen eines Eintrags: Sache in VERTRAG -> Feld im gelesenen Eintrag.
const ZEILEN = Object.freeze({
  gebauterStand: "gebauterStand",
  abgleich: "abgleich",
  wortlaut: "wortlaut",
  vorgelegtLaut: "vorgelegtLaut",
  installiert: "installiert",
  entschieden: "entschieden",
});
const ABGLEICH_WERTE = ["stimmt", "weichtAb", "fehlt", "nichtPruefbar", "vorgelegt"];
const OFFEN = new Set(["weichtAb", "fehlt", "nichtPruefbar"]);

const klein = (s) => s.trim().toLowerCase();

/** Die Zeilen des Unterabschnitts `### Verträge` oder `null`, wenn er fehlt (E1). */
function unterabschnitt(abschnitte) {
  const zeilen = abschnitte.find((a) => a.titel === ENTSCHEIDUNGEN)?.zeilen ?? [];
  const start = zeilen.findIndex((z) => VERTRAEGE_KOPF.test(z));
  if (start < 0) return null;
  const ende = zeilen.findIndex((z, i) => i > start && UNTERKOPF.test(z));
  return zeilen.slice(start + 1, ende < 0 ? zeilen.length : ende);
}

/** Repo und Richtung aus dem Kopf `<Festlegung> — <Repo>, <Richtung>`; fehlt das, leer. */
function kopfLesen(rest) {
  const strich = rest.lastIndexOf(" — ");
  if (strich < 0) return { festlegung: rest.trim(), repo: "", richtung: "" };
  const hinten = rest.slice(strich + 3);
  const komma = hinten.lastIndexOf(",");
  return {
    festlegung: rest.slice(0, strich).trim(),
    repo: (komma < 0 ? hinten : hinten.slice(0, komma)).trim(),
    richtung: komma < 0 ? "" : hinten.slice(komma + 1).trim(),
  };
}

/** Das Feld zur Zeile in der Sprache `sprache` oder `null`, wenn sie keine Zeile der Form ist. */
function zeileLesen(zeile, sprache) {
  const z = zeile.trim();
  for (const [sache, feld] of Object.entries(ZEILEN)) {
    const anfang = vertragWort(sache, sprache);
    if (z.toLowerCase().startsWith(anfang.toLowerCase())) return { feld, wert: z.slice(anfang.length).trim() };
  }
  return null;
}

/** Die Sache des Abgleich-Werts in der Sprache, sonst `null`. */
function abgleichSache(wert, sprache) {
  const w = klein(wert).replace(/\.$/, "");
  return ABGLEICH_WERTE.find((sache) => vertragWort(sache, sprache).toLowerCase() === w) ?? null;
}

/**
 * Die V-Eintraege des Unterabschnitts `### Verträge` in ihrer Folge (E1): je Eintrag `nummer`,
 * `festlegung`, `repo`, `richtung` und die Werte der Zeilen `gebauterStand`, `abgleich`,
 * `wortlaut`, `vorgelegtLaut`, `installiert`, `entschieden` — `null`, wo die Zeile fehlt. Die
 * Zeilenanfaenge gelten in der Sprache `sprache`. Ohne Unterabschnitt eine leere Liste.
 */
export function vertraegeLesen(abschnitte, sprache = prozessSprache()) {
  const eintraege = [];
  let aktuell = null;
  for (const zeile of unterabschnitt(abschnitte) ?? []) {
    const kopf = EINTRAG.exec(zeile);
    if (kopf) {
      aktuell = { nummer: Number(kopf[1]), ...kopfLesen(kopf[2]), ...Object.fromEntries(Object.values(ZEILEN).map((f) => [f, null])) };
      eintraege.push(aktuell);
      continue;
    }
    if (LISTENPUNKT.test(zeile)) { aktuell = null; continue; }
    const feld = aktuell ? zeileLesen(zeile, sprache) : null;
    if (feld && aktuell[feld.feld] === null) aktuell[feld.feld] = feld.wert;
  }
  return eintraege;
}

/** Die Namen der Partnerrepos aus `vertragsRepos`: Eintraege `{ name }`, auch blosse Namen. */
function repoNamen(vertragsRepos) {
  if (!Array.isArray(vertragsRepos)) return [];
  return vertragsRepos.map((r) => (typeof r === "string" ? r : r?.name)).filter((n) => typeof n === "string" && n !== "");
}

/** Die Verstoesse eines Eintrags gegen (b) und (c) aus E4. */
function eintragVerstoesse(e, repos, sprache) {
  const w = (sache) => vertragWort(sache, sprache);
  const meldungen = [];
  const richtungen = [w("liest"), w("schreibt")].map((r) => r.toLowerCase());
  if (e.repo === "" || !richtungen.includes(klein(e.richtung))) {
    meldungen.push(t("kopf", { nummer: e.nummer, liest: w("liest"), schreibt: w("schreibt") }));
  }
  if (e.repo !== "" && !repos.includes(e.repo)) {
    meldungen.push(t("repoUnbekannt", { nummer: e.nummer, repo: e.repo, repos: repos.join(", ") }));
  }
  if (e.gebauterStand === null) meldungen.push(t("zeileFehlt", { nummer: e.nummer, zeile: w("gebauterStand") }));
  if (e.abgleich === null) {
    meldungen.push(t("zeileFehlt", { nummer: e.nummer, zeile: w("abgleich") }));
  } else if (abgleichSache(e.abgleich, sprache) === null) {
    const werte = ABGLEICH_WERTE.map(w).join(" | ");
    meldungen.push(t("wertUnbekannt", { nummer: e.nummer, zeile: w("abgleich"), wert: e.abgleich, werte }));
  }
  if (abgleichSache(e.abgleich ?? "", sprache) === "vorgelegt") {
    const vorgelegt = w("vorgelegt");
    if (e.gebauterStand !== null && !klein(e.gebauterStand).startsWith(w("standFehlt").toLowerCase())) {
      meldungen.push(t("vorgelegtStand", { nummer: e.nummer, vorgelegt, stand: w("gebauterStand"), standFehlt: w("standFehlt") }));
    }
    if (!e.wortlaut || !e.vorgelegtLaut) {
      meldungen.push(t("vorgelegtZeilen", { nummer: e.nummer, vorgelegt, wortlaut: w("wortlaut"), zitat: w("vorgelegtLaut") }));
    }
  }
  return meldungen;
}

/**
 * (d) aus E4: Jeder offene Vertrag — `weicht ab`, `fehlt` oder `nicht prüfbar` ohne Zeile
 * `Entschieden:` — steht in einer Frage unter `## Offene Fragen`, deren erste Zeile nicht
 * `- Keine.` ist. Die Meldung nennt alle offenen V-Nummern.
 */
function offenVerstoss(eintraege, abschnitte, sprache) {
  const offen = eintraege.filter((e) => e.entschieden === null && OFFEN.has(abgleichSache(e.abgleich ?? "", sprache)));
  if (offen.length === 0) return null;
  const fragen = (abschnitte.find((a) => a.titel === OFFENE_FRAGEN)?.zeilen ?? []).map((z) => z.trim()).filter((z) => z !== "");
  const keine = fragen.length === 0 || fragen[0].startsWith("- Keine.");
  const fragenText = fragen.join("\n");
  const genannt = (n) => new RegExp(`\\bV${n}\\b`).test(fragenText);
  if (!keine && offen.every((e) => genannt(e.nummer))) return null;
  return t("offen", {
    nummern: offen.map((e) => `V${e.nummer}`).join(", "),
    fragen: ueberschriftName("offeneFragen", sprache),
    abgleich: vertragWort("abgleich", sprache),
    entschieden: vertragWort("entschieden", sprache),
  });
}

/**
 * Gate P14 (E4): die Verstoesse `{ gate: "P14", meldung }` des Plans, leer, wenn er passt oder
 * die Config kein Partnerrepo in `vertragsRepos` nennt (E2). Geprueft wird (a) der Unterabschnitt
 * `### Verträge` steht, (b) jeder Eintrag nennt ein Repo aus `vertragsRepos`, `Gebauter Stand:`
 * und `Abgleich:` mit bekanntem Wert, (c) `vom Projekt vorgelegt` nur mit `fehlt, geprüft …`,
 * `Wortlaut:` und `Vorgelegt laut Fachplan:`, (d) jeder offene Vertrag ist unter
 * `## Offene Fragen` gefragt. Die festen Woerter gelten in der Sprache `sprache` (E3).
 */
export function pruefeVertraege(abschnitte, { vertragsRepos, sprache = prozessSprache() } = {}) {
  const repos = repoNamen(vertragsRepos);
  if (repos.length === 0) return [];
  const p14 = (meldung) => ({ gate: "P14", meldung });
  const ueberschrift = ueberschriftName("vertraege", sprache);
  const leer = vertragWort("keinVertrag", sprache);
  const zeilen = unterabschnitt(abschnitte);
  if (zeilen === null) {
    const entscheidungen = ueberschriftName("architektonischeEntscheidungen", sprache);
    return [p14(t("fehlt", { repos: repos.join(", "), entscheidungen, ueberschrift, leer }))];
  }
  const eintraege = vertraegeLesen(abschnitte, sprache);
  if (eintraege.length === 0) {
    const ersteZeile = zeilen.map((z) => z.trim()).find((z) => z !== "") ?? "";
    return ersteZeile.toLowerCase().startsWith(leer.toLowerCase()) ? [] : [p14(t("leer", { ueberschrift, leer }))];
  }
  const meldungen = eintraege.flatMap((e) => eintragVerstoesse(e, repos, sprache));
  const offen = offenVerstoss(eintraege, abschnitte, sprache);
  if (offen) meldungen.push(offen);
  return meldungen.map(p14);
}
