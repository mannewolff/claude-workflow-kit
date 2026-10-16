// Der Zuschnitt der Einstellungs-Oberflaeche in Teile (Issue #723, Plan #721).
//
// Nicht mehr das Schema eines Feldes entscheidet ueber seine Eingabe, sondern der Teil, zu
// dem es gehoert. Geprueft wird der Zuschnitt selbst — dass jedes bekannte Wurzelfeld einen
// Ort hat, dass kein Teil einen erfundenen Pfad nennt und dass der Text-Teil der Rueckfall
// bleibt (Kriterium 1 der fachlichen Quelle #705).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SCHEMA, TEILE, TEXTE, ebenen, projektZustand, teilFuer, vorgabeAus } from "../kit/settings.mjs";
import { projekt } from "./helpers/einstellungen-fixture.mjs";

const WURZELN = Object.keys(SCHEMA.properties).filter((f) => f !== "version");
const teilNach = (kennung) => TEILE.find((t) => t.kennung === kennung);

/** Das Teilschema eines Pfads — die Probe, ob es den Pfad im Schema ueberhaupt gibt. */
function schemaFuer(pfad) {
  return pfad.split(".").reduce((k, teil) => k?.properties?.[teil], SCHEMA) ?? null;
}

/**
 * Die echte Einstellungsdatei dieses Projekts, ergaenzt um ein erfundenes Wurzelfeld —
 * echte Daten statt gebauter Beispiele, wie es das Akzeptanzkriterium verlangt.
 */
function wegwerfProjekt() {
  const wurzel = mkdtempSync(join(tmpdir(), "einstellungen-teile-"));
  const home = mkdtempSync(join(tmpdir(), "einstellungen-teile-home-"));
  const echt = JSON.parse(readFileSync(new URL("../.claude/workflow.config.json", import.meta.url), "utf-8"));
  const team = { ...echt, erfundenesFeld: { was: "kennt das Kit nicht" } };
  const pfad = projekt(wurzel, "echt", { team, stand: "1.0.0" });
  writeFileSync(join(pfad, ".claude", "workflow.config.local.json"), `${JSON.stringify({ reviewScope: "full" }, null, 2)}\n`);
  return {
    zustand: projektZustand({ name: "echt", pfad }, { home, eigenerStand: "99.0.0" }),
    raeumAuf: () => {
      rmSync(wurzel, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/** Alle Teil-Instanzen eines Zustands ueber alle Themen. */
const instanzen = (zustand) => Object.values(zustand.themen).flat();

/** Der Reiter (Teil nach Zweck), unter dem ein Pfad im Zustand steht. */
const reiterVon = (zustand, pfad) =>
  Object.entries(zustand.themen).find(([, teile]) => teile.some((t) => t.eintraege.some((e) => e.pfad === pfad)))?.[0];

/** Ein Wegwerf-Projekt mit `team`; `fn` bekommt den Zustand. */
function mitZustand(team, fn) {
  const wurzel = mkdtempSync(join(tmpdir(), "einstellungen-zweck-"));
  const home = mkdtempSync(join(tmpdir(), "einstellungen-zweck-home-"));
  try {
    const pfad = projekt(wurzel, "p", { team, stand: "1.0.0" });
    return fn(projektZustand({ name: "p", pfad }, { home, eigenerStand: "1.0.0" }));
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

/** Der Reiter, unter dem eine Platte steht. */
function reiterMitPlatte(zustand, kennung) {
  const hatPlatte = (teile) => teile.some((t) => t.kennung === kennung);
  return Object.keys(zustand.themen).find((zweck) => hatPlatte(zustand.themen[zweck]));
}

const DEUTSCH = { codeHost: "local", issueTracker: "local", buildChecks: [{ cmd: "node --test", stufe: "paket" }], checkAreas: { web: ["src/**"] }, mainBranch: "main", vorgeschichte: true };

test("[einstellungen-9] jedes Wurzelfeld ausser version gehoert zu genau einem Teil", () => {
  const belegt = new Map();
  for (const teil of TEILE) {
    for (const pfad of teil.pfade) {
      assert.equal(belegt.has(pfad), false, `${pfad} steht in ${belegt.get(pfad)} und in ${teil.kennung}`);
      belegt.set(pfad, teil.kennung);
    }
  }
  for (const wurzel of WURZELN) {
    if (belegt.has(wurzel)) continue;
    // Ein zerschnittenes Wurzelfeld traegt seinen Ort nicht selbst, sondern in jedem Unterfeld.
    const unter = Object.keys(SCHEMA.properties[wurzel].properties ?? {});
    assert.ok(unter.length > 0, `${wurzel} nennt keinen Teil und hat keine Unterfelder`);
    for (const feld of unter) {
      assert.ok(belegt.has(`${wurzel}.${feld}`), `${wurzel}.${feld} gehoert zu keinem Teil`);
    }
  }
});

test("[einstellungen-9] jeder Teil nennt nur Pfade, die es im Schema gibt", () => {
  for (const teil of TEILE) {
    assert.ok(teil.pfade.length > 0, `${teil.kennung} nennt keinen Pfad`);
    assert.ok(teil.redaktor, `${teil.kennung} nennt keinen Redaktor`);
    assert.equal(typeof teil.reihenfolge, "number", `${teil.kennung} hat keine Reihenfolge`);
    for (const pfad of teil.pfade) assert.ok(schemaFuer(pfad), `${pfad} steht nicht im Schema (${teil.kennung})`);
  }
});

test("[einstellungen-9] die benannten Teile des Entwurfs tragen einen Titel, die generischen nicht", () => {
  for (const kennung of ["m1", "m2", "m3", "m4", "m6"]) {
    const teil = teilNach(kennung);
    assert.ok(teil, `${kennung} fehlt`);
    assert.ok(teil.titel, `${kennung} hat keinen Titel`);
    // Das Thema entfiel mit der Gliederung nach Zweck (Issue #1736): Eine Platte steht unter
    // dem Teil ihres ersten Felds.
    assert.equal("thema" in teil, false, `${kennung} traegt noch ein Thema`);
  }
  assert.deepEqual(teilNach("m1").pfade, ["issueReview.requiredBeforeReady", "issueReview.reviewers"]);
  assert.deepEqual(teilNach("m2").pfade, ["issueReview.pairs"]);
  assert.deepEqual(teilNach("m3").pfade, ["reviewStufen"]);
  // `ohnePruefung` steht neben den Bereichen, weil es dieselbe Frage beantwortet
  // (Issue #934): was eine geaenderte Datei ausloest — hier eben nichts. `nurGeruest`
  // (Issue #943) steht aus demselben Grund dort: Es entscheidet mit, welche Kopplung
  // die Auswahl ueberhaupt sieht.
  assert.deepEqual(teilNach("m4").pfade, ["buildChecks", "checkAreas", "ohnePruefung", "nurGeruest", "gekoppelteBereiche"]);
  // m5 (Spezifikation) entfiel mit Spec-Driven Development (Plan #825, Issue #830).
  assert.equal(teilNach("m5"), undefined);
  assert.deepEqual(teilNach("m6").pfade, ["night.kette", "night.zielUmsetzungMin", "night.festgefahrenNach", "night.protokollFristTage", "night.stand"]);
  for (const kennung of ["m7", "wert", "text"]) assert.equal(teilNach(kennung).titel, null, kennung);
});

test("[einstellungen-9] im Text-Teil stehen nur die Nacht-Felder ohne eigene Eingabe, testAblagen, pushPruefung, vertragsRepos und die unbekannten", () => {
  assert.equal(teilFuer("night.modelle").kennung, "text");
  // testAblagen ist bekannt und trotzdem im Rueckfall (Issue #1032, A13): zwei Eintragsformen,
  // keine feste Tabelle — eine eigene Eingabe braeuchte zwei Zeilenarten.
  assert.equal(teilFuer("testAblagen").kennung, "text");
  // pushPruefung ebenso (Issue #1216): ein fester Wert oder ein Objekt — zwei Formen.
  assert.equal(teilFuer("pushPruefung").kennung, "text");
  // vertragsRepos ebenso (Issue #1614): eine Objektliste, in Dateischreibweise wie testAblagen.
  assert.equal(teilFuer("vertragsRepos").kennung, "text");
  assert.equal(teilFuer("erfundenesFeld").kennung, "text", "ein unbekanntes Feld faellt auf den Text-Teil zurueck");
  const { zustand, raeumAuf } = wegwerfProjekt();
  try {
    assert.equal(reiterVon(zustand, "testAblagen"), "lohnt");
    assert.equal(reiterVon(zustand, "pushPruefung"), "lohnt");
    assert.equal(reiterVon(zustand, "vertragsRepos"), "lohnt");
    const imText = instanzen(zustand).filter((i) => i.kennung === "text").flatMap((i) => i.eintraege.map((e) => e.pfad));
    assert.deepEqual(imText.sort(), ["erfundenesFeld", "night.modelle", "night.stufenRegel", "pushPruefung", "testAblagen", "vertragsRepos"]);
    for (const pfad of ["buildChecks", "checkAreas", "reviewStufen", "night.kette", "night.stufen", "issueReview.reviewers", "issueReview.pairs", "triggers", "columns"]) {
      assert.notEqual(teilFuer(pfad).kennung, "text", `${pfad} braucht eine eigene Eingabe`);
    }
  } finally {
    raeumAuf();
  }
});

test("[einstellungen-9] projektZustand liefert je Thema Teile mit Eintraegen statt einer flachen Liste", () => {
  const { zustand, raeumAuf } = wegwerfProjekt();
  try {
    assert.ok(Object.keys(zustand.themen).length > 0);
    for (const [thema, teile] of Object.entries(zustand.themen)) {
      assert.ok(Array.isArray(teile), thema);
      const folge = teile.map((t) => t.reihenfolge);
      assert.deepEqual(folge, [...folge].sort((a, b) => a - b), `${thema} ist nicht nach Reihenfolge sortiert`);
      for (const teil of teile) {
        assert.ok(teil.kennung && teil.redaktor, thema);
        assert.ok(teil.eintraege.length > 0, `${thema}/${teil.kennung} hat keinen Eintrag`);
        for (const e of teil.eintraege) {
          assert.deepEqual(
            Object.keys(e).sort(),
            ["befunde", "beschreibung", "gilt", "kennzeichen", "persoenlich", "persoenlichErlaubt", "pfad", "schema", "team", "vorgabe"],
            e.pfad,
          );
        }
      }
    }
    const alle = instanzen(zustand).flatMap((i) => i.eintraege);
    const pfade = alle.map((e) => e.pfad);
    assert.equal(new Set(pfade).size, pfade.length, "ein Pfad steht in zwei Teilen");
    assert.ok(pfade.includes("night.kette"), "night.kette fehlt");
    assert.equal(pfade.includes("night"), false, "night steht noch als Ganzes da");
    assert.equal(pfade.includes("issueReview"), false, "issueReview steht noch als Ganzes da");
    const kette = alle.find((e) => e.pfad === "night.kette");
    assert.equal(kette.team.label, "kit:night");
    assert.equal(vorgabeAus("night.kette.label"), "kit:night");
    assert.equal(alle.find((e) => e.pfad === "local").vorgabe.issuesDir, "issues", "die Vorgabe kommt aus dem Schema");
    const scope = alle.find((e) => e.pfad === "reviewScope");
    assert.equal(scope.persoenlich, "full");
    assert.equal(scope.gilt, "full");
    assert.equal(scope.persoenlichErlaubt, true);
  } finally {
    raeumAuf();
  }
});

test("[einstellungen-9] jedes Feld unter night.kette traegt eine vorgabe, die dem default des Schemas entspricht", () => {
  const felder = Object.keys(SCHEMA.properties.night.properties.kette.properties);
  assert.ok(felder.length > 0, "night.kette hat keine Felder");
  for (const feld of felder) {
    const knoten = SCHEMA.properties.night.properties.kette.properties[feld];
    assert.equal(vorgabeAus(`night.kette.${feld}`), knoten.default, feld);
  }
});

// Die Zielmarke (Issue #923, Plan #917 E4): Sie gilt fuer die Kette UND fuer die
// Umsetzungsnacht, steht darum neben `night.kette` und nicht darin — bearbeitet wird sie
// trotzdem im Nacht-Teil m6, weil dort die Budgets der Umsetzung stehen. Fehlt sie in einer
// Konfiguration, gilt die Vorgabe aus dem Schema; das ist die Stelle, die der Bericht liest.
test("[einstellungen-9] night.zielUmsetzungMin gehoert zu m6 und traegt die Vorgabe 10", () => {
  assert.equal(teilFuer("night.zielUmsetzungMin").kennung, "m6");
  assert.equal(SCHEMA.properties.night.properties.zielUmsetzungMin.type, "integer");
  assert.equal(vorgabeAus("night.zielUmsetzungMin"), 10);
});

test("[einstellungen-9] ohne eigenen Eintrag steht die Zielmarke mit der Vorgabe 10 da", () => {
  const stand = ebenen({ night: { kette: { planMin: 20 } } }, null);
  const eintrag = stand["night.zielUmsetzungMin"];
  assert.ok(eintrag, "die Zielmarke steht nicht unter den Einstellungen");
  assert.equal(eintrag.team, undefined, "die Konfiguration traegt das Feld gar nicht");
  assert.equal(eintrag.gilt, undefined, "ohne Eintrag gilt kein eigener Wert");
  assert.equal(vorgabeAus("night.zielUmsetzungMin"), 10, "dann greift die Vorgabe aus dem Schema");
});

// Die Bremse fuer festgefahrene Pakete (Issue #1387, Plan #1386 E11): eine Zahl gleich
// gescheiterter Prueflaeufe, bearbeitet im Nacht-Teil m6 neben der Zielmarke.
test("[einstellungen-9] night.festgefahrenNach gehoert zu m6 und traegt die Vorgabe 3", () => {
  assert.equal(teilFuer("night.festgefahrenNach").kennung, "m6");
  const knoten = SCHEMA.properties.night.properties.festgefahrenNach;
  assert.equal(knoten.type, "integer");
  assert.equal(knoten.minimum, 2);
  assert.equal(vorgabeAus("night.festgefahrenNach"), 3);
});

// Die Protokollfrist (Issue #1696): Tage, nach denen der Runner seine Protokolle loescht,
// bearbeitet im Nacht-Teil m6 neben der Bremse.
test("[einstellungen-9] night.protokollFristTage gehoert zu m6 und traegt die Vorgabe 14", () => {
  assert.equal(teilFuer("night.protokollFristTage").kennung, "m6");
  const knoten = SCHEMA.properties.night.properties.protokollFristTage;
  assert.equal(knoten.type, "integer");
  assert.equal(knoten.minimum, 1);
  assert.equal(vorgabeAus("night.protokollFristTage"), 14);
});

// Der Prueflauf-Block (Issue #905, Plan #904 E5): drei einfache Felder, deshalb kein
// eigener Redaktor, sondern ein Pfad im generischen Gruppen-Teil `m7`. Er steht unter der
// Feinabstimmung, seinem Teil nach Zweck (Issue #1736).
test("[einstellungen-9] pruefLauf gehoert zum Gruppen-Teil m7 unter der Feinabstimmung", () => {
  mitZustand(DEUTSCH, (zustand) => assert.equal(reiterVon(zustand, "pruefLauf"), "fein"));
  const teil = teilFuer("pruefLauf");
  assert.equal(teil.kennung, "m7", "pruefLauf haengt nicht am Gruppen-Teil");
  assert.equal(teil.redaktor, "gruppe", "pruefLauf bekommt keinen eigenen Redaktor");
  assert.notEqual(teil.kennung, "text", "pruefLauf zeigt die Dateischreibweise");
});

test("[einstellungen-9] jedes Feld unter pruefLauf traegt die Vorgabe aus dem Schema", () => {
  const felder = Object.entries(SCHEMA.properties.pruefLauf.properties);
  assert.equal(felder.length, 3, "pruefLauf fuehrt nicht drei Felder");
  for (const [feld, knoten] of felder) {
    assert.equal(vorgabeAus(`pruefLauf.${feld}`), knoten.default, feld);
  }
});

test("[einstellungen-9] ein Wurzelfeld ohne Teil faellt auf den Text-Teil zurueck und bleibt lesbar", () => {
  const { zustand, raeumAuf } = wegwerfProjekt();
  try {
    const teil = instanzen(zustand).find((i) => i.eintraege.some((e) => e.pfad === "erfundenesFeld"));
    assert.equal(teil.kennung, "text");
    assert.equal(reiterVon(zustand, "erfundenesFeld"), "unbekannt", "ein Feld ohne Teil nach Zweck steht unter einem eigenen Reiter");
    assert.equal(teil.redaktor, teilNach("text").redaktor);
    const e = teil.eintraege.find((x) => x.pfad === "erfundenesFeld");
    assert.deepEqual(e.team, { was: "kennt das Kit nicht" }, "der Wert bleibt unveraendert lesbar");
    assert.deepEqual(e.gilt, { was: "kennt das Kit nicht" });
    assert.equal(e.schema, null);
    assert.equal(e.vorgabe, undefined);
    assert.ok(e.befunde.some((b) => b.art === "unbekannt"), "das unbekannte Feld bleibt eine Warnung");
  } finally {
    raeumAuf();
  }
});

// --- Gliederung nach Zweck (Issue #1736, Plan #1710 A5 bis A7, #1705 Kriterien 4 und 6) ---

test("[1736-1] projektZustand liefert einem deutschen Projekt vier Reiter in der Reihenfolge der Seite", () => {
  mitZustand(DEUTSCH, (zustand) => {
    assert.equal(zustand.sprache, "de");
    assert.deepEqual(Object.keys(zustand.themen), ["einrichten", "lohnt", "verwaltet", "fein"]);
    assert.deepEqual(
      Object.keys(zustand.themen).map((z) => TEXTE.de[`zweck.${z}`]),
      ["Beim Einrichten nötig", "Lohnt sich", "Vom Kit verwaltet", "Feinabstimmung"],
      "die Reiter tragen dieselben Woerter wie die Seite",
    );
    assert.deepEqual(
      Object.keys(zustand.themen).map((z) => TEXTE.en[`zweck.${z}`]),
      ["Needed at setup", "Worth setting", "Managed by the kit", "Fine-tuning"],
    );
  });
});

test("[1736-2] die Platte m4 steht unter Beim Einrichten nötig, und checkAreas traegt den Teil Lohnt sich", () => {
  mitZustand(DEUTSCH, (zustand) => {
    const m4 = instanzen(zustand).filter((i) => i.kennung === "m4");
    assert.equal(m4.length, 1, "die Platte wird nicht geteilt");
    assert.ok(zustand.themen.einrichten.includes(m4[0]), "m4 steht nicht unter dem Teil ihres ersten Felds");
    const kennzeichen = Object.fromEntries(m4[0].eintraege.map((e) => [e.pfad, e.kennzeichen]));
    assert.deepEqual(kennzeichen, {
      buildChecks: [],
      checkAreas: ["Lohnt sich"],
      ohnePruefung: ["Lohnt sich"],
      nurGeruest: ["Feinabstimmung"],
      gekoppelteBereiche: ["Lohnt sich"],
    });
  });
});

test("[1736-3] jede Platte haengt am Teil ihres ersten Felds, ein einfacher Eintrag am Teil seines Wurzelfelds", () => {
  mitZustand(DEUTSCH, (zustand) => {
    const reiterDerPlatte = (kennung) => reiterMitPlatte(zustand, kennung);
    assert.equal(reiterDerPlatte("m1"), "einrichten");
    assert.equal(reiterDerPlatte("m2"), "einrichten");
    assert.equal(reiterDerPlatte("m3"), "lohnt");
    for (const kennung of ["m6", "m8", "m9", "m10", "m11"]) assert.equal(reiterDerPlatte(kennung), "fein", kennung);
    assert.equal(reiterVon(zustand, "language"), "einrichten");
    assert.equal(reiterVon(zustand, "vorgeschichte"), "lohnt");
    assert.equal(reiterVon(zustand, "toolbox.tokenFile"), "einrichten");
    assert.equal(reiterVon(zustand, "night.modell"), "fein");
    assert.equal(reiterVon(zustand, "triggers"), "fein");
    for (const teile of Object.values(zustand.themen)) {
      const folge = teile.map((t) => t.reihenfolge);
      assert.deepEqual(folge, [...folge].sort((a, b) => a - b));
    }
  });
});

test("[1736-4] gekennzeichnete Eintraege tragen ihr Kennzeichen als Text, in der Sprache des Projekts", () => {
  mitZustand(DEUTSCH, (zustand) => {
    const kennzeichen = (pfad) => instanzen(zustand).flatMap((i) => i.eintraege).find((e) => e.pfad === pfad).kennzeichen;
    assert.equal(reiterVon(zustand, "provider"), "verwaltet");
    assert.deepEqual(kennzeichen("provider"), ["veraltet"]);
    assert.deepEqual(kennzeichen("szenarienAb"), ["vom Installer gesetzt"]);
    assert.deepEqual(kennzeichen("vorgeschichte"), []);
    assert.deepEqual(kennzeichen("language"), []);
  });
  mitZustand({ ...DEUTSCH, language: "en" }, (zustand) => {
    const kennzeichen = (pfad) => instanzen(zustand).flatMap((i) => i.eintraege).find((e) => e.pfad === pfad).kennzeichen;
    assert.deepEqual(Object.keys(zustand.themen), ["einrichten", "lohnt", "verwaltet", "fein"], "die Schluessel der Reiter sind Vertragswerte");
    assert.deepEqual(kennzeichen("provider"), ["deprecated"]);
    assert.deepEqual(kennzeichen("szenarienAb"), ["set by the installer"]);
    assert.deepEqual(kennzeichen("checkAreas"), ["Worth setting"]);
    assert.deepEqual(kennzeichen("nurGeruest"), ["Fine-tuning"]);
  });
});
