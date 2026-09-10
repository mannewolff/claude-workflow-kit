// Invarianten der Synthese-Fixtures (Issue #590, erweitert um die Befundlisten
// aus Issue #596).
//
// test/fixtures/synthese/ haelt echte Synthese/Vorschlag-Paare vom Board fest.
// Board-Karten sind veraenderlich; ein spaeterer Review an einer dieser Karten
// wuerde die Erwartung eines Tests still verschieben. Die Fixtures sind deshalb
// byteidentische Kopien mit Herkunft und Abrufstand — und dieser Test haelt die
// Zusagen, auf denen die folgenden Pakete des Beleg-Abgleichs stehen.
//
// Der Test laeuft in `node --test` mit und ist damit dauerhaft: Die folgenden
// Pakete fassen die Fixtures an, und ein Wegwerf-Script haette sie nach dem
// Commit ungeschuetzt gelassen.
//
// Die drei Begriffe sind woertlich die des Issues:
//
// - Eine `uebernommen`-Stelle ist ein Listenpunkt unter `### Entscheidungen`,
//   dessen erstes Ausgangswort nach " — " uebernommen (oder uebernommen in der
//   ASCII-Schreibweise) lautet — auch bei Teiluebernahme, denn auch die
//   behauptet eine Textaenderung. Punkte unter `### Dissens` und die Schlusszeile
//   zaehlen nicht.
// - Der Beleg-Pfeil ist " → " unmittelbar nach dem Ausgangswort, gefolgt von
//   `<Abschnitt>: "`. Ein `→` an anderer Stelle zaehlt nicht — die Synthese von
//   #580 traegt bereits zwei in einem `zur Entscheidung`-Punkt.
// - Ein Zitat stammt aus einer Zeile der vorschlag.md, hat mindestens 30 Zeichen,
//   traegt kein `"` und kommt dort genau einmal vor.
//
// Seit Issue #596 traegt jedes Verzeichnis zusaetzlich die `befunde.md` — die
// Kopie des einen Review-Kommentars, aus dem die Synthese entstanden ist. Der
// Synthese-Pruefer beantwortet zwei Fragen, die ohne die Befundliste nicht zu
// beantworten sind: Bleibt ein Widerspruch zwischen den Listen unbenannt, und
// traegt die Begruendung, mit der ein Fund verworfen wurde.
//
// Die Byteprobe gegen den Board-Body steht nicht hier: Sie gehoert an den Abruf
// und lief beim Ablegen der Fixtures. Ein Test in `node --test` hat kein Board.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(repoRoot, "test", "fixtures", "synthese");

const KARTEN = ["579", "580", "583", "584", "585", "587", "589"];

// Die Schluessel je Variante. `vermerk` traegt nur, wer keinen Vorschlag hat;
// `aufbereitet` und `aufbereitung` nur die aufbereitete Kopie.
const BASIS = [
  "board",
  "quelle",
  "abgerufen",
  "syntheseIndex",
  "syntheseCreatedAt",
  "vorschlagIndex",
  "vorschlagCreatedAt",
  "befundeIndex",
  "befundeCreatedAt",
  "stufe",
  "uebernommenErwartet",
  "schlusszeileNennt",
];
const OHNE_VORSCHLAG = [...BASIS, "vermerk"];
const AUFBEREITET = [...BASIS, "aufbereitet", "aufbereitung"];

const VERMERK = "kein Body-Vorschlag-Kommentar am Board";

const DATEIEN = ["synthese.md", "vorschlag.md", "befunde.md", "herkunft.json"];

// Die Kopfzeile des Befunde-Kommentars nennt die Stufe in der Schreibweise des
// Skills; `stufe` in der herkunft.json ist die Schreibweise von `roles --stufe`.
const KOPF_JE_STUFE = {
  fachlich: "Fachplan-Review",
  plan: "Plan-Review",
  issue: "Issue-Review",
};

// Der Abrufstand aus Issue #590 — der spaeteste der damals gesetzten Zeitpunkte.
// Issue #596 ruft die Karten neu ab; jeder neue Stand liegt danach.
const ABRUF_590 = "2026-09-10T15:00:18.603Z";

// Das Ausgangswort nach dem ersten " — " eines Listenpunkts, samt seiner
// Auszeichnung: Die Karten schreiben es als `uebernommen`, `übernommen` und
// `**übernommen**`. Die schliessenden Sterne gehoeren zum Wort, sonst muesste der
// Beleg-Pfeil zwischen Wort und Auszeichnung stehen.
const AUSGANG = /\*{0,2}(übernommen|uebernommen|verworfen)\*{0,2}/;

/** Der Beleg-Pfeil samt Abschnitt und Zitat, verankert am Ausgangswort. */
const BELEG = /^ → ([^"\n]+?): (gestrichen )?"([^"]+)"/;

/** Die Schlusszeile, in beiden Schreibweisen der Karten. */
const SCHLUSSZEILE = /^(?:Übernommen|Uebernommen): (\d+)/m;

function lies(verzeichnis, datei) {
  return readFileSync(join(FIXTURES, verzeichnis, datei), "utf-8");
}

function herkunft(verzeichnis) {
  return JSON.parse(lies(verzeichnis, "herkunft.json"));
}

/** Die Zeilen des Abschnitts `### Entscheidungen`, ohne die folgende Ueberschrift. */
function entscheidungsBlock(text) {
  const zeilen = text.split("\n");
  const start = zeilen.findIndex((z) => z.trim() === "### Entscheidungen");
  assert.notEqual(start, -1, "Synthese ohne Abschnitt '### Entscheidungen'");
  const rest = zeilen.slice(start + 1);
  const ende = rest.findIndex((z) => /^#{2,3} /.test(z));
  return ende === -1 ? rest : rest.slice(0, ende);
}

/**
 * Die Listenpunkte des Abschnitts, Folgezeilen zusammengefuegt.
 *
 * Ein Punkt beginnt mit "- " und endet am naechsten "- " oder an der Leerzeile.
 * Das ist noetig, weil der Ausgang im Bestand regelmaessig auf der Folgezeile
 * steht: die Synthesen von #587 und #589 brechen mitten im Fundtitel um.
 */
function listenpunkte(zeilen) {
  const punkte = [];
  let aktuell = null;
  for (const zeile of zeilen) {
    if (zeile.startsWith("- ")) {
      if (aktuell !== null) punkte.push(aktuell);
      aktuell = zeile.slice(2).trim();
    } else if (zeile.trim() === "") {
      if (aktuell !== null) punkte.push(aktuell);
      aktuell = null;
    } else if (aktuell !== null) {
      aktuell += " " + zeile.trim();
    }
  }
  if (aktuell !== null) punkte.push(aktuell);
  return punkte;
}

/**
 * Die `uebernommen`-Stellen einer Synthese.
 *
 * Je Stelle steht `rest` fuer den Text unmittelbar hinter dem Ausgangswort —
 * genau dort und nirgends sonst darf der Beleg-Pfeil stehen.
 */
function uebernommenStellen(text) {
  const stellen = [];
  for (const punkt of listenpunkte(entscheidungsBlock(text))) {
    const trenner = punkt.indexOf(" — ");
    if (trenner === -1) continue;
    const nachTrenner = punkt.slice(trenner + 3);
    const treffer = AUSGANG.exec(nachTrenner);
    if (!treffer || treffer[1] === "verworfen") continue;
    stellen.push({
      punkt,
      rest: nachTrenner.slice(treffer.index + treffer[0].length),
    });
  }
  return stellen;
}

/** Wie oft `nadel` in `heuhaufen` vorkommt — einfacher Teilstring-Vergleich. */
function trefferzahl(heuhaufen, nadel) {
  let anzahl = 0;
  let ab = 0;
  for (;;) {
    const pos = heuhaufen.indexOf(nadel, ab);
    if (pos === -1) return anzahl;
    anzahl += 1;
    ab = pos + 1;
  }
}

const mitVorschlag = KARTEN.filter((id) => herkunft(id).vorschlagIndex !== null);

test("test/fixtures/synthese traegt fuer jede der sieben Karten ein Verzeichnis mit den vier Dateien", () => {
  for (const id of KARTEN) {
    for (const datei of DATEIEN) {
      assert.doesNotThrow(() => lies(id, datei), `${id}/${datei} fehlt`);
    }
  }
});

test("ein aufbereitetes Verzeichnis gibt es genau fuer die Karten mit vorschlagIndex != null", () => {
  const vorhanden = readdirSync(FIXTURES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith("-aufbereitet"))
    .map((e) => e.name)
    .sort();
  assert.deepEqual(
    vorhanden,
    mitVorschlag.map((id) => `${id}-aufbereitet`).sort()
  );
  for (const id of mitVorschlag) {
    for (const datei of DATEIEN) {
      assert.doesNotThrow(
        () => lies(`${id}-aufbereitet`, datei),
        `${id}-aufbereitet/${datei} fehlt`
      );
    }
  }
});

test("jede herkunft.json traegt genau die fuer ihre Variante vorgesehenen Schluessel", () => {
  for (const id of KARTEN) {
    const h = herkunft(id);
    const erwartet = h.vorschlagIndex === null ? OHNE_VORSCHLAG : BASIS;
    assert.deepEqual(Object.keys(h).sort(), [...erwartet].sort(), `${id}/herkunft.json`);
    assert.equal(h.board, "https://kanban.mwolff.org");
    assert.equal(h.quelle, id);
    assert.match(h.abgerufen, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof h.syntheseIndex, "number");
    assert.match(h.syntheseCreatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(h.befundeCreatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(
      Object.prototype.hasOwnProperty.call(KOPF_JE_STUFE, h.stufe),
      `${id}: unbekannte Stufe "${h.stufe}"`
    );
  }
  for (const id of mitVorschlag) {
    const h = herkunft(`${id}-aufbereitet`);
    assert.deepEqual(
      Object.keys(h).sort(),
      [...AUFBEREITET].sort(),
      `${id}-aufbereitet/herkunft.json`
    );
    assert.equal(h.aufbereitet, true);
    assert.equal(typeof h.aufbereitung, "string");
    assert.ok(h.aufbereitung.length > 0);
  }
});

test("im unaufbereiteten synthese.md traegt keine uebernommen-Stelle einen Beleg-Pfeil", () => {
  for (const id of KARTEN) {
    const stellen = uebernommenStellen(lies(id, "synthese.md"));
    assert.ok(stellen.length > 0, `${id}: keine uebernommen-Stelle gefunden`);
    for (const stelle of stellen) {
      assert.equal(
        BELEG.test(stelle.rest),
        false,
        `${id}: unerwarteter Beleg-Pfeil in "${stelle.punkt.slice(0, 80)}"`
      );
    }
  }
});

test("im aufbereiteten synthese.md traegt jede uebernommen-Stelle genau einen Beleg-Pfeil", () => {
  for (const id of mitVorschlag) {
    const stellen = uebernommenStellen(lies(`${id}-aufbereitet`, "synthese.md"));
    assert.ok(stellen.length > 0, `${id}-aufbereitet: keine uebernommen-Stelle gefunden`);
    for (const stelle of stellen) {
      assert.ok(
        BELEG.test(stelle.rest),
        `${id}-aufbereitet: Beleg-Pfeil fehlt in "${stelle.punkt.slice(0, 80)}"`
      );
    }
  }
});

test("jedes Zitat eines aufbereiteten synthese.md kommt in seiner vorschlag.md genau einmal vor", () => {
  for (const id of mitVorschlag) {
    const vorschlag = lies(`${id}-aufbereitet`, "vorschlag.md");
    const stellen = uebernommenStellen(lies(`${id}-aufbereitet`, "synthese.md"));
    for (const stelle of stellen) {
      const [, , gestrichen, zitat] = BELEG.exec(stelle.rest);
      assert.ok(
        zitat.length >= 30,
        `${id}-aufbereitet: Zitat unter 30 Zeichen — "${zitat}"`
      );
      assert.equal(zitat.includes("\n"), false, `${id}-aufbereitet: Zitat ueber zwei Zeilen`);
      // Eine uebernommene Streichung wird durch Nicht-Vorkommen belegt: Der
      // gestrichene Text darf im Vorschlag gerade nicht mehr stehen.
      assert.equal(
        trefferzahl(vorschlag, zitat),
        gestrichen ? 0 : 1,
        `${id}-aufbereitet: Zitat "${zitat.slice(0, 60)}" nicht genau ${gestrichen ? 0 : 1} mal in vorschlag.md`
      );
    }
  }
});

test("die aufbereitete vorschlag.md ist die unveraenderte Kopie der unaufbereiteten", () => {
  for (const id of mitVorschlag) {
    assert.equal(lies(`${id}-aufbereitet`, "vorschlag.md"), lies(id, "vorschlag.md"));
  }
});

// Massstab ist `uebernommenErwartet` aus der herkunft.json, nicht die Schlusszeile:
// Die ist eine Selbstauskunft der damaligen Session und in sechs von sieben Karten
// falsch. Ein Nachweis, der darauf stuende, pruefte Text gegen Text statt Parser
// gegen Text — und stuetzte sich auf genau die Sorte Behauptung, gegen die dieses
// Vorhaben gebaut wird.
test("die Zahl der uebernommen-Stellen stimmt mit uebernommenErwartet ueberein, ueber alle Karten ist sie groesser null", () => {
  let summe = 0;
  for (const id of KARTEN) {
    const gezaehlt = uebernommenStellen(lies(id, "synthese.md")).length;
    assert.equal(gezaehlt, herkunft(id).uebernommenErwartet, `${id}: andere Zahl als uebernommenErwartet`);
    summe += gezaehlt;
  }
  assert.ok(summe > 0);
});

// Der belegte Ausreisser bleibt erhalten und wird nicht korrigiert: Karte #579 ist
// der erste echte Nachweis, dass eine Synthese sich verzaehlt — dort wurden alle 13
// Listenpunkte gezaehlt statt der 9 Uebernahmen.
test("die Schlusszeile weicht dort ab, wo herkunft.json es festhaelt — #579 als belegter Fall", () => {
  for (const id of KARTEN) {
    const text = lies(id, "synthese.md");
    const schluss = SCHLUSSZEILE.exec(text);
    const genannt = schluss ? Number(schluss[1]) : null;
    assert.equal(genannt, herkunft(id).schlusszeileNennt, `${id}: schlusszeileNennt passt nicht zum Text`);
  }
  const h579 = herkunft("579");
  assert.equal(h579.uebernommenErwartet, 9);
  assert.equal(h579.schlusszeileNennt, 13);
  assert.notEqual(h579.uebernommenErwartet, h579.schlusszeileNennt);
});

// Ein Fixture ohne Befunde waere kein vorgesehener Fall: Am Board traegt jede der
// sieben Karten genau einen Review-Kommentar, und die Synthese ist ohne ihn nicht
// zu pruefen. Eine leere befunde.md hiesse, dass der Abruf etwas anderes
// eingesammelt hat als den Kommentar.
test("jedes Verzeichnis traegt eine befunde.md, und keine ist leer", () => {
  for (const id of [...KARTEN, ...mitVorschlag.map((k) => `${k}-aufbereitet`)]) {
    const befunde = lies(id, "befunde.md");
    assert.ok(befunde.length > 0, `${id}/befunde.md ist leer`);
  }
});

// Der Befunde-Kommentar ist der letzte vor der Synthese: Die Synthese antwortet
// auf ihn. Ein Index dahinter waere ein anderer Kommentar.
test("befundeIndex ist eine Zahl und liegt vor syntheseIndex", () => {
  for (const id of KARTEN) {
    const h = herkunft(id);
    assert.equal(typeof h.befundeIndex, "number", `${id}: befundeIndex ist keine Zahl`);
    assert.ok(
      h.befundeIndex < h.syntheseIndex,
      `${id}: befundeIndex ${h.befundeIndex} liegt nicht vor syntheseIndex ${h.syntheseIndex}`
    );
  }
});

test("die erste Zeile jeder befunde.md nennt Stufe und Runde und passt zum Schluessel stufe", () => {
  for (const id of KARTEN) {
    const h = herkunft(id);
    for (const verzeichnis of [id, ...(h.vorschlagIndex === null ? [] : [`${id}-aufbereitet`])]) {
      const erste = lies(verzeichnis, "befunde.md").split("\n")[0];
      assert.ok(erste.startsWith("## "), `${verzeichnis}: erste Zeile ohne "## " — "${erste}"`);
      assert.ok(
        erste.includes("-Review, Runde "),
        `${verzeichnis}: erste Zeile ohne "-Review, Runde " — "${erste}"`
      );
      assert.ok(
        erste.startsWith(`## ${KOPF_JE_STUFE[h.stufe]}, Runde `),
        `${verzeichnis}: Kopfzeile "${erste}" passt nicht zur Stufe "${h.stufe}"`
      );
    }
  }
});

// Die Befunde sind Verlauf und werden nicht aufbereitet: Aufbereitet wird die
// Synthese, damit sie ihre Uebernahmen belegt.
test("die befunde.md der aufbereiteten Kopie ist die unveraenderte Kopie der unaufbereiteten", () => {
  for (const id of mitVorschlag) {
    assert.equal(lies(`${id}-aufbereitet`, "befunde.md"), lies(id, "befunde.md"));
  }
});

// Der Abruf aus Issue #596 ist zugleich die Probe auf den Bestand: Er hat belegt,
// dass synthese.md und vorschlag.md noch byteidentisch zum Board sind. `abgerufen`
// haelt fest, wann das zuletzt der Fall war — ein alter Stand hiesse, dass die
// Probe seit Issue #590 nicht mehr gelaufen ist.
test("abgerufen ist in beiden Varianten gleich und juenger als der Stand aus Issue #590", () => {
  for (const id of KARTEN) {
    const h = herkunft(id);
    assert.ok(
      h.abgerufen > ABRUF_590,
      `${id}: abgerufen ${h.abgerufen} liegt nicht nach dem Stand aus Issue #590`
    );
    if (h.vorschlagIndex !== null) {
      assert.equal(
        herkunft(`${id}-aufbereitet`).abgerufen,
        h.abgerufen,
        `${id}: aufbereitete Kopie traegt einen anderen Abrufstand`
      );
    }
  }
});

test("die Karten ohne Body-Vorschlag tragen null, eine leere vorschlag.md und den Vermerk", () => {
  const ohne = KARTEN.filter((id) => !mitVorschlag.includes(id));
  assert.deepEqual(ohne, ["579", "580", "583", "584", "585"]);
  for (const id of ohne) {
    const h = herkunft(id);
    assert.equal(h.vorschlagIndex, null);
    assert.equal(h.vorschlagCreatedAt, null);
    assert.equal(h.vermerk, VERMERK);
    assert.equal(lies(id, "vorschlag.md"), "");
  }
});
