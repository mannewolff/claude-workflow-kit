// Testhinweise fuer ungenannte Tests eines Plans (Issue #1031, Plan #1029), im selben
// Prozess gegen den Teil kit/board/testhinweise.mjs (Issue #1220, Plan #1199, E6, E18).
//
// Fuehrt ein Plan in `## Betroffene Bereiche` oder `## Geplante Aenderungen` einen
// Baustein, zu dem nach den Test-Ablagen ein eigener Test gehoert, und nennt er diesen
// Test nirgends, steht je ungenanntem Test ein Hinweis im Ergebnis.
//
// Die heiklen Stellen sind die Nennungsregeln: Ein Baustein zaehlt nur mit Endung und
// nur ausserhalb von Codebloecken seiner beiden Abschnitte, ein Test zaehlt ueberall im
// Body, auch per Stamm — aber nur, wenn Endstueck oder Stamm eindeutig sind.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pruefeTestNennung } from "../kit/board/testhinweise.mjs";
import { zerlegeAbschnitte } from "../kit/board/dokumente.mjs";

const PLAN_TITEL = "[Plan] Seitennavigation";

/** Ein formgueltiger Plan; die Abschnitte lassen sich einzeln ersetzen. */
function plan({ kopf = "", ziel = "Etwas bauen.", bereiche = "- Navigation", aenderungen = "- Nichts Genanntes", verifizierung = "- node --test" } = {}) {
  return `Plan-Modell: fixture-modell
${kopf}
## Ziel
${ziel}

## Betroffene Bereiche
${bereiche}

## Architektonische Entscheidungen
- Keine. Die Richtung steht im Fachplan.

## Geplante Änderungen
${aenderungen}

## Offene Fragen
- Keine.

## Verifizierung
${verifizierung}
`;
}

const NAV = "src/app/nav/side-nav.ts";
const NAV_SPEC = "src/app/nav/side-nav.spec.ts";
const NAV_TEST = "src/app/nav/side-nav.test.ts";

/** Die Hinweise zu einem Plan, in der Form, die `pruefeForm` ins Ergebnis legt. */
function hinweiseZu(body, _titel, config, dateien) {
  const hinweise = pruefeTestNennung(zerlegeAbschnitte(body).abschnitte, body, dateien, config);
  return hinweise.length > 0 ? { hinweise } : {};
}

function hinweisPaare(ergebnis) {
  return (ergebnis.hinweise ?? []).map((h) => [h.baustein, h.test]);
}

test("Baustein unter Geplante Aenderungen mit ungenanntem Spec: genau ein Hinweis mit beiden Pfaden", () => {
  const body = plan({ aenderungen: `- \`${NAV}\`: Fuss wandert nach oben` });
  const ergebnis = hinweiseZu(body, PLAN_TITEL, {}, [NAV, NAV_SPEC, "src/app/main.ts"]);
  assert.deepEqual(hinweisPaare(ergebnis), [[NAV, NAV_SPEC]]);
  assert.equal(
    ergebnis.hinweise[0].meldung,
    `Zu ${NAV} gehört ${NAV_SPEC}, der Plan nennt ihn nicht. Bleibt er grün, oder fehlt er in der Liste der Änderungen?`,
  );
});

test("zwei eigene Tests (.test.ts und .spec.ts): zwei Hinweise", () => {
  const body = plan({ aenderungen: `- ${NAV}: Fuss wandert nach oben` });
  const ergebnis = hinweiseZu(body, PLAN_TITEL, {}, [NAV, NAV_SPEC, NAV_TEST]);
  assert.deepEqual(hinweisPaare(ergebnis).sort(), [[NAV, NAV_SPEC], [NAV, NAV_TEST]]);
});

test("genannter Test unterdrueckt den Hinweis, ein pauschaler Satz ueber alle Tests nicht", () => {
  const dateien = [NAV, NAV_SPEC];
  const faelle = [
    plan({ aenderungen: `- ${NAV}: Fuss wandert nach oben\n- ${NAV_SPEC}: erwartet den Fuss oben` }),
    plan({ aenderungen: `- ${NAV}: Fuss wandert nach oben\n- side-nav.spec.ts bleibt unverändert grün.` }),
    plan({ aenderungen: `- ${NAV}: Fuss wandert nach oben`, verifizierung: "- `nav/side-nav.spec.ts` bleibt grün" }),
    plan({ aenderungen: `- ${NAV}: Fuss wandert nach oben\n\n\`\`\`\nnpx vitest side-nav.spec\n\`\`\`` }),
    plan({ kopf: `Hinweis: ${NAV_SPEC} bleibt grün.\n`, aenderungen: `- ${NAV}: Fuss wandert nach oben` }),
  ];
  for (const body of faelle) {
    assert.equal(hinweiseZu(body, PLAN_TITEL, {}, dateien).hinweise, undefined, body);
  }
  const pauschal = plan({ aenderungen: `- ${NAV}: Fuss wandert nach oben`, verifizierung: "- alle bestehenden Tests bleiben grün" });
  assert.deepEqual(hinweisPaare(hinweiseZu(pauschal, PLAN_TITEL, {}, dateien)), [[NAV, NAV_SPEC]]);
});

test("Baustein ohne eigenen Test: kein Hinweis; der anzeigende Baustein mit Test meldet dessen Test", () => {
  const eintraege = "src/app/nav/nav-eintraege.ts";
  const liste = "src/app/nav/nav-liste.ts";
  const listeSpec = "src/app/nav/nav-liste.spec.ts";
  const dateien = [eintraege, liste, listeSpec];
  const ohne = plan({ aenderungen: `- ${eintraege}: neuer Eintrag` });
  assert.equal(hinweiseZu(ohne, PLAN_TITEL, {}, dateien).hinweise, undefined);
  const mit = plan({ aenderungen: `- ${eintraege}: neuer Eintrag\n- ${liste}: zeigt ihn an` });
  assert.deepEqual(hinweisPaare(hinweiseZu(mit, PLAN_TITEL, {}, dateien)), [[liste, listeSpec]]);
});

test("Java-Vorgabe, Nennung per Stamm, eigene Ablage ersetzt, { vorgaben: true } ergaenzt, [] schaltet ab", () => {
  const java = "src/main/java/org/mwolff/nav/SideNav.java";
  const javaTest = "src/test/java/org/mwolff/nav/SideNavTest.java";
  const kit = "kit/tafel.mjs";
  const kitTest = "test/tafel-check-form.test.mjs";
  const dateien = [java, javaTest, kit, kitTest, NAV, NAV_SPEC];
  const body = plan({ aenderungen: `- ${java}: neu\n- ${kit}: neu\n- ${NAV}: neu` });
  const eigene = { quelle: "kit/{name}.mjs", test: "test/{name}-*.test.mjs" };

  assert.deepEqual(hinweisPaare(hinweiseZu(body, PLAN_TITEL, {}, dateien)).sort(), [[NAV, NAV_SPEC], [java, javaTest]]);
  const genannt = plan({ aenderungen: `- ${java}: neu\n- SideNavTest bleibt grün` });
  assert.equal(hinweiseZu(genannt, PLAN_TITEL, {}, dateien).hinweise, undefined);

  assert.deepEqual(hinweisPaare(hinweiseZu(body, PLAN_TITEL, { testAblagen: [eigene] }, dateien)), [[kit, kitTest]]);
  assert.deepEqual(
    hinweisPaare(hinweiseZu(body, PLAN_TITEL, { testAblagen: [eigene, { vorgaben: true }] }, dateien)).sort(),
    [[kit, kitTest], [NAV, NAV_SPEC], [java, javaTest]],
  );
  assert.equal(hinweiseZu(body, PLAN_TITEL, { testAblagen: [] }, dateien).hinweise, undefined);
});

test("Baustein nur im Ziel oder nur im Codeblock der Geplanten Aenderungen: kein Hinweis", () => {
  const dateien = [NAV, NAV_SPEC];
  const imZiel = plan({ ziel: `Die Navigation aus ${NAV} soll anders aussehen.` });
  assert.equal(hinweiseZu(imZiel, PLAN_TITEL, {}, dateien).hinweise, undefined);
  const imCode = plan({ aenderungen: `- Die Navigation\n\n\`\`\`ts\n// ${NAV}\nexport const x = 1;\n\`\`\`` });
  assert.equal(hinweiseZu(imCode, PLAN_TITEL, {}, dateien).hinweise, undefined);
});

test("zwei gleichnamige Tests: Nennung per Dateiname unterdrueckt keinen, Nennung mit Pfad nur den genannten", () => {
  const a = "src/a/liste.ts";
  const aSpec = "src/a/liste.spec.ts";
  const b = "src/b/liste.ts";
  const bSpec = "src/b/liste.spec.ts";
  const dateien = [a, aSpec, b, bSpec];
  const nurName = plan({ aenderungen: `- ${a}: neu\n- ${b}: neu\n- liste.spec.ts bleibt grün` });
  assert.deepEqual(hinweisPaare(hinweiseZu(nurName, PLAN_TITEL, {}, dateien)).sort(), [[a, aSpec], [b, bSpec]]);
  const mitPfad = plan({ aenderungen: `- ${a}: neu\n- ${b}: neu\n- a/liste.spec.ts bleibt grün` });
  assert.deepEqual(hinweisPaare(hinweiseZu(mitPfad, PLAN_TITEL, {}, dateien)), [[b, bSpec]]);
});
