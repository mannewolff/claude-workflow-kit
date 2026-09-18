// Die Seite der Einstellungs-Oberflaeche (Issue #678, Plan #674 E12, E13; Issue #725, Plan #721).
//
// Sie laedt nichts von fremden Servern: Schriften liegen eingebettet vor, und die
// Antwort traegt eine Content-Security-Policy ohne fremde Hosts. Das Token kommt aus dem
// URL-Fragment und geht nur als Kopfzeile an die API.
//
// Dazu der Rahmen aus Issue #725: Die Klassen des verbindlichen Entwurfs stehen im
// Seiten-CSS, das Browser-Skript ist kein einzelnes Literal mehr, sondern eine Folge
// benannter Bausteine, und der Redaktor eines Teils haengt am Teil statt am Schema. Geprueft
// wird das am Text der Seite und an den Bausteinen selbst — ein DOM-Werkzeug fuehrt das Kit
// nicht ein (Plan #721 E11), und was ohne Bildschirm auskommt, liegt ohnehin im Modul.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

import { SCHRIFTEN, SEITEN_BAUSTEINE, TEILE } from "../kit/einstellungen.mjs";
import { mitServer, projekt } from "./helpers/einstellungen-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Die Klassen, die der verbindliche Entwurf traegt und die Oberflaeche uebernimmt
 * (Issue #725, Aufgabe `SEITEN_CSS`). Die Gitter je Teil stehen mit darunter — sie sind der
 * Grund, warum `.zeile` ohne eigenes `grid-template-columns` auskommt.
 */
const ENTWURF_KLASSEN = [
  "tabelle", "zeile", "zeile-kopf", "zeile-warn", "zeile-neu", "griff", "rang",
  "chip", "chips", "dazu", "wahl", "stepper", "stufen", "budget-grid", "leiste",
  "fuss", "punkt", "befund-warn", "wirkung", "beispiel", "nutzung",
  "rev-grid", "paar-grid", "check-grid", "bereich-grid", "trig-grid",
];

const ENTWURF = readFileSync(join(repoRoot, "docs", "entwuerfe", "einstellungen-ohne-json.html"), "utf-8");

const klasseImCss = (css, klasse) => new RegExp(String.raw`\.${klasse}[\s,:.{>]`).test(css);

async function seite() {
  return mitServer((w) => projekt(w, "alpha", { stand: "1.0.0" }), async ({ basis }) => {
    const res = await fetch(`${basis}/`);
    return { status: res.status, csp: res.headers.get("content-security-policy"), html: await res.text() };
  });
}

test("[einstellungen-7] die Seite laedt nichts von fremden Servern", async () => {
  const { status, html } = await seite();
  assert.equal(status, 200);
  const ohneKommentare = html.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(ohneKommentare, /https?:\/\//, "eine URL ausserhalb eines Lizenzkommentars");
  assert.doesNotMatch(html, /rel="preconnect"/);
  assert.doesNotMatch(html, /@import/);
  assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/);
});

test("[einstellungen-7] drei Schriftfamilien liegen als eingebettete woff2 vor", async () => {
  const { html } = await seite();
  for (const familie of ["IBM Plex Sans", "IBM Plex Mono", "Archivo"]) {
    assert.match(html, new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*"${familie}"[^}]*src:\\s*url\\(data:font/woff2;base64,`), `${familie} fehlt`);
  }
});

test("[einstellungen-7] die eingebetteten Schriften gleichen den Dateien unter assets/fonts", () => {
  for (const [datei, b64] of Object.entries(SCHRIFTEN)) {
    const quelle = readFileSync(join(repoRoot, "assets", "fonts", datei));
    assert.equal(b64, quelle.toString("base64"), `${datei} weicht ab`);
  }
  assert.equal(Object.keys(SCHRIFTEN).length, 5);
});

test("[einstellungen-7] die hellen Farben der Kupferwarte, kein dunkles Schema", async () => {
  const { html } = await seite();
  for (const [name, wert] of [["--grund", "#E7E9ED"], ["--platte", "#FDFDFE"], ["--text", "#14181E"], ["--kupfer", "#A85F2C"]]) {
    assert.match(html, new RegExp(`${name}:\\s*${wert};`), `${name} fehlt`);
  }
  assert.doesNotMatch(html, /prefers-color-scheme:\s*dark/);
});

test("[einstellungen-7] die Seite liest das Token aus dem Fragment und sendet es als Kopfzeile", async () => {
  const { html } = await seite();
  assert.match(html, /location\.hash/);
  assert.match(html, /X-Einstellungen-Token/);
});

test("[einstellungen-7] die Antwort traegt eine Content-Security-Policy ohne fremde Hosts", async () => {
  const { csp } = await seite();
  assert.ok(csp, "keine Content-Security-Policy");
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(csp, /https?:|\*/);
});

test("[einstellungen-7] kit/einstellungen.mjs bleibt unter 1.500.000 Byte", () => {
  assert.ok(statSync(join(repoRoot, "kit", "einstellungen.mjs")).size < 1_500_000);
});

// ------------------------------------------------------------
// Der Rahmen (Issue #725)
// ------------------------------------------------------------

test("[einstellungen-7] die Klassen des verbindlichen Entwurfs stehen im Seiten-CSS", async () => {
  const { html } = await seite();
  const css = html.slice(html.indexOf("<style"), html.indexOf("</style>"));
  for (const klasse of ENTWURF_KLASSEN) {
    assert.ok(klasseImCss(css, klasse), `.${klasse} fehlt im Seiten-CSS`);
    assert.ok(klasseImCss(ENTWURF, klasse), `.${klasse} steht nicht im Entwurf — die Liste ist falsch`);
  }
  assert.match(css, /\.chip \.nr\b/, "der Nummernkreis des Chips fehlt");
  assert.match(css, /\.nr\.aus\b/, "die ausgegraute Form des Nummernkreises fehlt");
});

test("[einstellungen-7] das helle Schema des Entwurfs bleibt unveraendert", async () => {
  const { html } = await seite();
  // Der Rahmen bringt Klassen, kein neues Erscheinungsbild: Jede Farbe, die er benutzt, ist
  // eine der Variablen, die schon vorher galten.
  const css = html.slice(html.indexOf("<style"), html.indexOf("</style>"));
  const neueVariablen = [...css.matchAll(/^\s*(--[a-z-]+):/gm)].map((m) => m[1]);
  const imEntwurf = new Set([...ENTWURF.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]));
  for (const name of neueVariablen) assert.ok(imEntwurf.has(name), `${name} kennt der Entwurf nicht`);
});

test("[einstellungen-7] das Browser-Skript ist eine Folge benannter Bausteine, kein einzelnes Literal", async () => {
  const namen = Object.keys(SEITEN_BAUSTEINE);
  for (const pflicht of ["grundgeruest", "entwurf", "vorschau", "elemente", "platte", "start"]) {
    assert.ok(namen.includes(pflicht), `der Baustein ${pflicht} fehlt`);
  }
  for (const [name, stueck] of Object.entries(SEITEN_BAUSTEINE)) {
    assert.equal(typeof stueck, "string", name);
    assert.ok(stueck.trim().length > 0, `${name} ist leer`);
  }
  const { html } = await seite();
  const skript = html.slice(html.indexOf("<script"), html.indexOf("</script>"));
  // Die Seite liefert genau die Verkettung — kein Baustein faellt beim Ausliefern heraus,
  // und keiner kommt an der Liste vorbei dazu.
  assert.ok(skript.includes(Object.values(SEITEN_BAUSTEINE).join("\n")), "die Seite traegt nicht die Verkettung der Bausteine");
  assert.equal(namen.at(-1), "start", "der Start gehoert ans Ende");
});

test("[einstellungen-7] die verketteten Bausteine ergeben gueltiges JavaScript", () => {
  // Der Gewinn der Bausteine haette einen Preis, wenn die Verkettung unbemerkt kaputtgehen
  // koennte: Die Seite laedt, das Skript wirft, und kein Test sieht es. `vm.Script` uebersetzt
  // im selben Modus wie ein <script>-Element und fuehrt nichts aus — kein DOM noetig.
  const skript = Object.values(SEITEN_BAUSTEINE).join("\n");
  assert.doesNotThrow(() => new Script(skript, { filename: "SEITEN_SKRIPT" }));
});

test("[einstellungen-7] jeder Teil nennt einen Redaktor, den die Registry kennt", () => {
  const registry = SEITEN_BAUSTEINE.platte;
  assert.match(registry, /const REDAKTOREN = \{/);
  for (const teil of TEILE) {
    assert.match(registry, new RegExp(String.raw`\b${teil.redaktor}:`), `die Registry kennt ${teil.redaktor} nicht`);
  }
  assert.match(registry, /REDAKTOREN\[teil\.redaktor\]/, "der Redaktor wird nicht ueber den Teil gewaehlt");
  assert.doesNotMatch(registry, /eintrag\.schema/, "der Redaktor wird noch ueber das Schema gewaehlt");
});

test("[einstellungen-7] fuer ein bekanntes zusammengesetztes Feld entsteht kein Textblock in Dateischreibweise", () => {
  // Die Dateischreibweise steht als ein Bedienelement da und wird genau einmal benutzt: vom
  // Text-Redaktor. Fuer `night.modelle` und unbekannte Felder bleibt sie damit, fuer jedes
  // bekannte zusammengesetzte Feld faellt sie weg.
  const rufer = Object.entries(SEITEN_BAUSTEINE)
    .filter(([, stueck]) => /dateischreibweise\(/.test(stueck))
    .map(([name]) => name)
    .sort();
  assert.deepEqual(rufer, ["elemente", "redaktorText"]);
  assert.equal(TEILE.filter((t) => t.redaktor === "text").length, 1, "mehr als ein Teil zeigt die Dateischreibweise");
  for (const pfad of ["buildChecks", "checkAreas", "spec", "reviewStufen", "night.kette", "issueReview.reviewers", "issueReview.pairs", "triggers"]) {
    const teil = TEILE.find((t) => t.pfade.includes(pfad));
    assert.notEqual(teil.redaktor, "text", `${pfad} zeigt noch die Dateischreibweise`);
  }
});

test("[einstellungen-3] die Dreier-Anzeige entsteht nur, wo eine persoenliche Abweichung erlaubt ist", () => {
  const elemente = SEITEN_BAUSTEINE.elemente;
  assert.match(
    elemente,
    /function dreierAnzeige\(eintrag\) \{\s*if \(!eintrag\.persoenlichErlaubt\) return null;/,
    "die Dreier-Anzeige haengt nicht an persoenlichErlaubt",
  );
  // Nur dieses eine Bedienelement zeichnet die drei Ebenen — ein zweiter Ort waere ein
  // zweiter Weg, der die Regel umgehen koennte.
  const zeichner = Object.entries(SEITEN_BAUSTEINE)
    .filter(([, stueck]) => /Persönlich"/.test(stueck))
    .map(([name]) => name);
  assert.deepEqual(zeichner, ["elemente"]);
});

test("[einstellungen-7] die Arbeitskopie eines Teils traegt die offenen Aenderungen und faellt beim Verwerfen zurueck", () => {
  const entwurf = SEITEN_BAUSTEINE.entwurf;
  assert.match(entwurf, /function wertVon\(teil, pfad\)/, "kein Lesen aus der Arbeitskopie");
  assert.match(entwurf, /function setzeWert\(teil, pfad, wert\)/, "kein Schreiben in die Arbeitskopie");
  assert.match(entwurf, /function verwirf\(teil\)/, "kein Verwerfen");
  assert.match(SEITEN_BAUSTEINE.grundgeruest, /function zeichne\(\)/);
  // Ein Redaktor darf die geladenen Werte nicht mehr unmittelbar nehmen: Was gezeichnet wird,
  // kommt aus der Arbeitskopie, sonst waere eine offene Aenderung nach dem naechsten
  // Neuzeichnen wieder weg.
  const lesend = Object.entries(SEITEN_BAUSTEINE).filter(([name, stueck]) => name.startsWith("redaktor") && /wertVon\(/.test(stueck));
  assert.ok(lesend.length > 0, "kein Redaktor liest aus der Arbeitskopie");
  // Der Fuss zaehlt, was offen ist, und das Verwerfen haengt an ihm.
  assert.match(SEITEN_BAUSTEINE.vorschau, /verwirf\(teil\)/, "der Fuss verwirft nicht");
  assert.match(SEITEN_BAUSTEINE.vorschau, /offenePfade\(teil\)/, "der Fuss zaehlt die offenen Aenderungen nicht");
});

test("[einstellungen-7] die Vorschau wird entprellt angefordert und ihre Befunde gehen an die Zeilen", () => {
  const stueck = SEITEN_BAUSTEINE.vorschau;
  assert.match(stueck, /setTimeout/, "die Vorschau wird nicht entprellt");
  assert.match(stueck, /clearTimeout/, "ein zweiter Tastendruck loescht den Lauf nicht");
  assert.match(stueck, /\/vorschau/, "der Vorschau-Endpunkt wird nicht gerufen");
  assert.match(stueck, /function befundeFuer\(teil, pfad\)/, "die Befunde werden nicht je Zeile verteilt");
  assert.match(stueck, /function fuss\(teil\)/, "der Fuss eines Teils fehlt");
});

test("[einstellungen-7] die gemeinsamen Bedienelemente stehen als eigene Bausteine bereit", () => {
  const elemente = SEITEN_BAUSTEINE.elemente;
  for (const name of ["zeilentabelle", "chipListe", "zaehler", "musterListe", "feldMitVorgabe", "dreierAnzeige", "fehlerzeile", "dateischreibweise", "eingabe"]) {
    assert.match(elemente, new RegExp(String.raw`function ${name}\(`), `das Bedienelement ${name} fehlt`);
  }
  // Die markierte Fehlerzeile ist dasselbe Element fuer alle drei Faelle aus Kriterium 4a:
  // Sie nimmt den Befund entgegen und laesst genau zwei Wege offen.
  assert.match(elemente, /function fehlerzeile\(\{[^}]*grund/, "die Fehlerzeile nimmt keinen Grund entgegen");
  assert.match(elemente, /zeile-warn/, "die Fehlerzeile ist nicht markiert");
});
