// `issue check-form` — die maschinellen Formgates als Kommando (Issue #628).
//
// Was bisher ein Modell im Review pruefte (vier Ueberschriften in der richtigen
// Reihenfolge, `Autor-Modell:` im richtigen Abschnitt), entscheidet jetzt ein
// Kommando in Millisekunden: fachlich F1 F2 F6 F7 F9 F11, plan P1 P2 P3 P6 P12,
// Arbeitspaket I1 bis I4. Zwei Eingaenge — Kartennummer oder Datei mit Titel —,
// immer JSON, Exit 1 bei Verstoessen, ein abgewiesener Aufruf traegt `fehler`.
//
// Die Fence-Regel und die Umlaut-Gleichheit sind die heiklen Stellen: Ein Plan
// zitiert die Pflichtueberschriften regelmaessig als Beispiel im Codeblock, und
// das Repo schreibt `Aenderungen` wie `Änderungen`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard, board } from "./helpers/board-fixture.mjs";

const CONFIG = { codeHost: "local", issueTracker: "local" };

const PLAN = `Plan-Modell: fixture-modell
Fachliche Quelle: Issue #12

## Ziel
Etwas bauen.

## Betroffene Bereiche
- kit/board.mjs

## Architektonische Entscheidungen
- Keine. Die Richtung steht im Fachplan.

## Geplante Änderungen
- kit/board.mjs: neues Kommando

## Offene Fragen
- Keine.

## Verifizierung
- node --test
`;

const FACHLICH = `## Ziel
Der Nutzer sieht etwas.

Autor-Modell: fixture-modell

## Fachliche Akzeptanzkriterien
- Der Nutzer sieht es.

## Nicht-Ziele
- Nichts weiter.

## Offene Fragen an den PO
- Keine.
`;

const PAKET = `## Kontext
Warum.

Autor-Modell: fixture-modell

## Aufgabe
Was.

## Akzeptanzkriterium
- Ein Kommando liefert etwas.

## Spec-Wirkung
KEINE — nur ein Test.

## Abhängigkeiten
Keine.
`;

/** Ein Fixture-Projekt fuer die Dauer eines Tests, danach restlos weg. */
function mitProjekt(fn) {
  const dir = setupProjekt(CONFIG, "board-check-form-");
  mkdirSync(join(dir, "eingaben"), { recursive: true });
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Der Datei-Weg: liefert Exit-Code und geparste stdout-Ausgabe. */
function dateiWeg(dir, body, title, name = "doc.md") {
  const pfad = join(dir, "eingaben", name);
  writeFileSync(pfad, body);
  const res = runBoard(dir, ["issue", "check-form", "--body-file", pfad, "--title", title]);
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { /* bleibt null */ }
  return { status: res.status, json, stderr: res.stderr };
}

function gates(ergebnis) {
  return ergebnis.json.verstoesse.map((v) => v.gate);
}

// --- Gruene Dokumente je Stufe ------------------------------------------------

test("[board-5] ein Plan mit sechs korrekten Abschnitten ist gruen, Stufe plan, Exit 0", () => {
  mitProjekt((dir) => {
    const r = dateiWeg(dir, PLAN, "[Plan] Etwas");
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.json, { ok: true, stufe: "plan", verstoesse: [] });
  });
});

test("[board-5] eine fachliche Anforderung mit vier Abschnitten ist gruen, Stufe fachlich", () => {
  mitProjekt((dir) => {
    const r = dateiWeg(dir, FACHLICH, "[Fachlich] Etwas");
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.json, { ok: true, stufe: "fachlich", verstoesse: [] });
  });
});

test("[board-5] ein Arbeitspaket ist gruen, Stufe issue — mit und ohne [Task]-Praefix", () => {
  mitProjekt((dir) => {
    for (const title of ["[Task] Etwas", "Etwas ohne Praefix"]) {
      const r = dateiWeg(dir, PAKET, title);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(r.json, { ok: true, stufe: "issue", verstoesse: [] });
    }
  });
});

// --- Plan: P1, P2, P3, P6, P12 ------------------------------------------------

test("[board-5] P1: ein Plan ohne ## Verifizierung verstoesst, Exit 1", () => {
  mitProjekt((dir) => {
    const r = dateiWeg(dir, PLAN.replace("## Verifizierung\n- node --test\n", ""), "[Plan] x");
    assert.equal(r.status, 1);
    assert.equal(r.json.ok, false);
    assert.ok(gates(r).includes("P1"), JSON.stringify(r.json));
  });
});

test("[board-5] P1: die Reihenfolge der sechs Abschnitte zaehlt", () => {
  mitProjekt((dir) => {
    const vertauscht = PLAN
      .replace("## Offene Fragen\n- Keine.\n\n## Verifizierung\n- node --test\n", "## Verifizierung\n- node --test\n\n## Offene Fragen\n- Keine.\n");
    const r = dateiWeg(dir, vertauscht, "[Plan] x");
    assert.ok(gates(r).includes("P1"), JSON.stringify(r.json));
  });
});

test("[board-5] P2: eine siebte ##-Ueberschrift verstoesst, ### bleibt erlaubt", () => {
  mitProjekt((dir) => {
    const mitDrei = PLAN.replace("## Betroffene Bereiche\n", "## Betroffene Bereiche\n### Beschreibungs-Luecken\n- Kein Spec-Bereich betroffen.\n");
    assert.equal(dateiWeg(dir, mitDrei, "[Plan] x").json.ok, true);
    const mitZwei = PLAN + "\n## Anhang\n- noch was\n";
    const r = dateiWeg(dir, mitZwei, "[Plan] x");
    assert.ok(gates(r).includes("P2"), JSON.stringify(r.json));
    assert.ok(!gates(r).includes("P1"), "die sechs Pflichtabschnitte sind trotzdem vollstaendig");
  });
});

test("[board-5] P3: Plan-Modell muss vor ## Ziel stehen und einen Wert tragen", () => {
  mitProjekt((dir) => {
    const ohne = dateiWeg(dir, PLAN.replace("Plan-Modell: fixture-modell\n", ""), "[Plan] x");
    assert.ok(gates(ohne).includes("P3"), JSON.stringify(ohne.json));
    const leer = dateiWeg(dir, PLAN.replace("Plan-Modell: fixture-modell", "Plan-Modell:"), "[Plan] x");
    assert.ok(gates(leer).includes("P3"), JSON.stringify(leer.json));
    const unten = dateiWeg(dir, PLAN.replace("Plan-Modell: fixture-modell\n", "").replace("## Ziel\n", "## Ziel\nPlan-Modell: fixture-modell\n"), "[Plan] x");
    assert.ok(gates(unten).includes("P3"), JSON.stringify(unten.json));
  });
});

test("[board-5] P6: kein Abschnitt ist leer, und '- Keine.' nur wo erlaubt", () => {
  mitProjekt((dir) => {
    const leer = dateiWeg(dir, PLAN.replace("- kit/board.mjs\n", ""), "[Plan] x");
    assert.ok(gates(leer).includes("P6"), JSON.stringify(leer.json));
    const keineFalsch = dateiWeg(dir, PLAN.replace("- node --test", "- Keine."), "[Plan] x");
    assert.ok(gates(keineFalsch).includes("P6"), JSON.stringify(keineFalsch.json));
    const keineSpaeter = dateiWeg(dir, PLAN.replace("## Offene Fragen\n- Keine.", "## Offene Fragen\n- Eine Frage.\n- Keine."), "[Plan] x");
    assert.ok(gates(keineSpaeter).includes("P6"), "'- Keine.' als zweite Zeile ist kein gueltiger Leerfall");
  });
});

test("[board-5] P12: eine Issue-Review-Zeile am Plan verstoesst", () => {
  mitProjekt((dir) => {
    const r = dateiWeg(dir, PLAN.replace("Plan-Modell: fixture-modell\n", "Plan-Modell: fixture-modell\nIssue-Review: sonnet (2026-09-01)\n"), "[Plan] x");
    assert.ok(gates(r).includes("P12"), JSON.stringify(r.json));
  });
});

// --- Fachlich: F1, F2, F6, F7, F9, F11 ----------------------------------------

test("[board-5] F1 und F7: ohne ## Offene Fragen an den PO verstoesst beides", () => {
  mitProjekt((dir) => {
    const r = dateiWeg(dir, FACHLICH.replace("## Offene Fragen an den PO\n- Keine.\n", ""), "[Fachlich] x");
    assert.equal(r.status, 1);
    assert.ok(gates(r).includes("F1"), JSON.stringify(r.json));
    assert.ok(gates(r).includes("F7"), JSON.stringify(r.json));
  });
});

test("[board-5] F1: weitere ##-Abschnitte sind bei der fachlichen Anforderung erlaubt", () => {
  mitProjekt((dir) => {
    const r = dateiWeg(dir, FACHLICH + "\n## Hintergrund\n- Vorgeschichte.\n", "[Fachlich] x");
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
  });
});

test("[board-5] F2: Autor-Modell im falschen Abschnitt oder ohne Wert verstoesst", () => {
  mitProjekt((dir) => {
    const falsch = FACHLICH.replace("\nAutor-Modell: fixture-modell\n", "\n").replace("## Nicht-Ziele\n", "## Nicht-Ziele\nAutor-Modell: fixture-modell\n");
    assert.ok(gates(dateiWeg(dir, falsch, "[Fachlich] x")).includes("F2"));
    const leer = FACHLICH.replace("Autor-Modell: fixture-modell", "Autor-Modell:");
    assert.ok(gates(dateiWeg(dir, leer, "[Fachlich] x")).includes("F2"));
  });
});

test("[board-5] F6: ein leeres ## Nicht-Ziele verstoesst, ein leeres ## Offene Fragen an den PO nicht", () => {
  mitProjekt((dir) => {
    const leerNZ = dateiWeg(dir, FACHLICH.replace("- Nichts weiter.\n", ""), "[Fachlich] x");
    assert.ok(gates(leerNZ).includes("F6"), JSON.stringify(leerNZ.json));
    const leerPO = dateiWeg(dir, FACHLICH.replace("## Offene Fragen an den PO\n- Keine.\n", "## Offene Fragen an den PO\n"), "[Fachlich] x");
    assert.equal(leerPO.json.ok, true, JSON.stringify(leerPO.json));
  });
});

test("[board-5] F9 und F11: Herkunftszeile und Issue-Review-Zeile an der Wurzel verstossen", () => {
  mitProjekt((dir) => {
    const herkunft = dateiWeg(dir, FACHLICH.replace("## Ziel\n", "## Ziel\nFachliche Quelle: Issue #3\n"), "[Fachlich] x");
    assert.ok(gates(herkunft).includes("F9"), JSON.stringify(herkunft.json));
    const plan = dateiWeg(dir, FACHLICH.replace("## Ziel\n", "## Ziel\nPlan: Issue #3\n"), "[Fachlich] x");
    assert.ok(gates(plan).includes("F9"), JSON.stringify(plan.json));
    const marker = dateiWeg(dir, FACHLICH.replace("Autor-Modell: fixture-modell\n", "Autor-Modell: fixture-modell\nIssue-Review: opus (2026-09-01)\n"), "[Fachlich] x");
    assert.ok(gates(marker).includes("F11"), JSON.stringify(marker.json));
  });
});

// --- Arbeitspaket: I1 bis I4 --------------------------------------------------

test("[board-5] I1: die vier Abschnitte in Reihenfolge, Abhaengigkeiten zuletzt, Spec-Wirkung nur davor", () => {
  mitProjekt((dir) => {
    const ohneAufgabe = dateiWeg(dir, PAKET.replace("## Aufgabe\nWas.\n\n", ""), "[Task] x");
    assert.ok(gates(ohneAufgabe).includes("I1"), JSON.stringify(ohneAufgabe.json));
    const nachAbh = dateiWeg(dir, PAKET + "\n## Notizen\n- x\n", "[Task] x");
    assert.ok(gates(nachAbh).includes("I1"), "eine ##-Ueberschrift nach Abhaengigkeiten verstoesst");
    const specFalsch = dateiWeg(dir, PAKET.replace("## Spec-Wirkung\nKEINE — nur ein Test.\n\n", "").replace("## Aufgabe\n", "## Spec-Wirkung\nKEINE — nur ein Test.\n\n## Aufgabe\n"), "[Task] x");
    assert.ok(gates(specFalsch).includes("I1"), "Spec-Wirkung vor Aufgabe verstoesst");
    const ohneSpec = dateiWeg(dir, PAKET.replace("## Spec-Wirkung\nKEINE — nur ein Test.\n\n", ""), "[Task] x");
    assert.equal(ohneSpec.json.ok, true, "ohne Spec-Wirkung bleibt das Paket gruen");
  });
});

test("[board-5] I2: Autor-Modell gehoert in ## Kontext", () => {
  mitProjekt((dir) => {
    const r = dateiWeg(dir, PAKET.replace("\nAutor-Modell: fixture-modell\n", "\n").replace("## Aufgabe\n", "## Aufgabe\nAutor-Modell: fixture-modell\n"), "[Task] x");
    assert.ok(gates(r).includes("I2"), JSON.stringify(r.json));
  });
});

test("[board-5] I3: Abhaengigkeiten sind 'Keine.' oder tragen eine #N-Referenz", () => {
  mitProjekt((dir) => {
    const prosa = dateiWeg(dir, PAKET.replace("## Abhängigkeiten\nKeine.\n", "## Abhängigkeiten\nErst das andere Paket.\n"), "[Task] x");
    assert.ok(gates(prosa).includes("I3"), JSON.stringify(prosa.json));
    const leer = dateiWeg(dir, PAKET.replace("## Abhängigkeiten\nKeine.\n", "## Abhängigkeiten\n"), "[Task] x");
    assert.ok(gates(leer).includes("I3"), JSON.stringify(leer.json));
    const ref = dateiWeg(dir, PAKET.replace("Keine.\n", "Issue #625 muss vorher fertig sein.\n"), "[Task] x");
    assert.equal(ref.json.ok, true, JSON.stringify(ref.json));
  });
});

test("[board-5] I4: Plan- und Fachliche-Quelle-Zeilen im Abhaengigkeiten-Abschnitt verstossen", () => {
  mitProjekt((dir) => {
    const r = dateiWeg(dir, PAKET.replace("Keine.\n", "Keine.\nFachliche Quelle: Issue #12\n"), "[Task] x");
    assert.ok(gates(r).includes("I4"), JSON.stringify(r.json));
    const imKontext = dateiWeg(dir, PAKET.replace("## Kontext\n", "## Kontext\nPlan: Issue #9\nFachliche Quelle: Issue #12\n"), "[Task] x");
    assert.equal(imKontext.json.ok, true, "im Kontext sind die Zeilen richtig");
  });
});

// --- Leseregeln: Fence und Umlaute --------------------------------------------

test("[board-5] Fence-Regel: eine Ueberschrift im Codeblock zaehlt weder als Treffer noch als Verstoss", () => {
  mitProjekt((dir) => {
    const nurImFence = PLAN.replace("## Verifizierung\n- node --test\n", "```markdown\n## Verifizierung\n```\n");
    const r = dateiWeg(dir, nurImFence, "[Plan] x");
    assert.ok(gates(r).includes("P1"), "die Ueberschrift im Codeblock ersetzt die echte nicht");
    const zusaetzlich = PLAN.replace("- node --test\n", "- node --test\n\n```markdown\n## Ziel\n## Anhang\n```\n");
    const g = dateiWeg(dir, zusaetzlich, "[Plan] x");
    assert.equal(g.json.ok, true, JSON.stringify(g.json));
  });
});

test("[board-5] Umlaute zaehlen in beiden Schreibweisen", () => {
  mitProjekt((dir) => {
    const plan = dateiWeg(dir, PLAN.replace("## Geplante Änderungen", "## Geplante Aenderungen"), "[Plan] x");
    assert.equal(plan.json.ok, true, JSON.stringify(plan.json));
    const paket = dateiWeg(dir, PAKET.replace("## Abhängigkeiten", "## Abhaengigkeiten"), "[Task] x");
    assert.equal(paket.json.ok, true, JSON.stringify(paket.json));
  });
});

// --- Der Board-Weg und die abgewiesenen Aufrufe --------------------------------

test("[board-5] ueber die Kartennummer prueft das Kommando die Karte des lokalen Trackers", () => {
  mitProjekt((dir) => {
    writeFileSync(join(dir, "eingaben", "p.md"), PLAN);
    const { id } = board(dir, "issue", "create", "--title", "[Plan] Etwas", "--body-file", join(dir, "eingaben", "p.md"));
    const ok = runBoard(dir, ["issue", "check-form", String(id)]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(JSON.parse(ok.stdout), { ok: true, stufe: "plan", verstoesse: [] });

    writeFileSync(join(dir, "eingaben", "k.md"), PAKET.replace("Keine.\n", "Keine.\nPlan: Issue #1\n"));
    const zweite = board(dir, "issue", "create", "--title", "[Task] Kaputt", "--body-file", join(dir, "eingaben", "k.md"));
    const rot = runBoard(dir, ["issue", "check-form", String(zweite.id)]);
    assert.equal(rot.status, 1);
    assert.ok(JSON.parse(rot.stdout).verstoesse.some((v) => v.gate === "I4"));
  });
});

test("[board-5] abgewiesene Aufrufe tragen fehler und Exit 1", () => {
  mitProjekt((dir) => {
    const faelle = [
      [[], /Keine Eingabe/],
      [["--body-file", join(dir, "eingaben", "fehlt.md"), "--title", "[Plan] x"], /nicht lesbar/],
      [["--body-file", join(dir, "eingaben", "doc.md")], /--title/],
      [["7", "--body-file", join(dir, "eingaben", "doc.md"), "--title", "[Plan] x"], /zugleich/],
      [["999"], /nicht gefunden|999/],
    ];
    writeFileSync(join(dir, "eingaben", "doc.md"), PLAN);
    for (const [cliArgs, muster] of faelle) {
      const res = runBoard(dir, ["issue", "check-form", ...cliArgs]);
      assert.equal(res.status, 1, `Exit fuer ${cliArgs.join(" ")}: ${res.stderr}`);
      const json = JSON.parse(res.stdout);
      assert.equal(json.ok, false);
      assert.match(json.fehler, muster, `fehler fuer ${cliArgs.join(" ")}`);
      assert.match(res.stderr, /Fehler:/);
    }
  });
});

test("[board-5] die Hilfe nennt issue check-form mit beiden Aufrufformen", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["--help"]);
    assert.match(res.stdout, /issue check-form <id>/);
    assert.match(res.stdout, /issue check-form --body-file <pfad> --title/);
  });
});
