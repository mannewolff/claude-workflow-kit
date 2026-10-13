// Ablauf-Pruefung: `issue check-form` fuehrt der Einstieg, und der Befund ist Ausgabe und Exitcode
// des Prozesses.
//
// `issue check-form` — die maschinellen Formgates als Kommando (Issue #628).
//
// Was bisher ein Modell im Review pruefte (vier Ueberschriften in der richtigen
// Reihenfolge, `Autor-Modell:` im richtigen Abschnitt), entscheidet jetzt ein
// Kommando in Millisekunden: fachlich F1 F2 F6 F7 F9 F11 F12, plan P1 P2 P3 P6 P12,
// Arbeitspaket I1 bis I5. Zwei Eingaenge — Kartennummer oder Datei mit Titel —,
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

## Szenarien

### Szenario: Der Nutzer sieht es
- Angenommen ein Nutzer am Board
- Wenn er die Karte oeffnet
- Dann sieht er es

## Nicht-Ziele
- Nichts weiter.

## Offene Fragen an den PO
- Keine.
`;

const PAKET = `## Kontext
Warum.

Autor-Modell: fixture-modell

## Aufgabe
In \`kit/board.mjs\` etwas aendern.

## Akzeptanzkriterium
- Ein Kommando liefert etwas.

## Abhängigkeiten
Keine.
`;

/** Ein Fixture-Projekt fuer die Dauer eines Tests, danach restlos weg. */
function mitProjektConfig(config, fn) {
  const dir = setupProjekt(config, "board-check-form-");
  mkdirSync(join(dir, "eingaben"), { recursive: true });
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function mitProjekt(fn) {
  return mitProjektConfig(CONFIG, fn);
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

test("[board-5] eine fachliche Anforderung mit vier Abschnitten und Szenarien ist gruen, Stufe fachlich", () => {
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

// --- Arbeitspaket: I1 bis I5 --------------------------------------------------

test("[board-5] I1: die vier Abschnitte in Reihenfolge, Abhaengigkeiten zuletzt", () => {
  mitProjekt((dir) => {
    const ohneAufgabe = dateiWeg(dir, PAKET.replace("## Aufgabe\nIn `kit/board.mjs` etwas aendern.\n\n", ""), "[Task] x");
    assert.ok(gates(ohneAufgabe).includes("I1"), JSON.stringify(ohneAufgabe.json));
    const nachAbh = dateiWeg(dir, PAKET + "\n## Notizen\n- x\n", "[Task] x");
    assert.ok(gates(nachAbh).includes("I1"), "eine ##-Ueberschrift nach Abhaengigkeiten verstoesst");
    // Bestandskarten aus der SDD-Zeit tragen noch einen Abschnitt `## Spec-Wirkung`
    // zwischen Akzeptanzkriterium und Abhaengigkeiten (Plan #825, E3). Seit dem
    // Rueckbau ist er ein Zusatzabschnitt wie jeder andere und bleibt gruen.
    const altbestand = dateiWeg(dir, PAKET.replace("## Abhängigkeiten\n", "## Spec-Wirkung\nKEINE — Altbestand.\n\n## Abhängigkeiten\n"), "[Task] x");
    assert.equal(altbestand.json.ok, true, "ein Spec-Wirkung-Altbestand bleibt gruen");
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

test("[board-8] I5: eine verbindliche Vorlage verlangt ein Bildschirmfoto im Akzeptanzkriterium", () => {
  mitProjekt((dir) => {
    const mitVorlage = PAKET.replace("## Kontext\n", "## Kontext\nVorlage: docs/x.html — verbindlich\n");
    const ohneFoto = dateiWeg(dir, mitVorlage, "[Task] x");
    assert.ok(gates(ohneFoto).includes("I5"), JSON.stringify(ohneFoto.json));
    const mitFoto = dateiWeg(dir, mitVorlage.replace("## Akzeptanzkriterium\n", "## Akzeptanzkriterium\n- Bildschirmfoto der Ansicht neben docs/x.html, Abschnitt Kopf.\n"), "[Task] x");
    assert.equal(mitFoto.json.ok, true, JSON.stringify(mitFoto.json));
    const imManuellenBlock = dateiWeg(dir, mitVorlage.replace("## Abhängigkeiten\n", "### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)\n- Abnahme per Bildschirmfoto neben der Vorlage.\n\n## Abhängigkeiten\n"), "[Task] x");
    assert.equal(imManuellenBlock.json.ok, true, "der Block unter dem Akzeptanzkriterium zaehlt mit");
  });
});

test("[board-8] I5 greift nicht ohne Vorlage-Zeile und nicht bei einer Anregung", () => {
  mitProjekt((dir) => {
    assert.equal(dateiWeg(dir, PAKET, "[Task] x").json.ok, true);
    const anregung = dateiWeg(dir, PAKET.replace("## Kontext\n", "## Kontext\nVorlage: docs/x.html — Anregung\n"), "[Task] x");
    assert.equal(anregung.json.ok, true, JSON.stringify(anregung.json));
    const imCodeblock = dateiWeg(dir, PAKET.replace("## Kontext\n", "## Kontext\n```\nVorlage: docs/x.html — verbindlich\n```\n"), "[Task] x");
    assert.equal(imCodeblock.json.ok, true, "eine Zeile im Codeblock zaehlt nicht");
  });
});

// --- I6: keine Guetemessung im Akzeptanzkriterium (Issue #901) ----------------

const MUTATION_CMD = "npm --prefix frontend run test:mutation";
const MIT_MUTATION = { ...CONFIG, mutationCommand: MUTATION_CMD };
const MIT_GUETE = {
  ...CONFIG,
  buildChecks: [
    "node --test",
    { cmd: "npx stryker run", stufe: "push", guete: { muster: String.raw`score: ([\d.]+)`, marke: 0.6 } },
  ],
};

/** Das Kriterium des Vorfalls: der Mutationslauf als Zeile in der Karte. */
function mitKriterium(cmd) {
  return PAKET.replace("## Akzeptanzkriterium\n", `## Akzeptanzkriterium\n- \`${cmd}\` laeuft und die Mutationskennzahl faellt nicht.\n`);
}

test("[board-8] I6: das konfigurierte mutationCommand im Akzeptanzkriterium wird abgewiesen", () => {
  mitProjektConfig(MIT_MUTATION, (dir) => {
    const r = dateiWeg(dir, mitKriterium(MUTATION_CMD), "[Task] x");
    assert.equal(r.status, 1, r.stderr);
    assert.ok(gates(r).includes("I6"), JSON.stringify(r.json));
    const meldung = r.json.verstoesse.find((v) => v.gate === "I6").meldung;
    assert.match(meldung, /stufe: push/, meldung);
  });
});

test("[board-8] I6: auch das Kommando des guete-Eintrags wird abgewiesen", () => {
  mitProjektConfig(MIT_GUETE, (dir) => {
    const r = dateiWeg(dir, mitKriterium("npx stryker run"), "[Task] x");
    assert.ok(gates(r).includes("I6"), JSON.stringify(r.json));
  });
});

test("[board-8] I6: dasselbe Paket ohne die Zeile bleibt gruen", () => {
  mitProjektConfig(MIT_MUTATION, (dir) => {
    const r = dateiWeg(dir, PAKET, "[Task] x");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
  });
});

test("[board-8] I6: ohne mutationCommand und ohne guete weist nichts ab", () => {
  mitProjekt((dir) => {
    const r = dateiWeg(dir, mitKriterium(MUTATION_CMD), "[Task] x");
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
  });
});

test("[board-8] I6 greift nur im Akzeptanzkriterium, nicht in ## Aufgabe", () => {
  mitProjektConfig(MIT_MUTATION, (dir) => {
    const inAufgabe = PAKET.replace("## Aufgabe\n", `## Aufgabe\nDie Marke von \`${MUTATION_CMD}\` steigt auf 0,7.\n`);
    const r = dateiWeg(dir, inAufgabe, "[Task] x");
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
  });
});

test("[board-8] I6 betrifft die Stufen fachlich und plan nicht", () => {
  mitProjektConfig(MIT_MUTATION, (dir) => {
    const fachlich = dateiWeg(dir, FACHLICH.replace("- Der Nutzer sieht es.", `- \`${MUTATION_CMD}\` laeuft.`), "[Fachlich] x");
    assert.equal(fachlich.json.ok, true, JSON.stringify(fachlich.json));
    const plan = dateiWeg(dir, PLAN.replace("- node --test", `- ${MUTATION_CMD}`), "[Plan] x");
    assert.equal(plan.json.ok, true, JSON.stringify(plan.json));
  });
});

// --- I6 erweitert: Projekt-Treiber und aufhebende Entscheidung (Issue #942) ----
//
// Der Vorfall: Ein Paket baut seinen Mutations-Treiber selbst, also kennt die
// Konfiguration ihn beim Schneiden noch nicht — I6 schwieg, drei Vollaeufe standen
// im Kriterium, und die Nacht-Runde endete als wartende Sitzung. Zwei Zugaenge
// dagegen: das Config-Feld `guetekommandos` fuer Treiber, die es noch nicht gibt,
// und der Blick in den Kontext auf eine Entscheidung, die die Konvention aufhebt.

const TREIBER = "node scripts/mutationspruefung.mjs vollauf";
const MIT_GUETEKOMMANDOS = { ...CONFIG, guetekommandos: [TREIBER] };

/** Der Block, der den Session-Abschluss nicht blockiert (Issue #215). */
function mitManuellerPruefung(cmd) {
  return PAKET.replace(
    "## Abhängigkeiten\n",
    `### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)\n- \`${cmd} frontend\` laeuft einmal durch.\n\n## Abhängigkeiten\n`,
  );
}

/** Der Wortlaut aus kanban-kit #1215, Zeile im `## Kontext`. */
const AUFHEBENDE_ZEILE =
  "Entscheidung: Verlangt das Akzeptanzkriterium dieses Pakets einen echten Vollauf "
  + "beider Seiten, obwohl eine Gütemessung sonst nicht ins Paket gehört? Gewählt: ja";

function mitKontextzeile(zeile) {
  return PAKET.replace("## Kontext\n", `## Kontext\n${zeile}\n`);
}

test("[board-8] I6: ein Kommando aus guetekommandos im Akzeptanzkriterium wird abgewiesen", () => {
  mitProjektConfig(MIT_GUETEKOMMANDOS, (dir) => {
    const r = dateiWeg(dir, mitKriterium(`${TREIBER} frontend`), "[Task] x");
    assert.equal(r.status, 1, r.stderr);
    assert.ok(gates(r).includes("I6"), JSON.stringify(r.json));
    const meldung = r.json.verstoesse.find((v) => v.gate === "I6").meldung;
    assert.ok(meldung.includes(TREIBER), meldung);
  });
});

test("[board-8] I6: dasselbe Kommando unter '### Manuelle Pruefung' bleibt gruen", () => {
  mitProjektConfig(MIT_GUETEKOMMANDOS, (dir) => {
    const r = dateiWeg(dir, mitManuellerPruefung(TREIBER), "[Task] x");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
  });
});

test("[board-8] I6: der manuelle Block hebt einen Treffer im Kriterium nicht auf", () => {
  mitProjektConfig(MIT_GUETEKOMMANDOS, (dir) => {
    const beides = mitManuellerPruefung(TREIBER).replace(
      "## Akzeptanzkriterium\n",
      `## Akzeptanzkriterium\n- \`${TREIBER} backend\` laeuft und die Kennzahl faellt nicht.\n`,
    );
    const r = dateiWeg(dir, beides, "[Task] x");
    assert.ok(gates(r).includes("I6"), JSON.stringify(r.json));
  });
});

test("[board-8] I6: eine Entscheidung, die die Guetemess-Konvention aufhebt, wird abgewiesen", () => {
  mitProjekt((dir) => {
    const r = dateiWeg(dir, mitKontextzeile(AUFHEBENDE_ZEILE), "[Task] x");
    assert.equal(r.status, 1, r.stderr);
    assert.ok(gates(r).includes("I6"), JSON.stringify(r.json));
    const meldung = r.json.verstoesse.find((v) => v.gate === "I6").meldung;
    assert.match(meldung, /Manuelle Pruefung/, meldung);
  });
});

test("[board-8] I6: dieselbe Frage mit 'Gewählt: nein' bleibt gruen", () => {
  mitProjekt((dir) => {
    const nein = AUFHEBENDE_ZEILE.replace("Gewählt: ja", "Gewählt: nein. Grund: die Konvention gilt ohne Ausnahme.");
    const r = dateiWeg(dir, mitKontextzeile(nein), "[Task] x");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
  });
});

test("[board-8] I6: eine Entscheidung ohne Guetemess-Bezug bleibt gruen", () => {
  mitProjekt((dir) => {
    const andere = "Entscheidung: Legen wir das Feld optional an? Gewählt: ja. Verworfen: pflicht. Grund: rueckwaertskompatibel. Rückbau: trivial.";
    const r = dateiWeg(dir, mitKontextzeile(andere), "[Task] x");
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
  });
});

test("[board-8] I6: ein zitiertes 'Gewählt: ja' im Text weist nicht ab", () => {
  // Der Selbstbiss: Das Paket, das diese Regel baut, zitiert ihren Wortlaut im eigenen
  // Kontext — und wurde von ihr abgewiesen. Es zaehlt die erste Antwort, nicht jedes Zitat.
  mitProjekt((dir) => {
    const zitat =
      "Entscheidung: Wie erkennt I6 einen Treiber, den die Config noch nicht kennt? "
      + "Gewählt: ein optionales Config-Feld, erkannt an „Gütemessung“/„Vollauf“ zusammen mit „Gewählt: ja“. "
      + "Verworfen: eine eingebaute Namensliste. Grund: sie veraltet. Rückbau: eine Datei.";
    const r = dateiWeg(dir, mitKontextzeile(zitat), "[Task] x");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
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
    assert.match(res.stdout, /issue check-form --body-file <path> --title/);
  });
});

// --- Hinweis auf fehlende Vorgeschichte (Issue #1542, Plan #1534 A11) ----------

const MIT_VORGESCHICHTE = { ...CONFIG, vorgeschichte: true };

function vorgeschichteHinweise(json) {
  return (json.hinweise ?? []).filter((h) => h.art === "vorgeschichte");
}

test("[board-5] Vorgeschichte: Schalter an, Fachplan ohne Abschnitt → Hinweis, ok bleibt true", () => {
  mitProjektConfig(MIT_VORGESCHICHTE, (dir) => {
    const r = dateiWeg(dir, FACHLICH, "[Fachlich] x");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    const h = vorgeschichteHinweise(r.json);
    assert.equal(h.length, 1, JSON.stringify(r.json));
    assert.match(h[0].meldung, /## Vorgeschichte/);
    assert.equal(h[0].baustein, undefined);
    assert.equal(h[0].test, undefined);
  });
});

test("[board-5] Vorgeschichte: Schalter an, Plan ohne ### Vorgeschichte → Hinweis", () => {
  mitProjektConfig(MIT_VORGESCHICHTE, (dir) => {
    const r = dateiWeg(dir, PLAN, "[Plan] x");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    const h = vorgeschichteHinweise(r.json);
    assert.equal(h.length, 1, JSON.stringify(r.json));
    assert.match(h[0].meldung, /### Vorgeschichte/);
  });
});

test("[board-5] Vorgeschichte: Schalter an, Abschnitt vorhanden (auch englisch) → kein Hinweis", () => {
  mitProjektConfig(MIT_VORGESCHICHTE, (dir) => {
    const fachlich = dateiWeg(dir, FACHLICH + "\n## Vorgeschichte\n- Nichts Einschlaegiges gefunden.\n", "[Fachlich] x");
    assert.deepEqual(vorgeschichteHinweise(fachlich.json), [], JSON.stringify(fachlich.json));
    const englisch = dateiWeg(dir, FACHLICH + "\n## History\n- Nothing relevant.\n", "[Fachlich] x");
    assert.deepEqual(vorgeschichteHinweise(englisch.json), [], JSON.stringify(englisch.json));
    const plan = dateiWeg(dir, PLAN.replace("## Offene Fragen\n", "### Vorgeschichte\n- Nichts Einschlaegiges gefunden.\n\n## Offene Fragen\n"), "[Plan] x");
    assert.equal(plan.json.ok, true, JSON.stringify(plan.json));
    assert.deepEqual(vorgeschichteHinweise(plan.json), [], JSON.stringify(plan.json));
  });
});

test("[board-5] Vorgeschichte: Schalter aus → kein Hinweis, Ausgabe wie bisher", () => {
  mitProjekt((dir) => {
    assert.deepEqual(dateiWeg(dir, FACHLICH, "[Fachlich] x").json, { ok: true, stufe: "fachlich", verstoesse: [] });
    assert.deepEqual(dateiWeg(dir, PLAN, "[Plan] x").json, { ok: true, stufe: "plan", verstoesse: [] });
  });
});

test("[board-5] Vorgeschichte: Arbeitspaket → kein Hinweis, auch mit Schalter", () => {
  mitProjektConfig(MIT_VORGESCHICHTE, (dir) => {
    const r = dateiWeg(dir, PAKET, "[Task] x");
    assert.deepEqual(vorgeschichteHinweise(r.json), [], JSON.stringify(r.json));
  });
});

// --- F12: Abschnitt Szenarien (Issue #1590, Plan #1588 A3, A4, A6) ------------------

const SZENARIEN_DE = `## Szenarien

### Szenario: Der Nutzer sieht es
- Angenommen ein Nutzer am Board
- Wenn er die Karte oeffnet
- Dann sieht er es

`;

const SZENARIEN_EN = `## Scenarios

### Scenario: The user sees it
- Given a user at the board
- When they open the card
- Then they see it

`;

/** Der Fachplan der Sprache mit dem Abschnitt Szenarien `szenarien` an seiner Stelle. */
function fachplanMit(szenarien) {
  return FACHLICH.replace(SZENARIEN_DE, szenarien);
}

const F12_FAELLE = {
  de: {
    ohne: "",
    leer: "## Szenarien\n\n",
    ohneDann: SZENARIEN_DE.replace("- Dann sieht er es\n", ""),
    voll: SZENARIEN_DE,
    satz: /^Der Fachplan braucht einen Abschnitt Szenarien mit mindestens einem vollständigen Szenario\.\n/,
    form: /### Szenario: <Titel>\n- Angenommen <Ausgangslage>\n- Wenn <Handlung>\n- Dann <beobachtbares Ergebnis>/,
  },
  en: {
    ohne: "",
    leer: "## Scenarios\n\n",
    ohneDann: SZENARIEN_EN.replace("- Then they see it\n", ""),
    voll: SZENARIEN_EN,
    satz: /^The requirement needs a Scenarios section with at least one complete scenario\.\n/,
    form: /### Scenario: <title>\n- Given <starting point>\n- When <action>\n- Then <observable result>/,
  },
};

function f12(json) {
  return json.verstoesse.filter((v) => v.gate === "F12");
}

for (const sprache of ["de", "en"]) {
  const fall = F12_FAELLE[sprache];
  const config = { ...CONFIG, language: sprache };

  for (const [name, abschnitt] of [["ohne Abschnitt", fall.ohne], ["mit leerem Abschnitt", fall.leer], ["mit einem Szenario ohne Dann", fall.ohneDann]]) {
    test(`[board-1590] F12 (${sprache}): --body-file ${name} -> ok: false, ein Satz und die Form in der Projektsprache`, () => {
      mitProjektConfig(config, (dir) => {
        const pfad = join(dir, "eingaben", "f.md");
        writeFileSync(pfad, fachplanMit(abschnitt));
        const res = runBoard(dir, ["issue", "check-form", "--art", "requirement", "--body-file", pfad, "--title", "x"]);
        const json = JSON.parse(res.stdout);
        assert.equal(res.status, 1, res.stdout);
        assert.equal(json.ok, false);
        const [verstoss, ...rest] = f12(json);
        assert.equal(rest.length, 0, JSON.stringify(json));
        assert.match(verstoss.meldung, fall.satz);
        assert.match(verstoss.meldung, fall.form);
      });
    });
  }

  test(`[board-1590] F12 (${sprache}): --body-file mit einem vollstaendigen Szenario -> ok: true`, () => {
    mitProjektConfig(config, (dir) => {
      const pfad = join(dir, "eingaben", "f.md");
      writeFileSync(pfad, fachplanMit(fall.voll));
      const res = runBoard(dir, ["issue", "check-form", "--art", "requirement", "--body-file", pfad, "--title", "x"]);
      assert.equal(res.status, 0, res.stdout);
      assert.deepEqual(JSON.parse(res.stdout), { ok: true, stufe: "fachlich", verstoesse: [] });
    });
  });
}

test("[board-1590] F12: ein vollstaendiges neben einem unvollstaendigen Szenario ist kein Verstoss", () => {
  mitProjekt((dir) => {
    const zwei = SZENARIEN_DE + "### Szenario: Halb\n- Angenommen etwas\n\n";
    const r = dateiWeg(dir, fachplanMit(zwei), "[Fachlich] x");
    assert.equal(r.status, 0, JSON.stringify(r.json));
  });
});

test("[board-1590] F12: der Abschnitt hinter den Nicht-Zielen verstoesst, F1 bleibt still", () => {
  mitProjekt((dir) => {
    const body = fachplanMit("") + "\n" + SZENARIEN_DE;
    const r = dateiWeg(dir, body, "[Fachlich] x");
    assert.equal(r.status, 1);
    assert.deepEqual(gates(r), ["F12"]);
    assert.match(f12(r.json)[0].meldung, /steht nicht zwischen/);
  });
});

/** Legt zwei Fachplaene an (0001 mit, 0002 ohne Szenarien nach dem Anlegen) und prueft beide. */
function boardWeg(config) {
  return mitProjektConfig(config, (dir) => {
    const voll = join(dir, "eingaben", "voll.md");
    const ohne = join(dir, "eingaben", "ohne.md");
    writeFileSync(voll, FACHLICH);
    writeFileSync(ohne, fachplanMit(""));
    const ids = ["Alt", "Neu"].map((titel) => {
      const { id } = board(dir, "issue", "create", "--title", `[Fachlich] ${titel}`, "--body-file", voll);
      // Ein Body-Update wird nie abgewiesen (E13): So entsteht die Karte ohne Abschnitt.
      board(dir, "issue", "update", String(id), "--body-file", ohne);
      return String(id);
    });
    return ids.map((id) => {
      const res = runBoard(dir, ["issue", "check-form", id]);
      return { id, status: res.status, json: JSON.parse(res.stdout) };
    });
  });
}

test("[board-1590] F12 ueber <id>: nur ab szenarienAb, darunter nicht", () => {
  const [alt, neu] = boardWeg({ ...CONFIG, szenarienAb: 2 });
  assert.equal(alt.status, 0, JSON.stringify(alt.json));
  assert.deepEqual(f12(alt.json), []);
  assert.equal(alt.json.hinweise, undefined);
  assert.equal(neu.status, 1, JSON.stringify(neu.json));
  assert.equal(f12(neu.json).length, 1);
});

test("[board-1590] F12 ueber <id>: ohne szenarienAb kein Verstoss, aber ein Hinweis szenarien-stichtag", () => {
  for (const ergebnis of boardWeg(CONFIG)) {
    assert.equal(ergebnis.status, 0, JSON.stringify(ergebnis.json));
    assert.deepEqual(f12(ergebnis.json), []);
    const hinweise = (ergebnis.json.hinweise ?? []).filter((h) => h.art === "szenarien-stichtag");
    assert.equal(hinweise.length, 1, JSON.stringify(ergebnis.json));
    assert.match(hinweise[0].meldung, /szenarienAb/);
    assert.equal(hinweise[0].baustein, undefined);
    assert.equal(hinweise[0].test, undefined);
  }
});

test("[board-1590] die Hilfe nennt F12 bei check-form und bei issue create", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["--help"]);
    assert.match(res.stdout, /requirement\s+F1 F2 F6 F7 F9 F11 F12,/);
    assert.match(res.stdout, /F12/);
    const create = res.stdout.split("node board.mjs issue get")[0];
    assert.match(create, /F12/);
  });
});
