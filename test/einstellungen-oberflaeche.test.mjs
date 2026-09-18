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

import { aenderungsliste, bereichsFolgen, checkSetzen, LAUFARTEN, paarungsFolgen, ROLLEN_KATALOG, SCHEMA, SCHRIFTEN, SEITEN_BAUSTEINE, TEILE, vorgabeAus } from "../kit/einstellungen.mjs";
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

// ------------------------------------------------------------
// M1 Reviewer und M2 Paarungen (Issue #726)
// ------------------------------------------------------------

test("[einstellungen-12] die Folgen-Rechnung des Browsers ist die Fassung des Moduls, keine zweite", () => {
  // Waere sie abgeschrieben, laege die Fassung, die der Mensch bedient, ungeprueft im
  // Zeichenketten-Literal — genau der Grund, aus dem die abgeleiteten Anzeigen im Modul stehen.
  assert.ok(SEITEN_BAUSTEINE.folgen.includes(paarungsFolgen.toString()), "der Baustein traegt eine andere Fassung als das Modul");
  assert.match(SEITEN_BAUSTEINE.redaktorReviewer, /paarungsFolgen\(/, "der Reviewer-Redaktor rechnet die Folgen nicht");
});

test("[einstellungen-12] die Registry fuehrt die Redaktoren von M1 und M2 aus", () => {
  const registry = SEITEN_BAUSTEINE.platte;
  assert.match(registry, /reviewer: redaktorReviewer/, "M1 haengt noch am Platzhalter");
  assert.match(registry, /paarungen: redaktorPaarungen/, "M2 haengt noch am Platzhalter");
  assert.match(SEITEN_BAUSTEINE.redaktorReviewer, /function redaktorReviewer\(teil\)/);
  assert.match(SEITEN_BAUSTEINE.redaktorPaarungen, /function redaktorPaarungen\(teil\)/);
});

test("[einstellungen-12] M1 zeigt Schalter, Rangtabelle und das Kommandofeld nur bei der Art Kommando", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorReviewer;
  assert.match(stueck, /issueReview\.requiredBeforeReady/, "der Schalter fuer die Review-Pflicht fehlt");
  assert.match(stueck, /rev-grid/, "die Tabelle nutzt nicht das Gitter des Entwurfs");
  assert.match(stueck, /"rang"/, "die Rangnummer fehlt");
  assert.match(stueck, /verschieben:/, "die Reihenfolge laesst sich nicht aendern");
  assert.match(stueck, /kind === "command"/, "das Kommandofeld haengt nicht an der Art");
  assert.match(stueck, /zeile-neu/, "es gibt keine Zeile zum Hinzufuegen");
  // Ergaenzen statt neu bauen (Plan E9, Kriterium 4): Was die Tabelle nicht zeigt, bleibt stehen.
  assert.match(stueck, /Object\.assign\(\{\}, /, "der Eintrag wird neu gebaut statt ergaenzt");
});

test("[einstellungen-12] M1 legt die Folgen einer Entfernung der Rueckfrage vor", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorReviewer;
  assert.match(stueck, /dialog\(/, "es gibt keine Rueckfrage");
  assert.match(stueck, /betroffen/, "die Rueckfrage nennt die betroffenen Zeilen nicht");
  // Die Folge landet in der Arbeitskopie desselben Teils — sie wird mit ihm gespeichert
  // oder mit ihm verworfen (Kriterium 9a).
  assert.match(stueck, /setzeWert\(teil, "issueReview\.pairs"/, "die Folge landet nicht in der Arbeitskopie von M1");
});

test("[einstellungen-12] der Reviewer-Teil traegt die Paarungen als Folgepfad", () => {
  const m1 = TEILE.find((t) => t.kennung === "m1");
  assert.deepEqual(m1.folgen, ["issueReview.pairs"]);
  // Kein zweiter Teil beansprucht den Pfad als eigenen — bearbeitet wird er in M2.
  assert.equal(TEILE.find((t) => t.pfade.includes("issueReview.pairs")).kennung, "m2");
});

test("[einstellungen-12] M2 zeichnet je Autor eine Zeile mit Chips und der Wirkung", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorPaarungen;
  assert.match(stueck, /paar-grid/, "die Tabelle nutzt nicht das Gitter des Entwurfs");
  assert.match(stueck, /"issueReview\.pairs\." \+ autor/, "die Zeile nennt ihren Pfad nicht");
  assert.match(stueck, /chipListe\(/, "die Pruefer stehen nicht als Chips");
  assert.match(stueck, /abgeleitetVon\(teil\)/, "die Wirkung kommt nicht aus der Vorschau");
  assert.match(stueck, /unterbesetzt/, "eine unterbesetzte Stufe wird nicht genannt");
  assert.match(stueck, /fehlerzeile\(/, "ein unbekannter Autor steht nicht als markierte Fehlerzeile da");
  assert.match(stueck, /vorschauAnfordern\(teil\)/, "die Wirkung steht erst nach der ersten Aenderung da");
});

test("[einstellungen-12] M2 bietet als Pruefer nur Namen aus der Reviewer-Tabelle an", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorPaarungen;
  assert.match(stueck, /function reviewerNamen\(\)/, "die Namensquelle fehlt");
  assert.match(stueck, /issueReview\.reviewers/, "die Namen kommen nicht aus der Reviewer-Tabelle");
  assert.match(stueck, /n !== autor/, "der Autor steht als eigener Pruefer zur Wahl");
  assert.match(stueck, /indexOf\(n\) < 0/, "ein Name, der schon in der Zeile steht, steht erneut zur Wahl");
});

/**
 * Was ein Browser-Skript von aussen braucht. Alles andere muss es selbst deklarieren —
 * `vm.Script` sieht nur die Form, ein Aufruf ins Leere faellt erst im Browser auf.
 */
const BROWSER_GLOBALE = new Set([
  "fetch", "setTimeout", "clearTimeout", "String", "Number", "Boolean", "RegExp", "Set", "Map",
  "URLSearchParams", "Error", "Promise", "encodeURIComponent", "decodeURIComponent", "isNaN",
  "parseInt", "parseFloat",
]);
const SCHLUESSELWORT = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "do", "else",
  "await", "in", "of", "delete", "void", "instanceof", "throw", "yield",
]);

test("[einstellungen-12] jede Funktion, die ein Baustein ruft, steht auch in einem", () => {
  const skript = Object.values(SEITEN_BAUSTEINE).join("\n");
  // Kommentare und Zeichenketten fallen weg: Ein Funktionsname in einem Satz ist kein Aufruf.
  const kern = skript
    .replaceAll(/\/\*[\s\S]*?\*\//g, " ")
    .replaceAll(/\/\/[^\n]*/g, " ")
    .replaceAll(/"(?:[^"\\]|\\.)*"/g, '""');
  const deklariert = new Set([...kern.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  for (const m of kern.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) deklariert.add(m[1]);
  // Parameter zaehlen mit: Ein uebergebenes `verschieben` wird gerufen, ohne deklariert zu sein.
  for (const m of kern.matchAll(/function\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)|function\s*\(([^)]*)\)/g)) {
    for (const name of (m[1] ?? m[2] ?? "").match(/[A-Za-z_$][\w$]*/g) ?? []) deklariert.add(name);
  }
  const gerufen = [...kern.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  const offen = [...new Set(gerufen)].filter((n) => !deklariert.has(n) && !SCHLUESSELWORT.has(n) && !BROWSER_GLOBALE.has(n)).sort();
  assert.deepEqual(offen, [], `im Browser-Skript gerufen, aber nirgends deklariert: ${offen.join(", ")}`);
});

test("[einstellungen-12] ein Folgepfad kommt in die Aenderungsliste seines Teils", () => {
  const alt = { issueReview: { reviewers: [{ name: "a", kind: "claude" }], pairs: { b: ["a"] } } };
  const neu = { issueReview: { reviewers: [{ name: "c", kind: "claude" }], pairs: { b: ["c"] } } };
  const pfade = new Set(aenderungsliste(alt, neu, "m1").map((a) => a.pfad));
  assert.ok(pfade.has("issueReview.reviewers[0].name"), [...pfade].join(", "));
  assert.ok(pfade.has("issueReview.pairs.b[0]"), [...pfade].join(", "));
  // Der Paarungs-Teil bleibt bei seinem eigenen Pfad — er kennt keinen Folgepfad.
  assert.deepEqual(aenderungsliste(alt, neu, "m2").map((a) => a.pfad), ["issueReview.pairs.b[0]"]);
});

// ------------------------------------------------------------
// M3 Pruefstufen (Issue #727)
// ------------------------------------------------------------

test("[einstellungen-9] die Registry fuehrt den Redaktor von M3 aus, keinen Platzhalter mehr", () => {
  const registry = SEITEN_BAUSTEINE.platte;
  assert.match(registry, /pruefstufen: redaktorPruefstufen/, "M3 haengt noch am Platzhalter redaktorEntsteht");
  assert.match(SEITEN_BAUSTEINE.redaktorPruefstufen, /function redaktorPruefstufen\(teil\)/);
});

test("[einstellungen-9] M3 zeichnet drei Stufen mit Zaehler und Rollenauswahl aus dem Katalog", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorPruefstufen;
  assert.match(stueck, /"stufen"/, "das Gitter .stufen des Entwurfs fehlt");
  assert.match(stueck, /zaehler\(/, "der Zaehler fuer die Reviewerzahl fehlt");
  assert.match(stueck, /max: kat\.length/, "der Zaehler waechst ueber den Rollenkatalog der Stufe hinaus");
  assert.match(stueck, /fehlerzeile\(/, "ein Rollenname ausserhalb des Katalogs steht nicht als markierte Fehlerzeile da");
  assert.match(stueck, /abgeleitetVon\(teil\)\.beispiel/, "die Beispielbesetzung kommt nicht aus der Vorschau");
  assert.match(stueck, /vorschauAnfordern\(teil\)/, "die Beispielbesetzung steht nicht erst nach der ersten Anfrage da");
});

test("[einstellungen-9] eine Stufe ohne eigene Einstellung zeigt die Bestandsvorgabe blass und legt nichts an", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorPruefstufen;
  assert.match(stueck, /reviewStufenVon\(teil\)/, "die Unterscheidung Block vorhanden/fehlend fehlt");
  assert.match(stueck, /istVorgabe/, "die Vorgabe-Anzeige fehlt");
  assert.match(stueck, /eintrag\.vorgabe/, "die Vorgabe kommt nicht aus dem geladenen Eintrag");
});

test("[einstellungen-9] eine Aenderung an einer Stufe legt die anderen mit den Katalogrollen an, nicht mit der Bestandsvorgabe", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorPruefstufen;
  assert.match(stueck, /function stufeSetzen\(teil, stufe, eintrag, neuZeichnen\)/, "stufeSetzen fehlt");
  assert.match(stueck, /reviewer: kat\.length, rollen: kat\.slice\(\)/, "eine fehlende Stufe entsteht nicht mit den Katalogrollen");
});

test("[einstellungen-9] der eingebettete Rollenkatalog des Browsers ist aus ROLLEN_KATALOG gerechnet, kein zweites Literal", () => {
  const eingebettet = JSON.stringify(ROLLEN_KATALOG);
  assert.ok(SEITEN_BAUSTEINE.redaktorPruefstufen.includes(`const ROLLEN_KATALOG_BROWSER = ${eingebettet};`), "der Katalog im Browser-Skript weicht von ROLLEN_KATALOG ab");
});

// ------------------------------------------------------------
// M4 Pruefkommandos und Bereiche (Issue #728)
// ------------------------------------------------------------

test("[einstellungen-9] die Registry fuehrt den Redaktor von M4 aus, keinen Platzhalter mehr", () => {
  const registry = SEITEN_BAUSTEINE.platte;
  assert.match(registry, /pruefkommandos: redaktorPruefkommandos/, "M4 haengt noch am Platzhalter redaktorEntsteht");
  assert.match(SEITEN_BAUSTEINE.redaktorPruefkommandos, /function redaktorPruefkommandos\(teil\)/);
});

test("[einstellungen-2] die Formrechnung des Browsers ist die Fassung des Moduls, keine zweite", () => {
  // Wie bei den Paarungen: Abgeschrieben laege die Fassung, die der Mensch bedient, ungeprueft
  // im Zeichenketten-Literal. Formtreue und Bereichsfolgen sind genau die Regeln, die ein
  // Test halten muss.
  for (const f of [checkSetzen, bereichsFolgen]) {
    assert.ok(SEITEN_BAUSTEINE.checkformen.includes(f.toString()), `der Baustein traegt eine andere Fassung als ${f.name}`);
  }
  assert.match(SEITEN_BAUSTEINE.redaktorPruefkommandos, /checkSetzen\(/, "der Redaktor setzt die Form nicht ueber checkSetzen");
  assert.match(SEITEN_BAUSTEINE.redaktorPruefkommandos, /bereichsFolgen\(/, "der Redaktor rechnet die Folgen einer Bereichs-Aenderung nicht");
});

test("[einstellungen-2] M4 bietet die drei Laufarten an und haelt die Form einer unveraenderten Zeile", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorPruefkommandos;
  assert.match(stueck, /check-grid/, "die Kommando-Tabelle nutzt nicht das Gitter des Entwurfs");
  for (const paar of LAUFARTEN) assert.ok(stueck.includes(JSON.stringify(paar[1])), `die Laufart ${paar[1]} fehlt`);
  // Kein zweites Literal: Die Aufschriften kommen aus LAUFARTEN desselben Moduls.
  assert.ok(stueck.includes(`const LAUFART_TEXTE = ${JSON.stringify(LAUFARTEN)};`), "die Laufarten des Browser-Skripts weichen von LAUFARTEN ab");
  assert.match(stueck, /verschieben:/, "die Reihenfolge der Kommandos laesst sich nicht aendern");
  assert.match(stueck, /zeile-neu/, "es gibt keine Zeile zum Hinzufuegen");
  // Die Form entsteht nie im Redaktor: Er ruft checkSetzen und schreibt nie always oder areas
  // von Hand an einen Eintrag.
  assert.doesNotMatch(stueck, /always:/, "der Redaktor setzt always von Hand statt ueber checkSetzen");
});

test("[einstellungen-2] M4 nennt bei einer Zeile ohne Bereich, dass das Kommando nie liefe", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorPruefkommandos;
  // Das Schema sperrt ein leeres `areas` schon (Plan E7) — es meldet aber nur "passt auf keine
  // der erlaubten Formen". Der Grundtext kommt vom Redaktor (Kriterium 19).
  assert.match(stueck, /nie/, "der Satz zum Kommando, das nie liefe, fehlt");
  assert.match(stueck, /befund/, "der Satz steht nicht als Befund an der Zeile");
  // Nur bekannte Bereiche stehen zur Wahl (Kriterium 19), ein unbekannter als Geist-Chip
  // mit genau zwei Wegen (Kriterium 4a).
  assert.match(stueck, /fremd:/, "ein Bereich, den checkAreas nicht kennt, steht nicht als Geist da");
  assert.match(stueck, /ersetzen:/, "ein unbekannter Bereich laesst sich nicht ersetzen");
});

test("[einstellungen-13] M4 zeichnet die Bereiche mit Mustern, Nutzung und der Rueckfrage beim Entfernen", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorPruefkommandos;
  assert.match(stueck, /bereich-grid/, "die Bereichstabelle nutzt nicht das Gitter des Entwurfs");
  assert.match(stueck, /musterListe\(/, "die Pfadmuster stehen nicht als eigene Eintraege");
  assert.match(stueck, /abgeleitetVon\(teil\)/, "die Zahl der Kommandos je Bereich kommt nicht aus der Vorschau");
  assert.match(stueck, /vorschauAnfordern\(teil\)/, "die Nutzung steht erst nach der ersten Aenderung da");
  assert.match(stueck, /dialog\(/, "einen genutzten Bereich zu entfernen geht ohne Rueckfrage");
  assert.match(stueck, /betroffen/, "die Rueckfrage nennt die betroffenen Kommandos nicht");
  // Ein Bereich ohne Muster ist eine Warnung, keine Sperre — sie steht an der Zeile.
  assert.match(stueck, /zeile-warn|erfasst nichts/, "ein Bereich ohne Muster wird nicht markiert");
  // Beide Pfade liegen im selben Teil, deshalb ist die Folge ein Auftrag (Kriterium 9a sinngemaess).
  assert.match(stueck, /setzeWert\(teil, "buildChecks"/, "die Folge landet nicht in der Arbeitskopie von M4");
  assert.match(stueck, /setzeWert\(teil, "checkAreas"/, "die Bereiche landen nicht in der Arbeitskopie von M4");
});

test("[einstellungen-13] M4 bearbeitet beide Pfade in einem Teil und braucht keinen Folgepfad", () => {
  const m4 = TEILE.find((t) => t.kennung === "m4");
  assert.deepEqual(m4.pfade, ["buildChecks", "checkAreas"]);
  assert.equal(m4.folgen, undefined, "M4 nennt einen Folgepfad, obwohl es beide Pfade selbst bearbeitet");
  const pfade = new Set(aenderungsliste(
    { buildChecks: [{ cmd: "eslint", areas: ["alt"] }], checkAreas: { alt: ["x"] } },
    { buildChecks: [{ cmd: "eslint", areas: ["neu"] }], checkAreas: { neu: ["x"] } },
    "m4",
  ).map((a) => a.pfad));
  assert.ok(pfade.has("buildChecks[0].areas[0]"), [...pfade].join(", "));
  assert.ok(pfade.has("checkAreas.neu"), [...pfade].join(", "));
});

// ------------------------------------------------------------
// M5 Spezifikation (Issue #729)
// ------------------------------------------------------------

test("die Registry fuehrt den Redaktor von M5 aus, keinen Platzhalter mehr", () => {
  const registry = SEITEN_BAUSTEINE.platte;
  assert.match(registry, /spezifikation: redaktorSpezifikation/, "M5 haengt noch am Platzhalter redaktorEntsteht");
  assert.match(SEITEN_BAUSTEINE.redaktorSpezifikation, /function redaktorSpezifikation\(teil\)/);
});

test("M5 bietet ohne spec-Block nur das Einschalten an, keinen Ausschalter", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorSpezifikation;
  assert.match(stueck, /el\("button", "taste taste-kupfer", "Einschalten"\)/, "der Einschalten-Knopf fehlt");
  // Die Erklaerung darf nennen, dass es keinen Ausschalter gibt — nur ein Knopf mit dieser
  // Aufschrift waere einer.
  assert.doesNotMatch(stueck, /el\("button"[^)]*"Ausschalten"/, "ein Ausschalt-Knopf steht im Redaktor");
  // Das Einschalten legt nur das leere Objekt an — kein Weg entfernt spec wieder.
  assert.match(stueck, /setzeWert\(teil, "spec", \{ bereiche: \{\} \}\)/, "das Einschalten legt kein leeres Objekt mit bereiche an");
  assert.doesNotMatch(stueck, /entfernt:\s*\[/, "ein Auftrag entfernt ein Feld, das gibt es fuer spec nicht");
});

test("M5 verlangt Gilt seit als Datumsfeld und Testorte als Muster-Liste", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorSpezifikation;
  assert.match(stueck, /seitFeld\.type = "date"/, "Gilt seit ist kein Datumsfeld");
  assert.match(stueck, /"spec\.seit"/, "das Datumsfeld traegt nicht den Pfad spec.seit");
  assert.match(stueck, /musterListe\(\{\s*muster: testGlobs/, "Testorte stehen nicht als Muster-Liste");
  assert.match(stueck, /"spec\.testGlobs"/, "Testorte tragen nicht den Pfad spec.testGlobs");
});

test("M5 zeigt neben dem Verweis-Muster ein Beispiel aus der Vorschau, keine zweite Rechnung im Browser", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorSpezifikation;
  assert.match(stueck, /abgeleitetVon\(teil\)\.verweis/, "das Beispiel kommt nicht aus der Vorschau");
  assert.doesNotMatch(stueck, /new RegExp\(/, "das Muster wird ein zweites Mal im Browser ausgewertet");
  assert.match(stueck, /"spec\.testPattern"/, "das Muster-Feld traegt nicht den Pfad spec.testPattern");
});

test("M5 zeigt die Spec-Datei je Bereich statt der Nutzung, ohne die Warnung aus M4", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorSpezifikation;
  assert.match(stueck, /bereich-grid/, "die Bereichstabelle nutzt nicht das Gitter des Entwurfs");
  assert.match(stueck, /abgeleitetVon\(teil\)\.datei/, "die Spec-Datei kommt nicht aus der Vorschau");
  assert.doesNotMatch(stueck, /erfasst nichts/, "M5 uebernimmt die Warnung von M4, obwohl ein fehlendes Muster hier ein Fehler ist");
  assert.match(stueck, /"spec\.bereiche\." \+ name/, "die Bereichszeile traegt ihren Pfad nicht");
});

test("M5 traegt den Pfad spec.bereiche an der Zwischenueberschrift, damit ein leerer Block dort einen Befund zeigt", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorSpezifikation;
  assert.match(stueck, /specBereicheKopf\("Bereiche der Spezifikation", "spec\.bereiche"\)/, "die Zwischenueberschrift traegt nicht den Pfad spec.bereiche");
  assert.match(stueck, /function specBereicheKopf\(titel, pfad\) \{\s*const g = zeilenGruppe\(pfad, ""\);/, "die Zwischenueberschrift haengt keinen Befund-Behaelter an");
});

test("M5 bearbeitet nur den Pfad spec und braucht keinen Folgepfad", () => {
  const m5 = TEILE.find((t) => t.kennung === "m5");
  assert.deepEqual(m5.pfade, ["spec"]);
  assert.equal(m5.folgen, undefined);
});

// ------------------------------------------------------------
// M6 Nacht-Kette (Issue #730)
// ------------------------------------------------------------

test("die Registry fuehrt den Redaktor von M6 aus, keinen Platzhalter mehr", () => {
  const registry = SEITEN_BAUSTEINE.platte;
  assert.match(registry, /nachtkette: redaktorNachtKette/, "M6 haengt noch am Platzhalter redaktorEntsteht");
  assert.match(SEITEN_BAUSTEINE.redaktorNachtKette, /function redaktorNachtKette\(teil\)/);
});

test("M6 zeigt die Kennzeichen als Textfelder und die Budgets als Zahlenfelder mit Einheit (Kriterium 24)", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorNachtKette;
  assert.match(stueck, /typ: "text"/, "die Kennzeichen sind keine Textfelder");
  assert.match(stueck, /typ: "number"/, "die Budgets sind keine Zahlenfelder");
  assert.match(stueck, /"min"/, "die Zeitbudgets nennen keine Einheit");
  assert.match(stueck, /"USD"/, "die Kostenbudgets nennen keine Einheit");
  assert.match(stueck, /zaehler\(/, "Korrekturrunden ist kein Zaehler");
  assert.match(stueck, /budget-grid/, "die Budgets nutzen nicht das Gitter des Entwurfs");
  assert.match(stueck, /zwei-spalten/, "die Kennzeichen stehen nicht nebeneinander wie im Entwurf");
});

test("M6 zeigt bei einem leeren Feld den Vorgabewert blass, aus dem eingebetteten Schema-Wert (Kriterium 25)", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorNachtKette;
  assert.match(stueck, /function ketteVorgabe\(feld\)/, "der Vorgabewert je Feld fehlt");
  assert.match(stueck, /vorgabe: ketteVorgabe\(feld\)/, "feldMitVorgabe bekommt den Vorgabewert nicht mitgeteilt");
  assert.match(stueck, /ketteFeldWert\(teil, "korrekturrunden"\)/, "Korrekturrunden bekommt keinen Vorgabewert");
  const felder = new Set([...stueck.matchAll(/\["(\w+)", "/g)].map((m) => m[1]));
  for (const feld of ["label", "varianteBLabel", "planMin", "paketeMin", "reviewMin", "abdeckungMin", "umsetzungMin", "kostenUsd", "kostenUsdB"]) {
    assert.ok(felder.has(feld), `${feld} steht in keiner Feldliste`);
  }
});

test("M6: der eingebettete Vorgabewert je Feld ist aus dem Schema gerechnet, kein zweites Literal", () => {
  const felder = Object.keys(SCHEMA.properties.night.properties.kette.properties);
  const erwartet = Object.fromEntries(felder.map((f) => [f, vorgabeAus(`night.kette.${f}`)]));
  assert.ok(
    SEITEN_BAUSTEINE.redaktorNachtKette.includes(`const KETTE_VORGABEN_BROWSER = ${JSON.stringify(erwartet)};`),
    "die Vorgabewerte im Browser-Skript weichen vom Schema ab",
  );
});

test("M6 zeigt die Summe der Zeitbudgets getrennt nach Kette und Umsetzung, aus der Vorschau (Kriterium 26)", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorNachtKette;
  assert.match(stueck, /abgeleitetVon\(teil\)\.zeit/, "die Summen kommen nicht aus der Vorschau");
  assert.match(stueck, /vorschauAnfordern\(teil\)/, "die Summen stehen erst nach der ersten Anfrage da");
  assert.match(stueck, /zeit\.kette/, "die Summe ohne Umsetzung fehlt");
  assert.match(stueck, /zeit\.umsetzung/, "die Summe der Umsetzung fehlt");
});

test("M6 aendert night.kette formtreu ueber ketteAendern, nicht als neues Objekt", () => {
  const stueck = SEITEN_BAUSTEINE.redaktorNachtKette;
  assert.match(stueck, /function ketteAendern\(teil, aenderung\)/, "ketteAendern fehlt");
  assert.match(stueck, /Object\.assign\(\{\}, /, "die Aenderung wird neu gebaut statt ergaenzt");
  assert.match(stueck, /setzeWert\(teil, "night\.kette"/, "die Aenderung landet nicht in der Arbeitskopie von M6");
});

test("M6 bearbeitet nur night.kette und braucht keinen Folgepfad; night.modelle bleibt in Dateischreibweise", () => {
  const m6 = TEILE.find((t) => t.kennung === "m6");
  assert.deepEqual(m6.pfade, ["night.kette"]);
  assert.equal(m6.folgen, undefined);
  assert.equal(TEILE.find((t) => t.pfade.includes("night.modelle")).redaktor, "text");
});
