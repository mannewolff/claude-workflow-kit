#!/usr/bin/env node
/**
 * claude-workflow-kit Spec-Werkzeug (Issue #440, #442, #445, #446, Plan #437)
 *
 * Liest das beschriebene Verhalten eines Projekts — eine Datei je Bereich unter
 * specs/ — und beantwortet fuenf Fragen: `index` schreibt die Uebersicht ueber
 * alle Bereiche, `show` gibt die Aussage zu einer einzelnen ID aus,
 * `check --paket` prueft die Form des Abschnitts `## Spec-Wirkung` eines
 * Arbeitspakets gegen die Grammatik aus A12, `luecken` sagt, wozu die
 * Beschreibung schweigt, und `vorhaben` haelt fest, ob fuer ein Vorhaben
 * Produktionscode gelesen wurde.
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
 * Keine Laufzeitabhaengigkeit ausserhalb der Node-Standardbibliothek, kein Netz,
 * kein Zugriff auf den Adapter: Die Datei ist eigenstaendig portabel und laesst
 * sich einzeln in ein Projekt kopieren, wie board.mjs, night.mjs und checks.mjs.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "1.44.0";

const SPECS_DIR = "specs";
const VORHABEN_DIR = "vorhaben";
const INDEX_DATEI = "INDEX.md";
const CONFIG_DATEI = ".claude/workflow.config.json";
const WIRKUNG_UEBERSCHRIFT = "## Spec-Wirkung";

const HELP = `spec.mjs (claude-workflow-kit v${KIT_VERSION}) — beschriebenes Verhalten lesen

  node spec.mjs index
  node spec.mjs show <id>
  node spec.mjs check --paket <datei>
  node spec.mjs luecken --bereich <name>…
  node spec.mjs vorhaben --kuerzel <k> --code-gelesen ja|nein [--grund <text>]

index   Schreibt ${SPECS_DIR}/${INDEX_DATEI} neu: eine Zeile je Bereich mit der Zahl der
        gueltigen und der entfallenen Aussagen. Fehlt ${SPECS_DIR}/, sagt das Kommando
        das und endet gruen.
show    Gibt die Aussage zu einer ID aus, mit Bereich und Status. Bei einer
        entfallenen Aussage auch Datum und Paketnummer.
check   Prueft den Abschnitt '${WIRKUNG_UEBERSCHRIFT}' einer Paketdatei: Zeilenform,
        bekannter Bereich, ID-Vergabe. Alle Befunde gehen auf stderr, je einer
        als 'Zeile <n>: <Grund>'; Exit 1, sobald einer vorliegt. Ohne
        'spec'-Block in ${CONFIG_DATEI} wird nicht geprueft.
luecken Nennt je Bereich die Dateien, die keine gueltige Aussage beruehrt —
        als JSON auf stdout, immer, auch mit leerer Liste. Eine Luecke ist ein
        Befund und kein Fehler: Exit 0. Die Bereichsnamen kommen aus
        'spec.bereiche'; ohne den Block wird nichts gemeldet.
vorhaben Schreibt ${SPECS_DIR}/${VORHABEN_DIR}/<kuerzel>.md neu: Einheit, Kuerzel bzw.
        Plannummer, ob Produktionscode gelesen wurde, der Grund und der Stand.
        Das Kuerzel kommt vom Aufrufer, nicht aus dem Tracker. Ohne
        'spec'-Block in ${CONFIG_DATEI} wird nichts geschrieben.

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
function index() {
  const verzeichnis = specsPfad();
  if (!existsSync(verzeichnis)) {
    process.stdout.write(`Kein ${SPECS_DIR}/ unter ${process.cwd()} — nichts zu indizieren.\n`);
    return 0;
  }

  const zeilen = bereiche().map((bereich) => {
    const aussagen = bereichLesen(bereich);
    const entfallen = aussagen.filter((a) => a.entfallen).length;
    return `| ${bereich} | ${bereichsDatei(bereich)} | ${aussagen.length - entfallen} | ${entfallen} |`;
  });

  const pfad = join(verzeichnis, INDEX_DATEI);
  writeFileSync(pfad, [...INDEX_KOPF, ...zeilen, ""].join("\n"), "utf-8");
  process.stdout.write(`${SPECS_DIR}/${INDEX_DATEI} geschrieben: ${zeilen.length} ${zeilen.length === 1 ? "Bereich" : "Bereiche"}.\n`);
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
const NEU_RE = /^NEU\s+(\S+)\s+(\S+-\d+)\s+—\s+\S/;
const GEAENDERT_RE = /^GEAENDERT\s+(\S+-\d+)\s+—\s+\S/;
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

/** Zerlegt eine Wirkungszeile; null heisst: keine der vier Formen. */
function zeileLesen(text) {
  const neu = NEU_RE.exec(text);
  if (neu) return { art: "NEU", bereich: neu[1], id: neu[2] };

  const geaendert = GEAENDERT_RE.exec(text);
  if (geaendert) return { art: "GEAENDERT", id: geaendert[1] };

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
 */
function neuFehler(form, wissen, bekannte) {
  const { bereich, id } = form;
  if (!bekannte.includes(bereich)) {
    return `Unbekannter Bereich '${bereich}'. Bekannt sind: ${bekannte.join(", ") || "keiner"}.`;
  }
  if (praefix(id) !== bereich) {
    return `Die ID '${id}' passt nicht zum Bereich '${bereich}' — eine ID hat die Form <bereich>-<N> (A16).`;
  }

  const zustand = wissen(bereich);
  if (zustand.gueltig.has(id)) return `Die ID '${id}' ist bereits vergeben.`;
  if (zustand.entfallen.has(id)) {
    return `Die ID '${id}' war schon vergeben und steht unter '## Entfallen' — IDs werden nie wiederverwendet (A13).`;
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
  return form.art === "NEU" ? neuFehler(form, wissen, bekannte) : bestandsFehler(form, wissen);
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
 * Alle Befunde des Abschnitts, nach Zeilennummer sortiert.
 *
 * Gemeldet wird jeder Befund, nicht nur der erste: Wer nach jedem Lauf einen
 * einzigen Fehler bekommt, braucht so viele Laeufe wie das Paket Fehler hat.
 */
function wirkungPruefen(text, bekannte, root = process.cwd()) {
  const abschnitt = wirkungsAbschnitt(text);
  if (!abschnitt) {
    return [{ nr: null, grund: `Abschnitt '${WIRKUNG_UEBERSCHRIFT}' fehlt — jedes Paket sagt, was es an der Beschreibung aendert.` }];
  }

  const gelesen = abschnitt.zeilen
    .filter((z) => z.text.trim() !== "")
    .map(({ nr, text: zeilenText }) => ({ nr, text: zeilenText.trim(), form: zeileLesen(zeilenText.trim()) }));

  if (gelesen.length === 0) {
    return [{ nr: abschnitt.kopf, grund: "Abschnitt ohne Wirkungszeile — wer nichts aendert, schreibt 'KEINE — <Begruendung>'." }];
  }

  const wissen = bereichsWissen(root);
  return [
    ...gelesen.filter((z) => !z.form).map(({ nr, text: zeilenText }) => ({ nr, grund: formFehler(zeilenText) })),
    ...gelesen.filter((z) => z.form)
      .map(({ nr, form }) => ({ nr, grund: inhaltsFehler(form, wissen, bekannte) }))
      .filter((f) => f.grund !== null),
    ...doppelteIds(gelesen),
    ...keineAllein(gelesen),
  ].sort((a, b) => a.nr - b.nr);
}

function paketArgument(argv) {
  const stelle = argv.indexOf("--paket");
  if (stelle === -1) fail("check verlangt --paket <datei>. Aufruf: node spec.mjs check --paket <datei>");

  const wert = argv[stelle + 1];
  if (!wert || wert.startsWith("--")) fail("--paket braucht eine Datei als Wert.");
  return wert;
}

/**
 * Prueft die Spec-Wirkung eines Arbeitspakets.
 *
 * Die Befunde gehen auf stderr, nicht auf stdout: `check` ist ein Pruefer, und
 * ein Skript, das seine Ausgabe liest, darf eine Fehlermeldung nie fuer ein
 * Ergebnis halten — dieselbe Trennung wie bei `show`.
 */
function check(argv) {
  const datei = paketArgument(argv);

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

  const fehler = wirkungPruefen(text, Object.keys(config.spec.bereiche ?? {}));
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

  const [command, ...rest] = argv;
  if (command === "index") return index();
  if (command === "show") return show(rest[0]);
  if (command === "check") return check(rest);
  if (command === "luecken") return luecken(rest);
  if (command === "vorhaben") return vorhaben(rest);

  // Keine Hilfe auf stdout wie bei board.mjs: `show` haelt stdout fuer seine
  // Aussagen frei, und ein Vertipper darf dort nichts hinterlassen.
  return fail(`Unbekannter Befehl: '${command}'. Erwartet: index, show, check, luecken oder vorhaben — 'node spec.mjs --help' zeigt die Uebersicht.`);
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
