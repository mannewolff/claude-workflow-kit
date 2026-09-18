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

import { SCHEMA, TEILE, projektZustand, teilFuer, vorgabeAus } from "../kit/einstellungen.mjs";
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

test("[einstellungen-9] die sieben Teile des Entwurfs tragen Titel und Thema, die generischen nicht", () => {
  for (const kennung of ["m1", "m2", "m3", "m4", "m5", "m6"]) {
    const teil = teilNach(kennung);
    assert.ok(teil, `${kennung} fehlt`);
    assert.ok(teil.titel, `${kennung} hat keinen Titel`);
    assert.ok(teil.thema, `${kennung} hat kein Thema`);
  }
  assert.deepEqual(teilNach("m1").pfade, ["issueReview.requiredBeforeReady", "issueReview.reviewers"]);
  assert.deepEqual(teilNach("m2").pfade, ["issueReview.pairs"]);
  assert.deepEqual(teilNach("m3").pfade, ["reviewStufen"]);
  assert.deepEqual(teilNach("m4").pfade, ["buildChecks", "checkAreas"]);
  assert.deepEqual(teilNach("m5").pfade, ["spec"]);
  assert.deepEqual(teilNach("m6").pfade, ["night.kette"]);
  for (const kennung of ["m7", "wert", "text"]) assert.equal(teilNach(kennung).thema, null, kennung);
});

test("[einstellungen-9] im Text-Teil stehen nur die Nacht-Felder ohne eigene Eingabe und die unbekannten", () => {
  assert.equal(teilFuer("night.modelle").kennung, "text");
  assert.equal(teilFuer("erfundenesFeld").kennung, "text", "ein unbekanntes Feld faellt auf den Text-Teil zurueck");
  const { zustand, raeumAuf } = wegwerfProjekt();
  try {
    const imText = instanzen(zustand).filter((i) => i.kennung === "text").flatMap((i) => i.eintraege.map((e) => e.pfad));
    assert.deepEqual(imText.sort(), ["erfundenesFeld", "night.modelle", "night.stufen", "night.stufenRegel"]);
    for (const pfad of ["buildChecks", "checkAreas", "spec", "reviewStufen", "night.kette", "issueReview.reviewers", "issueReview.pairs", "triggers", "columns"]) {
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
            ["befunde", "beschreibung", "gilt", "persoenlich", "persoenlichErlaubt", "pfad", "schema", "team", "vorgabe"],
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

test("[einstellungen-9] ein Wurzelfeld ohne Teil faellt auf den Text-Teil zurueck und bleibt lesbar", () => {
  const { zustand, raeumAuf } = wegwerfProjekt();
  try {
    const teil = instanzen(zustand).find((i) => i.eintraege.some((e) => e.pfad === "erfundenesFeld"));
    assert.equal(teil.kennung, "text");
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
