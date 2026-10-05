/**
 * board/testhinweise.mjs — Testhinweise fuer Plaene im Board-Werkzeug (Issue #1220, Plan #1199,
 * E17): die Test-Ablagen, die Aufloesung genannter Dateien und die Hinweise auf Tests, die ein
 * Plan zu seinen Bausteinen nicht nennt, samt dem Bestand der versionierten Dateien.
 *
 * Ein Teil von kit/board.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nie aus dem Einstieg: Der Einstieg laedt die Teile, ein Rueckimport waere
 * ein Zyklus. `pruefeForm` bleibt im Einstieg; es bestimmt die Stufe ueber `stufeAusTitel`
 * aus dem Teil issue-review.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { basename, extname } from "node:path";
import { spawnSync } from "node:child_process";

import { escapeRegex } from "./geschuetzt.mjs";

// ------------------------------------------------------------
// Testhinweise fuer Plaene (Issue #1031, Plan #1029)
// ------------------------------------------------------------

/**
 * Die Test-Ablagen, die ohne Einstellung gelten (A5): TypeScript mit `.test`/`.spec`
 * neben der Quelle, Java nach Maven-Gliederung. `{pfad}` steht fuer null oder mehr
 * Verzeichnisse, `{name}` fuer den Dateinamen ohne Endung, `*` im Test-Muster fuer
 * beliebige Zeichen innerhalb eines Segments.
 */
export const TEST_ABLAGEN_VORGABE = Object.freeze([
  { quelle: "{pfad}/{name}.ts", test: "{pfad}/{name}.test.ts" },
  { quelle: "{pfad}/{name}.ts", test: "{pfad}/{name}.spec.ts" },
  { quelle: "{pfad}/{name}.tsx", test: "{pfad}/{name}.test.tsx" },
  { quelle: "{pfad}/{name}.tsx", test: "{pfad}/{name}.spec.tsx" },
  { quelle: "src/main/java/{pfad}/{name}.java", test: "src/test/java/{pfad}/{name}Test.java" },
]);

/**
 * Die Ablagen eines Projekts aus `config.testAblagen`: fehlt das Feld, gelten die
 * Vorgaben; ein Array ersetzt sie; ein Eintrag `{ "vorgaben": true }` fuegt die
 * Vorgaben an dieser Stelle ein; `[]` schaltet die Pruefung ab. Die Form des Feldes
 * prueft das Schema — hier zaehlt nur, was als Paar lesbar ist.
 */
export function testAblagen(config) {
  const feld = config?.testAblagen;
  if (!Array.isArray(feld)) return [...TEST_ABLAGEN_VORGABE];
  return feld.flatMap((eintrag) => {
    if (eintrag?.vorgaben === true) return TEST_ABLAGEN_VORGABE;
    const gueltig = typeof eintrag?.quelle === "string" && eintrag.quelle !== ""
      && typeof eintrag?.test === "string" && eintrag.test !== "";
    return gueltig ? [{ quelle: eintrag.quelle, test: eintrag.test }] : [];
  });
}

const ABLAGE_TEIL = /\{pfad\}\/|\{pfad\}|\{name\}|\*/g;

/**
 * Ein Ablage-Muster als verankerter Ausdruck (A4). Ohne `feste` fangen die benannten
 * Gruppen `pfad` und `name` die Werte ein — `{pfad}/` darf dabei leer sein, die Gruppe
 * fehlt dann. Mit `feste` stehen dieselben Werte woertlich im Ausdruck: So findet das
 * Test-Muster genau die Tests, die zu der gefangenen Quelle gehoeren, ohne dass ein `*`
 * neben `{name}` die Grenze verschieben koennte.
 */
export function ablageAlsAusdruck(muster, feste = null) {
  const gesehen = new Set();
  const gruppe = (name, ausdruck) => {
    if (gesehen.has(name)) return String.raw`\k<${name}>`;
    gesehen.add(name);
    return `(?<${name}>${ausdruck})`;
  };
  const text = String(muster);
  let quelle = "";
  let letzte = 0;
  for (const m of text.matchAll(ABLAGE_TEIL)) {
    quelle += escapeRegex(text.slice(letzte, m.index)) + ablageTeilAlsAusdruck(m[0], feste, gruppe);
    letzte = m.index + m[0].length;
  }
  return new RegExp(`^${quelle}${escapeRegex(text.slice(letzte))}$`);
}

const ABLAGE_PFAD = "[^/]+(?:/[^/]+)*";

/** Ein Platzhalter der Ablage: gefangen (`gruppe`) oder mit dem festen Wert woertlich. */
function ablageTeilAlsAusdruck(teil, feste, gruppe) {
  if (teil === "*") return "[^/]*";
  if (teil === "{name}") return feste ? escapeRegex(feste.name) : gruppe("name", "[^/]+");
  if (teil === "{pfad}") return feste ? escapeRegex(feste.pfad) : gruppe("pfad", ABLAGE_PFAD);
  if (!feste) return `(?:${gruppe("pfad", ABLAGE_PFAD)}/)?`;
  return feste.pfad === "" ? "" : escapeRegex(`${feste.pfad}/`);
}

/** Der Dateiname ohne seine letzte Endung. */
function dateiStamm(datei) {
  const name = basename(datei);
  const ext = extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

/**
 * Das Verzeichnis, gegen das Nennungen aufgeloest werden (A8): jedes Pfad-Endstueck ab
 * einer Segmentgrenze und jeder Dateiname ohne Endung, beide auf die Dateien, die sie
 * bezeichnen. Eindeutig ist eine Nennung, wenn ihr Eintrag genau eine Datei traegt.
 */
export function nennungsVerzeichnis(dateien) {
  const endstuecke = new Map();
  const staemme = new Map();
  const eintragen = (karte, schluessel, datei) => {
    const liste = karte.get(schluessel);
    if (liste) liste.push(datei);
    else karte.set(schluessel, [datei]);
  };
  for (const datei of dateien) {
    const segmente = datei.split("/");
    for (let i = 0; i < segmente.length; i += 1) eintragen(endstuecke, segmente.slice(i).join("/"), datei);
    eintragen(staemme, dateiStamm(datei), datei);
  }
  return { endstuecke, staemme };
}

const NENNUNG_TOKEN = /[A-Za-z0-9_./-]+/g;

/** Punkt, Bindestrich und Schraegstrich am Tokenende gehoeren zum Satz, nicht zur Datei. */
function ohneSatzzeichenAmEnde(token) {
  let ende = token.length;
  while (ende > 0 && "./-".includes(token[ende - 1])) ende -= 1;
  return token.slice(0, ende);
}

/**
 * Die Dateien, die ein Text eindeutig nennt: Tokens aus Pfadzeichen, Satzzeichen am Ende
 * abgeschnitten, aufgeloest ueber das Endstueck und mit `stamm` auch ueber den Dateinamen
 * ohne Endung. Eine mehrdeutige Nennung zaehlt fuer keine der Dateien.
 */
export function genannteDateien(text, verzeichnis, { stamm = false } = {}) {
  const genannt = new Set();
  for (const [roh] of String(text).matchAll(NENNUNG_TOKEN)) {
    const token = ohneSatzzeichenAmEnde(roh.startsWith("./") ? roh.slice(2) : roh);
    if (token === "") continue;
    const treffer = verzeichnis.endstuecke.get(token) ?? (stamm ? verzeichnis.staemme.get(token) : undefined);
    if (treffer?.length === 1) genannt.add(treffer[0]);
  }
  return genannt;
}

// Nur hier fuehrt ein Plan seine Bausteine (A6); Ziel und Verifizierung erwaehnen nur.
const BAUSTEIN_ABSCHNITTE = new Set(["betroffene bereiche", "geplante aenderungen"]);

/**
 * Die Testhinweise eines Plans (A6 bis A9). Bausteine sind die Dateien, die
 * `## Betroffene Bereiche` und `## Geplante Aenderungen` ausserhalb von Codebloecken
 * mindestens mit Dateiname und Endung nennen. Je Baustein ergeben die Ablagen seine
 * eigenen Tests — nur existierende Dateien, die Quelle selbst nicht, keine Import-Analyse.
 * Ein Test gilt als genannt, wenn der ganze Body ihn eindeutig nennt, auch im Kopf und in
 * Codebloecken, auch nur mit seinem Stamm.
 */
export function pruefeTestNennung(abschnitte, body, dateien, config) {
  const ablagen = testAblagen(config);
  if (ablagen.length === 0 || dateien.length === 0) return [];
  const verzeichnis = nennungsVerzeichnis(dateien);
  const bausteinText = abschnitte.filter((a) => BAUSTEIN_ABSCHNITTE.has(a.titel)).flatMap((a) => a.zeilen).join("\n");
  const bausteine = genannteDateien(bausteinText, verzeichnis);
  if (bausteine.size === 0) return [];
  const genannt = genannteDateien(body, verzeichnis, { stamm: true });
  const hinweise = [];
  const gemeldet = new Set();
  for (const baustein of bausteine) {
    for (const ablage of ablagen) {
      const m = ablageAlsAusdruck(ablage.quelle).exec(baustein);
      if (!m) continue;
      const feste = { pfad: m.groups?.pfad ?? "", name: m.groups?.name ?? "" };
      const testAusdruck = ablageAlsAusdruck(ablage.test, feste);
      for (const test of dateien.filter((d) => testAusdruck.test(d))) {
        const schluessel = `${baustein}\n${test}`;
        if (test === baustein || genannt.has(test) || gemeldet.has(schluessel)) continue;
        gemeldet.add(schluessel);
        hinweise.push({
          baustein,
          test,
          meldung: `Zu ${baustein} gehört ${test}, der Plan nennt ihn nicht. Bleibt er grün, oder fehlt er in der Liste der Änderungen?`,
        });
      }
    }
  }
  return hinweise;
}

/**
 * Die versionierten Dateien des Projekts als Bestand der Testhinweise (A3, E5):
 * `git ls-files --full-name` liefert Pfade ab der Repo-Wurzel, auch aus einem
 * Unterverzeichnis. Ohne Repo gibt es keinen Bestand und damit keine Hinweise.
 */
export function versionierteDateien() {
  const res = spawnSync("git", ["ls-files", "--full-name", "-z"], {
    cwd: process.cwd(), encoding: "utf-8", maxBuffer: 256 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) return [];
  return res.stdout.split("\0").filter((d) => d !== "");
}
