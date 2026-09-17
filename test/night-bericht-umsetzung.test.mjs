// Der Nachtbericht unter Variante B: Variantenzeile, der Abschnitt `### Umsetzung` mit
// den drei Paketlisten und die Entscheidungen aus den Kommentaren der Pakete (Plan #691,
// E13; Issue #697; Kriterium 4 und 7 des Fachplans #681).
//
// berichtBauen bleibt eine reine Funktion ueber bereits gelesenen Karten (Fixture-Tests,
// kein Board-Zugriff); ein Integrationstest gegen den echten Runner prueft zusaetzlich,
// dass die Kette-Einheit des Ergebnisstands `variante` und die drei Listen traegt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { berichtBauen } from "../kit/night.mjs";
import {
  NUR_POSIX, run, mitProjekt, fachplan, board, umgebung, stand,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG,
} from "./helpers/kette-fixture.mjs";

test("[night-35] die Variantenzeile steht unter Stufen, in beiden Lagen", () => {
  const textA = berichtBauen({ id: "1", ausgang: "fertig", stufen: {} }, { stempel: "s" });
  assert.match(textA, /### Stufen\n\n- Variante: A\n/);

  const textB = berichtBauen({ id: "1", ausgang: "fertig", variante: "B", stufen: {} }, { stempel: "s" });
  assert.match(textB, /### Stufen\n\n- Variante: B\n/);
});

test("[night-35] der Abschnitt Umsetzung nennt alle drei Listen mit Paketnummern und -titeln", () => {
  const pakete = [{ id: "10", title: "P1" }, { id: "11", title: "P2" }, { id: "12", title: "P3" }, { id: "13", title: "P4" }];
  const einheit = {
    id: "1", ausgang: "fertig", variante: "B",
    stufen: {
      umsetzung: {
        umgesetzt: ["10"],
        angehalten: ["11"],
        nichtBegonnen: [{ id: "12", grund: "Abhaengigkeit #9 nicht erfuellt" }],
        zurueckgestellt: [{ id: "13", grund: "die Runde endete in backlog statt in In review" }],
      },
    },
  };
  const text = berichtBauen(einheit, { pakete, stempel: "s" });
  assert.match(
    text,
    /### Umsetzung\n\n- umgesetzt: #10 P1\.\n- angehalten: #11 P2\.\n- nicht begonnen: #12 P3 \(Abhaengigkeit #9 nicht erfuellt\), #13 P4 \(die Runde endete in backlog statt in In review\)\.\n/,
  );
});

test("[night-35] leere Listen im Abschnitt Umsetzung stehen als 'keine', nicht weggelassen", () => {
  const einheit = {
    id: "1", ausgang: "fertig", variante: "B",
    stufen: { umsetzung: { umgesetzt: [], angehalten: [], nichtBegonnen: [], zurueckgestellt: [] } },
  };
  const text = berichtBauen(einheit, { stempel: "s" });
  assert.match(text, /### Umsetzung\n\n- umgesetzt: keine\n- angehalten: keine\n- nicht begonnen: keine\n/);
});

test("[night-35] unter Variante A gibt es keinen Abschnitt Umsetzung", () => {
  const text = berichtBauen({ id: "1", ausgang: "fertig", stufen: {} }, { stempel: "s" });
  assert.ok(!text.includes("### Umsetzung"), "Variante A zeigt keinen Umsetzung-Abschnitt");
});

test("[night-35] Entscheidungen aus Paket-Kommentaren reihen sich fortlaufend hinter Plan und Kontext ein", () => {
  const plan = { id: "5", title: "[Plan] X", body: "## Architektonische Entscheidungen\n\n- A1 — erstens.\n" };
  const pakete = [
    {
      id: "6", title: "P1",
      body: "## Kontext\n\nPlan: Issue #5\nEntscheidung: Q1? Gewählt: a.\n",
      comments: [{ body: "## Abschlussbericht Issue #6\n\n### Entscheidungen\n- E1: Frage1? Gewaehlt: a.\n" }],
    },
    {
      id: "7", title: "P2",
      body: "## Kontext\n\nPlan: Issue #5\n",
      comments: [{ body: "## Abschlussbericht Issue #7\n\n### Entscheidungen\n- E2: Frage2? Gewaehlt: b.\n- E3: Frage3? Gewaehlt: c.\n" }],
    },
  ];
  const einheit = { id: "1", ausgang: "fertig", stufen: { plan: { id: "5" } } };
  const text = berichtBauen(einheit, { plan, pakete, stempel: "s" });
  assert.ok(text.includes(
    "1. A1 — erstens. (Plan #5)\n"
    + "2. Entscheidung: Q1? Gewählt: a. (Paket #6)\n"
    + "3. E1: Frage1? Gewaehlt: a. (Paket #6)\n"
    + "4. E2: Frage2? Gewaehlt: b. (Paket #7)\n"
    + "5. E3: Frage3? Gewaehlt: c. (Paket #7)\n",
  ));
});

test("[night-35] ein Paket ohne Entscheidungen-Block und eines ohne Kommentare liefern nichts, kein Wurf", () => {
  const pakete = [
    {
      id: "8", title: "P3", body: "## Kontext\n\nPlan: Issue #5\n",
      comments: [{ body: "## Abschlussbericht Issue #8\n\n### Hinweise\n- nichts weiter.\n" }],
    },
    { id: "9", title: "P4", body: "## Kontext\n\nPlan: Issue #5\n" },
  ];
  const einheit = { id: "1", ausgang: "fertig", stufen: {} };
  let text;
  assert.doesNotThrow(() => { text = berichtBauen(einheit, { pakete, stempel: "s" }); });
  assert.match(text, /### Entscheidungen der Nacht\n\n- Keine\.\n/);
});

test("[night-35] die Kette-Einheit des Ergebnisstands traegt variante und die drei Listen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir, "[Fachlich] Ein Anliegen");
    board(dir, "issue", "label", "add", F, "kit:durchziehen");
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.variante, "B");
    assert.ok(Array.isArray(einheit.stufen.umsetzung.umgesetzt));
    assert.ok(Array.isArray(einheit.stufen.umsetzung.angehalten));
    assert.ok(Array.isArray(einheit.stufen.umsetzung.nichtBegonnen));
    assert.deepEqual(einheit.stufen.umsetzung.umgesetzt, einheit.stufen.pakete.ids);
  });
});
