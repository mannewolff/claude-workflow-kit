// Die Regeln des Waechters fuer leichte Pruefungen (Issue #1210, Plan #1199, E7 und E18).
//
// Der Test `test/checks-leichtigkeit.test.mjs` faehrt sie gegen den Arbeitsstand und
// gegen erfundene Dateien. Die Pruefung ist statisch und arbeitet auf einer Map
// `Pfad → Text`; darum laesst sie sich im selben Prozess an Beispielen belegen.
//
// Sie irrt bewusst in die strenge Richtung: Ein Fund zu viel kostet einen Eintrag in
// der Ausnahmeliste oder eine Kennzeichnung, ein Fund zu wenig liesse eine schwere
// Pruefung unbemerkt.

import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { importZiele } from "../../tools/verflechtung.mjs";
import { vergleicheText } from "../../kit/checks.mjs";

export const REGELN = ["ablauf-kennzeichnen", "keine-pausen", "haenger-kennzeichnen", "import-aus-teil"];

/** Die Dateien des Waechters selbst: Sie tragen die Muster als Daten, nicht als Ablauf. */
const EIGENE = new Set([
  "test/checks-leichtigkeit.test.mjs",
  "test/helpers/leichtigkeit.mjs",
  "test/helpers/leichtigkeit-ausnahmen.mjs",
]);

const KENNZEICHNUNG = /^\/\/\s*Ablauf-Pruefung:\s*\S/;

/** Ein Programm aus `kit/` oder `tools/`, als Pfad in einer Zeichenkette oder in `join(…)`. */
const PROGRAMM = [
  /["'`\s](?:\.{1,2}\/)*(?:\.claude\/)?(?:kit|tools)\/[\w./-]*\.mjs/,
  /["'](?:kit|tools)["']\s*,\s*["'][\w.-]+\.mjs["']/,
  /["']\.claude["']\s*,\s*["']kit["']/,
];

const CHILD_PROCESS = /["'](?:node:)?child_process["']/;

/**
 * Feste Pausen — je Zeile. `pause(` als Aufruf, nicht als Definition. Die Muster
 * setzen die Schreibweise voraus, die ESLint im Repo durchsetzt: einfache Leerzeichen.
 */
const PAUSE = [
  /\bawait setTimeout\(/,
  /\bawait new Promise\(\(?\w+\)? => setTimeout\(/,
  /\bAtomics\.wait\(/,
  /(?<![\w.])(?<!function )pause\(/,
];

/** Ein Kopf eines begrenzten Wartens, `function warteAuf…(` oder `const warteAuf… =`. */
const WARTE_KOPF = [/\bfunction (warteAuf\w*)\(/, /\b(?:const|let) (warteAuf\w*) =/];
/** Ein Funktionskopf, ueber dessen Einzug der Rumpf bestimmt wird. */
const FUNKTION_KOPF = [/\bfunction (\w+)\(/, /\b(?:const|let) (\w+) = (?:async )?\([^)]*\) =>/, /\b(?:const|let) (\w+) = (?:async )?\w+ =>/];
const BEFUND = /\bthrow\b|\bassert\b|\.fail\(/;

const HAENGER = /\bsleep\s+\d/;
const HAENGER_MARKE = /#\s*haengt/;

const EINSTIEGE = new Set(["kit/night.mjs", "kit/board.mjs"]);

const einzug = (zeile) => zeile.match(/^\s*/)[0].length;
const leer = (zeile) => zeile.trim() === "";
/** Eine Kommentarzeile beschreibt, sie wartet nicht und startet keine Attrappe. */
const kommentar = (zeile) => /^\s*(?:\/\/|\/\*|\*)/.test(zeile);

/** Traegt der Kopf der Datei — Shebang, Leerzeilen und `//`-Kommentare vor dem ersten Code — die Kennzeichnung? */
export function istGekennzeichnet(text) {
  for (const zeile of text.split("\n")) {
    const z = zeile.trim();
    if (z === "" || z.startsWith("#!")) continue;
    if (!z.startsWith("//")) return false;
    if (KENNZEICHNUNG.test(z)) return true;
  }
  return false;
}

/** Der erste Name, den eines der Muster in der Zeile fasst. */
function kopfName(zeile, muster) {
  for (const regex of muster) {
    const treffer = zeile.match(regex);
    if (treffer) return treffer[1];
  }
  return null;
}

/** Ein Import-Ziel als Pfad relativ zum Repo, in Posix-Schreibweise. */
function aufloesen(datei, ziel) {
  return posix.normalize(posix.join(posix.dirname(datei), ziel));
}

/**
 * Startet die Datei selbst ein Programm aus `kit/` oder `tools/`? Import-Angaben zaehlen
 * nicht und Kommentarzeilen auch nicht: Ein Helfer, der in seinem Kopf beschreibt, dass er
 * `kit/checks.mjs` im selben Prozess ruft, startet es nicht (Issue #1212).
 */
function startetSelbst(text) {
  if (!CHILD_PROCESS.test(text)) return false;
  const ohneKommentare = text.split("\n").filter((zeile) => !kommentar(zeile)).join("\n");
  const ohneImporte = ohneKommentare.replaceAll(/(?:from|import)[\s(]*["'][^"']+["']/g, "");
  return PROGRAMM.some((muster) => muster.test(ohneImporte));
}

/** Startet die Datei ein Programm — selbst oder ueber einen geladenen Helfer unter `test/`? */
function startetUeberKette(datei, dateien) {
  const offen = [datei];
  const gelesen = new Set(offen);
  while (offen.length > 0) {
    const aktuell = offen.pop();
    const text = dateien.get(aktuell);
    if (text === undefined) continue;
    if (startetSelbst(text)) return true;
    for (const ziel of importZiele(text)) {
      const pfad = aufloesen(aktuell, ziel);
      if (!pfad.startsWith("test/") || gelesen.has(pfad)) continue;
      gelesen.add(pfad);
      offen.push(pfad);
    }
  }
  return false;
}

/** Der Name der Funktion, in deren Rumpf Zeile `nr` steht — ueber den Einzug bestimmt. */
function umschliessendeFunktion(zeilen, nr) {
  let grenze = einzug(zeilen[nr]);
  for (let i = nr - 1; i >= 0 && grenze > 0; i--) {
    if (leer(zeilen[i]) || einzug(zeilen[i]) >= grenze) continue;
    const name = kopfName(zeilen[i], FUNKTION_KOPF);
    if (name !== null) return name;
    grenze = einzug(zeilen[i]);
  }
  return null;
}

/** Der Rumpf einer Funktion ab ihrer Kopfzeile: alles tiefer Eingerueckte danach. */
function rumpf(zeilen, kopf) {
  const tiefe = einzug(zeilen[kopf]);
  const teile = [zeilen[kopf]];
  for (let i = kopf + 1; i < zeilen.length; i++) {
    if (!leer(zeilen[i]) && einzug(zeilen[i]) <= tiefe) break;
    teile.push(zeilen[i]);
  }
  return teile.join("\n");
}

/** Die Gruende der Regel 2 fuer eine Datei. */
function pausen(zeilen, gekennzeichnet) {
  const gruende = [];
  zeilen.forEach((zeile, i) => {
    const name = kopfName(zeile, WARTE_KOPF);
    if (name !== null) {
      if (!gekennzeichnet) gruende.push(`Zeile ${i + 1}: ${name} wartet auf eine Bedingung, ohne Ablauf-Pruefung zu sein`);
      else if (!BEFUND.test(rumpf(zeilen, i))) gruende.push(`Zeile ${i + 1}: ${name} scheitert bei Fristablauf nicht mit Befund`);
    }
    if (kommentar(zeile) || !PAUSE.some((muster) => muster.test(zeile))) return;
    const umschliessend = umschliessendeFunktion(zeilen, i);
    if (gekennzeichnet && umschliessend?.startsWith("warteAuf")) return;
    gruende.push(`Zeile ${i + 1}: feste Pause`);
  });
  return gruende;
}

/** Die Gruende der Regel 3 fuer eine Datei. */
function haenger(zeilen) {
  const gruende = [];
  zeilen.forEach((zeile, i) => {
    if (!kommentar(zeile) && HAENGER.test(zeile) && !HAENGER_MARKE.test(zeile)) gruende.push(`Zeile ${i + 1}: sleep ohne # haengt`);
  });
  return gruende;
}

/** Die Gruende der Regel 4 fuer eine Testdatei. */
function einstiegsImporte(datei, text) {
  return importZiele(text)
    .map((ziel) => aufloesen(datei, ziel))
    .filter((pfad) => EINSTIEGE.has(pfad))
    .map((pfad) => `importiert den Einstieg ${pfad} statt eines Teils`);
}

/**
 * Alle Verstoesse einer Dateimenge, ohne Ausnahmen.
 *
 * @param {Map<string, string>} dateien repo-relativer Pfad → Text
 * @returns {Map<string, Map<string, string[]>>} Regel → Datei → Gruende
 */
export function verstoesseErheben(dateien) {
  const ergebnis = new Map(REGELN.map((regel) => [regel, new Map()]));
  const melden = (regel, datei, gruende) => {
    if (gruende.length > 0) ergebnis.get(regel).set(datei, gruende);
  };

  for (const [datei, text] of dateien) {
    const zeilen = text.split("\n");
    const gekennzeichnet = istGekennzeichnet(text);
    const istTest = datei.endsWith(".test.mjs");

    if (istTest && !gekennzeichnet && startetUeberKette(datei, dateien)) {
      melden("ablauf-kennzeichnen", datei, ["startet ein Programm aus kit/ oder tools/ ohne // Ablauf-Pruefung: im Kopf"]);
    }
    melden("keine-pausen", datei, pausen(zeilen, gekennzeichnet));
    melden("haenger-kennzeichnen", datei, haenger(zeilen));
    if (istTest && !gekennzeichnet) melden("import-aus-teil", datei, einstiegsImporte(datei, text));
  }
  return ergebnis;
}

/**
 * Die Verstoesse ausserhalb der Ausnahmeliste und die Eintraege der Liste, die nicht
 * mehr verstossen. Beide Listen sind nach Regel und Datei sortiert.
 *
 * @param {Map<string, string>} dateien
 * @param {Record<string, string[]>} ausnahmen Regel → Dateien
 */
export function leichtigkeitPruefen(dateien, ausnahmen) {
  const erhoben = verstoesseErheben(dateien);
  const verstoesse = [];
  const veraltet = [];
  for (const regel of REGELN) {
    const erlaubt = new Set(ausnahmen[regel] ?? []);
    for (const [datei, gruende] of erhoben.get(regel)) {
      if (!erlaubt.has(datei)) verstoesse.push({ regel, datei, gruende });
    }
    for (const datei of erlaubt) {
      if (!erhoben.get(regel).has(datei)) veraltet.push({ regel, datei });
    }
  }
  const ordnung = (a, b) => vergleicheText(`${a.regel} ${a.datei}`, `${b.regel} ${b.datei}`);
  return { verstoesse: verstoesse.sort(ordnung), veraltet: veraltet.sort(ordnung) };
}

/** Die Befunde als Text fuer die Fehlermeldung des Tests. */
export function befundeAlsText({ verstoesse, veraltet }) {
  const zeilen = [];
  for (const { regel, datei, gruende } of verstoesse) {
    for (const grund of gruende) zeilen.push(`${regel} ${datei}: ${grund}`);
  }
  for (const { regel, datei } of veraltet) {
    zeilen.push(`${regel} ${datei}: verstoesst nicht mehr — Eintrag aus test/helpers/leichtigkeit-ausnahmen.mjs streichen`);
  }
  return zeilen.join("\n");
}

/** Die Testdateien und Helfer des Arbeitsstands: `test/*.test.mjs` und `test/helpers/*.mjs`. */
export function testdateienLesen(repoRoot) {
  const dateien = new Map();
  const lesen = (verzeichnis, passt) => {
    for (const name of readdirSync(join(repoRoot, verzeichnis)).sort(vergleicheText)) {
      const pfad = `${verzeichnis}/${name}`;
      if (passt(name) && !EIGENE.has(pfad)) dateien.set(pfad, readFileSync(join(repoRoot, pfad), "utf-8"));
    }
  };
  lesen("test", (name) => name.endsWith(".test.mjs"));
  lesen("test/helpers", (name) => name.endsWith(".mjs"));
  return dateien;
}
