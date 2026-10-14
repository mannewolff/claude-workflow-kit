// Namen-Register kit/board/namen.mjs (Issue #1421, Plan #1420 E2–E4): je Sache ein deutscher
// und ein englischer Name, die Projektsprache aus der Config und das Erkennen beider Namen.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  projektSprache,
  labelName,
  praefix,
  erkenneLabel,
  erkennePraefix,
  LABELS,
  PRAEFIXE,
  ALTNAMEN,
  EINGABEWERTE,
  internerWert,
} from "../kit/board/namen.mjs";
import * as register from "../kit/board/namen.mjs";

// Die Paare aus E4, hier bewusst noch einmal ausgeschrieben: Der Test haelt das Register fest.
const LABEL_PAARE = [
  ["kit:klaeren", "kit:clarify"],
  ["kit:geschuetzt", "kit:protected"],
  ["kit:durchziehen", "kit:carry-through"],
  ["kit:pruefen", "kit:check"],
  ["lauf:laeuft", "run:running"],
  ["lauf:abgebrochen", "run:aborted"],
  ["lauf:wartet", "run:waiting"],
  ["review:fertig", "review:done"],
  ["kit:geklaert", "kit:clarified"],
  ["ziel:plan", "goal:plan"],
  ["ziel:pakete", "goal:packages"],
  ["ziel:umsetzung", "goal:implementation"],
  ["ziel:push-vorbereitet", "goal:push-prepared"],
];
const GLEICHE_LABELS = ["kit:night", "kit:nightrun", "kit:on-hold", "planreview:1", "planreview:2"];

const PRAEFIX_PAARE = [
  ["[Fachlich]", "[Requirement]"],
  ["[Idee]", "[Idea]"],
  ["[Mensch]", "[Human]"],
];
const GLEICHE_PRAEFIXE = ["[Plan]", "[Task]"];

test("projektSprache: fehlendes Feld ergibt de", () => {
  assert.equal(projektSprache({}), "de");
  assert.equal(projektSprache(undefined), "de");
  assert.equal(projektSprache(null), "de");
});

test("projektSprache: language en ergibt en", () => {
  assert.equal(projektSprache({ language: "en" }), "en");
  assert.equal(projektSprache({ language: "de" }), "de");
});

test("projektSprache: Altname sprache en ergibt en", () => {
  assert.equal(projektSprache({ sprache: "en" }), "en");
});

test("projektSprache: language geht vor sprache", () => {
  assert.equal(projektSprache({ language: "de", sprache: "en" }), "de");
});

test("projektSprache: unbekannter Wert ergibt de", () => {
  assert.equal(projektSprache({ language: "fr" }), "de");
  assert.equal(projektSprache({ sprache: "EN " }), "de");
  assert.equal(projektSprache({ language: 1 }), "de");
});

test("das Register traegt genau die Labels und Praefixe aus E4", () => {
  const labels = Object.values(LABELS).map((e) => [e.de, e.en]);
  assert.deepEqual(
    labels.slice().sort(),
    [...LABEL_PAARE, ...GLEICHE_LABELS.map((n) => [n, n])].sort()
  );
  const praefixe = Object.values(PRAEFIXE).map((e) => [e.de, e.en]);
  assert.deepEqual(
    praefixe.slice().sort(),
    [...PRAEFIX_PAARE, ...GLEICHE_PRAEFIXE.map((n) => [n, n])].sort()
  );
});

test("labelName liefert je Sache den Namen der Sprache", () => {
  for (const [de, en] of [...LABEL_PAARE, ...GLEICHE_LABELS.map((n) => [n, n])]) {
    const sache = erkenneLabel(de);
    assert.ok(sache, `keine Sache fuer ${de}`);
    assert.equal(labelName(sache, "de"), de);
    assert.equal(labelName(sache, "en"), en);
  }
});

test("labelName und praefix: ohne oder mit unbekannter Sprache der englische Name (Issue #1552)", () => {
  assert.equal(labelName(erkenneLabel("kit:klaeren")), "kit:clarify");
  assert.equal(labelName(erkenneLabel("kit:klaeren"), "fr"), "kit:clarify");
  assert.equal(praefix("fachlich"), "[Requirement]");
  assert.equal(praefix("idee", "fr"), "[Idea]");
});

test("labelName und praefix: unbekannte Sache wirft", () => {
  assert.throws(() => labelName("gibtsnicht", "de"), /gibtsnicht/);
  assert.throws(() => praefix("gibtsnicht", "en"), /gibtsnicht/);
});

test("praefix liefert je Art den Namen der Sprache", () => {
  for (const [de, en] of [...PRAEFIX_PAARE, ...GLEICHE_PRAEFIXE.map((n) => [n, n])]) {
    const art = erkennePraefix(`${de} Titel`);
    assert.ok(art, `keine Art fuer ${de}`);
    assert.equal(praefix(art, "de"), de);
    assert.equal(praefix(art, "en"), en);
  }
});

test("erkenneLabel: beide Namen derselben Sache ergeben dieselbe Sache", () => {
  for (const [de, en] of LABEL_PAARE) {
    const sache = erkenneLabel(de);
    assert.ok(sache, `keine Sache fuer ${de}`);
    assert.equal(erkenneLabel(en), sache, `${en} ist nicht dieselbe Sache wie ${de}`);
  }
  for (const name of GLEICHE_LABELS) assert.ok(erkenneLabel(name), name);
});

test("erkenneLabel: verschiedene Sachen bleiben verschieden", () => {
  const sachen = [...LABEL_PAARE.map(([de]) => de), ...GLEICHE_LABELS].map(erkenneLabel);
  assert.equal(new Set(sachen).size, sachen.length);
});

test("erkenneLabel: fremde Labels und Unsinn ergeben null", () => {
  for (const name of ["bug", "kit:", "kit:klaerenx", "Kit:klaeren", "lauf:", "planreview:3", "", undefined, null, 7]) {
    assert.equal(erkenneLabel(name), null, String(name));
  }
});

test("erkennePraefix: beide Namen derselben Art ergeben dieselbe Art", () => {
  for (const [de, en] of PRAEFIX_PAARE) {
    const art = erkennePraefix(`${de} Etwas`);
    assert.ok(art, de);
    assert.equal(erkennePraefix(`${en} Etwas`), art);
  }
  for (const name of GLEICHE_PRAEFIXE) assert.ok(erkennePraefix(`${name} Etwas`), name);
});

// Wie FACHLICH_PRAEFIX & Co. in kit/board/dokumente.mjs: fuehrender Leerraum erlaubt,
// Gross- und Kleinschreibung gleichgueltig, das Praefix steht am Titelanfang.
test("erkennePraefix: fuehrende Leerzeichen, Schreibweise und Titel nur aus dem Praefix", () => {
  assert.equal(erkennePraefix("  [Idee] x"), erkennePraefix("[Idea] x"));
  assert.equal(erkennePraefix("[Plan]"), erkennePraefix("[Plan] x"));
  assert.equal(erkennePraefix("[plan] klein"), erkennePraefix("[Plan] x"));
  assert.equal(erkennePraefix("[HUMAN] x"), erkennePraefix("[Mensch] x"));
});

test("erkennePraefix: Titel ohne Praefix ergibt null", () => {
  for (const titel of ["Namen-Register", "x [Plan] y", "[Unbekannt] z", "[Fachplan] z", "Fachlich: z", "", undefined, null]) {
    assert.equal(erkennePraefix(titel), null, String(titel));
  }
});

// Seit Issue #1557 (Plan #1548) nimmt board.mjs nur englische Namen an. `ALTNAMEN` nennt die
// frueheren deutschen allein fuer die Abweisung; ein Register zum Ausfuehren gibt es nicht mehr.
test("das Register fuehrt keine Befehlsnamen zum Ausfuehren mehr", () => {
  assert.equal(register.BEFEHLSNAMEN, undefined);
});

test("ALTNAMEN: jeder Eintrag ist ein deutscher Name mit einem anderen englischen", () => {
  const ebenen = [
    ALTNAMEN.achsen, ...Object.values(ALTNAMEN.befehle), ALTNAMEN.schutz, ALTNAMEN.optionen,
    ...Object.values(ALTNAMEN.werte),
  ];
  for (const ebene of ebenen) {
    assert.ok(Object.isFrozen(ebene));
    const englisch = Object.values(ebene);
    assert.equal(new Set(englisch).size, englisch.length, `doppelt: ${englisch.join(", ")}`);
    for (const [de, en] of Object.entries(ebene)) {
      assert.notEqual(de, en);
      assert.ok(!Object.hasOwn(ebene, en), `${en} ist zugleich ein Altname`);
    }
  }
  assert.deepEqual(Object.keys(ALTNAMEN.befehle).sort(), ["code", "hook", "issue", "issue-review", "nightrun", "session"]);
  assert.deepEqual(Object.keys(ALTNAMEN.werte).sort(), Object.keys(EINGABEWERTE).sort());
});

test("internerWert nimmt nur den englischen Wert an", () => {
  assert.equal(internerWert("art", "requirement"), "fachlich");
  assert.equal(internerWert("art", "plan"), "plan");
  assert.equal(internerWert("state", "running"), "laeuft");
  assert.equal(internerWert("stage", "requirement"), "fachlich");
  for (const [option, ebene] of Object.entries(ALTNAMEN.werte)) {
    for (const deutsch of Object.keys(ebene)) assert.equal(internerWert(option, deutsch), null, `${option} ${deutsch}`);
  }
  assert.equal(internerWert("art", "epos"), null);
  assert.equal(internerWert("art", true), true);
  assert.equal(internerWert("art", undefined), undefined);
  assert.equal(internerWert("unbekannt", "requirement"), "requirement");
});

test("Sache ereignis: Label kit:on-hold ohne deutschen Altnamen, Wartezeile in beiden Sprachen (Issue #1661)", () => {
  assert.deepEqual({ ...LABELS.ereignis }, { de: "kit:on-hold", en: "kit:on-hold" });
  assert.deepEqual({ ...register.MARKER.ereignis }, { de: "Wartet auf Ereignis:", en: "Waiting for event:" });
});
