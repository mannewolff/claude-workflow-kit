#!/usr/bin/env node
/**
 * claude-workflow-kit Spec-Werkzeug (Issue #440, #442, #445, #446, #450, #451, Plan #437)
 *
 * Liest das beschriebene Verhalten eines Projekts — eine Datei je Bereich unter
 * specs/ — und beantwortet sieben Fragen: `index` schreibt die Uebersicht ueber
 * alle Bereiche, `show` gibt die Aussage zu einer einzelnen ID aus,
 * `check --paket` prueft die Form des Abschnitts `## Spec-Wirkung` eines
 * Arbeitspakets gegen die Grammatik aus A12, `check --anker` haelt als Gate den
 * Push auf, wenn Paket und Beschreibung nicht zusammenpassen, `luecken` sagt,
 * wozu die Beschreibung schweigt, `vorhaben` haelt fest, ob fuer ein Vorhaben
 * Produktionscode gelesen wurde, und `apply` schreibt die Beschreibung aus den
 * Wirkungsangaben der Pakete fort.
 *
 * Warum ein eigenes Werkzeug und keine Achse in board.mjs (Plan #437, A2):
 * board.mjs spricht mit Issue-Trackern, hier geht es um Dateien im Repo. Die
 * beiden teilen weder Konfiguration noch Zugang, und eine gemeinsame Datei
 * haette nur den gemeinsamen Namen.
 *
 * Die Dateiform steht in Plan #437, A15 — geschrieben wird sie erst in
 * Ausbaustufe 4, hier wird sie nur gelesen:
 *
 *   Eine Datei je Bereich: specs/<bereich>.md
 *   Der Bereichsname ist der Dateiname ohne Endung.
 *   specs/INDEX.md und specs/vorhaben/** sind keine Bereiche.
 *
 *   Gueltige Aussagen — Zeilen oberhalb von "## Entfallen":
 *   - <ID> — <Aussage>
 *
 *   Gestrichene Aussagen — Zeilen unterhalb von "## Entfallen":
 *   - <ID> — <Aussage> (entfallen <JJJJ-MM-TT>, Paket #<M>)
 *
 *   Alles andere (Ueberschriften, Prosa) wird ignoriert.
 *
 * Eine ID hat die Form <bereich>-<N> (A16).
 *
 * specs/ wird relativ zum Arbeitsverzeichnis gesucht, wie bei checks.mjs und
 * board.mjs — kein --root-Parameter. Fehlt das Verzeichnis, ist das der
 * Normalzustand eines Projekts ohne Specs und kein Fehler.
 *
 * Keine Laufzeitabhaengigkeit ausserhalb der Node-Standardbibliothek und kein
 * Netz: Die Datei ist eigenstaendig portabel und laesst sich einzeln in ein
 * Projekt kopieren, wie board.mjs, night.mjs und checks.mjs.
 *
 * Zwei Unterprozesse brauchen `apply` (Issue #450) und `check --anker` (#451),
 * und beide ohne Shell: `git log` fuer die Paketnummern zwischen Anker und HEAD,
 * und der Adapter unter .claude/kit/ fuer die Bodies. Das ist keine Aufweichung
 * der Portabilitaet — es ist die Datenlage: Die Spec-Wirkung steht im Body des
 * Arbeitspakets, und der liegt bei `github` und `gitlab` nicht im Repo (Plan
 * #437, A11). Die Kommandos bleiben lesend; geschrieben wird allein unter specs/.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "1.45.0";

const SPECS_DIR = "specs";
const VORHABEN_DIR = "vorhaben";
const INDEX_DATEI = "INDEX.md";
const CONFIG_DATEI = ".claude/workflow.config.json";
const WIRKUNG_UEBERSCHRIFT = "## Spec-Wirkung";
const ENTFALLEN_UEBERSCHRIFT = "## Entfallen";

// Der Adapter, ueber den `apply` die Paket-Bodies liest (A11). Als Pfadsegmente
// statt als Zeichenkette, damit der Aufruf ohne Shell auskommt — dieselbe Haltung
// wie in board.mjs seit Issue #196.
const BOARD_KOMMANDO = [".claude", "kit", "board.mjs"];

const HELP = `spec.mjs (claude-workflow-kit v${KIT_VERSION}) — beschriebenes Verhalten lesen

  node spec.mjs index
  node spec.mjs show <id>
  node spec.mjs check --paket <datei>
  node spec.mjs check --anker <sha>
  node spec.mjs luecken --bereich <name>…
  node spec.mjs vorhaben --kuerzel <k> --code-gelesen ja|nein [--grund <text>]
  node spec.mjs apply --anker <sha> [--dry-run]

index   Schreibt ${SPECS_DIR}/${INDEX_DATEI} neu: eine Zeile je Bereich mit der Zahl der
        gueltigen und der entfallenen Aussagen. Fehlt ${SPECS_DIR}/, sagt das Kommando
        das und endet gruen.
show    Gibt die Aussage zu einer ID aus, mit Bereich und Status. Bei einer
        entfallenen Aussage auch Datum und Paketnummer.
check   Prueft die Spec-Wirkung — genau eines der beiden Flags je Aufruf. Alle
        Befunde gehen auf stderr; Exit 1, sobald einer vorliegt. Ohne
        'spec'-Block in ${CONFIG_DATEI} wird nicht geprueft.

  --paket <datei> Der Abschnitt '${WIRKUNG_UEBERSCHRIFT}' einer Paketdatei:
                  Zeilenform, bekannter Bereich, ID-Vergabe. Je Befund eine
                  Zeile 'Zeile <n>: <Grund>'.
  --anker <sha>   Das Gate vor dem Push: Kam bei den Paketen zwischen <sha> und
                  HEAD an, was sie angekuendigt haben, und verweist auf jede
                  neue oder geaenderte Aussage ein Test? Je Befund eine Zeile
                  mit Paketnummer, Aussage-ID und Grund. Ein leerer oder nicht
                  aufloesbarer Anker endet rot, ebenso ein fehlendes
                  'spec.testGlobs' — das Gate oeffnet nie aus Unwissen. Ohne
                  Paket im Bereich nennt die Ausgabe Anker und '0 Pakete
                  gewertet'.
luecken Nennt je Bereich die Dateien, die keine gueltige Aussage beruehrt —
        als JSON auf stdout, immer, auch mit leerer Liste. Eine Luecke ist ein
        Befund und kein Fehler: Exit 0. Die Bereichsnamen kommen aus
        'spec.bereiche'; ohne den Block wird nichts gemeldet.
vorhaben Schreibt ${SPECS_DIR}/${VORHABEN_DIR}/<kuerzel>.md neu: Einheit, Kuerzel bzw.
        Plannummer, ob Produktionscode gelesen wurde, der Grund und der Stand.
        Das Kuerzel kommt vom Aufrufer, nicht aus dem Tracker. Ohne
        'spec'-Block in ${CONFIG_DATEI} wird nichts geschrieben.
apply   Schreibt die Beschreibung aus den Wirkungsangaben der Pakete zwischen
        <sha> und HEAD fort und aktualisiert danach ${SPECS_DIR}/${INDEX_DATEI}. Die
        Paketnummern kommen aus den Commit-Betreffs, die Bodies ueber
        ${BOARD_KOMMANDO.join("/")}. Erst wenn alle Bodies gelesen und
        geprueft sind, wird die erste Datei geschrieben; jeder Befund endet
        mit Exit 1 und unveraenderten Dateien. --dry-run zeigt nur den Diff.

  --anker <sha>   Pflicht. Ein leerer oder nicht aufloesbarer Wert endet rot —
                  fuer eine Fortschreibung gibt es keinen vollen Umfang.
  --dry-run       Unified Diff je Datei auf stdout, nichts wird geschrieben
                  und nichts angelegt.

  --version       Kit-Stand dieser Datei.
  --help, -h      Diese Uebersicht.

Gelesen wird ${SPECS_DIR}/ im Arbeitsverzeichnis: eine Datei je Bereich, der
Bereichsname ist der Dateiname ohne Endung. ${SPECS_DIR}/${INDEX_DATEI} und alles unter
${SPECS_DIR}/vorhaben/ sind keine Bereiche. Aussagen stehen als '- <ID> — <Aussage>';
was unter der Ueberschrift '## Entfallen' steht, gilt als gestrichen.
`;

class SpecError extends Error {}

function fail(nachricht) {
  throw new SpecError(nachricht);
}

// --- Lesen ------------------------------------------------------------------

function specsPfad(root = process.cwd()) {
  return join(root, SPECS_DIR);
}

/**
 * Die Bereiche in alphabetischer Reihenfolge.
 *
 * Sortiert wird mit dem Standardvergleich, nicht mit localeCompare: Dessen
 * Reihenfolge haengt an der Locale der Maschine, und `index` muss auf jeder
 * Maschine dieselbe Datei erzeugen.
 *
 * Unterverzeichnisse fallen durch die isFile()-Pruefung heraus — damit ist
 * specs/vorhaben/** ohne Sonderfall draussen, und ein spaeter dazukommendes
 * Unterverzeichnis ebenso.
 */
function bereiche(root = process.cwd()) {
  return readdirSync(specsPfad(root), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== INDEX_DATEI)
    .map((e) => e.name.slice(0, -3))
    .sort();
}

// '- <ID> — <Aussage>'. Die ID muss der Form <bereich>-<N> genuegen (A16): ohne
// diese Bedingung wuerde jede Prosa-Aufzaehlung mit Gedankenstrich als Aussage
// gelesen, und der Index zaehlte Saetze statt Zusagen.
const AUSSAGE_RE = /^-\s+(\S+-\d+)\s+—\s+(.+?)\s*$/;

// Das Suffix einer gestrichenen Aussage. Es steht am Zeilenende und wird von der
// Aussage abgetrennt, damit `show` Datum und Paket getrennt nennen kann.
const ENTFALLEN_RE = /^(.*?)\s*\(entfallen\s+(\d{4}-\d{2}-\d{2}),\s*Paket\s+#(\d+)\)$/;

const ENTFALLEN_UEBERSCHRIFT_RE = /^##\s+Entfallen\s*$/;

/**
 * Zerlegt eine Bereichsdatei in ihre Aussagen.
 *
 * Ueber den Status entscheidet allein die Position zur Ueberschrift '##
 * Entfallen', nie das Suffix: Eine Zeile ohne Suffix unterhalb der Ueberschrift
 * ist trotzdem gestrichen, sonst zaehlte ein vergessener Klammerzusatz sie
 * wieder als gueltig — der Fehler ginge in die unsichere Richtung.
 *
 * Die Zeilennummer wird mitgefuehrt, weil sie in der Meldung zu einer doppelt
 * vergebenen ID die einzige Angabe ist, die zwei Fundstellen in derselben Datei
 * auseinanderhaelt.
 */
function aussagenLesen(bereich, text) {
  const gefunden = [];
  let entfallenAbschnitt = false;

  for (const [i, zeile] of text.split("\n").entries()) {
    if (ENTFALLEN_UEBERSCHRIFT_RE.test(zeile.trim())) {
      entfallenAbschnitt = true;
      continue;
    }
    const treffer = AUSSAGE_RE.exec(zeile);
    if (!treffer) continue;

    const [, id, rest] = treffer;
    const eintrag = { id, bereich, zeile: i + 1, entfallen: entfallenAbschnitt, aussage: rest };
    const zusatz = entfallenAbschnitt ? ENTFALLEN_RE.exec(rest) : null;
    if (zusatz) {
      eintrag.aussage = zusatz[1];
      eintrag.datum = zusatz[2];
      eintrag.paket = zusatz[3];
    }
    gefunden.push(eintrag);
  }
  return gefunden;
}

function bereichLesen(bereich, root = process.cwd()) {
  return aussagenLesen(bereich, readFileSync(join(specsPfad(root), `${bereich}.md`), "utf-8"));
}

/** Die Datei eines Bereichs, wie sie in Meldungen und im Index erscheint. */
function bereichsDatei(bereich) {
  return `${SPECS_DIR}/${bereich}.md`;
}

// --- index ------------------------------------------------------------------

const INDEX_KOPF = ["# Spec-Index", "", "| Bereich | Datei | Gueltig | Entfallen |", "| --- | --- | --- | --- |"];

/**
 * Schreibt den Index vollstaendig neu — kein Merge.
 *
 * Ein zusammengefuehrter Index behielte die Zeile eines geloeschten Bereichs:
 * Der Index behauptete dann ein beschriebenes Verhalten, zu dem es keine Datei
 * mehr gibt. Lieber eine Zeile zu wenig als eine erfundene.
 */
/**
 * Der Index zu einem Stand der Bereiche: Name -> Dateitext.
 *
 * Der Stand kommt als Text herein und nicht als Verzeichnis, weil `apply` seinen
 * Index vor dem Schreiben braucht (--dry-run legt nichts an, Issue #450). Aus der
 * Platte gelesen zeigte die Vorschau den alten Index — also gerade das, was sie
 * nicht zeigen soll.
 */
function indexAusTexten(texte) {
  const zeilen = [...texte.keys()].sort().map((bereich) => {
    const aussagen = aussagenLesen(bereich, texte.get(bereich));
    const entfallen = aussagen.filter((a) => a.entfallen).length;
    return `| ${bereich} | ${bereichsDatei(bereich)} | ${aussagen.length - entfallen} | ${entfallen} |`;
  });
  return { text: [...INDEX_KOPF, ...zeilen, ""].join("\n"), anzahl: zeilen.length };
}

/** Der Index, wie er auf der Platte liegt — null, wenn es ihn nicht gibt. */
function indexDatei(root = process.cwd()) {
  const pfad = join(specsPfad(root), INDEX_DATEI);
  return existsSync(pfad) ? readFileSync(pfad, "utf-8") : null;
}

/** Der Stand aller Bereiche, wie er unter ${SPECS_DIR}/ liegt. */
function bereichsTexte(root = process.cwd()) {
  const texte = new Map();
  if (!existsSync(specsPfad(root))) return texte;
  for (const bereich of bereiche(root)) {
    texte.set(bereich, readFileSync(join(specsPfad(root), `${bereich}.md`), "utf-8"));
  }
  return texte;
}

function index() {
  const verzeichnis = specsPfad();
  if (!existsSync(verzeichnis)) {
    process.stdout.write(`Kein ${SPECS_DIR}/ unter ${process.cwd()} — nichts zu indizieren.\n`);
    return 0;
  }

  const { text, anzahl } = indexAusTexten(bereichsTexte());
  writeFileSync(join(verzeichnis, INDEX_DATEI), text, "utf-8");
  process.stdout.write(`${SPECS_DIR}/${INDEX_DATEI} geschrieben: ${anzahl} ${anzahl === 1 ? "Bereich" : "Bereiche"}.\n`);
  return 0;
}

// --- show -------------------------------------------------------------------

function statusText(eintrag) {
  if (!eintrag.entfallen) return "gueltig";
  return eintrag.datum
    ? `entfallen (${eintrag.datum}, Paket #${eintrag.paket})`
    : "entfallen (ohne Datum und Paketnummer)";
}

function fundstelle(eintrag) {
  return `${bereichsDatei(eintrag.bereich)}:${eintrag.zeile}`;
}

/**
 * Gibt die Aussage zu einer ID aus.
 *
 * Jeder Fehlerpfad endet mit leerem stdout und Exit 1. Wer `show` in einem
 * Skript liest, darf eine Fehlermeldung nie fuer eine Aussage halten.
 *
 * Kommt die ID mehrfach vor, bricht das Kommando ab und nennt beide Fundstellen.
 * Welche der beiden gilt, entscheidet `check` (Ausbaustufe 2) — gaebe `show`
 * eine davon aus, verschwiege es genau den Widerspruch, den es gerade sieht.
 */
function show(id) {
  if (!id) fail("Keine ID angegeben. Aufruf: node spec.mjs show <id>");
  if (!existsSync(specsPfad())) {
    fail(`Kein ${SPECS_DIR}/ unter ${process.cwd()} — es ist kein Verhalten beschrieben.`);
  }

  const treffer = bereiche().flatMap((bereich) => bereichLesen(bereich).filter((a) => a.id === id));

  if (treffer.length === 0) fail(`ID '${id}' ist nicht vergeben.`);
  if (treffer.length > 1) {
    fail(`ID '${id}' ist mehrfach vergeben: ${treffer.map((t) => fundstelle(t)).join(", ")}. `
      + `Aufloesen ist Sache von 'spec.mjs check'.`);
  }

  const [eintrag] = treffer;
  process.stdout.write([
    `${eintrag.id} — ${eintrag.aussage}`,
    `Bereich: ${eintrag.bereich}`,
    `Datei:   ${fundstelle(eintrag)}`,
    `Status:  ${statusText(eintrag)}`,
    "",
  ].join("\n"));
  return 0;
}

// --- check --paket ----------------------------------------------------------

/**
 * Die Grammatik der Wirkungszeilen (Plan #437, A12):
 *
 *   NEU       <BEREICH> <ID> — <Aussage>
 *   GEAENDERT <ID> — <neuer Aussage-Text>
 *   ENTFAELLT <ID> — <Grund>
 *   KEINE     — <Begruendung>
 *
 * Felder trennen ein oder mehrere Leerzeichen; vor dem Freitext steht genau der
 * Gedankenstrich — (U+2014). Ein Bindestrich ist ein Fehler: Er sieht der
 * gueltigen Form zum Verwechseln aehnlich, und die Aussagen unter ${SPECS_DIR}/
 * werden mit derselben Regel gelesen (AUSSAGE_RE).
 */
/**
 * Die vier Zeilenformen als Text — die eine Quelle, gegen die sich alles andere
 * vergleicht (Issue #454).
 *
 * Ohne sie gaebe es drei Abschriften desselben Textes: im Plan, in der Doku und im
 * Test, der die Doku prueft. Genau dieses Argument hat die Grammatik ueberhaupt erst
 * in den Plan gezogen (A12) — es gilt eine Ebene tiefer genauso.
 */
export const WIRKUNG_GRAMMATIK = [
  "NEU       <BEREICH> <ID> — <Aussage>",
  "GEAENDERT <ID> — <neuer Aussage-Text>",
  "ENTFAELLT <ID> — <Grund>",
  "KEINE     — <Begruendung>",
].join("\n");

const NEU_RE = /^NEU\s+(\S+)\s+(\S+-\d+)\s+—\s+(\S.*?)\s*$/;
const GEAENDERT_RE = /^GEAENDERT\s+(\S+-\d+)\s+—\s+(\S.*?)\s*$/;
const ENTFAELLT_RE = /^ENTFAELLT\s+(\S+-\d+)\s+—\s+\S/;
const KEINE_RE = /^KEINE\s+—\s+\S/;

// Die Ueberschrift des Abschnitts, in derselben Form, die die Leitplanke in
// board.mjs als vorhanden zaehlt (Issue #443): genau die Zeile, danach hoechstens
// Leerraum. Zwei Fassungen waeren zwei Wahrheiten darueber, was ein Abschnitt ist.
const WIRKUNG_UEBERSCHRIFT_RE = /^## Spec-Wirkung[^\S\n]*$/;

/**
 * Die Config des Projekts oder null, wenn keine daliegt.
 *
 * Gelesen wird allein ${CONFIG_DATEI} (A1); workflow.config.local.json bleibt
 * aussen vor, weil der spec-Block teamweit gilt — eine persoenliche Datei
 * koennte die Pruefung sonst still abschalten.
 */
function configLesen(root = process.cwd()) {
  const pfad = join(root, ".claude", "workflow.config.json");
  if (!existsSync(pfad)) return null;
  try {
    return JSON.parse(readFileSync(pfad, "utf-8"));
  } catch (err) {
    return fail(`${CONFIG_DATEI} ist kein gueltiges JSON: ${err.message}`);
  }
}

// Tracker, die das beschriebene Verhalten nicht tragen (A19, Issue #461).
//
// Der Ausschluss richtet sich gegen diese beiden, nicht gegen alle ausser einem:
// `toolbox` bringt Aktivitaetsverlauf und Suche mit, `local` braucht beides nicht —
// er hat keinen Server, und den Verlauf synthetisiert er seit Issue #460 aus dem
// Frontmatter. Waere er ausgeschlossen, verloeren die Spec-Tests ihre Grundlage.
const TRACKER_OHNE_SPEC = new Set(["github", "gitlab"]);

// Das Schema fuehrt `issueTracker` mit default "github" und required: []. Ein Block
// ohne das Feld ist gueltig — und darf den Schalter nicht stillschweigend freigeben.
const TRACKER_DEFAULT = "github";

/**
 * A19: Bricht ab, wenn ein `spec`-Block auf einem Tracker steht, der ihn nicht traegt.
 *
 * Ohne `spec`-Block passiert nichts — ein Projekt ohne Schalter merkt von dieser Regel
 * so wenig wie vom Rest (Kriterium 2). Die Meldung geht auf stderr: `show` und
 * `luecken` halten stdout fuer ihre Ausgabe frei.
 */
function trackerPruefen(root = process.cwd()) {
  const config = configLesen(root);
  if (!config?.spec) return;
  const tracker = config.issueTracker ?? TRACKER_DEFAULT;
  if (!TRACKER_OHNE_SPEC.has(tracker)) return;
  fail(
    `Das beschriebene Verhalten traegt 'issueTracker: ${tracker}' nicht (A19 in Plan #437): ` +
    `Aktivitaetsverlauf und Suche ueber Aussagen gibt es dort nicht. ` +
    `Moeglich sind 'toolbox' und 'local'. Entweder den Tracker wechseln oder den 'spec'-Block ` +
    `aus ${CONFIG_DATEI} entfernen.`
  );
}

/** Der Bereich einer ID: alles vor der letzten Nummer (A16). */
function praefix(id) {
  return id.slice(0, id.lastIndexOf("-"));
}

/**
 * Was die Beschreibung ueber einen Bereich weiss, je Bereich einmal gelesen.
 *
 * `beschrieben` unterscheidet den Bereich ohne Datei vom leeren Bereich: Ohne
 * Datei ist keine ID vergeben, NEU ist dort zulaessig (Kriterium 6) — aber es
 * gibt auch nichts zu aendern oder zu streichen.
 */
function bereichsWissen(root = process.cwd()) {
  const bekannt = new Map();
  return (bereich) => {
    if (!bekannt.has(bereich)) bekannt.set(bereich, bereichZustand(bereich, root));
    return bekannt.get(bereich);
  };
}

function bereichZustand(bereich, root) {
  const pfad = join(specsPfad(root), `${bereich}.md`);
  if (!existsSync(pfad)) return { beschrieben: false, gueltig: new Set(), entfallen: new Set() };

  const aussagen = aussagenLesen(bereich, readFileSync(pfad, "utf-8"));
  return {
    beschrieben: true,
    gueltig: new Set(aussagen.filter((a) => !a.entfallen).map((a) => a.id)),
    entfallen: new Set(aussagen.filter((a) => a.entfallen).map((a) => a.id)),
  };
}

/**
 * Zerlegt eine Wirkungszeile; null heisst: keine der vier Formen.
 *
 * Der Aussagetext wird mitgelesen, obwohl `check` ihn nicht braucht: `apply`
 * traegt genau ihn in die Beschreibung ein (Issue #450), und ein zweiter Leser
 * mit eigener Grammatik waere eine zweite Wahrheit darueber, wo die Aussage
 * anfaengt. Bei ENTFAELLT steht hinter dem Gedankenstrich der Grund, nicht die
 * Aussage — er bleibt im Paket und wandert nie in die Datei (A13).
 */
function zeileLesen(text) {
  const neu = NEU_RE.exec(text);
  if (neu) return { art: "NEU", bereich: neu[1], id: neu[2], aussage: neu[3] };

  const geaendert = GEAENDERT_RE.exec(text);
  if (geaendert) return { art: "GEAENDERT", id: geaendert[1], aussage: geaendert[2] };

  const entfaellt = ENTFAELLT_RE.exec(text);
  if (entfaellt) return { art: "ENTFAELLT", id: entfaellt[1] };

  return KEINE_RE.test(text) ? { art: "KEINE" } : null;
}

function formFehler(text) {
  const hinweis = /\s-\s/.test(text)
    ? " Der Trenner vor dem Freitext ist '—' (U+2014), kein Bindestrich."
    : "";
  return `Zeilenform passt zu keiner der vier Formen aus A12 (NEU, GEAENDERT, ENTFAELLT, KEINE).${hinweis}`;
}

/**
 * Eine NEU-Zeile vergibt eine ID — der Pfad mit den meisten Fallen.
 *
 * Die letzte Pruefung ist die schaerfste (A13): Eine entfallene ID bleibt
 * vergeben. Ohne sie bekaeme die naechste Aussage die Nummer einer
 * gestrichenen, und aus zwei verschiedenen Zusagen wuerde stillschweigend eine.
 *
 * `wissen === null` laesst genau diese beiden letzten Pruefungen aus — der Weg
 * von `apply` (Issue #450). Der Grund ist kein Sparen: `apply` sieht mehrere
 * Pakete auf einmal, und ein Paket darf anlegen, was ein spaeteres aendert. Gegen
 * den Dateistand einzeln geprueft, waere die zweite Angabe stets ein Befund und
 * ein wiederholter Lauf immer rot. Was formal falsch ist, bleibt formal falsch:
 * ein unbekannter Bereich und eine ID, die nicht zu ihm passt.
 */
function neuFehler(form, wissen, bekannte) {
  const { bereich, id } = form;
  if (!bekannte.includes(bereich)) {
    return `Unbekannter Bereich '${bereich}'. Bekannt sind: ${bekannte.join(", ") || "keiner"}.`;
  }
  if (praefix(id) !== bereich) {
    return `Die ID '${id}' passt nicht zum Bereich '${bereich}' — eine ID hat die Form <bereich>-<N> (A16).`;
  }
  if (wissen === null) return null;

  const zustand = wissen(bereich);
  if (zustand.gueltig.has(id)) return `Die ID '${id}' ist bereits vergeben.`;
  if (zustand.entfallen.has(id)) {
    return `Die ID '${id}' war schon vergeben und steht unter '${ENTFALLEN_UEBERSCHRIFT}' — IDs werden nie wiederverwendet (A13).`;
  }
  return null;
}

/** GEAENDERT und ENTFAELLT verlangen eine ID, die es gibt und die noch gilt. */
function bestandsFehler(form, wissen) {
  const bereich = praefix(form.id);
  const zustand = wissen(bereich);

  if (!zustand.beschrieben) {
    return `Bereich '${bereich}' hat noch keine Beschreibung — ${bereichsDatei(bereich)} gibt es nicht.`;
  }
  if (zustand.entfallen.has(form.id)) return `Die ID '${form.id}' ist bereits entfallen.`;
  if (!zustand.gueltig.has(form.id)) return `Die ID '${form.id}' ist nicht vergeben.`;
  return null;
}

function inhaltsFehler(form, wissen, bekannte) {
  if (form.art === "KEINE") return null;
  if (form.art === "NEU") return neuFehler(form, wissen, bekannte);
  // GEAENDERT und ENTFAELLT sagen nichts ueber die Form, nur ueber den Bestand —
  // ohne Dateiwissen bleibt an ihnen nichts zu pruefen (siehe neuFehler).
  return wissen === null ? null : bestandsFehler(form, wissen);
}

/**
 * Jede ID hoechstens einmal im Abschnitt.
 *
 * Die Meldung nennt beide Zeilennummern: Wer nur die zweite kennt, sucht die
 * erste von Hand, und zwei Zeilen zur selben ID sind genau der Fall, in dem
 * unklar ist, welche gilt.
 */
function doppelteIds(gelesen) {
  const ersteZeile = new Map();
  const fehler = [];

  for (const { nr, form } of gelesen) {
    if (!form?.id) continue;
    if (ersteZeile.has(form.id)) {
      fehler.push({ nr, grund: `Die ID '${form.id}' kommt mehrfach vor: Zeile ${ersteZeile.get(form.id)} und Zeile ${nr}.` });
      continue;
    }
    ersteZeile.set(form.id, nr);
  }
  return fehler;
}

/** 'KEINE' heisst: dieses Paket aendert nichts. Daneben passt keine Wirkungszeile. */
function keineAllein(gelesen) {
  if (gelesen.length === 1) return [];
  return gelesen
    .filter((z) => z.form?.art === "KEINE")
    .map(({ nr }) => ({ nr, grund: `'KEINE' steht allein — im Abschnitt stehen ${gelesen.length - 1} weitere Zeilen.` }));
}

/**
 * Der Abschnitt: von der Ueberschrift bis zur naechsten '## '-Zeile oder zum
 * Dateiende. null heisst: es gibt ihn nicht.
 */
function wirkungsAbschnitt(text) {
  const zeilen = text.split("\n");
  const kopf = zeilen.findIndex((z) => WIRKUNG_UEBERSCHRIFT_RE.test(z));
  if (kopf === -1) return null;

  const rest = zeilen.slice(kopf + 1);
  const grenze = rest.findIndex((z) => z.startsWith("## "));
  return {
    kopf: kopf + 1,
    zeilen: rest.slice(0, grenze === -1 ? rest.length : grenze).map((text, i) => ({ nr: kopf + 2 + i, text })),
  };
}

/**
 * Die nicht leeren Zeilen des Abschnitts, jede mit ihrer gelesenen Form.
 * `fehlt` und `leer` sind die beiden Faelle, in denen es nichts zu lesen gibt —
 * beide sind Befunde, aber verschiedene, und die Meldungen sagen Verschiedenes.
 */
function wirkungsZeilen(text) {
  const abschnitt = wirkungsAbschnitt(text);
  if (!abschnitt) return { fehlt: true, zeilen: [] };

  const zeilen = abschnitt.zeilen
    .filter((z) => z.text.trim() !== "")
    .map(({ nr, text: zeilenText }) => ({ nr, text: zeilenText.trim(), form: zeileLesen(zeilenText.trim()) }));

  return { fehlt: false, leer: zeilen.length === 0, kopf: abschnitt.kopf, zeilen };
}

/**
 * Alle Befunde des Abschnitts, nach Zeilennummer sortiert.
 *
 * Gemeldet wird jeder Befund, nicht nur der erste: Wer nach jedem Lauf einen
 * einzigen Fehler bekommt, braucht so viele Laeufe wie das Paket Fehler hat.
 *
 * `root === null` prueft nur die Form und laesst den Bestand aus — der Weg von
 * `apply`, begruendet bei `neuFehler`. Es ist dieselbe Funktion, nicht eine
 * zweite Grammatik: Zwei Pruefungen desselben Abschnitts waeren zwei Wahrheiten
 * darueber, was ein gueltiges Paket ist.
 */
function wirkungPruefen(text, bekannte, root = null) {
  const { fehlt, leer, kopf, zeilen } = wirkungsZeilen(text);
  if (fehlt) {
    return [{ nr: null, grund: `Abschnitt '${WIRKUNG_UEBERSCHRIFT}' fehlt — jedes Paket sagt, was es an der Beschreibung aendert.` }];
  }
  if (leer) {
    return [{ nr: kopf, grund: "Abschnitt ohne Wirkungszeile — wer nichts aendert, schreibt 'KEINE — <Begruendung>'." }];
  }

  const wissen = root === null ? null : bereichsWissen(root);
  return [
    ...zeilen.filter((z) => !z.form).map(({ nr, text: zeilenText }) => ({ nr, grund: formFehler(zeilenText) })),
    ...zeilen.filter((z) => z.form)
      .map(({ nr, form }) => ({ nr, grund: inhaltsFehler(form, wissen, bekannte) }))
      .filter((f) => f.grund !== null),
    ...doppelteIds(zeilen),
    ...keineAllein(zeilen),
  ].sort((a, b) => a.nr - b.nr);
}

const CHECK_SCHALTER = ["--paket", "--anker"];

/**
 * Die Schalter von `check` als Paare '--name <wert>'.
 *
 * Der leere Anker kommt durch: Er ist ein eigener Befund und wird beim Aufloesen
 * gemeldet, nicht hier als fehlender Wert — dieselbe Trennung wie bei `apply`.
 * Ein '--paket' ohne Wert bleibt dagegen ein Fehler des Aufrufs.
 */
function checkArgumente(argv) {
  const werte = new Map();

  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (!CHECK_SCHALTER.includes(name)) {
      fail(`Unerwartetes Argument: '${name}'. Erwartet: ${CHECK_SCHALTER.join(" oder ")}.`);
    }
    const wert = argv[i + 1];
    if (wert === undefined || wert.startsWith("--")) fail(`'${name}' braucht einen Wert.`);
    werte.set(name, wert);
    i += 1;
  }
  return werte;
}

/**
 * Die beiden Fragen von `check` — genau eine je Aufruf.
 *
 * Weder noch heisst: keine Frage. Beides zugleich heisst: zwei Umfaenge in einem
 * Aufruf, und welcher gilt, waere nicht zu entscheiden. In beiden Faellen endet
 * der Lauf rot und zeigt die Hilfe, statt sich einen der beiden auszusuchen.
 */
function check(argv) {
  const werte = checkArgumente(argv);
  const datei = werte.get("--paket");
  const anker = werte.get("--anker");

  if ((datei === undefined) === (anker === undefined)) {
    process.stderr.write(`check verlangt genau eines von --paket und --anker.\n\n${HELP}`);
    return 1;
  }
  return datei !== undefined ? checkPaket(datei) : checkAnker(anker);
}

/**
 * Prueft die Spec-Wirkung eines Arbeitspakets.
 *
 * Die Befunde gehen auf stderr, nicht auf stdout: `check` ist ein Pruefer, und
 * ein Skript, das seine Ausgabe liest, darf eine Fehlermeldung nie fuer ein
 * Ergebnis halten — dieselbe Trennung wie bei `show`.
 */
function checkPaket(datei) {
  // Ohne Schalter wird nicht geprueft (Kriterium 2): Ein Projekt, das den Block
  // nie gesetzt hat, schreibt den Abschnitt nicht und soll hier nicht scheitern.
  const config = configLesen();
  if (!config?.spec) {
    process.stderr.write(`Kein 'spec'-Block in ${CONFIG_DATEI} — die Spec-Wirkung wird nicht geprueft.\n`);
    return 0;
  }

  let text;
  try {
    text = readFileSync(datei, "utf-8");
  } catch (err) {
    return fail(`Paketdatei '${datei}' ist nicht lesbar: ${err.message}`);
  }

  const fehler = wirkungPruefen(text, Object.keys(config.spec.bereiche ?? {}), process.cwd());
  if (fehler.length === 0) {
    process.stdout.write(`${WIRKUNG_UEBERSCHRIFT} in ${datei}: ohne Befund.\n`);
    return 0;
  }

  for (const { nr, grund } of fehler) {
    // Der fehlende Abschnitt hat keine Zeile — dort bleibt das Praefix weg,
    // statt eine Zeilennummer zu erfinden, die niemand aufschlagen kann.
    const stelle = nr === null ? "" : `Zeile ${nr}: `;
    process.stderr.write(`${stelle}${grund}\n`);
  }
  return 1;
}

// --- luecken ----------------------------------------------------------------

const REGEX_SONDERZEICHEN = /[.+?^${}()|[\]\\]/;

/**
 * Minimal-Glob, Zeichen fuer Zeichen dieselbe Fassung wie in kit/checks.mjs:
 * '*' innerhalb eines Pfadsegments, '**' ueber Segmentgrenzen, '/' als Trenner.
 * Ein '**' samt folgendem Trenner darf ganz verschwinden, damit ein Muster wie
 * "doppelstern, Trenner, *.md" auch eine Datei im Wurzelverzeichnis trifft.
 *
 * Bewusst nachgebaut statt importiert: spec.mjs bleibt eine eigenstaendig
 * portable Datei (#440) und laesst sich einzeln in ein Projekt kopieren. Ein
 * Import aus checks.mjs waere genau die Abhaengigkeit, die das verhindert.
 * Wer eine der beiden Fassungen aendert, aendert die andere mit.
 */
function globZuRegex(muster) {
  let quelle = "";
  let i = 0;
  while (i < muster.length) {
    const zeichen = muster[i];
    if (zeichen !== "*") {
      quelle += REGEX_SONDERZEICHEN.test(zeichen) ? `\\${zeichen}` : zeichen;
      i += 1;
    } else if (muster[i + 1] === "*") {
      const mitTrenner = muster[i + 2] === "/";
      quelle += mitTrenner ? "(?:.*/)?" : ".*";
      i += mitTrenner ? 3 : 2;
    } else {
      quelle += "[^/]*";
      i += 1;
    }
  }
  return new RegExp(`^${quelle}$`);
}

/**
 * Verzeichnisse, die nie Punkte enthalten.
 *
 * '.git' ist die Buchhaltung des Repos und 'node_modules' fremder Code — beides
 * ist kein Verhalten, das dieses Projekt zusagt. Ohne diese Grenze flutete schon
 * ein Muster mit fuehrendem Doppelstern die Lueckenliste mit tausenden Dateien,
 * die niemand beschreiben will, und der Befund ginge darin unter.
 */
const KEINE_PUNKTE = new Set([".git", "node_modules"]);

/**
 * Alle Dateien unterhalb von `root`, als Pfade relativ zum Projekt-Root mit '/'
 * als Trenner — genau die Form, in der auch die Globs der Config sie sehen.
 *
 * Symlinks fallen durch die isFile()-Pruefung heraus: Ihnen zu folgen hiesse,
 * eine Datei doppelt zu zaehlen oder in einen Zyklus zu laufen.
 */
function dateienSammeln(root) {
  const gefunden = [];
  const offen = [""];

  while (offen.length > 0) {
    const rel = offen.pop();
    for (const eintrag of readdirSync(join(root, rel), { withFileTypes: true })) {
      const pfad = rel === "" ? eintrag.name : `${rel}/${eintrag.name}`;
      if (eintrag.isDirectory()) {
        if (!KEINE_PUNKTE.has(eintrag.name)) offen.push(pfad);
      } else if (eintrag.isFile()) {
        gefunden.push(pfad);
      }
    }
  }
  return gefunden;
}

/** Die Aussagen eines Bereichs; ohne Datei sind es keine (leere Beschreibung). */
function aussagenDesBereichs(bereich, root) {
  const pfad = join(specsPfad(root), `${bereich}.md`);
  if (!existsSync(pfad)) return [];
  return aussagenLesen(bereich, readFileSync(pfad, "utf-8"));
}

/**
 * Die Luecken eines Bereichs — und die entfallenen IDs, die sie beruehren.
 *
 * Keine Rueckwaerts-Rechnung: Es wird nicht abgeleitet, welche Aussage fehlen
 * *muesste*, sondern nur berichtet, welche Datei keine beruehrt. Was
 * zusammengehoert, weiss der Mensch (A8).
 *
 * Nur gueltige Aussagen beruehren (A15). Zaehlte eine entfallene mit, deckte
 * eine gestrichene Zusage den Punkt zu und die Luecke bliebe unsichtbar — der
 * Fehler ginge in die unsichere Richtung. Die entfallene ID wird trotzdem
 * genannt: Sie ist die Spur zu dem, was einmal galt.
 */
function bereichsLuecken(bereich, muster, dateien, root) {
  const regexe = (muster ?? []).map((m) => globZuRegex(m));
  const punkte = dateien.filter((p) => regexe.some((r) => r.test(p)));

  const aussagen = aussagenDesBereichs(bereich, root);
  const gueltig = aussagen.filter((a) => !a.entfallen);
  const entfallen = aussagen.filter((a) => a.entfallen);

  const offen = [];
  const spuren = new Set();
  for (const punkt of punkte) {
    if (gueltig.some((a) => a.aussage.includes(punkt))) continue;
    offen.push(punkt);
    for (const a of entfallen) if (a.aussage.includes(punkt)) spuren.add(a.id);
  }

  // Standardvergleich statt localeCompare, wie bei `bereiche()`: Die Reihenfolge
  // von localeCompare haengt an der Locale der Maschine, und zwei Laeufe muessen
  // ueberall dieselbe Liste ergeben.
  return { luecken: offen.sort(), entfallen: [...spuren].sort() };
}

/**
 * Die Bereichsnamen aus der Kommandozeile, in der Reihenfolge ihrer ersten
 * Nennung und ohne Dopplung.
 *
 * Beide Schreibweisen sind zulaessig — '--bereich a --bereich b' und
 * '--bereich a b': Der Plan schreibt die Signatur als '--bereich <name>…', das
 * Paket spricht von mehreren '--bereich'-Angaben. Ein '--bereich' ohne Wert ist
 * ein Fehler und keine stille Null, sonst verschwaende ein Vertipper einen
 * ganzen Bereich aus der Ausgabe, ohne dass es jemand merkt.
 */
function bereichArgumente(argv, bekannte) {
  const namen = [];

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--bereich") {
      fail(`Unerwartetes Argument: '${argv[i]}'. ${mitBekannten("Aufruf: node spec.mjs luecken --bereich <name>…", bekannte)}`);
    }
    const vorher = namen.length;
    while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      namen.push(argv[i + 1]);
      i += 1;
    }
    if (namen.length === vorher) fail(mitBekannten("'--bereich' braucht mindestens einen Bereichsnamen.", bekannte));
  }

  if (namen.length === 0) fail(mitBekannten("luecken verlangt --bereich <name>…", bekannte));
  return [...new Set(namen)];
}

function mitBekannten(satz, bekannte) {
  return `${satz} Bekannt sind: ${bekannte.join(", ")}.`;
}

/**
 * Nennt je Bereich die Dateien, zu denen die Beschreibung schweigt.
 *
 * Die Liste ist das Ergebnis, nicht ihr Inhalt: Ein Bereich ohne Luecken steht
 * mit `"luecken": []` in der Ausgabe. Fehlte er dort, waere nicht zu
 * unterscheiden, ob geprueft wurde und nichts fehlte, oder ob gar nicht geprueft
 * wurde — und die Beschreibung sieht im zweiten Fall aus wie Vollstaendigkeit.
 *
 * Die Ausgabe ist immer JSON und hat kein --json-Flag, wie `checks.mjs plan`:
 * Sie wird von Skills gelesen, nicht von Menschen. Meldungen gehen auf stderr.
 *
 * Der Schalter wird vor den Argumenten geprueft, obwohl der Fehlerfall damit
 * spaeter kommt: Die Meldung zu einem fehlenden oder falschen Bereichsnamen
 * nennt die bekannten Bereiche, und die kennt erst, wer die Config gelesen hat.
 * Ein Projekt ohne 'spec'-Block hat keine — dort endet der Lauf mit dem Hinweis,
 * nicht mit einer Liste, die es nicht gibt.
 */
function luecken(argv) {
  const config = configLesen();
  if (!config?.spec) {
    process.stderr.write(`Kein 'spec'-Block in ${CONFIG_DATEI} — es ist kein Verhalten beschrieben, zu dem etwas fehlen koennte.\n`);
    return 0;
  }

  const definiert = config.spec.bereiche;
  if (typeof definiert !== "object" || definiert === null || Array.isArray(definiert) || Object.keys(definiert).length === 0) {
    fail(`'spec.bereiche' in ${CONFIG_DATEI} ist leer oder kein Objekt — ein eingeschaltetes Projekt benennt mindestens einen Bereich.`);
  }

  const bekannte = Object.keys(definiert);
  const namen = bereichArgumente(argv, bekannte);
  const unbekannt = namen.filter((n) => !bekannte.includes(n));
  if (unbekannt.length > 0) {
    // Ein einziger vertippter Name bricht den ganzen Lauf ab, auch neben
    // richtigen: Eine Teilausgabe saehe aus wie ein vollstaendiges Ergebnis —
    // dieselbe Haltung wie checks.mjs bei einem unbekannten Bereichsnamen.
    fail(mitBekannten(`Unbekannte Bereiche: ${unbekannt.join(", ")}.`, bekannte));
  }

  // Der Baum wird einmal gelesen, nicht je Bereich: Die Punkte mehrerer Bereiche
  // ueberschneiden sich, und ein zweiter Durchlauf koennte einen anderen Stand
  // sehen als der erste.
  const root = process.cwd();
  const dateien = dateienSammeln(root);

  const bericht = {};
  for (const name of namen) bericht[name] = bereichsLuecken(name, definiert[name], dateien, root);

  process.stdout.write(`${JSON.stringify({ bereiche: bericht }, null, 2)}\n`);
  return 0;
}

// --- vorhaben ---------------------------------------------------------------

/**
 * Das Kuerzel wird zum Dateinamen — deshalb die Pruefung, nicht aus Ordnungsliebe:
 * Ohne sie schriebe '--kuerzel ../../x' ausserhalb von ${SPECS_DIR}/.
 */
const KUERZEL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Der Rueckfall auf ein Plandokument (A9), genau in dieser Schreibweise.
 *
 * Ein Toolbox-Shortcode koennte 'PLAN' heissen — das ist ein Vorhaben. Waere die
 * Erkennung locker (etwa auf 'plan' beginnend), wuerde so ein Vorhaben still zum
 * Plandokument umgedeutet, und die Notiz behauptete eine andere Einheit als die,
 * fuer die sie gilt.
 */
const RUECKFALL_RE = /^plan-(\d+)$/;

// Wortgleich fest, nicht gebaut: Die Zeile sagt, warum die Einheit nicht das
// Vorhaben ist, und wer sie spaeter sucht, sucht diesen einen Satz.
const RUECKFALL_HINWEIS = `- Hinweis: Plandokument statt Vorhaben, weil der Tracker keine Vorhaben kennt (A9).`;

const CODE_GELESEN_WERTE = ["ja", "nein"];

const VORHABEN_SCHALTER = ["--kuerzel", "--code-gelesen", "--grund"];

// Tagesdatum lokal statt per toISOString(), wie `heute()` in board.mjs: Eine
// Notiz um 23:30 MESZ traegt den Tag, an dem der Code gelesen wurde — in UTC
// waere er da schon gewechselt.
function heute() {
  const jetzt = new Date();
  const zweistellig = (n) => String(n).padStart(2, "0");
  return `${jetzt.getFullYear()}-${zweistellig(jetzt.getMonth() + 1)}-${zweistellig(jetzt.getDate())}`;
}

/**
 * Liest die Schalter als Paare '--name <wert>'.
 *
 * Ein unbekanntes Argument ist ein Fehler und keine stille Auslassung: Ein
 * vertipptes '--kuerzl' saehe sonst aus wie ein fehlendes Kuerzel, und ein
 * vertipptes '--grund' liesse die Notiz ohne Grund durchgehen, obwohl einer
 * angegeben war — dieselbe Haltung wie bei `bereichArgumente`.
 */
function vorhabenArgumente(argv) {
  const werte = new Map();

  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    if (!VORHABEN_SCHALTER.includes(name)) {
      fail(`Unerwartetes Argument: '${name}'. Erwartet: ${VORHABEN_SCHALTER.join(", ")}.`);
    }
    const wert = argv[i + 1];
    if (wert === undefined || wert.startsWith("--")) fail(`'${name}' braucht einen Wert.`);
    werte.set(name, wert);
  }
  return werte;
}

/**
 * Die geprueften Angaben des Aufrufs.
 *
 * `--code-gelesen` ist Pflicht und nimmt nur ja oder nein: Ein Feld, das man leer
 * lassen kann, ist kein Nachweis — und eine Notiz, die die Frage offen laesst,
 * saehe aus wie eine beantwortete.
 */
function vorhabenAngaben(argv) {
  const werte = vorhabenArgumente(argv);

  const kuerzel = werte.get("--kuerzel");
  if (!kuerzel) fail("vorhaben verlangt --kuerzel <k>.");
  if (!KUERZEL_RE.test(kuerzel)) {
    fail(`Das Kuerzel '${kuerzel}' enthaelt mehr als Buchstaben, Ziffern, '-' und '_' — es wird zum Dateinamen.`);
  }

  const codeGelesen = werte.get("--code-gelesen");
  if (!codeGelesen) fail("vorhaben verlangt --code-gelesen ja|nein.");
  if (!CODE_GELESEN_WERTE.includes(codeGelesen)) {
    fail(`'--code-gelesen' nimmt nur ${CODE_GELESEN_WERTE.join(" oder ")}, nicht '${codeGelesen}'.`);
  }

  return { kuerzel, codeGelesen, grund: werte.get("--grund") };
}

/**
 * Die Notiz als Text, in der Form aus A15.
 *
 * Welche Einheit gilt, steht in der Datei selbst — sonst ist spaeter nicht
 * erkennbar, worauf sich die Angabe bezieht: Ein Plandokument taucht nur auf,
 * weil der Tracker keine Vorhaben kennt, und wer die Notiz zwei Monate spaeter
 * liest, muss das sehen, ohne den Tracker von damals zu kennen.
 */
function vorhabenText({ kuerzel, codeGelesen, grund }) {
  const plan = RUECKFALL_RE.exec(kuerzel);
  const zeilen = [
    `# Vorhaben-Notiz ${kuerzel}`,
    plan ? "- Einheit: Plandokument" : "- Einheit: Vorhaben",
    plan ? `- Plan: ${plan[1]}` : `- Kuerzel: ${kuerzel}`,
    `- Code gelesen: ${codeGelesen}`,
  ];
  if (grund !== undefined) zeilen.push(`- Grund: ${grund}`);
  zeilen.push(`- Stand: ${heute()}`);
  if (plan) zeilen.push(RUECKFALL_HINWEIS);

  return `${zeilen.join("\n")}\n`;
}

/**
 * Schreibt die Notiz zum Code-Lesen.
 *
 * Die Datei wird vollstaendig neu geschrieben, kein Merge und kein Verlauf: Sie
 * sagt, was heute gilt. Ein zusammengefuehrter Stand behielte den Grund eines
 * frueheren Laufs neben einem 'nein' von heute — die Notiz behauptete dann eine
 * Begruendung, die niemand fuer sie gegeben hat.
 *
 * Ob der Rueckfall berechtigt ist, prueft das Kommando nicht: Es kennt den
 * Tracker nicht. Das entscheidet der Aufrufer (#447).
 */
function vorhaben(argv) {
  // Erst der Aufruf, dann der Schalter — wie bei `check`: Ein falscher Aufruf ist
  // ein Irrtum, gleich ob das Projekt Specs fuehrt.
  const angaben = vorhabenAngaben(argv);

  const config = configLesen();
  if (!config?.spec) {
    process.stderr.write(`Kein 'spec'-Block in ${CONFIG_DATEI} — es wird keine Vorhaben-Notiz geschrieben.\n`);
    return 0;
  }

  const verzeichnis = join(specsPfad(), VORHABEN_DIR);
  mkdirSync(verzeichnis, { recursive: true });

  const pfad = join(verzeichnis, `${angaben.kuerzel}.md`);
  const vorhanden = existsSync(pfad);
  writeFileSync(pfad, vorhabenText(angaben), "utf-8");

  const wort = vorhanden ? "aktualisiert" : "geschrieben";
  process.stdout.write(`Vorhaben-Notiz ${wort}: ${SPECS_DIR}/${VORHABEN_DIR}/${angaben.kuerzel}.md\n`);
  return 0;
}

// --- apply --anker (Issue #450) ---------------------------------------------

/**
 * Die Marke im Commit-Betreff, Zeichen fuer Zeichen dieselbe Regel wie in
 * tools/changelog.mjs: am Zeilenende und mit dem Wort 'Issue'.
 *
 * Gelesen wird allein die Betreffzeile. Der Commit-BODY zitiert regelmaessig
 * fremde Nummern ("siehe auch #431", "Refs #450"), und eine davon als Paket zu
 * werten hiesse, eine Wirkungsangabe aus einem Vorgang zu holen, der mit diesem
 * Commit nichts zu tun hat. Aus demselben Grund traegt das Muster das Wort
 * 'Issue': 'owner/repo#N' und ein blosses '#N' sind keine Marke.
 */
const MARKE_RE = /\(Issue #(\d+)\)$/;

function ohneShell(kommando, args) {
  return spawnSync(kommando, args, { cwd: process.cwd(), encoding: "utf-8" });
}

/**
 * Der Anker als voller SHA, oder null.
 *
 * Der leere Wert wird gar nicht erst gefragt — er ist die Spur einer
 * fehlgeschlagenen merge-base-Substitution im Skill. Anders als in checks.mjs
 * faellt `apply` dann NICHT auf vollen Umfang zurueck: Fuer eine Fortschreibung
 * gibt es keinen vollen Umfang, und ein Lauf ueber die ganze Historie schriebe
 * jede je gemachte Angabe erneut.
 */
function ankerAufloesen(ref) {
  if (ref === "") return null;
  const res = ohneShell("git", ["rev-parse", "--verify", `${ref}^{commit}`]);
  const sha = (res.stdout || "").trim();
  return res.status === 0 && sha ? sha : null;
}

/**
 * Die Paketnummern zwischen Anker und HEAD, aelteste zuerst und jede genau
 * einmal. Ein Paket darf mehrere Commits haben; gewertet wird es trotzdem nur
 * einmal, sonst haenge seine Wirkung so oft an, wie daran gearbeitet wurde.
 */
function paketNummern(anker) {
  const res = ohneShell("git", ["log", "--reverse", "--no-merges", "--format=%s", `${anker}..HEAD`]);
  if (res.status !== 0) fail(`git log ${anker}..HEAD schlug fehl: ${(res.stderr || "").trim()}`);

  const nummern = [];
  const gesehen = new Set();
  for (const zeile of res.stdout.split("\n")) {
    const treffer = MARKE_RE.exec(zeile.trim());
    if (!treffer || gesehen.has(treffer[1])) continue;
    gesehen.add(treffer[1]);
    nummern.push(treffer[1]);
  }
  return nummern;
}

/**
 * Der Body eines Pakets ueber den Adapter (A11).
 *
 * Ein nicht lesbarer Body ist ein Fehler und kein leeres Paket: Ein Ausfall des
 * Trackers saehe sonst aus wie ein Paket ohne Wirkung, und die Fortschreibung
 * liefe still an ihm vorbei — dieselbe Fehlerklasse, die am 2026-09-01 an Issue
 * #316 gefunden wurde.
 */
function paketLesen(nummer) {
  const res = ohneShell(process.execPath, [join(process.cwd(), ...BOARD_KOMMANDO), "issue", "get", nummer]);
  if (res.status !== 0) {
    const grund = (res.stderr || "").trim() || `der Adapter endete mit ${res.status}`;
    fail(`Paket #${nummer} ist nicht lesbar: ${grund}`);
  }
  try {
    return JSON.parse(res.stdout);
  } catch (err) {
    return fail(`Paket #${nummer} ist nicht lesbar: der Adapter lieferte kein JSON (${err.message}).`);
  }
}

/**
 * Der Aktivitaetsverlauf eines Pakets, ueber den Adapter (A11, Issue #460).
 *
 * Ist er nicht lesbar, ist das ein Fehler und kein leerer Verlauf: Eine leere Liste
 * hiesse „Karte ohne Anlage-Eintrag" und damit „aelter als `seit`" — ein Adapterfehler
 * wuerde so zu einem stillen Ueberspringen. Dieselbe Haltung wie beim unlesbaren Body.
 */
function verlaufLesen(nummer) {
  const res = ohneShell(process.execPath, [join(process.cwd(), ...BOARD_KOMMANDO), "issue", "activity", nummer]);
  if (res.status !== 0) {
    const grund = (res.stderr || "").trim() || `der Adapter endete mit ${res.status}`;
    fail(`Paket #${nummer}: Aktivitaetsverlauf nicht lesbar: ${grund}`);
  }
  try {
    return JSON.parse(res.stdout);
  } catch (err) {
    return fail(`Paket #${nummer}: Aktivitaetsverlauf nicht lesbar: der Adapter lieferte kein JSON (${err.message}).`);
  }
}

/**
 * Das Anlagedatum eines Pakets aus dem Aktivitaetsverlauf (A17, Issue #460).
 *
 * Die Karten-Route fuehrt kein Anlagedatum — an der Instanz belegt am 2026-09-02
 * (Issue #457). Der Verlauf fuehrt es: Der aelteste Eintrag vom Typ CREATED ist das
 * Anlegen.
 *
 * Drei Feinheiten, die alle drei aus dem Review von #460 stammen:
 *
 * 1. **Aeltester heisst kleinstes `createdAt`**, nicht `eintraege[0]`. Der Server
 *    sortiert heute aufsteigend, aber ein Test, der sich darauf verlaesst, prueft
 *    die Fixture statt den Code.
 * 2. **Nur CREATED zaehlt.** Der Verlauf existiert erst seit kanban-kit V13
 *    (2026-07-14) und wurde nicht rueckgefuellt. Eine alte, kuerzlich bewegte Karte
 *    haette als aeltesten Eintrag ein MOVED von letzter Woche — wer den aeltesten
 *    Eintrag beliebigen Typs naehme, hielte sie fuer neu.
 * 3. **Kein CREATED heisst: aelter als jedes `seit`.** Eine Karte aus der Zeit vor
 *    dem Verlauf soll nicht dauerhaft blockieren; `null` bedeutet hier „vor `seit`",
 *    nicht „unbekannt".
 */
export function anlagedatum(verlauf) {
  const angelegt = (Array.isArray(verlauf) ? verlauf : [])
    .filter((e) => e?.type === "CREATED" && typeof e.createdAt === "string" && e.createdAt !== "");
  if (angelegt.length === 0) return null;
  const aeltester = angelegt.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
  return aeltester.createdAt.slice(0, 10);
}

/**
 * Ob ein Paket gewertet wird (A18).
 *
 * `datum` ist `null`, wenn der Verlauf keinen CREATED-Eintrag traegt. Dann gilt das
 * Paket als **vor** `seit` angelegt und wird nicht gewertet — die Gegenrichtung
 * (im Zweifel werten) haette jede Karte aus der Zeit vor dem Verlauf dauerhaft
 * blockiert, ohne Reparaturweg.
 */
function gewertet(datum, seit) {
  if (typeof seit !== "string" || seit === "") return true;
  if (datum === null) return false;
  return datum >= seit;
}

// --- Der Sollzustand des Batches --------------------------------------------

/**
 * Fasst die Wirkungen aller Pakete zu einem Ziel je ID zusammen — in
 * Commit-Reihenfolge, aeltestes Paket zuerst.
 *
 * Der Umweg ueber ein Ziel statt der Anwendung Zeile fuer Zeile ist der Kern der
 * Idempotenz: Legt Paket 1 eine Aussage an und aendert Paket 2 sie, ist das Ziel
 * der geaenderte Text. Ein zweiter Lauf mit demselben Anker findet genau diesen
 * Text vor und hat nichts zu tun. Zeile fuer Zeile angewandt haette er dagegen
 * einen Konflikt gesehen — die Angabe von Paket 1 passt nach dem ersten Lauf
 * nicht mehr auf die Datei.
 */
function wirkungVerbuchen(ziele, form, nummer, befunde) {
  if (form.art === "KEINE") return;
  const vorhanden = ziele.get(form.id);

  if (form.art === "NEU") {
    if (vorhanden) {
      befunde.push(`Paket #${nummer}: Die ID '${form.id}' wird in diesem Bereich mehrfach vergeben.`);
      return;
    }
    ziele.set(form.id, {
      id: form.id, bereich: form.bereich, aussage: form.aussage,
      entfallen: false, neuVon: nummer, entfallenVon: null, paket: nummer,
    });
    return;
  }

  // GEAENDERT und ENTFAELLT knuepfen an ein Ziel an, das es noch nicht geben
  // muss: Beruehrt kein frueheres Paket die ID, steht sie schon in der Datei.
  const ziel = vorhanden ?? {
    id: form.id, bereich: praefix(form.id), aussage: null,
    entfallen: false, neuVon: null, entfallenVon: null,
  };
  if (form.art === "GEAENDERT") ziel.aussage = form.aussage;
  else {
    ziel.entfallen = true;
    ziel.entfallenVon = nummer;
  }
  ziel.paket = nummer;
  ziele.set(form.id, ziel);
}

function zielZustand(pakete, befunde) {
  const ziele = new Map();
  for (const { nummer, zeilen } of pakete) {
    for (const form of zeilen) wirkungVerbuchen(ziele, form, nummer, befunde);
  }
  return [...ziele.values()];
}

// --- Die Dateiform (A15) ----------------------------------------------------

function gueltigeZeile(id, aussage) {
  return `- ${id} — ${aussage}`;
}

function entfalleneZeile(id, aussage, datum, paket) {
  return `- ${id} — ${aussage} (entfallen ${datum}, Paket #${paket})`;
}

function entfallenIndex(zeilen) {
  return zeilen.findIndex((z) => ENTFALLEN_UEBERSCHRIFT_RE.test(z.trim()));
}

/**
 * Die Aussage einer ID in einer Datei, samt ihrer Zeile und ihrem Status.
 *
 * Ueber den Status entscheidet die Position zur Ueberschrift, nie das Suffix —
 * dieselbe Regel wie in `aussagenLesen`, und aus demselben Grund: Eine Zeile ohne
 * Klammerzusatz unterhalb der Ueberschrift ist gestrichen, sonst zaehlte ein
 * vergessener Zusatz sie wieder als gueltig.
 */
function aussageFinden(zeilen, id) {
  const grenze = entfallenIndex(zeilen);
  for (const [i, zeile] of zeilen.entries()) {
    const treffer = AUSSAGE_RE.exec(zeile);
    if (!treffer || treffer[1] !== id) continue;

    const entfallen = grenze !== -1 && i > grenze;
    const zusatz = entfallen ? ENTFALLEN_RE.exec(treffer[2]) : null;
    return {
      index: i, entfallen, zeile,
      aussage: zusatz ? zusatz[1] : treffer[2],
      datum: zusatz?.[2], paket: zusatz?.[3],
    };
  }
  return null;
}

/** Die letzte Aussagezeile in [von, bis), oder -1. */
function letzteAussage(zeilen, von, bis) {
  for (let i = bis - 1; i >= von; i -= 1) {
    if (AUSSAGE_RE.test(zeilen[i])) return i;
  }
  return -1;
}

/**
 * Haengt eine gueltige Aussage an: hinter die letzte gueltige, sonst unmittelbar
 * vor '## Entfallen' bzw. ans Dateiende. Die Aussage rutscht damit nie unter die
 * Ueberschrift — dort gaelte sie ab dem ersten Tag als gestrichen.
 */
function gueltigAnfuegen(zeilen, neu) {
  const kopf = entfallenIndex(zeilen);
  const grenze = kopf === -1 ? zeilen.length : kopf;
  const letzte = letzteAussage(zeilen, 0, grenze);
  if (letzte !== -1) {
    zeilen.splice(letzte + 1, 0, neu);
    return;
  }

  let stelle = grenze;
  while (stelle > 0 && zeilen[stelle - 1].trim() === "") stelle -= 1;
  zeilen.splice(stelle, 0, ...(stelle === 0 ? [neu] : ["", neu]));
}

/**
 * Haengt eine entfallene Aussage an und legt '## Entfallen' an, wenn es die
 * Ueberschrift noch nicht gibt.
 */
function entfallenAnfuegen(zeilen, neu) {
  if (entfallenIndex(zeilen) === -1) {
    let stelle = zeilen.length;
    while (stelle > 0 && zeilen[stelle - 1].trim() === "") stelle -= 1;
    zeilen.splice(stelle, 0, ...(stelle === 0 ? [ENTFALLEN_UEBERSCHRIFT] : ["", ENTFALLEN_UEBERSCHRIFT]));
  }

  const kopf = entfallenIndex(zeilen);
  const letzte = letzteAussage(zeilen, kopf + 1, zeilen.length);
  if (letzte !== -1) {
    zeilen.splice(letzte + 1, 0, neu);
    return;
  }

  let stelle = kopf + 1;
  while (stelle < zeilen.length && zeilen[stelle].trim() === "") stelle += 1;
  zeilen.splice(stelle, 0, ...(stelle === kopf + 1 ? ["", neu] : [neu]));
}

/** Genau ein abschliessender Zeilenumbruch, keine leeren Zeilen davor. */
function zusammenfuegen(zeilen) {
  const kopie = [...zeilen];
  while (kopie.length > 0 && kopie.at(-1).trim() === "") kopie.pop();
  return `${kopie.join("\n")}\n`;
}

/** Eine frisch angelegte Bereichsdatei, in der Form aus A15. */
function neueBereichsDatei(bereich) {
  return `# ${bereich}\n\n${ENTFALLEN_UEBERSCHRIFT}\n`;
}

/**
 * Die Soll-Zeile eines Ziels und der Befund, falls sie nicht gesetzt werden darf.
 *
 * Bei einer bereits entfallenen Aussage bleibt das Datum des ersten Laufs stehen,
 * solange dieselbe Paketnummer sie gestrichen hat: Sonst wanderte das Datum bei
 * jedem Lauf mit, und zwei Laeufe ueber Mitternacht ergaeben verschiedene
 * Dateien — die Idempotenz haenge an der Uhrzeit.
 */
function sollZeile(ziel, ist) {
  const aussage = ziel.aussage ?? ist?.aussage ?? "";
  if (!ziel.entfallen) return gueltigeZeile(ziel.id, aussage);

  const fortgeschrieben = ist?.entfallen && ist.paket === String(ziel.entfallenVon) && ist.datum;
  return entfalleneZeile(ziel.id, aussage, fortgeschrieben ? ist.datum : heute(), ziel.entfallenVon);
}

/**
 * Was einem Ziel im Weg steht — oder null.
 *
 * Der Konflikt bei `NEU` misst gegen die SOLL-Zeile, nicht gegen den Text der
 * Wirkungszeile: Nach einem ersten Lauf steht dort schon, was der Batch als
 * Ganzes will, und das ist kein Konflikt, sondern der Beweis, dass nichts zu tun
 * ist. Verschieden ist die Zeile nur, wenn die ID jemand anderem gehoert.
 */
function zielBefund(ziel, ist, soll) {
  if (ist === null) {
    if (ziel.neuVon !== null) return null;
    return `Paket #${ziel.paket}: Die ID '${ziel.id}' ist nicht vergeben.`;
  }
  if (ziel.neuVon !== null) {
    return ist.zeile === soll && ist.entfallen === ziel.entfallen
      ? null
      : `Paket #${ziel.neuVon}: Die ID '${ziel.id}' ist bereits vergeben und traegt einen anderen Text — IDs werden nie wiederverwendet (A13).`;
  }
  if (ist.entfallen && !(ziel.entfallen && ist.paket === String(ziel.entfallenVon))) {
    return `Paket #${ziel.paket}: Die ID '${ziel.id}' ist bereits entfallen.`;
  }
  return null;
}

/**
 * Schreibt die Ziele eines Bereichs in dessen Dateitext fort und gibt den neuen
 * Text zurueck — oder null, wenn nichts zu tun ist.
 */
function bereichFortschreiben(text, ziele, befunde) {
  const zeilen = text.split("\n");
  let veraendert = false;

  for (const ziel of ziele) {
    const ist = aussageFinden(zeilen, ziel.id);
    const soll = sollZeile(ziel, ist);

    const befund = zielBefund(ziel, ist, soll);
    if (befund !== null) befunde.push(befund);
    else veraendert = zielSetzen(zeilen, ziel, ist, soll) || veraendert;
  }

  if (!veraendert) return null;
  const neu = zusammenfuegen(zeilen);
  return neu === text ? null : neu;
}

/** Setzt ein Ziel in die Zeilen; false heisst: es stand schon so da. */
function zielSetzen(zeilen, ziel, ist, soll) {
  if (ist !== null && ist.entfallen === ziel.entfallen) {
    // Bleibt die Aussage auf ihrer Seite der Ueberschrift, wird sie an Ort und
    // Stelle ersetzt: Ihre Nachbarn haben mit dieser Aenderung nichts zu tun.
    if (ist.zeile === soll) return false;
    zeilen[ist.index] = soll;
    return true;
  }

  if (ist !== null) zeilen.splice(ist.index, 1);
  if (ziel.entfallen) entfallenAnfuegen(zeilen, soll);
  else gueltigAnfuegen(zeilen, soll);
  return true;
}

// --- Unified Diff -----------------------------------------------------------

/**
 * Das Diff-Skript zweier Zeilenlisten: je Eintrag ' ', '-' oder '+'.
 *
 * Gemeinsamer Anfang und gemeinsames Ende werden vorab abgezogen, damit die
 * quadratische Tabelle nur ueber den wirklich verschiedenen Teil laeuft — bei
 * einer angehaengten Aussage sind das zwei, drei Zeilen statt der ganzen Datei.
 */
function diffSkript(alt, neu) {
  let start = 0;
  while (start < alt.length && start < neu.length && alt[start] === neu[start]) start += 1;

  let endeAlt = alt.length;
  let endeNeu = neu.length;
  while (endeAlt > start && endeNeu > start && alt[endeAlt - 1] === neu[endeNeu - 1]) {
    endeAlt -= 1;
    endeNeu -= 1;
  }

  return [
    ...alt.slice(0, start).map((text) => ({ typ: " ", text })),
    ...lcsSkript(alt.slice(start, endeAlt), neu.slice(start, endeNeu)),
    ...alt.slice(endeAlt).map((text) => ({ typ: " ", text })),
  ];
}

function lcsSkript(a, b) {
  const tabelle = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      tabelle[i][j] = a[i] === b[j]
        ? tabelle[i + 1][j + 1] + 1
        : Math.max(tabelle[i + 1][j], tabelle[i][j + 1]);
    }
  }

  const skript = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      skript.push({ typ: " ", text: a[i] });
      i += 1;
      j += 1;
    } else if (tabelle[i + 1][j] >= tabelle[i][j + 1]) {
      skript.push({ typ: "-", text: a[i++] });
    } else {
      skript.push({ typ: "+", text: b[j++] });
    }
  }
  while (i < a.length) skript.push({ typ: "-", text: a[i++] });
  while (j < b.length) skript.push({ typ: "+", text: b[j++] });
  return skript;
}

const DIFF_KONTEXT = 3;

/** Die Bloecke des Skripts, die in einen Hunk gehoeren. */
function hunkGrenzen(skript) {
  const geaendert = skript.map((e, i) => (e.typ === " " ? -1 : i)).filter((i) => i >= 0);
  if (geaendert.length === 0) return [];

  const bloecke = [[geaendert[0]]];
  for (const i of geaendert.slice(1)) {
    if (i - bloecke.at(-1).at(-1) <= 2 * DIFF_KONTEXT + 1) bloecke.at(-1).push(i);
    else bloecke.push([i]);
  }
  return bloecke.map((block) => ({
    von: Math.max(0, block[0] - DIFF_KONTEXT),
    bis: Math.min(skript.length - 1, block.at(-1) + DIFF_KONTEXT),
  }));
}

/** Je Skript-Eintrag die alte und die neue Zeilennummer, beide 1-basiert. */
function zeilenNummern(skript) {
  let alt = 0;
  let neu = 0;
  return skript.map((eintrag) => {
    const stelle = { alt: alt + 1, neu: neu + 1 };
    if (eintrag.typ !== "+") alt += 1;
    if (eintrag.typ !== "-") neu += 1;
    return stelle;
  });
}

function hunkKopf(anzahl, stelle) {
  // Ein Hunk ohne Zeile auf einer Seite beginnt nach der Konvention des Formats
  // bei der Zeile davor — sonst zeigte er auf eine Zeile, die es nicht gibt.
  return `${anzahl === 0 ? stelle - 1 : stelle},${anzahl}`;
}

/**
 * Der Unified Diff zweier Texte, oder "" bei Gleichheit.
 * Eine neue Datei bekommt '/dev/null' als alte Seite, wie git es schreibt.
 */
function unifiedDiff(pfad, alt, neu) {
  if (alt === neu) return "";

  const skript = diffSkript(alt === null ? [] : alt.split("\n"), neu.split("\n"));
  const stellen = zeilenNummern(skript);

  const bloecke = hunkGrenzen(skript).map(({ von, bis }) => {
    const teil = skript.slice(von, bis + 1);
    const altAnzahl = teil.filter((e) => e.typ !== "+").length;
    const neuAnzahl = teil.filter((e) => e.typ !== "-").length;
    return [
      `@@ -${hunkKopf(altAnzahl, stellen[von].alt)} +${hunkKopf(neuAnzahl, stellen[von].neu)} @@`,
      ...teil.map((e) => `${e.typ}${e.text}`),
    ].join("\n");
  });

  return [`--- ${alt === null ? "/dev/null" : pfad}`, `+++ ${pfad}`, ...bloecke, ""].join("\n");
}

// --- Das Kommando -----------------------------------------------------------

function applyArgumente(argv) {
  let anker;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argv[i] !== "--anker") {
      fail(`Unerwartetes Argument: '${argv[i]}'. Aufruf: node spec.mjs apply --anker <sha> [--dry-run]`);
    }
    const wert = argv[i + 1];
    if (wert === undefined || wert.startsWith("--")) fail("'--anker' braucht einen Wert.");
    anker = wert;
    i += 1;
  }

  // Der leere Wert kommt durch: Er ist ein eigener Befund und wird beim
  // Aufloesen gemeldet, nicht hier als fehlender Schalter.
  if (anker === undefined) fail("apply verlangt --anker <sha>. Aufruf: node spec.mjs apply --anker <sha> [--dry-run]");
  return { anker, dryRun };
}

/**
 * Liest die Pakete des Bereichs und prueft die Form ihrer Wirkungsangaben.
 * Alles wird gelesen, bevor irgendetwas geschrieben wird (Atomaritaet).
 */
function paketeLesen(nummern, seit, bekannte, befunde) {
  const gewertete = [];

  for (const nummer of nummern) {
    const datum = anlagedatum(verlaufLesen(nummer));
    if (!gewertet(datum, seit)) {
      // Sichtbar, nicht still: Wer die Ausgabe liest, soll sehen, dass es das Paket
      // gibt und warum es nicht gewertet wurde.
      if (datum === null) process.stdout.write(`Paket #${nummer}: ohne Anlage-Eintrag, nicht gewertet.\n`);
      continue;
    }
    const paket = paketLesen(nummer);

    const fehler = wirkungPruefen(paket.body ?? "", bekannte);
    for (const { nr, grund } of fehler) {
      // Der fehlende Abschnitt hat keine Zeile — dort bleibt die Angabe weg,
      // statt eine Zeilennummer zu erfinden, wie bei `check`.
      const stelle = nr === null ? "" : `, Zeile ${nr}`;
      befunde.push(`Paket #${nummer}${stelle}: ${grund}`);
    }
    if (fehler.length > 0) continue;

    const { zeilen } = wirkungsZeilen(paket.body ?? "");
    gewertete.push({ nummer, zeilen: zeilen.map((z) => z.form) });
  }
  return gewertete;
}

/**
 * Berechnet den neuen Stand aller beruehrten Bereiche, ohne zu schreiben.
 * Rueckgabe: Map Bereich -> neuer Text. Fehlt ein Bereich darin, bleibt seine
 * Datei unangetastet.
 */
function standBerechnen(ziele, vorhanden, befunde) {
  const neu = new Map();

  for (const bereich of [...new Set(ziele.map((z) => z.bereich))]) {
    const alt = vorhanden.get(bereich) ?? neueBereichsDatei(bereich);
    const text = bereichFortschreiben(alt, ziele.filter((z) => z.bereich === bereich), befunde);
    if (text !== null) neu.set(bereich, text);
  }
  return neu;
}

function vorschauZeigen(vorhanden, neu, indexDiff) {
  const teile = [...neu.keys()].sort()
    .map((bereich) => unifiedDiff(bereichsDatei(bereich), vorhanden.get(bereich) ?? null, neu.get(bereich)));
  teile.push(indexDiff);

  const ausgabe = teile.filter((t) => t !== "").join("");
  process.stdout.write(ausgabe === "" ? "keine Aenderung\n" : ausgabe);
  return 0;
}

function standSchreiben(neu, indexText) {
  const verzeichnis = specsPfad();
  mkdirSync(verzeichnis, { recursive: true });

  for (const bereich of [...neu.keys()].sort()) {
    writeFileSync(join(verzeichnis, `${bereich}.md`), neu.get(bereich), "utf-8");
    process.stdout.write(`${bereichsDatei(bereich)} geschrieben.\n`);
  }
  if (indexText !== null) {
    writeFileSync(join(verzeichnis, INDEX_DATEI), indexText, "utf-8");
    process.stdout.write(`${SPECS_DIR}/${INDEX_DATEI} geschrieben.\n`);
  }
}

/**
 * Schreibt die Beschreibung aus den Wirkungsangaben der Pakete fort.
 *
 * Die Reihenfolge ist die ganze Zusage dieses Kommandos: Anker pruefen, alles
 * lesen, alles pruefen — und erst dann schreiben. Ein Befund an irgendeiner
 * Stelle endet mit Exit 1 und unveraenderten Dateien; ein halb fortgeschriebener
 * Stand saehe aus wie ein Ergebnis und waere keins.
 */
function apply(argv) {
  const { anker, dryRun } = applyArgumente(argv);

  // Vor jedem Lesen und Schreiben: Ein unbrauchbarer Anker ist kein Umfang, den
  // man notfalls weiter fasst, sondern eine Angabe, die fehlt.
  const basis = ankerAufloesen(anker);
  if (basis === null) fail(`Der Anker '${anker}' laesst sich nicht aufloesen — ohne ihn gibt es keinen Bereich, den 'apply' fortschreiben koennte.`);

  const config = configLesen();
  if (!config?.spec) {
    process.stderr.write(`Kein 'spec'-Block in ${CONFIG_DATEI} — die Beschreibung wird nicht fortgeschrieben.\n`);
    return 0;
  }

  const nummern = paketNummern(basis);
  if (nummern.length === 0) {
    process.stderr.write(`Kein Paket zwischen ${basis} und HEAD — nichts fortzuschreiben.\n`);
    return 0;
  }

  const befunde = [];
  const pakete = paketeLesen(nummern, config.spec.seit, Object.keys(config.spec.bereiche ?? {}), befunde);
  const ziele = zielZustand(pakete, befunde);

  const vorhanden = bereichsTexte();
  const neu = befunde.length === 0 ? standBerechnen(ziele, vorhanden, befunde) : new Map();

  if (befunde.length > 0) {
    for (const befund of befunde) process.stderr.write(`${befund}\n`);
    return 1;
  }

  // Der Index wird nur angefasst, wenn eine Bereichsdatei sich aendert: Sonst
  // schriebe ein Lauf ohne Wirkung an einer Datei, an der er nichts zu tun hat.
  const indexAlt = indexDatei();
  const indexNeu = neu.size === 0 ? indexAlt : indexAusTexten(new Map([...vorhanden, ...neu])).text;

  if (dryRun) {
    const indexDiff = indexNeu === indexAlt ? "" : unifiedDiff(`${SPECS_DIR}/${INDEX_DATEI}`, indexAlt, indexNeu);
    return vorschauZeigen(vorhanden, neu, indexDiff);
  }

  if (neu.size === 0) {
    process.stdout.write("keine Aenderung\n");
    return 0;
  }
  standSchreiben(neu, indexNeu === indexAlt ? null : indexNeu);
  return 0;
}

// --- check --anker: das Gate vor dem Push (Issue #451) -----------------------

// Der Platzhalter in 'spec.testPattern' und der Default, wenn das Feld fehlt
// (A5): der Verweis in eckigen Klammern, wie ihn die implement-Skills schreiben.
const ID_PLATZHALTER = "<ID>";
const TEST_PATTERN_DEFAULT = String.raw`\[<ID>\]`;

/** Eine Zeichenkette als Literal im regulaeren Ausdruck. */
function regexLiteral(text) {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Der Sucher nach Test-Verweisen — oder null, wenn nicht gesucht werden kann.
 *
 * null heisst 'nicht pruefbar' und ist kein leises Auslassen: Der Aufrufer macht
 * daraus einen Befund. 'spec.testGlobs' ist im Schema optional, und ein Gate,
 * das ohne Suchraum still oeffnete, waere genau die Fehlerklasse aus #316 — es
 * saehe aus wie ein sauberer Durchlauf.
 *
 * Die Dateien werden einmal gelesen, nicht je Aussage: Ein zweiter Durchlauf
 * koennte einen anderen Stand sehen als der erste — dieselbe Haltung wie bei
 * `luecken`.
 */
function verweisSucher(spec, root) {
  const globs = (Array.isArray(spec.testGlobs) ? spec.testGlobs : []).filter((m) => typeof m === "string" && m !== "");
  if (globs.length === 0) return null;

  const muster = typeof spec.testPattern === "string" && spec.testPattern !== ""
    ? spec.testPattern
    : TEST_PATTERN_DEFAULT;
  if (!muster.includes(ID_PLATZHALTER)) {
    fail(`'spec.testPattern' in ${CONFIG_DATEI} enthaelt den Platzhalter '${ID_PLATZHALTER}' nicht — ohne ihn faende die Suche jede ID oder keine.`);
  }

  const regexe = globs.map((m) => globZuRegex(m));
  const texte = dateienSammeln(root)
    .filter((pfad) => regexe.some((r) => r.test(pfad)))
    .map((pfad) => readFileSync(join(root, pfad), "utf-8"));

  return (id) => {
    let gesucht;
    try {
      gesucht = new RegExp(muster.replaceAll(ID_PLATZHALTER, regexLiteral(id)));
    } catch (err) {
      return fail(`'spec.testPattern' in ${CONFIG_DATEI} ist kein gueltiger regulaerer Ausdruck: ${err.message}`);
    }
    return texte.some((text) => gesucht.test(text));
  };
}

/** Die Aussagen eines Bereichs als Map ID -> Eintrag, je Bereich einmal gelesen. */
function aussagenWissen(root) {
  const bekannt = new Map();
  return (bereich) => {
    if (!bekannt.has(bereich)) {
      bekannt.set(bereich, new Map(aussagenDesBereichs(bereich, root).map((a) => [a.id, a])));
    }
    return bekannt.get(bereich);
  };
}

/**
 * Was zwischen Wirkungszeile und Beschreibung auseinandergeht — oder null.
 *
 * Gemessen wird gegen den Text, nicht nur gegen die Existenz der ID: Eine
 * Aussage mit derselben Nummer und anderem Wortlaut ist eine andere Zusage, und
 * genau die soll das Gate sehen. Bei ENTFAELLT zaehlt zusaetzlich die
 * Paketnummer im Klammerzusatz — sonst ginge eine Streichung als erledigt durch,
 * die ein ganz anderes Paket vorgenommen hat.
 */
function abweichung(form, nummer, aussagen) {
  const bereich = form.art === "NEU" ? form.bereich : praefix(form.id);
  const datei = bereichsDatei(bereich);
  const ist = aussagen(bereich).get(form.id);

  if (!ist) return `steht nicht in ${datei}`;

  if (form.art === "ENTFAELLT") {
    if (!ist.entfallen) return `steht in ${datei} noch oberhalb von '${ENTFALLEN_UEBERSCHRIFT}'`;
    return ist.paket === String(nummer)
      ? null
      : `steht in ${datei} unter '${ENTFALLEN_UEBERSCHRIFT}', aber mit Paket #${ist.paket ?? "(ohne Nummer)"}`;
  }

  if (ist.entfallen) return `steht in ${datei} unter '${ENTFALLEN_UEBERSCHRIFT}'`;
  return ist.aussage === form.aussage ? null : `traegt in ${datei} einen anderen Text: '${ist.aussage}'`;
}

/**
 * Pruefung 1 — stimmt die Beschreibung mit den Wirkungsangaben ueberein?
 *
 * Rueckgabe sind die Aussagen, die anschliessend einen Test-Verweis brauchen:
 * die neuen und die geaenderten. ENTFAELLT gehoert nicht dazu (A5) — was nicht
 * mehr gilt, wird nicht mehr belegt.
 *
 * Eine Aussage, die schon hier abweicht, wird nicht auch noch nach ihrem Test
 * gefragt: Zwei Befunde zu derselben Zeile sagen nichts, was der erste nicht
 * schon sagt.
 */
function uebereinstimmungPruefen(pakete, aussagen, befunde) {
  const zuBelegen = [];

  for (const { nummer, zeilen } of pakete) {
    for (const form of zeilen) {
      if (form.art === "KEINE") continue;

      const grund = abweichung(form, nummer, aussagen);
      if (grund !== null) {
        befunde.push(`Paket #${nummer}: Die Aussage '${form.id}' ${grund}.`);
        continue;
      }
      if (form.art !== "ENTFAELLT") zuBelegen.push({ nummer, id: form.id });
    }
  }
  return zuBelegen;
}

/**
 * Pruefung 2 — verweist auf jede neue oder geaenderte Aussage ein Test (A5)?
 *
 * Der Sucher wird erst gebaut, wenn es etwas zu belegen gibt: Sein Aufbau liest
 * den Dateibaum, und ein Batch ohne Wirkung hat daran nichts zu suchen.
 */
function verweisePruefen(zuBelegen, spec, root, befunde) {
  if (zuBelegen.length === 0) return;

  const sucher = verweisSucher(spec, root);
  for (const { nummer, id } of zuBelegen) {
    if (sucher === null) {
      befunde.push(`Paket #${nummer}: Der Test-Verweis auf '${id}' ist nicht pruefbar — 'spec.testGlobs' fehlt in ${CONFIG_DATEI}.`);
    } else if (!sucher(id)) {
      befunde.push(`Paket #${nummer}: Auf die Aussage '${id}' verweist kein Test (A5).`);
    }
  }
}

function paketWort(anzahl) {
  return `${anzahl} ${anzahl === 1 ? "Paket" : "Pakete"}`;
}

/**
 * Haelt den Push auf, wenn Paket und Beschreibung nicht zusammenpassen.
 *
 * Jeder Ausfallpfad endet rot: ein unbrauchbarer Anker, ein nicht lesbarer Body
 * (in `paketLesen`), ein fehlender Suchraum. Ein Gate, das bei Stoerung oeffnet,
 * ist schlimmer als keins — es bescheinigt eine Pruefung, die nicht stattfand.
 *
 * Nur der leere Bereich ist gruen, und auch der nennt den Anker: Sonst saehe ein
 * falscher Anker aus wie ein sauberer Lauf.
 */
function checkAnker(anker) {
  // Vor jedem Lesen, wie bei `apply`: Ein unbrauchbarer Anker ist kein Umfang,
  // den man notfalls weiter fasst, sondern eine Angabe, die fehlt.
  const basis = ankerAufloesen(anker);
  if (basis === null) fail(`Der Anker '${anker}' laesst sich nicht aufloesen — ohne ihn gibt es keinen Bereich, den das Gate pruefen koennte.`);

  const config = configLesen();
  if (!config?.spec) {
    process.stderr.write(`Kein 'spec'-Block in ${CONFIG_DATEI} — die Spec-Wirkung wird nicht geprueft.\n`);
    return 0;
  }

  const root = process.cwd();
  const befunde = [];
  const pakete = paketeLesen(paketNummern(basis), config.spec.seit, Object.keys(config.spec.bereiche ?? {}), befunde);

  verweisePruefen(uebereinstimmungPruefen(pakete, aussagenWissen(root), befunde), config.spec, root, befunde);

  if (befunde.length > 0) {
    for (const befund of befunde) process.stderr.write(`${befund}\n`);
    return 1;
  }
  process.stdout.write(`Anker ${basis}: ${paketWort(pakete.length)} gewertet, ohne Befund.\n`);
  return 0;
}

// --- CLI --------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return 0;
  }

  // Vor jedem Dateizugriff: --version muss auch dort antworten, wo nichts liegt
  // ausser dieser Datei — genau dort fragt man danach.
  if (argv[0] === "--version") {
    process.stdout.write(`spec.mjs (claude-workflow-kit v${KIT_VERSION})\n`);
    return 0;
  }

  // A19 an genau einer Stelle, vor jedem Kommando und vor jeder Argumentpruefung:
  // Sonst braeuchte der Test fuer `check --anker` und `apply` ein Git-Repo mit
  // aufloesbarem Anker, um ueberhaupt bis zur Abweisung zu kommen. `--help` und
  // `--version` sind oben schon beantwortet und damit ausgenommen.
  trackerPruefen();

  const [command, ...rest] = argv;
  if (command === "index") return index();
  if (command === "show") return show(rest[0]);
  if (command === "check") return check(rest);
  if (command === "luecken") return luecken(rest);
  if (command === "vorhaben") return vorhaben(rest);
  if (command === "apply") return apply(rest);

  // Keine Hilfe auf stdout wie bei board.mjs: `show` haelt stdout fuer seine
  // Aussagen frei, und ein Vertipper darf dort nichts hinterlassen.
  return fail(`Unbekannter Befehl: '${command}'. Erwartet: index, show, check, luecken, vorhaben oder apply — 'node spec.mjs --help' zeigt die Uebersicht.`);
}

// Nur als CLI ausfuehren, nicht beim Import (z. B. durch die node:test-Suite, #135).
// realpathSync statt resolve: Node loest fuer import.meta.url Symlinks auf (macOS:
// /var -> /private/var), ein nur normalisierter argv[1] wuerde dann nie matchen (#146).
let runAsCli = false;
if (process.argv[1]) {
  try {
    runAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { /* argv[1] nicht aufloesbar -> kein CLI-Start */ }
}
if (runAsCli) {
  try {
    process.exitCode = main();
  } catch (err) {
    const prefix = err instanceof SpecError ? "Fehler" : "Unerwarteter Fehler";
    process.stderr.write(`${prefix}: ${err.message}\n`);
    process.exit(1);
  }
}
