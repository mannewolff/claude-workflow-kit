// Der Nachtbericht unter Variante B: Variantenzeile, der Abschnitt `### Umsetzung` mit
// den drei Paketlisten und die Entscheidungen aus den Kommentaren der Pakete (Plan #691,
// E13; Issue #697; Kriterium 4 und 7 des Fachplans #681).
//
// berichtBauen bleibt eine reine Funktion ueber bereits gelesenen Karten (Fixture-Tests,
// kein Board-Zugriff), geprueft am Teil bericht im selben Prozess. Dass die Kette-Einheit
// des Ergebnisstands `variante` und die drei Listen traegt, prueft der Lauf in
// test/ablauf-night-bericht-umsetzung.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { berichtBauen } from "../kit/night/bericht.mjs";

// Vor der Variantenzeile steht seit Issue #896 der Auftrag: die gekennzeichnete Karte
// selbst bei der fachlichen Anforderung, der Plan mit seiner Quelle beim Plan-Auftrag.
test("[night-36] die Variantenzeile steht unter Stufen, hinter dem Auftrag, in beiden Lagen", () => {
  const textA = berichtBauen({ id: "1", ausgang: "fertig", auftrag: "fachplan", stufen: {} }, { stempel: "s" });
  assert.match(textA, /### Stufen\n\n- Auftrag: fachliche Anforderung #1\n- Variante: A\n/);

  const textB = berichtBauen({ id: "1", ausgang: "fertig", auftrag: "fachplan", variante: "B", stufen: {} }, { stempel: "s" });
  assert.match(textB, /### Stufen\n\n- Auftrag: fachliche Anforderung #1\n- Variante: B\n/);
});

test("[night-896] ein Plan-Auftrag nennt Plan und fachliche Quelle und rechnet die uebernommene Stufe nicht ab", () => {
  const einheit = {
    id: "12", ausgang: "fertig", auftrag: "plan", fachplan: "7",
    stufen: { plan: { id: "12", uebernommen: true, dauerMs: 0, kennzahlen: null, korrekturrunden: 0 }, pakete: { ids: [] } },
  };
  const text = berichtBauen(einheit, { plan: { id: "12", title: "[Plan] X", body: "Plan-Review: opus (2026-09-14)\n" }, stempel: "s" });
  assert.match(text, /### Stufen\n\n- Auftrag: Plan #12 \(fachliche Quelle #7\)\n- Variante: A\n/);
  assert.match(text, /- Plan #12 \(\[Plan\] X\): als Auftrag uebernommen, nicht neu geschrieben, Pruefer opus \(2026-09-14\)\.\n/);
  assert.doesNotMatch(text, /Dauer 0\.0 min/, "eine uebernommene Stufe behauptet keine Messung");
});

test("[night-36] der Abschnitt Umsetzung nennt alle drei Listen mit Paketnummern und -titeln", () => {
  const pakete = [{ id: "10", title: "P1" }, { id: "11", title: "P2" }, { id: "12", title: "P3" }, { id: "13", title: "P4" }];
  const einheit = {
    id: "1", ausgang: "fertig", variante: "B",
    stufen: {
      umsetzung: {
        umgesetzt: [{ id: "10", stufe: "leicht", stufeVerwendet: "leicht", modell: "fixture-modell" }],
        angehalten: ["11"],
        nichtBegonnen: [{ id: "12", grund: "Abhaengigkeit #9 nicht erfuellt" }],
        zurueckgestellt: [{ id: "13", grund: "die Runde endete in backlog statt in In review" }],
      },
    },
  };
  const text = berichtBauen(einheit, { pakete, stempel: "s" });
  assert.match(
    text,
    /### Umsetzung\n\n- umgesetzt: #10 P1 \(Aufgabenstufe leicht, Modell fixture-modell\)\.\n- angehalten: #11 P2\.\n- festgefahren: keine\n- nicht begonnen: #12 P3 \(Abhaengigkeit #9 nicht erfuellt\), #13 P4 \(die Runde endete in backlog statt in In review\)\.\n/,
  );
});

test("[night-41] ein umgesetztes Paket mit Stufe und ohne Ausweichen erscheint mit Stufe und Modell", () => {
  const pakete = [{ id: "10", title: "P1" }];
  const einheit = {
    id: "1", ausgang: "fertig", variante: "B",
    stufen: { umsetzung: { umgesetzt: [{ id: "10", stufe: "leicht", stufeVerwendet: "leicht", modell: "claude-sonnet-5" }], angehalten: [], nichtBegonnen: [] } },
  };
  const text = berichtBauen(einheit, { pakete, stempel: "s" });
  assert.match(text, /- umgesetzt: #10 P1 \(Aufgabenstufe leicht, Modell claude-sonnet-5\)\.\n/);
});

test("[night-41] ein umgesetztes Paket, dessen Modell von einer hoeheren Stufe kam, nennt beide Stufen", () => {
  const pakete = [{ id: "10", title: "P1" }];
  const einheit = {
    id: "1", ausgang: "fertig", variante: "B",
    stufen: { umsetzung: { umgesetzt: [{ id: "10", stufe: "leicht", stufeVerwendet: "mittel", modell: "claude-opus-5" }], angehalten: [], nichtBegonnen: [] } },
  };
  const text = berichtBauen(einheit, { pakete, stempel: "s" });
  assert.match(text, /- umgesetzt: #10 P1 \(Aufgabenstufe leicht, ueber Stufe mittel, Modell claude-opus-5\)\.\n/);
});

test("[night-41] ein umgesetztes Paket ohne Stufe erscheint als 'ohne Stufe'", () => {
  const pakete = [{ id: "10", title: "P1" }];
  const einheit = {
    id: "1", ausgang: "fertig", variante: "B",
    stufen: { umsetzung: { umgesetzt: [{ id: "10", stufe: null, stufeVerwendet: null, modell: "claude-sonnet-5" }], angehalten: [], nichtBegonnen: [] } },
  };
  const text = berichtBauen(einheit, { pakete, stempel: "s" });
  assert.match(text, /- umgesetzt: #10 P1 \(ohne Stufe\)\.\n/);
});

test("[night-41] ein angehaltenes und ein nicht begonnenes Paket erscheinen im heutigen Format, zeichengleich zum Bestand", () => {
  const pakete = [{ id: "10", title: "P1" }, { id: "11", title: "P2" }, { id: "12", title: "P3" }];
  const einheit = {
    id: "1", ausgang: "fertig", variante: "B",
    stufen: {
      umsetzung: {
        umgesetzt: [{ id: "10", stufe: "leicht", stufeVerwendet: "leicht", modell: "claude-sonnet-5" }],
        angehalten: ["11"],
        nichtBegonnen: [{ id: "12", grund: "Abhaengigkeit #9 nicht erfuellt" }],
      },
    },
  };
  const text = berichtBauen(einheit, { pakete, stempel: "s" });
  assert.match(text, /- angehalten: #11 P2\.\n- festgefahren: keine\n- nicht begonnen: #12 P3 \(Abhaengigkeit #9 nicht erfuellt\)\.\n/);
});

test("[night-41] fehlen die neuen Felder in der Einheit, erscheint das Paket als 'ohne Stufe' und die Funktion wirft nicht", () => {
  const pakete = [{ id: "10", title: "P1" }];
  const einheit = {
    id: "1", ausgang: "fertig", variante: "B",
    stufen: { umsetzung: { umgesetzt: ["10"], angehalten: [], nichtBegonnen: [] } },
  };
  let text;
  assert.doesNotThrow(() => { text = berichtBauen(einheit, { pakete, stempel: "s" }); });
  assert.match(text, /- umgesetzt: #10 P1 \(ohne Stufe\)\.\n/);
});

test("[night-36] leere Listen im Abschnitt Umsetzung stehen als 'keine', nicht weggelassen", () => {
  const einheit = {
    id: "1", ausgang: "fertig", variante: "B",
    stufen: { umsetzung: { umgesetzt: [], angehalten: [], nichtBegonnen: [], zurueckgestellt: [] } },
  };
  const text = berichtBauen(einheit, { stempel: "s" });
  assert.match(text, /### Umsetzung\n\n- umgesetzt: keine\n- angehalten: keine\n- festgefahren: keine\n- nicht begonnen: keine\n/);
});

test("[night-36] unter Variante A gibt es keinen Abschnitt Umsetzung", () => {
  const text = berichtBauen({ id: "1", ausgang: "fertig", stufen: {} }, { stempel: "s" });
  assert.ok(!text.includes("### Umsetzung"), "Variante A zeigt keinen Umsetzung-Abschnitt");
});

test("[night-36] Entscheidungen aus Paket-Kommentaren reihen sich fortlaufend hinter Plan und Kontext ein", () => {
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

test("[night-36] ein Paket ohne Entscheidungen-Block und eines ohne Kommentare liefern nichts, kein Wurf", () => {
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

// Der Abschnitt `### Ursprungsdokumente` (Issue #1289, Plan #1283 E8, Kriterien 4, 5 und 7
// des Fachplans #1279): eine reine Funktion ueber `stufen.umsetzung.ursprung` — die Spalten
// vor der Umsetzung (`vorher`) und die Ausgabe von `issue ursprung` (`auswertung`).
const ursprungAbschnitt = (text) => {
  const start = text.indexOf("### Ursprungsdokumente\n");
  if (start < 0) return null;
  const ende = text.indexOf("\n### ", start + 1);
  return text.slice(start, ende < 0 ? undefined : ende);
};

const durchAuswertung = (spalten) => ({
  plan: "5", durch: true, grund: null, fehlend: [],
  dokumente: [
    { id: "5", art: "plan", spalte: spalten.plan, aktion: `lag bereits in ${spalten.planName}`, grund: null },
    { id: "4", art: "fachlich", spalte: spalten.fach, aktion: `lag bereits in ${spalten.fachName}`, grund: null },
  ],
});

test("[night-1289] ein Dokument, das vorher ausserhalb von In review lag und jetzt dort liegt, ist gewandert", () => {
  const einheit = {
    id: "4", ausgang: "fertig", variante: "B",
    stufen: { umsetzung: { umgesetzt: [], ursprung: {
      vorher: { 5: "ready", 4: "backlog" },
      auswertung: durchAuswertung({ plan: "in_review", planName: "In review", fach: "in_review", fachName: "In review" }),
    } } },
  };
  const abschnitt = ursprungAbschnitt(berichtBauen(einheit, { stempel: "s" }));
  assert.equal(abschnitt,
    "### Ursprungsdokumente\n\n- Plan #5: nach In review gewandert.\n- fachliche Anforderung #4: nach In review gewandert.\n");
});

test("[night-1289] ein Dokument, das vorher schon in In review oder Done lag, lag bereits dort", () => {
  const einheit = {
    id: "4", ausgang: "fertig", variante: "B",
    stufen: { umsetzung: { umgesetzt: [], ursprung: {
      vorher: { 5: "in_review", 4: "done" },
      auswertung: durchAuswertung({ plan: "in_review", planName: "In review", fach: "done", fachName: "Done" }),
    } } },
  };
  const abschnitt = ursprungAbschnitt(berichtBauen(einheit, { stempel: "s" }));
  assert.match(abschnitt, /- Plan #5: lag bereits in In review\.\n/);
  assert.match(abschnitt, /- fachliche Anforderung #4: lag bereits in Done\.\n/);
});

test("[night-1289] ein Plan, der nicht durch ist, laesst die Dokumente stehen und nennt je fehlendem Paket Spalte und Grund", () => {
  const pakete = [{ id: "10", title: "P1" }, { id: "11", title: "P2" }, { id: "12", title: "P3" }, { id: "13", title: "P4" }];
  const grund = "Plan #5 nicht durch: #10 in Backlog, #11 in Backlog, #12 in Backlog, #13 in Backlog";
  const einheit = {
    id: "4", ausgang: "fertig", variante: "B",
    stufen: { umsetzung: {
      umgesetzt: [],
      zurueckgestellt: [{ id: "10", grund: "die Runde endete in backlog statt in In review" }],
      nichtBegonnen: [{ id: "11", grund: "wartet auf einen Push (#9)" }, { id: "12", grund: "Abhaengigkeit #10 nicht erfuellt" }],
      ursprung: {
        vorher: { 5: "ready", 4: "backlog" },
        auswertung: {
          plan: "5", durch: false, grund,
          fehlend: ["10", "11", "12", "13"].map((id) => ({ id, titel: `P${Number(id) - 9}`, spalte: "backlog" })),
          dokumente: [
            { id: "5", art: "plan", spalte: "ready", aktion: "bleibt", grund },
            { id: "4", art: "fachlich", spalte: "backlog", aktion: "bleibt", grund },
          ],
        },
      },
    } },
  };
  const abschnitt = ursprungAbschnitt(berichtBauen(einheit, { pakete, stempel: "s" }));
  assert.match(abschnitt, new RegExp(`- Plan #5: bleibt in Ready — ${grund}\\.\\n`));
  assert.match(abschnitt, new RegExp(`- fachliche Anforderung #4: bleibt in Backlog — ${grund}\\.\\n`));
  assert.match(abschnitt, /- fehlende Pakete:\n/);
  assert.match(abschnitt, / {2}- #10 P1 in Backlog: gescheitert und zurück im Backlog \(die Runde endete in backlog statt in In review\)\n/);
  assert.match(abschnitt, / {2}- #11 P2 in Backlog: wartet auf Push \(wartet auf einen Push \(#9\)\)\n/);
  assert.match(abschnitt, / {2}- #12 P3 in Backlog: nicht begonnen \(Abhaengigkeit #10 nicht erfuellt\)\n/);
  assert.match(abschnitt, / {2}- #13 P4 in Backlog: von der Umsetzung dieser Kette nicht erfasst\n/);
});

test("[night-1289] eine ausgelassene Umsetzung ist der Grund jedes fehlenden Pakets", () => {
  const grund = "Plan #5 nicht durch: #10 in Backlog";
  const einheit = {
    id: "4", ausgang: "fertig", variante: "B",
    stufen: { umsetzung: {
      ausgelassen: "Lock belegt", umgesetzt: [],
      ursprung: {
        vorher: { 5: "backlog" },
        auswertung: { plan: "5", durch: false, grund, fehlend: [{ id: "10", titel: "P1", spalte: "backlog" }],
          dokumente: [{ id: "5", art: "plan", spalte: "backlog", aktion: "bleibt", grund }] },
      },
    } },
  };
  const abschnitt = ursprungAbschnitt(berichtBauen(einheit, { stempel: "s" }));
  assert.match(abschnitt, / {2}- #10 P1 in Backlog: nicht begonnen \(Umsetzung ausgelassen: Lock belegt\)\n/);
});

test("[night-1289] eine nicht feststellbare Auswertung und ein Fehler beim Lesen stehen im Bericht", () => {
  const grund = "nicht feststellbar: Karten nicht lesbar (Netz weg)";
  const nichtFeststellbar = {
    id: "4", ausgang: "fertig", variante: "B",
    stufen: { umsetzung: { umgesetzt: [], ursprung: { vorher: {}, auswertung: { plan: "5", durch: false, grund, fehlend: [], dokumente: [] } } } },
  };
  assert.equal(ursprungAbschnitt(berichtBauen(nichtFeststellbar, { stempel: "s" })),
    `### Ursprungsdokumente\n\n- Plan #5: ${grund}.\n`);

  const fehler = { id: "4", ausgang: "fertig", variante: "B", stufen: { umsetzung: { umgesetzt: [], ursprung: { fehler: "issue ursprung endete mit Exit 1" } } } };
  assert.equal(ursprungAbschnitt(berichtBauen(fehler, { stempel: "s" })),
    "### Ursprungsdokumente\n\n- nicht feststellbar: issue ursprung endete mit Exit 1.\n");
});

test("[night-1289] eine Kette, die vor der Umsetzung angehalten hat, nennt Ausgang, Stufe und die Pakete", () => {
  const pakete = [{ id: "10", title: "P1", status: "backlog" }];
  const einheit = {
    id: "4", ausgang: "angehalten", stufe: "review", variante: "B", grund: "Stopp-Frage aus dem Review von #5",
    stufen: { plan: { id: "5" }, pakete: { ids: ["10"] } },
  };
  const abschnitt = ursprungAbschnitt(berichtBauen(einheit, { plan: { id: "5", title: "[Plan] X", status: "ready" }, pakete, stempel: "s" }));
  assert.match(abschnitt, /- Plan #5, fachliche Anforderung #4: bleiben in ihrer Spalte \(Plan #5 in Ready\) — Kette angehalten in Stufe review, die Umsetzung hat nicht begonnen\.\n/);
  assert.match(abschnitt, /- Pakete: #10 P1 in Backlog\.\n/);
});

test("[night-1289] eine Kette, die vor dem Schneiden abgebrochen ist, nennt die Pakete als noch nicht geschnitten", () => {
  const einheit = {
    id: "5", ausgang: "abgebrochen", stufe: "plan", variante: "B", auftrag: "plan", fachplan: "4",
    stufen: { plan: { id: "5" } },
  };
  const abschnitt = ursprungAbschnitt(berichtBauen(einheit, { stempel: "s" }));
  assert.match(abschnitt, /- Plan #5, fachliche Anforderung #4: bleiben in ihrer Spalte — Kette abgebrochen in Stufe plan, die Umsetzung hat nicht begonnen\.\n/);
  assert.match(abschnitt, /- Pakete: noch nicht geschnitten\.\n/);
});

test("[night-1289] unter Variante A (Ziel plan oder pakete) gibt es keinen Abschnitt Ursprungsdokumente", () => {
  for (const ziel of ["plan", "pakete"]) {
    const text = berichtBauen({ id: "4", ausgang: "fertig", ziel, stufen: { plan: { id: "5" }, pakete: { ids: ["10"] } } }, { stempel: "s" });
    assert.equal(ursprungAbschnitt(text), null, `Ziel ${ziel} schreibt keinen Abschnitt`);
  }
});

test("[night-1391] ein festgefahrenes Paket fehlt unter den Ursprungsdokumenten mit seiner Pruefung", () => {
  const grund = "es fehlen Pakete";
  const einheit = {
    id: "4", ausgang: "fertig", variante: "B", stufe: "umsetzung",
    stufen: { plan: { id: "5" }, umsetzung: {
      umgesetzt: [], angehalten: [], nichtBegonnen: [], zurueckgestellt: [],
      festgefahren: [{ id: "10", pruefung: "npm test", fehler: "test/a.test.mjs: erwartet 2", versuche: 3 }],
      ursprung: {
        vorher: { 5: "ready", 4: "backlog" },
        auswertung: {
          plan: "5", durch: false, grund,
          fehlend: [{ id: "10", titel: "P1", spalte: "backlog" }],
          dokumente: [{ id: "5", art: "plan", spalte: "ready", aktion: "bleibt", grund }],
        },
      },
    } },
  };
  const text = berichtBauen(einheit, { pakete: [{ id: "10", title: "P1" }], stempel: "s" });
  assert.match(text, /- festgefahren: #10 P1 \(npm test, 3 Versuche: test\/a\.test\.mjs: erwartet 2\)\.\n- nicht begonnen: keine\n/);
  assert.match(ursprungAbschnitt(text), / {2}- #10 P1 in Backlog: an einer Pruefung festgefahren und zurück im Backlog \(npm test\)\n/);
});
